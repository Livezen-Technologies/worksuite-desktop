import type { AiRules, AiUpload, DesktopPolicy } from '@shared/types';
import { DesktopError } from '../main/errors';

/**
 * The AI assistant's desktop service (WS-AI-SRS-001 DSK-2, DSK-5…7): what the
 * main process does for the assistant that a page must not do for itself.
 *
 *  · THE RULES. What this computer may do with the assistant is the stricter
 *    of two answers: the device policy (an administrator's, signed or from
 *    MDM) and the company's AI policy on the server (`/api/ai/assist/device`).
 *    Quick Ask, Insert and local files each need both.
 *  · CONFIRMING. A proposal is confirmed here, never through the page's API
 *    proxy (which refuses the route): the handler has already checked the
 *    request came from the main window — not Quick Ask, not a notification —
 *    and the router audits it.
 *  · LOCAL FILES. Only a file the person picked, read here, sized here, and
 *    sent here — or, when it is a synced Drive file, not sent at all: it is
 *    asked about by its Drive id.
 */

export interface AiServiceDeps {
  get: <T>(path: string, query?: Record<string, string | number | boolean | undefined>) => Promise<T>;
  post: <T>(path: string, body: unknown) => Promise<T>;
  /** A POST answered as Server-Sent Events (`ai/assist/chat/stream`); refusals throw. Absent: no streaming. */
  postStream?: (path: string, body: unknown) => Promise<Response>;
  policy: () => DesktopPolicy | null;
  /** The Drive id of a synced file at this real path, or null. */
  driveIdAt: (realPath: string) => number | null;
  realpath: (path: string) => Promise<string>;
  size: (path: string) => Promise<number>;
  read: (path: string) => Promise<Buffer>;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** What the server says before it has been asked: nothing on. */
const CLOSED: AiRules = { enabled: false, quickAsk: false, insert: false, localFiles: false, note: null };

export class AiService {
  private server: { enabled: boolean; quick_ask: boolean; insert: boolean; local_files: boolean } | null = null;

  constructor(private readonly deps: AiServiceDeps) {}

  /** Ask the server again (at sign-in, and when the policy may have changed). */
  async refresh(): Promise<AiRules> {
    try {
      this.server = await this.deps.get<{ enabled: boolean; quick_ask: boolean; insert: boolean; local_files: boolean }>('/api/ai/assist/device');
    } catch (e) {
      // A server from before the assistant's desktop service has no such route: Quick Ask and
      // Insert go on as they did (the writing assistant), and there is nowhere to send a file.
      if (e instanceof DesktopError && e.status === 404) this.server = { enabled: true, quick_ask: true, insert: true, local_files: false };
      // Unreachable or refused: keep the last answer. None yet means everything stays off.
    }
    return this.rules();
  }

  forget(): void {
    this.server = null;
  }

  /** The stricter of the device policy and the company's, now. */
  rules(): AiRules {
    const s = this.server;
    if (!s) return CLOSED;
    const p = this.deps.policy();
    const device = { quickAsk: p?.ai_quick_ask !== false, insert: p?.ai_insert !== false, localFiles: p?.ai_local_files !== false };
    const off = [
      s.enabled && !device.quickAsk ? 'Quick Ask' : null,
      s.enabled && !device.insert ? 'Insert' : null,
      s.enabled && !device.localFiles ? 'files from this computer' : null,
    ].filter((x): x is string => !!x);
    return {
      enabled: s.enabled,
      quickAsk: s.enabled && s.quick_ask && device.quickAsk,
      insert: s.insert && device.insert,
      localFiles: s.local_files && device.localFiles,
      note: off.length ? `Your administrator has switched off ${off.join(', ')} on this computer.` : null,
    };
  }

  /**
   * Confirm one proposal with the nonce its card was shown (and, for levels 4–5, the typed phrase and an
   * authenticator code when the server asks for step-up). The caller has checked the sender.
   */
  async confirm(id: number, nonce: string, extra: { phrase?: string; stepUpCode?: string } = {}): Promise<unknown> {
    const send = async () => {
      const token = await this.confirmToken(id);
      return this.deps.post(`/api/ai/pending/${id}/confirm`, {
        nonce,
        ...(token ? { confirm_token: token } : {}),
        ...(extra.phrase ? { phrase: extra.phrase } : {}),
        ...(extra.stepUpCode ? { step_up: { code: extra.stepUpCode } } : {}),
      });
    };
    try {
      return await send();
    } catch (e) {
      // G-14 §9: a token refused (409 confirm_token_*) or demanded (428 confirm_token_required) — a fresh one, once.
      if (!tokenRefusal(e)) throw e;
      return send();
    }
  }

