# Salvage Rights — design notes

> Eight hauls. One crew. Every claim is contested.

Salvage Rights is a real-time, AI-assisted social-deduction game for **2–6 players**.
An orbital salvage crew works **eight derelicts** ("hauls"). Before every job each crew member secretly chooses
**COLLECT** (take your fair share) or **STEAL** (go for the whole take). The choices
are revealed simultaneously and the take is paid out by the rules below. Highest
score after job 8 wins; the crew can rematch in the same room as many times as it
likes and a series tally is kept.

## Why this beats the reference

The reference ("Panic Protocol") is a Spaceteam-style shouting game. The product
qualities worth keeping are: zero-friction room creation, shareable room links,
callsigns, a live lobby, persistent identity across reloads. Salvage Rights keeps
all of those and adds:

* a mechanic with real strategy (an iterated multi-player prisoner's dilemma with
  carry-over, escalating stakes and a mutual-destruction clause),
* **AI assistance** — a private advisor ("the Fixer"), AI crew members with
  distinct personalities, and an AI after-action report,
* a formally specified, fully tested scoring engine (all 124 choice vectors),
* reconnect-safe multiplayer on Durable Objects (hibernating WebSockets, alarms),
* rematches with series scoring, spectators, reactions, timers,
* a single `wrangler deploy` that ships the Next.js client and the game server.

## Scoring rules (normative)

Let `n` be the number of players (2 ≤ n ≤ 6), `s` the number of stealers,
`P` the take for the job (base take + carry-over from the previous job).

| Outcome          | Condition   | Stealers get            | Collectors get  | Carry-over to next job        |
|------------------|-------------|-------------------------|-----------------|-------------------------------|
| **CLEAN JOB**    | `s = 0`     | —                       | `⌊P / n⌋` each  | `P − n·⌊P/n⌋` (remainder)     |
| **DOUBLE CROSS** | `s = 1`     | `P` (all of it)         | `0`             | `0`                           |
| **SCRAMBLE**     | `2 ≤ s < n` | `0`                     | `⌊P / n⌋` each  | `P − (n−s)·⌊P/n⌋` (the stealers' would-be cuts) |
| **STANDOFF**     | `s = n`     | `−⌊P / n⌋` each (loss)  | —               | `P` (the whole take)          |

* Base takes per job: `120, 120, 180, 180, 240, 240, 360, 480` (total 1 920).
  All are multiples of 60 so even splits are integers for every crew size.
* Carry-over left after job 8 is burned.
* Final ranking: highest score; ties broken by **fewer steals** ("the cleaner record");
  still tied → shared win.
* A player who does not choose before the timer expires (or is disconnected)
  defaults to COLLECT and is flagged as timed out in the ledger.

Why this shape: stealing pays **only when you are the only one doing it**. With two
or more stealers the collectors keep their cut and the stealers get nothing, and a
STANDOFF both punishes the table and rolls the whole take forward. Holding everyone
else fixed, steal beats collect exactly when nobody else steals and loses otherwise —
there is no dominant strategy, so the game is about reading the table. (The first
version paid scrambling stealers a quarter-share each; simulation showed an always-steal
player then won 100% of mixed tables. It now wins about 30% with the lowest average
score of any fixed strategy.) The 124-combination suite pins every cell of this table
and the no-dominant-strategy property for every crew size.

## The 124 combinations

For every crew size `n ∈ {2,3,4,5,6}` and every choice vector in `{COLLECT, STEAL}^n`:
`4 + 8 + 16 + 32 + 64 = 124` cases. `packages/engine/test/combinations.test.ts`
enumerates them all, asserts the count is exactly 124, checks the payout formula,
conservation of value (`Σ payouts + carry = P` outside STANDOFF), permutation
invariance and a golden table.

## AI assistance

1. **The Fixer** — a private advisor each player can consult once per job. It is
   given only *public* information (ledger, scores, take, round) plus the asking
   player's own history, never other players' pending choices. The recommendation is
   computed from the payout structure (steal EV vs. collect EV given each opponent's
   observed steal rate blended with the table's mixed equilibrium) and then *sampled*
   from the resulting steal probability with a per-player, per-job seed, so advice is
   stable for one player and different across seats. A table that blindly follows it
   stands off about as often as the equilibrium predicts, not every job. A language
   model may rewrite the briefing in character but never changes the recommendation.
2. **AI crew** — the host can fill seats with bots. Five personalities
   (`saint`, `opportunist`, `grudge`, `wildcard`, `shark`), all deterministic given
   the room seed, so games are reproducible in tests.
3. **After-action report** — an AI-written debrief at game over (template fallback).

## Architecture

```
packages/engine     pure TypeScript, zero deps: rules, state machine, bots, Fixer reasoning
packages/protocol   Zod schemas for client messages, type-checked against the engine
apps/worker         Cloudflare Worker + RoomServer (partyserver on a SQLite Durable Object)
                    + DirectoryServer + model providers (Claude / Workers AI / mock) + D1 via Drizzle
apps/web            Vite + React + TanStack Router SPA, served by the same Worker as static assets
tests/integration   two independent WebSocket clients vs. `wrangler dev`; Playwright 2-browser e2e
```

* One Worker serves everything: `/api/*` and `/ws/*` hit the Worker; every other path is the
  single-page app, whose router reads `/r/:code`.
* Room state lives in a Durable Object addressed by room code. partyserver supplies hibernating
  WebSockets, per-connection state in the socket attachment and the close handshake; timers use
  DO alarms; the full state is persisted on every change so an evicted object resumes exactly
  where it was.
* Identity is `{id, secret}` kept in `localStorage`; reconnecting with the same pair reclaims the
  seat (and the pending secret choice) mid-game.
* Finished games are written to D1 (`games`, `players`, `game_players`); `/api/leaderboard` and
  `/api/players/:id/stats` read them back. `players.account_id` is reserved for accounts.
* The Fixer's recommendation is always the engine's; the model (Claude with JSON-schema output,
  through AI Gateway if configured) only rewrites the prose, and every call falls back to the
  deterministic briefing on error or timeout.

### Balance simulation (4,000 random mixed tables of 2–6, eight jobs)

| Strategy | v1 rules win rate | v2 rules win rate | v2 avg score |
|---|---|---|---|
| Always steal | **100%** | 31% | 221 (lowest but one) |
| Shark (reads the table) | 23% | 36% | **480** (highest) |
| Follow the Fixer | — | 30% | 449 |
| Saint / always collect | 8% | 39% | ~405 |

A table where everyone follows the Fixer: v1 stood off on **every** job at 2–3 players;
v2 averages 1.8 standoffs per game at 2 players (the mixed equilibrium) and 0.1 at 6.

## WebSocket protocol

Client → server: `hello`, `start`, `settings`, `addBot`, `removePlayer`, `choose`,
`next`, `fixer`, `rematch`, `react`, `rename`, `ping`.

Server → client: `state` (per-player snapshot; only your own pending choice is
included), `fixer`, `react`, `event`, `error`, `pong`.
