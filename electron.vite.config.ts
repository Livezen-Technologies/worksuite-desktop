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
          // PDF Studio: one per open document, PDFium (WebAssembly) inside (§3.4, §3.5).
          'pdf-worker': resolve(__dirname, 'electron/workers/pdf-worker.ts'),
        },
      },
    },
  },
  preload: {
    resolve: { alias: shared },
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        // The shell's bridge, and the Office editor's (a page of its own partition, with none of the shell's).
        input: { index: resolve(__dirname, 'electron/preload/index.ts'), office: resolve(__dirname, 'electron/preload/office.ts') },
        // A sandboxed preload cannot load other files: each is one CommonJS script that imports only
        // `electron` (two entries cannot inline dynamic imports, and neither has any).
        output: { format: 'cjs', entryFileNames: '[name].js' },
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
