/**
 * Utility process: SHA-256 hashing off the main and renderer threads
 * (FR-DIAG-07). No network access is used here; it reads only the files the
 * main process names: dialog results, real drops, and files in a folder the
 * person chose to sync.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';

interface HashRequest {
  type: 'hash' | 'blocks';
  id: string;
  path: string;
}

/** Drive sync's block size (SyncEngine::BLOCK_SIZE on the server). */
const BLOCK = 4 * 1024 * 1024;

interface Ping {
  type: 'ping';
  n: number;
}

const port = process.parentPort;

function hashFile(path: string): Promise<{ sha256: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    let bytes = 0;
    const s = createReadStream(path, { highWaterMark: 4 * 1024 * 1024 });
    s.on('data', (chunk) => {
      bytes += chunk.length;
      h.update(chunk);
    });
    s.on('error', reject);
    s.on('end', () => resolve({ sha256: h.digest('hex'), bytes }));
  });
}

/**
 * Drive sync: the whole file's SHA-256 and each 4 MiB block's, in one read.
 * Blocks are read at exact offsets, so the hashes are the server's manifest.
 */
async function hashBlocks(path: string): Promise<{ sha256: string; bytes: number; blocks: string[] }> {
  const fh = await open(path, 'r');
  try {
    const whole = createHash('sha256');
    const blocks: string[] = [];
    const buf = Buffer.alloc(BLOCK);
    let bytes = 0;
    for (;;) {
      let filled = 0;
      while (filled < BLOCK) {
        const { bytesRead } = await fh.read(buf, filled, BLOCK - filled, bytes + filled);
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      if (filled === 0) break;
      const chunk = buf.subarray(0, filled);
      whole.update(chunk);
      blocks.push(createHash('sha256').update(chunk).digest('hex'));
      bytes += filled;
      if (filled < BLOCK) break;
    }
    return { sha256: whole.digest('hex'), bytes, blocks };
  } finally {
    await fh.close();
  }
}

port.on('message', (e: { data: HashRequest | Ping }) => {
  const msg = e.data;
  if (msg.type === 'ping') {
    port.postMessage({ type: 'pong', n: msg.n });
    return;
  }
  if (msg.type === 'blocks') {
    hashBlocks(msg.path)
      .then((r) => port.postMessage({ type: 'hash', id: msg.id, ok: true, ...r }))
      .catch((err: Error) => port.postMessage({ type: 'hash', id: msg.id, ok: false, error: err.message }));
    return;
  }
  if (msg.type === 'hash') {
    hashFile(msg.path)
      .then((r) => port.postMessage({ type: 'hash', id: msg.id, ok: true, ...r }))
      .catch((err: Error) => port.postMessage({ type: 'hash', id: msg.id, ok: false, error: err.message }));
  }
});

port.postMessage({ type: 'ready' });
