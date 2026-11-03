/**
 * Language-model providers behind one small interface.
 *
 *   anthropic   Claude via the Messages API, directly or through Cloudflare AI Gateway.
 *               Structured output uses `output_config.format` (JSON schema), so the Broker's
 *               JSON is guaranteed by the API rather than parsed out of prose.
 *   workers-ai  Cloudflare Workers AI (kept as a zero-key option).
 *   mock        Deterministic canned answers: local dev and integration tests exercise the
 *               full model code path without credentials.
 *   none        Heuristics only.
 *
 * Every call is bounded by a timeout and returns null on any failure; callers always have a
 * deterministic fallback, so a model outage never blocks a game.
 */

export type JsonSchema = Record<string, unknown>;

export interface StructuredRequest {
  system: string;
  user: string;
  schema: JsonSchema;
  maxTokens: number;
}

export interface TextRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export interface LanguageModel {
  /** Identifier shown to players as the briefing's author. */
  readonly id: string;
  structured(req: StructuredRequest): Promise<Record<string, unknown> | null>;
  text(req: TextRequest): Promise<string | null>;
}

export interface ModelEnv {
  AI_PROVIDER?: string;
  AI_MODEL?: string;
  AI_TIMEOUT_MS?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  AI?: { run: (model: string, input: unknown) => Promise<unknown> };
}

export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5';
export const DEFAULT_WORKERS_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const DEFAULT_TIMEOUT_MS = 9000;
const ANTHROPIC_VERSION = '2023-06-01';

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function createModel(env: ModelEnv, fetchImpl: FetchLike = (u, i) => fetch(u, i)): LanguageModel | null {
  const provider = (env.AI_PROVIDER ?? 'none').toLowerCase();
  const timeoutMs = Number(env.AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  switch (provider) {
    case 'anthropic':
      if (!env.ANTHROPIC_API_KEY) {
        console.warn('AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set; using heuristics');
        return null;
      }
      return anthropicModel({
        apiKey: env.ANTHROPIC_API_KEY,
        model: env.AI_MODEL || DEFAULT_ANTHROPIC_MODEL,
        baseUrl: (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, ''),
        timeoutMs,
        fetchImpl,
      });
    case 'workers-ai':
      if (!env.AI) {
        console.warn('AI_PROVIDER=workers-ai but no AI binding; using heuristics');
        return null;
      }
      return workersAiModel(env.AI, env.AI_MODEL || DEFAULT_WORKERS_AI_MODEL, timeoutMs);
    case 'mock':
      return mockModel();
    default:
      return null;
  }
}

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('ai_timeout')), ms);
  return run(controller.signal).finally(() => clearTimeout(timer));
}

// ----------------------------------------------------------------------------- anthropic

interface AnthropicOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  error?: { type?: string; message?: string };
}

function anthropicModel(opts: AnthropicOptions): LanguageModel {
  const call = async (body: Record<string, unknown>): Promise<AnthropicResponse | null> => {
    try {
      return await withTimeout(async (signal) => {
        const res = await opts.fetchImpl(`${opts.baseUrl}/v1/messages`, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': opts.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify({ model: opts.model, ...body }),
        });
        const data = (await res.json()) as AnthropicResponse;
        if (!res.ok) {
          console.warn('anthropic error', res.status, data.error?.message ?? '');
          return null;
        }
        return data;
      }, opts.timeoutMs);
    } catch (err) {
      console.warn('anthropic unavailable:', (err as Error).message);
      return null;
    }
  };

  const firstText = (data: AnthropicResponse | null): string | null => {
    if (!data) return null;
    if (data.stop_reason === 'refusal' || data.stop_reason === 'max_tokens') return null;
    const block = data.content?.find((b) => b.type === 'text' && typeof b.text === 'string');
    return block?.text?.trim() || null;
  };

  return {
    id: opts.model,
    async structured(req) {
      const data = await call({
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        output_config: { format: { type: 'json_schema', schema: req.schema } },
      });
      const text = firstText(data);
      if (!text) return null;
      try {
        const parsed = JSON.parse(text) as unknown;
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    },
    async text(req) {
      const data = await call({ max_tokens: req.maxTokens, system: req.system, messages: [{ role: 'user', content: req.user }] });
      return firstText(data);
    },
  };
}

// ----------------------------------------------------------------------------- workers ai

function workersAiModel(ai: NonNullable<ModelEnv['AI']>, model: string, timeoutMs: number): LanguageModel {
  const run = async (input: Record<string, unknown>): Promise<string | null> => {
    try {
      const out = (await withTimeout(() => ai.run(model, input), timeoutMs)) as { response?: unknown } | string;
      const r = typeof out === 'string' ? out : out?.response;
      if (typeof r === 'string') return r.trim() || null;
      if (r && typeof r === 'object') return JSON.stringify(r);
      return null;
    } catch (err) {
      console.warn('workers-ai unavailable:', (err as Error).message);
      return null;
    }
  };
  return {
    id: model,
    async structured(req) {
      const text = await run({
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        max_tokens: req.maxTokens,
        response_format: { type: 'json_schema', json_schema: req.schema },
      });
      if (!text) return null;
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      try {
        return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    },
    text(req) {
      return run({
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        max_tokens: req.maxTokens,
      });
    },
  };
}

// ----------------------------------------------------------------------------- mock

/** Canned but input-sensitive answers, so tests can tell the model path from the heuristic path. */
function mockModel(): LanguageModel {
  return {
    id: 'mock',
    async structured(req) {
      const who = /You are ([^.]+)\./.exec(req.user)?.[1] ?? 'friend';
      return {
        headline: `Mock briefing for ${who}: trust nobody, count every crate.`,
        reasoning: ['The mock model read the same ledger you did.', 'It agrees with the house numbers.', 'It would like a bigger model.'],
      };
    },
    async text() {
      return 'Mock mission log: eight hauls, a few bad burns, one crew member holding the rights. The mock model wishes it had seen the real one.';
    },
  };
}
