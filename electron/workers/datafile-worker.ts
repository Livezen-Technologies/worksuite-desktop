/**
 * Utility process: one mail data file — a .pst, an .mbox, a folder of .eml
 * or .msg, or one message file opened to read (ENH-MAIL-03 §3.1, DMO-DAT).
 *
 * Untrusted bytes are parsed here, never in the renderer and never in the
 * main process; a damaged file that crashes the parser ends this process
 * only. It reads the one file (or folder) the main process names, read-only,
 * and nothing else: no network, no writes, no child processes. Memory is
 * capped by the main process when it starts this (--max-old-space-size).
 */
import { createWorkerHandler, type WorkerRequest } from '../services/mail-files/worker-protocol';

const port = process.parentPort;
const handle = createWorkerHandler();
// The parser library reports unreadable folders on the console as well as by throwing; those are answered, not printed.
console.error = () => undefined;
console.log = () => undefined;
port.on('message', (e: { data: WorkerRequest }) => {
  void handle(e.data).then((r) => port.postMessage(r));
});
