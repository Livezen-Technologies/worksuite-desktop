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

  /** Confirm one proposal with the nonce its card was shown. The caller has checked the sender. */
  confirm(id: number, nonce: string): Promise<unknown> {
    return this.deps.post(`/api/ai/pending/${id}/confirm`, { nonce });
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
