import { currentPot, rankPlayers } from './game';
import { rngFor } from './random';
import { TOTAL_ROUNDS, type Choice, type FixerAdvice, type FixerRead, type GameState, type RoundResult } from './types';

/**
 * The Broker (the private advisor), version 2.
 *
 * The first version gave every player the same deterministic order, so a crew that listened
 * to it stood off on every job. This one reasons from the actual payout structure:
 *
 *   steal EV   = P · Pr(nobody else steals) − fair · Pr(everyone else steals)
 *   collect EV = fair · (1 − Pr(exactly one other steals))
 *
 * Opponent steal rates blend what the ledger shows with the table's symmetric mixed
 * equilibrium (what a sensible player at a table this size steals with), weighted by how much
 * history there is. The edge between the two EVs becomes a steal *probability*, and the actual
 * recommendation is sampled from it with a per-player, per-job seed: stable if you ask twice,
 * different from seat to seat, impossible to turn into a table-wide standoff.
 */

/** Steal probability at which stealing and collecting pay the same when everyone plays it. */
export function equilibriumStealRate(n: number): number {
  if (n < 2) return 0;
  const f = (p: number) => {
    const k = n - 1;
    const none = Math.pow(1 - p, k);
    const one = k * p * Math.pow(1 - p, k - 1);
    const all = Math.pow(p, k);
    // n·Pr(none) − Pr(all) − (1 − Pr(one)) == 0 at equilibrium (divide both sides by fair = P/n)
    return n * none - all - (1 - one);
  };
  let lo = 0.01;
  let hi = 0.99;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 1000) / 1000;
}

function observed(state: GameState, playerId: string): { steals: number; rounds: number } {
  let steals = 0;
  let rounds = 0;
  for (const r of state.history) {
    const c = r.choices[playerId];
    if (!c) continue;
    rounds++;
    if (c === 'steal') steals++;
  }
  return { steals, rounds };
}

interface TableOdds {
  none: number;
  one: number;
  all: number;
}

