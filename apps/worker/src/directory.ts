import { Server } from 'partyserver';
import type { Env } from './env';
import { json } from './env';

export interface DirectoryEntry {
  code: string;
  host: string;
  players: number;
  maxPlayers: number;
  gameNumber: number;
  updatedAt: number;
}

const ENTRY_TTL_MS = 10 * 60 * 1000;

/** A single global server ("global") that lists public rooms waiting for players. */
export class DirectoryServer extends Server<Env> {
  override async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const entries = (await this.ctx.storage.get<Record<string, DirectoryEntry>>('entries')) ?? {};
    const now = Date.now();
    let changed = false;
    for (const [code, e] of Object.entries(entries)) {
      if (now - e.updatedAt > ENTRY_TTL_MS) {
        delete entries[code];
        changed = true;
      }
    }

    if (request.method === 'POST' && url.pathname === '/upsert') {
      const entry = (await request.json()) as DirectoryEntry;
      entries[entry.code] = { ...entry, updatedAt: now };
      changed = true;
    } else if (request.method === 'POST' && url.pathname === '/remove') {
      const { code } = (await request.json()) as { code: string };
      if (entries[code]) {
        delete entries[code];
        changed = true;
      }
    }

    if (changed) await this.ctx.storage.put('entries', entries);

    const list = Object.values(entries).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
    return json({ rooms: list, now });
  }
}
