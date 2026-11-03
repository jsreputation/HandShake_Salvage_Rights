import type { ClientMessage, FixerAdvice, RoomSnapshot, ServerMessage } from '@salvage-rights/engine';

/**
 * A deliberately independent client: raw WebSocket, its own identity, its own view of the
 * room. It shares nothing with any other client except the room code.
 */
export class TestClient {
  readonly id: string;
  readonly secret: string;
  readonly name: string;
  readonly messages: ServerMessage[] = [];
  snapshot: RoomSnapshot | null = null;
  fixer: FixerAdvice | null = null;
  errors: Array<{ code: string; message: string }> = [];
  private ws: WebSocket | null = null;
  private opened: Promise<void> = Promise.resolve();

  constructor(
    private readonly base: string,
    readonly code: string,
    name: string,
    identity?: { id: string; secret: string },
  ) {
    this.name = name;
    this.id = identity?.id ?? `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}${rand(10)}`.slice(0, 32).padEnd(8, '0');
    this.secret = identity?.secret ?? rand(32);
  }

  async connect(opts: { spectate?: boolean; hello?: boolean } = {}): Promise<this> {
    const url = `${this.base.replace(/^http/, 'ws')}/ws/${this.code}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    this.opened = new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error(`${this.name}: websocket error`)), { once: true });
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMessage;
      this.messages.push(msg);
      if (msg.t === 'state') this.snapshot = msg.snapshot;
      if (msg.t === 'fixer') this.fixer = msg.advice;
      if (msg.t === 'error') this.errors.push({ code: msg.code, message: msg.message });
    });
    await this.opened;
    if (opts.hello !== false) this.send({ t: 'hello', id: this.id, secret: this.secret, name: this.name, spectate: opts.spectate });
    return this;
  }

  send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error(`${this.name}: not connected`);
    this.ws.send(JSON.stringify(msg));
  }

  close(): Promise<void> {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return Promise.resolve();
    return new Promise((resolve) => {
      ws.addEventListener('close', () => resolve(), { once: true });
      ws.close();
    });
  }

  /** Resolve once the latest snapshot satisfies `pred`. */
  waitFor(pred: (s: RoomSnapshot) => boolean, label = 'condition', timeoutMs = 15_000): Promise<RoomSnapshot> {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        if (this.snapshot && pred(this.snapshot)) return resolve(this.snapshot);
        if (Date.now() - t0 > timeoutMs) {
          return reject(
            new Error(`${this.name}: timed out waiting for ${label}. phase=${this.snapshot?.phase} round=${this.snapshot?.round} errors=${JSON.stringify(this.errors)}`),
          );
        }
        setTimeout(tick, 15);
      };
      tick();
    });
  }

  waitForMessage<T extends ServerMessage['t']>(t: T, after = 0, timeoutMs = 15_000): Promise<Extract<ServerMessage, { t: T }>> {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        const found = this.messages.slice(after).find((m) => m.t === t);
        if (found) return resolve(found as Extract<ServerMessage, { t: T }>);
        if (Date.now() - t0 > timeoutMs) return reject(new Error(`${this.name}: no "${t}" message within ${timeoutMs}ms`));
        setTimeout(tick, 15);
      };
      tick();
    });
  }
}

export async function createRoom(base: string, settings: Record<string, unknown> = {}): Promise<string> {
  const res = await fetch(`${base}/api/rooms`, { method: 'POST', body: JSON.stringify({ settings }) });
  if (!res.ok) throw new Error(`createRoom failed: ${res.status}`);
  const data = (await res.json()) as { code: string };
  return data.code;
}

export function rand(n: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
