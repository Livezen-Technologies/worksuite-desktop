/**
 * Utility process: SHA-256 hashing off the main and renderer threads
 * (FR-DIAG-07). No network access is used here; it reads only the files the
 * main process names, which are dialog results or real drops.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

interface HashRequest {
  type: 'hash';
  id: string;
  path: string;
}

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

port.on('message', (e: { data: HashRequest | Ping }) => {
  const msg = e.data;
  if (msg.type === 'ping') {
    port.postMessage({ type: 'pong', n: msg.n });
    return;
  }
  if (msg.type === 'hash') {
    hashFile(msg.path)
      .then((r) => port.postMessage({ type: 'hash', id: msg.id, ok: true, ...r }))
      .catch((err: Error) => port.postMessage({ type: 'hash', id: msg.id, ok: false, error: err.message }));
  }
});

port.postMessage({ type: 'ready' });
