import { describe, expect, it } from 'vitest';
import { BASE_TAKES, MAX_PLAYERS, MIN_PLAYERS, resolveChoices, type Choice, type Outcome } from '../src';

/**
 * Every possible secret-choice vector for every crew size:
 *   2 players:  4
 *   3 players:  8
 *   4 players: 16
 *   5 players: 32
 *   6 players: 64
 *               = 124
 */
export function allChoiceVectors(): Choice[][] {
  const out: Choice[][] = [];
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    for (let mask = 0; mask < 1 << n; mask++) {
      const v: Choice[] = [];
      for (let i = 0; i < n; i++) v.push(mask & (1 << i) ? 'steal' : 'collect');
      out.push(v);
    }
  }
  return out;
}

const VECTORS = allChoiceVectors();
const POTS = [...new Set([...BASE_TAKES, 60, 61, 119, 240 + 120, 480 + 360, 1, 0, 7, 1000])];

function expected(pot: number, choices: Choice[]): { outcome: Outcome; deltas: number[]; carryOut: number } {
  const n = choices.length;
  const s = choices.filter((c) => c === 'steal').length;
  if (s === 0) {
    const share = Math.floor(pot / n);
    return { outcome: 'clean', deltas: choices.map(() => share), carryOut: pot - n * share };
  }
  if (s === 1) return { outcome: 'doublecross', deltas: choices.map((c) => (c === 'steal' ? pot : 0)), carryOut: 0 };
  if (s < n) {
    const fair = Math.floor(pot / n);
    return { outcome: 'scramble', deltas: choices.map((c) => (c === 'steal' ? 0 : fair)), carryOut: pot - (n - s) * fair };
  }
  const penalty = Math.floor(pot / n);
  return { outcome: 'standoff', deltas: choices.map(() => -penalty), carryOut: pot };
}

