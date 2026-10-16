# Architecture

## Processes (SRS §3.2)

| Process | Runs | Privileges |
|---|---|---|
| **Main** (`electron/main`) | lifecycle, windows, IPC router, tray, protocols, notifications, secure storage, SQLite, session, realtime socket, updater | full Node, never loads web content |
| **Renderer** (`src/`) | React 19 UI for the shell and modules | sandboxed Chromium, no Node, talks only through `window.worksuite` |
| **hash-worker** (`electron/workers`) | SHA-256 of files being uploaded | utility process, no network, reads only paths main names |
| **pdf-worker** (`electron/workers`) | PDF Studio's engine: PDFium (WebAssembly) for one open document | utility process per document, no network; reads only the one file main names |
| **local-ai-worker** (`electron/workers`) | Local AI: llama.cpp (node-llama-cpp) with the default model, GPU or CPU | one utility process, started on first request, ended after 10 idle minutes or at sign-out; no network; loads only the verified model file main names. Main (`services/local-ai/host.ts`) holds the CDN catalog and downloads; 3 crashes in 10 minutes stop it until **Restart**. The windows use `src/core/local-ai.ts` (status, models, `askLocal` streaming by request id); Settings → Local AI and the Ask panel's **On this computer** are its screens; `scripts/local-ai-catalog.mjs` makes and signs the CDN catalog |

Utility processes are run by the `ServiceSupervisor`: pinged every 10 s,
restarted with exponential backoff (1 s → 5 min), marked FAILED after 5
restarts in 10 minutes, shown in Diagnostics and the tray. A helper failing
never takes the window down. The monitoring agent (Phase 3) joins the
supervisor the same way.

## Drive sync

