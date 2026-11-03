import type { Settings } from '@salvage-rights/engine';

/**
 * The Worker serves the client, so the API is same-origin in production; in development the
 * Vite proxy forwards /api and /ws to wrangler. VITE_API_ORIGIN is only for a split deployment.
 */
export function apiOrigin(): string {
  const configured = import.meta.env.VITE_API_ORIGIN as string | undefined;
  if (configured) return configured.replace(/\/$/, '');
  return window.location.origin;
}

export function wsUrl(code: string): string {
  const origin = apiOrigin().replace(/^http/, 'ws');
  return `${origin}/ws/${code}`;
}

export interface RoomSummary {
  code: string;
  phase: string;
  round: number;
  players: number;
  maxPlayers: number;
  gameNumber: number;
  host: string | null;
  isPublic: boolean;
}

export async function createRoom(settings: Partial<Settings>): Promise<{ code: string; url: string }> {
  const res = await fetch(`${apiOrigin()}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
  if (!res.ok) throw new Error(`Could not create a room (${res.status}).`);
  return (await res.json()) as { code: string; url: string };
}

export async function fetchRoom(code: string): Promise<RoomSummary | null> {
  const res = await fetch(`${apiOrigin()}/api/rooms/${encodeURIComponent(code)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not look up that room (${res.status}).`);
  return (await res.json()) as RoomSummary;
}

export interface DirectoryRoom {
  code: string;
  host: string;
  players: number;
  maxPlayers: number;
  gameNumber: number;
  updatedAt: number;
}

export async function fetchDirectory(): Promise<DirectoryRoom[]> {
  const res = await fetch(`${apiOrigin()}/api/directory`);
  if (!res.ok) return [];
  const data = (await res.json()) as { rooms: DirectoryRoom[] };
  return data.rooms ?? [];
}

export function roomLink(code: string): string {
  return `${window.location.origin}/r/${code}`;
}
