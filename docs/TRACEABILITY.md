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

`src/modules/garage`, against the server's stage-A contract (`/api/garage/*`). Tests:
`tests/unit/renderer/garage.test.ts`, `garage-screens.test.tsx`.

| ID | Status | Where / note |
|---|---|---|
| FR-APP-01, §36 | Done | Native catalogue app `garage` (app `garage`, `garage.access`), manifest in `modules/registry.ts`; hidden from anyone the server does not give it |
| FR-APP-04 | Done | Holders of `garage.settings.manage` land on Set-up while a company is not set up (`GarageShell.landing`) |
| FR-APP-05 | Partial | Stage-B job-card tabs listed dimmed until they arrive (`garage/registry.ts`); Edit in CRM only with CRM |
| FR-DSH-01, 03 | Done | `Overview.tsx`: the server's nine figures, each opening the job list that counted it. Revenue today is the server's to add (B3) |
| FR-DSH-02 | Partial | Jobs by stage, bays, overdue, waiting for the customer, ready for collection. Appointments, technician workload, parts, revenue and reminders wait for stage B / phase 2 |
| FR-DSH-04 | Later | Role dashboards |
| FR-BRD-01..04 | Done | `Board.tsx`: the server's columns; a drop (or Alt+→/←) asks `transition {column}` with the version shown; a refusal leaves the card and shows the sentence; a reason is asked first when the move needs one |
| FR-BRD-05 | Partial | Branch, advisor, priority, search; read again every 30 s and on any garage notification. No workshop / technician / vehicle-type filter; TV mode later |
| FR-CUS-01, 02 | Done | `Customers.tsx`: CRM accounts, added through CRM (`crm.account`); WhatsApp and preferred contact are not kept by CRM |
| FR-VEH-01..06 | Done | `Vehicles.tsx`, `Vehicle360.tsx`: duplicate check, new owner, odometer override with reason, 360° tabs |
| FR-VEH-07 | Done | Set-up → Makes and models |
| FR-WLK-01, 02 | Done | `WalkIn.tsx`: one search, create-if-missing, open-job warning and confirmation, what a refused walk-in added is reused |
| FR-CHK-01..06, 08 | Done | `job/Checkin.tsx`: readings, complaints, conditions, damage diagram (the web's zone codes), photo slots (drop, pick, camera), belongings, valuables, signature, the server's list of what is missing |
| FR-CHK-07 | Later | Printing / sending the check-in sheet: no document on the server yet |
| FR-JOB-01, 03..09 | Done | `JobCard.tsx`: header, pipeline tracker, the server's transitions, edit, cancel with reason, version conflicts, overdue |
| FR-JOB-07 | Partial | Overview, Check-in, Inspection, Diagnosis, Estimate, Work orders (with labour), Media, Notes, Activity; Parts, QC, Invoice & handover arrive with stage B3 |
| FR-INS-01..06 | Done | `job/Inspection.tsx` (stage B1): templates, traffic light / pass-fail / measurement with thresholds, photos per item, next step to the estimate or later, complete with the server's missing list, the customer's report; templates copied from the library in Set-up. Template items are edited on the web |
| FR-DIA-01..05 | Done | `job/Diagnosis.tsx`: finding, cause, repair, parts (Inventory lookup), hours, codes, no fault found, sign-off, to the estimate |
| FR-EST-01..08 | Done | `job/Estimate.tsx`: versions, lines priced by the server, availability, coverage and payer, pull recommendations, carry deferred work, discount approval |
| FR-APR-01..06 | Done | Send (link + message shown once; copy, mail, WhatsApp from this computer), new link / take back, the customer's answer recorded by staff with live approved total and safety acknowledgement, changes requested |
| FR-ADD-01..04 | Done | Found more work from a work order; listed with its answer; withdraw |
| FR-WO-01..03 | Done | `job/WorkOrders.tsx` (stage B2): from approved lines, internal work, the job following its work orders on the server |
| FR-TEC-01..05 | Done | My work (`views/MyWork.tsx`), the caller's timer (server clock), pause reasons, labour from timers, corrections keeping the original |
| FR-TEC-06 | Done | Skill shown per technician; the server warns or refuses by policy |
| FR-BAY-01..04 | Partial | `views/Bays.tsx` (board and manual moves), `views/Calendar.tsx` (day view, let a slot go); booking is from a work order's Technicians and bay — no drag on the calendar yet |
| FR-JOB-10 | Later | Job QR on a printed card |
| FR-MED-01..03 | Done | `job/Media.tsx` (internal until published, `garage.media.publish`), `job/Notes.tsx` (internal / customer) |
| FR-SET-01, §25, §27 | Partial | `Settings.tsx` (the standard settings form, per company), `Setup.tsx` (the wizard and its records); the workflow builder is phase 2 |
| Offline | Partial | READ_CACHE for options, board, overview, jobs (and job cards and their tabs opened), vehicles, customers, estimates' options, inspections, bays, the calendar and my work; every write online only — nothing is queued |

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
