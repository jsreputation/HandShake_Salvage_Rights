import { describe, expect, it } from 'vitest';
import { ClientMessageSchema, MAX_MESSAGE_BYTES, parseClientMessage } from '../src';

describe('client message validation', () => {
  it('accepts every well-formed message type', () => {
    const ok = [
      { t: 'hello', id: 'abcdefgh12345678', secret: 'abcdefghijklmnopqrstuvwxyz', name: 'Ana' },
      { t: 'hello', id: 'abcdefgh12345678', secret: 'abcdefghijklmnopqrstuvwxyz', name: 'Ana', spectate: true },
      { t: 'start' },
      { t: 'settings', patch: { timerSeconds: 40 } },
      { t: 'settings', patch: {} },
      { t: 'addBot' },
      { t: 'addBot', style: 'shark' },
      { t: 'removePlayer', playerId: 'bot123' },
      { t: 'choose', choice: 'steal' },
      { t: 'next' },
      { t: 'fixer' },
      { t: 'rematch' },
      { t: 'rematch', vote: true, force: false },
      { t: 'lobby' },
      { t: 'react', emoji: '🔪' },
      { t: 'rename', name: 'New name' },
      { t: 'ping' },
    ];
    for (const m of ok) expect(parseClientMessage(JSON.stringify(m)), JSON.stringify(m)).toMatchObject({ ok: true });
  });

  it('rejects malformed, oversized, unknown and out-of-range messages', () => {
    const bad: Array<[unknown, string]> = [
      ['{not json', 'bad_json'],
      [JSON.stringify({ t: 'teleport' }), 'bad_message'],
      [JSON.stringify({ t: 'choose', choice: 'maybe' }), 'bad_message'],
      [JSON.stringify({ t: 'choose' }), 'bad_message'],
      [JSON.stringify({ t: 'hello', id: 'short', secret: 'abcdefghijklmnopqrstuvwxyz', name: 'x' }), 'bad_message'],
      [JSON.stringify({ t: 'hello', id: 'abcdefgh12345678', secret: 'UPPER-not-allowed-xxxxxxx', name: 'x' }), 'bad_message'],
      [JSON.stringify({ t: 'settings', patch: { timerSeconds: 9999 } }), 'bad_message'],
      [JSON.stringify({ t: 'settings', patch: { timerSeconds: 1.5 } }), 'bad_message'],
      [JSON.stringify({ t: 'addBot', style: 'genius' }), 'bad_message'],
      [JSON.stringify({ t: 'react', emoji: '💣' }), 'bad_message'],
      [JSON.stringify({ t: 'removePlayer', playerId: '' }), 'bad_message'],
      [JSON.stringify({ t: 'rename', name: 'x'.repeat(5000) }), 'bad_message'],
      [JSON.stringify({ t: 'ping', pad: 'x'.repeat(MAX_MESSAGE_BYTES) }), 'bad_message'],
      [new ArrayBuffer(8), 'bad_message'],
      [JSON.stringify([]), 'bad_message'],
      [JSON.stringify(null), 'bad_message'],
    ];
    for (const [raw, code] of bad) {
      const r = parseClientMessage(raw);
      expect(r.ok, String(raw).slice(0, 60)).toBe(false);
      if (!r.ok) expect(r.code).toBe(code);
    }
  });

  it('strips unknown keys so handlers never see smuggled fields', () => {
    const r = ClientMessageSchema.safeParse({ t: 'choose', choice: 'collect', playerId: 'someone-else', isHost: true });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({ t: 'choose', choice: 'collect' });
  });
});