`electron/services/sync/` keeps chosen Drive folders in step with folders on
this computer (WorkSuite Drive FR-SYN-01…06). It runs in the main process;
its hashing (whole files, and the protocol's 4 MiB blocks) runs in the
hash-worker.

- **plan.ts** — pure. Three pictures of a folder — the index (what both sides
  last agreed), this computer, Drive — become actions: moves first (Drive's by
  id, this computer's by inode, so a renamed file keeps its versions and
  shares), then content. A path changed on both sides keeps both copies.
- **local.ts / remote.ts** — the two pictures. Drive's comes from
  `/api/drive/tree` and `/api/drive/list?deep=1`, because the server's journal
  cannot carry a folder sync on its own (see BACKEND.md). What cannot be read
  is *blind*, never *deleted*.
- **protocol.ts** — `/api/sync/*` with the device credential:
  hello → delta → have/block/commit, manifest/block, ack.
- **engine.ts** — passes (a local change, the journal every minute, every
  five minutes, Sync now), each action re-checked against the disk just
  before it runs and written to the index as it completes. Deletions go to a
  recycle bin; a mass deletion waits for a person; a folder missing on either
  side stops that folder instead of reading as "everything was deleted".
- **store.ts** — the index, in the profile database (`sync_folders`,
  `sync_entries`).

## Office documents

An Office file from Drive opens in a tab of its own (`/office/<file id>`,
module `modules/office`, a part of Files), one tab per document; opening it
again brings that tab forward, in this window or another (WorkSuite Drive —
ONLYOFFICE SRS §7). Three pieces:

- **The session** (`modules/office/session.ts`, the renderer): the server's
  Office API (`/api/files/{id}/office/*`) — open, a heartbeat a minute,
  renewal of the ten-minute signed configuration before it lapses or when
  the editor asks, reload when the server says so, reopen after a 410, mode
  switches, the save status, and closing: a tab with changes waits (up to
  ten seconds) for them to reach the Document Server, asks it to save,
  then ends the session (`core/tabs.ts` close guards; such a tab is never
  suspended). An organisation switch closes that organisation's documents
  with `reason=ORG_SWITCH`.
- **The editor view** (`electron/services/office-editor.ts`, the main
  process): a `WebContentsView` in the tab's window, laid over the tab's
  placeholder (`EditorSurface.tsx` reports where it is and whether it
  shows — hidden while a menu, dialog or the command palette is over it),
  in its organisation's in-memory partition, loading
  `wsoffice://editor/index.html` (`office-host-page.ts`), which loads the
  Document Server's `api.js` with the signed configuration. Its events come
  back over the editor bridge (`preload/office.ts`) as `office:event`; the
  tab's commands go to it as `office:command`. See SECURITY.md.
- **Other apps** (`electron/services/office-external.ts`): "Open in
  Microsoft Word / Excel / PowerPoint" or the default app — Drive sync's
  copy when sync keeps the file (sync takes the changes back), otherwise a
  download through the download manager that is then watched; an edited
  copy goes back only when the person says, as a new version with
  `base_version`, and the server's conflict is offered as Keep Both,
  Review, Upload as New Version or Cancel. Offline, the tab offers that
  copy (Quick Look on macOS, or the default app) and says editing needs a
  connection.

Files routes Office files by the server's `/api/files/office/types`
(cached for offline) and asks `…/office/actions` for a file's menu; + New
makes documents and copies of templates through `/api/files/office/new`
and opens them for editing. A server without the Office API keeps the old
way (the web's editor in the browser).

## PDF Studio (PDF Studio SRS, stages D1 — the viewer — and D2 — editing)

```
renderer (src/modules/pdf)                main (electron/services/pdf)                 pdf-worker × open documents
  PdfStudio → Workspace → Canvas  ──IPC──▶ DesktopPdfService ─────────────messages──▶ PdfiumProvider
  session id, pages, tickets               sessions · render queue + cache ·            (PDFEngineInterface,
  never a path or the file's bytes         sealed working copies · thumbnails ·         @embedpdf/pdfium)
                                           links · print · audit
```

- **PDFEngineInterface** (`engine.ts`): every engine call goes through it. `PdfiumProvider`
  (`pdfium-provider.ts`) implements it inside the worker; `WorkerEngine` (`worker-engine.ts`) implements it in
  the main process over the worker protocol (`worker-protocol.ts`); unit tests use a fake. Capabilities are asked
  at run time (`capabilities()`, PDF-ARCH-005) and the UI hides what is false.
- **One worker per open document** (`electron/workers/pdf-worker.ts`, started by `host.ts`). The engine reads
  the file a block at a time through `FPDF_LoadCustomDocument` (`file-reader.ts`), so a 2 GB drawing set is never
  in memory whole. WebAssembly memory only grows; ending the process when the tab closes is how it is given back.
  The worker answers pings; a hang, a crash or the memory ceiling ends it and the tab offers Retry. Once PDF
  Studio has been used, one spare worker is kept warm so the next document does not wait for the engine to start.
- **DesktopPDFService** (`service.ts`): sessions bound to the window that opened them; Drive files after
  `GET /api/pdf/{id}/status` (the server's "may this person open it"), streamed into a sealed working copy
  (`storage.ts`, the eLearning "WSL1" format, key in memory); renders queued per document, highest priority and
  newest first, two at a time, cancelled by ticket when the page leaves the view, cached (96 MB a document);
  thumbnails as JPEG, cached sealed on disk under a key derived from the database key; searches streamed as
  `pdf:search` events; the background scan for active content updating the session (`pdf:changed`).
- **PDFLocalFileBridge** (`local-files.ts`): handles for paths from the main process's dialog, a real drop, or
  the OS (argv / `open-file`); resolved, a regular file, `%PDF-` in its first bytes, within the size limit, and
  not inside the app's own data.
- **PDFPrintBridge** (`print.ts`): pages drawn by the worker at 150/300 dpi, served from memory to a hidden
  window (no preload, no JavaScript, no network, a CSP that allows only those images) on its own session, then the
  OS print dialog.
- **Renderer** (`src/modules/pdf`): `layout.ts` (pure: where pages sit for each view mode and zoom, which are
  on screen by binary search, which tiles), `Canvas.tsx` (preview → sharp → tiles per visible page, links and
  search highlights), `Workspace.tsx` (title bar, ribbon, panels, status bar, the §4.3 shortcuts through the
  shortcut registry while the tab is in front), `Panels.tsx`, `Dialogs.tsx`, `open.ts` (the hand-off other
  modules call: a tab per PDF).
- **Editing (stage D2)**: every change is one `PdfEditOp` (`shared/pdf.ts`: `annot.add|update|remove`,
  `page.rotate|delete|move|insertBlank|insertFile`), checked by zod in the contract and by the session's mode in
  `DesktopPdfService.edit`, then applied by the engine (`apply`: PDFium's `FPDFPage_CreateAnnot`,
  `EPDFAnnot_SetColor/SetOpacity/SetDefaultAppearance`, `FPDF_MovePages`, `FPDF_ImportPagesByIndex`,
  `FPDFPage_SetRotation`; a stamp is a FreeText whose `Subj` is `Stamp`, since PDFium draws no appearance for
  stamps). The session keeps the journal of ops since the base copy: undo reopens the base and replays all but the
  last (`replay`), redo re-applies. `annotations(page)` and `textSpan(page, from, to)` (the characters under a drag,
  for markup) are read back from the engine; the renderer never holds the document.
- **The server's session** (`studio-api.ts`, over `/api/files/{id}/pdf/*`): `open` returns the mode, the
  permission flags, the lock, the policy (autosave interval) and a one-time content URL; `beat` keeps it (and
  learns of a lost lock or a downgrade), `setMode` changes mode (Edit takes the lock, `takeover` when offered).
  `save` writes the engine's bytes (`PDFiumExt_SaveAsCopy`), uploads them in 4 MiB chunks with their SHA-256
  (`/pdf/uploads`, reused while the bytes are the same) and commits (`/pdf/save`, `new_version` or `copy` against
  `base_version`); `409 PDF_VERSION_CONFLICT` becomes the conflict dialog, answered with `resolve`. A local file is
  saved in place (`writeAtomically`, after unloading the engine — Windows cannot replace an open file). Offline, a
  save is kept as `pending` and flushed by `online()` when the connection is back.
- **Recovery** (`recovery.ts`): the edited bytes and the session's metadata sealed under
  `<profile>/PDF/recovery/<hash>/` with keys derived (HKDF) from the database key, on the autosave interval while
  there are unsaved changes and when the tab closes; opening the same file offers them back. Wiped with the rest.
- **Renderer**: `edit.ts` (tools, colours, the calls), `AnnotLayer.tsx` (a page's annotations and the tool being
  drawn), `Organize.tsx` (the page grid), `EditUI.tsx` (mode switch, save state and controls, banners, the conflict
  dialog, the Annotate and Organize ribbons, the Comments panel). A tab with unsaved changes has a close guard
  that keeps the work for recovery.

## Office editors

An Office tab (`/office/<id>`, `OfficePage.tsx`) picks its editor: the full Office session when the server has the
Office API; otherwise the server's EuroOffice editor from `GET /api/office/config/{id}` (`ClassicEditor.tsx`: the
signed config into the same isolated editor view, `office-editor.ts`; the Document Server saves through its
callback); and, when the server has no Document Server or the person chooses it (`?editor=builtin`),
**BetterOffice** (`BuiltinEditor.tsx`, `better/BetterEditor.tsx` — its own lazily loaded chunk): the file's bytes
from `/api/files/{id}/download` edited in the renderer by Rust engines compiled to WebAssembly, with the bundled
open fonts (`@betteroffice/fonts`, same-origin; Google Fonts off), and saved as a new version with
`POST /api/files/{id}/versions`. Any of them works in a detached window; the close guard saves first.

**WorkSuite DOC / Sheet / Slides** (`officeKind`, `OFFICE_KIND_LABELS` in `shared/office.ts`) name the tab by
type. A document that is not a Drive file opens at `/office/doc?src=…` (`officeDocRoute` / `parseOfficeDocRoute`)
in the built-in editor with an `EditorSource`: `api` — a path this server serves (`/api/…` or signed `/media/…`,
read through the app's proxy: mail attachments, tender files, chat files; `openInOffice()` in
`src/core/open-document.ts` is what modules call) — or `local`, a handle from **OfficeFileService**
(`electron/services/office-local.ts`: `office:pickFile`, `office:readFile`, `office:writeFile`,
`office:saveCopy`; files from the main process's dialogs or the OS's "Open with", never a path from a page).
**Online or offline** (`OfficePage.tsx`, decided when the tab opens): online a Drive file opens in the Document
Server (the full session or `ClassicEditor`, falling back to the built-in editor only when the server has no
Document Server); a non-Drive document (`DocTab`) is copied into My files → WorkSuite copies (`office/copies.ts`,
once per session) and the tab's route becomes that Drive file; a copy of a local file is linked to its handle and
written back (`writeBack`, `writeBackLater`). Offline (`OfflineDocument`) a Drive file is edited in the built-in
editor on its copy on this computer (`office:readOffline` / `office:writeOffline` over OfficeExternal's
`localPath`: the synced file or a copy opened in another app), which sync or the copy's upload takes to the Drive.
**New** (`office/create.ts`): the server's Office API, else Drive's `POST /api/files/create`, else a bundled blank
OOXML file (`office/blank/`, made by `scripts/make-blank-office.py`) uploaded with `uploadBlob`. Record tabs are keyed by `recordKey()` (`src/core/tabs.ts`), so each attachment or local file is its own tab.

## Drive covers

`src/modules/files/covers.ts` draws a Drive file's first page when the server has no thumbnail (pictures only):
pdf.js for PDFs, `slideToPng` for presentations, a hidden read-only BetterOffice editor's largest canvas for Word
and Excel. `Tile` asks for a cover through an IntersectionObserver; drawing is serialized; results go to PDF
Studio's sealed thumbnail cache (`pdf:coverGet` / `pdf:coverPut`, keyed `drive:<id>:<version>`, hashed on disk,
AES-256-GCM under the database-derived key, only with offline storage allowed).

## Side panels

Modules' side menus and panes are wrapped in `SidePanel` (`src/components/SidePanel.tsx`): a handle on the inner
edge hides the panel, a 36 px strip with the panel icon shows it again, and the choice is kept per panel id in
`localStorage` (`ws.panel.<id>`, a view preference, never data). The handle is invisible until the pointer is over
the panel or the handle has keyboard focus (worksuite-desktop#155), in every module alike, so it never sits over a
list or the content beside it. Panels with a toggle of their own (Chat's and Drive's details, PDF Studio's panels)
keep it.

## Theme

One rule (worksuite-desktop#155): **every module's content follows the app theme** — Light, Dark, or the system's,
set in Settings and written as `data-theme` on `<html>` (`src/core/app-state.ts`). Only the shell's chrome (title
bar and sidebar, `bg-navy`) is the same navy in both themes; it is the frame, not content. Inside it:

- Colours come from the tokens in `src/styles.css` (`bg-surface`, `bg-ground`, `bg-subtle`, `bg-selection`,
  `text-ink`/`-2`/`-3`, `border-line`, `bg-rail` for a module's narrow rail, `bg-warning-bg` with
  `text-warning-ink` for a warning banner, the `success`/`warning`/`danger` tones for status). Each token has its
  dark value, so a screen built from them is right in both themes with no `dark:` variant.
- A hex colour (`bg-[#FBFBFD]`, `text-[#9A4A06]`) or `bg-white` in module content is a bug unless it has its
  `dark:` partner — and a new one should be a token instead. Data that brings its colour (an app, a calendar, a
  person) uses `DATA_TEXT` / `avatarTone` (`src/components/ui.tsx`).
- The exceptions are deliberate and few: a QR code is black on a white plate in both themes (a camera needs the
  contrast — `QrCode` in `src/modules/chat/channels/LinkPhone.tsx`), and so is content somebody else designed.

Where Mail differs today: a message's body is drawn on a white plate in the dark theme unless "Dark mode for
email content too" is on (Mail settings; off by default), and a designed (HTML-template) mail always is (`MessageView.tsx`, `FileViewer.tsx`,
`SignaturePreview.tsx`), so a dark Mail shows a light reading pane. That is the "content somebody else designed"
exception applied to every message by default; making the dark body the default for plain mail is a preference
change in Mail, not a token, and is left to Mail's own work. WhatsApp follows the rule throughout: its list, rail,
banners and empty states use the tokens above.

## Checkboxes

Every checkbox is `Checkbox` (`src/components/Checkbox.tsx`); a bare `<input type="checkbox">` fails
`tests/unit/renderer/checkbox.test.tsx`. It is the native input with our look (`.ws-checkbox` in `src/styles.css`),
so focus, Space, labels, form values and screen-reader state come from the platform. It takes every input prop, plus:

- `indeterminate` — for a Select-all box when only some rows are chosen. Clicking it chooses them all.
- `invalid` — a validation error: red border and `aria-invalid`.
- `size="lg"` — 20 px, for touch-first screens (Salon's check-in). Otherwise 16 px everywhere; a click lands
  6 px beyond the box, so compact rows keep their height.
- `color` — a different accent, e.g. a calendar category's colour.

Clicks, double-clicks and Space on the box do not reach the element around it, so ticking a row never opens it.
Size and colour come from the component; pass only layout classes (margins, opacity) in `className`.

## Opening documents from other modules

A module that shows a document opens it on this computer, never in the browser. `openDocument()`
(`src/core/open-document.ts`) starts a `transfers:download` with `open: true` from one of the contract's named
sources (a Drive file, a mail attachment, an HR document, a chat attachment's `/media/{token}`, a task
attachment's `/d/{token}` grant, an invoice PDF…); the main process builds the request, and when the download
finishes the transfer manager's `openInApp` hands a PDF to PDF Studio (`handPdfs` → `openFromOs`, a local handle
and a `/pdf?local=` tab) and anything else to `shell.openPath` where `desktop.files.open_external` allows it.
Office files in Files go to WorkSuite's editor (`/office/<id>`) when the server has the Office API, otherwise to
`office:openExternal` — the installed Word, Excel or PowerPoint on a tracked copy saved back to the Drive.
The **Office** tile (`/office`, `OfficeHome.tsx`) is part of Files (`APP_PARTS`): new documents and templates
(`POST /api/files/office/new`), the copies open in other applications, and the recent Office files
(`/api/drive/list?view=recent`).

## The request paths

```
renderer ──fetch──▶ app://bundle/__api/api/…  ──▶ main: ApiProxy ──▶ WorkSuite API
                                                    │  adds Bearer token, device headers
                                                    │  refuses credential routes (auth, tickets, sync)
                                                    └─ READ_CACHE: stores/serves encrypted answers when offline

renderer ──window.worksuite.x.y()──▶ preload ──ipcRenderer.invoke──▶ main: IpcRouter ──▶ service
                                                    allow-list → zod → sender origin → lock →
                                                    session → permission → rate limit → audit
```

The renderer never holds a token. The access token lives in main-process
memory; the rotating refresh token only in OS secure storage.

## Session lifecycle

`SessionController` (`electron/main/session.ts`):

```
no-server → signed-out → [mfa] → registering → bootstrapping → ready
                                                        ├─ expired  (refresh refused; drafts kept)
                                                        ├─ blocked  (desktop disabled / device limit / admin block)
                                                        └─ revoked  (remote wipe: WorkSuite's data removed)
```

On `ready` it starts realtime, notifications, device heartbeat, queue replay,
transfer recovery and the attendance poll; on the way out it stops them. At
start-up a stored refresh token resumes the session; if the server is
unreachable the cached bootstrap starts the app offline and read-only until it
revalidates.

## Server API families

`probeServer` decides per server:

- `desktop-v1` — the server answers `/.well-known/worksuite-desktop`; the app
  uses `/desktop/v1/bootstrap`, `/devices/register|heartbeat`, signed policies
  and `/releases/manifest`.
- `core` — the existing WorkSuite API; bootstrap is composed from
  `/api/auth/me`, the organizations endpoints and `/api/sync/policy`; devices
  are sync devices; releases are a static signed manifest on the server.

Everything above the service layer is the same for both.

## Local data (§7.2)

One SQLite database per profile (`node:sqlite`, built into Electron — no
native module). Sensitive columns — cached responses, drafts, queued
mutations, notification text, tab state, bootstrap — are AES-256-GCM
ciphertext; the key is in the OS credential store. `synchronous=FULL`: a draft
or a queued change is on disk before the user is told it was saved.

The app-lock PIN (`services/lock-pin.ts`) is a `config` row per person holding a salted scrypt hash, itself
Vault-sealed, so the database file alone gives nothing to guess against.

## Renderer

- `core/` — bridge, API client, app state mirrored from main-process events,
  tabs, commands and shortcuts, drafts, i18n, time rules.
- `layouts/` — title bar (52 px), sidebar (220 px), tab strip (40 px),
  workspace, status bar (26 px) — §4.12.
- `modules/` — one folder per desktop module with a validated manifest
  (`modules/registry.ts`, §15). Modules are lazy chunks; each renders inside
  its own error boundary.
- A module's documents leave through the download manager by what they are,
  never by a path: `transfers:download` takes a typed variant (Garage's
  `garageDoc` — a check-in sheet, an estimate, a work order sheet, a delivery
  note or a report's CSV, `shared/garage-docs.ts`; Projects' `projectsReport`
  — a report as CSV, Excel or PDF — and `projectReport` — one project's whole
  report as PDF or Excel, `shared/projects.ts`), and the main process
  builds the address it fetches. Hotel PMS has a channel of its own,
  `pms:download` (`shared/pms-files.ts`), with the same shape and the
  `desktop.downloads` check repeated in its handler.
- READ_CACHE is declared in a module's manifest and served by the main
  process for the prefixes in `CACHE_PREFIXES` (`electron/main/index.ts`),
  per module, so an app taken away takes its saved answers with it.
- Garage (`modules/garage`) is a shell with a rail (`GarageShell.tsx`), the
  day's screens, the Job 360° (`JobCard.tsx`) whose heavier tabs are lazy
  chunks under `job/`, the check-in, vehicles, customers, reports and the
  workshop's set-up. Photos go up as multipart through the API proxy (25 MB
  a request) and come back through it for thumbnails.
- eLearning (`modules/elearning`) is a shell with a rail (`ElearningShell.tsx`)
  whose screens are lazy chunks: the learner's (My Learning, the catalogue,
  the course player with its lesson views, quizzes, assignments, kept
  offline) and, under `admin/`, the training team's (dashboard, courses and
  their lifecycle, the builder, assessments, assignments, enrolment, grading,
  set-up, settings). A course, a quiz attempt or a submission to grade can
  open in a window of its own. The video player reports the ranges played
  (`PlayedRanges`), never a claim of completion; a heartbeat that cannot reach
  WorkSuite waits in the offline queue.
