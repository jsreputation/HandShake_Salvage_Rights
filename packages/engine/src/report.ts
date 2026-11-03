import { rankPlayers } from './game';
import type { GameState } from './types';

/** Deterministic after-action report used when no language model is available. */
export function templateReport(state: GameState): string {
  if (state.phase !== 'finished' || !state.history.length) return '';
  const ranked = rankPlayers(state.players);
  const winners = state.winners.map((id) => state.players.find((p) => p.id === id)?.name ?? '?');
  const outcomes = state.history.reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
    return acc;
  }, {});
  const totalTake = state.history.reduce((a, r) => a + r.base, 0);
  const paidOut = state.history.reduce((a, r) => a + Object.values(r.deltas).reduce((x, y) => x + Math.max(0, y), 0), 0);
  const biggest = [...state.history].sort((a, b) => Math.max(...Object.values(b.deltas)) - Math.max(...Object.values(a.deltas)))[0]!;
  const biggestWinnerId = Object.entries(biggest.deltas).sort((a, b) => b[1] - a[1])[0]![0];
  const biggestWinner = state.players.find((p) => p.id === biggestWinnerId)?.name ?? '?';
  const mostSteals = [...state.players].sort((a, b) => b.steals - a.steals)[0]!;
  const cleanest = [...state.players].sort((a, b) => a.steals - b.steals || b.score - a.score)[0]!;

  const lines: string[] = [];
  lines.push(
    winners.length > 1
      ? `${winners.join(' and ')} share the salvage rights with ${ranked[0]!.score}.`
      : `${winners[0]} holds the salvage rights with ${ranked[0]!.score}.`,
  );
  lines.push(
    `Of ${totalTake} of cargo across eight hauls, ${paidOut} actually made it home: ${outcomes.clean ?? 0} clean split${(outcomes.clean ?? 0) === 1 ? '' : 's'}, ${
      outcomes.doublecross ?? 0
    } jumped claim${(outcomes.doublecross ?? 0) === 1 ? '' : 's'}, ${outcomes.scramble ?? 0} collision${(outcomes.scramble ?? 0) === 1 ? '' : 's'}, ${
      outcomes.standoff ?? 0
    } standoff${(outcomes.standoff ?? 0) === 1 ? '' : 's'}.`,
  );
  lines.push(`Biggest single tow: ${biggestWinner} took ${Math.max(...Object.values(biggest.deltas))} from ${biggest.jobName}.`);
  if (mostSteals.steals > 0) {
    lines.push(`${mostSteals.name} jumped the most claims (${mostSteals.steals} of 8). ${cleanest.name} kept the cleanest record (${cleanest.steals}).`);
  } else {
    lines.push('Nobody jumped a single claim. Suspicious.');
  }
  return lines.join(' ');
}
