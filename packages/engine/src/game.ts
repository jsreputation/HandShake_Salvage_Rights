import { baseTake, jobName, narrate, resolveChoices } from './rules';
import {
  DEFAULT_SETTINGS,
  GameError,
  MAX_PLAYERS,
  MIN_PLAYERS,
  TOTAL_ROUNDS,
  type BotStyle,
  type Choice,
  type FixerAdvice,
  type GameState,
  type Player,
  type PlayerPublic,
  type RoomSnapshot,
  type RoundResult,
  type Settings,
} from './types';

export const NAME_MAX = 16;

export function sanitizeName(raw: unknown, fallback = 'Anon'): string {
  const s = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  return s.length ? s : fallback;
}

export function sanitizeSettings(patch: Partial<Settings>, base: Settings = DEFAULT_SETTINGS): Settings {
  const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, Math.round(n)));
  };
  return {
    timerSeconds: patch.timerSeconds === undefined ? base.timerSeconds : clampInt(patch.timerSeconds, 0, 180, base.timerSeconds),
    revealSeconds: patch.revealSeconds === undefined ? base.revealSeconds : clampInt(patch.revealSeconds, 0, 60, base.revealSeconds),
    isPublic: patch.isPublic === undefined ? base.isPublic : Boolean(patch.isPublic),
  };
}

export function createRoom(code: string, seed: string, settings: Partial<Settings> = {}, now = Date.now()): GameState {
  return {
    code,
    seed,
    phase: 'lobby',
    round: 0,
    players: [],
    hostId: null,
    history: [],
    carry: 0,
    settings: sanitizeSettings(settings),
    gameNumber: 1,
    series: {},
    winners: [],
    deadline: null,
    createdAt: now,
    updatedAt: now,
  };
}

function touch(state: GameState, now: number): GameState {
  return { ...state, updatedAt: now };
}

export function findPlayer(state: GameState, id: string): Player | undefined {
  return state.players.find((p) => p.id === id);
}

export function requirePlayer(state: GameState, id: string): Player {
  const p = findPlayer(state, id);
  if (!p) throw new GameError('not_a_player', 'You are not seated at this table.');
  return p;
}

export function requireHost(state: GameState, id: string): void {
  if (state.hostId !== id) throw new GameError('not_host', 'Only the host can do that.');
}

function nextSeat(players: Player[]): number {
  const taken = new Set(players.map((p) => p.seat));
  for (let i = 0; i < MAX_PLAYERS; i++) if (!taken.has(i)) return i;
  throw new GameError('room_full', 'The crew is full.');
}

function pickHost(players: Player[]): string | null {
  const humans = players.filter((p) => !p.isBot);
  const connectedHuman = humans.find((p) => p.connected);
  return (connectedHuman ?? humans[0] ?? players[0])?.id ?? null;
}

export interface AddPlayerInput {
  id: string;
  name: string;
  isBot?: boolean;
  botStyle?: BotStyle;
}

export function addPlayer(state: GameState, input: AddPlayerInput, now = Date.now()): GameState {
  if (state.phase !== 'lobby') throw new GameError('in_progress', 'A game is in progress. You can spectate and join the rematch.');
  if (findPlayer(state, input.id)) throw new GameError('already_seated', 'That player is already seated.');
  if (state.players.length >= MAX_PLAYERS) throw new GameError('room_full', `The crew is full (${MAX_PLAYERS} max).`);
  const player: Player = {
    id: input.id,
    name: uniqueName(state, sanitizeName(input.name)),
    seat: nextSeat(state.players),
    isBot: Boolean(input.isBot),
    botStyle: input.isBot ? input.botStyle ?? 'opportunist' : undefined,
    connected: true,
    score: 0,
    steals: 0,
    choice: null,
    rematchVote: false,
    joinedAt: now,
  };
  const players = [...state.players, player].sort((a, b) => a.seat - b.seat);
  const hostId = state.hostId && findPlayer(state, state.hostId) ? state.hostId : pickHost(players);
  return touch({ ...state, players, hostId }, now);
}

