# Salvage Rights — setup, run, test, deploy

Everything you need to go from a fresh machine to a live game on your own Cloudflare account.
Commands are run from the repository root unless a path is shown.

---

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 20 or newer (22 recommended) | runs the toolchain |
| npm | 10 or newer (ships with Node) | workspaces |
| A Cloudflare account | free plan is enough | hosting (Workers, Durable Objects, D1) |
| An Anthropic API key | optional | the Broker's briefings and the mission log; without it the game uses its built-in heuristics |
| Chromium for Playwright | optional | only for the browser e2e test |

Check: `node -v` and `npm -v`.

---

## 2. Install

```bash
unzip salvage-rights.zip && cd salvage-rights   # or git clone
npm install
```

That installs every workspace (`packages/engine`, `packages/protocol`, `apps/worker`, `apps/web`,
`tests/integration`). Nothing else to configure for local play.

---

## 3. Run locally

### The whole game, one command

```bash
npm run build:web      # builds the client into apps/web/dist (about a second)
npm run dev:worker     # applies D1 migrations locally, then serves everything on http://localhost:8787
```

Open <http://localhost:8787> in two browser profiles (or one normal and one private window),
open a room in the first, paste the link into the second. Local mode uses:

* the `local` Wrangler environment — Durable Objects and D1 run inside workerd on your machine,
* the **mock** language model, so the Broker and the mission log work with no key and no network.

### With client hot reload

Run the Worker as above, and in a second terminal:

```bash
npm run dev:web        # Vite on http://localhost:3000, proxies /api and /ws to :8787
```

Edit anything under `apps/web/src` and the page updates in place.

### Against your real Cloudflare bindings (optional)

```bash
npx wrangler login
npm run dev -w @salvage-rights/worker   # default environment: real AI provider, local D1
```

---

## 4. Tests and checks

```bash
npm run typecheck          # every workspace
npm run test:unit          # engine (889 assertions incl. all 124 choice vectors), protocol schemas, AI providers
npm run test:integration   # two WebSocket clients against a local wrangler dev: full 8-haul game, timers, reconnect, spectators, validation, D1 stats, directory
npm run test:e2e           # two isolated Chromium browsers through the real UI
npm run check              # all of the above, in order
```

Before the first `test:e2e` on a machine, install the browser once:

```bash
cd tests/integration && npx playwright install chromium
```

The integration and e2e suites start their own `wrangler dev --env local` (ports 8791 and 8793)
and apply the D1 migration themselves. They need `apps/web/dist` to exist — run
`npm run build:web` first; the test tells you if you forgot.

---

## 5. Set up Cloudflare (once)

### 5.1 Log in

```bash
npx wrangler login
```

### 5.2 Pick a Worker name

`apps/worker/wrangler.jsonc` → `"name": "salvage-rights"`. Change it if the name is taken on your
account; the Worker URL becomes `https://<name>.<your-subdomain>.workers.dev`.

### 5.3 Create the database

```bash
cd apps/worker
npx wrangler d1 create salvage-rights
```

Copy the `database_id` it prints into `wrangler.jsonc` — **both** occurrences (the top-level
`d1_databases` entry and the one under `env.local`). The migration itself runs on deploy.

### 5.4 Choose the language model

`wrangler.jsonc` → `vars.AI_PROVIDER`:

| Value | Setup | What you get |
|---|---|---|
| `anthropic` (default) | `npx wrangler secret put ANTHROPIC_API_KEY` (from `apps/worker`) | Claude writes the Broker's briefing and the mission log, with JSON-schema structured output. `AI_MODEL` defaults to `claude-haiku-5-5`. |
| `workers-ai` | nothing — uses the `AI` binding | Cloudflare's hosted models; no key, lower quality. |
| `none` | nothing | Deterministic briefings only. |

Optional, recommended in production: route Claude calls through **Cloudflare AI Gateway** for
caching, rate limits and logs. Create a gateway in the Cloudflare dashboard (AI → AI Gateway), then
set `vars.ANTHROPIC_BASE_URL` to

```
https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_name>/anthropic
```

Whatever the provider, a failure or timeout (`AI_TIMEOUT_MS`, default 9 s) falls back to the
built-in briefing; the game never waits on a model.

### 5.5 Durable Objects

Nothing to create: the classes `RoomServer` and `DirectoryServer` and their SQLite migration are
declared in `wrangler.jsonc` and created on the first deploy. (They are available on the free plan.)

