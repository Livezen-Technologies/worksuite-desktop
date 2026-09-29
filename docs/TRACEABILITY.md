# Requirement traceability — Phase 1

Status of every Phase 1 requirement of WS-DESKTOP-SRS-001 v1.1 in this build.
**Done** = implemented and exercised (unit or e2e); **Partial** = implemented
with a stated limit; **Later** = scheduled for a later phase by the SRS or
blocked by something outside the code.

## Shell, platforms & packaging (SHL)

| ID | Status | Where / note |
|---|---|---|
| FR-SHL-01 | Done | One codebase; CI builds macOS (universal), Windows x64, Linux x64/arm64 |
| FR-SHL-02 | Done | NSIS + MSI, DMG + PKG (+ zip for updates), AppImage + deb + rpm — `build/electron-builder.config.cjs` |
| FR-SHL-03 | Done | `app://bundle` only — `protocols/app-protocol.ts` |
| FR-SHL-04 | Done | `windows/manager.ts`; e2e checks no Node in the renderer |
| FR-SHL-05 | Done | macOS menu + traffic lights; Windows/Linux title bar with OS overlay controls; Cmd/Ctrl |
| FR-SHL-06 | Done | Light / Dark / System, Comfortable / Compact |
| FR-SHL-07 | Later | P4 (profile directories already per profile) |

## Authentication & organizations (AUTH)

| ID | Status | Where / note |
|---|---|---|
| FR-AUTH-01 | Done | Server step; enterprise preconfiguration from registry / MDM profile / `/etc/worksuite/policy.json` |
| FR-AUTH-02 | Done | WorkSuite login + TOTP/backup code, or a passkey proved in the browser and handed back with PKCE; refresh token in OS secure storage |
| FR-AUTH-03 | Done | Registration before bootstrap (`session.ts`) |
| FR-AUTH-04 | Done | `/desktop/v1/bootstrap` or composed from the existing API |
| FR-AUTH-05 | Done | Organization selector with "All organizations" |
| FR-AUTH-06 | Partial | Queries, widgets and navigation refresh without restart; permissions are reloaded on a desktop-v1 server, but WorkSuite grants them installation-wide, so they do not differ per organization |
| FR-AUTH-07 | Done | Tabs opened in another organization close with a toast |
| FR-AUTH-08 | Done | Single-flight rotating refresh; re-login keeps drafts and queued changes |

## Registry (REG)

| ID | Status | Where / note |
|---|---|---|
| FR-REG-01 | Done | Seven gates — `shared/apps.ts` |
| FR-REG-02 | Done | Manifests per module — `src/modules/registry.ts`, contract in `shared/manifest.ts` |
| FR-REG-03 | Done | Lazy chunks; per-module error boundary with Retry / Open Diagnostics |
| FR-REG-04 | Done | Tabs close and navigation updates with a toast when access disappears |
| FR-REG-05 | Done | No placeholders; apps without a desktop module are labelled "opens in your browser" |
| FR-REG-06 | Done | Home widgets per module, permission-filtered |
| FR-REG-07 | Done | Capability allow-list; invalid manifests dropped |

## Navigation, search, shortcuts (NAV, SRCH)

