import type { Caps, GrantClaims } from '@shared/remote-control/channel';
import { ApiError, apiDelete, apiGet, apiPost } from '../../../core/api';

/**
 * Meet remote control, the controller's end (WS-MEET-ENH-01 §F.1): the API
 * and the sentences the screens use, as the web client has them.
 *
 * Everything a participant's screen needs arrives in one read, `state()`,
 * polled while in a meeting and read again at once on `meet.control`.
 */

export type ShareClient = 'web' | 'desktop' | 'mobile';
export type ShareSurface = 'screen' | 'window' | 'tab';

export interface Availability {
  can_request: boolean;
  code: string;
  reason: string;
  pointer: boolean;
  annotate: boolean;
  handover: boolean;
  notes: { ok: boolean; text: string }[];
}

export interface Share {
  id: number;
  user_id: number;
  name: string;
  identity: string;
  client: ShareClient;
  surface: ShareSurface;
  label: string;
  allow_requests: boolean;
  quality: string;
  status: string;
  paused: boolean;
  started_at: string;
  device: { platform: string | null; os_version: string | null; desktop_version: string | null; display_server: string | null; displays: number; report: string } | null;
  availability: Availability;
}

export interface ControlRequest {
  id: number;
  session_id: number;
  share_id: number;
  kind: 'request' | 'handover' | 'increase';
  requester: { id: number; name: string };
  sharer: { id: number; name: string };
  reason: string | null;
  expires_in: number;
  status: string;
}

export type ControlStatus = 'CONTROL_REQUESTED' | 'CONTROL_APPROVED' | 'CONTROL_ACTIVE' | 'CONTROL_PAUSED' | 'CONTROL_REVOKED' | 'SHARING_STOPPED' | 'SHARING_VIEW_ONLY';

export interface ControlSession {
  id: number;
  share_id: number;
  status: ControlStatus;
  role: 'sharer' | 'controller';
  pause_reason: string | null;
  caps: Caps;
  caps_label: string;
  sharer: { id: number; name: string; identity: string };
  controller: { id: number; name: string; identity: string };
  reason: string | null;
  duration: string | null;
  approved_at: string | null;
  started_at: string | null;
  expires_at: string | null;
  key_version: number | null;
  grant_waiting: boolean;
  type: 'meeting' | 'support' | 'call';
  ticket_id: number | null;
  mfa_passed: boolean;
}

export interface MeetingOptions {
  remote_control_mode: 'disabled' | 'participants' | 'hosts';
  viewer_pointer: boolean;
  share_mode: 'everyone' | 'hosts';
  record_type: string | null;
  can_edit: boolean;
  is_host: boolean;
}

export interface ControlState {
  shares: Share[];
  requests: ControlRequest[];
  asked: ControlRequest[];
  sessions: ControlSession[];
  options: MeetingOptions;
  server: { signing: boolean; lease_s: number; lease_renew_s: number };
  at: number;
}

export interface GrantDelivery {
  token: string;
  key: string;
  claims: GrantClaims;
  public_key: string | null;
  rate: { pointer_per_s: number; key_per_s: number; click_per_s: number };
}

/** The part of a finished session's record that says how it ended. */
/** A file offered in a remote-control session (RC06). */
export interface RemoteFile {
  id: number;
  session_id: number;
  direction: 'to_sharer' | 'to_controller';
  sender: { id: number; name: string };
  receiver_id: number;
  name: string;
  size: number;
  executable: boolean;
  scan: 'clean' | 'not_scanned' | 'infected';
  status: 'offered' | 'accepted' | 'declined' | 'downloaded' | 'purged';
}

/** The one-time token in an accepted file's download address. */
export function downloadToken(download: string): string | null {
  return /[?&]t=([A-Za-z0-9_-]{16,128})(?:&|$)/.exec(download)?.[1] ?? null;
}

export interface SessionEnd {
  id: number;
  termination: string | null;
  ended_by: string;
  ended_at: string | null;
}

export const rc = {
  state: (uuid: string) => apiGet<ControlState>(`/api/meet/${uuid}/control/state`),
  request: (uuid: string, body: { share_id: number; identity: string; reason?: string }) =>
    apiPost<{ request_id: number; session_id: number; expires_in: number; handover: boolean }>(`/api/meet/${uuid}/control/requests`, body),
  cancel: (requestId: number) => apiDelete(`/api/meet/control/requests/${requestId}`),
  grant: (sessionId: number) => apiGet<GrantDelivery>(`/api/meet/control/sessions/${sessionId}/grant`, { end: 'controller' }),
  confirm: (sessionId: number) => apiPost(`/api/meet/control/sessions/${sessionId}/confirm`, { end: 'controller' }),
  lease: (sessionId: number) => apiPost(`/api/meet/control/sessions/${sessionId}/lease`, {}),
  stop: (sessionId: number, reason = 'released') => apiPost(`/api/meet/control/sessions/${sessionId}/stop`, { reason }),
  quality: (sessionId: number, label: string) => apiPost(`/api/meet/control/sessions/${sessionId}/quality`, { label }),
  session: (sessionId: number) => apiGet<SessionEnd>(`/api/meet/control/sessions/${sessionId}`),
  stepUp: (code: string) => apiPost('/api/meet/control/step-up', { code }),
  files: (sessionId: number) => apiGet<{ files: RemoteFile[] }>(`/api/meet/control/sessions/${sessionId}/files`),
  acceptFile: (id: number, confirmExecutable = false) => apiPost<{ download: string }>(`/api/meet/control/files/${id}/accept`, { confirm_executable: confirmExecutable }),
  declineFile: (id: number) => apiPost(`/api/meet/control/files/${id}/decline`, {}),
};

