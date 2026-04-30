import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration tests hit the public internet (HN Algolia, CB News RSS, YC).
    // They are skipped by default; opt in with `RUN_INTEGRATION=1 npm test`.
    exclude: process.env.RUN_INTEGRATION === '1'
      ? []
      : ['test/integration/**'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    clearMocks: true,
    restoreMocks: true,
    typecheck: { enabled: false },
  },
});
