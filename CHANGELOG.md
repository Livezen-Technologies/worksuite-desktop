# Changelog

What changed in WorkSuite Desktop, newest first. Entries are written for the
person who has to live with the change — what it does, and where it bites.

---

## 2026-09-25 — The desktop API arrives on the server

WorkSuite now serves `/desktop/v1` (in the WorkSuite repository,
`app/Modules/Desktop`). A server that has it announces it at
`/.well-known/worksuite-desktop`, and the app uses it from the next sign-in;
older servers carry on through the existing API. See
[docs/BACKEND.md](docs/BACKEND.md).

**Changed**

- **Commands from the fleet view.** Revoke, sign out, turn sync off, require
  an update and refresh policy reach the laptop on its next heartbeat. The app
  carries each one out and reports back (`commands/{id}/ack`), once.
- **Revocation also arrives on the token refresh.** A refused refresh with
  `DEVICE_REVOKED` wipes WorkSuite's data from the laptop, as the heartbeat
  directive does, instead of leaving a sign-in screen for whoever has it.
- **`worksuite://` links are checked by the server.** On a desktop-v1 server
  the app asks `/desktop/v1/links/resolve` whether the person may open the
  record and in which company. A record they cannot open says so, and names
  nothing about it.
- **Apps come from the server's list by slug** (`worksuite.<slug>`), so an
  app the server has switched off is not shown in the sidebar.
- **Discovery reads the per-platform minimum version** (`minimum_versions`),
  as well as a single `minimum_version`.

**Where it bites**

- **Unsigned policies are applied when the build has no policy key.** Before,
  a build with no `MAIN_VITE_POLICY_PUBLIC_KEY` refused every desktop-v1
  policy, because there was nothing to verify it against. Now it applies the
  policy as unsigned, the same trust as the rest of the API. A build with a
  pinned key still refuses anything unsigned or wrongly signed and keeps the
  last policy it accepted.
- **Policies are signed only if the server has a key.** Run
  `php spark desktop:keys` on the server, put the secret in its `.env`, and
  build the app with the printed public key.

**Checked**

- 78 unit tests (one new: discovery of a desktop-v1 server and its
  per-platform minimum), typecheck and lint.
- The end-to-end smoke test against a local WorkSuite with `/desktop/v1`,
  28 of 28, registering through `/desktop/v1/devices/register`.
- A policy signed by the server's PHP signer verifies with the app's own
  verification code, and a changed field fails it.

## 2026-09-25 — WorkSuite Desktop 0.1.0: Phase 1 foundation

**Added**

- **The desktop shell** from the SRS v1.1 designs: navy title bar with the
  organization selector, search, connection pill, transfers, notifications, AI
  and account; the permission-filtered sidebar; tabs with the full tab manager
  (pin, duplicate, reload, close others/right, reopen closed, drag to reorder,
  open in a window); the status bar; light, dark and system themes; compact
  and comfortable density.
- **Sign-in** with WorkSuite's own login and two-step verification, on the
  existing API. The access token never leaves the main process; the rotating
  refresh token lives only in the OS credential store.
- **Device registration and heartbeat.** Each installation registers as a
  WorkSuite device and reports health every five minutes; a block, wipe or
  required version set in the fleet view reaches it within one heartbeat.
- **Phase 1 modules:** Home dashboard, Mail (three panes, combined inbox,
  shared mailboxes), Chat (threads, pending offline messages, mini window,
  file drop and pasted screenshots), Calendar, Tasks, Files (online), CRM
  leads, HR self-service (clock in/out, leave, approvals), Notifications,
  Activity, Settings, Diagnostics. Every other app the user can open is in
  the launcher and opens in the browser, labelled so.
- **Offline:** recently opened data readable offline, encrypted; changes that
  modules allow offline queue in order and replay with idempotency keys;
  conflicts are shown, never overwritten; drafts are saved as you type.
- **Native notifications** with privacy modes, do-not-disturb and pause; the
  tray with unread counts, Clock In, quick actions and state icons.
- **`worksuite://` deep links**, checked against an allow-listed grammar and
  the user's access.
- **Signed updates:** Ed25519-signed manifests, SHA-256, OS code-signature and
  same-publisher checks, channels, the Update Required screen, busy-aware
  restarts and critical-update deadlines.
- **App lock** after inactivity or with the computer; unlock with the
  WorkSuite password or Touch ID.
- **Diagnostics** with health checks, Safe Mode after repeated crashes, and a
  redacted support report the user previews before saving.
- CI for macOS, Windows and Linux; a signed-manifest release script; unit
  tests (77) and an end-to-end smoke test (28 checks) against a real server.

**Security**

- Sandboxed renderer with no Node, context isolation, CSP, a validated IPC
  allow-list with sender, lock, session, permission and rate checks, and
  hardened Electron fuses (no RunAsNode, no NODE_OPTIONS, asar integrity).

**Known limitations**

- Builds are unsigned until signing credentials are added to CI; unsigned
  builds run but do not update themselves.
- WorkSuite Drive folder sync, calls and Meet, the desktop AI assistant, the
  monitoring agent, hardware and kiosk are later phases.
- The server's `/desktop/v1` API does not exist yet; the client composes its
  bootstrap from the existing API and treats its policy as unsigned.
