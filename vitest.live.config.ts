import { defineConfig } from 'vitest/config';

// Live tests talk to real model servers and are never part of `npm test`.
// Run them with `npm run test:live` (see tests/live/README.md).
export default defineConfig({
  test: {
    include: ['tests/live/**/*.test.ts'],
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 60_000,
  },
});
