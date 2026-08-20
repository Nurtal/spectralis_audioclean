import { defineConfig } from 'vitest/config';

// audio/ est du TypeScript pur, sans DOM : les tests tournent en node.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