- eLearning's offline copies (`electron/services/elearning-offline.ts`):
  the server's download manifest names a course's lesson files; each is a
  download-manager transfer kept inside the app (`TransferManager.keep`,
  a `DownloadSink`) instead of the downloads folder, sealed as it arrives —
  AES-256-GCM in 1 MiB chunks, each with its own nonce and its index as
  associated data, under a key per file held in the database's encrypted
  column (`elearning_offline`). `app://bundle/__local/elearning/{course}/{lesson}`
  serves the plain bytes to the app's pages, with ranges, a chunk at a time.
  `POST me/downloads/validate` at sign-in and on reconnect, and the
  licence's end date, decide what is removed; a wipe or losing the app
  removes the rest.
- Hotel PMS (`modules/pms`) is a shell with a rail (`PmsShell.tsx`) and a
  property selector; its screens are lazy chunks — the rack, the desk's
  lists, reservations, check-in and check-out, the stay with its folios, the
  cashier and the night audit, the operations (housekeeping tasks, rooms,
  restocks, maintenance, lost and found, guest requests), the tape chart,
  invoices and the reports. The operations share `ops.tsx`: a record's moves
  as the server offers them (`options`), each asking what it `needs` and sent
  with the record's `version`, and a people picker over the company
  directory. A file from the server (a report's export, a guest's document)
  leaves through its own channel, `pms:download` (`shared/pms-files.ts`): the
  page names it by what it is, the main process builds the address, checks
  `desktop.downloads` itself (`electron/services/pms-download.ts`) and hands
  it to the download manager, which fetches, saves and audits it — no bytes
  over IPC. Photos (housekeeping tasks, maintenance issues, lost items) go up
  as multipart through the API proxy. Addresses are read in one place
  (`routes.ts`), so a deep link, a notification's link and a window's route
  open the same screen. Offline it reads the rack and lists from READ_CACHE
  (per property: `shared/pms-cache.ts`, matched by pattern in
  `electron/main/index.ts`) and refuses every write. The desk's hardware is
  reached through `devices.ts`, a seam of typed providers ("no device" and
  the OS print dialog ship); printed cards, receipts and reports are laid out
  in `print.ts` from the server's data and printed with no script and no
  network.
