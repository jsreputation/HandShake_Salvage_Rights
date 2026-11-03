import {
  GameError,
  MAX_PLAYERS,
  addPlayer,
  advance,
  allLocked,
  createRoom,
  decideBot,
  ensureHost,
  findPlayer,
  nextBotIdentity,
  rematchReady,
  removePlayer,
  renamePlayer,
  requireHost,
  requirePlayer,
  resetForRematch,
  resolveRound,
  sanitizeName,
  setConnected,
  snapshotFor,
  startGame,
  submitChoice,
  templateReport,
  updateSettings,
  voteRematch,
  type ClientMessage,
  type FixerAdvice,
  type GameState,
  type ServerEvent,
  type ServerMessage,
  type Settings,
} from '@salvage-rights/engine';
import { parseClientMessage } from '@salvage-rights/protocol';
import { Server, getServerByName, type Connection, type ConnectionContext, type WSMessage } from 'partyserver';
import { afterActionReport, fixerAdvice } from './ai/index';
import { recordFinishedGame } from './db/index';
import type { Env } from './env';
import { json } from './env';

/** Per-connection state. Lives in the socket attachment, so it survives hibernation. */
interface ConnState {
  playerId: string | null;
  /** Identity of a spectator waiting for a seat. */
  pendingId: string | null;
  name: string;
  spectate: boolean;
  lastReactAt: number;
}

const EMPTY_CONN: ConnState = { playerId: null, pendingId: null, name: '', spectate: false, lastReactAt: 0 };

interface Stored {
  state: GameState;
  /** playerId -> SHA-256 hex of the client secret. */
  secrets: Record<string, string>;
  report: string | null;
  /** key `${gameNumber}:${round}:${playerId}` */
  fixer: Record<string, FixerAdvice>;
  /** playerId -> epoch ms when their last socket went away (lobby grace period). */
  disconnectedAt: Record<string, number>;
}

/** A player who drops out of the lobby keeps their seat this long (page reloads, flaky wifi). */
const LOBBY_GRACE_MS = 30_000;

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Conn = Connection<ConnState>;

/**
 * One server per room, addressed by room code (`this.name`). All game logic is delegated to the
 * pure engine; this class owns persistence, connections, timers (alarms), identity and the AI
 * integrations. partyserver provides hibernation, connection state and the close handshake.
 */
export class RoomServer extends Server<Env> {
  static override options = { hibernate: true };

  private stored: Stored | null = null;
  private pendingEvents: ServerEvent[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep hibernated sockets alive through most proxies without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  // ---------------------------------------------------------------- lifecycle

  override async onStart(): Promise<void> {
    const [state, secrets, report, fixer, disconnectedAt] = await Promise.all([
      this.ctx.storage.get<GameState>('state'),
      this.ctx.storage.get<Record<string, string>>('secrets'),
      this.ctx.storage.get<string | null>('report'),
      this.ctx.storage.get<Record<string, FixerAdvice>>('fixer'),
      this.ctx.storage.get<Record<string, number>>('disconnectedAt'),
    ]);
    if (state) this.stored = { state, secrets: secrets ?? {}, report: report ?? null, fixer: fixer ?? {}, disconnectedAt: disconnectedAt ?? {} };
  }

  override async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/init') {
      const body = (await request.json().catch(() => ({}))) as { settings?: Partial<Settings> };
      if (this.stored) return json({ code: this.stored.state.code, existed: true });
      const code = this.name;
      const state = createRoom(code, crypto.randomUUID(), body.settings ?? {}, Date.now());
      this.stored = { state, secrets: {}, report: null, fixer: {}, disconnectedAt: {} };
      await this.ctx.storage.put('state', state);
      await this.scheduleAlarm();
      return json({ code, existed: false });
    }

    if (request.method === 'GET' && url.pathname === '/summary') {
      if (!this.stored) return json({ error: 'no_such_room' }, 404);
      const s = this.stored.state;
      return json({
        code: s.code,
        phase: s.phase,
        round: s.round,
        players: s.players.length,
        maxPlayers: MAX_PLAYERS,
        gameNumber: s.gameNumber,
        host: s.players.find((p) => p.id === s.hostId)?.name ?? null,
        isPublic: s.settings.isPublic,
      });
    }

