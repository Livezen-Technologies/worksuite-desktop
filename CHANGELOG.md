# Changelog

What changed in WorkSuite Desktop, newest first. Entries are written for the
person who has to live with the change — what it does, and where it bites.

---

## 2026-09-25 — Sign in with a passkey, and clock in from the title bar

**Added**

- **Sign in with a passkey.** On a server that offers it (WorkSuite with
  `/desktop/v1`), the sign-in screen has **Sign in with a passkey** under the
  password form.
  - The app opens the server's passkey page in your browser, where Touch ID,
    Windows Hello, your phone or a security key work as they do on the web.
    WorkSuite then finishes signing you in here.
  - While it waits, the screen says so and offers **Open the browser again**
    and **Use my password instead**.
  - How it works: the browser proves the passkey and gets a one-time code; the
    app exchanges it with a PKCE verifier that never leaves the app. See
    [docs/BACKEND.md](docs/BACKEND.md).
- **Clock in and out from the title bar**, beside the connection pill, for
  anybody linked to an employee record.
  - **Clock in** is one click.
  - While clocked in, the pill shows the time worked. Clicking it opens a
    popover with a note field and **Clock out**, so a stray click cannot end
    the working day.
  - A policy that requires a note opens the popover for clocking in too.
  - The tray, the title bar and the HR page all clock through one
    main-process action (`hr:clock`). Each updates the other two at once;
    before, the tray only noticed a clock-in on the HR page within five
    minutes.

**Fixed**

- **Attendance times were off by the time zone.** Attendance stamps are
  wall-clock times on the company's clock, but the HR page and the tray read
  them as UTC. In Colombo a 22:25 clock-in showed as 3:55 AM, and the
  running time stayed at zero. Times are now shown as the digits the server
  sent. Time worked counts on from the server's own total, as the web does,
  and stands still during a break.
- **Messages from the main process were lost on the sign-in screen.** They
  were only listened for inside the signed-in shell. The listener now lives
  at the app's root.

**Checked**

- `tests/e2e/passkey.mjs` passes 15 of 15 against WorkSuite running locally.
  It plays the browser with a software authenticator signing real WebAuthn
  assertions, and hands the callback to the app as the OS does. It covers:
  - an unsolicited callback, a wrong state and a replay, each refused;
  - the sign-in completing as the passkey's owner;
  - clocking in with one click, and the server holding the check-in;
  - clocking out through the popover.

  It found three problems the unit tests could not, all fixed before this
  commit:
  - the new channels were missing from the preload bridge;
  - a stray callback cancelled the attempt it was not for;
  - toasts were dropped on the sign-in screen.
- 89 unit tests: 7 for passkey sign-in (the challenge is S256 of the verifier
  sent at the exchange; a wrong state, a second completion and a refused
  exchange each fail cleanly; a newer start replaces an older one; discovery
  accepts only same-server paths) and 4 for the attendance time rules.
  Typecheck and lint pass.

## 2026-09-25 — A macOS DMG that opens without an Apple certificate

**Added**

- `npm run dist:mac:unsigned` builds a universal (Apple silicon + Intel) DMG
  signed ad hoc, for testing before the Developer ID certificate exists.

**Found**

- **An ad-hoc-signed build with the hardened runtime does not start.** The
  first test DMG died at launch with `Library not loaded: … Electron
  Framework`: library validation needs a Team ID, and an ad-hoc signature has
  none. The unsigned script turns the hardened runtime off. `dist:mac` with a
  Developer ID keeps it on.

**Checked**

- `WorkSuite-0.1.0-universal.dmg` (219 MB) mounts, and the app inside is
  universal (x86_64 + arm64) and verifies with `codesign --verify --deep --strict`.
- It launches from the DMG: the GPU, network and renderer processes start and
  its profile is written.

**Where it bites**

- On any Mac but the one that built it, Gatekeeper refuses the unsigned app
  on first open. Right-click → Open, or run `xattr -dr com.apple.quarantine`
  on it after copying it to Applications. It cannot update itself.

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
