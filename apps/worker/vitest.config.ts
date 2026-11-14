import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
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
