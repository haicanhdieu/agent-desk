/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';

/** The API (`apps/api`) in local dev. `vite --mode mock` serves everything from MSW in the browser instead. */
const API_ORIGIN = 'http://localhost:3000';

const proxy: Record<string, ProxyOptions> = {
  // ws: the run terminal socket (/api/runs/:runId/terminal).
  '/api': { target: API_ORIGIN, ws: true },
  '/auth': { target: API_ORIGIN },
  '/webhooks': { target: API_ORIGIN },
  '/dev': { target: API_ORIGIN },
};

export default defineConfig(({ mode }) => ({
  plugins: [
    // Must run before the React plugin. The generated tree is committed so typecheck works without a Vite run.
    tanstackRouter({
      target: 'react',
      routesDirectory: './src/app/routes',
      generatedRouteTree: './src/app/routeTree.gen.ts',
      quoteStyle: 'single',
      semicolons: true,
      autoCodeSplitting: true,
    }),
    react(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // No proxy in mock mode: a request MSW does not handle must fail, not reach a running API.
  server: mode === 'mock' ? {} : { proxy },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: { include: [/tokens\.css/], modules: { classNameStrategy: 'non-scoped' } },
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['json', 'json-summary', 'lcov', 'text-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.d.ts',
        '**/*.test.{ts,tsx}',
        '**/*.stories.{ts,tsx}',
        '**/mocks/**',
        '**/fixtures/**',
        '**/test/**',
        'src/app/routeTree.gen.ts',
      ],
    },
  },
}));
