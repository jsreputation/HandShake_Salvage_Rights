# Salvage Rights

> Eight jobs. One crew. Nobody trusts anybody.

An AI-assisted, real-time Collect-or-Steal game for **2–6 players**, set aboard an orbital salvage
crew. Players join through a room link, make eight secret calls as the crew reaches eight derelicts,
watch the calls go live together, and can go again as many times as they like with a series tally.
Every finished run goes in the log.

**New here? Read [`docs/SETUP.md`](docs/SETUP.md)** — install, run, test, Cloudflare setup, deploy, configuration, troubleshooting.

Built with **Vite + React + TanStack Router** on the client and **Cloudflare Workers, Durable
Objects (via partyserver), D1 and Claude** on the server. One `npm run deploy` ships everything.

![Choosing phase](screenshots/04-choosing.png)

![Landing](screenshots/01-landing.png)

## What's in the box

| Piece | Where | What it does |
|---|---|---|
| Game engine | `packages/engine` | Pure TypeScript, zero dependencies: the payout rules, the 8-haul state machine, five AI crew personalities, the Broker's reasoning, snapshots that never leak a pending call. |
| Protocol | `packages/protocol` | Zod schemas for every client message; a compile-time check keeps them identical to the engine's types. |
| Game server | `apps/worker` | A Worker that routes `/api/*` and `/ws/*` to a per-room `RoomServer` (partyserver on a SQLite Durable Object), a global `DirectoryServer` for public lobbies, pluggable language-model providers, a D1 data layer (Drizzle), and the static client. |
| Client | `apps/web` | Vite SPA: station page with a live payout demo, the dock (lobby with QR invite), the console (chamfered Collect/Steal controls, timer, lock-in strip, reveal), the manifest, the Broker panel, the final manifest and mission log, rematch, your record and the leaderboard. Keyboard shortcuts (C / S / Enter), tab-title nudges, reconnecting sockets via partysocket. |
| Checks | `packages/*/test`, `apps/worker/test`, `tests/integration` | 889 engine assertions incl. all **124 player-choice combinations** and the no-dominant-strategy property; protocol and AI-provider unit tests; a two-client integration suite and a two-browser Playwright suite, both playing a complete eight-round game against a local `wrangler dev`. |

## The rules

Each derelict carries cargo. Everyone secretly calls **Collect** or **Steal**.

| Outcome | When | Payout |
|---|---|---|
| Clean split | nobody steals | everyone gets `cargo ÷ players` |
| Claim jumped | exactly one steals | the stealer tows everything |
| Collision | 2+ steal, but not everyone | stealers get **nothing**; collectors keep `cargo ÷ players`; the stealers' would-be shares stay drifting for the next haul |
| Standoff | everyone steals | everyone **loses** `cargo ÷ players`; the whole haul is still drifting at the next derelict |

Cargo: 120, 120, 180, 180, 240, 240, 360, 480 (+ whatever is drifting). Timer expiry defaults a player to
Collect. Highest score wins; ties go to the cleaner record.

Stealing pays only when you are alone, so there is no dominant strategy: in 4,000 simulated
mixed tables an always-steal player wins 31% with the lowest average score of any fixed strategy
(the first version of the rules let it win 100%). Rationale and the simulation in
[`docs/DESIGN.md`](docs/DESIGN.md).

## AI assistance

* **The Broker** — a private, once-per-haul briefing. The engine computes the reads and the
  recommendation from the payout structure (steal vs. collect expected value against each
  opponent's observed rate blended with the table's mixed equilibrium) and *samples* it with a
  per-player seed, so the whole crew never gets the same order. A language model then rewrites
  the briefing in character; it never changes the recommendation.
* **AI crew** — Lifer, Scavenger, Grudge, Glitch, Hunter. Deterministic from the room seed.
* **The mission log** — an AI-written debrief at the end of the run.

Model providers (`AI_PROVIDER` in `apps/worker/wrangler.jsonc`):

| Provider | What it needs | Notes |
|---|---|---|
| `anthropic` (default) | `wrangler secret put ANTHROPIC_API_KEY` | Claude via the Messages API with JSON-schema structured output; `AI_MODEL` defaults to `claude-haiku-5-5`. Set `ANTHROPIC_BASE_URL` to `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` to route through AI Gateway (caching, rate limits, logs). |
| `workers-ai` | the `AI` binding | No key; smaller models, lenient JSON parsing. |
| `mock` | nothing | Canned answers. Used by `--env local`, so dev and tests exercise the full model path offline. |
| `none` | nothing | Heuristic briefings only. |

Every call is bounded by `AI_TIMEOUT_MS` and falls back to the deterministic briefing, so a model
outage never blocks a game.

## Quick start

```bash
npm install
npm run build:web          # vite build -> apps/web/dist
npm run dev:worker         # applies D1 migrations locally, then http://localhost:8787 (full stack)
```

Open two browser profiles (or a normal and a private window), open a room in one, paste the
link in the other (or scan the QR code in the dock). For client hot reload run `npm run dev:web` as well: Vite on :3000 proxies
`/api` and `/ws` to the Worker on :8787.

`dev:worker` uses the `local` environment (mock model, local D1, no Cloudflare login).
`npm run dev -w @salvage-rights/worker` uses the default environment with your real bindings.

