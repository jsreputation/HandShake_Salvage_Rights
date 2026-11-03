import { BASE_TAKES, JOB_NAMES, MAX_PLAYERS, MIN_PLAYERS, type Choice, type Outcome } from './types';

export interface Resolution {
  outcome: Outcome;
  /** Score delta per player, in the same order as the input choices. */
  deltas: number[];
  /** Value left in the vault for the next job. */
  carryOut: number;
  stealers: number;
}

/**
 * The normative payout function. Pure, total and deterministic.
 *
 * n = players, s = stealers, c = n − s collectors, P = take, fair = ⌊P/n⌋:
 *   s = 0       CLEAN        everyone   +fair              carry = P − n·fair
 *   s = 1       DOUBLE CROSS stealer    +P, collectors 0   carry = 0
 *   2 ≤ s < n   SCRAMBLE     stealers   0, collectors +fair carry = P − c·fair
 *   s = n       STANDOFF     everyone   −fair              carry = P
 *
 * Stealing pays only when you are the only one doing it. With two or more stealers the
 * collectors keep their cut and the stealers' would-be shares stay in the vault, so there is
 * no dominant strategy: the right call depends on reading the table.
 */
export function resolveChoices(pot: number, choices: readonly Choice[]): Resolution {
  const n = choices.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
    throw new RangeError(`resolveChoices: expected ${MIN_PLAYERS}..${MAX_PLAYERS} players, got ${n}`);
  }
  if (!Number.isInteger(pot) || pot < 0) {
    throw new RangeError(`resolveChoices: pot must be a non-negative integer, got ${pot}`);
  }
  for (const c of choices) {
    if (c !== 'collect' && c !== 'steal') throw new RangeError(`resolveChoices: bad choice ${String(c)}`);
  }

  const s = choices.filter((c) => c === 'steal').length;

  if (s === 0) {
    const share = Math.floor(pot / n);
    return { outcome: 'clean', deltas: choices.map(() => share), carryOut: pot - share * n, stealers: 0 };
  }
  if (s === 1) {
    return {
      outcome: 'doublecross',
      deltas: choices.map((c) => (c === 'steal' ? pot : 0)),
      carryOut: 0,
      stealers: 1,
    };
  }
  if (s < n) {
    const fair = Math.floor(pot / n);
    const collectors = n - s;
    return {
      outcome: 'scramble',
      deltas: choices.map((c) => (c === 'steal' ? 0 : fair)),
      carryOut: pot - fair * collectors,
      stealers: s,
    };
  }
  const penalty = Math.floor(pot / n);
  return { outcome: 'standoff', deltas: choices.map(() => -penalty), carryOut: pot, stealers: n };
}

export function baseTake(round: number): number {
  const v = BASE_TAKES[round - 1];
  if (v === undefined) throw new RangeError(`baseTake: no job ${round}`);
  return v;
}

export function jobName(round: number): string {
  return JOB_NAMES[round - 1] ?? `Job ${round}`;
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  clean: 'Clean split',
  doublecross: 'Claim jumped',
  scramble: 'Collision',
  standoff: 'Standoff',
};

/** Deterministic flavour text for a resolved haul. */
export function narrate(
  outcome: Outcome,
  pot: number,
  names: { stealers: string[]; collectors: string[] },
  isLastRound: boolean,
): string {
  const list = (xs: string[]) =>
    xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
  switch (outcome) {
    case 'clean':
      return `Clean split. The crew divides ${pot} and nobody touches the thrusters.`;
    case 'doublecross':
      return `${names.stealers[0]} jumps the claim and tows the whole ${pot} away while the rest watch it go.`;
    case 'scramble':
      return `${list(names.stealers)} fire thrusters at the same time and collide. They come away with nothing; ${
        names.collectors.length === 1 ? `${names.collectors[0]} keeps` : 'the rest of the crew keep'
      } their share, and ${isLastRound ? 'the contested cargo tumbles out of reach' : 'the contested cargo stays drifting for the next haul'}.`;
    case 'standoff':
      return isLastRound
        ? `Everyone fires at once. Nobody holds the ${pot}. The crew burns fuel for nothing.`
        : `Everyone fires at once. The whole ${pot} is left drifting, and it is still there at the next haul.`;
  }
}
