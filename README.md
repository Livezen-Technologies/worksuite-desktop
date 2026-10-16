# WorkSuite Desktop

The native desktop client for WorkSuite — Windows, macOS and Linux — built to
**WS-DESKTOP-SRS-001 v1.1**. The desktop owns the experience; WorkSuite Core
stays authoritative for organizations, permissions, business logic and data.

This repository delivers **Phase 1 — Foundation** (SRS §18): the desktop shell,
sign-in with two-step verification, device registration and heartbeat,
multi-organization, the app registry, the Home dashboard, Mail, Chat,
Calendar, Tasks, Files (online), CRM, HR, native notifications, the system
tray, `worksuite://` deep links, the signed auto-updater, basic offline (read
cache + drafts + queued changes), diagnostics and the app lock.

It works against the **existing WorkSuite API today** and switches to the
`/desktop/v1` API (SRS §8.1) automatically when a server offers it — see
[docs/BACKEND.md](docs/BACKEND.md).

## Run it

```bash
npm install
npm run dev          # Electron + Vite with hot reload
```

Point it at your WorkSuite server on the first screen. Development builds also
accept `http://localhost:<port>`; packaged builds accept HTTPS only.

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript (strict) for the main process and the renderer |
| `npm run lint` | ESLint, including React Compiler rules |
| `npm test` | Unit tests (Vitest, run under Electron's own Node 24) |
| `npm run e2e` | End-to-end smoke test against a real server (see below) |
| `npm run build` | Production bundles in `out/` |
| `npm run dist:dir` | An unpacked app for this machine in `release/` |
| `npm run dist:mac` / `dist:win` / `dist:linux` | Installers (see [docs/RELEASING.md](docs/RELEASING.md)) |
| `npm run dist:mac:unsigned` | A DMG for testing, with no Apple certificate (see [docs/RELEASING.md](docs/RELEASING.md)) |

### End-to-end smoke test

```bash
WS_E2E_SERVER=http://localhost:8920 WS_E2E_EMAIL=… WS_E2E_PASSWORD=… npm run e2e
```

Launches the built app with a throwaway profile, drives it over the Chrome
DevTools Protocol — server, sign-in, setup, every module, search, settings,
diagnostics, the lock screen, sign-out — checks the security boundaries
(no Node in the renderer, forged IPC refused, CSP enforced, IPC refused while
locked, no token in the diagnostic bundle) and saves a screenshot of each
screen to `test-results/e2e/`.

### Display scaling

```bash
WS_E2E_SERVER=http://localhost:8920 WS_E2E_EMAIL=… WS_E2E_PASSWORD=… \
  WS_SCALING_SCALES=100,125,150,175,200 WS_SCALING_ONLY=crm,hr \
  ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/scaling.mjs
```

Opens every app (or the ones named in `WS_SCALING_ONLY`) and the busiest dialogs as a Full HD screen at each Windows
scale, and reports controls that are cut off, covered by something else, or whose label is squeezed onto extra lines.
It writes `scaling.json` and a screenshot of each screen with a finding to `WS_E2E_OUT` (default
`test-results/e2e-scaling/`). Run it after changing a layout.

### Passkey sign-in end to end

```bash
WS_E2E_SERVER=http://localhost:8920 WS_E2E_PASSKEY_KEY=key.pem WS_E2E_PASSKEY_ID=… WS_E2E_USER_ID=… \
  ELECTRON_RUN_AS_NODE=1 npx electron tests/e2e/passkey.mjs
```

Needs a user whose passkey is the public half of `key.pem` (an EC P-256 key in
PKCS#8), filed in the server's `passkeys` table under `WS_E2E_PASSKEY_ID`, and
linked to an employee with no attendance today. The test plays the browser:
it signs a real WebAuthn assertion with that key, proves it at the handoff,
and hands `worksuite://auth/callback` to the app the way the OS does. It then
clocks in and out from the title bar.

## How it is built

```
electron/            main process (Node, no web content)
  main/              lifecycle, session controller, IPC handlers, menu, boot/crash state
  ipc/               the IPC router: allow-list → schema → sender → lock → session → permission → rate → audit
  preload/           the only bridge: window.worksuite (typed, namespaced, no raw ipcRenderer)
  protocols/         app:// — the signed bundle, and /__api/ proxied to the server with the session's credentials
  security/          sandbox, CSP, permission handler, navigation and window-open lockdown
  services/          auth, device, bootstrap, policy, realtime, notifications, offline cache/queue/drafts,
                     transfers, lock, diagnostics, audit, supervisor, SQLite + column encryption, secure storage
  updater/           signed-manifest updater (Ed25519 + SHA-256 + OS code signature)
  windows/ tray/ workers/  (workers: hash-worker, pdf-worker — PDF Studio's engine, one per open document)
shared/              code both sides use: IPC contract (zod), app catalogue + visibility gates,
                     module manifest contract, deep-link grammar, redaction, versions, release manifest
src/                 React 19 renderer (sandboxed): shell, onboarding, overlays, modules
tests/               unit (Vitest) and e2e (CDP smoke)
build/               electron-builder config, entitlements, app icon
```

On **WorkSuite OS** the app signs in, enrols, updates and locks through the OS: see [docs/WORKSUITE_OS.md](docs/WORKSUITE_OS.md).

More: [architecture](docs/ARCHITECTURE.md) · [security](docs/SECURITY.md) ·
[backend contract](docs/BACKEND.md) · [releasing](docs/RELEASING.md) ·
[requirement traceability](docs/TRACEABILITY.md) · [changelog](CHANGELOG.md)

**PDF Studio** (`src/modules/pdf`, `electron/services/pdf`) opens PDFs from Files, Mail, this computer and the
OS in tabs of their own, drawn by PDFium (WebAssembly) in a worker process per document. It views, searches and
prints, annotates, organises pages, and saves back to Drive (new version or copy, with the server's lock, conflicts,
undo and recovery) or in place for a local file. PDFs from every other module (chat, tasks, HR, billing, purchasing,
mail) open here, and Office files open in WorkSuite's editor or the installed Word, Excel or PowerPoint — never in
the browser; the **Office** tile starts new documents and lists the recent ones. Office files edit inside the app in
EuroOffice (the server's Document Server) or, without one, in the built-in
[BetterOffice](https://github.com/Livezen-Technologies/betteroffice) editor (Apache-2.0; bundled fonts OFL 1.1). Its engine can be checked on a real system with
`npm run build && node tests/os/pdf/check.mjs` (Linux: under `xvfb-run`).

**Social Media Manager** (`src/modules/social-media`, WS-SMM-SRS-001) composes one post for many networks, approves,
schedules on a calendar or queue, answers a unified inbox and measures the results, over the server's
`/api/social-media`; publishing runs on the server. What the server still needs: [docs/SOCIAL_MEDIA.md](docs/SOCIAL_MEDIA.md).

**POS** (`src/modules/pos`, `electron/services/pos-*.ts`) makes a counter PC a paired till: its credential in the
OS keystore, the drawer's shift over WorkSuite's POS API, selling from a sealed catalogue copy with a keyboard-wedge
scanner — offline too, the copy brought up to date a change at a time and searched on the till (20,000 products in
milliseconds), sales numbered here and sent in order through the till's own door — thermal receipts and the
drawer kick (a reprint is WorkSuite's own receipt), e-mailed receipts, refunds and voids from the sales history, and a
customer display on a second monitor — the company's promotions beside the live cart, and, on a touch screen, the
customer's own phone number to put them on the sale (shown back only masked). The catalogue, prices and discount rights are POS's own (no Inventory
permission needed). What it uses on the server is in [docs/BACKEND.md](docs/BACKEND.md#pos--the-till).

## What is deliberately not here yet

Phases 2–4 of the SRS, apart from Drive folder sync (Files → Sync devices),
multi-window docking (tabs torn off into their own windows, and one
docked beside another; see [the changelog](CHANGELOG.md)) and the **Phone**
(a SIP softphone with the full agent, supervisor and admin screens of
WS-VOIP-SRS-001 — see [docs/PHONE.md](docs/PHONE.md)): calls and Meet,
the full desktop AI assistant (the dock and Quick Ask use the writing
assistant today), the workforce-monitoring agent, POS hardware beyond a receipt printer and its drawer (card terminals, scales), the
Admin Center fleet screens, kiosk mode, file-manager extensions and cloud
placeholders. Where Phase 1 touches them, the app says
so plainly instead of pretending (Files shows what is synced and what is online only; the AI
dock explains what is coming; Settings → Monitoring states that nothing is
recorded). Apps without a desktop module yet open in the browser and are
labelled that way. See [docs/TRACEABILITY.md](docs/TRACEABILITY.md).

---

Proprietary — © Livezen Technologies. See [LICENSE](LICENSE).
