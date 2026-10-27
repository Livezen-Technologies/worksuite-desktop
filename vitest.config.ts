import { localizationPlugin } from './build-tools/localization.mjs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [localizationPlugin(__dirname), react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    environment: 'node',
    setupFiles: ['tests/unit/setup.ts'],
    restoreMocks: true,
    // Line coverage (v8), measured by `npm run test:coverage` and in CI (audit D-G07). The floors are the coverage
    // measured on 2026-10-27, rounded down: they stop it falling, and are raised as tests are added.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'electron/**/*.ts', 'shared/**/*.ts'],
      exclude: ['**/*.d.ts', 'src/main.tsx', 'electron/workers/**', 'shared/locales/**'],
      reporter: ['text-summary', 'json-summary', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 63,
        statements: 63,
        functions: 57,
        branches: 77,
        // The five modules with the fewest tests for their size got API tests on 2026-10-27; these hold them there.
        'src/modules/label/**': { lines: 7 },
        'src/modules/cheque/**': { lines: 14 },
        'src/modules/events/**': { lines: 32 },
        'src/modules/payroll/**': { lines: 14 },
        'src/modules/appointments/**': { lines: 7 },
      },
    },
  },
});
