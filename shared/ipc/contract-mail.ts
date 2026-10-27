import { ch, none, mailFileHandle } from './contract-kit';
import { z } from 'zod';
import type { MailAlertState, MailAlertCard } from '../mail-alerts';
import type { MailFileHandle, DataFolder, ImportProgress, MailFileView } from '../mail-files';
import type { SmimeVerdict } from '../smime';

/** Mail on this computer — what it keeps, its alerts, data files and S/MIME: spread into `contract` (shared/ipc/contract.ts; audit D-G13). */
export const mailContract = {
  // New-mail alerts (ENH-MAIL-05): what the main window shows (MNA-EVT-05 decides by it), a card's buttons and quick
  // reply, a message opened here (its alert goes), the pause, and the state the tray and the settings show.
  'mailAlert:view': ch(z.object({ module: z.string().max(64).nullable(), box: z.string().regex(/^(unified|\d{1,12})$/).nullable(), folder: z.string().max(128).nullable() }), { session: true, rate: 20 }),
  'mailAlert:action': ch(
    z.object({
      id: z.string().max(80).nullable().optional(),
      key: z.string().regex(/^\d{1,15}:[A-Za-z0-9._\-/ :]{1,128}:\d{1,15}$/).max(180).nullable().optional(),
      action: z.enum(['open', 'reply', 'read', 'archive', 'flag', 'read-all', 'open-inbox', 'dismiss', 'undo']),
      text: z.string().max(20_000).nullable().optional(),
    }),
    { session: true, rate: 10 },
  ),
  'mailAlert:clear': ch(z.object({ mailbox: z.number().int().positive(), folder: z.string().max(128), uid: z.number().int().positive() }), { session: true, rate: 30 }),
  'mailAlert:pause': ch(z.object({ mode: z.enum(['1h', 'tomorrow', 'outside_hours', 'manual']).nullable() }), { session: true, rate: 4 }),
  'mailAlert:state': ch(none, { session: true }),
  'mailAlert:latest': ch(none, { session: true }),
  'mailAlert:prefs': ch(z.object({ preview: z.enum(['full', 'sender', 'hidden']).optional(), sound: z.boolean().optional() }), { session: true, rate: 4 }),
  // Mail data files (ENH-MAIL-03 DMO-DAT-01…04): the main process picks, the worker reads, the server receives.
  'mailfile:pick': ch(z.strictObject({ mode: z.enum(['file', 'folder', 'view']) }), { session: true, rate: 2 }),
  'mailfile:scan': ch(z.strictObject({ handle: mailFileHandle }), { session: true, rate: 5 }),
  'mailfile:import': ch(
    z.strictObject({
      handle: mailFileHandle,
      importId: z.number().int().positive(),
      plan: z.array(z.strictObject({ folder: z.number().int().positive(), source: z.string().max(500), destination: z.string().min(1).max(500).regex(/^[\x20-\x7e]+$/) })).max(5000),
    }),
    { session: true, sensitive: true, rate: 2 },
  ),
  'mailfile:progress': ch(z.strictObject({ handle: mailFileHandle }), { session: true }),
  'mailfile:cancel': ch(z.strictObject({ handle: mailFileHandle }), { session: true }),
  'mailfile:view': ch(z.strictObject({ handle: mailFileHandle }), { session: true, rate: 5 }),
  'mailfile:saveAttachment': ch(z.strictObject({ handle: mailFileHandle, index: z.number().int().min(0).max(10_000) }), { session: true, rate: 3 }),
  'mailfile:close': ch(z.strictObject({ handle: mailFileHandle }), { session: true }),
  // Export a folder or search result (DMO-DAT-03): only when the organisation allows it, and audited.
  'mail:export': ch(
    z.strictObject({
      mailbox: z.string().regex(/^\d{1,20}$/).nullable(),
      folder: z.string().regex(/^[A-Za-z0-9._\-/ :]{1,128}$/),
      folderName: z.string().max(200),
      format: z.enum(['mbox', 'eml']),
      items: z.array(z.strictObject({ uid: z.string().regex(/^\d{1,20}$/), folder: z.string().regex(/^[A-Za-z0-9._\-/ :]{1,128}$/), mailbox: z.string().regex(/^\d{1,20}$/).nullable() })).max(10_000).optional(),
    }),
    { session: true, sensitive: true, rate: 1 },
  ),
  'mail:exportCancel': ch(none, { session: true }),
  // A link in a message, after the safe-link check (DMO-SEC-03): `confirmed` when the person chose to go on past a warning.
  'mail:openLink': ch(z.strictObject({ url: z.string().url().max(4096), confirmed: z.boolean() }), { session: true, rate: 5 }),
  // Spell check's languages (worksuite-desktop#188): what this computer has, and the choice.
  'mail:spellLanguages': ch(none, { session: true }),
  /**
   * A message's allowed pictures as data: URLs (worksuite-desktop#163): those kept in the local mail store at once;
   * with `fetch`, the rest through WorkSuite's image proxy, then kept. Never fetched from the sender directly.
   */
  'mail:images': ch(z.strictObject({ urls: z.array(z.string().regex(/^https?:\/\/\S+$/i).max(2000)).max(60), mailbox: z.string().regex(/^\d{1,12}$/).nullable(), fetch: z.boolean() }), { session: true, rate: 30 }),
  /**
   * Which of a message's attachments are kept in the local mail store (they open at once, also offline); with
   * `auto`, those Settings › Mail › Images & media downloads ahead are downloaded first (#163).
   */
  'mail:keptAttachments': ch(
    z.strictObject({
      uid: z.string().regex(/^\d{1,20}$/),
      folder: z.string().regex(/^[A-Za-z0-9._\-/ :]{1,128}$/),
      mailbox: z.string().regex(/^\d{1,20}$/).nullable(),
      items: z.array(z.strictObject({ ref: z.string().min(1).max(512), name: z.string().max(512), mime: z.string().max(255), size: z.number().int().min(0) })).max(50),
      auto: z.boolean(),
    }),
    { session: true, rate: 30 },
  ),
  'mail:setSpellLanguages': ch(z.strictObject({ languages: z.array(z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/)).max(4) }), { session: true, rate: 5 }),
  // S/MIME (DMO-SEC-05): a signed message checked against its own bytes, in the main process.
  'smime:verify': ch(z.strictObject({ uid: z.string().regex(/^\d{1,20}$/), folder: z.string().regex(/^[A-Za-z0-9._\-/ :]{1,128}$/), mailbox: z.string().regex(/^\d{1,20}$/).nullable() }), { session: true, rate: 5 }),
};

export interface MailOutputs {
  'mailAlert:view': void;
  'mailAlert:action': { ok: boolean; sending?: { id: string; at: number } | null };
  'mailAlert:clear': void;
  'mailAlert:pause': MailAlertState;
  'mailAlert:state': MailAlertState;
  'mailAlert:latest': MailAlertCard | null;
  'mailAlert:prefs': MailAlertState;
  'mailfile:pick': MailFileHandle | null;
  'mailfile:scan': { folders: DataFolder[]; unreadable: string[] };
  'mailfile:import': ImportProgress;
  'mailfile:progress': ImportProgress | null;
  'mailfile:cancel': void;
  'mailfile:view': MailFileView;
  'mailfile:saveAttachment': boolean;
  'mailfile:close': void;
  'mail:export': { count: number; failed: number; cancelled: boolean; name: string } | null;
  'mail:exportCancel': void;
  'mail:openLink': boolean;
  'mail:spellLanguages': { choices: Array<{ code: string; label: string; available: boolean; reason?: string }>; current: string[]; system: boolean };
  'mail:setSpellLanguages': string[];
  'mail:images': { enabled: boolean; images: Record<string, string> };
  'mail:keptAttachments': string[];
  'smime:verify': SmimeVerdict;
}