- Hotel PMS door locks (`electron/services/pms-locks/`, `shared/pms-locks.ts`,
  `pmsLocks:*`): the key encoder of the device seam, through the property's
  on-site lock server. WorkSuite's door-lock provider decides every key and
  answers an **encoder payload** (rooms, validity, common areas, guest, cards,
  new or copy, and the vendor's own request); the renderer (`locks.ts`,
  `Keys.tsx`) hands it to `pmsLocks:run`, the main process checks it against
  this desk's settings (same property, vendor and connection, not expired),
  fills in this desk's encoder, frames it for the vendor's link and sends it —
  SHIP for Salto and Saflok's PMS link as STX…ETX+LRC frames over TCP
  (`frame.ts`, `link.ts`), Visionline, Vostio and Ambiance as JSON over HTTPS
  (`vingcard.ts`, `dormakaba.ts`) — and the renderer reports the outcome to
  WorkSuite (`POST keys/{log}/result`). The lock server's address is kept per
  WorkSuite server and property in the settings (`pmsLocks.servers`), its
  password or API key in the OS keystore; `LockServer.tsx` (Desk devices) sets
  it up and tests it. Check-in, a room move and the stay's Keys run the jobs
  WorkSuite answers; a desk with no lock server leaves them waiting. TTLock is
  cloud-to-cloud (WorkSuite calls it): the desk only shows its passcodes.
