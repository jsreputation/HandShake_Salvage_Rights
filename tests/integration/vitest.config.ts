import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['protocol/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    reporters: process.env.CI ? ['dot'] : ['default'],
  },
});
