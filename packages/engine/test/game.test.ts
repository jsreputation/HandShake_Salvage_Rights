import { describe, expect, it } from 'vitest';
import {
  BASE_TAKES,
  GameError,
  TOTAL_ROUNDS,
  addPlayer,
  advance,
  allLocked,
  computeWinners,
  createRoom,
  currentPot,
  decideBot,
  ensureHost,
  equilibriumStealRate,
  heuristicFixer,
  nextBotIdentity,
  removePlayer,
  rematchReady,
  resetForRematch,
  resolveRound,
  setConnected,
  snapshotFor,
  startGame,
  submitChoice,
  templateReport,
  updateSettings,
  voteRematch,
  type Choice,
  type GameState,
} from '../src';

const T0 = 1_700_000_000_000;

function table(names: string[], settings = {}): GameState {
  let s = createRoom('TEST1', 'seed', settings, T0);
  names.forEach((n, i) => (s = addPlayer(s, { id: `p${i}`, name: n }, T0 + i)));
  return s;
}

function playRound(state: GameState, choices: Record<string, Choice>, now = T0): GameState {
  let s = state;
  for (const [id, c] of Object.entries(choices)) s = submitChoice(s, id, c, now);
  s = resolveRound(s, now);
  return advance(s, now);
}

describe('lobby', () => {
  it('seats players, assigns the first human as host, dedupes names', () => {
    let s = table(['Ana', 'ana']);
    expect(s.players.map((p) => p.name)).toEqual(['Ana', 'ana2']);
    expect(s.hostId).toBe('p0');
    s = addPlayer(s, { id: 'b1', name: 'Raven', isBot: true, botStyle: 'saint' });
    expect(s.players).toHaveLength(3);
    expect(s.players[2]?.isBot).toBe(true);
  });

  it('refuses a 7th player and a start with fewer than 2', () => {
    const s = table(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(() => addPlayer(s, { id: 'g', name: 'g' })).toThrow(GameError);
    expect(() => startGame(table(['solo']))).toThrow(/at least 2/);
  });

  it('migrates host when the host leaves or disconnects', () => {
    let s = table(['host', 'other']);
    s = setConnected(s, 'p0', false);
    expect(s.hostId).toBe('p0'); // flag only; migration is explicit
    s = ensureHost(s);
    expect(s.hostId).toBe('p1');
    s = removePlayer(s, 'p1');
    expect(s.hostId).toBe('p0');
    // A bot is never host, even if it is the only connected seat.
    s = addPlayer(s, { id: 'b', name: 'Bot', isBot: true, botStyle: 'saint' });
    expect(ensureHost(s).hostId).toBe('p0');
  });

  it('sanitizes names and settings', () => {
    const s = addPlayer(createRoom('X', 'y'), { id: 'a', name: '   \u0000 A very long name indeed yes   ' });
    expect(s.players[0]?.name).toBe('A very long name');
    const s2 = updateSettings(s, { timerSeconds: 9999, revealSeconds: -5, isPublic: 1 as unknown as boolean });
    expect(s2.settings).toEqual({ timerSeconds: 180, revealSeconds: 0, isPublic: true });
  });
});

describe('a full eight-round game', () => {
  it('plays through to a winner with the expected totals', () => {
    let s = startGame(table(['Ana', 'Ben', 'Cal'], { timerSeconds: 0 }), T0);
    expect(s.phase).toBe('choosing');
    expect(s.round).toBe(1);
    expect(currentPot(s)).toBe(120);

    // Job 1: clean  -> 40 each
    s = playRound(s, { p0: 'collect', p1: 'collect', p2: 'collect' });
    expect(s.players.map((p) => p.score)).toEqual([40, 40, 40]);
    // Job 2: Ben salvage-rightses -> +120
    s = playRound(s, { p0: 'collect', p1: 'steal', p2: 'collect' });
    expect(s.players.map((p) => p.score)).toEqual([40, 160, 40]);
    // Job 3: Ana & Cal scramble on 180 -> stealers 0, Ben keeps his 60 cut, 120 carries
    s = playRound(s, { p0: 'steal', p1: 'collect', p2: 'steal' });
    expect(s.players.map((p) => p.score)).toEqual([40, 220, 40]);
    expect(s.carry).toBe(120);
    expect(currentPot(s)).toBe(180 + 120);
    // Job 4: standoff on 300 -> -100 each, 300 carries
    s = playRound(s, { p0: 'steal', p1: 'steal', p2: 'steal' });
    expect(s.players.map((p) => p.score)).toEqual([-60, 120, -60]);
    expect(currentPot(s)).toBe(240 + 300);
    // Job 5: clean on 540 -> 180 each
    s = playRound(s, { p0: 'collect', p1: 'collect', p2: 'collect' });
    expect(s.players.map((p) => p.score)).toEqual([120, 300, 120]);
    expect(s.carry).toBe(0);
    // Job 6: Cal steals 240
    s = playRound(s, { p0: 'collect', p1: 'collect', p2: 'steal' });
    // Job 7: clean 360 -> 120 each
    s = playRound(s, { p0: 'collect', p1: 'collect', p2: 'collect' });
    expect(s.players.map((p) => p.score)).toEqual([240, 420, 480]);
    // Job 8: Ana steals 480
    expect(s.round).toBe(8);
    s = playRound(s, { p0: 'steal', p1: 'collect', p2: 'collect' });

    expect(s.phase).toBe('finished');
    expect(s.history).toHaveLength(TOTAL_ROUNDS);
    expect(s.players.map((p) => p.score)).toEqual([720, 420, 480]);
    expect(s.winners).toEqual(['p0']);
    expect(s.series).toEqual({ p0: 1 });
    expect(s.players.map((p) => p.steals)).toEqual([3, 2, 3]);
    expect(templateReport(s)).toContain('Ana holds the salvage rights with 720');
  });

  it('burns carry-over after the final job', () => {
    let s = startGame(table(['a', 'b'], { timerSeconds: 0 }));
    for (let r = 1; r < TOTAL_ROUNDS; r++) s = playRound(s, { p0: 'collect', p1: 'collect' });
    s = submitChoice(s, 'p0', 'steal');
    s = submitChoice(s, 'p1', 'steal');
    s = resolveRound(s);
    expect(s.history[7]?.outcome).toBe('standoff');
    expect(s.history[7]?.carryOut).toBe(0);
    expect(s.carry).toBe(0);
    s = advance(s);
    expect(s.phase).toBe('finished');
  });

  it('defaults missing choices to COLLECT and flags the timeout', () => {
    let s = startGame(table(['a', 'b', 'c']));
    s = submitChoice(s, 'p1', 'steal');
    s = resolveRound(s);
    expect(s.history[0]?.timedOut).toEqual(['p0', 'p2']);
    expect(s.history[0]?.choices).toEqual({ p0: 'collect', p1: 'steal', p2: 'collect' });
    expect(s.history[0]?.outcome).toBe('doublecross');
  });

  it('locks a choice once submitted and rejects choices outside the choosing phase', () => {
    let s = startGame(table(['a', 'b']));
    s = submitChoice(s, 'p0', 'collect');
    expect(() => submitChoice(s, 'p0', 'steal')).toThrow(/locked/);
    expect(allLocked(s)).toBe(false);
    s = submitChoice(s, 'p1', 'steal');
    expect(allLocked(s)).toBe(true);
    s = resolveRound(s);
    expect(() => submitChoice(s, 'p0', 'steal')).toThrow(/not open/);
  });

  it('sets deadlines from settings', () => {
    const s = startGame(table(['a', 'b'], { timerSeconds: 30, revealSeconds: 5 }), T0);
    expect(s.deadline).toBe(T0 + 30_000);
    const r = resolveRound(submitChoice(submitChoice(s, 'p0', 'collect'), 'p1', 'collect'), T0 + 1000);
    expect(r.deadline).toBe(T0 + 6000);
    const noTimer = startGame(table(['a', 'b'], { timerSeconds: 0, revealSeconds: 0 }), T0);
    expect(noTimer.deadline).toBeNull();
  });
});

describe('ranking and ties', () => {
  it('breaks score ties by fewer steals, otherwise shares the win', () => {
    let s = startGame(table(['a', 'b', 'c'], { timerSeconds: 0 }));
    // a and b both end on the same score; a steals less.
    s = playRound(s, { p0: 'collect', p1: 'collect', p2: 'collect' }); // 40 each
    s = playRound(s, { p0: 'collect', p1: 'steal', p2: 'collect' }); // b +120 -> 160
    s = playRound(s, { p0: 'steal', p1: 'collect', p2: 'collect' }); // a +180 -> 220
    s = playRound(s, { p0: 'collect', p1: 'collect', p2: 'collect' }); // +60 -> a 280, b 220, c 100
    s = playRound(s, { p0: 'collect', p1: 'collect', p2: 'collect' }); // +80 -> a 360, b 300, c 180
    s = playRound(s, { p0: 'collect', p1: 'collect', p2: 'collect' }); // +80 -> a 440, b 380, c 260
    s = playRound(s, { p0: 'collect', p1: 'steal', p2: 'steal' }); // scramble 360: a keeps 120, b and c get nothing; 240 carries
    // final: 480 + 240 clean -> +240 -> a 800, b 620, c 500
    s = playRound(s, { p0: 'collect', p1: 'collect', p2: 'collect' });
    expect(s.players.map((p) => p.score)).toEqual([800, 620, 500]);
    expect(s.winners).toEqual(['p0']);

    const tied = computeWinners([
      { ...s.players[0]!, score: 500, steals: 1 },
      { ...s.players[1]!, score: 500, steals: 2 },
      { ...s.players[2]!, score: 500, steals: 1 },
    ]);
    expect(tied).toEqual(['p0', 'p2']);
  });
});

describe('rematch', () => {
  it('requires every connected human to vote, then resets scores and keeps the series', () => {
    let s = startGame(table(['a', 'b'], { timerSeconds: 0 }));
    s = addPlayerMidwayIsRejected(s);
    for (let r = 1; r <= TOTAL_ROUNDS; r++) s = playRound(s, { p0: 'steal', p1: 'collect' });
    expect(s.phase).toBe('finished');
    expect(s.winners).toEqual(['p0']);
    expect(rematchReady(s)).toBe(false);
    s = voteRematch(s, 'p0', true);
    expect(rematchReady(s)).toBe(false);
    s = voteRematch(s, 'p1', true);
    expect(rematchReady(s)).toBe(true);
    s = resetForRematch(s);
    expect(s.phase).toBe('lobby');
    expect(s.gameNumber).toBe(2);
    expect(s.players.every((p) => p.score === 0 && p.steals === 0 && !p.rematchVote)).toBe(true);
    expect(s.series).toEqual({ p0: 1 });
    s = startGame(s);
    expect(s.round).toBe(1);
    expect(currentPot(s)).toBe(BASE_TAKES[0]);
  });
});

function addPlayerMidwayIsRejected(s: GameState): GameState {
  expect(() => addPlayer(s, { id: 'late', name: 'Late' })).toThrow(/in progress/);
  return s;
}

describe('bots and the Fixer', () => {
  it('bot decisions are deterministic for a given seed', () => {
    let s = table(['Human']);
    const id = nextBotIdentity(s);
    s = addPlayer(s, { id: 'bot', name: id.name, isBot: true, botStyle: 'wildcard' });
    s = startGame(s);
    const bot = s.players.find((p) => p.isBot)!;
    const a = decideBot(s, bot);
    const b = decideBot(s, bot);
    expect(a).toBe(b);
    const other = startGame(addPlayer(addPlayer(createRoom('TEST1', 'different-seed'), { id: 'h', name: 'Human' }), { id: 'bot', name: 'X', isBot: true, botStyle: 'wildcard' }));
    // Over 8 rounds a different seed should produce at least one different coin flip.
    const seqA: Choice[] = [];
    const seqB: Choice[] = [];
    let sa = s;
    let sb = other;
    for (let r = 1; r <= TOTAL_ROUNDS; r++) {
      seqA.push(decideBot(sa, sa.players[1]!));
      seqB.push(decideBot(sb, sb.players[1]!));
      sa = playRound(sa, { p0: 'collect', bot: 'collect' });
      sb = playRound(sb, { h: 'collect', bot: 'collect' });
    }
    expect(seqA).not.toEqual(seqB);
  });

  it('saint never steals; grudge retaliates after being crossed', () => {
    let s = table(['Human']);
    s = addPlayer(s, { id: 'saint', name: 'Saint', isBot: true, botStyle: 'saint' });
    s = addPlayer(s, { id: 'grudge', name: 'Grudge', isBot: true, botStyle: 'grudge' });
    s = startGame(s);
    expect(decideBot(s, s.players[1]!)).toBe('collect');
    expect(decideBot(s, s.players[2]!)).toBe('collect');
    s = playRound(s, { p0: 'steal', saint: 'collect', grudge: 'collect' });
    // After a cross the grudge bot steals with 85% probability; across many seeds it must steal sometimes.
    let retaliations = 0;
    for (let i = 0; i < 40; i++) {
      const variant = { ...s, seed: `seed-${i}` };
      if (decideBot(variant, variant.players[2]!) === 'steal') retaliations++;
      expect(decideBot(variant, variant.players[1]!)).toBe('collect');
    }
    expect(retaliations).toBeGreaterThan(20);
  });

  it('the Fixer only sees public information and gives a recommendation', () => {
    let s = startGame(table(['Me', 'Them', 'Other'], { timerSeconds: 0 }));
    s = playRound(s, { p0: 'collect', p1: 'steal', p2: 'collect' });
    s = playRound(s, { p0: 'collect', p1: 'steal', p2: 'collect' });
    s = submitChoice(s, 'p1', 'steal'); // pending, secret
    const advice = heuristicFixer(s, 'p0');
    expect(['collect', 'steal']).toContain(advice.recommendation);
    expect(advice.confidence).toBeGreaterThanOrEqual(0.5);
    expect(advice.reads.map((r) => r.name)).toEqual(['Them', 'Other']);
    expect(advice.reads[0]?.note).toContain('Jumped the last two');
    expect(JSON.stringify(advice)).not.toContain('"choice"');
    expect(advice.source).toBe('heuristic');
  });

  it('the Fixer never hands the whole table the same order', () => {
    // Fresh tables, no history: the old Fixer told every 2- or 3-player table to steal.
    const standoffs = { 2: 0, 3: 0, 4: 0 } as Record<number, number>;
    const N = 200;
    for (let n = 2; n <= 4; n++) {
      for (let g = 0; g < N; g++) {
        let s = createRoom('X', `seed-${g}`, { timerSeconds: 0 });
        for (let i = 0; i < n; i++) s = addPlayer(s, { id: `p${i}`, name: `P${i}` });
        s = startGame(s);
        const recs = s.players.map((p) => heuristicFixer(s, p.id).recommendation);
        if (recs.every((r) => r === 'steal')) standoffs[n]!++;
      }
    }
    // Everyone-steals should happen about p^n of the time, not always.
    expect(standoffs[2]! / N).toBeLessThan(0.45);
    expect(standoffs[3]! / N).toBeLessThan(0.3);
    expect(standoffs[4]! / N).toBeLessThan(0.2);
  });

  it('the Fixer is stable for the same player and job, and reasons from the equilibrium', () => {
    let s = startGame(table(['a', 'b', 'c']));
    const first = heuristicFixer(s, 'p0');
    const again = heuristicFixer(s, 'p0');
    expect(again.recommendation).toBe(first.recommendation);
    expect(again.headline).toBe(first.headline);
    expect(equilibriumStealRate(2)).toBeCloseTo(0.5, 2);
    expect(equilibriumStealRate(3)).toBeCloseTo(0.5, 2);
    expect(equilibriumStealRate(6)).toBeLessThan(equilibriumStealRate(4));
    // A table of proven saints: the Fixer should lean steal hard.
    for (let r = 1; r <= 4; r++) s = playRound(s, { p0: 'collect', p1: 'collect', p2: 'collect' });
    const vsSaints = heuristicFixer(s, 'p0');
    expect(vsSaints.reads.every((x) => x.stealRate < 0.25)).toBe(true);
    expect(vsSaints.confidence).toBeGreaterThan(0.6);
  });

  it('snapshots never leak another player’s pending choice', () => {
    let s = startGame(table(['a', 'b']));
    s = submitChoice(s, 'p1', 'steal');
    const snap = snapshotFor(s, { viewerId: 'p0' });
    expect(snap.me?.choice).toBeNull();
    expect(snap.players.find((p) => p.id === 'p1')?.locked).toBe(true);
    expect(JSON.stringify(snap)).not.toContain('"steal"');
    const mine = snapshotFor(s, { viewerId: 'p1' });
    expect(mine.me?.choice).toBe('steal');
  });
});
