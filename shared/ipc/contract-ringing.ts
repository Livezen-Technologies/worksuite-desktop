import { ch, none } from './contract-kit';
import { z } from 'zod';
import type { QuickAskContext, WebchatRingState, RingTestStep, LiveDeskInfo } from '../types';

/** Website chats ringing like calls, the Live dashboard and Quick Ask: spread into `contract` (shared/ipc/contract.ts; audit D-G13). */
export const ringingContract = {
  // Quick Ask (AI Assistant): what it was opened with, Insert back into that app, and handing a result to WorkSuite.
  'quickask:context': ch(none, { session: true }),
  'quickask:open': ch(none, { session: true, rate: 2 }),
  'quickask:insert': ch(z.object({ text: z.string().min(1).max(20_000) }), { session: true, rate: 2 }),
  'quickask:close': ch(none, { session: true }),
  'quickask:handoff': ch(z.object({ to: z.enum(['dock', 'task', 'search', 'changes']), text: z.string().max(8000), result: z.string().max(20_000).nullable() }), { session: true, rate: 2 }),
  // Website chats ringing like calls (WS-WCHAT ENH-01, RING-49): the call window, the main window's bar.
  'ring:state': ch(none, { session: true, whileLocked: true }),
  // `then: 'transfer'`: the ringing card's Transfer opens the chat with the transfer dialog (#225).
  'ring:join': ch(z.object({ id: z.number().int().positive(), then: z.enum(['transfer']).optional(), visitor: z.string().max(200).optional() }), { session: true, rate: 4 }),
  'ring:silence': ch(z.object({ id: z.number().int().positive(), on: z.boolean() }), { session: true, rate: 10 }),
  'ring:pass': ch(z.object({ id: z.number().int().positive() }), { session: true, rate: 4 }),
  /** Settings › Ringing › Send a test chat notification (#251): routed, received, notification shown. */
  'ring:test': ch(none, { session: true, rate: 2 }),
  // The card's Join chat and Join & send, then the mini chat's replies, Open full chat or minimise, and its height (#225).
  // `open`: the native call window's Send & join and Join chat open the thread (R-05, UX-ALR-01; RING-41); `cannedId`: the
  // saved reply it was written from, counted once it is sent (RDC-03).
  'ring:joinSend': ch(z.object({ id: z.number().int().positive(), message: z.string().max(4000).optional(), open: z.boolean().optional(), cannedId: z.number().int().positive().optional(), visitor: z.string().max(200).optional() }), { session: true, rate: 4 }),
  // What is typed to a ringing visitor (R-05, R-06; UX-ALR-04): kept in main, so it survives a colleague joining first.
  'ring:draft': ch(z.object({ id: z.number().int().positive(), text: z.string().max(4000) }), { session: true, rate: 30 }),
  'ring:reply': ch(z.object({ message: z.string().min(1).max(4000) }), { session: true, rate: 10 }),
  'ring:closeJoined': ch(z.object({ open: z.boolean() }), { session: true, rate: 10 }),
  'ring:minimise': ch(none, { session: true, whileLocked: true, rate: 10 }),
  'ring:fit': ch(z.object({ height: z.number().int().min(80).max(1200) }), { session: true, whileLocked: true, rate: 30 }),
  'ring:openInbox': ch(none, { session: true, rate: 4 }),
  // How the ring ended (R-03): View a chat a colleague joined, Open in Missed for a visitor who left, or Dismiss.
  // `participant`: a colleague joined while I was typing — send my words to the chat anyway, as a participant (UX-ALR-04).
  'ring:outcome': ch(z.object({ action: z.enum(['view', 'missed', 'dismiss', 'participant']) }), { session: true, rate: 10 }),
  // The tray's ringing menu (R-06, RING-UI-07; UX-ALR-02): its height, and its plain items.
  'ring:trayFit': ch(z.object({ height: z.number().int().min(80).max(1200) }), { session: true, rate: 30 }),
  // The tray's mini-dashboard (L-05, MAP-22): Open Live dashboard, Show Live map window, Wall mode on a display and
  // Silence for 15 minutes too.
  'ring:tray': ch(z.object({ action: z.enum(['inbox', 'settings', 'quit', 'close', 'dashboard', 'liveMap', 'wall', 'silence']) }), { session: true, rate: 10 }),
  // The Live map window and the Live dashboard on this computer (L-04, MAP-21, MAP-24): pop the map out (or show or
  // hide it, ⌘⇧M), open the dashboard, wall mode on a display, or a chat in the main window.
  // `wallSheet` asks first which screen and how (L-06, MAP-UI-06); `wallClose` takes the wall down.
  'live:open': ch(z.object({ to: z.enum(['map', 'toggleMap', 'dashboard', 'wall', 'wallSheet', 'wallClose', 'chat']), id: z.number().int().positive().optional() }), { session: true, rate: 10 }),
  'live:info': ch(none, { session: true }),
  // The Wall mode sheet's Open on Display 2 (L-06, MAP-24): saves its choices and opens the wall on that screen.
  'live:wall': ch(z.object({ displayId: z.number().int(), keepAwake: z.boolean(), cycle: z.boolean(), openAtStart: z.boolean() }), { session: true, rate: 10 }),
  // A visitor who wrote again in my chat (worksuite-desktop#230): reply from the card, open the chat, snooze it for
  // five minutes, or take it over (the team step); and which conversation is in front in the main window.
  'ring:followUp': ch(z.object({ id: z.number().int().positive(), action: z.enum(['reply', 'open', 'snooze', 'takeOver']), message: z.string().min(1).max(4000).optional() }), { session: true, rate: 10 }),
  'ring:viewing': ch(z.object({ id: z.number().int().positive().nullable() }), { session: true, whileLocked: true, rate: 60 }),
  // An invitation or transfer into a website chat (ENH-WCHAT-03): Join chat / Accept, or Decline.
  'ring:handoff': ch(z.object({ id: z.number().int().positive(), accept: z.boolean() }), { session: true, rate: 6 }),
  // A visitor's voice call (ENH-WCHAT-05): Answer or Decline; whether this computer has a microphone; the call it is on.
  'ring:call': ch(z.object({ id: z.number().int().positive(), accept: z.boolean() }), { session: true, rate: 6 }),
  // With the microphone's name and whether it is a headset, for the incoming call's device line (V-04, VOICE-14).
  'ring:mic': ch(z.object({ has: z.boolean(), label: z.string().max(120).nullable().optional(), headset: z.boolean().optional() }), { session: true, rate: 10 }),
  'ring:onCall': ch(
    z.object({ conversationId: z.number().int().positive(), visitor: z.string().max(120), since: z.number().int().nonnegative(), held: z.boolean() }).nullable(),
    { session: true, rate: 20 },
  ),
};

export interface RingingOutputs {
  'quickask:context': QuickAskContext & { shortcut: string | null };
  'quickask:open': void;
  'quickask:insert': boolean;
  'quickask:close': void;
  'quickask:handoff': void;
  'ring:state': WebchatRingState;
  'ring:join': boolean;
  'ring:silence': void;
  'ring:pass': boolean;
  'ring:test': RingTestStep[];
  'ring:joinSend': { ok: boolean; why: string | null };
  'ring:reply': { ok: boolean; why: string | null };
  'ring:closeJoined': void;
  'ring:minimise': void;
  'ring:fit': void;
  'ring:openInbox': void;
  'ring:outcome': void;
  'ring:draft': void;
  'ring:trayFit': void;
  'ring:tray': void;
  'live:open': void;
  'live:info': LiveDeskInfo;
  'live:wall': void;
  'ring:followUp': { ok: boolean; why: string | null };
  'ring:viewing': void;
  'ring:handoff': boolean;
  'ring:call': boolean;
  'ring:mic': void;
  'ring:onCall': void;
}
