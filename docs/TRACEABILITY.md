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
| FR-AUTH-02 | Done | WorkSuite login + TOTP/backup code; refresh token in OS secure storage |
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
| FR-NAV-05/06/09 | Partial (P2 items) | Record and mini-chat windows, bounds per display, off-screen recovery, always-on-top for chat/timer |
| FR-NAV-07 | Later | Dockable panels (P2); the AI dock is the first |
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
| FR-TRAY-01..03, 05..07 | Done | Tray menu incl. Clock In/Out, quick actions, pause notifications; minimize to tray; autostart; background services; state icons with priority; dock/taskbar badge |
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

## Communication (COM)

| ID | Status | Where / note |
|---|---|---|
| FR-COM-01 | Partial | Three-pane mail, combined inbox, shared mailboxes, folders, read, reply/forward, archive/delete, print, attachments download; composer is plain text without attachments |
| FR-COM-02/03 | Partial | Rooms, threads, receipts, reactions shown, files, typing, pending offline messages, mini window; sending reactions, voice notes and GIFs is on the web for now |
| FR-COM-04..08 | Later | Meet, screen share, remote control, AI (P2/P4) |

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
