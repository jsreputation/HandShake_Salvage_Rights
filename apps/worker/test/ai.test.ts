import { addPlayer, advance, createRoom, heuristicFixer, resolveRound, startGame, submitChoice, type GameState } from '@salvage-rights/engine';
import { describe, expect, it, vi } from 'vitest';
import { afterActionReport, createModel, fixerAdvice } from '../src/ai/index';

function table(): GameState {
  let s = createRoom('AITEST', 'seed', { timerSeconds: 0 });
  s = addPlayer(s, { id: 'p0', name: 'Ana' });
  s = addPlayer(s, { id: 'p1', name: 'Ben' });
  s = addPlayer(s, { id: 'p2', name: 'Cal' });
  s = startGame(s);
  s = submitChoice(s, 'p0', 'collect');
  s = submitChoice(s, 'p1', 'steal');
  s = submitChoice(s, 'p2', 'collect');
  s = advance(resolveRound(s));
  return s;
}

function fakeFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const res = await handler(url, init);
    return new Response(JSON.stringify(res.body), { status: res.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

describe('anthropic provider', () => {
  it('asks for JSON-schema structured output and keeps the engine recommendation', async () => {
    const state = table();
    const base = heuristicFixer(state, 'p0');
    const { fetchImpl, calls } = fakeFetch(() => ({
      body: {
        content: [{ type: 'text', text: JSON.stringify({ headline: 'Ben just showed you who he is.', reasoning: ['Ben stole job one.', 'Cal held.'] }) }],
        stop_reason: 'end_turn',
      },
    }));
    const model = createModel({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test', AI_MODEL: 'claude-haiku-5-5' }, fetchImpl);
    expect(model?.id).toBe('claude-haiku-5-5');
    const advice = await fixerAdvice({}, state, 'p0', model);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = calls[0]!.body;
    expect(body.model).toBe('claude-haiku-5-5');
    expect((body.output_config as { format: { type: string } }).format.type).toBe('json_schema');
    expect(String(body.system)).toContain(base.recommendation.toUpperCase());
    expect(String(body.system)).not.toMatch(/Ben.*steal.*this haul/i);
    // Secrets never leave the house: the prompt carries only resolved history.
    expect(JSON.stringify(body)).not.toContain('"choice"');

    expect(advice.headline).toBe('Ben just showed you who he is.');
    expect(advice.reasoning).toEqual(['Ben stole job one.', 'Cal held.']);
    expect(advice.recommendation).toBe(base.recommendation);
    expect(advice.confidence).toBe(base.confidence);
    expect(advice.reads).toEqual(base.reads);
    expect(advice.source).toBe('claude-haiku-5-5');
  });

  it('routes through an AI Gateway base URL when configured', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { content: [{ type: 'text', text: 'A fine debrief indeed, with names and a crown and a betrayal.' }], stop_reason: 'end_turn' } }));
    const model = createModel(
      { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic/' },
      fetchImpl,
    );
    const text = await model!.text({ system: 's', user: 'u', maxTokens: 50 });
    expect(calls[0]!.url).toBe('https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic/v1/messages');
    expect(text).toContain('debrief');
  });

  it('falls back to the heuristic briefing on API errors, refusals, truncation and timeouts', async () => {
    const state = table();
    const base = heuristicFixer(state, 'p0');

    const error = fakeFetch(() => ({ status: 429, body: { error: { type: 'rate_limit_error', message: 'slow down' } } }));
    expect(await fixerAdvice({}, state, 'p0', createModel({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }, error.fetchImpl))).toEqual(base);

    const refusal = fakeFetch(() => ({ body: { content: [{ type: 'text', text: '{"headline":"x","reasoning":[]}' }], stop_reason: 'refusal' } }));
    expect(await fixerAdvice({}, state, 'p0', createModel({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }, refusal.fetchImpl))).toEqual(base);

    const truncated = fakeFetch(() => ({ body: { content: [{ type: 'text', text: '{"headline":"x"' }], stop_reason: 'max_tokens' } }));
    expect(await fixerAdvice({}, state, 'p0', createModel({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }, truncated.fetchImpl))).toEqual(base);

    const slow = async (_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const model = createModel({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', AI_TIMEOUT_MS: '30' }, slow);
    expect(await fixerAdvice({}, state, 'p0', model)).toEqual(base);
  });

  it('refuses to start without a key and is silent about it to players', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(createModel({ AI_PROVIDER: 'anthropic' })).toBeNull();
    expect(createModel({ AI_PROVIDER: 'none' })).toBeNull();
    expect(createModel({})).toBeNull();
    warn.mockRestore();
  });
});

describe('mock provider and the report', () => {
  it('produces a model-authored briefing without any network', async () => {
    const state = table();
    const advice = await fixerAdvice({ AI_PROVIDER: 'mock' }, state, 'p1');
    expect(advice.source).toBe('mock');
    expect(advice.headline).toContain('Ben');
    expect(advice.recommendation).toBe(heuristicFixer(state, 'p1').recommendation);
  });

  it('writes the after-action report with the model, or the template when there is none', async () => {
    let s = table();
    for (let r = 2; r <= 8; r++) s = advance(resolveRound(submitChoice(submitChoice(submitChoice(s, 'p0', 'collect'), 'p1', 'collect'), 'p2', 'collect')));
    expect(s.phase).toBe('finished');
    expect(await afterActionReport({ AI_PROVIDER: 'mock' }, s)).toContain('Mock mission log');
    expect(await afterActionReport({ AI_PROVIDER: 'none' }, s)).toContain('salvage rights with');
  });
});
