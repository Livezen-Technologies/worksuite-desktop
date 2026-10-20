import { localizationPlugin } from './build-tools/localization.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const shared = { '@shared': resolve(__dirname, 'shared') };

/**
 * Meeting transcripts on this computer (worksuite-desktop#81): whisper.cpp built for the web. Its script starts its
 * own threads from its own address (`new URL('shout.wasm.js', import.meta.url)`), so it is copied as it is to a fixed
 * place beside the speech page rather than bundled under a hashed name.
 */
const SHOUT = resolve(__dirname, 'node_modules/@transcribe/shout/src/shout');
const SHOUT_FILES = ['shout.wasm.js', 'shout.wasm_no-simd.js'];
function speechEngine(): Plugin {
  return {
    name: 'worksuite-speech-engine',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // The speech page is cross-origin isolated, as the app's own protocol serves it (app-protocol.ts).
        if (req.url?.startsWith('/speech')) {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        }
        const name = req.url?.match(/^\/speech\/(shout\.wasm(?:_no-simd)?\.js)(?:\?|$)/)?.[1];
        if (!name) return next();
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        res.end(readFileSync(resolve(SHOUT, name)));
      });
    },
    generateBundle() {
      for (const name of SHOUT_FILES) this.emitFile({ type: 'asset', fileName: `speech/${name}`, source: readFileSync(resolve(SHOUT, name)) });
    },
  };
}

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        // node:sqlite exists only with the node: prefix, which the build
        // host's builtin list may not know; it is always provided by Electron.
        // tesseract.js starts its own worker thread from its own files (services/ocr.ts), so it is loaded as installed.
        external: ['node:sqlite', 'node-llama-cpp', 'tesseract.js'],
        input: {
          index: resolve(__dirname, 'electron/main/index.ts'),
          // Utility processes (§3.2): hashing and other CPU work never runs on
          // the main or renderer thread.
          'hash-worker': resolve(__dirname, 'electron/workers/hash-worker.ts'),
          // PDF Studio: one per open document, PDFium (WebAssembly) inside (§3.4, §3.5).
          'pdf-worker': resolve(__dirname, 'electron/workers/pdf-worker.ts'),
          // Local AI (WS-SRS-LAI §3.2): llama.cpp, started on first use, away from the UI.
          'local-ai-worker': resolve(__dirname, 'electron/workers/local-ai-worker.ts'),
          // Mail data files (ENH-MAIL-03 §3.1): .pst, .mbox, .eml and .msg read away from the UI, one file per process.
          'datafile-worker': resolve(__dirname, 'electron/workers/datafile-worker.ts'),
          // Sinhala Tools (blueprint §6.1): whole documents converted away from the UI.
          'sinhala-worker': resolve(__dirname, 'electron/workers/sinhala-worker.ts'),
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
    plugins: [localizationPlugin(__dirname), react(), tailwindcss(), speechEngine()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      // The speech page is its own: isolated (for whisper.cpp's threads), hidden, and only for transcribing.
      rollupOptions: { input: { index: resolve(__dirname, 'src/index.html'), speech: resolve(__dirname, 'src/speech.html') } },
    },
  },
});
