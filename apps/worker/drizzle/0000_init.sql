CREATE TABLE `game_players` (
	`game_id` text NOT NULL,
	`player_id` text NOT NULL,
	`name` text NOT NULL,
	`is_bot` integer NOT NULL,
	`seat` integer NOT NULL,
	`score` integer NOT NULL,
	`steals` integer NOT NULL,
	`won` integer NOT NULL,
	PRIMARY KEY(`game_id`, `player_id`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `game_players_player_idx` ON `game_players` (`player_id`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`game_number` integer NOT NULL,
	`finished_at` integer NOT NULL,
	`player_count` integer NOT NULL,
	`outcomes` text NOT NULL,
	`winners` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `games_finished_idx` ON `games` (`finished_at`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`account_id` text,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `players_account_idx` ON `players` (`account_id`);