/**
 * Utility process: Sinhala Tools' heavy work (blueprint §6.1 "Main-process service"), so a large document never holds
 * up the main process or a window. It converts .docx packages with `@worksuite/sinhala-core` and the profiles the main
 * process hands it — already checked there (sha256, and the signature when one came) — and reads or writes only the
 * paths the main process names: a file the person dropped or picked, a Drive file's offline copy, and the converted
 * copy beside it. No network.
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import type { Profile } from '@worksuite/sinhala-core';
import { convertDocx } from '../services/sinhala-docx';

interface DocxRequest {
  type: 'docx';
  id: string;
  profiles: Profile[];
  targetFont: string;
  force: string | null;
  /** The source: a path, or the bytes (the built-in editor's document). */
  path?: string;
  bytes?: Uint8Array;
  /** Where the converted copy goes; without it the bytes come back. */
  outPath?: string;
}

interface Ping {
  type: 'ping';
  n: number;
}

const port = process.parentPort;

async function docx(req: DocxRequest) {
  const input = req.bytes ?? (req.path ? await readFile(req.path) : null);
  if (!input) throw new Error('Nothing to convert.');
  const { bytes, stats } = convertDocx(input, { profiles: req.profiles, targetFont: req.targetFont, force: req.force });
  if (req.outPath) {
    // Written beside, then moved into place: a half-written copy never has the final name.
    const tmp = `${req.outPath}.${process.pid}.part`;
    await writeFile(tmp, bytes);
    await rename(tmp, req.outPath);
    return { stats };
  }
  return { stats, bytes: new Uint8Array(bytes) };
}

port.on('message', (e: { data: DocxRequest | Ping }) => {
  const msg = e.data;
  if (msg.type === 'ping') {
    port.postMessage({ type: 'pong', n: msg.n });
    return;
  }
  if (msg.type === 'docx') {
    docx(msg)
      .then((r) => port.postMessage({ type: 'docx', id: msg.id, ok: true, ...r }))
      .catch((err: Error) => port.postMessage({ type: 'docx', id: msg.id, ok: false, error: err.message }));
  }
});

port.postMessage({ type: 'ready' });
