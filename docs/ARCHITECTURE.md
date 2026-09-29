# Architecture

## Processes (SRS §3.2)

| Process | Runs | Privileges |
|---|---|---|
| **Main** (`electron/main`) | lifecycle, windows, IPC router, tray, protocols, notifications, secure storage, SQLite, session, realtime socket, updater | full Node, never loads web content |
| **Renderer** (`src/`) | React 19 UI for the shell and modules | sandboxed Chromium, no Node, talks only through `window.worksuite` |
| **hash-worker** (`electron/workers`) | SHA-256 of files being uploaded | utility process, no network, reads only paths main names |
| **pdf-worker** (`electron/workers`) | PDF Studio's engine: PDFium (WebAssembly) for one open document | utility process per document, no network; reads only the one file main names |

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

## PDF Studio (PDF Studio SRS, stage D1 — the viewer)

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
- **Seams for stage D2** (editing): the session's `mode` (VIEW) and `saveState` (read-only), the engine's
  `annotationsWrite`/`pages`/`save` capabilities (PDFium has them: `FPDFPage_CreateAnnot`, `FPDF_ImportPages`,
  `FPDFPage_SetRotation`, `PDFiumExt_SaveAsCopy`), the sealed working copies in `PDF/work`, and the service's
  `policy()` for the server's policies (defaults until then).

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
  note or a report's CSV, `shared/garage-docs.ts`), and the main process
  builds the address it fetches.
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
  cashier and the night audit. Addresses are read in one place
  (`routes.ts`), so a deep link, a notification's link and a window's route
  open the same screen. Offline it reads the rack and lists from READ_CACHE
  (per property: `shared/pms-cache.ts`, matched by pattern in
  `electron/main/index.ts`) and refuses every write. The desk's hardware is
  reached through `devices.ts`, a seam of typed providers ("no device" and
  the OS print dialog ship); printed cards, receipts and reports are laid out
  in `print.ts` from the server's data and printed with no script and no
  network.
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
- Tabs stay mounted while recent (instant switching) and are suspended after
  the configured idle time; the tab set is saved and restored only for apps
  the user can still open.

## Time

WorkSuite sends two kinds of stamp that look the same. True-UTC stamps (chat,
mail, notifications, activity) are parsed with `parseTs`; the calendar feed is
wall-clock digits already on the reader's clock and is displayed as written
(`wallTimeLabel`) and bucketed by its date digits — exactly as the web client
does.
