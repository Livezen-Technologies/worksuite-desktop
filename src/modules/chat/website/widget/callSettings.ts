import { apiGet, apiPut } from '../../../../core/api';
import { text } from '../../../../core/i18n';
import { WEBSITE } from '../api';

/**
 * Widget settings › Live status & calls (V-05, VOICE-UI-04): what the visitor sees of the team — typing and the
 * Sent / Delivered / Read line (LIVE-09, LIVE-10) — and voice calls from the widget (VOICE-01, VOICE-04, VOICE-20…22).
 *
 * The server's own read and save (`widgets/{id}/calls`), not the web's whole widget form: that one rewrites every
 * column from what it is sent, so a page knowing only these settings would reset the rest. Saving sends only what
 * was changed, and the server refuses a value this page never offers.
 */

/** When the call button shows (VOICE-01), as `WidgetCalls::OFFERS` names them. */
export type VoiceOffer = 'available' | 'after_message' | 'offered';

export interface CallSettings {
  show_typing_to_visitor: boolean;
  show_receipts_to_visitor: boolean;
  voice_enabled: boolean;
  voice_offer: VoiceOffer;
  /** How long a call rings before the visitor is offered a call back, 20–300 s (VOICE-04). */
  voice_max_wait_seconds: number;
  /** Always false: recording is not built (VOICE-22), and the server refuses turning it on. */
  voice_record: boolean;
}

export interface CallTaker {
  user_id: number;
  name: string;
  /** Could be rung now: online, not on another call, with a microphone (VOICE-11, VOICE-17). */
  available: boolean;
}

export interface CallSettingsPayload {
  settings: CallSettings;
  /** Which migrations the server has: without one, its switches cannot be saved. */
  installed: { live_status: boolean; voice: boolean };
  recording_available: boolean;
  /** Whether the voice server is set up: without it the widget never shows the call button. */
  media_ready: boolean;
  /** "Who can take calls": the widget's staff (or, with none assigned, everybody covering it) who hold chat.widget.voice. */
  takers: { assigned: boolean; people: CallTaker[] };
  can_manage: boolean;
}

export const VOICE_OFFERS: Array<{ value: VoiceOffer; label: string }> = [
  { value: 'available', label: 'When someone who takes calls is available' },
  { value: 'after_message', label: 'After the visitor has sent a message' },
  { value: 'offered', label: 'Only when staff offer a call' },
];

/** The give-up times offered, in seconds, inside the server's 20–300. */
export const WAITS = [20, 30, 45, 60, 90, 120, 180, 300];

/** "45 seconds", "2 minutes": how the call back offer is worded. */
export function waitLabel(seconds: number): string {
  if (seconds >= 120 && seconds % 60 === 0) return text('{n} minutes', { n: seconds / 60 });
  return text('{n} seconds', { n: seconds });
}

/** The choices for the give-up time, keeping a stored value that is not one of them so it is shown as it is. */
export function waitOptions(current: number): Array<{ value: number; label: string }> {
  return [...new Set([...WAITS, current])].sort((a, b) => a - b).map((s) => ({ value: s, label: waitLabel(s) }));
}

/** What changed between the saved settings and the draft: all a save sends. */
export function changedFields(saved: CallSettings, draft: CallSettings): Partial<CallSettings> {
  const out: Partial<CallSettings> = {};
  for (const k of Object.keys(draft) as Array<keyof CallSettings>) {
    if (draft[k] !== saved[k]) (out as Record<string, unknown>)[k] = draft[k];
  }
  return out;
}

export const callSettingsOf = (id: number, signal?: AbortSignal) => apiGet<CallSettingsPayload>(`${WEBSITE}/widgets/${id}/calls`, undefined, signal);
export const saveCallSettings = (id: number, fields: Partial<CallSettings>) => apiPut<CallSettingsPayload>(`${WEBSITE}/widgets/${id}/calls`, fields);
