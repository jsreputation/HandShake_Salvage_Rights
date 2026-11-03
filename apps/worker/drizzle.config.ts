import { defineConfig } from 'drizzle-kit';

// `npx drizzle-kit generate` writes SQL migrations to ./drizzle; apply them with
//   wrangler d1 migrations apply salvage-rights --local   (dev/tests)
//   wrangler d1 migrations apply salvage-rights --remote  (production)
export default defineConfig({
  dialect: 'sqlite',
  driver: 'd1-http',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
