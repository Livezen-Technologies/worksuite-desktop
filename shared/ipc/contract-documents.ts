import { ch, driveId, imageBytes, pdfSession, pdfPage, pdfTicket, coverId, none, idString, officeBytes } from './contract-kit';
import { z } from 'zod';
import { pdfSourceSchema, SEARCH_MAX_QUERY, pdfSearchOptionsSchema, pdfPrintSchema, pdfEditOpSchema, pdfDeriveSchema, pdfComposeSchema, type PdfSessionView, type PdfBitmap, type PdfOutlineNode, type PdfLinkView, type PdfAttachmentView, type PdfDriveDetails, type PdfLocalPick, type PdfDiagnosticCheck, type PdfFailureReport, type PdfAnnotView, type PdfRect, type PdfToolResult } from '../pdf';
import { OFFICE_EDITOR_EVENTS, officeCommandSchema, type ExternalApp, type OfficeLocalCopy, type OfficeLocalPick } from '../office';
import { OFFICE_APP_SRC, type OfficeAppStatus } from '../office-open';
import type { LocalImageInfo } from '../types';

/** WorkSuite Office, PDF Studio and the image editor on this computer: spread into `contract` (shared/ipc/contract.ts; audit D-G13). */
export const documentsContract = {

  /*
   * The image editor on this computer (Drive ENH-03). A synced picture is named by its Drive id; where it is on disk
   * is the main process's to know. Edits saved offline wait beside it until sync sends them.
   */
  'image:localInfo': ch(z.object({ fileId: driveId }), { session: true, rate: 20 }),
  'image:localRead': ch(z.object({ fileId: driveId }), { session: true, rate: 5 }),
  'image:localSave': ch(
    z.strictObject({
      fileId: driveId,
      bytes: imageBytes,
      recipe: z.string().max(24 * 1024 * 1024),
      summary: z.string().max(500),
      note: z.string().max(500),
      width: z.number().int().positive().max(100_000).nullable(),
      height: z.number().int().positive().max(100_000).nullable(),
      copyName: z.string().trim().min(1).max(200).regex(/^[^/\\]+$/).nullable().optional(),
    }),
    { session: true, sensitive: true, rate: 5 },
  ),
  /** Open with › System editor: the synced copy in the computer's default app. */
  'image:openSystem': ch(z.object({ fileId: driveId }), { session: true, permission: 'desktop.files.open_external', rate: 3 }),
  /** Dragging the canvas out as a PNG: written first, then handed to the system's drag from inside dragstart. */
  'image:prepareDrag': ch(z.strictObject({ bytes: imageBytes, name: z.string().min(1).max(255) }), { session: true, rate: 10 }),
  'image:startDrag': ch(z.object({ token: z.string().uuid() }), { session: true, rate: 10 }),
  /** Brand libraries and fonts kept for offline use (DSK-04). */
  'image:cacheGet': ch(z.object({ key: z.string().min(1).max(300) }), { session: true, rate: 200 }),
  'image:cachePut': ch(z.strictObject({ key: z.string().min(1).max(300), bytes: z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= 32 * 1024 * 1024, 'A library item is at most 32 MB.'), type: z.string().min(1).max(100) }), { session: true, rate: 100 }),
  /** Download only / Export: the rendered picture where the person chooses in the save dialog. */
  'image:saveAs': ch(z.strictObject({ name: z.string().min(1).max(255).regex(/^[^/\\]+$/), bytes: imageBytes }), { session: true, rate: 10, sensitive: true }),

  /*
   * PDF Studio (WorkSuite PDF Studio SRS §23.1). Unknown fields are refused,
   * not stripped (PDF-API-003). The renderer names a session it opened, pages
   * and tickets; files arrive as a Drive id, a mail attachment's parts or a
   * handle the main process issued — never a path (PDF-API-001).
   */
  'pdf:open': ch(z.strictObject({ source: pdfSourceSchema }), { session: true, rate: 5 }),
  'pdf:state': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 20 }),
  // The password goes to the engine and is kept, if asked, in memory for this session only (PDF-OPEN-008, PDF-SEC-013/014).
  'pdf:unlock': ch(z.strictObject({ session: pdfSession, password: z.string().min(1).max(1024), remember: z.boolean() }), { session: true, rate: 2, sensitive: true }),
  'pdf:retry': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 2 }),
  'pdf:close': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 20 }),
  'pdf:render': ch(
    z.strictObject({
      session: pdfSession,
      page: pdfPage,
      scale: z.number().positive().max(64),
      tile: z.strictObject({ x: z.number().int().min(0).max(1_000_000), y: z.number().int().min(0).max(1_000_000), w: z.number().int().min(1).max(4096), h: z.number().int().min(1).max(4096) }).optional(),
      ticket: pdfTicket,
    }),
    { session: true, rate: 400 },
  ),
  'pdf:thumbnail': ch(z.strictObject({ session: pdfSession, page: pdfPage, ticket: pdfTicket }), { session: true, rate: 400 }),
  'pdf:cancel': ch(z.strictObject({ session: pdfSession, tickets: z.array(pdfTicket).max(1000) }), { session: true, rate: 60 }),
  'pdf:search': ch(z.strictObject({ session: pdfSession, query: z.string().min(1).max(SEARCH_MAX_QUERY), options: pdfSearchOptionsSchema }), { session: true, rate: 10 }),
  'pdf:searchCancel': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 20 }),
  'pdf:outline': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 10 }),
  'pdf:links': ch(z.strictObject({ session: pdfSession, page: pdfPage }), { session: true, rate: 200 }),
  'pdf:followLink': ch(z.strictObject({ session: pdfSession, page: pdfPage, index: z.number().int().min(0).max(10_000) }), { session: true, rate: 5 }),
  'pdf:attachments': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 5 }),
  'pdf:details': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 5 }),
  /**
   * A Drive file's cover (its first page, a PDF's or an Office file's, drawn by the window) in PDF Studio's sealed
   * thumbnail cache, by the file and the version it shows: never a name, never readable without the database key.
   */
  'pdf:coverGet': ch(z.strictObject({ id: coverId }), { session: true, rate: 600 }),
  'pdf:coverPut': ch(z.strictObject({ id: coverId, jpeg: z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= 512 * 1024, 'A cover is at most 512 KB.') }), { session: true, rate: 300 }),
  'pdf:print': ch(pdfPrintSchema, { session: true, rate: 2 }),
  // The main process's open dialog; the chosen PDFs come back as handles.
  'pdf:pickLocal': ch(none, { session: true, rate: 2 }),
  // Paths only from a real drop, turned into paths in the preload (as files:registerDropped).
  'pdf:registerDropped': ch(z.strictObject({ paths: z.array(z.string().min(1).max(4096)).min(1).max(20) }), { session: true, rate: 5 }),
  'pdf:diagnostics': ch(none, { session: true, rate: 1 }),
  /*
   * Stage D2. A change is one operation (shared/pdf.ts) the main process checks
   * against the session's mode and the server's permissions before the engine
   * sees it; saving goes to WorkSuite (or this computer's own file) from the
   * main process, which alone holds the file.
   */
  'pdf:mode': ch(z.strictObject({ session: pdfSession, mode: z.enum(['VIEW', 'ANNOTATE', 'EDIT']), takeover: z.boolean().optional() }), { session: true, rate: 5 }),
  'pdf:edit': ch(z.strictObject({ session: pdfSession, op: pdfEditOpSchema }), { session: true, rate: 30 }),
  'pdf:undo': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 20 }),
  'pdf:redo': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 20 }),
  'pdf:annotations': ch(z.strictObject({ session: pdfSession, page: pdfPage }), { session: true, rate: 200 }),
  'pdf:textSpan': ch(
    z.strictObject({ session: pdfSession, page: pdfPage, from: z.tuple([z.number().min(-20_000).max(20_000), z.number().min(-20_000).max(20_000)]), to: z.tuple([z.number().min(-20_000).max(20_000), z.number().min(-20_000).max(20_000)]) }),
    { session: true, rate: 60 },
  ),
  'pdf:save': ch(z.strictObject({ session: pdfSession, target: z.enum(['version', 'copy']), note: z.string().max(200).optional() }), { session: true, rate: 3, sensitive: true }),
  'pdf:resolve': ch(z.strictObject({ session: pdfSession, answer: z.enum(['keep_both', 'upload_as_new_version', 'use_cloud']) }), { session: true, rate: 3, sensitive: true }),
  'pdf:discard': ch(z.strictObject({ session: pdfSession }), { session: true, rate: 3 }),
  'pdf:extract': ch(z.strictObject({ session: pdfSession, pages: z.array(pdfPage).min(1).max(10_000) }), { session: true, rate: 3 }),
  // Tools on this computer (D-G12): a protected or unlocked copy, parts, page images or text from the open PDF; and a
  // new PDF combined from PDFs, made from pictures or of blank pages. Passwords go to the engine and are never kept.
  'pdf:derive': ch(z.strictObject({ session: pdfSession, req: pdfDeriveSchema }), { session: true, rate: 3, sensitive: true }),
  'pdf:compose': ch(z.strictObject({ req: pdfComposeSchema }), { session: true, rate: 3 }),
  // PDF Studio Pro (PRO-SIG-002): the person's own token signs the server's signed attributes; the PIN goes to the
  // token library in the tool's environment, never on a command line, never kept.
  'pdf:tokens': ch(z.strictObject({ module: z.string().min(1).max(400).nullable().optional() }), { session: true, rate: 2 }),
  'pdf:tokenSign': ch(z.strictObject({
    module: z.string().min(1).max(400), token: z.string().min(1).max(64), id: z.string().regex(/^[0-9a-fA-F]{1,64}$/), pin: z.string().min(1).max(64),
    data: z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= 65536, 'Nothing to sign.'), ec: z.boolean(),
  }), { session: true, sensitive: true, rate: 2 }),

  /*
   * Office documents (shared/office.ts, electron/services/office-editor.ts): a tab lays the editor's
   * isolated view over its placeholder and talks to it; the session itself is the tab's, over the API.
   * The configuration is the server's signed one, passed through untouched; the main process loads an
   * editor only from a Document Server address it accepts (`documentServerOrigin`).
   */
  'office:open': ch(
    z.object({
      key: idString,
      fileId: driveId,
      sessionId: z.string().regex(/^[0-9a-f-]{36}$/),
      organizationId: z.string().max(64).nullable(),
      documentServerUrl: z.string().min(8).max(512),
      apiUrl: z.string().min(8).max(1024),
      config: z.record(z.string(), z.unknown()),
      events: z.array(z.enum(OFFICE_EDITOR_EVENTS)).max(OFFICE_EDITOR_EVENTS.length),
    }),
    { session: true, rate: 5 },
  ),
  'office:place': ch(
    z.object({
      viewId: z.string().uuid(),
      bounds: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().min(0).max(20_000), height: z.number().finite().min(0).max(20_000) }),
      visible: z.boolean(),
    }),
    { session: true, rate: 120 },
  ),
  /** A picture of the editor, shown in its place while a menu over it is open (worksuite-desktop#39). */
  'office:snapshot': ch(z.object({ viewId: z.string().uuid() }), { session: true, rate: 30 }),
  'office:command': ch(
    z.object({
      viewId: z.string().uuid(),
      command: officeCommandSchema,
      events: z.array(z.enum(OFFICE_EDITOR_EVENTS)).max(OFFICE_EDITOR_EVENTS.length).optional(),
      /** A reload on a new session (reopened, or a newer version): the view's session is that one now. */
      sessionId: z.string().regex(/^[0-9a-f-]{36}$/).optional(),
    }),
    { session: true, rate: 20 },
  ),
  'office:close': ch(z.object({ viewId: z.string().uuid() }), { session: true, rate: 20 }),
  'office:focusFile': ch(z.object({ fileId: driveId }), { session: true, rate: 10 }),
  'office:externalApps': ch(z.object({ extension: z.string().regex(/^[A-Za-z0-9]{0,10}$/) }), { session: true, rate: 10 }),
  'office:openExternal': ch(
    z.object({
      fileId: driveId,
      name: z.string().min(1).max(255),
      folderId: driveId.nullable(),
      version: z.number().int().min(0).max(2 ** 31),
      app: z.enum(['default', 'word', 'excel', 'powerpoint']),
    }),
    { session: true, rate: 3, sensitive: true },
  ),
  // WorkSuite Office, the desktop editor (worksuite-desktop#322): whether it is here, and a file handed to it. The
  // main process builds the link itself (shared/office-open.ts) from the signed-in server and user; the page names
  // only the file.
  'office:desktopApp': ch(none, { session: true, rate: 20 }),
  'office:openInDesktopApp': ch(
    z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('drive'), fileId: driveId, name: z.string().min(1).max(255), mode: z.enum(['edit', 'view']).optional(), organizationId: z.string().regex(/^\d{1,12}$/).nullable().optional() }),
      z.strictObject({ kind: z.literal('copy'), path: z.string().regex(OFFICE_APP_SRC).refine((p) => !p.includes('..')), name: z.string().min(1).max(255), organizationId: z.string().regex(/^\d{1,12}$/).nullable().optional() }),
    ]),
    { session: true, rate: 5, sensitive: true },
  ),
  'office:localCopies': ch(none, { session: true }),
  'office:uploadLocal': ch(z.object({ id: z.string().uuid(), how: z.enum(['version', 'new_version', 'keep_both']) }), { session: true, rate: 3, sensitive: true }),
  'office:forgetLocal': ch(z.object({ id: z.string().uuid() }), { session: true, rate: 10 }),
  'office:revealLocal': ch(z.object({ id: z.string().uuid() }), { session: true, rate: 5 }),
  /** Offline (OO-OFF-020): is this file on this computer — kept by Drive sync, or a copy opened in another app. */
  'office:localAvailable': ch(z.object({ fileId: driveId }), { session: true, rate: 10 }),
  'office:openLocal': ch(z.object({ fileId: driveId, preview: z.boolean().optional() }), { session: true, rate: 3 }),
  // WorkSuite DOC / Sheet / Slides on files from this computer (office-local.ts): handles only, never paths.
  'office:pickFile': ch(none, { session: true, rate: 5 }),
  'office:readFile': ch(z.strictObject({ handle: z.string().uuid() }), { session: true, rate: 20 }),
  'office:writeFile': ch(z.strictObject({ handle: z.string().uuid(), bytes: officeBytes }), { session: true, rate: 20, sensitive: true }),
  /**
   * A Drive file's copy on this computer (synced, or opened in another app) for editing offline in the built-in
   * editor; what is written there goes back to the Drive when WorkSuite is online again (sync, or the copy's upload).
   */
  'office:readOffline': ch(z.strictObject({ fileId: driveId }), { session: true, rate: 20 }),
  'office:writeOffline': ch(z.strictObject({ fileId: driveId, bytes: officeBytes }), { session: true, rate: 20, sensitive: true }),
  /** "Save a copy on this computer": the main process's save dialog, then the bytes where the person chose. */
  'office:saveCopy': ch(z.strictObject({ name: z.string().min(1).max(255).regex(/^[^/\\]+$/), bytes: officeBytes }), { session: true, rate: 10, sensitive: true }),
  'slides:present': ch(z.object({ id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/), presenter: z.boolean().optional() }), { session: true, rate: 5 }),
  'slides:close': ch(none, { session: true }),
};

