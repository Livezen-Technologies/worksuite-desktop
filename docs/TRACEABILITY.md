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
| Office tile | Done | `/office` (`OfficeHome.tsx`): New Document / Spreadsheet / Presentation, From a template, copies open in other apps, recent Office files |
| Legacy server | Done | Without the Office API an Office file opens in the server's EuroOffice editor inside the app (`GET /api/office/config/{id}` → `ClassicEditor.tsx`, the same isolated editor view), never the browser |
| Built-in editor | Done | BetterOffice (Apache-2.0) for .docx / .xlsx / .pptx in the renderer (`BuiltinEditor.tsx`, `better/`): read from `/api/files/{id}/download`, saved with `POST /api/files/{id}/versions`; used when there is no Document Server, or chosen |
| DOC / Sheet / Slides | Done | Tabs named by type (`officeKind`); Mail, Tenders and Chat .docx/.xlsx/.pptx open in a tab (`openInOffice`); files from this computer (`office-local.ts`) open and save in place |
| Separate window | Done | Both editors' **New window** (`detachTab`, the tab menu's Move to new window) |
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

## Website Live Chat (WS-WCHAT-SRS-001 v1.6, desktop parts)

Statuses here are the desktop's. SRS 1.6 (3 Oct 2026) holds the checked status of every requirement across server, widget, web and desktop; a row done here can still be Partial there because the web lacks it.

