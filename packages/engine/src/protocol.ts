import type { BotStyle, Choice, FixerAdvice, RoomSnapshot, Settings } from './types';

/** Messages a client may send over the room WebSocket. */
export type ClientMessage =
  | { t: 'hello'; id: string; secret: string; name: string; spectate?: boolean }
  | { t: 'start' }
  | { t: 'settings'; patch: Partial<Settings> }
  | { t: 'addBot'; style?: BotStyle }
  | { t: 'removePlayer'; playerId: string }
  | { t: 'choose'; choice: Choice }
  | { t: 'next' }
  | { t: 'fixer' }
  | { t: 'rematch'; vote?: boolean; force?: boolean }
  | { t: 'lobby' }
  | { t: 'react'; emoji: string }
  | { t: 'rename'; name: string }
  | { t: 'ping' };

export type ServerEvent =
  | { kind: 'joined'; name: string }
  | { kind: 'left'; name: string }
  | { kind: 'reconnected'; name: string }
  | { kind: 'disconnected'; name: string }
  | { kind: 'kicked'; name: string }
  | { kind: 'host'; name: string }
  | { kind: 'timeout'; names: string[] }
  | { kind: 'rematch'; by: string };

/** Messages the server sends to a client. */
export type ServerMessage =
  | { t: 'state'; snapshot: RoomSnapshot }
  | { t: 'fixer'; advice: FixerAdvice }
  | { t: 'react'; playerId: string; emoji: string; at: number }
  | { t: 'event'; event: ServerEvent; at: number }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong'; at: number };

export const REACTIONS: readonly string[] = ['😇', '😈', '🤝', '🔪', '😂', '😬'];

export function isClientMessage(x: unknown): x is ClientMessage {
  return typeof x === 'object' && x !== null && typeof (x as { t?: unknown }).t === 'string';
}
