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

## Hotel PMS (WorkSuite Hotel PMS SRS v1.0, §14.2 desktop — front desk, cashier, night audit)

`src/modules/pms`, over the server's `/api/pms/v1` (`app/Modules/Pms`, stages A, B1 and B2). Business rules, money,
availability and the business date are the server's; the desktop shows what it answers and sends what the desk did.
The back office (rates, rooms, packages, taxes, reports, settings, the set-up wizard, the tape chart) is the web's.
Tests: `tests/unit/renderer/pms-desk.test.tsx`, `tests/unit/renderer/pms-money.test.tsx`, `tests/unit/shared/pms.test.ts`.

| ID | Status | Where / note |
|---|---|---|
| PMS-DSK-001 | Partial | `PmsShell.tsx`: the front desk, cashier and night audit with the web's P1 set for those roles — rack, arrivals / departures / in house, reservations with availability, check-in, walk-in, assignment, moves, check-out, folios, postings, payments, cashier, night audit, housekeeping read, guests, guest requests, dashboard. Rates, rooms, packages, taxes, reports, settings, the wizard and the tape chart stay on the web ("Back office on the web") |
| PMS-DSK-002 | Partial | `devices.ts`: typed providers for the ID scanner, key encoder, card/receipt printer, signature pad, cash drawer and card terminal; "no device" providers, and the printer is `print:print` (OS dialog). No vendor driver; a driver would sit in the main process behind its own IPC, as SalonMate's printer does |
| PMS-DSK-003 | Done | READ_CACHE for the property list, options, rack, arrivals, departures, in house (`shared/pms-cache.ts`, per property); the offline banner; every write disabled offline and never queued; balances hidden on the rack offline |
| PMS-DSK-004 | Done | The rack, a reservation, a stay and a folio open in windows of their own (`openInWindow`, record windows) |
| PMS-DSK-005 | Later | Cold-start and open-time targets need measuring on real hardware against a real server |
| PMS-WEB-003 (desktop) | Done | Alt+N new reservation (and the shell's Ctrl/⌘+N), Alt+W walk-in, Alt+F search, Alt+I check in, Alt+P post charge, Alt+R/A/D/H rack and lists — `shortcuts.ts`, the rail's "Keyboard shortcuts" |
| PMS-WEB-004 (desktop) | Done | The rail's search (`GET search?q=`): guest name, email, phone, confirmation, channel reference, room, across the properties reached |
| PMS-FD-001..004 | Done | `Rack.tsx`: rooms by building and floor with the server's badge (colour, icon, words), counts, FD-003 filters, FD-004 actions as the server lists them |
| PMS-FD-005 | Partial | `Lists.tsx`: the three lists one click from the rack; bulk room assignment; bulk registration cards for guests checked in today. Cards before arrival: the server's card is a stay's (gap) |
| PMS-CKI-001..003, AC-06 | Done | `CheckIn.tsx`: readiness, ID and guarantee ticks, the override only with `can_override` and a reason, partial check-in, one idempotent press |
| PMS-CKI-004 | Done | `RegistrationCard.tsx`: printed, or signed on screen / on a pad and kept as the guest's `registration_card` document, named on the stay |
| PMS-CKI-005, PMS-CKO-005 | Done | The server's early check-in and late check-out offers, charged when ticked |
| PMS-WLK-001/002 | Done | `WalkIn.tsx`: one screen, the server's availability, room, payment, one idempotent press |
| PMS-ASG-001..004 | Done | `Assign.tsx`: the server's candidates best first with their misses; another type complimentary or paid; bulk and per-reservation auto-assign |
| PMS-MOV-001/002 | Done | `Stay.tsx` MoveDialog: reason, upgrade type, override for a room not ready; old room to housekeeping (server) |
| PMS-KEY-002 | Partial | Issue, revoke, status through the server's door-lock provider; a desk encoder only through the seam (no card payload from the server) |
| PMS-CKO-001..003, AC-08 | Done | `CheckOut.tsx`: folios with the mini bar waiting, deposit, late / early, company balance to AR, the `balance` refusal naming the folios, invoices and receipts after |
| PMS-RSV-010..014, AC-01, AC-03 | Done | `NewReservation.tsx`, `Reservation.tsx`: availability with reasons, one idempotent booking, restrictions booked through with a reason by those who may, status moves from the server's edges, cancellation with the plan's fee |
| PMS-DUP-001/002, AC-05 | Done | `GuestPick.tsx`: "Possible existing guest found" with what matched; the existing guest taken, or a new one on purpose |
| PMS-GST-004/005 | Done | Identification listed only for `pms.guest.sensitive_data`; flagged preferences on the rack panel, arrivals and check-in |
| PMS-FOL-001..004 | Done | `Folio.tsx`, `Stay.tsx`: lines, taxes, split folio, routing by charge type, move a line, void and adjust with reasons |
| PMS-FOL-005 | Server | Locked lines shown as locked, never voided |
| PMS-CHG-001 | Done | Post a charge to the stay (routed) or to a folio, idempotent |
| PMS-PAY-001..003 | Done | Methods, pending for providers, foreign currency (converted by the server), card by token / last four only |
| PMS-DEP-001/002 | Done | `Reservation.tsx` deposit panel: take, waive, refund; applied at check-out |
| PMS-INV-001..003 | Done | Settle, invoice now, to the company's account; receipt / invoice / statement printed from `GET folios/{id}/document` |
| PMS-CSH-001/002 | Done | `Cashier.tsx`, `Shift.tsx`: open with terminal and cash, close by counting, variance approval by someone else, report |
| PMS-NA-001..005, AC-10, AC-11 | Done | `NightAudit.tsx`: checks with counts, blockers linked and overridden with a reason, run / resume, steps, report |
| PMS-HK-002 (desk) | Done | `Housekeeping.tsx`: statuses and the day's tasks, read only |
| PMS-REQ-001/002 (desk) | Partial | `Requests.tsx`: take a request, move the open ones; assigning to a person is the supervisors' (no staff list for requests) |
| PMS-DSH-002..004 (desk) | Done | `Dashboard.tsx`: the server's widgets, each opening its list |
| PMS-ARC-030 | Partial | `pms.*` realtime nudges refresh the rack and lists (`core/query.ts`); a 30-second re-read otherwise. Needs a server with the gateway on to prove the 2 s |

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
