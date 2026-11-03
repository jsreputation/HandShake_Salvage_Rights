import type { ClientMessage, FixerAdvice, RoomSnapshot, ServerEvent, ServerMessage } from '@salvage-rights/engine';
import ReconnectingWebSocket from 'partysocket/ws';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { wsUrl } from './api';
import type { Identity } from './identity';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export interface Reaction {
  id: number;
  playerId: string;
  emoji: string;
}

export interface RoomController {
  snapshot: RoomSnapshot | null;
  status: ConnectionStatus;
  fatal: { code: string; message: string } | null;
  toasts: Toast[];
  reactions: Reaction[];
  fixer: FixerAdvice | null;
  fixerPending: boolean;
  /** Server clock minus local clock, in ms. */
  skew: number;
  send: (msg: ClientMessage) => void;
  askFixer: () => void;
}

const FATAL_CODES = new Set(['no_such_room', 'bad_secret', 'bad_identity', 'kicked']);
/** If the Fixer has not answered by then (model stall, object evicted mid-call), let the player ask again. */
const FIXER_TIMEOUT_MS = 15_000;

function describe(event: ServerEvent): string {
  switch (event.kind) {
    case 'joined':
      return `${event.name} joined the crew.`;
    case 'left':
      return `${event.name} left.`;
    case 'reconnected':
      return `${event.name} is back.`;
    case 'disconnected':
      return `${event.name} lost connection.`;
    case 'kicked':
      return `${event.name} was removed from the crew.`;
    case 'host':
      return `${event.name} is now the host.`;
    case 'timeout':
      return `${event.names.join(', ')} ran out of time and collected.`;
    case 'rematch':
      return `${event.by} wants to run it back.`;
  }
}

/**
 * One hook per room. partysocket's ReconnectingWebSocket owns the backoff and reconnection;
 * every (re)open re-sends `hello`, so a dropped connection silently reclaims the seat.
 */
export function useRoom(code: string | null, identity: Identity | null, spectate = false): RoomController {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [fatal, setFatal] = useState<{ code: string; message: string } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [fixer, setFixer] = useState<FixerAdvice | null>(null);
  const [fixerPending, setFixerPending] = useState(false);
  const [skew, setSkew] = useState(0);

  const wsRef = useRef<ReconnectingWebSocket | null>(null);
  const seq = useRef(1);
  const fixerTimer = useRef<number | undefined>(undefined);

  const pushToast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = seq.current++;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 3200);
  }, []);

  useEffect(() => {
    if (!code || !identity?.id) return;
    let fatalHit = false;

    const ws = new ReconnectingWebSocket(wsUrl(code), [], {
      minReconnectionDelay: 400,
      maxReconnectionDelay: 8000,
      reconnectionDelayGrowFactor: 1.6,
      connectionTimeout: 6000,
      maxRetries: Infinity,
    });
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      setStatus('open');
      ws.send(JSON.stringify({ t: 'hello', id: identity.id, secret: identity.secret, name: identity.name || 'Anon', spectate } satisfies ClientMessage));
    });

    ws.addEventListener('close', () => {
      if (!fatalHit) setStatus('reconnecting');
    });

    ws.addEventListener('message', (ev: MessageEvent) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      switch (msg.t) {
        case 'state': {
          setSkew(msg.snapshot.now - Date.now());
          setSnapshot((prev) => {
            const next = msg.snapshot;
            if (next.me?.fixer) setFixer(next.me.fixer);
            else if (prev && (next.phase !== 'choosing' || prev.round !== next.round || prev.gameNumber !== next.gameNumber)) {
              setFixer(null);
              setFixerPending(false);
              window.clearTimeout(fixerTimer.current);
            }
            return next;
          });
          break;
        }
        case 'fixer':
          setFixer(msg.advice);
          setFixerPending(false);
          window.clearTimeout(fixerTimer.current);
          break;
        case 'event':
          pushToast(describe(msg.event));
          break;
        case 'react': {
          const id = seq.current++;
          setReactions((r) => [...r.slice(-8), { id, playerId: msg.playerId, emoji: msg.emoji }]);
          window.setTimeout(() => setReactions((r) => r.filter((x) => x.id !== id)), 1700);
          break;
        }
        case 'error':
          if (FATAL_CODES.has(msg.code)) {
            fatalHit = true;
            setFatal({ code: msg.code, message: msg.message });
            setStatus('closed');
            ws.close(1000, msg.code);
          } else {
            pushToast(msg.message, 'error');
            if (msg.code === 'bad_phase' || msg.code === 'not_a_player') {
              setFixerPending(false);
              window.clearTimeout(fixerTimer.current);
            }
          }
          break;
        case 'pong':
          break;
      }
    });

    // Application-level keepalive; the server answers without waking the room object.
    const keepalive = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('{"t":"ping"}');
    }, 25_000);

    return () => {
      window.clearInterval(keepalive);
      window.clearTimeout(fixerTimer.current);
      wsRef.current = null;
      ws.close(1000, 'leaving');
    };
  }, [code, identity?.id, identity?.secret, identity?.name, spectate, pushToast]);

  const send = useCallback(
    (msg: ClientMessage) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        pushToast('Not connected. Hang on.', 'error');
        return;
      }
      ws.send(JSON.stringify(msg));
    },
    [pushToast],
  );

  const askFixer = useCallback(() => {
    setFixerPending(true);
    window.clearTimeout(fixerTimer.current);
    fixerTimer.current = window.setTimeout(() => {
      setFixerPending(false);
      pushToast('The Fixer did not answer. Ask again.', 'error');
    }, FIXER_TIMEOUT_MS);
    send({ t: 'fixer' });
  }, [send, pushToast]);

  return useMemo(
    () => ({ snapshot, status, fatal, toasts, reactions, fixer, fixerPending, skew, send, askFixer }),
    [snapshot, status, fatal, toasts, reactions, fixer, fixerPending, skew, send, askFixer],
  );
}