/**
 * The message a failed request carries, and its code when the server gave
 * one. The server puts the code in `errors.code`, which `ApiError` keeps as `data`.
 */
export function failure(e: unknown, fallback = 'Something went wrong.'): { message: string; code: string | null; status: number | null } {
  if (e instanceof ApiError) {
    const inner = e.data && typeof e.data === 'object' ? (e.data as { code?: unknown }).code : null;
    return { message: e.message || fallback, code: e.code ?? (typeof inner === 'string' ? inner : null), status: e.status };
  }
  return { message: fallback, code: null, status: null };
}

/** "Screen 1", "a window", "a browser tab": how a share is named in a sentence. */
export function shareWhat(s: Pick<Share, 'label' | 'surface'>): string {
  if (s.label) return s.label;
  return s.surface === 'tab' ? 'a browser tab' : s.surface === 'window' ? 'a window' : 'their screen';
}

export const POLICY_OFF = 'Controlling other computers is turned off on this computer by its policy.';

/** What a viewer is offered under a shared screen (RC02, RC-AVL-01). */
export type Offer = { kind: 'none' } | { kind: 'policy'; text: string } | { kind: 'request'; hint: string | null } | { kind: 'reason'; text: string; notes: { ok: boolean; text: string }[] };

/**
 * "Request control" when the server says it can be asked for, else the
 * server's own sentence. This computer's policy comes first: when it turns
 * controlling off, the button is never offered.
 */
export function offerFor(share: Share | undefined, policyOff: boolean): Offer {
  if (!share) return { kind: 'none' };
  const a = share.availability;
  if (['own_share', 'controlling', 'pending'].includes(a.code)) return { kind: 'none' };
  if (policyOff) return { kind: 'policy', text: POLICY_OFF };
  if (a.can_request) return { kind: 'request', hint: a.handover ? 'Someone controls it now — the person sharing can hand control to you' : null };
  if (a.code === 'no_share' || (!a.reason && a.notes.length === 0)) return { kind: 'none' };
  return { kind: 'reason', text: a.reason, notes: a.notes };
}

/** How a pause is explained to the person controlling (RC07). */
export function pauseText(reason: string | null, sharer: string): string {
  switch (reason) {
    case 'protected_app':
      return `Protected screen — a password manager or banking app is in front on ${sharer}'s computer, so control is paused. It resumes only when ${sharer} resumes it.`;
    case 'lock_screen':
      return `${sharer}'s computer is locked. Control is paused until they unlock it and resume.`;
    case 'secure_desktop':
      return `A secure prompt (such as an administrator request) is on ${sharer}'s screen. WorkSuite never controls it — ${sharer} answers it themselves.`;
    case 'idle':
      return 'Paused after no input for a while. Only the person sharing can resume it.';
    case 'network':
      return 'Connection lost — revalidating before input resumes…';
    case 'sleep':
    case 'user_switch':
      return `${sharer}'s computer went to sleep or switched user, so control is paused.`;
    case 'share_paused':
      return `${sharer} paused sharing. Control pauses with it.`;
    case 'security':
      return 'Paused for a security check. Only the person sharing can resume it.';
    default:
      return `Remote control paused by ${sharer}. Only they can resume it.`;
  }
}

export type ConnectionLabel = 'Excellent' | 'Good' | 'Fair' | 'Poor' | '—';

/** Excellent / Good / Fair / Poor from round trip and loss (RC-CTL-02). */
export function connectionLabel(rttMs: number | null, lossPct: number | null): ConnectionLabel {
  if (rttMs === null) return '—';
  const loss = lossPct ?? 0;
  if (rttMs < 80 && loss < 1) return 'Excellent';
  if (rttMs < 150 && loss < 3) return 'Good';
  if (rttMs < 300 && loss < 8) return 'Fair';
  return 'Poor';
}

/** "Remote control ended by Hasarinda (emergency stop)" and the line under it, from the session's record. */
export function endedOf(d: SessionEnd | null, sharer: string): { by: string; reason: string } {
  if (!d) return { by: sharer, reason: 'Control has ended.' };
  const by = d.termination === 'emergency_stop' ? `${sharer} (emergency stop)` : d.ended_by === 'You' ? 'you' : d.ended_by || sharer;
  if (d.ended_by === 'Handed to someone else') return { by, reason: 'Control was handed to someone else.' };
  const at = d.ended_at ? new Date(d.ended_at.replace(' ', 'T') + (d.ended_at.endsWith('Z') ? '' : 'Z')) : null;
  return { by, reason: at && !isNaN(at.getTime()) ? `Ended at ${at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.` : 'Ended just now.' };
}
