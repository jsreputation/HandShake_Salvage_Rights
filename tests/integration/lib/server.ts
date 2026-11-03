import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const WORKER_DIR = path.resolve(here, '../../../apps/worker');
export const WEB_OUT = path.resolve(here, '../../../apps/web/dist');

export interface LocalServer {
  port: number;
  base: string;
  stop: () => Promise<void>;
}

async function waitForHealth(base: string, timeoutMs: number): Promise<void> {
  const t0 = Date.now();
  let lastErr: unknown;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`wrangler dev did not become healthy at ${base} within ${timeoutMs}ms: ${String(lastErr)}`);
}

/**
 * Boot `wrangler dev --env local` (workerd + Durable Objects, no Cloudflare credentials needed)
 * serving the built Next.js export. Reuses a server that is already listening on the port.
 */
export async function startLocalServer(port = Number(process.env.DC_TEST_PORT ?? 8791)): Promise<LocalServer> {
  const base = `http://localhost:${port}`;
  if (!existsSync(path.join(WEB_OUT, 'index.html'))) {
    throw new Error(`Missing ${WEB_OUT}/index.html — run "npm run build:web" first.`);
  }
  try {
    const res = await fetch(`${base}/api/health`);
    if (res.ok) return { port, base, stop: async () => undefined };
  } catch {
    /* not running: start one */
  }

  // The local D1 database needs the schema before the Worker records its first finished game.
  const migrate = spawnSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'salvage-rights', '--local', '--env', 'local'], { cwd: WORKER_DIR, encoding: 'utf8' });
  if (migrate.status !== 0) throw new Error(`D1 migration failed:\n${migrate.stdout}\n${migrate.stderr}`);

  const child: ChildProcess = spawn('npx', ['wrangler', 'dev', '--env', 'local', '--port', String(port)], {
    cwd: WORKER_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
  });
  let log = '';
  child.stdout?.on('data', (d) => (log += String(d)));
  child.stderr?.on('data', (d) => (log += String(d)));

  try {
    await waitForHealth(base, 90_000);
  } catch (err) {
    kill(child);
    throw new Error(`${(err as Error).message}\n--- wrangler output ---\n${log.slice(-4000)}`);
  }

  return {
    port,
    base,
    stop: async () => {
      kill(child);
      await new Promise((r) => setTimeout(r, 300));
    },
  };
}

function kill(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}
