import type { GameState } from '@salvage-rights/engine';
import { desc, eq, sql } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

export type Db = DrizzleD1Database<typeof schema>;

export function db(d1: D1Database): Db {
  return drizzle(d1, { schema });
}

/** Persist a finished game. Bots are recorded on the game but never get player rows or stats. */
export async function recordFinishedGame(d1: D1Database, state: GameState): Promise<void> {
  if (state.phase !== 'finished' || !state.history.length) return;
  const conn = db(d1);
  const now = Date.now();
  const gameId = `${state.code}:${state.gameNumber}:${state.seed.slice(0, 8)}`;
  const outcomes = state.history.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }), {});
  const humans = state.players.filter((p) => !p.isBot);

  const statements = [
    conn
      .insert(schema.games)
      .values({
        id: gameId,
        roomCode: state.code,
        gameNumber: state.gameNumber,
        finishedAt: now,
        playerCount: state.players.length,
        outcomes: JSON.stringify(outcomes),
        winners: JSON.stringify(state.winners),
      })
      .onConflictDoNothing(),
    ...humans.map((p) =>
      conn
        .insert(schema.players)
        .values({ id: p.id, name: p.name, createdAt: now, lastSeenAt: now })
        .onConflictDoUpdate({ target: schema.players.id, set: { name: p.name, lastSeenAt: now } }),
    ),
    ...humans.map((p) =>
      conn
        .insert(schema.gamePlayers)
        .values({ gameId, playerId: p.id, name: p.name, isBot: 0, seat: p.seat, score: p.score, steals: p.steals, won: state.winners.includes(p.id) ? 1 : 0 })
        .onConflictDoNothing(),
    ),
  ];
  // D1 batches run atomically.
  await conn.batch(statements as [typeof statements[0], ...typeof statements]);
}

export interface PlayerStats {
  playerId: string;
  name: string;
  games: number;
  wins: number;
  totalScore: number;
  bestScore: number;
  steals: number;
}

export async function playerStats(d1: D1Database, playerId: string): Promise<PlayerStats | null> {
  const conn = db(d1);
  const rows = await conn
    .select({
      playerId: schema.gamePlayers.playerId,
      name: sql<string>`max(${schema.gamePlayers.name})`,
      games: sql<number>`count(*)`,
      wins: sql<number>`sum(${schema.gamePlayers.won})`,
      totalScore: sql<number>`sum(${schema.gamePlayers.score})`,
      bestScore: sql<number>`max(${schema.gamePlayers.score})`,
      steals: sql<number>`sum(${schema.gamePlayers.steals})`,
    })
    .from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.playerId, playerId))
    .groupBy(schema.gamePlayers.playerId);
  return rows[0] ?? null;
}

export async function leaderboard(d1: D1Database, limit = 25): Promise<PlayerStats[]> {
  const conn = db(d1);
  return conn
    .select({
      playerId: schema.gamePlayers.playerId,
      name: sql<string>`max(${schema.gamePlayers.name})`,
      games: sql<number>`count(*)`,
      wins: sql<number>`sum(${schema.gamePlayers.won})`,
      totalScore: sql<number>`sum(${schema.gamePlayers.score})`,
      bestScore: sql<number>`max(${schema.gamePlayers.score})`,
      steals: sql<number>`sum(${schema.gamePlayers.steals})`,
    })
    .from(schema.gamePlayers)
    .groupBy(schema.gamePlayers.playerId)
    .orderBy(desc(sql`sum(${schema.gamePlayers.won})`), desc(sql`sum(${schema.gamePlayers.score}) / count(*)`))
    .limit(limit);
}