- The WorkSuite Events desk (`electron/services/event-desk.ts`, rules in
  `shared/event-desk.ts`): this computer as a check-in device at an event.
  Registering it, its key, its offline copy of the gate's tickets and the
  queue of what it did offline are the main process's; a scan goes to the
  server with the device and gate and a fresh `client_uuid`, and when the
  server does not answer (within six seconds) the desk answers from its copy
  with the server's own `ScanRules`, ported line for line, and keeps the
  check-in, check-out, refused attempt or walk-in in the queue with the
  device's sequence. Every fifteen seconds while signed in it sends what
  waits (`checkin/sync`, idempotent), catches up (`checkin/changes`) and,
  every minute, calls in (`devices/{id}/heartbeat`); the server's answer to
  each queued item (recorded, a possible duplicate, a cancelled ticket let in,
  a walk-in it could not confirm) stays beside it for the desk. The copy is
  held decrypted in memory while in use and written back two seconds after a
  scan changes it; the queue is on disk before the desk answers. Badges print
  from the server's sheet on the desk's printer (`event-desk-print.ts`).
  The renderer's `modules/events` is a shell with a rail per event
  (`EventsShell.tsx`, addresses in `routes.ts`) whose screens are lazy
  chunks: the desk (`DeskScreen.tsx` — the scan field keeps the keyboard's focus,
  so a USB scanner types into it), search, walk-in, payment, the live
  counters (also a window of their own), recent scans, the review queue, the
  program and session doors, badges, and the organiser's read of Event 360,
  registrations and attendees. It never sees the key: it asks the main
  process to scan (`eventdesk:scan`) and reads the desk's status, queue and
  offline search over IPC (`desk.ts`). READ_CACHE keeps its options, the
  events and their gates (`eventsCached`, matched in `electron/main/index.ts`)
  so a desk opened offline still knows what the person may do; someone who
  loses the Events app loses their copies, and the desk does nothing for them.