| ID | Status | Where / note |
|---|---|---|
| FR-NAV-01..04 | Done | Sidebar modes and pins; grouped launcher; full tab manager; tab restore filtered by permission |
| FR-NAV-05/06/09 | Done | Record and mini-chat windows, bounds per display, off-screen recovery, always-on-top for chat/timer. Tabs tear off into their own windows (drag out, menu, Mod+Shift+N; `windows:detach`, placed by `detachedBounds`) and dock back (title-bar buttons, or the window's handle dragged onto the strip or the page; `windows:dock`/`windows:adopt`); torn-off windows reopen where they were (`windows:restoreDetached`, `tab_sessions` `detached`), close at sign-out and come back at sign-in. `src/core/tabs.ts`, `src/core/dock-drag.ts`, `electron/windows/manager.ts`; `tests/unit/renderer/docking*.ts*`, `tests/e2e/docking.mjs` |
| FR-NAV-07 | Partial | A tab docked beside the active one, with a resizable divider, swap and undock, restored with the tabs (`src/layouts/Workspace.tsx`). One docked tab, on the right; the AI dock is the other docked panel |
| FR-NAV-08 | Done | Idle tab suspension |
| FR-SRCH-01..04 | Done | Global search (server + offline cache), command palette, remappable shortcuts with conflict detection |

## Deep links (DL)

| ID | Status | Where / note |
|---|---|---|
| FR-DL-01..04 | Done | `worksuite://` registered by installers; allow-listed grammar; permission/org check with switch offer (`/desktop/v1/links/resolve` on a desktop-v1 server); single-instance forwarding |
| FR-DL-05 | Later | P3 |
| FR-DL-06 | Done | `.worksuite` associated; common formats never claimed |

## Tray, notifications (TRAY, NTF)

| ID | Status | Where / note |
|---|---|---|
| FR-TRAY-01..03, 05..07 | Done | Tray menu incl. Clock In/Out (also in the title bar, one implementation for both), quick actions, pause notifications; minimize to tray; autostart; background services; state icons with priority; dock/taskbar badge |
| FR-TRAY-04 | Partial | Required services from policy are applied and shown locked |
| FR-NTF-01..04, 06 | Done | Native notifications for server notifications, chat, calls and new mail; privacy modes (content hidden while locked); DND and pause |
| FR-NTF-05 | Partial (P2) | Incoming calls raise a notification; the always-on-top call window arrives with Meet |
| FR-NTF-07 | Partial | Read state is marked on the server; cross-device suppression depends on the server |

## Transfers, offline, realtime (XFR, OFF, RT)

| ID | Status | Where / note |
|---|---|---|
| FR-XFR-01/02 | Done | Central download and chunked, resumable upload managers |
| FR-XFR-03 | Done | Transfer Center |
| FR-XFR-04 | Partial | Drop onto Files and Chat |
| FR-XFR-05 | Done | Paste screenshots/files into Chat, user gesture only |
| FR-OFF-01..05 | Done | READ_CACHE proxy; encrypted ordered queue with idempotency keys, conflicts surfaced; network pill with pending count |
| FR-OFF-06 | Done | Mail cache window 7/30/90 days or headers only |
| FR-OFF-07 | Done | Encrypted draft recovery (mail compose, chat, quick-add task) |
| FR-RT-01..04 | Done | One socket in main, backoff with jitter, resync by REST refetch (the gateway has no cursor), reconnect on org change and resume |

## Drive sync (WorkSuite Drive FR-SYN, WF-15)

| ID | Status | Where / note |
|---|---|---|
| FR-SYN-01 | Done | Device credential from registration, `X-Device-Token` only — `services/sync/protocol.ts` |
| FR-SYN-02 | Done | Journal polled (own writes excluded) and acknowledged after a complete pass; a snapshot pass every five minutes catches what the journal does not record — `services/sync/engine.ts` |
| FR-SYN-03 | Done | have → block → commit; manifests with local block reuse — unit: `sync-engine.test.ts` (one changed block sends and fetches one block) |
| FR-SYN-04 | Done | Both changed: both kept (here, and taking the server's conflicted copy when a commit races) — `plan.ts`, `engine.ts` |
| FR-SYN-05 | Done | Sync policy applied both ways (size, blocked types, ignore patterns, speed limits); desktop policy `file_sync`, `personal_device_mode`, `removable_media_sync` |
| FR-SYN-06 | Done | Chosen folders (`sync_roots` kept current), two-way / upload-only / download-only; sessions recorded |
| FR-DEV-01 | Done | Files → Sync devices: rename, sign out, wipe, remove another device; wipe on `hello` or revoke removes only what sync put here |
| FR-DEV-02 | Done | Pending up/down and the last error go out with the heartbeat |

## Office documents (WorkSuite Drive — ONLYOFFICE Office File Integration SRS, desktop)

`src/modules/office` (the tab), `src/modules/files` (routing, menus, + New), `electron/services/office-editor.ts`
(the editor view), `electron/security/office-policy.ts`, `electron/preload/office.ts`,
`electron/services/office-external.ts` (other apps), over the server's Office API (`app/Modules/EuroOffice`; see
BACKEND.md). The MVP items of §7 and §9, and the ones the desktop shares with every client. Tests:
`tests/unit/shared/office.test.ts`, `tests/unit/electron/office.test.ts`, `tests/unit/renderer/office.test.tsx`,
`tests/unit/renderer/files.test.ts`. Not yet run against a real Document Server (see the changelog).

| ID | Status | Where / note |
|---|---|---|
| OO-DSK-001 (MVP) | Done | Opening an Office file in Files (double-click, Enter, Open, Edit, Open read-only) opens `/office/<id>` in a WorkSuite tab with the editor; no browser window |
| OO-DSK-002 (MVP) | Done | `OfficePage.tsx`: header with the name, the save status, presence, the mode, Share and ⋯; the Document Server's own toolbar, canvas and status bar below |
| OO-DSK-004 | Done | One tab per document (`core/tabs.ts` record tabs); a document open in another window is brought forward there (`office:focusFile`) |
| OO-DSK-005 | Done | Each tab its own session and view |
| OO-DSK-006 | Done | Close guard: "Saving changes…", waits up to 10 s for the editor's changes to reach the Document Server, force-saves, then closes |
| OO-DSK-020 (MVP) | Done | `WebContentsView`, own in-memory partition per organisation and own process; nodeIntegration off, contextIsolation, sandbox, webSecurity |
| OO-DSK-021 (MVP) | Done | Navigation and requests held to the Document Server's origin (and WorkSuite's pictures); new windows and links to the system browser after the check; no WorkSuite token reachable |
| OO-DSK-022 | Done | `officeBridge`: ready, failed, events, commands; checked in the main process |
| OO-DSK-023 | Done | Partition per organisation, in memory, cleared when its last document closes, at sign-out and quit |
| OO-DSK-024 | Partial | The editor's own downloads are stopped; Download and Download as PDF in the tab go through Drive's permissions and the download manager |
| OO-DSK-050 (MVP) | Done | Open in Microsoft Word / Excel / PowerPoint (where installed: macOS Applications, Windows App Paths) or the default app: sync's copy, or a download through the download manager, watched |
| OO-DSK-051 | Done | Sync-owned files go back through Drive sync; other copies only when the person uploads |
| OO-DSK-052 | Needs a Document Server | The editor's Print (shown only with `files.print`, from the signed configuration) goes to Chromium's print, which is the system dialog in Electron — not yet tried against a real server |
| OO-DSK-060 | Done | Tabs bound to the organisation chosen when they opened; switching away closes them with `ORG_SWITCH` (the file's own company is not in the bootstrap — BACKEND.md) |
| OO-DSK-003, 010, 011, 030–033, 040–043 | Later / partial | Tabs pin, close others, move to a new window and dock like any tab (the document reopens there); full-screen, local-file sessions and the docked preview pane are later phases |
| OO-SES-001/002 (MVP) | Done | `POST …/office/session` with `client_type` by OS and `layout: desktop`; the signed `config` handed to the editor untouched |
| OO-SAV-020 (MVP) | Done | "Saving…" while the editor has unsent changes, "Saved · 14:32", "Save failed" / "Saving is delayed" with Retry; last WorkSuite version beside it (OO-SAV-021) |
| OO-SAV-030 | Done | A crashed editor or a reload renews the same session (`GET …/config`) and reloads on the same key |
| OO-COL-001–004 | Done | Presence from the heartbeat in the header; realtime `office.*` events bring the next heartbeat forward |
| OO-COL-020–022 | Partial | Mentions notify through the server, never with comment text; people who cannot open it are offered Share. The @-list is filled only when the editor sends what was typed (server gap) |
| OO-COL-030 (MVP) | Done | Modes from `available_modes` (Editing, Reviewing, Commenting, Viewing); the switch is the server's |
| OO-COL-040 (MVP) | Done | Read-only opens with the server's `read_only_reason` as the banner; Switch to edit when offered |
| OO-COL-051/052 | Done | Keep to myself / let others edit again; "Switch to edit" when a lock runs out |
| OO-COL-060–062 | Done | Rename from the editor through Drive and `…/office/meta`; Share opens WorkSuite's share dialog; the editor's chat is off (server) |
| OO-VER-011/012/013 (MVP) | Done | Version history panel: download, restore; Save as version (labelled force save) |
| OO-DRV-010/021 (MVP) | Done | Office files route by the server's formats (`…/office/types`, cached offline); default action is the server's |
| OO-DRV-040 (MVP) | Done | Edit, Open read-only and Open in … in the file menu, from the file's `…/office/actions` when known |
| OO-DRV-050/051 (MVP) | Done | + New → Document, Spreadsheet, Presentation, From a template… — made by the server, opened for editing |
| OO-DRV-062, 070 | Later | Editing badges on Drive rows and recent editors in Details (P4) |
| OO-CNV-020 (MVP) | Done | Download as PDF (the export's signed link, through the download manager) and Save as PDF to Drive |
| OO-CNV-030/031 | Done | "This legacy file will be converted to DOCX for editing." — Convert & Edit, View Only, Cancel |
| OO-CNV-040 (MVP) | Needs a Document Server | As OO-DSK-052 |
| OO-OFF-001 (MVP) | Done | No Office editing offline: the tab never opens a session without WorkSuite |
| OO-OFF-020 (MVP) | Done | "You're offline. This file is available on this device." [Preview] (Quick Look, macOS) [Open in External App] "WorkSuite Office editing requires a connection." |
| OO-OFF-030 (MVP) | Done | "The cloud file changed while you were editing." — Keep Both, Review, Upload as New Version, Cancel, as the server offers |
| OO-OFF-031 | Done | Uploads carry `base_version`; nothing is replaced silently |
| OO-OFF-040 | Done | Other apps get a local copy; changes go back only on request (or through sync, for synced paths) |
| OO-ERR-001 | Done | A Document Server outage shows the server's sentence with Download / Open in … / Open in the browser / Try again; Files keeps working |
| AC-05, AC-21, AC-24 | Done | Tab, isolation, offline wording as above; AC-21's "inspect the renderer" is a unit test of the view's preferences and the bridge, not yet an e2e run |

## Communication (COM)

| ID | Status | Where / note |
|---|---|---|
| FR-COM-01 | Partial | Three-pane mail, combined inbox, shared mailboxes, folders, read, reply/forward, archive/delete, print, attachments download; composer is plain text without attachments |
| FR-COM-02/03 | Partial | Rooms, threads, receipts, reactions shown, files, typing, pending offline messages, mini window; sending reactions, voice notes and GIFs is on the web for now |
| FR-COM-04/05 | Done | Meet meetings in their own window; screen share through our picker only (`ScreenShare`) |
| FR-COM-06 | Partial | Meet remote control (WS-MEET-ENH-01): controlling another shared screen (`src/modules/meet/remote`), and being controlled (`electron/services/remote-control`) — consent with local proof, signed grant, AES-GCM + HMAC channel, input through PowerShell/SendInput, osascript/CGEvent or xdotool; Wayland is share-only. Handover asked in the same prompt; files both ways (RC06), accepting with local proof. The named laser pointer and annotations over a shared screen (RC-PTR-01…03, RC08; `src/modules/meet/remote/pointers.ts`, `PointerLayer.tsx`), the web client's messages on its topic, which the person sharing can clear or switch off; the controller's name beside the pointer on the shared computer (RC-INP-04). Injection is unit-tested with a fake helper and run for real on Linux (X11, under Xvfb); the Windows helper ran under PowerShell against a stand-in user32 and the macOS script against a stand-in bridge. `tests/os/remote-control/check.mjs` (workflow *Remote control helpers*) runs them on real Windows and macOS: not yet run, as GitHub started no Actions jobs in the repository on 2026-09-28 |
| FR-COM-07/08 | Partial | The AI dock (Ask / Write / Changes) and Quick Ask (Ask / Rewrite or translate). Ask is the server's assistant (`/api/ai/assist/chat`, `assistant.panel` and `desktop.quick`): the record the active tab shows as its context, which the person can leave out; a file picked on this computer (`ai:upload`: a synced Drive file by its Drive id, anything else its words for a day). Changes it proposes are cards confirmed only in the main window, through `ai:confirm` (the API proxy refuses the route); Quick Ask sends a card to the main window instead. Waiting changes arrive as notifications that only open the Changes view, and in the tray (`electron/services/ai-pending.ts`). The device policy's `ai_quick_ask`, `ai_insert`, `ai_local_files` and the company's AI policy (`/api/ai/assist/device`) both apply, the stricter winning (`electron/services/ai.ts`). Write is the writing assistant (`/api/ai/write`). Quick Ask reads the selection once, on its shortcut, and inserts only on a click. File summaries with citations are the web's |

## Website Live Chat (WS-WCHAT-SRS-001 v1.4, desktop parts)

| ID | Status | Where / note |
|---|---|---|
| RING-40…48 (R3) | Done | `electron/services/webchat-ring.ts` (WebchatRinger: the list from `assignments/pending` every 15 s and `chat.incoming`/`assigned`/`at_risk`/`taken`/`widget.message`), `WindowManager.showRinger` (frameless, above full-screen apps, non-activating, bottom right), `src/modules/chat/website/Ringing.tsx` (call window, the bar under the tabs, tones), tray ringing state and menu, Dock bounce / taskbar flash, Ctrl/Cmd+Shift+J while ringing, Settings › Notifications › Website chats. Rings until someone joins by the server's own rule (`ring_seconds` 0); a capped organisation stops the tone at the cap |
| RING-49 | Partial | IPC `ring:state`, `ring:join`, `ring:silence`, event `ring:changed`. No ring heartbeat or device arbitration: `POST chat/ring/heartbeat` is not on the server |
| RING-11, RING-03 | Partial | Silence is per computer (no server silence yet); the ring stops when the server stops listing the chat, not "visitor left" (no ring sessions on the server yet) |
| RDC-01…04, 06…08, 14 | Done | The website thread on Team Chat's `Composer` with the website profile (`website` prop; `src/modules/chat/website/profile.ts`): saved replies with "/" and chips, the visitor allowlist and size limit before upload, replies through the offline outbox (pending/failed in the thread), drafts, paste, camera, OS drops, native picker (transfer target `website`) |
| RDC-05, 09…13, 15…17 | Gap | Copy-from-Drive, receipts, reply quotes and the shared message components need server and widget changes; notification inline reply and the mini window are not done |
| TEAM-*, LIVE-*, VOICE-* | Gap | Multi-staff chats, live typing/receipts and widget voice calls: none of their APIs exist on the server yet |

## Garage & Vehicle Service Center (WS-GARAGE-SRS-001 v1.1, desktop)

`src/modules/garage`, over the server's `/api/garage/v1` (`app/Modules/Garage`, parts 1–4). The SRS's Phase 1 is its
**M** requirements; the ones that are the server's alone (install, numbering, the state machine, audit, scopes,
serializers) are listed where the desktop shows them. Tests: `tests/unit/renderer/garage*.test.tsx`,
`tests/unit/electron/garage-proxy.test.ts`.

| ID | Status | Where / note |
|---|---|---|
| FR-APP-01 | Done | Catalogue app `garage` (`garage.access`), manifest in `modules/registry.ts` |
| FR-APP-04 | Done | People with `garage.settings.manage` land on `Setup.tsx` until the company is set up; everyone else is told it is being set up; the floor's own screens (My work, Parts counter) and Workshop stay open |
| FR-APP-05 | Done | Tabs and actions follow `options.can` and each screen's own `can`; parts, invoice and payment appear only where the server gives them |
| FR-DSH-01, 03 | Partial | `Overview.tsx`: open, checked in today, awaiting approval, waiting for parts, in progress, ready, overdue (each opening its list), delivered today, bays available. Technicians working and revenue today: not on the server |
| FR-DSH-02, 05 | Partial | Overdue jobs, bays, latest open jobs. Appointments, technician workload, parts consumption, daily revenue, customer updates and reminders are not in the server's overview (revenue is in Reports, for money readers) |
| FR-BRD-01..04 | Done | `Board.tsx`: the server's columns; a drop asks the server, a refusal stays with its sentence; cancel (the one move that needs data) is on the job card with its reason |
| FR-BRD-02 | Partial | The card carries no technician: the server's card has the advisor only |
| FR-CUS-01, 02, 04 | Done | `Customers.tsx` (CRM's clients; added through CRM with the likely duplicates offered), owed (money readers), contact preferences, vehicles; credit terms for Garage managers |
| FR-VEH-01..05, 07 | Done | `Vehicles.tsx`, `Vehicle360.tsx` (edit incl. engine, registration, insurance, warranty; duplicate refused with the vehicle on file; odometer with a reason when lower; owners), `Workshop.tsx` makes and models. Next service due (FR-VEH-05) is not on the server |
| FR-VEH-04 | Partial | Overview, service history, open jobs, mileage, photos, notes, activity, owners, insurance and warranty. Per-vehicle inspections, parts replaced and documents are not in the server's 360° (they are on each job) |
| FR-WLK-01, 02 | Done | `WalkIn.tsx`: one search, create-if-missing, the open-job question; NORMAL unless someone chooses |
| FR-CHK-01, 02, 04, 05 | Done | `CheckIn.tsx`: readings, complaints, services, accessories, valuables, condition per area, damage diagram, photo slots (drop, choose, camera), signature, the server's missing list |
| FR-CHK-07 | Partial | The sheet through the download manager (view to print, save) and emailed again; WhatsApp and PDF are not on the server |
| FR-JOB-01, 03..06, 08, 09 | Done | `JobCard.tsx`: header, tracker, the server's moves, edit, cancel with a reason, history, timeline, overdue |
| FR-JOB-07 | Done | Tabs Overview, Check-in, Inspection, Diagnosis, Estimate, Work (work orders, parts, labour), Quality & delivery (QC, road test, invoice, handover), Media, Activity; approvals are in Estimate. A Warranty tab has nothing to show: warranty is P2 on the server |
| FR-DIA-01, 03 | Done | `job/Diagnosis.tsx`: finding, cause, repair, labour, parts, urgency, codes, sign-off; repairs become recommendations the estimate takes |
| FR-INS-01..04, 06 | Done | `job/Inspection.tsx` (lights, pass/fail, measurements, text, photos per item; customer-visible per item); templates in `Workshop.tsx` |
| FR-EST-01..05 | Done | `job/Estimate.tsx`: typed lines priced by the server, labour by rate class, parts with availability, versions locked once sent with what changed |
| FR-EST-07 | Partial | From recommendations; service packages are not on the server |
| FR-APR-01 | Partial | Send by email and the secure link (shown once, to copy into WhatsApp). Portal and WhatsApp sending are not on the server |
| FR-APR-02..06 | Done | Line decisions recorded by staff (method, who, note, signature in person); changes asked; deferred lines become recommendations on the server |
| FR-ADD-01, 02, 04 | Done | Found more work (My work and the Work tab), priced into a supplementary version, decided like any estimate |
| FR-WO-01..03 | Done | `job/Work.tsx`: work orders from approved lines, internal work, people, bay, cancel; the job's status follows on the server |
| FR-TEC-01..05 | Done | `MyWork.tsx` and the Work tab: start / pause with a reason / complete, one timer unless configured (server), roles, manual labour and corrections keeping the original |
| FR-BAY-01..03 | Done | `Workshop.tsx`: bays per workshop with type, the bay board with vehicle, job and status, manual status with a reason |
| FR-PRT-01..05, 07 | Done | Ask for a part, reserve, purchase request, issue by scan (`PartsCounter.tsx`), used, return with condition, release; over-approval only with a reason from someone who may |
| FR-QC-01..03, 05, 06 | Done | `job/Delivery.tsx`: the checklist item by item, pass, fail with reason and work orders to rework (not billed), attempts and rework listed, self-check explained |
| FR-DLV-01, 02, 04..06 | Done | Final review and Mark ready; invoice raised from approved charges; payment (cash, card, transfer, online, cheque); release paid, on credit, or by override with a reason; handover with signature; the delivery note through the download manager |
| FR-HIS-01, 02 | Done | Vehicle 360°'s history (work, parts, technicians, invoice, cost for money readers, warranty); the customer's across their vehicles (up to ten at a time) |
| FR-ANL-05 | Done | `Reports.tsx`: technician work as facts, beside aging, estimate vs actual, quality, parts, revenue, profitability; CSV for exporters |
| FR-MED-01, 02 | Done | `job/Media.tsx`, notes and inspection items: internal by default, shown to the customer by someone who may publish |
| FR-BRN-01, 02 | Partial | Branch → workshop → bay, warehouses, technicians per branch, rates per branch. Packages, price lists, hours and capacity are not edited on the server's API |
| FR-PRC-01, 02 | Partial | Labour rates by class, hourly or flat, per branch. Customer-specific, contract, warranty and internal-fleet rates are not on the server |
| FR-DOC-02, 03 | Partial | Check-in sheet, estimate, work order sheet and delivery note: view (to print) and save through the download manager. Job card, inspection and QC reports, parts issue sheet and warranty certificate, and PDF / WhatsApp / share: not on the server |
| FR-SET-01 | Done | `Settings.tsx`: the module's standard settings per company (`/api/module-settings/garage`) |
| FR-NTF-01 | Done | The server's notifications (`/garage?job=`) open the job card |
| FR-NTF-02 | Partial | The server emails the check-in sheet, the estimate link and (where on) ready for collection; appointment, reminder and warranty messages are Phase 2 there |
| FR-REM-05, FR-NTF-03 | Gap | Customer opt-out per channel and per-branch notification switches are not on the server |
| Offline (NFR-05) | Partial | READ_CACHE for options, overview, board, my work, jobs (with the tabs opened), vehicles, customers, workshop; the timer's start and pause queued with their moment; every other write waits for WorkSuite |

## eLearning (WS-ELN-SRS-001 v1.1, P1 — Core LMS, desktop)

`src/modules/elearning`, over the server's `/api/elearning/v1` (`app/Modules/Elearning`); offline copies in
`electron/services/elearning-offline.ts`. The rules, scores, reach and lifecycles are the server's; the desktop shows
what it answers and sends what happened. Tests: `tests/unit/renderer/elearning.test.tsx`,
`tests/unit/renderer/elearning-admin.test.tsx`, `tests/unit/electron/elearning-offline.test.ts`.

| ID | Status | Where / note |
|---|---|---|
| §4.1 navigation | Done | `ElearningShell.tsx`: Learning (My Learning, Course catalogue, Kept offline), Overview, Manage (Courses, Reviews, Categories), People (Learners, Enrolments, Requests to join, Grading), Settings — each by `options.can` (or course staff / line manager); later phases' items are not shown |
| FR-DSH-01, 02 | Partial | `admin/Dashboard.tsx`: the ten KPIs and the P1 widgets, within reach, for the chosen company; later phases' are "Later". Not on Home: the server declares no Home widgets |
| FR-DSH-04 | Done | `MyLearning.tsx`: continue learning with the resume point, deadlines, quizzes and assignments open, recommendations with reasons, history; certificates and classes are P2 (said so) |
| FR-CRS-01, 02, 05, 06 | Done | `admin/Courses.tsx`, `admin/CourseAdmin.tsx`: create (code offered; `code_taken` suggestion), edit with `revision`, duplicate, submit / recall / review / publish (now or later) / suspend / resume / archive / reopen / delete, each as the course's `can` allows, with reasons; the audit trail |
| FR-TYP-01 | Done | Type chosen on create; its defaults are the server's |
| FR-BLD-01..03 | Done | `admin/Builder.tsx`: drag-and-drop (and arrow buttons) across sections, sent with the revision (conflicts offered, never overwritten); duplicate, hide, unpublish; mandatory, duration, rule, release date, prerequisite |
| FR-BLD-04 | Done | `admin/Preview.tsx`: course and lesson preview, nothing recorded |
| FR-VID-01 | Server | Drive prepares; the builder shows preparing / failed / quarantined / missing |
| FR-VID-02 | Partial | `Lesson.tsx` Player: resume, 0.5×–2×, WebVTT captions, full screen, picture-in-picture. No quality choice: the adaptive rendition (`urls.hls`) needs an HLS player in the app |
| FR-VID-03 | Done | `PlayedRanges` (api.ts): played ranges reported every 15 s and on pause/seek/end; a seek plays nothing; the server merges and credits |
| FR-VID-04 | Done | Every rule offered in the lesson editor from `options.lesson_types` |
| FR-LIB-05 | Partial | PDFs, images and text in the app's viewer (view only); Save a copy only where the lesson allows. Word/Excel/PowerPoint cannot be shown (original file only on the server) |
| FR-CAT-01 | Partial | `admin/Categories.tsx`: create, rename, nest (5 levels), reorder, archive/restore, delete. Localised names (`names`) are the web's |
| FR-ENR-01, 04, 05 | Done | `admin/CourseEnrollments.tsx`: people, departments, branches (by id), CSV; preview then assign once (idempotency key); due date or days, mandatory, note. The enrolment's type and who assigned it shown |
| FR-ENR-06 | Done | `CourseAbout.tsx`: join / ask to join, or the server's reason (capacity, approval, assigned only) |
| FR-ASM-01 | Done | `Quiz.tsx` (all ten types to answer), `admin/AssessmentsTab.tsx` (all ten to build, with the key), `admin/GradeAttempt.tsx` (a person's grading) |
| FR-ASM-04, 07 | Done | The server's `seconds_left` counted down, asked again at zero; each answer saved as given (`PUT me/attempts/{id}/answers/{qid}`) |
| FR-ASG-01, 02 | Done | `Assignment.tsx`: text, Drive files, files from this computer (multipart, 25 MB), drafts; late marked or refused per the server |
| FR-ASG-03, 06 | Partial | `admin/Grading.tsx`, `admin/GradeSubmission.tsx`: queue, review, score, feedback, resubmit, grade change with reason. Rubrics are P2 |
| FR-PRG-01, 02 | Done | Progress and the rule's checklist are the server's; the rule is edited in Details (every / any; nested groups kept, not edited) |
| FR-PRG-05 | Done | `admin/EnrollmentDetail.tsx`: mark complete, reset, withdraw — reason required; extensions and extra attempts |
| FR-PRG-06 (P3) | Done early | Progress made offline waits in the offline queue and replays in order |
| FR-SRC-01 | Server | The catalogue is the server's search; a course out of reach answers 404 |
| FR-ORG-01, 04 | Done | Company picker for single-company work (set-up, creating, the dashboard); lists cover every company |
| FR-NTF-01, 03 | Done | The server's notifications open their screen (`/elearning/my/courses/<id>`, `/elearning/grading`, `/elearning/approvals`, `/elearning/learners/<id>`) |
| Offline (download manifest) | Done | `elearning-offline.ts`: manifest → download manager (`TransferManager.keep`) → AES-256-GCM chunks in the profile, played through `app://bundle/__local/…`; `protected` copies never leave the app (none do); purged on `validate`, licence end, policy, losing the app, wipe |

## Devices, security, updates (SEC, UPD)

| ID | Status | Where / note |
|---|---|---|
| FR-SEC-01/02 | Done | Registration and 5-minute heartbeat with directives and acknowledged commands |
| FR-SEC-03 | Done | DPAPI / Keychain / libsecret via safeStorage; no plaintext fallback |
| FR-SEC-04/05 | Done | App lock (timeout, manual, OS lock/sleep); password or Touch ID. Windows Hello needs a native module (later) |
| FR-SEC-07/08 | Done | Revoke → wipe of WorkSuite's own data only; on a desktop-v1 server the refused refresh (`DEVICE_REVOKED`) triggers it too |
| FR-SEC-11 | Done | "Cannot reach WorkSuite server…" |
| FR-UPD-01..05 | Done | Signed manifest, channels, minimum version screen, busy check, critical deadline with warnings; install requires signed builds |
| FR-UPD-06 | Partial | Per-user NSIS and machine-wide MSI; PKG for MDM; Linux repositories later |

## Printing, diagnostics, localization (HW, DIAG, L10N)

| ID | Status | Where / note |
|---|---|---|
| FR-HW-01 | Done | OS print dialog with preview; print to PDF |
| FR-DIAG-01..07 | Done | Health checks, redacted previewed bundle, Safe Mode after 3 crashes / 10 min, session restore, hardware-acceleration toggle, virtualized lists, hashing in a utility process |
| FR-L10N-01 | Partial | EN complete; SI/TA/AR/HI shell strings (need native review); RTL for Arabic |
| FR-L10N-02 | Done | User → organization → OS time zone; WorkSuite's UTC vs wall-clock rules |
| FR-L10N-03 | Partial | Keyboard navigation, focus rings, ARIA roles, reduced motion, high contrast; a full screen-reader audit is still to do |

## Known limitations

- Code signing, notarization and the Windows certificate are credentials this
  repository cannot hold; unsigned builds run but cannot self-update.
- Policies are signed only where the server has `desktop.policySigningKey`
  and the build pins its public key; see [BACKEND.md](BACKEND.md).
- Translations other than English need review by native speakers.
- The deb/rpm maintainer address is a placeholder until a support mailbox is chosen.
