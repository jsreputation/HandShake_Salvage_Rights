import { BASE_TAKES, TOTAL_ROUNDS, resolveChoices, type Choice, type RoomSnapshot } from '@salvage-rights/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestClient, createRoom } from '../lib/client';
import { startLocalServer, type LocalServer } from '../lib/server';

let server: LocalServer;

beforeAll(async () => {
  server = await startLocalServer();
});

afterAll(async () => {
  await server.stop();
});

/** Eight scripted jobs that hit every outcome: clean, both double crosses, standoff, carry-over, final standoff. */
const SCRIPT: Array<[Choice, Choice]> = [
  ['collect', 'collect'],
  ['steal', 'collect'],
  ['collect', 'steal'],
  ['steal', 'steal'],
  ['collect', 'collect'],
  ['steal', 'collect'],
  ['collect', 'collect'],
  ['steal', 'steal'],
];

function playerIds(s: RoomSnapshot): string[] {
  return s.players.map((p) => p.id);
}

describe('a complete eight-round game between two independent clients', () => {
  it('plays all eight jobs, scores exactly as the engine says, keeps choices secret, then rematches', async () => {
    const code = await createRoom(server.base, { timerSeconds: 0, revealSeconds: 0 });
    const ana = await new TestClient(server.base, code, 'Ana').connect();
    await ana.waitFor((s) => s.players.length === 1, 'Ana seated');
    const ben = await new TestClient(server.base, code, 'Ben').connect();
    await Promise.all([ana.waitFor((s) => s.players.length === 2, 'two seated'), ben.waitFor((s) => s.players.length === 2, 'two seated')]);

    expect(ana.snapshot!.players.find((p) => p.id === ana.id)?.isHost).toBe(true);
    expect(ben.snapshot!.players.find((p) => p.id === ben.id)?.isHost).toBe(false);
    expect(ben.snapshot!.me?.role).toBe('player');

    // Only the host may start.
    ben.send({ t: 'start' });
    const err = await ben.waitForMessage('error');
    expect(err.code).toBe('not_host');

    ana.send({ t: 'start' });
    await Promise.all([ana.waitFor((s) => s.phase === 'choosing', 'started'), ben.waitFor((s) => s.phase === 'choosing', 'started')]);

    const order = playerIds(ana.snapshot!);
    const idx = { [ana.id]: order.indexOf(ana.id), [ben.id]: order.indexOf(ben.id) };
    let carry = 0;
    const expectedScore: Record<string, number> = { [ana.id]: 0, [ben.id]: 0 };

    for (let round = 1; round <= TOTAL_ROUNDS; round++) {
      const [aChoice, bChoice] = SCRIPT[round - 1]!;
      const pot = BASE_TAKES[round - 1]! + carry;

      await Promise.all([ana.waitFor((s) => s.phase === 'choosing' && s.round === round, `job ${round}`), ben.waitFor((s) => s.phase === 'choosing' && s.round === round, `job ${round}`)]);
      expect(ana.snapshot!.pot).toBe(pot);
      expect(ben.snapshot!.pot).toBe(pot);
      expect(ana.snapshot!.carry).toBe(carry);

      // Ana locks in first. Ben must learn that she is locked, but never what she chose.
      ana.send({ t: 'choose', choice: aChoice });
      await ben.waitFor((s) => s.players.find((p) => p.id === ana.id)!.locked, 'Ana locked (seen by Ben)');
      await ana.waitFor((s) => s.me?.choice === aChoice, 'own choice echoed');
      expect(ben.snapshot!.me?.choice).toBeNull();
      expect(JSON.stringify(ben.snapshot!.players)).not.toContain('"choice"');
      expect(ben.snapshot!.phase).toBe('choosing');

      // A locked choice cannot be changed.
      ana.send({ t: 'choose', choice: aChoice === 'steal' ? 'collect' : 'steal' });
      const locked = await ana.waitForMessage('error', ana.messages.length - 1);
      expect(locked.code).toBe('already_locked');

      ben.send({ t: 'choose', choice: bChoice });
      await Promise.all([ana.waitFor((s) => s.phase === 'reveal' && s.round === round, `reveal ${round}`), ben.waitFor((s) => s.phase === 'reveal' && s.round === round, `reveal ${round}`)]);

      // Independent expectation straight from the rules.
      const vector: Choice[] = order.map((id) => (id === ana.id ? aChoice : bChoice));
      const expected = resolveChoices(pot, vector);
      const result = ana.snapshot!.history[round - 1]!;
      expect(result.round).toBe(round);
      expect(result.pot).toBe(pot);
      expect(result.outcome).toBe(expected.outcome);
      expect(result.choices).toEqual({ [ana.id]: aChoice, [ben.id]: bChoice });
      expect(result.deltas[ana.id]).toBe(expected.deltas[idx[ana.id]!]);
      expect(result.deltas[ben.id]).toBe(expected.deltas[idx[ben.id]!]);
      expect(result.timedOut).toEqual([]);
      carry = round === TOTAL_ROUNDS ? 0 : expected.carryOut;
      expect(result.carryOut).toBe(carry);
      expectedScore[ana.id]! += expected.deltas[idx[ana.id]!]!;
      expectedScore[ben.id]! += expected.deltas[idx[ben.id]!]!;
      for (const c of [ana, ben]) {
        expect(c.snapshot!.players.find((p) => p.id === ana.id)!.score).toBe(expectedScore[ana.id]);
        expect(c.snapshot!.players.find((p) => p.id === ben.id)!.score).toBe(expectedScore[ben.id]);
        expect(c.snapshot!.history).toHaveLength(round);
        expect(c.snapshot!.history[round - 1]).toEqual(result);
      }

      // Only the host may move the table on.
      ben.send({ t: 'next' });
      const notHost = await ben.waitForMessage('error', ben.messages.length - 1);
      expect(notHost.code).toBe('not_host');
      ana.send({ t: 'next' });
    }

    await Promise.all([ana.waitFor((s) => s.phase === 'finished', 'finished'), ben.waitFor((s) => s.phase === 'finished', 'finished')]);
    const final = ben.snapshot!;
    expect(final.round).toBe(TOTAL_ROUNDS);
    expect(final.history).toHaveLength(TOTAL_ROUNDS);
    expect(final.players.find((p) => p.id === ana.id)!.score).toBe(480);
    expect(final.players.find((p) => p.id === ben.id)!.score).toBe(300);
    expect(final.players.find((p) => p.id === ana.id)!.steals).toBe(4);
    expect(final.players.find((p) => p.id === ben.id)!.steals).toBe(3);
    expect(final.winners).toEqual([ana.id]);
    expect(final.series).toEqual({ [ana.id]: 1 });
    // The template debrief arrives with the final state; the model-authored one replaces it asynchronously.
    const withModelReport = await ben.waitFor((s) => Boolean(s.report?.includes('Mock mission log')), 'model mission log broadcast');
    expect(withModelReport.report).toContain('Mock mission log');
    expect(final.carry).toBe(0);
    expect(ana.snapshot!.players.map((p) => p.score)).toEqual(final.players.map((p) => p.score));

    // The finished game is recorded in D1: stats and the leaderboard know about it.
    const stats = await waitForStats(server.base, ana.id, (st) => st.games >= 1);
    expect(stats).toMatchObject({ playerId: ana.id, name: 'Ana', wins: 1, bestScore: 480 });
    expect(stats.games).toBeGreaterThanOrEqual(1);
    const benStats = await waitForStats(server.base, ben.id, (st) => st.games >= 1);
    expect(benStats.wins).toBe(0);
    const board = (await (await fetch(`${server.base}/api/leaderboard`)).json()) as { enabled: boolean; players: Array<{ playerId: string }> };
    expect(board.enabled).toBe(true);
    expect(board.players.map((p) => p.playerId)).toContain(ana.id);

    // Rematch requires every connected human. One vote is not enough.
    ben.send({ t: 'rematch', vote: true });
    await ana.waitFor((s) => s.players.find((p) => p.id === ben.id)!.rematchVote, 'Ben voted');
    expect(ana.snapshot!.phase).toBe('finished');
    ana.send({ t: 'rematch', vote: true });
    await Promise.all([ana.waitFor((s) => s.gameNumber === 2 && s.phase === 'choosing', 'rematch'), ben.waitFor((s) => s.gameNumber === 2 && s.phase === 'choosing', 'rematch')]);
    const g2 = ana.snapshot!;
    expect(g2.round).toBe(1);
    expect(g2.pot).toBe(BASE_TAKES[0]);
    expect(g2.history).toEqual([]);
    expect(g2.players.every((p) => p.score === 0 && p.steals === 0 && !p.locked && !p.rematchVote)).toBe(true);
    expect(g2.series).toEqual({ [ana.id]: 1 });
    expect(g2.players.map((p) => p.id).sort()).toEqual([ana.id, ben.id].sort());

    await Promise.all([ana.close(), ben.close()]);
  });

  it('defaults an undecided player to COLLECT when the timer runs out', async () => {
    const code = await createRoom(server.base, { timerSeconds: 1, revealSeconds: 0 });
    const ana = await new TestClient(server.base, code, 'Ana').connect();
    await ana.waitFor((s) => s.players.length === 1);
    const ben = await new TestClient(server.base, code, 'Ben').connect();
    await ana.waitFor((s) => s.players.length === 2);
    ana.send({ t: 'start' });
    await ana.waitFor((s) => s.phase === 'choosing');
    expect(ana.snapshot!.deadline).not.toBeNull();
    expect(ana.snapshot!.deadline! - ana.snapshot!.now).toBeLessThanOrEqual(1000);
    ana.send({ t: 'choose', choice: 'steal' });
    // Ben never answers.
    const reveal = await ben.waitFor((s) => s.phase === 'reveal', 'timer resolved the job', 10_000);
    expect(reveal.history[0]?.timedOut).toEqual([ben.id]);
    expect(reveal.history[0]?.choices).toEqual({ [ana.id]: 'steal', [ben.id]: 'collect' });
    expect(reveal.history[0]?.outcome).toBe('doublecross');
    const timeoutEvent = ben.messages.find((m) => m.t === 'event' && m.event.kind === 'timeout');
    expect(timeoutEvent).toBeTruthy();
    await Promise.all([ana.close(), ben.close()]);
  });

  it('lets a dropped client reconnect to the same seat with its secret choice intact', async () => {
    const code = await createRoom(server.base, { timerSeconds: 0, revealSeconds: 0 });
    const ana = await new TestClient(server.base, code, 'Ana').connect();
    await ana.waitFor((s) => s.players.length === 1);
    const ben = await new TestClient(server.base, code, 'Ben').connect();
    await ana.waitFor((s) => s.players.length === 2);
    ana.send({ t: 'start' });
    await Promise.all([ana.waitFor((s) => s.phase === 'choosing'), ben.waitFor((s) => s.phase === 'choosing')]);
    ana.send({ t: 'choose', choice: 'steal' });
    await ana.waitFor((s) => s.me?.choice === 'steal');
    await ana.close();
    await ben.waitFor((s) => !s.players.find((p) => p.id === ana.id)!.connected, 'Ana offline');
    // Mid-game the host seat moves to a connected human so the table never stalls.
    expect(ben.snapshot!.players.find((p) => p.id === ben.id)!.isHost).toBe(true);

    const anaAgain = await new TestClient(server.base, code, 'Ana', { id: ana.id, secret: ana.secret }).connect();
    const back = await anaAgain.waitFor((s) => s.me?.id === ana.id && s.phase === 'choosing', 'reconnected');
    expect(back.me?.choice).toBe('steal');
    expect(back.me?.role).toBe('player');
    expect(back.players.find((p) => p.id === ana.id)!.connected).toBe(true);
    expect(back.players.find((p) => p.id === ana.id)!.locked).toBe(true);
    await ben.waitFor((s) => s.players.find((p) => p.id === ana.id)!.connected, 'Ana back (seen by Ben)');

    // Somebody else cannot claim Ana's seat with the wrong secret.
    const impostor = await new TestClient(server.base, code, 'Ana', { id: ana.id, secret: rand32() }).connect();
    const bad = await impostor.waitForMessage('error');
    expect(bad.code).toBe('bad_secret');
    await Promise.all([anaAgain.close(), ben.close(), impostor.close()]);
  });

  it('seats AI crew, keeps late arrivals as spectators, and seats them at the rematch', async () => {
    const code = await createRoom(server.base, { timerSeconds: 0, revealSeconds: 0 });
    const ana = await new TestClient(server.base, code, 'Ana').connect();
    await ana.waitFor((s) => s.players.length === 1);
    ana.send({ t: 'addBot', style: 'saint' });
    ana.send({ t: 'addBot', style: 'saint' });
    await ana.waitFor((s) => s.players.length === 3, 'two bots');
    expect(ana.snapshot!.players.filter((p) => p.isBot).map((p) => p.botStyle)).toEqual(['saint', 'saint']);
    expect(new Set(ana.snapshot!.players.map((p) => p.name)).size).toBe(3);

    const summary = (await (await fetch(`${server.base}/api/rooms/${code}`)).json()) as { players: number; phase: string; host: string };
    expect(summary).toMatchObject({ players: 3, phase: 'lobby', host: 'Ana' });

    ana.send({ t: 'start' });
    await ana.waitFor((s) => s.phase === 'choosing' && s.players.filter((p) => p.isBot).every((p) => p.locked), 'bots locked in');

    const late = await new TestClient(server.base, code, 'Late').connect();
    const spec = await late.waitFor((s) => s.me !== null, 'spectator snapshot');
    expect(spec.me?.role).toBe('spectator');
    expect(spec.players.map((p) => p.name)).not.toContain('Late');
    await ana.waitFor((s) => s.spectators === 1, 'spectator counted');

    // The Fixer answers privately and only sees the public record.
    ana.send({ t: 'fixer' });
    const advice = await ana.waitForMessage('fixer');
    expect(advice.advice.round).toBe(1);
    expect(advice.advice.reads.map((r) => r.name).sort()).toEqual(ana.snapshot!.players.filter((p) => p.id !== ana.id).map((p) => p.name).sort());
    // Local env runs the mock language model: the briefing prose is model-authored, the recommendation is the engine's.
    expect(advice.advice.source).toBe('mock');
    expect(advice.advice.headline).toContain('Mock briefing for Ana');
    expect(['collect', 'steal']).toContain(advice.advice.recommendation);
    expect(late.messages.some((m) => m.t === 'fixer')).toBe(false);
    // Asking again returns the cached briefing, not a second model call.
    ana.send({ t: 'fixer' });
    const again = await ana.waitForMessage('fixer', ana.messages.length);
    expect(again.advice).toEqual(advice.advice);

    for (let round = 1; round <= TOTAL_ROUNDS; round++) {
      await ana.waitFor((s) => s.phase === 'choosing' && s.round === round);
      ana.send({ t: 'choose', choice: 'collect' });
      await ana.waitFor((s) => s.phase === 'reveal' && s.round === round);
      // Saints never steal, so with Ana collecting every job is clean and the pot splits three ways.
      expect(ana.snapshot!.history[round - 1]!.outcome).toBe('clean');
      ana.send({ t: 'next' });
    }
    await ana.waitFor((s) => s.phase === 'finished');
    expect(ana.snapshot!.players.every((p) => p.score === 1920 / 3)).toBe(true);
    expect(ana.snapshot!.winners.sort()).toEqual(ana.snapshot!.players.map((p) => p.id).sort());

    // Ana is the only human, so her vote alone starts game two, and the spectator gets a seat.
    ana.send({ t: 'rematch', vote: true });
    await late.waitFor((s) => s.gameNumber === 2 && s.me?.role === 'player', 'spectator seated for game 2');
    expect(late.snapshot!.players.map((p) => p.name)).toContain('Late');
    expect(late.snapshot!.players).toHaveLength(4);
    await Promise.all([ana.close(), late.close()]);
  });

  it('rejects malformed and out-of-schema messages without touching the game', async () => {
    const code = await createRoom(server.base, { timerSeconds: 0, revealSeconds: 0 });
    const ana = await new TestClient(server.base, code, 'Ana').connect();
    await ana.waitFor((s) => s.players.length === 1);
    const before = ana.messages.length;
    ana.send({ t: 'choose', choice: 'maybe' } as never);
    const e1 = await ana.waitForMessage('error', before);
    expect(e1.code).toBe('bad_message');
    expect(e1.message).toContain('choice');
    ana.send({ t: 'teleport' } as never);
    const e2 = await ana.waitForMessage('error', before + 1);
    expect(e2.code).toBe('bad_message');
    ana.send({ t: 'settings', patch: { timerSeconds: 10_000 } } as never);
    const e3 = await ana.waitForMessage('error', before + 2);
    expect(e3.code).toBe('bad_message');
    expect(ana.snapshot!.settings.timerSeconds).toBe(0);
    // Smuggled fields are stripped: the server still uses the socket's identity, not the payload's.
    ana.send({ t: 'rename', name: 'Ana Prime', playerId: 'someone-else' } as never);
    await ana.waitFor((s) => s.players[0]!.name === 'Ana Prime', 'rename applied to self');
    expect(ana.snapshot!.players).toHaveLength(1);
    await ana.close();
  });

  it('serves the room page for any /r/:code link and the public directory lists public lobbies', async () => {
    const page = await fetch(`${server.base}/r/ABCDE`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>Salvage Rights</title>');
    const deep = await fetch(`${server.base}/some/other/path`);
    expect(deep.status).toBe(200); // SPA fallback; the router renders its own not-found page
    const api404 = await fetch(`${server.base}/api/nope`);
    expect(api404.status).toBe(404);
    const missing = await fetch(`${server.base}/api/rooms/ZZZZZ`);
    expect(missing.status).toBe(404);

    const code = await createRoom(server.base, { timerSeconds: 0, revealSeconds: 0, isPublic: true });
    const host = await new TestClient(server.base, code, 'Host').connect();
    await host.waitFor((s) => s.players.length === 1);
    await new Promise((r) => setTimeout(r, 300));
    const dir = (await (await fetch(`${server.base}/api/directory`)).json()) as { rooms: Array<{ code: string; host: string; players: number }> };
    expect(dir.rooms.find((r) => r.code === code)).toMatchObject({ host: 'Host', players: 1 });
    host.send({ t: 'settings', patch: { isPublic: false } });
    await host.waitFor((s) => !s.settings.isPublic);
    await new Promise((r) => setTimeout(r, 300));
    const dir2 = (await (await fetch(`${server.base}/api/directory`)).json()) as { rooms: Array<{ code: string }> };
    expect(dir2.rooms.find((r) => r.code === code)).toBeUndefined();
    await host.close();
  });
});

async function waitForStats(base: string, playerId: string, ready: (s: { games: number }) => boolean) {
  const t0 = Date.now();
  for (;;) {
    const res = (await (await fetch(`${base}/api/players/${playerId}/stats`)).json()) as { enabled: boolean; stats: { games: number; wins: number; bestScore: number; name: string; playerId: string } | null };
    if (res.stats && ready(res.stats)) return res.stats;
    if (Date.now() - t0 > 5000) throw new Error(`stats for ${playerId} not recorded in time: ${JSON.stringify(res)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

function rand32(): string {
  return Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
}