- POS (`modules/pos`, `electron/services/pos-*.ts`, `shared/pos.ts`): this computer as a paired till. The main
  process holds the till: `pos-desk.ts` pairs it (`POST api/pos/terminals/{id}/pair`, the `wsp_` credential into the
  OS keystore) and calls the till's own door with that credential (`/api/pos/device/heartbeat` every minute,
  `/api/pos/device/sales`, and — `PosDesk.door` — the catalogue, a sale's receipt, refund, void and e-mail);
  `pos-till.ts` keeps the catalogue copy (POS's own: through the door with nobody signed in — every
  `catalogue_minutes`, on reconnect, when the till opens, on Sync now — and on the staff API when a person refreshes
  it, a page at a time and then only what changed since (`catalogue/changes`, worksuite-desktop#296); Inventory's
  product list only on an older server; a product a sealed row, `pos-catalogue.ts`, its pictures for offline in
  `pos-thumbs.ts`), numbers each sale (a prefix per pairing and a
  counter that only goes up, `pos_counters`), seals it into `pos_sales` before the cashier is answered and sends
  the waiting ones in order, 25 a request, keyed by the receipt number so a resend is the same sale
  (`pos-outbox.ts`: created and already-had are done, refused keep WorkSuite's reason, 401 stops for a new pairing,
  503 waits); `pos-print.ts` prints receipts, X and Z reports as ESC/POS bytes raw to the receipt printer (or a page
  through its driver, silently) and pulses the drawer; `pos-display.ts` opens the customer display on a second
  monitor. All of it is one `createPos()` (`pos-ipc.ts`) registered on the router, its `pos:*` channels spread into
  the allow-list from `shared/ipc/pos-channels.ts`. The loop runs from start-up, whoever is signed in. The renderer
  is a shell with a rail (`PosShell.tsx`): the register (`Register.tsx` — the catalogue grid, search, a keyboard-wedge
  scanner anywhere (`barcode.ts`), the cart (`cart.ts`) priced by WorkSuite when it answers and previewed from the
  catalogue meanwhile (`pricing.ts`, the mobile till's arithmetic), the customer), the tender (`TenderPanel.tsx`: cash,
  card, transfer, wallet, split, change; offline only cash and card), the shift over the staff API (`ShiftScreen.tsx`:
  open with a float or a count, cash in and out, close on a count, blind where the company says so, X and Z reports),
  the till's sales with their sync state, WorkSuite's total and `review` flag, receipt, reprint (WorkSuite's receipt
  where it has one, `serverReceiptRows`), e-mail and — where the server announces them and the person may — refund
  (everything left or some lines) and void (in the sale's own open shift), sent by the main process through the
  till's door with the cashier named and the till's own number for it (`<receipt>-R<n>`, `-V`), WorkSuite's answer
  kept on the sale (`Sales.tsx`, `returns.ts`, `pos-till.ts: giveBack`), Printers and This till. Discounts follow
  `options` `can.discount` / `max_discount_pct` / `discount_override` (`discountRights`); the close follows the
  company's `rules` (note by note, blind, the variance tolerance). The customer display (`/pos/display`, `CustomerDisplay.tsx`) is a window of
  the shell on the second monitor; the register tells it what to show over a same-origin `BroadcastChannel`
  (`display.ts`: idle, the cart with unit prices, the payment as the tenders are taken, complete). Since #294 the channel
  goes both ways: the display passes on a phone number the customer typed, the masked match they confirmed, "not me" or
  a new number, and the register (`displayDesk.ts`) looks it up through `pos:desk` and answers with masked names only.
  Its promotions come from `pos-display-media.ts` (the door's `display`, pictures sealed in `pos_display_media`) over
  `pos:displayMedia`, which only the display's window may call.
  Offline the drawer's screens read the last `/api/pos/options`, `registers` and `sessions` from READ_CACHE and wait
  for WorkSuite to open, move cash or close; selling goes on.
  Phase 2 (pos 1.2.0) is lit per `options.capabilities` flag and only online: the counter's Phase 2 calls go through
  one channel, `pos:desk` (an operation list mapped to door paths by `pos-till.ts: deskCall`, the cashier named by the
  main process), plus `pos:approve` (a manager's PIN, passed once to `POST device/approvals`, never kept) and
  `pos:rename`; the renderer reads the answers in `desk.ts`. A sale or refund WorkSuite would take only with a
  manager's approval comes back as `{needs}` (not an error), the override (`Override.tsx`, `approval.ts`) gets an
  `approval_id`, kept in window memory only, and the action is sent again with it. Customers and loyalty
  (`CustomerDialog.tsx`), configured tenders with voucher and store-credit lookups (`TenderPanel.tsx`, `tender.ts`),
  held sales on the server (`OpenSales.tsx`), the category tree, favourites, stock, pictures and promotion badges
  (`catalog.ts`, `ProductGrid.tsx`, `CategoryPicker.tsx`), refund-to and line condition (`returns.ts`), the drawer's
  X/Z report (`ShiftScreen.tsx`) and the receipt template (`pos-print.ts: templateRows`, kept per till by
  `pos-till.ts`) each fall back to the Phase 1 behaviour on a server without the flag.
- Restaurant Manager (`modules/restaurant`, main process `electron/services/restaurant/`, rules in
  `shared/restaurant.ts`): this computer as one of a branch's **terminals** — a till, a kitchen screen, the pass or a
  printer host. `terminal.ts` pairs it (`POST terminals/{id}/pair`, after reading the terminal back from the
  server's structure) and keeps the key in the OS credential store; the API proxy adds it as `X-Terminal-Key` to the
  screens' Restaurant calls and refuses them pairing, `sync`, the heartbeat and the print agent's claim and answer.
  `sync.ts` keeps, per server, terminal and person, a sealed copy of what the till opens with (`pos`, the branch
  menu, the floor) and the ordered outbox (`outbox.ts`: `create_order`, `add_items`, `send` with the device's uuid,
  `client_ref` and line ids, played back through `POST sync` with an idempotency key per batch; conflicts stay
  marked for a manager, refusals wait for a person); every 30 s it sends the outbox, the heartbeat (queue, version,
  the printers' state) and refreshes the copy. Its tables are made by the service (`CREATE TABLE IF NOT EXISTS`),
  not a numbered migration. `print-agent.ts` claims the server's print jobs for the printers mapped on this
  computer every 4 s and prints the job's text raw (ESC/POS through CUPS or the Windows spooler, as SalonMate's
  drawer pulse) or as a page through the OS driver (SalonMate's scriptless hidden window), then answers printed or
  failed; it also prints a bill no print route took, test slips, and opens the drawer. `index.ts` makes the three
  and registers the `restaurant:*` channels. The renderer is a shell with a rail (`RestaurantShell.tsx`, addresses in
  `routes.ts`, strings in its own `i18n.ts`) whose screens are lazy chunks: the floor (`Floor.tsx` — tables by area
  in their state; seat, open, free, move, merge, split), the order (`Order.tsx` — the menu grid, an item's variant,
  modifiers, a combo's components, note, seat and course; send, fire and hold by course, serve, void with a reason
  and an approval; discounts, comps and price overrides in `Adjust.tsx`), the bill (`Bill.tsx` — the server's quote,
  single or split bills, present, print, payment with several tenders and the server's change, the order's payments
  with refunds, a tax invoice), the host stand (`Reservations.tsx` — the day's bookings with the server's moves, the
  tables' timeline, availability and booking), the cashier session, the kitchen and the pass (`Kitchen.tsx`),
  approvals, printers and what was kept offline (`Outbox.tsx`, with the branch's conflicts for a manager). Anything
  above a person's limit — a void, a discount, a comp, a price, a refund — is answered `approval_needed`; `Approval`
  asks, takes a manager's PIN here or their answer elsewhere, and the same request goes again with `approval_id`.
  Screens stay current from the gateway's `restaurant.live` pushes (the main process fans the realtime socket out as
  `realtime:event`; `parts.tsx: useLive` refreshes what each entity touches) with `live?after=` behind them as the
  catch-up — every few seconds without the socket, every 30 s with it; offline they read the copy and keep new orders
  and lines in the outbox, and everything with money, a void, a booking or a table move is disabled.
- WorkSuite Projects (`modules/projects`, main process `electron/services/projects/`, rules in `shared/projects.ts`;
  WS-PROJECT-SRS-001 PRJ-DSK-01..04, PRJ-TIM-05, NFR-09): native since 0.2.216 (it was a browser surface), and since
  0.2.220 (projects 1.2.0) every screen of the web's is drawn here. The tab (`ProjectsPage.tsx`) has the project
  switcher (⌘P), the views in the web's groups (`Rail.tsx`: Portfolio, Work, Delivery, Governance, Administer, with
  the counts), pinned projects (kept per server and person in `localStorage`, a view preference) and recent ones on
  the left; a project's board (`Board.tsx` — the columns, J/K, ←/→, Shift+←/→ moves the card, Enter opens, T timer,
  L log time, N new task, ⌘F filter, ⌘2 its timeline, ⌥⌘O a window of its own; the keys are caught in the capture
  phase while the tab is in front, so ⌘2 is not the shell's "tab 2" here) and, since projects 1.4.0, the same tasks
  as a list (`TaskList.tsx`, rules in `list.ts`, PRJ-LST-01..10, D05: the Board | List switch and ⌘⇧L / Ctrl+Shift+L,
  `/projects/<id>/board?view=list` or `/projects/<id>/list`, groups, sorting, quick filters, a column chooser, a
  treegrid drawn 150 rows at a time; a status change is the board's own move and outbox entry, a reason with Blocked;
  assignee, priority and due are the task's PUT and bulk is `POST tasks/bulk` — falling back to single edits on a
  server without it — both online only; CSV with a BOM through `files:saveText`). Which view a project opens in, and
  the list's layout, are remembered in `/api/prefs/projects.task_view[.p<id>]` with a copy in `localStorage` read
  synchronously and for offline (`view-prefs.ts`, as `core/org-prefs.ts`). A task opens in the task modal
  (`ProjectTaskModal.tsx`, since projects 1.5.0, PRJ-TED-01..10, D06) — the Tasks app's editor (`tasks/editor`:
  `TaskEditorFrame` and its parts, which the Tasks app's `TaskDetail` composes too) with the project's own parts
  (`TaskModalParts.tsx`: the Project group, Dependencies, Time). It reads `GET /api/tasks/{id}` with its `project`
  block (falling back to `GET /api/projects/tasks/{id}` on an older server), and `patchTask()` takes the field router
  of `task-editor.ts`: Tasks fields to `/api/tasks/{id}`, the project's fields to `PUT /api/projects/tasks/{id}`, the
  status as the board's move through the outbox. Fields the reader may not change are shown read-only with the
  reason; offline only the status, a comment and logged time go (the outbox) and the rest says it needs a
  connection; J/K walk the ids the view behind publishes (`usePublishTaskOrder`). My work
  grouped by the reader's own day (`logic.ts: groupMyWork`) and the day's time line. Its addresses are the web's
  (`routes.ts`, one `ProjectsView` kind per screen): `/projects/<id>` is a project's overview and its board
  `/projects/<id>/board` (`/tasks/<task>` a task over it; `/projects/board` the board of the project last worked in);
  `?project=`, `?task=` and `?new=` work over any view. The screens live in `screens/`, three families sharing one
  kit (`screens/kit.tsx`) and one company selector:
  - the portfolio (calls and the web's contract types in `portfolio.ts`): the Dashboard, All projects
    (`/projects/all`, every filter in the query), Templates, Clients (`/projects/clients[/<id>]`), the New project
    dialog (`?new=blank|<template>`), a project's page (`ProjectPage.tsx`: overview, `/team`, `/settings`,
    `/activity`, `/files`), the Activity log and Module settings;
  - delivery (`delivery.ts`): Timeline & Gantt (`/projects[/<id>]/timeline`, `GET <id>/schedule`), Milestones &
    billing (`/projects[/<id>]/milestones`; achieve with the 409 → force + reason retry, `milestones/invoice` to
    Billing's drafts, opened with `openLink('/billing?invoice=<id>')`), Sprints (`/projects[/<id>]/sprints[/<s>]`),
    Team workload (`/projects/workload`) and Time & approvals (`/projects/time[?tab=queue|summary]`; my week is
    `Views.tsx: TimeView`);
  - governance (`screens/gov-api.ts`, `gov-kit.tsx` for its formatters and tones): Budget & cost
    (`/projects/budget`, `/projects/<id>/budget`), Risks with the heat map (`/projects/risks`, `/projects/<id>/risks`),
    Change requests — list, Raise, Withdraw and the decision with what approval does (`/projects/changes[/<id>]`,
    `/projects/<id>/changes[/<id>]`) — and Reports (`/projects/reports[/<kind>]`) with the scheduled emails; a
    report's CSV, Excel or PDF leaves through the download manager (`transfers:download` with `projectsReport`,
    `shared/projects.ts`);
  - client access (`screens/client-api.ts`, server Project 2.6.0, since projects 1.6.0): a project's external members
    (`project_guests` — clients and people at other companies, never given staff access across the company
    boundary; `Guests.tsx`, on the Team tab; a WorkSuite person at another company is found through
    `GET <id>/guest-candidates?q=` and added by `user_id`), its password-protected status links and client updates
    (`ShareDialog.tsx`, "Share with client" in the project's header; a link's address is shown once, the password is
    never emailed), all read from `GET <id>/client-access`; and "Export report" in the header — the whole project as
    PDF or Excel through `transfers:download` with `projectReport` (`GET <id>/report?format=`), opened when it lands.
  A project's own screens (board, timeline, milestones, sprints, budget, risks, changes) sit under its tab strip
  (`ProjectPage.tsx: ProjectTabs`), as on the web. `company.tsx` is the shared company selector (G-01):
  `useProjectCompany()`, `withOrg()` and the "Company: ▾" control `CompanySelect` mirror the web's, the choice is the
  organisation filter's (`core/org-prefs`, app id `projects`), and portfolio-level reads carry it as `org` in the
  request and the query key while one project's reads do not. Every write on these screens other than the outbox's
  is online only (disabled offline). The one Projects page still on the web is a project's own Time tab
  (`/projects/<id>/time`): `BROWSER_PAGES` in `shared/links.ts` sends it to the browser.
  The main process keeps the timer (`timer.ts`: `GET time/running` and this week's entries every minute, start, stop,
  Switch to, pause; the tray's lines, the title bar's pill and the always-on-top mini timer window `/projects/timer`,
  kind `timer`), the idle prompt (powerMonitor's idle time read every 30 s; after 15 minutes one banner, Keep 15 min
  or Drop idle time — the running entry removed and the time up to the idle start logged, so one entry), the outbox
  (`outbox.ts`, its own sealed table `projects_outbox`: moves, comments, time logs and offline stops, each with an
  `Idempotency-Key`, sent in order on reconnect, wake, sign-in and Try now; a move reads the task first and, when its
  `updated_at` is not the one it was made from, waits for the person's choice instead of overwriting) and the
  banners with buttons (`notices.ts`: `project.change_waiting` → Review, `project.task_overdue` → Open task / Snooze
  1 day, claimed from the notification service as Support's are). READ_CACHE keeps `/api/projects` answers; the
  screens read the pinned boards, my work and five weeks of my time ahead (`desk.ts: keepOffline`). Sign-out clears
  the cache and the outbox with the rest. Approvals, budget and change decisions — and raising a risk or a change
  request, withdrawing one, scheduling a report and exporting one — are online only.
- Tabs stay mounted while recent (instant switching) and are suspended after
  the configured idle time; the tab set is saved and restored only for apps
  the user can still open.

## Time

WorkSuite sends two kinds of stamp that look the same. True-UTC stamps (chat,
mail, notifications, activity) are parsed with `parseTs`; the calendar feed is
wall-clock digits already on the reader's clock and is displayed as written
(`wallTimeLabel`) and bucketed by its date digits — exactly as the web client
does.