  /**
   * One question to WorkSuite AI, streamed (G-22, `POST ai/assist/chat/stream`): each `delta` goes to `onDelta` as
   * the answer so far; the `done` payload — the same as `assist/chat`'s data, whose `reply` is the whole answer —
   * is returned. A server without the route (404/405) is asked through `assist/chat`, whole.
   */
  async ask(body: Record<string, unknown>, onDelta: (soFar: string) => void): Promise<unknown> {
    if (this.deps.postStream) {
      let res: Response | null = null;
      try {
        res = await this.deps.postStream('/api/ai/assist/chat/stream', body);
      } catch (e) {
        if (!(e instanceof DesktopError && (e.status === 404 || e.status === 405))) throw e;
      }
      if (res) return readTurn(res, onDelta);
    }
    return this.deps.post('/api/ai/assist/chat', body);
  }

  /**
   * A fresh confirmation token (G-14): single-use, 120 seconds, asked for on the click and kept in memory only for
   * the one confirm it goes with. A server without the route (404) has none, and the nonce alone is sent.
   */
  private async confirmToken(id: number): Promise<string | null> {
    try {
      const r = await this.deps.post<{ token?: unknown }>(`/api/ai/pending/${id}/confirm-token`, { client: 'desktop' });
      return typeof r?.token === 'string' && /^ct_[A-Za-z0-9_-]{8,76}$/.test(r.token) ? r.token : null;
    } catch (e) {
      if (e instanceof DesktopError && (e.status === 404 || e.status === 405)) return null;
      throw e;
    }
  }

  /**
   * A file the person picked, as context: its Drive id when it is a synced
   * Drive file, otherwise its words, sent for a day. Refused here when either
   * policy says no — and the server refuses the upload again if the
   * company's does.
   */
  async upload(path: string): Promise<AiUpload> {
    if (!this.rules().localFiles) {
      throw new DesktopError('POLICY_DENIED', 'Files from this computer cannot be sent to the assistant here. Put the file in your Drive and ask about it there.');
    }
    const real = await this.deps.realpath(path);
    const name = real.split(/[\\/]/).pop() || 'file';
    const driveId = this.deps.driveIdAt(real);
    if (driveId) return { ref: `file:${driveId}`, name, via: 'drive' };

    const bytes = await this.deps.size(real);
    if (bytes <= 0) throw new DesktopError('IPC_VALIDATION_FAILED', 'That file is empty.');
    if (bytes > MAX_UPLOAD_BYTES) throw new DesktopError('IPC_VALIDATION_FAILED', 'That file is larger than 10 MB. Ask about part of it, or put it in your Drive.');

    const content = (await this.deps.read(real)).toString('base64');
    const r = await this.deps.post<{ ref: string; name: string }>('/api/ai/context/uploads', { name, content });
    return { ref: r.ref, name: r.name || name, via: 'upload' };
  }
}

function tokenRefusal(e: unknown): boolean {
  if (!(e instanceof DesktopError) || (e.status !== 409 && e.status !== 428)) return false;
  const why = (e.data as { confirm_token?: unknown } | null)?.confirm_token;
  return typeof why === 'string' && why.startsWith('confirm_token_');
}

/** Reads an `assist/chat/stream` answer: deltas as they come, then exactly one `done` or `error` (API.md §11). */
export async function readTurn(res: Response, onDelta: (soFar: string) => void): Promise<unknown> {
  if (!res.body) throw new DesktopError('SERVER_ERROR', 'The assistant answered with nothing.');
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += value.replace(/\r\n?/g, '\n');
    let cut: number;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (!data.length) continue;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(data.join('\n')) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (event === 'delta' && typeof payload.text === 'string') {
        text += payload.text;
        onDelta(text);
      } else if (event === 'done') {
        void reader.cancel().catch(() => undefined);
        return payload;
      } else if (event === 'error') {
        void reader.cancel().catch(() => undefined);
        const status = typeof payload.status === 'number' ? payload.status : 502;
        throw new DesktopError('SERVER_ERROR', typeof payload.message === 'string' && payload.message ? payload.message : 'The assistant could not answer just now.', status, payload.turn ?? null);
      }
    }
    if (done) break;
  }
  throw new DesktopError('SERVER_ERROR', 'The answer stopped before it was finished. Try again.');
}
