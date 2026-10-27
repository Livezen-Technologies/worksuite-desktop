import { ch, none, idString, uploadTargetSchema, driveId, syncMode } from './contract-kit';
import { z } from 'zod';
import { garageDocSchema } from '../garage-docs';
import { projectsReportSchema, projectReportSchema } from '../projects';
import { ELEARNING_MEDIA_TOKEN } from '../elearning-offline';
import { OFFICE_EXPORT_TOKEN } from '../office';
import { purchaseExportSchema } from '../purchase';
import type { PickedFile } from './contract';
import type { Transfer, Preferences, PreferenceLock, SyncStatus, SyncDevice, SyncPolicy, SyncLookup, DriveConflict } from '../types';

/** Transfers, Drive sync and files picked or dropped: spread into `contract` (shared/ipc/contract.ts; audit D-G13). */
export const transfersContract = {

  'files:pickFiles': ch(z.object({ multiple: z.boolean(), title: z.string().max(100).optional(), only: z.enum(['gif', 'document', 'image', 'video', 'audio']).optional() }), { session: true, rate: 2 }),
  // The dialog runs in the main process, which stores the chosen folder itself.
  'files:chooseDownloadFolder': ch(none, { rate: 2 }),
  /** A text the page made (backup codes, a CSV export), saved where the person chooses in a save dialog. */
  'files:saveText': ch(
    z.union([
      z.object({ name: z.string().regex(/^[A-Za-z0-9 ._-]{1,80}\.txt$/), text: z.string().max(64_000) }),
      // An export the page built (the Phone's call history, extensions): larger, and saved as CSV.
      z.object({ name: z.string().regex(/^[A-Za-z0-9 ._-]{1,80}\.csv$/), text: z.string().max(8_000_000) }),
    ]),
    { session: true, rate: 2 },
  ),
  'files:registerDropped': ch(z.object({ paths: z.array(z.string().min(1).max(4096)).min(1).max(200) }), { session: true, rate: 5 }),
  /** A folder, with everything in it: each file carries its path inside the folder. */
  'files:pickFolder': ch(z.object({ title: z.string().max(100).optional() }), { session: true, rate: 2 }),
  'transfers:list': ch(none, { session: true }),
  'transfers:download': ch(
    z
      .object({
        fileId: idString.optional(),
        // A mail attachment: the main process builds the request from these
        // parts; the renderer never supplies a path.
        mail: z
          .object({
            uid: z.string().regex(/^\d{1,20}$/),
            ref: z.string().min(1).max(512),
            folder: z.string().regex(/^[A-Za-z0-9._\-/ :]{1,128}$/),
            mailbox: z.string().regex(/^\d{1,20}$/).nullable(),
          })
          .optional(),
        /** A message's original as the server holds it (.eml): the main process builds the request from these parts. */
        mailSource: z
          .object({
            uid: z.string().regex(/^\d{1,20}$/),
            folder: z.string().regex(/^[A-Za-z0-9._\-/ :]{1,128}$/),
            mailbox: z.string().regex(/^\d{1,20}$/).nullable(),
          })
          .optional(),
        /** A Meet recording (the owner's own; the server checks). */
        recording: z.number().int().positive().optional(),
        /** With a file id: the Meet recording it is, so the download shows on that recording (worksuite-desktop#89). */
        forRecording: z.number().int().positive().optional(),
        /** One of the fixed exports: your calendar (.ics) or your contacts (.csv / .vcf). */
        export: z.enum(['calendar', 'contacts-csv', 'contacts-vcf', 'contacts-template']).optional(),
        /** The rows an import could not take, as a CSV (a data job's errors). */
        importErrors: z.number().int().positive().optional(),
        /** An earlier version of a Drive file. */
        version: z.object({ fileId: z.number().int().positive(), versionId: z.number().int().positive() }).optional(),
        /** My payslip as a PDF, by its reference. */
        payslip: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).optional(),
        /** A payroll document: my annual tax certificate by its reference, or one payslip of a run by id (payroll staff; the server checks). */
        payrollDoc: z.object({ kind: z.enum(['tax-certificate', 'run-payslip', 'input-attachment']), id: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/) }).optional(),
        /** An HR document (the main process asks for its one-time link) — mine, or with `hrEmployee` that employee's. */
        hrDocument: z.number().int().positive().optional(),
        hrEmployee: z.number().int().positive().optional(),
        /** A resignation letter: one being reviewed, by its resignation id, or my own. */
        hrLetter: z.union([z.number().int().positive(), z.literal('mine')]).optional(),
        /** An HR attendance report as a CSV, as the Reports screen filtered it. */
        hrReport: z
          .object({
            type: z.enum(['summary', 'late', 'early', 'overtime', 'absence', 'missing', 'remote']),
            from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            department_id: z.number().int().positive().optional(),
            employee_id: z.number().int().positive().optional(),
          })
          .optional(),
        /** One of my profile pictures, as it was kept (My account › Profile pictures). */
        picture: z.number().int().positive().optional(),
        /** A sales order as its PDF (the server's share of it). */
        orderPdf: z.number().int().positive().optional(),
        /** A meeting's minutes as PDF or Word (worksuite-desktop#80); the server checks who may read them. */
        minutesExport: z.object({ meeting: z.number().int().positive(), format: z.enum(['pdf', 'docx']) }).optional(),
        /** A meeting transcript as TXT or PDF (worksuite-desktop#81); the server checks who may read it. */
        transcriptExport: z.object({ id: z.number().int().positive(), format: z.enum(['txt', 'pdf']) }).optional(),
        /** An invoice as its PDF, on its company's letterhead (the server's share of it). */
        invoicePdf: z.number().int().positive().optional(),
        /**
         * A Billing export (SRS-BIL-001 G-13): a list or a report as CSV, XLSX or PDF, filtered as the screen was; or a
         * customer's statement as a PDF. The main process builds `/api/billing/{what}/export?…` (or the statement's).
         */
        billingExport: z
          .object({
            what: z.enum(['invoices', 'payments', 'credit-notes', 'customers', 'report', 'statement']),
            report: z.enum(['aging', 'revenue', 'tax', 'customers', 'payments', 'products', 'numbering-gaps']).optional(),
            customer: z.number().int().positive().optional(),
            format: z.enum(['csv', 'xlsx', 'pdf']),
            org: z.string().regex(/^(\d+(,\d+)*)?$/).optional(),
            q: z.string().max(100).optional(),
            status: z.string().regex(/^[a-z_,]{1,100}$/).optional(),
            from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          })
          .refine((v) => (v.what === 'report') === !!v.report && (v.what === 'statement') === !!v.customer, 'a report names its report, a statement its customer')
          .optional(),
        /** The one file a Billing bulk act made (`file_url` of `invoices/bulk` with `pdf`): a path on the server's own Billing API or a /d/ grant. */
        billingFile: z
          .string()
          .regex(/^\/(?:api\/billing\/|d\/)[A-Za-z0-9._~/?=&%-]{1,400}$/)
          .refine((v) => !v.includes('..'), 'no parent paths')
          .optional(),
        /** A bank slip attached to a payment (Billing › Payments). */
        paymentSlip: z.object({ payment: z.number().int().positive(), slip: z.number().int().positive() }).optional(),
        /** A tender's document, a checklist line's file (or an earlier version of it), or a generated letter. */
        tenderDocument: z.number().int().positive().optional(),
        /** With `tenderDocument`: one of its earlier versions (`…/versions/{v}/file`). */
        tenderDocumentVersion: z.number().int().positive().optional(),
        tenderLine: z.object({ line: z.number().int().positive(), version: z.number().int().positive().optional() }).optional(),
        tenderLetter: z.object({ tender: z.number().int().positive(), letter: z.number().int().positive() }).optional(),
        /** A company document's file from the tender library. */
        tenderLibrary: z.number().int().positive().optional(),
        /** The order list as a CSV, as the Orders screen filtered it. */
        ordersCsv: z
          .object({
            org: z.string().regex(/^(\d+(,\d+)*)?$/).optional(),
            status: z.string().regex(/^[a-z_,]{1,200}$/).optional(),
            source: z.string().regex(/^[a-z_,]{1,100}$/).optional(),
            priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
            q: z.string().max(100).optional(),
            mine: z.boolean().optional(),
          })
          .optional(),
        /** Website chat Insights as a CSV (L-07, UX-INS-02 Export CSV): its period, and one widget or all. */
        websiteInsights: z.object({ period: z.enum(['7d', '30d', 'all']), widget: z.number().int().positive().optional() }).optional(),
        /** An Orders report as a CSV, as the Reports screen set it. */
        omsReport: z
          .object({
            report: z.enum(['summary', 'sales', 'status', 'payment', 'aging', 'returns', 'coupons']),
            from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            org: z.string().regex(/^(\d+(,\d+)*)?$/).optional(),
            group: z.enum(['month', 'day', 'client', 'user', 'assignee', 'org', 'source', 'product', 'category', 'status', 'type', 'priority']).optional(),
          })
          .optional(),
        /** An own-fleet route's sheet as the server's PDF, for a driver without the app (FR-DLV-06). */
        omsRouteSheet: z.number().int().positive().optional(),
        /** A Finance report as a CSV: its summary rows, or (`lines`) every journal line in the window. */
        financeCsv: z
          .object({
            report: z.enum(['financial-overview', 'cash-flow', 'budget-variance', 'profit-and-loss']),
            lines: z.boolean().optional(),
            company: z.number().int().positive(),
            from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            currency: z.string().regex(/^[A-Z]{3}$/).optional(),
          })
          .optional(),
        /**
         * An Expenses file: a claim's receipt, a receipt by its token (petty cash), a subscription's
         * document, a payment run's bank file, an accounting export, or a report as a CSV. The main
         * process builds the address; a report's query is short keys and values, nothing else.
         */
        expenseFile: z
          .discriminatedUnion('kind', [
            z.object({ kind: z.literal('claim-receipt'), claim: z.number().int().positive() }),
            z.object({ kind: z.literal('receipt'), token: z.string().regex(/^[A-Za-z0-9._-]{6,128}$/) }),
            z.object({ kind: z.literal('sub-document'), sub: z.number().int().positive(), doc: z.number().int().positive() }),
            z.object({ kind: z.literal('run-csv'), run: z.number().int().positive(), org: z.number().int().positive().optional() }),
            z.object({ kind: z.literal('posting'), posting: z.number().int().positive(), org: z.number().int().positive().optional() }),
            z.object({
              kind: z.literal('report'),
              which: z.enum(['insights', 'classic']),
              query: z.record(z.string().regex(/^[a-z_]{1,32}$/), z.string().max(200)).refine((q) => Object.keys(q).length <= 12, 'too many parameters'),
            }),
          ])
          .optional(),
        /**
         * A Garage document — a job's check-in sheet, an estimate version, a work order's sheet, the
         * delivery note — or a Garage report as a CSV (`shared/garage-docs.ts`). The main process builds
         * the address.
         */
        garageDoc: garageDocSchema.optional(),
        /** Cheque Manager's PDFs (Cheque 1.2): a cheque's preview or voucher, a deposit slip, a return letter, a version's calibration sheet. */
        chequeDoc: z.object({ kind: z.enum(['preview', 'voucher', 'deposit-slip', 'return-letter', 'calibration-sheet']), id: z.string().regex(/^\d{1,12}$/) }).optional(),
        /** A Projects report as CSV, Excel or PDF, as the Reports screen filtered it (`shared/projects.ts`). */
        projectsReport: projectsReportSchema.optional(),
        /** One project's whole report as PDF or Excel (`GET /api/projects/{id}/report`, `shared/projects.ts`). */
        projectReport: projectReportSchema.optional(),
        /**
         * An eLearning lesson's file where the lesson allows downloading: the signed token of the
         * address the server gave with the lesson (`file.urls.download`). The main process builds
         * `/media/{token}?download=1`; a protected lesson has no such address to give.
         */
        elearningMedia: z.string().regex(ELEARNING_MEDIA_TOKEN).optional(),
        /** An Office export's signed download (`POST …/office/export` → `download_url`): its token; the main process fetches `/office/exports/{token}` from the server. */
        officeExport: z.string().regex(OFFICE_EXPORT_TOKEN).optional(),
        /** A chat attachment: the signed token of its `download_url` (`/media/{token}?download=1`). */
        chatMedia: z.string().regex(ELEARNING_MEDIA_TOKEN).optional(),
        /** A task's attachment: the main process asks for its short-lived link (`POST /api/tasks/{task}/attachments/{id}/link`). */
        taskAttachment: z.object({ task: z.number().int().positive(), id: z.number().int().positive() }).optional(),
        /** A chat conversation exported as text, or as a zip with or without its media (worksuite-desktop#183); the server checks the policy and audits it. */
        chatExport: z.object({ room: z.number().int().positive(), format: z.enum(['txt', 'zip']), media: z.boolean() }).optional(),
        /** A Purchasing export (SRS-PUR-001 G-20, G-27): a report as CSV, XLSX or PDF, or a payment run's bank file (`shared/purchase.ts`). */
        purchaseExport: purchaseExportSchema.optional(),
        name: z.string().min(1).max(255),
        open: z.boolean().optional(),
      })
      .refine((v) => [v.fileId, v.mail, v.mailSource, v.recording, v.export, v.importErrors, v.version, v.payslip, v.payrollDoc, v.hrDocument, v.hrReport, v.hrLetter, v.picture, v.orderPdf, v.minutesExport, v.transcriptExport, v.invoicePdf, v.billingExport, v.billingFile, v.paymentSlip, v.ordersCsv, v.omsReport, v.omsRouteSheet, v.tenderDocument, v.tenderLine, v.tenderLetter, v.tenderLibrary, v.financeCsv, v.expenseFile, v.garageDoc, v.chequeDoc, v.projectsReport, v.projectReport, v.elearningMedia, v.officeExport, v.chatMedia, v.taskAttachment, v.chatExport, v.purchaseExport].filter((x) => x !== undefined).length === 1 && (v.hrEmployee === undefined || v.hrDocument !== undefined) && (v.tenderDocumentVersion === undefined || v.tenderDocument !== undefined), 'give a file id, a file version, a mail attachment or original, a recording, an export, an import job, a payslip, a payroll document, an HR document, an HR report, a resignation letter, a profile picture, an order or invoice PDF, a Billing export or file, the minutes or a transcript of a meeting, a payment slip, an order list, an Orders report, a route sheet, a tender document, checklist file, letter or library document, a Finance report, an Expenses file, a Garage document, a Cheque Manager PDF, a Projects report, a whole project report, an eLearning lesson file, an Office export, a chat attachment, a task attachment, a chat export or a Purchasing export'),
    { session: true, permission: 'desktop.downloads', sensitive: true, rate: 10 },
  ),
  'transfers:prepareMedia': ch(
    z.strictObject({ handle: idString.optional(), data: z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= 100 * 1024 * 1024).optional(), name: z.string().min(1).max(255).regex(/^[^/\\]+$/), originalQuality: z.boolean() }).refine((v) => !!v.handle !== !!v.data, 'Give a picked handle or recorded bytes.'),
    { session: true, rate: 30 },
  ),
  'transfers:upload': ch(
    z.object({ handles: z.array(idString).min(1).max(200), target: uploadTargetSchema }),
    { session: true, rate: 5 },
  ),
  'transfers:pause': ch(z.object({ id: idString }), { session: true }),
  'transfers:resume': ch(z.object({ id: idString }), { session: true }),
  'transfers:cancel': ch(z.object({ id: idString }), { session: true }),
  'transfers:retry': ch(z.object({ id: idString }), { session: true }),
  'transfers:open': ch(z.object({ id: idString }), { session: true, permission: 'desktop.files.open_external' }),
  'transfers:reveal': ch(z.object({ id: idString }), { session: true }),
  'transfers:clearFinished': ch(none, { session: true }),
  'transfers:pauseAll': ch(none, { session: true }),
  'transfers:resumeAll': ch(none, { session: true }),
  'transfers:resetSettings': ch(none, { session: true }),

  /*
   * Drive sync. The renderer names Drive folders and this app's own ids; a
   * place on this computer is only ever chosen in the main process's dialog.
   */
  'sync:status': ch(none, { session: true }),
  'sync:devices': ch(none, { session: true, rate: 5 }),
  /** Another of my devices: rename it, sign it out of sync, wipe its synced copy, or remove it. Never this computer. */
  'sync:deviceAction': ch(z.object({ id: driveId, action: z.enum(['rename', 'sign-out', 'wipe', 'remove']), name: z.string().trim().min(1).max(160).optional() }), { session: true, sensitive: true, rate: 5 }),
  /** Sync a Drive folder (null: all of My Drive) — into ~/WorkSuite Drive, or, with `choose`, a folder picked in a dialog. */
  'sync:add': ch(z.object({ folderId: driveId.nullable(), mode: syncMode, choose: z.boolean() }), { session: true, permission: 'desktop.files.sync', sensitive: true, rate: 3 }),
  'sync:remove': ch(z.object({ id: idString }), { session: true, sensitive: true }),
  'sync:setMode': ch(z.object({ id: idString, mode: syncMode }), { session: true, permission: 'desktop.files.sync' }),
  /** One folder, or with `id` null every folder on this computer. */
  'sync:pause': ch(z.object({ id: idString.nullable(), paused: z.boolean() }), { session: true }),
  'sync:now': ch(none, { session: true, rate: 2 }),
  /** Deletions held back by the guard: carry them out, or bring the files back. */
  'sync:resolve': ch(z.object({ id: idString, choice: z.enum(['apply', 'restore']) }), { session: true, sensitive: true }),
  'sync:reveal': ch(
    z.object({ fileId: driveId.optional(), folderId: driveId.optional(), syncFolderId: idString.optional() }).refine((v) => [v.fileId, v.folderId, v.syncFolderId].filter((x) => x !== undefined).length === 1, 'name one file, folder or synced folder'),
    { session: true, rate: 5 },
  ),
  'sync:lookup': ch(z.object({ files: z.array(driveId).max(500), folders: z.array(driveId).max(500), context: driveId.nullable() }), { session: true, rate: 30 }),
  /** Registers this computer for sync again after it was signed out from elsewhere. */
  'sync:reconnect': ch(none, { session: true, permission: 'desktop.files.sync', sensitive: true, rate: 1 }),
  /** The sync conflicts the server holds open for me (Drive ENH-03 DSK-03), and deciding one. */
  'sync:conflicts': ch(none, { session: true, rate: 5 }),
  'sync:resolveConflict': ch(z.object({ id: driveId, resolution: z.enum(['keep_mine', 'keep_server', 'keep_both', 'dismiss']) }), { session: true, sensitive: true, rate: 5 }),
};

