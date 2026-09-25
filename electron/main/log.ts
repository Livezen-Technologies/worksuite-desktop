import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { redact, redactString } from '@shared/redact';

/**
 * Structured, redacted, rotating log. Every field passes through `redact`
 * before it is written, so a token handed to the logger by mistake is never
 * on disk (NFR-PRV-02). A ring buffer keeps the recent lines for Diagnostics.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 3;
const RING = 500;

let dir: string | null = null;
const ring: string[] = [];
let redactions = 0;

export function initLog(logDir: string): void {
  dir = logDir;
}

function file(): string | null {
  return dir ? join(dir, 'main.log') : null;
}

function rotate(path: string): void {
  try {
    if (!existsSync(path) || statSync(path).size < MAX_BYTES) return;
    for (let i = KEEP - 1; i >= 1; i--) {
      const from = `${path}.${i}`;
      if (existsSync(from)) {
        if (i === KEEP - 1) unlinkSync(from);
        else renameSync(from, `${path}.${i + 1}`);
      }
    }
    renameSync(path, `${path}.1`);
  } catch {
    /* logging must never throw */
  }
}

function write(level: Level, scope: string, message: string, data?: unknown): void {
  const safeMessage = redactString(message);
  if (safeMessage !== message) redactions++;
  const entry: Record<string, unknown> = { t: new Date().toISOString(), level, scope, msg: safeMessage };
  if (data !== undefined) entry.data = redact(data);
  const line = JSON.stringify(entry);
  ring.push(line);
  if (ring.length > RING) ring.shift();
  if (level === 'error' || level === 'warn' || process.env.WS_DEBUG) {
    (level === 'error' ? console.error : console.log)(`[${scope}] ${safeMessage}`);
  }
  const path = file();
  if (!path) return;
  rotate(path);
  try {
    appendFileSync(path, line + '\n', { mode: 0o600 });
  } catch {
    /* disk full or read-only: keep running */
  }
}

export function logger(scope: string) {
  return {
    debug: (msg: string, data?: unknown) => write('debug', scope, msg, data),
    info: (msg: string, data?: unknown) => write('info', scope, msg, data),
    warn: (msg: string, data?: unknown) => write('warn', scope, msg, data),
    error: (msg: string, data?: unknown) => write('error', scope, msg, data),
  };
}

export function recentLog(): string[] {
  return [...ring];
}

export function logFiles(): string[] {
  const path = file();
  if (!path) return [];
  const out = [path];
  for (let i = 1; i <= KEEP; i++) if (existsSync(`${path}.${i}`)) out.push(`${path}.${i}`);
  return out.filter((p) => existsSync(p));
}

export function redactionCount(): number {
  return redactions;
}