    return json({ error: 'not_found' }, 404);
  }

  override onConnect(connection: Conn, _ctx: ConnectionContext): void {
    connection.setState({ ...EMPTY_CONN });
    if (!this.stored) {
      this.send(connection, { t: 'error', code: 'no_such_room', message: 'This room no longer exists.' });
      connection.close(4004, 'no_such_room');
    }
  }

  override async onMessage(connection: Conn, raw: WSMessage): Promise<void> {
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) return this.send(connection, { t: 'error', code: parsed.code, message: parsed.message });
    if (!this.stored) {
      this.send(connection, { t: 'error', code: 'no_such_room', message: 'This room no longer exists.' });
      connection.close(4004, 'no_such_room');
      return;
    }
    try {
      await this.handle(connection, parsed.msg);
    } catch (err) {
      if (err instanceof GameError) return this.send(connection, { t: 'error', code: err.code, message: err.message });
      console.error('room error', err);
      this.send(connection, { t: 'error', code: 'internal', message: 'Something went wrong on the server.' });
    }
  }

  override async onClose(connection: Conn): Promise<void> {
    await this.onSocketGone(connection);
  }

  /**
   * partyserver completes the close handshake for every code except 1005/1006/1015. A plain
   * `socket.close()` from a browser or Node sends a Close frame with no status, which workerd
   * reports as 1005 — a real frame that still needs an echo, or the client waits ~10 s for one.
   */
  override async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    await super.webSocketClose(ws, code, reason, wasClean);
    if (code === 1005) {
      try {
        ws.close(1000, '');
      } catch {
        /* already closed */
      }
    }
  }

  override async onError(connection: Conn, error: unknown): Promise<void> {
    console.warn('socket error', (error as Error)?.message ?? error);
    await this.onSocketGone(connection);
  }

  private connState(connection: Conn): ConnState {
    return (connection.state as ConnState | null) ?? { ...EMPTY_CONN };
  }

  private connections(): Conn[] {
    return [...this.getConnections<ConnState>()];
  }

  private async onSocketGone(connection: Conn): Promise<void> {
    const cs = this.connState(connection);
    if (!this.stored || !cs.playerId) return;
    // Another live socket for the same player (second tab) keeps them connected.
    const stillConnected = this.connections().some((other) => other.id !== connection.id && this.connState(other).playerId === cs.playerId && other.readyState === WebSocket.READY_STATE_OPEN);
    if (stillConnected) return;
    const before = this.stored.state;
    const player = findPlayer(before, cs.playerId);
    if (!player) return;
    let state = setConnected(before, cs.playerId, false);
    this.emit({ kind: 'disconnected', name: player.name });
    if (state.phase === 'lobby') {
      // Keep the seat for a grace period so a reload does not cost them their place (or the host seat).
      this.stored.disconnectedAt[cs.playerId] = Date.now();
      await this.ctx.storage.put('disconnectedAt', this.stored.disconnectedAt);
    } else {
      state = this.migrateHost(before, ensureHost(state));
    }
    await this.commit(state);
  }

  private migrateHost(before: GameState, after: GameState): GameState {
    if (after.hostId && after.hostId !== before.hostId) {
      const host = findPlayer(after, after.hostId);
      if (host) this.emit({ kind: 'host', name: host.name });
    }
    return after;
  }

  /** Remove lobby players whose grace period has expired. */
  private sweepLobby(now: number): GameState {
    const stored = this.stored!;
    let state = stored.state;
    let changed = false;
    for (const [id, at] of Object.entries(stored.disconnectedAt)) {
      const p = findPlayer(state, id);
      if (!p || p.connected) {
        delete stored.disconnectedAt[id];
        changed = true;
        continue;
      }
      if (state.phase === 'lobby' && now - at >= LOBBY_GRACE_MS) {
        state = this.migrateHost(state, removePlayer(state, id));
        this.emit({ kind: 'left', name: p.name });
        delete stored.disconnectedAt[id];
        changed = true;
      }
    }
    if (changed) void this.ctx.storage.put('disconnectedAt', stored.disconnectedAt);
    return state;
  }

  // ---------------------------------------------------------------- message handling

  private async handle(connection: Conn, msg: ClientMessage): Promise<void> {
    const cs = this.connState(connection);
    const stored = this.stored!;

    if (msg.t === 'ping') return this.send(connection, { t: 'pong', at: Date.now() });
    if (msg.t === 'hello') return this.hello(connection, msg);

    if (!cs.playerId) return this.send(connection, { t: 'error', code: 'not_identified', message: 'Say hello first.' });
    const me = cs.playerId;
    const state = stored.state;

    switch (msg.t) {
      case 'start': {
        requireHost(state, me);
        await this.commit(this.decideBots(startGame(state)));
        return this.afterChoicesChanged();
      }

      case 'settings': {
        requireHost(state, me);
        return this.commit(updateSettings(state, msg.patch));
      }

      case 'addBot': {
        requireHost(state, me);
        if (state.phase !== 'lobby') throw new GameError('in_progress', 'Add crew between games.');
        const identity = nextBotIdentity(state, msg.style);
        const id = `bot${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
        return this.commit(addPlayer(state, { id, name: identity.name, isBot: true, botStyle: identity.style }));
      }

      case 'removePlayer': {
        requireHost(state, me);
        const target = requirePlayer(state, msg.playerId);
        if (target.id === me) throw new GameError('bad_target', 'You cannot remove yourself. Just leave.');
        const next = removePlayer(state, target.id);
        delete stored.secrets[target.id];
        for (const other of this.connections()) {
          const os = this.connState(other);
          if (os.playerId === target.id) {
            other.setState({ ...os, playerId: null, spectate: true });
            this.send(other, { t: 'error', code: 'kicked', message: 'The host removed you from the crew.' });
          }
        }
        this.emit({ kind: 'kicked', name: target.name });
        return this.commit(next);
      }

      case 'rename':
        return this.commit(renamePlayer(state, me, msg.name));

      case 'choose': {
        await this.commit(submitChoice(state, me, msg.choice));
        return this.afterChoicesChanged();
      }

      case 'next': {
        requireHost(state, me);
        if (state.phase === 'reveal') {
          await this.commit(this.enterNextPhase(advance(state)));
          return this.afterChoicesChanged();
        }
        if (state.phase === 'choosing') {
          // The host may call the job early only when every *connected* player has locked in.
          if (state.players.some((p) => p.connected && p.choice === null)) throw new GameError('players_pending', 'Connected players are still deciding.');
          return this.resolveNow(state);
        }
        throw new GameError('bad_phase', 'Nothing to skip.');
      }

      case 'fixer': {
        if (state.phase !== 'choosing') throw new GameError('bad_phase', 'The Fixer only talks before a job.');
        requirePlayer(state, me);
        const key = `${state.gameNumber}:${state.round}:${me}`;
        const cached = stored.fixer[key];
        if (cached) return this.send(connection, { t: 'fixer', advice: cached });
        const advice = await fixerAdvice(this.env, state, me);
        // The table may have moved on while the model was thinking.
        if (this.stored?.state.gameNumber === state.gameNumber && this.stored.state.round === state.round) {
          this.stored.fixer[key] = advice;
          await this.ctx.storage.put('fixer', this.stored.fixer);
        }
        return this.send(connection, { t: 'fixer', advice });
      }

      case 'rematch': {
        if (state.phase !== 'finished') throw new GameError('bad_phase', 'The game is not over yet.');
        if (msg.force) requireHost(state, me);
        let next = voteRematch(state, me, msg.vote !== false);
        const voter = findPlayer(next, me);
        if (msg.vote !== false && voter) this.emit({ kind: 'rematch', by: voter.name });
        if (msg.force || rematchReady(next)) {
          next = this.decideBots(startGame(this.seatSpectators(resetForRematch(next))));
          await this.clearGameArtifacts();
          await this.commit(next);
          return this.afterChoicesChanged();
        }
        return this.commit(next);
      }

      case 'lobby': {
        requireHost(state, me);
        const next = this.seatSpectators(resetForRematch(state));
        await this.clearGameArtifacts();
        return this.commit(next);
      }

      case 'react': {
        requirePlayer(state, me);
        const now = Date.now();
        if (now - cs.lastReactAt < 1500) return;
        connection.setState({ ...cs, lastReactAt: now });
        return this.broadcastMessage({ t: 'react', playerId: me, emoji: msg.emoji, at: now });
      }
    }
  }

  private async clearGameArtifacts(): Promise<void> {
    const stored = this.stored!;
    stored.report = null;
    stored.fixer = {};
    await this.ctx.storage.put('fixer', stored.fixer);
  }

  private async hello(connection: Conn, msg: Extract<ClientMessage, { t: 'hello' }>): Promise<void> {
    const stored = this.stored!;
    const name = sanitizeName(msg.name, 'Anon');
    const hash = await sha256(msg.secret);
    let state = stored.state;
    const existing = findPlayer(state, msg.id);

    if (existing) {
      if (stored.secrets[msg.id] !== hash) throw new GameError('bad_secret', 'That seat belongs to somebody else.');
      connection.setState({ ...this.connState(connection), playerId: msg.id, pendingId: null, name: existing.name, spectate: false });
      if (!existing.connected) {
        state = setConnected(state, msg.id, true);
        this.emit({ kind: 'reconnected', name: existing.name });
      }
      if (stored.disconnectedAt[msg.id]) {
        delete stored.disconnectedAt[msg.id];
        await this.ctx.storage.put('disconnectedAt', stored.disconnectedAt);
      }
      await this.commit(state);
      this.sendState(connection);
      return;
    }

    const canSeat = state.phase === 'lobby' && !msg.spectate && state.players.length < MAX_PLAYERS;
    if (canSeat) {
      state = addPlayer(state, { id: msg.id, name });
      stored.secrets[msg.id] = hash;
      await this.ctx.storage.put('secrets', stored.secrets);
      const seated = findPlayer(state, msg.id)!.name;
      connection.setState({ ...this.connState(connection), playerId: msg.id, pendingId: null, name: seated, spectate: false });
      this.emit({ kind: 'joined', name: seated });
      await this.commit(state);
      return;
    }

    // Spectator: can watch, and is seated automatically at the next rematch if there is room.
    // Remember the secret so a spectator promoted at rematch can reclaim the seat after a reload.
    stored.secrets[msg.id] = hash;
    await this.ctx.storage.put('secrets', stored.secrets);
    connection.setState({ ...this.connState(connection), playerId: null, pendingId: msg.id, name, spectate: true });
    this.broadcastState();
  }

  // ---------------------------------------------------------------- game flow helpers

  private decideBots(state: GameState): GameState {
    let next = state;
    if (next.phase !== 'choosing') return next;
    for (const p of next.players) if (p.isBot && p.choice === null) next = submitChoice(next, p.id, decideBot(next, p));
    return next;
  }

  /** After any choice: resolve when everyone is locked in, otherwise just publish. */
  private async afterChoicesChanged(): Promise<void> {
    const state = this.stored!.state;
    if (state.phase === 'choosing' && allLocked(state)) return this.resolveNow(state);
    this.broadcastState();
  }

  private async resolveNow(state: GameState): Promise<void> {
    const timedOut = state.players.filter((p) => p.choice === null).map((p) => p.name);
    let next = resolveRound(state);
    if (timedOut.length) this.emit({ kind: 'timeout', names: timedOut });
    await this.commit(next);
    if (next.settings.revealSeconds === 0 && next.players.every((p) => p.isBot || !p.connected)) {
      // Nobody is there to press "next"; keep the game moving.
      next = this.enterNextPhase(advance(next));
      await this.commit(next);
    }
    this.broadcastState();
  }

  /** Called with the state produced by `advance`: starts bots or kicks off the report. */
  private enterNextPhase(state: GameState): GameState {
    if (state.phase === 'choosing') return this.decideBots(state);
    if (state.phase === 'finished') {
      this.stored!.report = templateReport(state);
      this.generateReport(state);
      if (this.env.DB) this.ctx.waitUntil(recordFinishedGame(this.env.DB, state).catch((err) => console.warn('could not record game', err)));
    }
    return state;
  }

  private generateReport(state: GameState): void {
    const job = afterActionReport(this.env, state)
      .then(async (text) => {
        if (!this.stored || this.stored.state.gameNumber !== state.gameNumber || this.stored.state.phase !== 'finished') return;
        this.stored.report = text;
        await this.ctx.storage.put('report', text);
        this.broadcastState();
      })
      .catch((err) => console.warn('report failed', err));
    this.ctx.waitUntil(job);
  }

  private seatSpectators(state: GameState): GameState {
    let next = state;
    for (const connection of this.connections()) {
      const cs = this.connState(connection);
      if (cs.playerId || !cs.spectate || !cs.pendingId || connection.readyState !== WebSocket.READY_STATE_OPEN) continue;
      if (next.players.length >= MAX_PLAYERS) break;
      if (findPlayer(next, cs.pendingId)) continue;
      next = addPlayer(next, { id: cs.pendingId, name: cs.name || 'Anon' });
      connection.setState({ ...cs, playerId: cs.pendingId, pendingId: null, spectate: false });
      this.emit({ kind: 'joined', name: findPlayer(next, cs.pendingId)!.name });
    }
    return next;
  }

  // ---------------------------------------------------------------- alarms (timers + expiry)

  override async onAlarm(): Promise<void> {
    if (!this.stored) return;
    const now = Date.now();
    let state = this.stored.state;

    if (state.deadline !== null && now >= state.deadline - 50) {
      if (state.phase === 'choosing') {
        await this.resolveNow(state);
        state = this.stored.state;
      } else if (state.phase === 'reveal') {
        state = this.enterNextPhase(advance(state));
        await this.commit(state);
      }
    }

    const swept = this.sweepLobby(now);
    if (swept !== this.stored.state) {
      await this.commit(swept);
      state = swept;
    }

    const anyoneHere = this.connections().length > 0;
    if (!anyoneHere && now - state.updatedAt > this.ttlMs()) {
      const directory = await getServerByName(this.env.DIRECTORY, 'global');
      await directory.fetch('https://directory/remove', { method: 'POST', body: JSON.stringify({ code: state.code }) }).catch(() => undefined);
      await this.ctx.storage.deleteAll();
      this.stored = null;
      return;
    }
    await this.scheduleAlarm();
  }

  private ttlMs(): number {
    return Number(this.env.ROOM_TTL_HOURS ?? '24') * 3600 * 1000;
  }

  private async scheduleAlarm(): Promise<void> {
    if (!this.stored) return;
    const state = this.stored.state;
    const candidates = [state.updatedAt + this.ttlMs()];
    if (state.deadline !== null) candidates.push(state.deadline);
    if (state.phase === 'lobby') for (const at of Object.values(this.stored.disconnectedAt)) candidates.push(at + LOBBY_GRACE_MS);
    const next = Math.min(...candidates);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || Math.abs(current - next) > 100) await this.ctx.storage.setAlarm(next);
  }

  // ---------------------------------------------------------------- persistence + fan-out

  private emit(event: ServerEvent): void {
    this.pendingEvents.push(event);
  }

  private async commit(state: GameState): Promise<void> {
    const stored = this.stored!;
    const prev = stored.state;
    stored.state = state;
    await this.ctx.storage.put('state', state);
    if (prev.phase !== 'finished' && state.phase === 'finished') await this.ctx.storage.put('report', stored.report);
    await this.scheduleAlarm();
    this.flushEvents();
    this.broadcastState();
    this.syncDirectory(prev, state);
  }

  private flushEvents(): void {
    if (!this.pendingEvents.length) return;
    const at = Date.now();
    for (const event of this.pendingEvents.splice(0)) this.broadcastMessage({ t: 'event', event, at });
  }

  private syncDirectory(prev: GameState, state: GameState): void {
    const listed = state.settings.isPublic && state.phase === 'lobby' && state.players.length < MAX_PLAYERS && state.players.some((p) => !p.isBot && p.connected);
    const wasListed = prev.settings.isPublic && prev.phase === 'lobby';
    if (!listed && !wasListed) return;
    const body = listed
      ? {
          code: state.code,
          host: state.players.find((p) => p.id === state.hostId)?.name ?? 'Anon',
          players: state.players.length,
          maxPlayers: MAX_PLAYERS,
          gameNumber: state.gameNumber,
          updatedAt: Date.now(),
        }
      : { code: state.code };
    const job = getServerByName(this.env.DIRECTORY, 'global')
      .then((stub) => stub.fetch(`https://directory/${listed ? 'upsert' : 'remove'}`, { method: 'POST', body: JSON.stringify(body) }))
      .catch(() => undefined);
    this.ctx.waitUntil(job);
  }

  private send(connection: Conn, msg: ServerMessage): void {
    try {
      connection.send(JSON.stringify(msg));
    } catch {
      /* socket already gone */
    }
  }

  private broadcastMessage(msg: ServerMessage): void {
    this.broadcast(JSON.stringify(msg));
  }

  private spectatorCount(): number {
    return this.connections().filter((c) => this.connState(c).spectate).length;
  }

  private sendState(connection: Conn): void {
    if (!this.stored) return;
    const cs = this.connState(connection);
    const state = this.stored.state;
    const viewerId = cs.playerId ?? cs.pendingId ?? null;
    const fixer = cs.playerId ? this.stored.fixer[`${state.gameNumber}:${state.round}:${cs.playerId}`] ?? null : null;
    const snapshot = snapshotFor(state, { viewerId, spectators: this.spectatorCount(), fixer, report: this.stored.report, now: Date.now() });
    this.send(connection, { t: 'state', snapshot });
  }

  private broadcastState(): void {
    for (const connection of this.connections()) this.sendState(connection);
  }
}
