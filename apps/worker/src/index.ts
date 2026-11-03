import { isValidRoomCode, makeRoomCode, sanitizeSettings } from '@salvage-rights/engine';
import { CreateRoomBodySchema } from '@salvage-rights/protocol';
import { getServerByName } from 'partyserver';
import { leaderboard, playerStats } from './db/index';
import type { Env } from './env';
import { json } from './env';

export { RoomServer } from './room';
export { DirectoryServer } from './directory';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function withCors(res: Response): Response {
  return new Response(res.body, { status: res.status, headers: { ...Object.fromEntries(res.headers), ...CORS } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // ------------------------------------------------------------------ API
    if (path === '/api/health') return json({ ok: true, now: Date.now() }, 200, CORS);

    if (path === '/api/rooms' && request.method === 'POST') {
      const raw = await request.json().catch(() => ({}));
      const parsed = CreateRoomBodySchema.safeParse(raw);
      if (!parsed.success) return json({ error: 'bad_request', message: parsed.error.issues[0]?.message }, 400, CORS);
      const settings = sanitizeSettings(parsed.data.settings ?? {});
      // Retry on the (astronomically unlikely) code collision.
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = makeRoomCode(5);
        const room = await getServerByName(env.ROOMS, code);
        const res = await room.fetch('https://room/init', { method: 'POST', body: JSON.stringify({ settings }) });
        const data = (await res.json()) as { code: string; existed: boolean };
        if (!data.existed) return json({ code, url: `${url.origin}/r/${code}` }, 201, CORS);
      }
      return json({ error: 'could_not_allocate_room' }, 503, CORS);
    }

    const roomMatch = path.match(/^\/api\/rooms\/([A-Za-z0-9]+)$/);
    if (roomMatch && request.method === 'GET') {
      const code = roomMatch[1]!.toUpperCase();
      if (!isValidRoomCode(code)) return json({ error: 'bad_code' }, 400, CORS);
      const room = await getServerByName(env.ROOMS, code);
      return withCors(await room.fetch('https://room/summary'));
    }

    if (path === '/api/leaderboard' && request.method === 'GET') {
      if (!env.DB) return json({ enabled: false, players: [] }, 200, CORS);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 25));
      return json({ enabled: true, players: await leaderboard(env.DB, limit) }, 200, CORS);
    }

    const statsMatch = path.match(/^\/api\/players\/([a-z0-9]{8,32})\/stats$/);
    if (statsMatch && request.method === 'GET') {
      if (!env.DB) return json({ enabled: false, stats: null }, 200, CORS);
      return json({ enabled: true, stats: await playerStats(env.DB, statsMatch[1]!) }, 200, CORS);
    }

    if (path === '/api/directory' && request.method === 'GET') {
      const directory = await getServerByName(env.DIRECTORY, 'global');
      return withCors(await directory.fetch('https://directory/list'));
    }

    // ------------------------------------------------------------------ WebSocket
    const wsMatch = path.match(/^\/ws\/([A-Za-z0-9]+)$/);
    if (wsMatch) {
      const code = wsMatch[1]!.toUpperCase();
      if (!isValidRoomCode(code)) return json({ error: 'bad_code' }, 400);
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'expected_websocket' }, 426);
      const room = await getServerByName(env.ROOMS, code);
      return room.fetch(request);
    }

    if (path.startsWith('/api/') || path.startsWith('/ws/')) return json({ error: 'not_found' }, 404, CORS);

    // Everything else is the single-page app (room links included: the router reads /r/:code).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