export interface DocumentsOutputs {
  'image:localInfo': LocalImageInfo;
  'image:localRead': Uint8Array;
  'image:localSave': { willBe: number; name: string };
  'image:openSystem': boolean;
  'image:prepareDrag': { token: string };
  'image:startDrag': boolean;
  'image:cacheGet': { bytes: Uint8Array; type: string; savedAt: string } | null;
  'image:cachePut': void;
  'image:saveAs': { name: string } | null;
  'pdf:open': PdfSessionView;
  'pdf:state': PdfSessionView;
  'pdf:unlock': PdfSessionView;
  'pdf:retry': PdfSessionView;
  'pdf:close': void;
  'pdf:render': PdfBitmap;
  'pdf:thumbnail': PdfBitmap;
  'pdf:cancel': number;
  'pdf:search': { searchId: string };
  'pdf:searchCancel': void;
  'pdf:outline': PdfOutlineNode[];
  'pdf:links': PdfLinkView[];
  'pdf:followLink': { opened: boolean; reason: string | null };
  'pdf:attachments': PdfAttachmentView[];
  'pdf:details': PdfDriveDetails | null;
  'pdf:coverGet': Uint8Array | null;
  'pdf:coverPut': void;
  'pdf:print': { printed: boolean; pages: number; reason: string | null };
  'pdf:pickLocal': PdfLocalPick[];
  'pdf:registerDropped': { files: PdfLocalPick[]; rejected: Array<{ name: string; reason: string }> };
  'pdf:diagnostics': { checks: PdfDiagnosticCheck[]; failures: PdfFailureReport[] };
  'pdf:mode': PdfSessionView;
  'pdf:edit': PdfSessionView;
  'pdf:undo': PdfSessionView;
  'pdf:redo': PdfSessionView;
  'pdf:annotations': PdfAnnotView[];
  'pdf:textSpan': { rects: PdfRect[]; text: string };
  'pdf:save': PdfSessionView;
  'pdf:resolve': PdfSessionView;
  'pdf:discard': PdfSessionView;
  'pdf:extract': { saved: boolean; name: string | null };
  'pdf:derive': PdfToolResult;
  'pdf:compose': PdfToolResult;
  'pdf:tokens': { available: boolean; reason: string | null; tokens: Array<{ module: string; token: string; manufacturer: string; certs: Array<{ module: string; token: string; id: string; label: string; der: string }> }> };
  'pdf:tokenSign': Uint8Array;
  'office:open': { viewId: string };
  'office:place': boolean;
  'office:snapshot': string | null;
  'office:command': boolean;
  'office:close': boolean;
  'office:focusFile': boolean;
  'office:externalApps': ExternalApp[];
  'office:openExternal': OfficeLocalCopy;
  'office:desktopApp': OfficeAppStatus;
  'office:openInDesktopApp': boolean;
  'office:localCopies': OfficeLocalCopy[];
  'office:uploadLocal': { state: 'uploaded'; version: number | null } | { state: 'conflict'; conflict: NonNullable<OfficeLocalCopy['conflict']> } | { state: 'queued' };
  'office:forgetLocal': boolean;
  'office:revealLocal': boolean;
  'office:localAvailable': { available: boolean; synced: boolean; preview: boolean; openInApp: boolean };
  'office:openLocal': boolean;
  'office:pickFile': OfficeLocalPick[];
  'office:readFile': Uint8Array;
  'office:writeFile': { size: number };
  'office:readOffline': Uint8Array;
  'office:writeOffline': { size: number; synced: boolean };
  /** null: the dialog was cancelled. */
  'office:saveCopy': { name: string } | null;
  'slides:present': { presenter: boolean };
  'slides:close': void;
}
