import { apiGet, apiPost, apiPut } from '../../../core/api';
import type { SupportOutcome } from '@shared/support-session';

/**
 * Remote support, as this app asks for it (WS-MEET-ENH-01 RC10, RC11, RC17).
 *
 * The shapes mirror the server's own (`RemoteSupportService`,
 * `SupportAssist`), and the web client's `lib/remoteControl/support.ts`, so
 * three readings of one feature do not drift. Nothing is computed here: the
 * server decides who may see the notes and the AI, whether AI assist is
 * available at all, and what a code is worth.
 */

export interface SupportTicket {
  id: number;
  reference: string;
  subject: string;
  priority: string;
  status: string;
}

export interface SupportPanel {
  uuid: string;
  title: string | null;
  ticket: SupportTicket | null;
  agent: { id: number; name: string | null };
  supported: { id: number; name: string | null } | null;
  reason: string | null;
  /** The computer whose screen is shared, when one is. */
  device: string | null;
  started_at: string | null;
  ended_at: string | null;
  control: { status: string; caps_label: string; approved_at: string | null; approved_by: string | null; mfa_passed: boolean; duration: string | null } | null;
  recording: string;
  files: Array<{ name: string; status: string; at: string | null }>;
  /** Agents only — the server removes it for the person being helped. */
  notes?: string;
  outcome: SupportOutcome | null;
  /** Agents only, and `enabled` is the server's answer, never this app's guess. */
  ai?: { enabled: boolean; assist: boolean; reads: string };
  is_agent: boolean;
}

/** A code: nine digits, once, for ten minutes. */
export interface SupportCode {
  code: string;
  display: string;
  expires_in: number;
  invite_url: string;
}

export interface AiDraft {
  kind: 'summary' | 'checklist' | 'ticket_note';
  text: string;
  items: string[];
  /** The server marks every one of these a draft; nothing is kept until asked. */
  draft: true;
}

/** What a redeemed code opens. It never grants control — joining still goes through the lobby. */
export interface SupportJoin {
  uuid: string;
  title: string | null;
  agent: string | null;
  company: string | null;
}

export const support = {
  panel: (uuid: string, signal?: AbortSignal) => apiGet<SupportPanel>(`/api/meet/support/sessions/${uuid}`, undefined, signal),
  code: (uuid: string) => apiPost<SupportCode>(`/api/meet/support/sessions/${uuid}/code`, {}),
  join: (code: string) => apiPost<SupportJoin>('/api/meet/support/join', { code }),
  notes: (uuid: string, notes: string) => apiPut<null>(`/api/meet/support/sessions/${uuid}/notes`, { notes }),
  ai: (uuid: string, kind: AiDraft['kind']) => apiPost<AiDraft>(`/api/meet/support/sessions/${uuid}/ai/${kind}`, {}),
  keep: (uuid: string, target: 'chat' | 'ticket', text: string) => apiPost<null>(`/api/meet/support/sessions/${uuid}/keep`, { target, text }),
  end: (uuid: string, outcome: SupportOutcome) => apiPost<{ seconds: number; outcome: string }>(`/api/meet/support/sessions/${uuid}/end`, { outcome }),
};
