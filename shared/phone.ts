import { z } from 'zod';

/**
 * The Phone's IPC (src/modules/phone, electron/services/phone.ts): what a page cannot do for itself.
 *
 *  - `phone:prepare` — the page policy names every address a window may open a WebSocket to, so the phone system's
 *    own WebSocket (wss://pbx…:8089) must be added to it. The main process asks WorkSuite which one this person's
 *    extension uses (`GET /api/voip/softphone`); a page never names it. `added` means the page loaded before it was
 *    known, so it must reload once to connect.
 *  - `phone:shortcuts` — the global shortcuts of the compact phone (D01): answer, hang up, mute, held only while the
 *    phone is registered. Pressed, they arrive as `phone:shortcut` in the main window.
 *  - `phone:notify` — an incoming or missed call as a native notification (VOIP-NOT-01, D01), as the status calls are
 *    in says (worksuite-desktop#288): a banner with the app's sound, a `silent` one (Busy), or only an entry in the
 *    bell (`bell`: a call turned away while Do not disturb or Away, so nothing pops up).
 */
const none = z.undefined().or(z.null()).optional();

export { PHONE_EVENT_CHANNELS, PHONE_INVOKE_CHANNELS } from './ipc/phone-channels';

/** The global shortcuts (design D01: "⌥⌘A answer · ⌥⌘H hang up · ⌥⌘M mute"). */
export const PHONE_SHORTCUTS = {
  answer: 'Alt+CommandOrControl+A',
  hangup: 'Alt+CommandOrControl+H',
  mute: 'Alt+CommandOrControl+M',
} as const;

export type PhoneShortcut = keyof typeof PHONE_SHORTCUTS;

export const phoneNotifySchema = z.strictObject({
  kind: z.enum(['incoming', 'missed']),
  id: z.string().regex(/^phone-[a-z]+:[A-Za-z0-9]{1,40}$/),
  title: z.string().min(1).max(160),
  body: z.string().max(300),
  delivery: z.enum(['silent', 'bell']).optional(),
});
export type PhoneNotify = z.infer<typeof phoneNotifySchema>;

/** Spread into `contract` (shared/ipc/contract.ts). */
export const phoneContract = {
  'phone:prepare': { input: none, session: true, rate: 2 },
  'phone:shortcuts': { input: z.strictObject({ on: z.boolean() }), session: true, rate: 4 },
  'phone:notify': { input: phoneNotifySchema, session: true, rate: 6 },
};

export interface PhoneOutputs {
  'phone:prepare': { origin: string | null; added: boolean };
  'phone:shortcuts': { held: Record<PhoneShortcut, boolean> };
  'phone:notify': void;
}

/**
 * The WebSocket origin for a softphone URI (`wss://pbx.example.lk:8089/ws` → `wss://pbx.example.lk:8089`), or null
 * for anything that is not a plain secure WebSocket address: no credentials, no other scheme.
 */
export function phoneOrigin(wsUri: string | null | undefined): string | null {
  if (!wsUri) return null;
  try {
    const u = new URL(wsUri);
    if (u.protocol !== 'wss:' || u.username || u.password || !u.hostname) return null;
    return `wss://${u.host}`;
  } catch {
    return null;
  }
}