---

## 6. Deploy

```bash
npm run deploy
```

That runs, in order: `vite build` → `wrangler d1 migrations apply salvage-rights --remote` →
`wrangler deploy`. The command prints the Worker URL. Open it, open a room, share `/r/CODE`.

Redeploy after any change with the same command. Database migrations are idempotent.

### Custom domain (optional)

In `wrangler.jsonc` add

```jsonc
"routes": [{ "pattern": "play.example.com", "custom_domain": true }]
```

for a domain on your Cloudflare account, then `npm run deploy`. The client is same-origin with
the Worker, so nothing else changes.

### Continuous integration

`.github/workflows/ci.yml` runs `npm run check` on every push. To deploy from CI, add a job that
runs `npm run deploy` with `CLOUDFLARE_API_TOKEN` (and `CLOUDFLARE_ACCOUNT_ID`) set from
repository secrets; create the token in the Cloudflare dashboard with the "Edit Cloudflare
Workers" template plus D1 edit permission.

---

## 7. Configuration reference

All in `apps/worker/wrangler.jsonc` unless noted.

| Setting | Where | Default | Meaning |
|---|---|---|---|
| `name` | top level | `salvage-rights` | Worker name → URL |
| `AI_PROVIDER` | `vars` | `anthropic` | `anthropic`, `workers-ai`, `mock`, `none` |
| `AI_MODEL` | `vars` | `claude-haiku-5-5` | model id for the chosen provider |
| `AI_TIMEOUT_MS` | `vars` | `9000` | model call budget before falling back |
| `ANTHROPIC_BASE_URL` | `vars` (optional) | — | AI Gateway base URL |
| `ANTHROPIC_API_KEY` | **secret** (`wrangler secret put`) | — | never put this in `vars` or git |
| `ROOM_TTL_HOURS` | `vars` | `24` | a room is deleted this long after its last move once empty |
| `d1_databases[0].database_id` | top level and `env.local` | placeholder | from `wrangler d1 create` |
| `routes` | top level (optional) | — | custom domain |
| `VITE_API_ORIGIN` | `apps/web/.env` (optional) | same origin | only for a client hosted separately from the Worker |

Game rules (hauls, cargo values, payout table) live in `packages/engine/src/types.ts` and
`rules.ts`; change them there and the 124-combination test tells you what you changed.

---

## 8. Useful scripts

| Command | What it does |
|---|---|
| `npm run build:web` | build the client |
| `npm run dev:worker` | local full stack on :8787 (mock model, local D1) |
| `npm run dev:web` | Vite with hot reload on :3000 |
| `npm run check` | typecheck + unit + build + integration + e2e |
| `npm run deploy` | build + migrate + deploy |
| `npm run db:generate -w @salvage-rights/worker` | generate a new D1 migration after editing `src/db/schema.ts` |
| `npm run db:migrate:local -w @salvage-rights/worker` | apply migrations to the local D1 |

---

## 9. Troubleshooting

**`Missing apps/web/dist/index.html`** — run `npm run build:web` before `dev:worker` or the tests.

**Port already in use** — something is still on 8787/8791/8793. `pkill -f wrangler` (macOS/Linux)
or stop the process; the test harness also reuses a server that is already healthy on its port.

**`wrangler dev` prints "Unable to fetch the Request.cf object"** — harmless; it only affects
geolocation metadata that the game does not use.

**Playwright: "Executable doesn't exist"** — `cd tests/integration && npx playwright install chromium`.

**Deploy: "A migration for class RoomServer already exists" / class rename errors** — if you
deployed an earlier build that used `RoomDO`/`DirectoryDO`, add a `renamed_classes` entry to
`migrations` or deploy under a new Worker `name`.

**Deploy: D1 database not found** — the `database_id` in `wrangler.jsonc` is still the
placeholder; run `wrangler d1 create salvage-rights` and paste the id in both places.

**The Broker says "Read by the station computer"** — the model is not configured or failed; check
`AI_PROVIDER`, the `ANTHROPIC_API_KEY` secret, and `wrangler tail` for `anthropic error` lines.

**Fonts look different locally** — the client loads Chakra Petch and Instrument Sans from Google
Fonts; offline or behind a proxy it falls back to system fonts. Production is unaffected.

**Room links give a blank page** — the Worker serves the client as a single-page app; make sure
`assets.not_found_handling` is `"single-page-application"` (it is, in both environments).