export interface TransfersOutputs {
  'files:pickFiles': PickedFile[];
  'files:registerDropped': PickedFile[];
  'files:pickFolder': PickedFile[];
  'files:chooseDownloadFolder': string | null;
  'files:saveText': string | null;
  'transfers:list': Transfer[];
  'transfers:download': Transfer;
  'transfers:upload': Transfer[];
  'transfers:prepareMedia': PickedFile & { preview?: string; mime?: string };
  'transfers:pause': void;
  'transfers:resume': void;
  'transfers:cancel': void;
  'transfers:retry': void;
  'transfers:open': boolean;
  'transfers:reveal': boolean;
  'transfers:clearFinished': void;
  'transfers:pauseAll': void;
  'transfers:resumeAll': void;
  'transfers:resetSettings': { preferences: Preferences; locks: PreferenceLock[] };
  'sync:status': SyncStatus;
  'sync:devices': { devices: SyncDevice[]; policy: SyncPolicy | null; thisDevice: number | null };
  'sync:deviceAction': void;
  /** null: the dialog was cancelled. */
  'sync:add': SyncStatus | null;
  'sync:remove': SyncStatus;
  'sync:setMode': SyncStatus;
  'sync:pause': SyncStatus;
  'sync:now': SyncStatus;
  'sync:resolve': SyncStatus;
  'sync:reveal': boolean;
  'sync:lookup': SyncLookup;
  'sync:reconnect': SyncStatus;
  'sync:conflicts': DriveConflict[];
  'sync:resolveConflict': { message: string };
}