/** Probabilities over the other players' choices given independent steal rates. */
function tableOdds(rates: number[]): TableOdds {
  let none = 1;
  let all = 1;
  for (const r of rates) {
    none *= 1 - r;
    all *= r;
  }
  let one = 0;
  rates.forEach((r, i) => {
    let rest = 1;
    rates.forEach((q, j) => {
      if (j !== i) rest *= 1 - q;
    });
    one += r * rest;
  });
  return { none, one, all };
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function heuristicFixer(state: GameState, playerId: string): FixerAdvice {
  const me = state.players.find((p) => p.id === playerId);
  if (!me) throw new Error('heuristicFixer: unknown player');
  const others = state.players.filter((p) => p.id !== playerId);
  const n = state.players.length;
  const pot = currentPot(state);
  const fair = Math.floor(pot / n);
  const round = state.round;
  const roundsLeft = TOTAL_ROUNDS - round + 1;
  const isLast = round === TOTAL_ROUNDS;
  const eq = equilibriumStealRate(n);
  const played = state.history.length;

  const reads: FixerRead[] = others.map((p) => {
    const { steals, rounds } = observed(state, p.id);
    const last = state.history[played - 1]?.choices[p.id] ?? null;
    const lastTwo = state.history.slice(-2).map((r) => r.choices[p.id]);
    const raw = rounds ? steals / rounds : eq;
    const weight = rounds / (rounds + 2);
    const rate = weight * raw + (1 - weight) * eq;
    let note: string;
    if (rounds === 0) note = p.isBot ? 'Unknown quantity. New to the crew.' : 'No record yet. Watch their thrusters.';
    else if (steals === 0) note = rounds >= 3 ? `Clean ${rounds} for ${rounds}. A lifer, or waiting for a bigger haul.` : 'Clean so far.';
    else if (lastTwo.length === 2 && lastTwo.every((c) => c === 'steal')) note = 'Jumped the last two claims. Expect a third.';
    else if (last === 'steal') note = 'Just jumped a claim. Some lie low after that, some get a taste for it.';
    else if (raw >= 0.5) note = `Jumps claims about half the time (${steals}/${rounds}).`;
    else note = `Jumped ${steals} of ${rounds}. Scavenger pattern.`;
    return { playerId: p.id, name: p.name, stealRate: Math.round(rate * 100) / 100, steals, rounds, lastChoice: last, note };
  });

  const odds = tableOdds(reads.map((r) => r.stealRate));
  const stealEV = pot * odds.none - fair * odds.all;
  const collectEV = fair * (1 - odds.one);
  const edge = pot > 0 ? (stealEV - collectEV) / pot : 0;

  const reasoning: string[] = [];
  let p = Math.min(0.9, Math.max(0.1, 0.5 + 1.6 * edge));

  reasoning.push(
    `Haul ${pot}: a fair share is ${fair}, a lone steal is the lot. Chance nobody else steals: ${pct(odds.none)}. Chance exactly one does and your share is zero: ${pct(odds.one)}.`,
  );
  if (played === 0) {
    reasoning.push(`No manifest yet. In a crew of ${n}, stealing pays roughly ${pct(eq)} of the time if everyone is sharp, so I weight the dice that way.`);
  } else if (edge > 0.08) {
    reasoning.push('The crew reads quiet enough that a steal is worth more than the share.');
  } else if (edge < -0.08) {
    reasoning.push('Too many itchy thrusters: two stealers collide and the collectors get paid anyway.');
  } else {
    reasoning.push('Close call. Either play is defensible; the dice decide so the whole crew does not get the same tip.');
  }

  const ranked = rankPlayers(state.players);
  const myRank = ranked.findIndex((q) => q.id === playerId) + 1;
  const leader = ranked[0]!;
  const runnerUp = ranked[1];
  const deficit = leader.score - me.score;
  if (myRank > 1 && roundsLeft <= 3 && deficit > fair * roundsLeft) {
    p = Math.min(0.9, p + 0.2);
    reasoning.push(`You are ${deficit} behind ${leader.name} with ${roundsLeft} haul${roundsLeft === 1 ? '' : 's'} left. Collecting cannot close that; only a lone steal can.`);
  } else if (myRank === 1 && roundsLeft <= 3 && runnerUp && me.score - runnerUp.score > pot) {
    p = Math.max(0.1, p - 0.25);
    reasoning.push('You lead by more than the haul. Protect it: a collision costs you nothing, a standoff costs you the lead.');
  }

  const lastResult: RoundResult | undefined = state.history[played - 1];
  if (lastResult?.outcome === 'standoff') {
    reasoning.push(`Last haul was a standoff and ${lastResult.pot} is still drifting. Crews usually flinch after one; that favours the one who does not.`);
    p = Math.min(0.9, p + 0.05);
  }
  if (lastResult?.outcome === 'scramble') {
    reasoning.push('After a collision the stealers tend to sit one out. Watch for it.');
  }
  if (isLast) reasoning.push('Final haul: no reputation left to protect, and everyone in the crew knows it.');
  if (me.steals === 0 && round >= 4) reasoning.push('Your own record is spotless. Nobody is bracing for you.');

  const roll = rngFor(state.seed, 'fixer', state.gameNumber, round, playerId)();
  const recommendation: Choice = roll < p ? 'steal' : 'collect';
  const confidence = Math.round(Math.min(0.9, Math.max(0.5, 0.5 + Math.abs(p - 0.5) * 0.8)) * 100) / 100;

  return {
    round,
    recommendation,
    confidence,
    headline: headline(recommendation, p, isLast, odds),
    reasoning,
    reads,
    source: 'heuristic',
  };
}

function headline(rec: Choice, p: number, isLast: boolean, odds: TableOdds): string {
  if (rec === 'steal') {
    if (isLast) return 'Last haul. Tow it before they do.';
    if (p >= 0.7) return 'Nobody is tracking the pod. Steal.';
    return 'The window is open a crack. Steal, and do not blink.';
  }
  if (odds.one > 0.45) return 'Someone is going to fire. Let them collide.';
  if (p <= 0.3) return 'Keep your thrusters cold this one.';
  return 'Take the sure share. Collect.';
}

/** Compact, non-secret description of the table for a language model. */
export function describeTableForModel(state: GameState, playerId: string): string {
  const me = state.players.find((p) => p.id === playerId)!;
  const lines: string[] = [];
  lines.push(`Game: Salvage Rights. ${state.players.length} players, ${TOTAL_ROUNDS} jobs. Now job ${state.round} (${state.history.length} played).`);
  lines.push(`Cargo on this haul: ${currentPot(state)} (drifting from last time: ${state.carry}).`);
  lines.push(
    'Rules: nobody steals -> everyone gets an even cut. Exactly one steals -> they take everything. Two or more steal (not all) -> stealers get nothing, collectors keep their cut, the rest rolls over. Everyone steals -> everyone loses a cut and the take rolls over.',
  );
  lines.push(`Scores: ${rankPlayers(state.players).map((p) => `${p.name}${p.id === playerId ? ' (you)' : ''}=${p.score} (${p.steals} steals)`).join(', ')}.`);
  for (const r of state.history) {
    const parts = state.players.map((p) => `${p.name}:${r.choices[p.id] === 'steal' ? 'S' : 'C'}`).join(' ');
    lines.push(`Haul ${r.round} cargo ${r.pot} -> ${r.outcome.toUpperCase()} [${parts}]`);
  }
  lines.push(`You are ${me.name}. You have stolen ${me.steals} time(s).`);
  return lines.join('\n');
}
