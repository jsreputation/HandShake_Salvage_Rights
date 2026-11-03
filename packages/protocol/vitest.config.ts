import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    reporters: process.env.CI ? ['dot'] : ['default'],
  },
});