| ID | Status | Where / note |
|---|---|---|
| RING-40…48 (R3) | Done; 42–44, 47 Partial | `electron/services/webchat-ring.ts` (WebchatRinger: the list from `assignments/pending` every 15 s and `chat.incoming`/`assigned`/`at_risk`/`taken`/`widget.message`), `WindowManager.showRinger` (frameless, above full-screen apps, non-activating, bottom right), `src/modules/chat/website/Ringing.tsx` (call window, the bar under the tabs, tones), tray ringing state and menu, Dock bounce / taskbar flash, Ctrl/Cmd+Shift+J while ringing, Settings › Notifications › Website chats. Rings until someone joins (`ring_seconds` 0). Partial: the tone plays in the call window, not a hidden audio renderer (42); the tray reuses the unread icon and the count shows only in the macOS title (43); no dock or overlay badge (44); Do not disturb is WorkSuite's own schedule, not OS Focus (47) |
| RING-49, RING-10 | Done; RING-49 Partial | `WebchatRinger.beat()` every 20 s (`POST /api/chat/ring/heartbeat`, kind `desktop`, the registered device's id); `ring_here` from it, from `assignments/pending?device_id=` and `chat.ring.device`; no tone while another device has the ring (`elsewhere`). IPC `ring:state`, `ring:join`, `ring:silence`, `ring:pass`, event `ring:changed`. Settings › Website chats shows the result and sets Where to ring (`/api/chat/ring/prefs`). An older server: the computer decides alone. Partial: a browser takes the ring at its next beat after the 45 s timeout, so up to about 65 s |
| RING-11, RING-03, RING-05, RING-12 | Done | Silence through `POST`/`DELETE …/silence`, held for the person on all devices, refused at risk; `chat.ring.stopped` reasons said in the window; `ringing[]` read from the server (silence, `handover_at`); the handover countdown and Pass to next (`ring:pass`) in the call window |
| RDC-14 | Done | Native file dialog (`files:pickFiles`), OS drops and pasted files through the preload file channel (`registerDropped`) |
| RDC-01…04, 06…08 | Done on the desktop; Partial | The website thread on Team Chat's `Composer` with the website profile (`website` prop; `src/modules/chat/website/profile.ts`): saved replies with "/" and chips, the visitor allowlist and size limit before upload, replies through the offline outbox (pending/failed in the thread), drafts, paste, camera, OS drops, native picker (transfer target `website`). A reply from a saved reply sends `canned_id`, counted by the server (RDC-03); files are held to the website's own `max_upload_kb` from the thread (RDC-04). Missing: reply target and staged files kept with the draft (RDC-06); files through the outbox (RDC-07). The web's website thread was not moved to these components |
| RDC-15 | Done | `electron/services/notifications.ts`: a visitor's message banner has `hasReply` on macOS and Windows (not locked, content shown); the reply goes through `OfflineQueue.submit` with `shared/website-reply.ts`, the composer's own request; a refusal is saved as the conversation's draft and opens it. Linux has no inline reply: the banner opens the conversation |
| RDC-16 | Done | `src/modules/chat/window.ts` `openWebsiteChatWindow` (`chat-mini`, `/chat?website=<id>`), `ChatPage` shows `WebsiteThread mini` there: the thread, the compact composer, Accept and Close |
| RDC-05 | Done | `Composer.tsx` `sendDriveCopies`: From Drive (website profile) picks with `DriveFilePicker` and POSTs each file to `widget-admin/conversations/{id}/attach-drive`, which copies it into the conversation under the visitor allowlist and size limit; refusals are toasted with the server's reason |
| RDC-10 | Done | `WebsiteThread.tsx`: Reply on a message sets the composer's reply target; `shared/website-reply.ts` adds `reply_to`; the server's `reply` excerpt is drawn above the answer (`quoteAuthor`), and the widget draws the same quote |
| TEAM-01…09 (ENH-WCHAT-03 participants) | Done | `website/Team.tsx` `TeamFaces`, `InThisChat` (roles, join times, invited by, pending with Cancel, Leave, Remove, Monitor / Join / Take over), owner leaving offered Transfer or Close; `WebsiteWorkspace.tsx` Mine via `isMine` (owner or participant), the Participant tag and row faces, the Invited section (`InvitedRow`) |
| TEAM-20…25, TEAM-40…45 (invite, transfer) | Done | `Team.tsx` `InviteDialog` (colleagues by availability, open chats, department, not on this site's staff; a department; a note) and `TransferDialog` (colleague, department, next available; warm or hand over now; handover note); `useDeclined` says a declined or unanswered one with Try someone else; `electron/services/webchat-ring.ts` rings `chat.widget.handoff` cards from the pending read and frames, `answer()` (`ring:handoff`) accepts or declines; `Ringing.tsx` `HandoffCard` / `HandoffRows` and the bar |
| TEAM-05, TEAM-60…63 (authors, notes, supervision) | Done | `WebsiteThread.tsx`: each person signs a run, notes and staff-only lines drawn amber with "Only staff see this", Reply to visitor / Internal note tabs; `Team.tsx` `NoteBox` with @mentions; a removed person's draft is dropped (TEAM-07). Typing by name: see the LIVE row |
| LIVE-02…08, LIVE-12 (ENH-WCHAT-04; RDC-09 superseded) | Done | `website/live.ts` `useLiveStatus`: receipts `{delivered, read}` to `conversations/{id}/receipts` (read only while the tab and window are in front), visitor and colleague typing from `chat.widget.typing` frames (start / stop, seven seconds at most), a read or delivered frame refetches the thread; `WebsiteThread.tsx` ticks (`visitorHas`), the latest team message's Delivered / Read time, "Read by" under the visitor's latest (`readBy`), `typingWords`; `Composer.tsx` typing `{state}` start and stop; `Team.tsx` `NoteBox` typing `internal`; `WebsiteWorkspace.tsx` `useVisitorsTyping` row "Typing…". LIVE-01 (the visitor's live channel) is the widget's and the gateway's |
| RDC-11 | Gap | Messages are drawn by `WebsiteThread.tsx` `Message`, not shared components |
| RDC-13, RDC-17 | Partial | Files open in Team Chat's viewer through `files/{token}` (the server's headers kept), but the card is local with no inline image; the local composer is gone, the local bubbles remain, and there is no parity test |
| CHAT-UI-00, CHAT-UI-01 (v1.5 designs) | Done | `src/modules/chat/website/WebsiteWorkspace.tsx`: Open · Mine · Closed with counts, rows with the on-site dot, waiting timer, chips and site, ringing and silenced-here rows (RING-UI-04, from `ring:state`), "Pick a conversation" with the waiting summary, Open the longest waiting and Visitors online, J / K; `WebsiteThread.tsx`: the details panel's visitor header, Visitor, Journey and Shared files. Rows show the last message (`lastSaid`) and the unread count from the server's list; search of 2+ characters goes to the server (`useWebsiteSearch`, `q`), over what was said and closed chats too. The Invited view and Invite / Transfer: see the TEAM rows |
| VOICE-10, VOICE-12, VOICE-UI-03 (ENH-WCHAT-05 ringing and answering) | Done; VOICE-UI-03 Partial | `electron/services/webchat-ring.ts` rings `chat.widget.call` cards from `assignments/pending` `calls[]` and frames (`fromCall`, `CALL_WORDS`), `answerCall()` (`ring:call`) answers or declines and opens the chat with `call=`; the strong tone through Do not disturb unless cards only; `Ringing.tsx` `CallCard` and the bar; tray "Answer —" (`webchatCalls`) and Ctrl/Cmd+Shift+A (`electron/main/index.ts`). The card has no "headset and microphone ready" line |
| VOICE-13 (in the call); VOICE-14, WF-V3 | Done; VOICE-14 and WF-V3 Partial | `website/call.ts` `WebsiteCallSession`: `calls/{id}/join` token, LiveKit room with the microphone only, the speaker chosen for calls, quality and speaking, Mute, Hold (`calls/{id}/hold`, microphone off), End (`calls/{id}/end` with notes, for everyone or leave); `CallBar.tsx`: ringing for me (Answer, Decline) or the team, the in-call bar with Invite / Transfer, Join call (`canJoinCall`), Rejoin audio, the End dialog, Ctrl/Cmd+Shift+M; joins once on `call=`; `ring:onCall` for the tray, `updates:setActiveCall`. Partial: no OS media mute key (Ctrl/Cmd+Shift+M in the window instead); a colleague brought in accepts the chat invitation, then presses Join call |
| VOICE-15, VOICE-16, VOICE-UI-02 | Done | `WebsiteThread.tsx` Offer call (`conversations/{id}/offer-call`); `WebsiteWorkspace.tsx` `CallLine` ("On a call · 2:14", "Calling") and Missed chats' call backs (`useCallbacks`, `CallbackRow`, `callbacks/{id}/done` with the outcome) |
| VOICE-11 | Done | `website/mic.ts` `watchMicrophone()` (mounted by the Shell) tells the main process through `ring:mic` whether the computer has a microphone, now and on `devicechange`; `WebchatRinger.beat()` sends `has_mic` |
| VOICE-01…09, VOICE-17…21, VOICE-23 | Server and widget | The widget's call button and panel, ringing rules, rate limits, reports and the permission are WorkSuite's (Communication 1.11.0) |
| VOICE-22 (recording) | Gap | Not built on the server: calls are never recorded |

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
The back office (rates, rooms, packages, taxes, settings, the set-up wizard) is the web's.
Tests: `tests/unit/renderer/pms-desk.test.tsx`, `tests/unit/renderer/pms-money.test.tsx`, `tests/unit/renderer/pms-ops.test.tsx`,
`tests/unit/shared/pms.test.ts`, `tests/unit/electron/pms-download.test.ts`.

| ID | Status | Where / note |
|---|---|---|
| PMS-DSK-001 | Partial | `PmsShell.tsx`: the front desk, cashier and night audit with the web's P1 set for those roles — rack, arrivals / departures / in house, reservations with availability, check-in, walk-in, assignment, moves, check-out, folios, postings, payments, deposits (take, waive, refund, apply), cashier, night audit, housekeeping (tasks, rooms, restocks), maintenance, lost and found, guests (documents, merge), guest requests, the tape chart, invoices and the billing outbox, KPIs and reports, dashboard. Rates, rooms, packages, taxes, settings and the wizard stay on the web ("Back office on the web") |
| PMS-DSK-002 | Partial | `devices.ts`: typed providers for the ID scanner, key encoder, card/receipt printer, signature pad, cash drawer and card terminal; the printer is `print:print` (OS dialog); the key encoder is the property's on-site lock server — Salto (SHIP), Vingcard (Visionline, Vostio), dormakaba (Ambiance, Saflok) — in the main process (`electron/services/pms-locks`, `pmsLocks:*`), set up in Desk devices → Door-lock server (`LockServer.tsx`). Vendor protocol details to be confirmed with each vendor during certification. No other vendor driver |
| PMS-DSK-003 | Done | READ_CACHE for the property list, options, rack, arrivals, departures, in house (`shared/pms-cache.ts`, per property); the offline banner; every write disabled offline and never queued; balances hidden on the rack offline. The operations, the tape chart, invoices and reports are not cached: offline they say they wait for WorkSuite |
| PMS-DSK-004 | Done | The rack, a reservation, a stay and a folio open in windows of their own (`openInWindow`, record windows) |
| PMS-DSK-005 | Later | Cold-start and open-time targets need measuring on real hardware against a real server |
| PMS-WEB-003 (desktop) | Done | Alt+N new reservation (and the shell's Ctrl/⌘+N), Alt+W walk-in, Alt+F search, Alt+I check in, Alt+P post charge, Alt+R/A/D/H rack and lists — `shortcuts.ts`, the rail's "Keyboard shortcuts"; on a Mac, Option+letter inside a text field is left to the field |
| PMS-WEB-004 (desktop) | Done | The rail's search (`GET search?q=`): guest name, email, phone, confirmation, channel reference, room, across the properties reached |
| PMS-FD-001..004 | Done | `Rack.tsx`: rooms by building and floor with the server's badge (colour, icon, words), counts, FD-003 filters, FD-004 actions as the server lists them |
| PMS-FD-005 | Partial | `Lists.tsx`: the three lists one click from the rack; bulk room assignment; bulk registration cards for guests checked in today. Cards before arrival: the server's card is a stay's (gap) |
| PMS-CKI-001..003, AC-06 | Done | `CheckIn.tsx`: readiness, ID and guarantee ticks, the override only with `can_override` and a reason, partial check-in, one idempotent press |
| PMS-CKI-004 | Done | `RegistrationCard.tsx`: printed, or signed on screen / on a pad and kept as the guest's `registration_card` document, named on the stay |
| PMS-CKI-005, PMS-CKO-005 | Done | The server's early check-in and late check-out offers, charged when ticked |
| PMS-WLK-001/002 | Done | `WalkIn.tsx`: one screen, the server's availability, room, payment, one idempotent press |
| PMS-ASG-001..004 | Done | `Assign.tsx`: the server's candidates best first with their misses; another type complimentary or paid; bulk and per-reservation auto-assign |
| PMS-MOV-001/002 | Done | `Stay.tsx` MoveDialog: reason, upgrade type, override for a room not ready; old room to housekeeping (server) |
| PMS-KEY-002 | Done | `Keys.tsx`, `locks.ts`: new key, duplicate, cancel, status, cards and common areas, a TTLock app key, the passcode shown once, the key log; an on-premise vendor's payload run on the desk's lock server and reported (`POST keys/{id}/result`) at check-in, on a room move (old and new room) and from the stay; a card read in Desk devices. Tests: `tests/unit/electron/pms-locks.test.ts` (fake SHIP, Saflok, Visionline and Ambiance servers), `tests/unit/renderer/pms-locks.test.tsx` |
| PMS-CKO-001..003, AC-08 | Done | `CheckOut.tsx`: folios with the mini bar waiting, deposit, late / early, company balance to AR, the `balance` refusal naming the folios, invoices and receipts after |
| PMS-RSV-010..014, AC-01, AC-03 | Done | `NewReservation.tsx`, `Reservation.tsx`: availability with reasons, one idempotent booking, restrictions booked through with a reason by those who may, status moves from the server's edges, cancellation with the plan's fee |
| PMS-DUP-001/002, AC-05 | Done | `GuestPick.tsx`: "Possible existing guest found" with what matched; the existing guest taken, or a new one on purpose |
| PMS-GST-004/005 | Done | Identification listed only for `pms.guest.sensitive_data`; flagged preferences on the rack panel, arrivals and check-in |
| PMS-FOL-001..004 | Done | `Folio.tsx`, `Stay.tsx`: lines, taxes, split folio, routing by charge type, move a line, void and adjust with reasons |
| PMS-FOL-005 | Server | Locked lines shown as locked, never voided |
| PMS-CHG-001 | Done | Post a charge to the stay (routed) or to a folio, idempotent |
| PMS-PAY-001..003 | Done | Methods, pending for providers, foreign currency (converted by the server), card by token / last four only |
| PMS-DEP-001/002 | Done | `Reservation.tsx` deposit panel: take, waive, refund; applied at check-out, or to one of the reservation's open folios at any time ("Apply to folio", `POST reservations/{id}/deposit/apply`, for `pms.payment.process` with `pms.folio.view`, only while the deposit holds money) |
| PMS-INV-001..003 | Done | Settle, invoice now, to the company's account; receipt / invoice / statement printed from `GET folios/{id}/document` |
| PMS-CSH-001/002 | Done | `Cashier.tsx`, `Shift.tsx`: open with terminal and cash, close by counting, variance approval by someone else, report |
| PMS-NA-001..005, AC-10, AC-11 | Done | `NightAudit.tsx`: checks with counts, blockers linked and overridden with a reason, run / resume, steps, report |
| PMS-HK-002, PMS-HK-003 (desk) | Done | `Housekeeping.tsx`: statuses and the day's tasks; `Room.tsx`: the room's housekeeping status moved along the server's `housekeeping_options` (a reason where the edge needs one; an edge's permission or `pms.room.manage`) |
| PMS-HK-005, PMS-HK-006, PMS-HK-010, PMS-HK-011 (desk) | Done | `Housekeeping.tsx`, `HkTask.tsx`: each task's primary move on its card; the task screen with every move the server offers (each asking what it `needs`), the checklist ticked, a note, photos (`POST housekeeping-tasks/{id}/photos`: a supervisor, or the attendant on their own task or one nobody has, while it is open; 10 MB, 12 a task), the task given to someone from `housekeeping/staff` (`pms.housekeeping.manage`), a new task and "Make today's tasks" (`generate`) for supervisors. The board's drag and drop stays on the web and the phone |
| PMS-HK-012, PMS-STK-002 | Done | `Restock.tsx`: what went into a room on a task (`housekeeping-tasks/{id}/restocks`) or the room alone (`rooms/{id}/restocks`), Inventory products found with Inventory's own lookup (needs Inventory), kind and "charge" per line, one idempotent press |
| PMS-MNT-001..003, PMS-MOB-004 (desk) | Done | `Maintenance.tsx`, `Issue.tsx`: open / mine (`maintenance/my`) / all by category; a fault reported (from the list, a room, or the rack) with a technician and the room out of order at once; the lifecycle the server offers — take it, assign (people picker), start, hold, resume, resolve, reopen, close, cancel — out of order / back in service, parts (Inventory product or a name), photos; the room's issues on `Room.tsx` |
| PMS-LNF-001 | Done | `LostFound.tsx`: items logged (a room or a place), searched, open / due for disposal; stored, claimed, returned, disposed by a supervisor with what each needs; a photo |
| PMS-REQ-001/002 (desk) | Done | `Requests.tsx`: take a request, move the open ones, assign or reassign to a person from the company directory (the server takes only someone with `pms.guest_request.manage` at the property) |
| PMS-DOC-001, PMS-DUP-003 | Done | `Guest.tsx`: a document added, saved on this computer through `pms:download` (the main process checks `desktop.downloads`, fetches and audits it) or removed (`pms.guest.edit`); a duplicate merged into the guest with a reason (`pms.guest.merge`) |
| PMS-CAL-001..004 | Done | `Calendar.tsx`: the tape chart natively — rooms by nights (7, 14, 30), bars in the server's colour with the status in words, outages shaded, bookings without a room listed; a booking moved to another room or dates after the server's price impact (`calendar/preview`, then `calendar/move` with the reservation's `version`), for `pms.reservation.edit` / `pms.room.move`. No drag and drop: a bar is chosen, then moved |
| PMS-INV-001 (desk) | Done | `Invoices.tsx`: settled / to account / closed folios with their invoice or receipt, "Invoice now"; the hand-offs to Billing and Finance (`outbox`) with a retry, for `pms.settings.manage` |
| PMS-RPT-001, §13.7 KPIs | Done | `Reports.tsx`, `Report.tsx`: the server's KPIs (a period for `pms.reports.view`, today for the dashboard alone), the report catalogue, a report with its filters, and the server's CSV (and XLSX / PDF where it lists them) saved through `pms:download` for `pms.reports.export`; `desktop.downloads` is checked in the main process (`electron/services/pms-download.ts`), not only on the screen |
| PMS-DSH-002..004 (desk) | Done | `Dashboard.tsx`: the server's widgets, each opening its list |
| PMS-ARC-030 | Partial | `pms.*` realtime nudges refresh the rack and lists (`core/query.ts`); a 30-second re-read otherwise. Needs a server with the gateway on to prove the 2 s |

## PDF Studio (WorkSuite PDF Studio SRS v1.0, stages D1 — foundation and viewer — and D2 — editing)

`src/modules/pdf` (renderer), `electron/services/pdf` and `electron/workers/pdf-worker.ts` (main and engine).
D2 adds annotation, pages, saving, locks, autosave, recovery and offline saves; forms, signing, OCR, redaction and
compare are later phases (no server API yet). D2 tests: `tests/unit/electron/pdf-edit.test.ts` (the real PDFium),
`pdf-editing.test.ts` (the service with the real engine and a fake PDF Studio server),
`tests/unit/renderer/pdf-editing-ui.test.tsx`. Tests:
`tests/unit/electron/pdf-engine.test.ts` (the real PDFium), `pdf-worker.test.ts` (the worker protocol, crashes,
hangs, memory), `pdf-service.test.ts` (DesktopPDFService with a fake engine), `tests/unit/renderer/pdf-studio.test.tsx`;
on a real system `tests/os/pdf/check.mjs` (workflow "PDF engine").

| ID | Status | Where / note |
|---|---|---|
| PDF-ARCH-001, 002 | Done | `PDFEngineInterface` (`engine.ts`); `PdfiumProvider` (PDFium, WebAssembly, `@embedpdf/pdfium` 2.15.1); no MuPDF provider (AGPL/commercial, §2.5) |
| PDF-ARCH-003 | Done | Nothing above the interface knows the engine; the contract carries no engine types |
| PDF-ARCH-004 | Later | OCR is Ph5 |
| PDF-ARCH-005 | Done | `capabilities()` asked at run time (sent with the worker's `ready`); layers and text editing are false for PDFium and hidden |
| PDF-ARCH-010, 011 | Done | `window.worksuite.pdf` only (preload); no fs / child_process / shell in the renderer |
| PDF-ARCH-012, 013 | Done | A worker per document; cancelable (renders by ticket, searches and scans between pages), memory-capped (1 GB), ended on a hang (no pong 20 s, deadline 30 s) and restartable (Retry) |
| PDF-ARCH-014, 015 | Done | `local-files.ts` (handles; resolved, regular, `%PDF-`, size, not in the app's data); working copies in `<profile>/PDF/work` |
| PDF-UI-001, 002 | Partial | Left: Pages, Bookmarks (outline), Search, Files (attachments). Right: Properties, Versions, Activity. Comments, Forms, Signatures, Layers panels come with their features (layers: PDFium has no API); panels collapse (View), not yet dockable |
| PDF-UI-003 | Partial | File, source, version and "Read only" (with why); Saved / Saving / Unsaved / Saved locally come with editing (D2) |
| PDF-UI-004 | Done | A PDF per WorkSuite tab (`open.ts`), the open one brought to the front; the ● prefix comes with editing |
| PDF-UI-005 | Later | D2 (nothing unsaved in a viewer) |
| PDF-UI-006 | Done | Ribbon commands off with their reason as the tooltip (policy, the PDF's own flags, view-only shares); later stages' tabs not shown |
| PDF-UI-007, 008 | Done | Full screen of the PDF workspace; Present: one page on black, keys |
| §4.3 shortcuts | Done | Ctrl/⌘ O, S (says read-only), P, F, Shift F, + / −, H, V through the shortcut registry (`core/commands.ts`, Settings); Z / Y with D2. The app menu's own zoom roles may take Ctrl/⌘ + / − on macOS first — to try there |
| PDF-OPEN-001 | Partial | Drive (Files), local (dialog, drop, OS argv / `open-file`), Mail attachments. Chat attachments, Google Drive / OneDrive (no connectors in the desktop) and module documents not yet |
| PDF-OPEN-002, 003 | Partial | Local files read in place, never uploaded; Edit / Save / Save As / Upload are D2 |
| PDF-OPEN-004 | Partial | Mail: preview only; Save to Drive and Edit Copy are D2 |
| PDF-OPEN-008 | Done | Prompt with "Remember for this session" (memory only); permanent remembering not offered |
| PDF-OPEN-009 | Done | Max PDF Size (policy seam, default 2 GB): refused with the limit, before fetching |
| PDF-OPEN-010 | Partial | `GET /api/pdf/{id}/status` (the server's PdfAccess "open") before any content; `files.pdf.open` is the server's (stage S) |
| PDF-VIEW-001, 002 | Done | Single, continuous, two page, two page continuous, presentation, full screen, read mode; 25 %–6400 %, fit page / width, actual size |
| PDF-VIEW-003 | Partial | Thumbnails, bookmarks / outline, search results, attachments; comments, layers, signatures panels later |
| PDF-VIEW-004 | Done | Status bar: page n / N (editable), zoom, fit, Find |
| PDF-VIEW-010…015 | Done | `layout.ts` + `Canvas.tsx`: only visible pages (±1 screen), preview then sharp, 1024-px tiles above 4 Mpx, tickets cancelled when a page leaves; thumbnails by the worker, cached in memory and sealed on disk; custom file access (no whole-file load). 2,000 pages: opened and first page drawn in ~0.2 s on the Linux check |
| PDF-SRCH-001…004 | Done | Match case, whole word, regex; pages, comments, bookmarks; results with page and snippet, highlighted; streamed as pages are searched, in the worker |
| AC-03, AC-04, AC-05 | Done | As above |
| PDF-SEC-030…035 | Done | See SECURITY.md → PDF Studio |
| PDF-SEC-013, 014 | Done | Passwords in memory only; never in logs, audit, reports or IPC traces (tested) |
| PDF-PRN-001 | Done | Range / current / pages, fit or actual size, copies, orientation, duplex and printer in the OS dialog |
| PDF-PRN-002 | Partial | The PDF's print flag and the organisation's policy (seam); `files.print` / `files.pdf.print` are the server's (stage S) |
| PDF-PRN-003, 004 | Done | With or without comments and fields; `pdf.printed` audited with id, version, page count |
| PDF-API-001…003 | Done | Opaque handles; per-session sender check; strict schemas |
| PDF-API-004 | Later | No destructive calls in D1 |
| PDF-AUD-001, 004 | Partial | `pdf.opened`, `pdf.printed` (local audit outbox, sent to `/desktop/v1/audit`); editing events with D2 |
| PDF-NFR-001, 002 | Partial | Measured on the Linux check (2,000 pages: 224 ms to the first page); needs the reference machine |
| PDF-NFR-010 | Done | A crashed or hung worker fails its tab with Retry, nothing else |
| PDF-NFR-020 | Done | Sealed working copies and thumbnails |
| PDF-NFR-030, 031 | Done | Failures logged (redacted) with format, size, pages, engine error, app version; the diagnostic report carries the log |
| PDF-NFR-032 | Done | PDF Diagnostics (`pdf:diagnostics` + the window's own drawing check) |
| PDF-EDIT (modes) | Done | View / Annotate / Edit from the server's `available_modes` and permission flags (`gates()`); local files all three |
| PDF-ANN (annotate) | Done | Highlight, underline, strike out, squiggle (text under the drag), note, text box, ink, rectangle, ellipse, line, stamp; colour, width, opacity; select, move, delete; author and time; Comments panel |
| PDF-PAGE (organize) | Done | Rotate, delete, reorder (drag), insert blank, insert from another PDF, extract to a new PDF |
| PDF-SAVE | Done | New version / copy on Drive (chunked upload with SHA-256, `base_version`); local in place (atomic); Saved · vN / Unsaved / Saving / Saved on this computer |
| PDF-LOCK | Done | Edit takes the server's lock; heartbeat; lock lost / downgraded banners; Take over where offered |
| PDF-CONF | Done | `PDF_VERSION_CONFLICT` → Keep both / Save as new version / Use theirs |
| PDF-UNDO | Done | Journal replay onto the base; Ctrl/⌘ Z, Ctrl/⌘ Shift Z, Ctrl/⌘ Y |
| PDF-REC | Done | Sealed snapshots on the autosave interval and at close; offered back on open |
| PDF-OFF (save offline) | Done | A save offline is kept and sent when WorkSuite is back (`online()`) |
| PDF-UI-005 | Done | Closing a tab with unsaved changes keeps them for recovery and says so |
| PDF-OPEN-001 (modules) | Done | Chat and task attachments, HR documents and leave evidence, billing and purchasing PDFs, mail: downloaded, then PDF Studio (`openInApp`) |
| PDF-FORM, SIGN, OCR, REDACT, COMPARE | Later | Later phases; no server API |

## WorkSuite Events — the Event Desk (Events SRS §15.2 [D], §9, §8.4)

`src/modules/events` (renderer), `electron/services/event-desk.ts` and `event-desk-print.ts` (main),
`shared/event-desk.ts` (the rules both share), over the server's `/api/events/v1` (`app/Modules/EventManager`,
stages A, B1, B2). Counts, capacity, money and every verdict online are the server's; offline, the verdict is the
server's own `ScanRules` on the device's copy. Planning (events, tickets, forms, the schedule, screens, badge
templates, gates and devices) is the web's. Tests: `tests/unit/shared/event-desk.test.ts`,
`tests/unit/electron/event-desk.test.ts`, `tests/unit/electron/event-desk-print.test.ts`,
`tests/unit/renderer/event-desk.test.tsx`.

| ID | Status | Where / note |
|---|---|---|
| EV-POR-010 | Done | `EventsShell.tsx`: check-in desk, walk-in registration, badge printing, scanner input, fast search, offline check-in, local printing, the operations view (Event 360, live counters) |
| EV-POR-011 | Done | `DeskScreen.tsx`: the event's name, a large scan area, Inside and Checked in, Search / Walk-in / Print badge, online or offline with what waits; full screen on the desk alone |
| EV-POR-012 | Done | Scanner input has the focus (a stray key goes to it); F2 / Alt+S search, F3 / Alt+W walk-in, F4 / Alt+P print, F6 / Alt+O in or out, Enter on an empty field presses the result's button, Esc clears |
| EV-POR-013 | Later | "May require a PIN" to leave the desk: the server keeps no desk PIN (BACKEND.md) |
| EV-CHK-001..003 | Done | Scan (USB/HID scanner as a keyboard, typed registration number, the camera where the system reads QR codes — `camera.tsx`, `BarcodeDetector`, macOS), the server's verdict with a Check In button or the gate's automatic check-in |
| EV-CHK-010 | Done | `ResultPanel`: the result's colour, icon and words, a tone (switchable); refused scans are logged by the server, and offline kept as attempts |
| EV-CHK-020..023 | Done | Check-out by mode or button, re-entry and daily check-in by the server's rules (online) and the copy's ticket rules (offline) |
| EV-CHK-031 | Done | `Setup.tsx`, `event-desk.ts`: registered as a `desktop` device by its sync device id at a gate; the key in the OS credential store |
| EV-CHK-032 | Done | Heartbeat every minute with the queue size; the event's devices listed (read) |
| EV-CHK-033 | Done | `device_revoked` / `wipe` on any call or the heartbeat removes the key, copy and queue at once, and says so |
| EV-CHK-040..042 | Done | `WalkIn.tsx`: name, phone or email, ticket, the published form's fields and consents for that ticket, payment or its waiver, one idempotent press — registered, checked in, badge printed |
| EV-CHK-043 | Partial | Payment by Billing's methods with a reference (`payment/take`); no POS or payment link at the desk |
| EV-CHK-050 | Done | `SearchPanel.tsx`: the server's search online; offline the copy's (name, number, company, ticket — no email or phone in the copy), 20,000 rows under 150 ms (tested) |
| EV-CHK-060 | Done | `Program.tsx` session doors: `checkin/sessions/{id}`, online only |
| EV-CHK-070 | Partial | The photo shows where its Files download answers the desk (BACKEND.md) |
| EV-OFF-001..003 | Done | The gate's copy (`checkin/bootstrap`), encrypted, per server, event and person, bound to the device key, gone when it expires, when offline check-in is switched off, or on revocation; only on a computer the policy lets keep data and queue changes |
| EV-OFF-004 | Done | `checkin/changes` every 15 seconds while online; the server's answer to an upload carries them too |
| EV-OFF-005 | Done | The queue with the device's own sequence and `client_uuid`, uploaded on reconnect (`checkin/sync`), idempotent; each item keeps what the server made of it |
| EV-OFF-006 | Partial | Offline walk-ins with a provisional number; the standard fields only (the copy has no form) |
| EV-OFF-007 | Done | The desk's header and "This desk" panel: online or offline, last sync, what waits, what someone else's scans wait for |
| EV-OFF-010..013 | Done | Online the server decides; offline the desk warns of its own second entry and says cross-device duplicates show late; `Review.tsx` shows the server's reconciliation queue (resolve with a note, dismiss with a reason) and the desk's flagged items |
| EV-BDG-010..012 | Done | Scan / search → check in → print; the gate's automatic print on check-in printed here; reprints with the permission, confirmation and reason the server asks; each print reported printed or failed |
| EV-BDG-013 | Done | `event-desk-print.ts`: the desk's own printer, silently when set so, the template's size or the printer's label; badges sent to the desk's printer by name taken while the desk is open |
| EV-BDG-014 | Done | `Badges.tsx`: pre-printing by ticket and name/company, in runs of fifty, and the print queue (print here, queue again, cancel) |
| EV-EVT-030 (read) | Done | `Overview.tsx`: the server's counts with what each counts, capacity, ticket money for financial viewers, the live view; `Registrations.tsx`, `Registration.tsx`, `Attendees.tsx`, `Attendee.tsx` read |
| §11.5 override (desk) | Done | The emergency message on every screen, typed confirmation, cleared with a reason — for `events.screen.override` |
| Multi-window | Done | The live counters in a window of their own beside the desk (`/events/<id>/counters`, the rail's "Counters in a window"); the window shows the counters alone |

## POS — the till (desktop POS, ported from the mobile till's FR-POS-01..03)

`src/modules/pos` (renderer), `electron/services/pos-desk.ts`, `pos-till.ts`, `pos-outbox.ts`, `pos-print.ts`,
`pos-display.ts`, `pos-ipc.ts` (main), `shared/pos.ts` and `shared/ipc/pos-channels.ts`, over the server's staff POS API
(`/api/pos`) and the till's own door (`/api/pos/device/*`). Money is WorkSuite's: prices when it answers, the
drawer's figures always; the till numbers, keeps and sends its sales. Tills, registers and settings are the web's.
Tests: `tests/unit/electron/pos-desk.test.ts`, `pos-till.test.ts`, `pos-print.test.ts`,
`tests/unit/renderer/pos.test.ts`, `pos-tender.test.tsx`, `pos-sales.test.tsx`, `pos-register.test.tsx`.

| ID | Status | Where / note |
|---|---|---|
| POS-DSK-1 Native module | Done | `shared/apps.ts` (`surface: 'native'`), `registry.ts` manifest, deep links `worksuite://pos`, `worksuite://pos/sales/{ref}` |
| POS-DSK-2 Pairing, heartbeat | Done | `pos-desk.ts`: `terminals/{id}/pair` (take-over asked), `wsp_` credential in the OS keystore, heartbeat every minute with the queue size; 401 drops it, 503 marks POS off (the server's sentence; else "Admin Centre → Apps → POS") |
| POS-DSK-3 Shift | Done | `ShiftScreen.tsx`: open with a float or a count, cash in/out with reasons, close on a count (blind where the company says), X report while open, Z report after; online only |
| POS-DSK-3 Close rules | Done | `ShiftScreen.tsx`, `shift.ts`: `rules.count_to_close` (note by note only), `rules.blind_close`, `rules.variance_tolerance` (no reason asked within it, `needsReason`) |
| POS-DSK-4 Register | Done | `Register.tsx`, `TenderPanel.tsx`: grid, search, categories, keyboard-wedge scanner anywhere, quantities, customer, discount by permission, cash/card/transfer/wallet/split with change; WorkSuite's price (`POST api/pos/price`, the till's company) with the catalogue's preview; codes not in the copy by `api/pos/products/lookup` |
| POS-DSK-4 No drawer, no sale | Done | `Register.tsx`: nothing goes in the cart without a register open at this till (a pick or scan says to open it; the cart offers "Open the register"); `TenderPanel.tsx` reads the registers again after a refusal. Server rule `drawer_closed` on every door (`capabilities.drawer_required`) |
| POS-DSK-4 Discount rights | Done | `discountRights()` from `options` `can.discount`, `can.max_discount_pct` (typed discount capped there), `can.discount_override` (no ceiling); none where the server does not say |
| POS-DSK-5 Offline | Done | Versioned catalogue sealed in SQLite; local receipt numbering per pairing; ordered, idempotent outbox to `device/sales`; sync state in the shell, This till and Sales |
| POS-DSK-5 Catalogue source | Done | POS's own catalogue: through the till's door every 30 min with nobody signed in (`device/catalogue?since_version=`), on the staff API on request (`api/pos/catalogue?org=&since_version=`, `pos.access` only); Inventory's list only on an older server (`capabilities.catalogue` false, or 404) |
| POS-DSK-6 Printing | Done | `pos-print.ts`: ESC/POS raw (or the driver, silently), copies, header/footer, drawer pulse on cash, Printers settings; a reprint is WorkSuite's receipt (`device/sales/{ref}/receipt`, `serverReceiptRows`) where `capabilities.receipt`, the till's own otherwise |
| POS-DSK-7 Sales history | Done | `Sales.tsx`: this shift / today from the till's record, receipt, reprint, e-mail receipt (`device/sales/{ref}/email`), send again / drop a refused sale; WorkSuite's `total`, `review` and `flags` (`price_differs`, `payment_missing`, `late`) from the sale's answer, shown per sale and filtered (all / to review / each flag, `filterSales`) |
| POS-DSK-7 Drawer refusals | Done | `pos-outbox.ts` keeps `code` (`drawer_closed`, `session_not_here`) on a refused sale; `Sales.tsx` says what it means and sends it again only into the register open now (`pos-till.ts` `resolve(ref, 'retry', session_id)`), or drops it; a late sale is taken by the server and flagged `late` |
| POS-DSK-6 Payment missing | Done | `pos-print.ts`: `*** PAYMENT MISSING ***` and a "Payment missing" line for the total on WorkSuite's receipt (`status: payment_missing`) and on a till record flagged so |
| POS-DSK-7 Refund, void | Done | `Sales.tsx` `Reverse`, `pos-till.ts` `giveBack`: refund everything left or some lines (restock or not), void in the sale's own open shift, with the reason, through the till's door with the cashier named and the till's own number (`<receipt>-R<n>`, `-V`, idempotent); gated by `capabilities.refund`/`.void` and `can.refund`/`.void`, online only; WorkSuite's answer kept on the sale (tenders, cash out of the drawer — which opens — credit note) and taken off the shift's figures |
| POS-DSK-8 Customer display | Done | `pos-display.ts`, `CustomerDisplay.tsx`: full screen on a second monitor, fed over a same-origin BroadcastChannel |
| L10N | Partial | `modules/pos/i18n.ts`: English complete, Sinhala and Tamil for the till's everyday words (native review due); receipts print in Latin script |

## Restaurant Manager — desktop POS, KDS and print agent (Restaurant SRS v1.0, stage C desktop)

`src/modules/restaurant` (renderer), `electron/services/restaurant/` (main: `terminal.ts`, `sync.ts`, `outbox.ts`,
`print-agent.ts`), `shared/restaurant.ts`, over the server's `/api/restaurant/v1` (`app/Modules/Restaurant`, stages A,
B1, B2). Prices, totals, splits, change, statuses and the next moves are the server's. The back office (menu, floor
design, staff, settings, reports, the day close, a booking's deposit) is the web's. Tests:
`tests/unit/electron/restaurant-terminal.test.ts`, `restaurant-outbox.test.ts`, `restaurant-print.test.ts`,
`tests/unit/renderer/restaurant.test.tsx`.

| ID | Status | Where / note |
|---|---|---|
| RM-PLT-003 | Done | `Connect.tsx`, `terminal.ts`: pair this computer as a branch terminal; the key in the OS credential store, sent as `X-Terminal-Key`; unpair (optionally revoking) |
| RM-POS-001..006 | Done | `Order.tsx`: the branch menu by category and search, sold-out items disabled, variants, modifier groups (required, min, max, one nested level), open prices, notes, seat and course; `GET pos` opens the till |
| RM-POS combos, RM-MNU-004 | Done | `Order.tsx` ItemPicker: a combo's fixed parts listed, each choice component asked (min–max, upcharges, parts not orderable disabled), sent as the line's `combo[]`; kept on lines queued offline (`shared/restaurant.ts`). A component's own modifiers are not asked (the server refuses a required one in its words) |
| RM-TBL-001..005 | Done | `Floor.tsx`: tables by floor and area in their state, party, order and next booking; seat, open, free, request the bill, move, merge, split (with lines), clean, unblock — every move with the tables' versions |
| RM-KOT-003, §5.3 | Done | Send, fire and hold by course, serve, print the KOT again |
| Voids (§8.6, RM-SEC-010) | Done | A line taken off, or voided after the kitchen with a reason and quantity; above the limit, `Approval` asks for one and takes a manager's PIN at the till or their answer elsewhere, then voids with the `approval_id` |
| RM-BIL-001..003 | Done | `Bill.tsx`: `bills/preview` (the client computes no total), single, by seat, by item, equally, by amount; present, void, print and reprint (a bill no route takes is printed here from its `document.text`) |
| RM-BIL-004 | Done | `Adjust.tsx` InvoiceDialog: `POST bills/{id}/invoice` for a whole-order bill, addressed to the order's customer or one looked up (`GET customers?q=`); an invoiced bill answers its invoice again. For `restaurant.payment.process`, online only |
| RM-PAY-003/004 | Done | Several tenders, cash handed over and the server's change, one `Idempotency-Key` per attempt kept across retries; the drawer opens when the server says so |
| §8.5 cashier | Done | `Cashier.tsx`: open with a float on the terminal's register, cash in and out (out approved above the limit), no-sale with the drawer, the X report, close on a count with the variance (approved above the threshold) |
| RM-DSC-003/004, §8.2, §8.6 discounts, comps, price overrides | Done | `Adjust.tsx`, `Order.tsx`: a discount on the order or a line (percentage or amount), a line complimentary, a line's price overridden — each with a reason, for `discount.apply` / `comp` / `price.override`; above the limit `approval_needed` → `Approval` (manager's PIN here or their answer elsewhere) → the same request with `approval_id`. The order's discounts and comps listed and taken back (`adjustments/{id}/remove`) before anything is paid. Online only |
| RM-RFV-001/002, §8.6 refunds | Done | `Adjust.tsx`, `Bill.tsx`: the order's payments (`GET payments?order_id=`), a received payment refunded in full or part with a reason (`restaurant.refund`), one `Idempotency-Key` per attempt kept until the server answers, the approval flow above the limit, the drawer opened when the server says so. Online only |
| RM-KDS-001..003 | Done | `Kitchen.tsx`: a station's tickets oldest first, coloured by the server's `tone`, ADD / VOID marks, allergy warnings, "did not print"; lines done and undone; accept, start, bump, recall, serve; all-day counts, held lines, recently bumped |
| RM-KDS-005 | Done | `Expo`: every station's ticket per order; served when all are ready |
| RM-ARC-010, RM-ARC-012 | Done | `useLive`: the gateway's `restaurant.live` pushes (`realtime:event`, this branch only) refresh the queries each entity touches at once; `live?after=` from the heartbeat's `last_seq` stays as the catch-up — every 3–10 s without the socket, every 30 s with it |
| RM-ARC-020..023 | Done | `sync.ts`, `outbox.ts`: the menu and floor copy sealed; orders, lines and sends queued in order with the device's ids, played back through `sync` with an idempotency key per batch; conflicts kept and shown, and settled by a manager (`Outbox.tsx`: attach to a table or dismiss) |
| RM-ARC-021 cash offline | Later | Needs an offline bill-and-pay op on the server (BACKEND.md) |
| RM-ARC-030..032, RM-DSK-003 | Done | `print-agent.ts`: claims the jobs of the printers mapped here, prints raw ESC/POS or through the driver, silently, answers printed or failed (the server retries, falls back, leaves tickets to the KDS); `Printers.tsx` maps printers, test prints, the drawer, the agent's log and the branch queue with reprints |
| RM-DSK-007 | Done | Heartbeat every 30 s: queue size, version, online, last sync, the hosted printers' state |
| §5.7 reservations (host stand) | Done | `Reservations.tsx`: the day's bookings with the server's `choices` (confirm, arrived, seat at a free table with guests and the table's version, cancel with a reason, no-show), the tables' timeline (`reservations/timeline`), a booking after `reservations/availability` (free tables, or the server's other times). `reservation.view` to see, `reservation.manage` to move; online only. Deposits and changing a booking stay on the web |

## Devices, security, updates (SEC, UPD)

| ID | Status | Where / note |
|---|---|---|
| FR-SEC-01/02 | Done | Registration and 5-minute heartbeat with directives and acknowledged commands |
| FR-SEC-03 | Done | DPAPI / Keychain / libsecret via safeStorage; no plaintext fallback |
| FR-SEC-04/05 | Done | App lock (timeout, manual, OS lock/sleep); password, PIN (this computer, works offline) or Touch ID. Windows Hello needs a native module (later) |
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
