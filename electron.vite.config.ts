import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const shared = { '@shared': resolve(__dirname, 'shared') };

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        // node:sqlite exists only with the node: prefix, which the build
        // host's builtin list may not know; it is always provided by Electron.
        external: ['node:sqlite'],
        input: {
          index: resolve(__dirname, 'electron/main/index.ts'),
          // Utility processes (§3.2): hashing and other CPU work never runs on
          // the main or renderer thread.
          'hash-worker': resolve(__dirname, 'electron/workers/hash-worker.ts'),
        },
      },
    },
  },
  preload: {
    resolve: { alias: shared },
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts'),
          // WorkSuite Office's editor view: its own bridge, never the shell's.
          'office-host': resolve(__dirname, 'electron/preload/office-host.ts'),
        },
        // A sandboxed preload cannot load other files: everything it needs is
        // bundled into one CommonJS script. Neither imports the other or
        // anything dynamically, so each input is one file (a test checks).
        output: { format: 'cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    resolve: { alias: { ...shared, '@': resolve(__dirname, 'src') } },
    plugins: [react(), tailwindcss()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: { input: resolve(__dirname, 'src/index.html') },
    },
  },
});