describe('all 124 player-choice combinations', () => {
  it('enumerates exactly 124 vectors (4 + 8 + 16 + 32 + 64)', () => {
    expect(VECTORS).toHaveLength(124);
    const byLength = VECTORS.reduce<Record<number, number>>((acc, v) => ({ ...acc, [v.length]: (acc[v.length] ?? 0) + 1 }), {});
    expect(byLength).toEqual({ 2: 4, 3: 8, 4: 16, 5: 32, 6: 64 });
    expect(new Set(VECTORS.map((v) => v.join(','))).size).toBe(124);
  });

  describe.each(VECTORS.map((v) => [v.join(''), v] as const))('vector %s', (_label, choices) => {
    const n = choices.length;
    const s = choices.filter((c) => c === 'steal').length;

    it('matches the normative payout table for every take', () => {
      for (const pot of POTS) {
        expect(resolveChoices(pot, choices)).toEqual({ ...expected(pot, choices), stealers: s });
      }
    });

    it('classifies the outcome by stealer count', () => {
      const { outcome } = resolveChoices(120, choices);
      if (s === 0) expect(outcome).toBe('clean');
      else if (s === 1) expect(outcome).toBe('doublecross');
      else if (s < n) expect(outcome).toBe('scramble');
      else expect(outcome).toBe('standoff');
    });

    it('conserves value: payouts + carry-over == take (outside a standoff)', () => {
      for (const pot of POTS) {
        const r = resolveChoices(pot, choices);
        const paid = r.deltas.reduce((a, b) => a + b, 0);
        if (r.outcome === 'standoff') {
          expect(paid).toBeLessThanOrEqual(0);
          expect(r.carryOut).toBe(pot);
        } else {
          expect(paid + r.carryOut).toBe(pot);
          expect(r.carryOut).toBeGreaterThanOrEqual(0);
          expect(r.carryOut).toBeLessThanOrEqual(pot);
        }
      }
    });

    it('pays stealers only when exactly one steals, and never takes a collector below their fair cut except to a lone stealer', () => {
      const r = resolveChoices(360, choices);
      const fair = Math.floor(360 / n);
      const stealerDeltas = r.deltas.filter((_, i) => choices[i] === 'steal');
      const collectorDeltas = r.deltas.filter((_, i) => choices[i] === 'collect');
      if (s === 1) {
        expect(stealerDeltas).toEqual([360]);
        for (const d of collectorDeltas) expect(d).toBe(0);
      }
      if (s >= 2 && s < n) {
        for (const d of stealerDeltas) expect(d).toBe(0);
        for (const d of collectorDeltas) expect(d).toBe(fair);
      }
      expect(new Set(stealerDeltas).size).toBeLessThanOrEqual(1);
      expect(new Set(collectorDeltas).size).toBeLessThanOrEqual(1);
      if (s === 0) expect(new Set(r.deltas).size).toBe(1);
    });

    it('has no dominant strategy: stealing beats collecting only when nobody else steals', () => {
      // For every seat, compare its payoff for steal vs collect holding the others fixed.
      for (let i = 0; i < n; i++) {
        const othersSteal = choices.filter((c, j) => j !== i && c === 'steal').length;
        const asSteal = [...choices];
        asSteal[i] = 'steal';
        const asCollect = [...choices];
        asCollect[i] = 'collect';
        const stealPay = resolveChoices(360, asSteal).deltas[i]!;
        const collectPay = resolveChoices(360, asCollect).deltas[i]!;
        if (othersSteal === 0) expect(stealPay).toBeGreaterThan(collectPay);
        else if (othersSteal === 1 && n > 2) expect(stealPay).toBe(collectPay); // either way you get nothing
        else expect(stealPay).toBeLessThan(collectPay);
      }
    });

    it('is invariant under permutation of seats', () => {
      const r = resolveChoices(240, choices);
      const reversed = [...choices].reverse();
      const rr = resolveChoices(240, reversed);
      expect(rr.outcome).toBe(r.outcome);
      expect(rr.carryOut).toBe(r.carryOut);
      expect([...rr.deltas].reverse()).toEqual(r.deltas);
    });

    it('is deterministic', () => {
      expect(resolveChoices(180, choices)).toEqual(resolveChoices(180, choices));
    });
  });

  it('golden table for a 120 take', () => {
    expect(resolveChoices(120, ['collect', 'collect'])).toMatchObject({ outcome: 'clean', deltas: [60, 60], carryOut: 0 });
    expect(resolveChoices(120, ['steal', 'collect'])).toMatchObject({ outcome: 'doublecross', deltas: [120, 0], carryOut: 0 });
    expect(resolveChoices(120, ['steal', 'steal'])).toMatchObject({ outcome: 'standoff', deltas: [-60, -60], carryOut: 120 });

    expect(resolveChoices(120, ['collect', 'collect', 'collect'])).toMatchObject({ deltas: [40, 40, 40], carryOut: 0 });
    expect(resolveChoices(120, ['steal', 'steal', 'collect'])).toMatchObject({ outcome: 'scramble', deltas: [0, 0, 40], carryOut: 80 });
    expect(resolveChoices(120, ['steal', 'steal', 'steal'])).toMatchObject({ outcome: 'standoff', deltas: [-40, -40, -40], carryOut: 120 });

    expect(resolveChoices(120, ['collect', 'steal', 'steal', 'steal'])).toMatchObject({ deltas: [30, 0, 0, 0], carryOut: 90 });
    expect(resolveChoices(120, ['collect', 'collect', 'steal', 'steal'])).toMatchObject({ deltas: [30, 30, 0, 0], carryOut: 60 });
    expect(resolveChoices(120, ['steal', 'steal', 'steal', 'steal', 'collect'])).toMatchObject({ deltas: [0, 0, 0, 0, 24], carryOut: 96 });
    expect(resolveChoices(120, ['steal', 'steal', 'steal', 'steal', 'steal', 'collect'])).toMatchObject({
      deltas: [0, 0, 0, 0, 0, 20],
      carryOut: 100,
    });
    expect(resolveChoices(120, Array<Choice>(6).fill('collect'))).toMatchObject({ deltas: [20, 20, 20, 20, 20, 20], carryOut: 0 });
    expect(resolveChoices(120, Array<Choice>(6).fill('steal'))).toMatchObject({ deltas: Array(6).fill(-20), carryOut: 120 });
  });

  it('every base take splits evenly for every crew size', () => {
    for (const pot of BASE_TAKES) for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) expect(pot % n).toBe(0);
  });

  it('rejects crews outside 2..6 and malformed input', () => {
    expect(() => resolveChoices(120, ['collect'])).toThrow(RangeError);
    expect(() => resolveChoices(120, Array<Choice>(7).fill('collect'))).toThrow(RangeError);
    expect(() => resolveChoices(-1, ['collect', 'collect'])).toThrow(RangeError);
    expect(() => resolveChoices(12.5, ['collect', 'collect'])).toThrow(RangeError);
    expect(() => resolveChoices(120, ['collect', 'maybe' as Choice])).toThrow(RangeError);
  });
});