## Checks

```bash
npm run typecheck          # all workspaces
npm run test:unit          # engine (889), protocol, AI providers (faked fetch, every fallback path)
npm run test:integration   # two WebSocket clients vs wrangler dev: full 8-haul game, rematch, timers, reconnect, spectators, validation, D1 stats, directory
npm run test:e2e           # two isolated Chromium contexts through the real UI (needs `npx playwright install chromium` once)
npm run check              # everything above, in order
```

`packages/engine/test/combinations.test.ts` enumerates every choice vector for every crew size
(4 + 8 + 16 + 32 + 64 = 124), asserts the count, and checks each one against the payout table,
value conservation, outcome classification, permutation invariance, a golden table and the
no-dominant-strategy property (7 checks per vector).

The integration suites apply the D1 migration and boot `wrangler dev --env local` themselves.
Build the client first (`npm run build:web`); the test tells you if you forgot.

## Deploy

```bash
npx wrangler login
npx wrangler d1 create salvage-rights          # paste the id into apps/worker/wrangler.jsonc (both places)
npx wrangler secret put ANTHROPIC_API_KEY      # from apps/worker
npm run deploy                                 # builds the client, migrates D1, deploys the Worker
```

Step by step, with troubleshooting: [`docs/SETUP.md`](docs/SETUP.md).

The Worker's URL is the game; share `/r/CODE` links. Optional: a custom domain via `routes`,
`ROOM_TTL_HOURS`, `AI_MODEL`, `ANTHROPIC_BASE_URL` for AI Gateway.

> If you deployed the first version (Durable Object classes `RoomDO`/`DirectoryDO`), add a
> `renamed_classes` migration before deploying, or deploy under a new Worker name.

## How it fits together

```
browser ──(GET anything)────▶ Worker ──▶ apps/web/dist (SPA; /r/:code handled by the router)
browser ──(POST /api/rooms)─▶ Worker ──▶ RoomServer.onRequest(/init)
browser ──(WS /ws/CODE)─────▶ Worker ──▶ RoomServer (partyserver) ──▶ engine (pure functions)
                                           │  ├─ Zod-validated messages, per-connection state in the socket attachment
                                           │  ├─ storage: state, secrets, fixer cache, report
                                           │  ├─ alarms: choice timer, reveal timer, lobby grace, room TTL
                                           │  ├─ model provider: Fixer briefing, debrief (fallback: heuristics)
                                           │  └─ D1: finished games, player rows, stats
                                           └──▶ DirectoryServer (public lobby list)
browser ──(GET /api/leaderboard, /api/players/:id/stats)──▶ Worker ──▶ D1 (Drizzle)
```

* **Identity**: the client keeps `{id, secret}` in `localStorage`. The server stores a SHA-256 of
  the secret per seat, so a reload reclaims the seat and the pending secret choice; a different
  secret is refused. Player rows in D1 carry an `account_id` column for the auth step.
* **Secrecy**: snapshots are built per viewer; the Broker and the model see only resolved history.
* **Timers**: one alarm for whichever comes first — choice deadline, reveal auto-advance, lobby
  grace expiry, room TTL — recomputed on every commit.

Diagrams of the runtime workflow and the delivery pipeline are in [`docs/diagrams/`](docs/diagrams/).

## Project layout

```
salvage-rights/
├── packages/engine/          rules, state machine, bots, the Broker's reasoning, report, protocol types (+ tests)
├── packages/protocol/        Zod schemas for client messages (+ tests)
├── apps/worker/              Worker entry, RoomServer, DirectoryServer, ai/ providers, db/ (Drizzle + D1), wrangler.jsonc
├── apps/web/                 Vite app: routes, components, hooks, styles
├── tests/integration/        protocol tests (vitest) and browser tests (Playwright)
├── docs/                     SETUP.md, DESIGN.md, diagrams/
└── screenshots/              captured from the e2e walkthrough
```

## Still to do

* **Accounts** — Better Auth (passkeys + magic link) on D1; claim guest ids via `players.account_id`.
* **Abuse controls** — Cloudflare rate limiting on `POST /api/rooms` and the lookup endpoints,
  longer codes or a join token for private rooms, a spectator cap and a ban-on-kick list.
* **Crew comms** — a short negotiation phase with public "promise" tokens recorded in the manifest.
* **Observability** — Analytics Engine for the model fallback rate and round timings.

## Changes from the first version

1. **Rules**: colliding stealers get nothing and collectors keep their share (no dominant strategy).
2. **The Broker** (was "the Fixer"): equilibrium-based, sampled per player; the model may rewrite but never overrule it.
3. **AI layer**: provider abstraction — Claude with structured output (optionally through AI Gateway), Workers AI, mock, none.
4. **Server**: `RoomServer` on partyserver; every message validated with Zod.
5. **Client**: Vite + React + TanStack Router SPA with partysocket; 0.6 s builds.
6. **Data**: D1 + Drizzle recording finished runs; stats and leaderboard endpoints and a station-page record panel.
7. **Theme and UI**: orbital salvage setting (hauls, derelicts, manifest, the Broker) on a dark console design; haul track, lock-in strip, keyboard shortcuts, QR invites, tab-title nudges.
