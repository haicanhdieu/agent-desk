import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['json', 'json-summary', 'lcov', 'text-summary'],
      reportsDirectory: './coverage',
      include: ['src/**'],
      exclude: [
        '**/*.d.ts',
        '**/*.test.{ts,tsx}',
        '**/*.stories.{ts,tsx}',
        '**/mocks/**',
        '**/fixtures/**',
        '**/test/**',
      ],
    },
  },
});