function uniqueName(state: GameState, name: string): string {
  const taken = new Set(state.players.map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; i < 100; i++) {
    const candidate = `${name.slice(0, NAME_MAX - 2)}${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return name;
}

export function renamePlayer(state: GameState, id: string, name: string, now = Date.now()): GameState {
  requirePlayer(state, id);
  const clean = sanitizeName(name);
  const players = state.players.map((p) => (p.id === id ? { ...p, name: uniqueName({ ...state, players: state.players.filter((q) => q.id !== id) }, clean) } : p));
  return touch({ ...state, players }, now);
}

export function removePlayer(state: GameState, id: string, now = Date.now()): GameState {
  requirePlayer(state, id);
  if (state.phase !== 'lobby') throw new GameError('in_progress', 'Players cannot be removed mid-game.');
  const players = state.players.filter((p) => p.id !== id);
  const hostId = state.hostId === id ? pickHost(players) : state.hostId;
  return touch({ ...state, players, hostId }, now);
}

/** Flip a player's connection flag. Host migration is a separate, explicit step (`ensureHost`). */
export function setConnected(state: GameState, id: string, connected: boolean, now = Date.now()): GameState {
  const p = findPlayer(state, id);
  if (!p || p.connected === connected) return state;
  const players = state.players.map((q) => (q.id === id ? { ...q, connected } : q));
  return touch({ ...state, players }, now);
}

/** Hand the host seat to a connected human if the current host is gone or offline. */
export function ensureHost(state: GameState, now = Date.now()): GameState {
  const host = state.hostId ? findPlayer(state, state.hostId) : undefined;
  if (host && host.connected && !host.isBot) return state;
  const hostId = pickHost(state.players);
  if (hostId === state.hostId) return state;
  return touch({ ...state, hostId }, now);
}

export function updateSettings(state: GameState, patch: Partial<Settings>, now = Date.now()): GameState {
  if (state.phase !== 'lobby') throw new GameError('in_progress', 'Settings are locked once a game starts.');
  return touch({ ...state, settings: sanitizeSettings(patch, state.settings) }, now);
}

export function currentPot(state: GameState): number {
  if (state.round < 1 || state.round > TOTAL_ROUNDS) return 0;
  return baseTake(state.round) + state.carry;
}

export function startGame(state: GameState, now = Date.now()): GameState {
  if (state.phase !== 'lobby') throw new GameError('bad_phase', 'The game has already started.');
  if (state.players.length < MIN_PLAYERS) throw new GameError('not_enough_players', `You need at least ${MIN_PLAYERS} crew members.`);
  if (state.players.length > MAX_PLAYERS) throw new GameError('room_full', `At most ${MAX_PLAYERS} crew members.`);
  const players = state.players.map((p) => ({ ...p, score: 0, steals: 0, choice: null, rematchVote: false }));
  return touch(
    {
      ...state,
      phase: 'choosing',
      round: 1,
      players,
      history: [],
      carry: 0,
      winners: [],
      deadline: choosingDeadline(state.settings, now),
    },
    now,
  );
}

function choosingDeadline(settings: Settings, now: number): number | null {
  return settings.timerSeconds > 0 ? now + settings.timerSeconds * 1000 : null;
}

function revealDeadline(settings: Settings, now: number): number | null {
  return settings.revealSeconds > 0 ? now + settings.revealSeconds * 1000 : null;
}

export function submitChoice(state: GameState, id: string, choice: Choice, now = Date.now()): GameState {
  if (state.phase !== 'choosing') throw new GameError('bad_phase', 'Choices are not open right now.');
  if (choice !== 'collect' && choice !== 'steal') throw new GameError('bad_choice', 'Choose COLLECT or STEAL.');
  const p = requirePlayer(state, id);
  if (p.choice) throw new GameError('already_locked', 'Your choice is locked in.');
  const players = state.players.map((q) => (q.id === id ? { ...q, choice } : q));
  return touch({ ...state, players }, now);
}

export function allLocked(state: GameState): boolean {
  return state.phase === 'choosing' && state.players.every((p) => p.choice !== null);
}

/** Resolve the current job. Players who have not chosen default to COLLECT and are flagged. */
export function resolveRound(state: GameState, now = Date.now()): GameState {
  if (state.phase !== 'choosing') throw new GameError('bad_phase', 'Nothing to resolve.');
  const round = state.round;
  const pot = currentPot(state);
  const timedOut = state.players.filter((p) => p.choice === null).map((p) => p.id);
  const ordered = state.players;
  const choices: Choice[] = ordered.map((p) => p.choice ?? 'collect');
  const res = resolveChoices(pot, choices);
  const isLast = round === TOTAL_ROUNDS;
  const stealerNames = ordered.filter((_, i) => choices[i] === 'steal').map((p) => p.name);
  const collectorNames = ordered.filter((_, i) => choices[i] === 'collect').map((p) => p.name);

  const result: RoundResult = {
    round,
    jobName: jobName(round),
    base: baseTake(round),
    carryIn: state.carry,
    pot,
    choices: Object.fromEntries(ordered.map((p, i) => [p.id, choices[i]!])),
    outcome: res.outcome,
    deltas: Object.fromEntries(ordered.map((p, i) => [p.id, res.deltas[i]!])),
    carryOut: isLast ? 0 : res.carryOut,
    timedOut,
    narration: narrate(res.outcome, pot, { stealers: stealerNames, collectors: collectorNames }, isLast),
  };

  const players = ordered.map((p, i) => ({
    ...p,
    score: p.score + res.deltas[i]!,
    steals: p.steals + (choices[i] === 'steal' ? 1 : 0),
    choice: null,
  }));

  return touch(
    {
      ...state,
      phase: 'reveal',
      players,
      history: [...state.history, result],
      carry: result.carryOut,
      deadline: revealDeadline(state.settings, now),
    },
    now,
  );
}

export function rankPlayers(players: readonly Player[]): Player[] {
  return [...players].sort((a, b) => b.score - a.score || a.steals - b.steals || a.seat - b.seat);
}

export function computeWinners(players: readonly Player[]): string[] {
  if (!players.length) return [];
  const ranked = rankPlayers(players);
  const top = ranked[0]!;
  return ranked.filter((p) => p.score === top.score && p.steals === top.steals).map((p) => p.id);
}

/** Move from reveal to the next job, or finish the game after job 8. */
export function advance(state: GameState, now = Date.now()): GameState {
  if (state.phase !== 'reveal') throw new GameError('bad_phase', 'Nothing to advance.');
  if (state.round < TOTAL_ROUNDS) {
    return touch({ ...state, phase: 'choosing', round: state.round + 1, deadline: choosingDeadline(state.settings, now) }, now);
  }
  const winners = computeWinners(state.players);
  const series = { ...state.series };
  for (const w of winners) series[w] = (series[w] ?? 0) + 1;
  return touch({ ...state, phase: 'finished', winners, series, carry: 0, deadline: null }, now);
}

export function voteRematch(state: GameState, id: string, vote: boolean, now = Date.now()): GameState {
  if (state.phase !== 'finished') throw new GameError('bad_phase', 'The game is not over yet.');
  requirePlayer(state, id);
  const players = state.players.map((p) => (p.id === id ? { ...p, rematchVote: vote } : p));
  return touch({ ...state, players }, now);
}

/** True when every connected human has voted for a rematch (bots always agree). */
export function rematchReady(state: GameState): boolean {
  if (state.phase !== 'finished') return false;
  const humans = state.players.filter((p) => !p.isBot && p.connected);
  if (!humans.length) return false;
  return humans.every((p) => p.rematchVote);
}

/** Reset the table for another game in the same room, keeping players and the series tally. */
export function resetForRematch(state: GameState, now = Date.now()): GameState {
  if (state.phase !== 'finished') throw new GameError('bad_phase', 'The game is not over yet.');
  const players = state.players.map((p) => ({ ...p, score: 0, steals: 0, choice: null, rematchVote: false }));
  return touch(
    {
      ...state,
      phase: 'lobby',
      round: 0,
      players,
      history: [],
      carry: 0,
      winners: [],
      deadline: null,
      gameNumber: state.gameNumber + 1,
    },
    now,
  );
}

export function toPublic(state: GameState, p: Player): PlayerPublic {
  return {
    id: p.id,
    name: p.name,
    seat: p.seat,
    isBot: p.isBot,
    botStyle: p.botStyle,
    connected: p.connected,
    isHost: state.hostId === p.id,
    score: p.score,
    steals: p.steals,
    locked: p.choice !== null,
    rematchVote: p.rematchVote,
  };
}

export interface SnapshotExtras {
  viewerId: string | null;
  spectators?: number;
  fixer?: FixerAdvice | null;
  report?: string | null;
  now?: number;
}

/** Build the view a single client is allowed to see. Only the viewer's own pending choice is included. */
export function snapshotFor(state: GameState, extras: SnapshotExtras): RoomSnapshot {
  const now = extras.now ?? Date.now();
  const viewer = extras.viewerId ? findPlayer(state, extras.viewerId) : undefined;
  return {
    code: state.code,
    phase: state.phase,
    round: state.round,
    totalRounds: TOTAL_ROUNDS,
    jobName: state.round >= 1 ? jobName(state.round) : '',
    baseTake: state.round >= 1 ? baseTake(state.round) : 0,
    carry: state.carry,
    pot: currentPot(state),
    players: state.players.map((p) => toPublic(state, p)),
    spectators: extras.spectators ?? 0,
    history: state.history,
    settings: state.settings,
    gameNumber: state.gameNumber,
    series: state.series,
    winners: state.winners,
    deadline: state.deadline,
    now,
    me: extras.viewerId
      ? {
          id: extras.viewerId,
          role: viewer ? 'player' : 'spectator',
          choice: viewer?.choice ?? null,
          fixer: extras.fixer ?? null,
        }
      : null,
    report: extras.report ?? null,
  };
}
