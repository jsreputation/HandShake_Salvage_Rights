import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.E2E_PORT ?? 8793);

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'dot' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npx wrangler d1 migrations apply salvage-rights --local --env local && npx wrangler dev --env local --port ${PORT}`,
    cwd: path.resolve(here, '../../apps/worker'),
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: true,
    timeout: 90_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
