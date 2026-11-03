import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Players are keyed by the client-generated guest identity. `accountId` is reserved for the
 * auth step: when a person signs in, their guest ids are claimed by linking them here, and
 * stats aggregate across all of them.
 */
export const players = sqliteTable(
  'players',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    accountId: text('account_id'),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
  },
  (t) => [index('players_account_idx').on(t.accountId)],
);

export const games = sqliteTable(
  'games',
  {
    id: text('id').primaryKey(),
    roomCode: text('room_code').notNull(),
    gameNumber: integer('game_number').notNull(),
    finishedAt: integer('finished_at').notNull(),
    playerCount: integer('player_count').notNull(),
    /** Count of each outcome across the eight jobs, as JSON. */
    outcomes: text('outcomes').notNull(),
    /** JSON array of winning player ids. */
    winners: text('winners').notNull(),
  },
  (t) => [index('games_finished_idx').on(t.finishedAt)],
);

export const gamePlayers = sqliteTable(
  'game_players',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    name: text('name').notNull(),
    isBot: integer('is_bot').notNull(),
    seat: integer('seat').notNull(),
    score: integer('score').notNull(),
    steals: integer('steals').notNull(),
    won: integer('won').notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.playerId] }), index('game_players_player_idx').on(t.playerId)],
);
