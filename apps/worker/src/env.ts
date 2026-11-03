import type { DirectoryServer } from './directory';
import type { RoomServer } from './room';

export interface Env {
  ROOMS: DurableObjectNamespace<RoomServer>;
  DIRECTORY: DurableObjectNamespace<DirectoryServer>;
  ASSETS: Fetcher;
  /** D1: finished games, player stats, leaderboard. Optional so the game still runs without it. */
  DB?: D1Database;
  /** Workers AI binding (only used when AI_PROVIDER=workers-ai). */
  AI?: Ai;
  /** anthropic | workers-ai | mock | none */
  AI_PROVIDER?: string;
  AI_MODEL?: string;
  AI_TIMEOUT_MS?: string;
  /** Secret: `wrangler secret put ANTHROPIC_API_KEY`. */
  ANTHROPIC_API_KEY?: string;
  /** Optional: route through Cloudflare AI Gateway, e.g. https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic */
  ANTHROPIC_BASE_URL?: string;
  ROOM_TTL_HOURS?: string;
}

export const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}
