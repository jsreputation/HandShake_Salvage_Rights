import { currentPot } from './game';
import { rngFor } from './random';
import { TOTAL_ROUNDS, type BotStyle, type Choice, type GameState, type Player } from './types';

export const BOT_STYLES: readonly BotStyle[] = ['saint', 'opportunist', 'grudge', 'wildcard', 'shark'];

export const BOT_NAMES: readonly string[] = ['Vega', 'Lyra', 'Orion', 'Halcyon', 'Rigel', 'Nova', 'Castor', 'Mira', 'Deneb', 'Cygnus'];

export const BOT_STYLE_INFO: Record<BotStyle, { label: string; blurb: string }> = {
  saint: { label: 'Lifer', blurb: 'Takes the fair share. Every haul. By the book.' },
  opportunist: { label: 'Scavenger', blurb: 'Plays fair until the cargo gets valuable.' },
  grudge: { label: 'Grudge', blurb: 'Fair until someone jumps a claim, then hits back.' },
  wildcard: { label: 'Glitch', blurb: 'Flips a coin. Every haul.' },
  shark: { label: 'Hunter', blurb: 'Reads the crew and strikes when nobody else will.' },
};

/** Steal rate of a player with a Laplace prior so round 1 is not division by zero. */
export function stealRate(state: GameState, playerId: string): number {
  let steals = 0;
  let rounds = 0;
  for (const r of state.history) {
    const c = r.choices[playerId];
    if (!c) continue;
    rounds++;
    if (c === 'steal') steals++;
  }
  return (steals + 0.5) / (rounds + 1.5);
}

function lastRound(state: GameState) {
  return state.history[state.history.length - 1];
}

function stealersLast(state: GameState, excluding: string): number {
  const last = lastRound(state);
  if (!last) return 0;
  return Object.entries(last.choices).filter(([id, c]) => id !== excluding && c === 'steal').length;
}

/** Probability that nobody else steals, treating each opponent's observed rate as independent. */
function chanceAlone(state: GameState, me: string): number {
  return state.players.filter((p) => p.id !== me).reduce((acc, p) => acc * (1 - stealRate(state, p.id)), 1);
}

export function decideBot(state: GameState, bot: Player): Choice {
  const rng = rngFor(state.seed, state.gameNumber, state.round, bot.id);
  const pot = currentPot(state);
  const isLast = state.round === TOTAL_ROUNDS;
  const style = bot.botStyle ?? 'opportunist';
  const roll = rng();

  switch (style) {
    case 'saint':
      return 'collect';

    case 'wildcard':
      return roll < 0.5 ? 'steal' : 'collect';

    case 'grudge': {
      if (state.round === 1) return 'collect';
      const crossed = stealersLast(state, bot.id) > 0;
      if (crossed) return roll < 0.85 ? 'steal' : 'collect';
      return roll < 0.08 ? 'steal' : 'collect';
    }

    case 'opportunist': {
      // Greedy when the take is big, but it has learned that two stealers get nothing.
      const others = stealersLast(state, bot.id);
      if (others >= 1) return roll < 0.1 ? 'steal' : 'collect';
      let p = 0.1;
      if (pot >= 240) p += 0.25;
      if (pot >= 360) p += 0.15;
      if (isLast) p += 0.2;
      return roll < p ? 'steal' : 'collect';
    }

    case 'shark': {
      // Steals when it is likely to be the only one; otherwise cashes the cut.
      const alone = chanceAlone(state, bot.id);
      const ranked = [...state.players].sort((a, b) => b.score - a.score);
      const leader = ranked[0]!;
      const behind = leader.score - bot.score;
      const roundsLeft = TOTAL_ROUNDS - state.round + 1;
      const n = state.players.length;
      let p: number;
      if (alone > 1.6 / n) p = 0.8;
      else if (alone > 1.1 / n) p = 0.5;
      else if (alone > 0.7 / n) p = 0.25;
      else p = 0.05;
      if (behind > pot && roundsLeft <= 3) p += 0.25;
      if (isLast && alone > 1 / n) p += 0.1;
      return roll < Math.min(0.95, p) ? 'steal' : 'collect';
    }
  }
}

/** Pick the next unused bot name and a style, deterministically from the room seed. */
export function nextBotIdentity(state: GameState, requested?: BotStyle): { name: string; style: BotStyle } {
  const used = new Set(state.players.map((p) => p.name));
  const rng = rngFor(state.seed, 'bot', state.players.length);
  const offset = Math.floor(rng() * BOT_NAMES.length);
  let name = BOT_NAMES[offset]!;
  for (let i = 0; i < BOT_NAMES.length; i++) {
    const candidate = BOT_NAMES[(offset + i) % BOT_NAMES.length]!;
    if (!used.has(candidate)) {
      name = candidate;
      break;
    }
  }
  const style = requested && BOT_STYLES.includes(requested) ? requested : BOT_STYLES[Math.floor(rng() * BOT_STYLES.length)]!;
  return { name, style };
}
