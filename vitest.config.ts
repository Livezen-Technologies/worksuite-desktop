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
  },
});
