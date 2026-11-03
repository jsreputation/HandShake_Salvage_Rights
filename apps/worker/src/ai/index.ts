import { describeTableForModel, heuristicFixer, rankPlayers, templateReport, type FixerAdvice, type GameState } from '@salvage-rights/engine';
import { createModel, type LanguageModel, type ModelEnv } from './provider';

export { createModel, type LanguageModel, type ModelEnv } from './provider';

const FIXER_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'At most ten words, in character.' },
    reasoning: { type: 'array', items: { type: 'string' }, description: 'Two to four short sentences, each under 25 words, naming players.' },
  },
  required: ['headline', 'reasoning'],
  additionalProperties: false,
} as const;

/**
 * The Broker. The engine computes the reads and samples the recommendation (per player, per
 * haul, decorrelated across the crew). The model only rewrites the briefing in character —
 * it never changes the recommendation, so a crew of model-advised players stays balanced.
 */
export async function fixerAdvice(env: ModelEnv, state: GameState, playerId: string, model: LanguageModel | null = createModel(env)): Promise<FixerAdvice> {
  const base = heuristicFixer(state, playerId);
  if (!model) return base;

  const system = [
    'You are "the Broker", a terse, worldly salvage dealer advising one member of an orbital salvage crew in the game Salvage Rights.',
    'You only know public information. Never claim to know what anyone is choosing this haul.',
    `The house has already decided the recommendation: ${base.recommendation.toUpperCase()}. Do not argue with it; make the case for it in character.`,
    'Be specific about the people in the crew by name. Light spacer slang is fine; no markdown.',
  ].join(' ');
  const user = [
    describeTableForModel(state, playerId),
    '',
    `House analysis (confidence ${base.confidence}): ${base.reasoning.join(' ')}`,
    'Reads: ' + base.reads.map((r) => `${r.name}: steal rate ${Math.round(r.stealRate * 100)}%, ${r.note}`).join(' | '),
  ].join('\n');

  const out = await model.structured({ system, user, schema: FIXER_SCHEMA, maxTokens: 300 });
  if (!out) return base;
  const headline = typeof out.headline === 'string' && out.headline.trim() ? out.headline.trim().slice(0, 90) : base.headline;
  const reasoning = Array.isArray(out.reasoning)
    ? out.reasoning.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim().slice(0, 200)).slice(0, 4)
    : [];
  return { ...base, headline, reasoning: reasoning.length ? reasoning : base.reasoning, source: model.id };
}

/** Mission log at game over. */
export async function afterActionReport(env: ModelEnv, state: GameState, model: LanguageModel | null = createModel(env)): Promise<string> {
  const fallback = templateReport(state);
  if (!model) return fallback;
  const system =
    'You write the mission log for an orbital salvage crew that just finished eight hauls of the game Salvage Rights. ' +
    'Three or four punchy sentences, dry spacer tone, name names, mention the decisive claim-jump or the surprising loyalty. Plain text only, under 90 words.';
  const ranked = rankPlayers(state.players);
  const user = [
    `Final: ${ranked.map((p) => `${p.name} ${p.score} (${p.steals} steals)`).join(', ')}. Winner(s): ${state.winners
      .map((id) => state.players.find((p) => p.id === id)?.name)
      .join(', ')}.`,
    ...state.history.map(
      (r) => `Haul ${r.round} "${r.jobName}" cargo ${r.pot}: ${r.outcome}. ` + state.players.map((p) => `${p.name}=${r.choices[p.id]}(${r.deltas[p.id]})`).join(' '),
    ),
    `Facts: ${fallback}`,
  ].join('\n');
  const text = await model.text({ system, user, maxTokens: 220 });
  if (!text) return fallback;
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 40 ? clean.slice(0, 700) : fallback;
}
