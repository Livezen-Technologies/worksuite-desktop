import { ch, none } from './contract-kit';
import { z } from 'zod';
import type { RemoteControlView, DiagnosticCheck, RemoteControlConsent } from '../types';

/** Remote control, both sides: spread into `contract` (shared/ipc/contract.ts; audit D-G13). */
export const remoteControlContract = {

  /*
   * Meet remote control on this computer (WS-MEET-ENH-01). The meeting window
   * says when it shares and relays what arrives on the data channel; it never
   * holds a key. Answering a request comes only from the consent window, and
   * resuming only from the control bar, each with a real click there. Stopping
   * works while WorkSuite is locked: stopping is never harder than starting.
   */
  'rc:state': ch(none, { session: true, whileLocked: true }),
  /** Asks macOS again whether WorkSuite may take input (Check again; back from System Settings — worksuite-desktop#47). */
  'rc:recheck': ch(none, { session: true, rate: 20 }),
  /**
   * The checks under Settings › Remote control (WS-MEET-ENH-01 RC09): what can
   * be captured, the displays, whether input can reach this computer, the
   * clipboard policy. Reads only — it never opens a capture or asks macOS for
   * a permission, so pressing Run checks again puts no prompt on screen.
   */
  'rc:checks': ch(none, { session: true, rate: 20 }),
  /** Restart WorkSuite after Accessibility was granted (worksuite-desktop#147): the app and its input helper start again. */
  'rc:restart': ch(none, { session: true, rate: 1 }),
  'rc:setAllowRequests': ch(z.object({ value: z.boolean() }), { session: true, rate: 5 }),
  /**
   * The emergency chord this computer uses (RC09), where the organisation has
   * not set one of its own. `null` puts it back to the default. Refused in the
   * main process when a policy has chosen — the renderer's own check is for
   * the person's benefit, not the rule's.
   */
  'rc:setStopChord': ch(z.object({ chord: z.string().max(64).nullable() }), { session: true, rate: 5 }),
  'rc:shareStarted': ch(
    z.object({
      uuid: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
      identity: z.string().min(1).max(64),
      quality: z.enum(['auto', 'quality', 'balanced', 'performance']).optional(),
      allowRequests: z.boolean().optional(),
    }),
    { session: true, rate: 4 },
  ),
  'rc:shareChanged': ch(z.object({ uuid: z.string().regex(/^[A-Za-z0-9-]{8,64}$/) }), { session: true, whileLocked: true, rate: 4 }),
  'rc:shareStopped': ch(z.object({ uuid: z.string().regex(/^[A-Za-z0-9-]{8,64}$/) }), { session: true, whileLocked: true, rate: 4 }),
  'rc:sharePaused': ch(z.object({ uuid: z.string().regex(/^[A-Za-z0-9-]{8,64}$/), paused: z.boolean() }), { session: true, whileLocked: true, rate: 4 }),
  'rc:packet': ch(
    z.object({ sender: z.string().min(1).max(128), topic: z.enum(['rc.ctl', 'rc.ctl.move']), data: z.string().min(2).max(16_384) }),
    { session: true, whileLocked: true, rate: 250 },
  ),
  'rc:consent': ch(none, { session: true, whileLocked: true, rate: 5 }),
  'rc:answer': ch(
    z.object({
      decision: z.enum(['allow', 'allow_5', 'deny', 'transfer']),
      caps: z
        .object({
          mouse: z.boolean(),
          keyboard: z.boolean(),
          clipboard: z.enum(['off', 'text', 'text_files']),
          file_transfer: z.boolean(),
          monitor_switch: z.boolean(),
        })
        .partial()
        .optional(),
      duration: z.enum(['until_stopped', '5', '15', '30', 'meeting_end']).optional(),
    }),
    { session: true, whileLocked: true, sensitive: true, rate: 3 },
  ),
  'rc:pause': ch(z.object({ sessionId: z.number().int().positive() }), { session: true, whileLocked: true, rate: 3 }),
  'rc:resume': ch(z.object({ sessionId: z.number().int().positive() }), { session: true, sensitive: true, rate: 3 }),
  'rc:stop': ch(z.object({ sessionId: z.number().int().positive().optional() }), { session: true, whileLocked: true, sensitive: true, rate: 3 }),
  /** A file the controller offered this computer (RC06), answered on the control bar; accepting needs a real click there. */
  'rc:fileAnswer': ch(z.object({ id: z.number().int().positive(), accept: z.boolean(), confirmExecutable: z.boolean().optional() }), { session: true, whileLocked: true, sensitive: true, rate: 5 }),
  /** Offer the controller a file from this computer, chosen in the system's dialog (nothing is injected while it is open). */
  'rc:sendFile': ch(z.object({ sessionId: z.number().int().positive() }), { session: true, sensitive: true, rate: 2 }),
  /** As the controller, take a file the shared computer offered (only files sent to the controller). */
  'rc:takeFile': ch(z.object({ sessionId: z.number().int().positive(), id: z.number().int().positive(), confirmExecutable: z.boolean().optional() }), { session: true, sensitive: true, rate: 5 }),
};

export interface RemoteControlOutputs {
  'rc:state': RemoteControlView;
  'rc:recheck': RemoteControlView;
  'rc:checks': { checks: DiagnosticCheck[] };
  'rc:restart': void;
  'rc:setAllowRequests': RemoteControlView;
  'rc:setStopChord': RemoteControlView;
  'rc:shareStarted': { shareId: number; controlOffered: boolean; why: string | null };
  'rc:shareChanged': void;
  'rc:shareStopped': void;
  'rc:sharePaused': void;
  'rc:packet': void;
  'rc:consent': RemoteControlConsent;
  'rc:answer': { status: string; stepUp?: boolean; message?: string };
  'rc:pause': void;
  'rc:resume': void;
  'rc:stop': void;
  'rc:fileAnswer': { status: string; confirmExecutable?: boolean; message?: string };
  'rc:sendFile': { sent: number };
  'rc:takeFile': { status: string; confirmExecutable?: boolean; message?: string };
}
