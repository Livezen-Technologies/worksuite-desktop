# Security

## Electron hardening (SRS §3.3, §13.2, NFR-SEC-01)

| Control | Where |
|---|---|
| `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true` on every window; `app.enableSandbox()` | `electron/windows/manager.ts`, `electron/main/index.ts` |
| No `<webview>`, no remote module; `setWindowOpenHandler` denies everything and hands https/mailto to the OS after an allow-list or a confirmation | `electron/security/hardening.ts` |
| The Office editor: a `WebContentsView` in its own in-memory partition and process, on `wsoffice://editor`, held to the Document Server's origin (see below) | `electron/services/office-editor.ts`, `electron/security/office-policy.ts` |
| `will-navigate` / `will-redirect` / subframe navigation limited to `app://bundle` (the Office editor's view has its own, stricter rule: `setNavigationRule`) | `hardening.ts` |
| The UI loads only from `app://bundle` (the asar); remote origins never host shell UI | `electron/protocols/app-protocol.ts` |
| CSP: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'none'` — WebAssembly may compile (the built-in Office editor, BetterOffice); `eval` and remote scripts may not | `hardening.ts` |
| Permission handler: only clipboard write and fullscreen for the shell; camera, microphone, screen capture, geolocation, devices denied | `hardening.ts` |
| Fuses: RunAsNode off, NODE_OPTIONS off, `--inspect` off, only load from asar, asar integrity on, cookie encryption on | `build/electron-builder.config.cjs` |
| DevTools off in packaged builds | `manager.ts` |

## IPC (§3.4, WF-05)

Only channels in `shared/ipc/channels.ts` exist. Every call passes, in order:
schema (zod, unknown keys stripped, 1 MB cap) → sender is our window's main
frame on `app://bundle` → refused while locked unless marked otherwise →
signed-in session → desktop permission (from bootstrap and device trust) →
per-window rate limit → handler → audit for sensitive channels. More than 20
violations a minute from one window reloads it. Failures return typed codes.

File operations never take a path from web content: files are chosen in a
main-process dialog or dropped (converted to paths in the preload from real
`File` objects), and the renderer holds opaque handles. Downloads land in the
download folder; "open" and "show in folder" only act on canonical paths
inside it.

## The Office editor (WorkSuite Drive — ONLYOFFICE SRS §7.4, AC-21)

The Document Server's editor is third-party code, so it never runs in the
shell's page and never meets its bridge or its credentials:

- **Its own view, partition and process** (OO-DSK-020): each open document
  is a `WebContentsView` laid over its tab's placeholder
  (`electron/services/office-editor.ts`) — still no `<webview>`, no browser
  window. `nodeIntegration: false`, `contextIsolation`, `sandbox`,
  `webSecurity`, no `<webview>` tag, DevTools only in development builds.
  Its partition is one per organisation (`ws-office-<org>`), in memory (no
  `persist:`), and its cookies, storage and cache are cleared when the
  organisation's last document closes, at sign-out and on quitting
  (OO-DSK-023).
- **No WorkSuite credential can be reached from it.** Its page is
  `wsoffice://editor/index.html`, a privileged scheme of its own served
  only inside that partition, which has no `app://` handler: the API
  proxy (`app://bundle/__api`) does not exist there, and the access token
  stays in the main process as always. The editor gets only the
  configuration the server signed for this session (ten minutes), handed
  over untouched.
- **Where it may go** (OO-DSK-021, `electron/security/office-policy.ts`):
  the page never navigates away; its frames only to the configured
  Document Server's origin (and its own blank and blob frames); requests
  from the partition only to the Document Server (pages, scripts, fonts,
  its socket) and to the WorkSuite server for the pictures in the editor's
  user list — everything else is cancelled in `webRequest`. New windows and
  links go through the same `openExternalSafely` as the shell's (the
  system browser, after the allow-list or a confirmation). The page's CSP:
  `default-src 'none'`, scripts from itself and the Document Server, frames
  and connections to the Document Server only.
- **Which Document Server**: HTTPS only (plain HTTP only on this computer,
  in a development build), no credentials in the address, and `api_url`
  must be that server's own `…/web-apps/apps/api/documents/api.js`
  (`documentServerOrigin`, shared/office.ts); anything else is refused
  before a view exists.
- **The bridge** (OO-DSK-022, `electron/preload/office.ts`): `officeBridge`
  with four functions — ready, failed, emit an editor event, take
  commands. The main process hears it only from the main frame of an
  editor view's own page, drops unknown events and any field an event
  should not carry (a mention's comment text never crosses), caps size and
  rate, and passes the rest to that view's tab only. Commands back are a
  fixed list (start, refresh, setUsers, denyEditingRights, showMessage).
- **Permissions and downloads**: the partition allows only writing to the
  clipboard and full screen (slide shows); devices are denied. The
  editor's own "Download as" is stopped (`will-download`): documents leave
  through the tab's Download and Export, under Drive's permissions and the
  download manager (OO-DSK-024).
- **Keyboard**: while the editor has the keyboard the app menu keeps only
  close tab, new tab and quit; ⌘/Ctrl+K, ⌘/Ctrl+L and the rest are the
  editor's (`menuKeepsShortcut`).
- **Copies for other apps** (OO-DSK-050, `electron/services/office-external.ts`):
  downloaded by the download manager into the downloads folder (they are
  the person's, like any download) and opened only where the device
  policy allows opening files in other apps; Word, Excel and PowerPoint are
  found by fixed paths (macOS) or their App Paths registry entry (Windows)
  and started with the file as their one argument, no shell. The list of
  copies being watched is encrypted in the profile and forgotten at a wipe;
  nothing goes back to Drive without the person choosing, and never over a
  newer version without the server's conflict answer (OO-OFF-030/031).

## Meet remote control (WS-MEET-ENH-01 §E)

Being controlled is the main process's business, never a page's:

- **The key never reaches a page.** The API proxy refuses the shared
  computer's grant (`grant?end=sharer`), answering a request, resuming,
  security and capability reports, taking or fetching an offered file, and
  offering a page's own bytes as a file; only the main process makes those
  calls. A meeting window relays data-channel messages it cannot read, and
  only the named controller's: another participant flooding the topic is
  dropped before IPC (and the server gives no data channel to anyone still
  waiting to be let in).
- **Consent needs this computer's own hand.** The prompt (RC03) is a window
  of its own, above everything and left out of screen capture. Allowing
  counts only if a real mouse-down or key-down reached that window in the
  last ten seconds, more than 1.5 s after the input helper last *finished*
  carrying input out, with nothing still queued; nothing at all is injected
  while a prompt or the send-a-file dialog is open. Resuming, accepting a
  file and sending one work the same way, from the control bar only. While
  a controller keeps sending, those buttons refuse until they pause — the
  safe way to fail.
- **The grant is checked before use**: Ed25519 only, over the exact signed
  bytes, with the pinned policy key when the build has one; it must say it is
  a grant (`typ`), name this device, this session, meeting and share, not be
  expired, and name its channel key (`key_sha256`, required when pinned).
- **Every message** passes `ControlReceiver` (MAC, sender, per-lane
  sequence, a lease no further ahead than its length plus two minutes of
  clock skew, state, capability, bounds, reserved chords, rate), then this
  computer's gates: a prompt or dialog open, the person here moving the
  mouse (they win for the policy's hold; on X11 the pointer is read through
  xdotool, because Electron's own reading stands still while the pointer is
  off its windows), the share paused. Reserved chords
  are matched by key and modifiers, whatever the order, spelling or extra
  modifiers. A burst pauses control and is reported; other refusals are
  reported every ten seconds, except messages under the other key for a
  moment after a key change.
- **One window shared**: a press or a wheel lands only where the helper sees
  that window under the pointer (not another app covering it — on X11 the
  window manager's frame is what xdotool names, so `xwininfo` walks up from
  the shared window to see whether it is inside that frame, reading no other
  app's window names, which could be made to look like it; without
  xwininfo, presses land only while the window is the one in front); keys wait
  until the window has been seen in front (checked four times a second);
  Alt+Tab, Command+Tab and Windows+Tab are not passed on, nor the Windows or
  Command key sent alone from the menu (Command itself still works). A
  screen share whose display cannot be matched takes no pointer input,
  unless there is only one display.
- **Pauses**: lock screen, sleep, user switch, the secure desktop, and
  password managers or system prompts in front — also during the approval
  or a key change, told to the server once it goes active. A pause made here
  holds until the person here resumes (the key rotates). The emergency chord
  (policy, normalised, default Ctrl+Alt+Shift+Esc) is a global shortcut
  while control lasts and is never injected. WorkSuite's own app lock does
  not pause control: the computer is still in use; allowing, resuming and
  files wait for unlock.
- **Input helpers** are the system's own — PowerShell hosting a fixed C#
  class calling SendInput (Windows), osascript posting CGEvents (macOS, needs
  Accessibility; typed text goes through System Events, so the app declares
  Apple Events and macOS asks once, as Automation), xdotool (X11) — started
  only while control is live, with
  fixed scripts. They take numbers, key names from a prototype-free table and
  base64 text; nothing from the controller is put into a command line. One
  batch is in the helper at a time and each is confirmed before the next, so
  a pause forgets what was waiting and the releases go next. Text goes in
  64-character pieces; on X11 typed text ends its xdotool run. A helper that
  exits on its own pauses control. Windows' UIPI keeps a non-elevated
  WorkSuite from driving elevated windows, and Ctrl+Alt+Delete cannot be
  injected by any app; the person here is asked to press it.
- **The controller's name beside the pointer** (RC-INP-04) is a window of
  its own: kept out of the capture, never focused, clicks pass through it
  (on Windows and macOS; on X11 that does not survive the window moving, so
  it is hidden before every press and scroll the controller sends and comes
  back on their next move). macOS's check of what a click is aimed at looks
  past WorkSuite's own capture-proof windows, never another app's.
- **Pointers and annotations** (RC-PTR, RC08) travel on their own data topic,
  never the control channel, and are only painted over the picture on each
  participant's screen. Every message is checked for shape (points 0–1,
  colours, lengths, 2,000 points, 500 strokes a share) and each person's
  are dropped past 60 a second; nobody draws in another's name, and only the
  person sharing clears everybody's or switches annotation off.
- **Quitting** while controlled or sharing asks first, and stops both;
  stopping ends input here before the server has answered.
- **Tried for real on Linux (X11)** under Xvfb and openbox, with the real
  service, xdotool and Electron windows: moves, clicks, keys, text and the
  wheel land where they point; the prompt's Allow and the red bar's Accept
  count only the person's own click (the controller's click reaches the bar
  and is refused); the person's mouse, on or off WorkSuite's windows, holds
  the controller back; the controller cannot send the emergency chord, and
  pressing it here stops control. Content protection does nothing on Linux.
  A shared window's place comes from xwininfo, not xdotool (whose Debian
  and Ubuntu version puts it a title bar low, where a click near the bottom
  edge would reach the app below); without xwininfo one shared window takes
  no clicks and Settings says to install x11-utils. xdotool runs in a UTF-8
  locale, so text past ASCII is typed whatever locale the app started in.
- **The helpers on real systems**: `tests/os/remote-control/check.mjs`
  drives each helper, built as the app builds it, against a test window
  that reports what arrives (clicks and their count, drags, the wheel, keys
  and their modifiers, typed text); the "Remote control helpers" workflow
  runs it on GitHub's Windows and macOS machines and on Linux under Xvfb
  whenever the helpers change. It passes on Linux (X11) here; its first
  Windows and macOS runs were not started by GitHub (no runner was given
  to any job in the repository that day).
- **Windows and macOS, as far as Linux can go**: the Windows helper's C#
  compiles as C# 5 (Windows PowerShell 5.1's compiler), and its script ran
  under PowerShell 7 against a stand-in user32 with Windows' structure
  layouts — the INPUT size, absolute moves across a virtual desktop left of
  the main screen, buttons, both wheels, extended keys, Unicode text with
  surrogate pairs, window places, the window under a point and in front, a
  clean stop; its command line is about half Windows' limit. The macOS
  script ran against a stand-in bridge (a unit test): drags, the click
  count of double- and triple-clicks, modifiers on keys, scrolling, the
  answers. Neither has run on its own system yet — what SendInput and
  CGEventPost then do there is the part still untried.

## PDF Studio (PDF Studio SRS §2.5, §3.5, §12.5, §23)

- **The engine never runs in the renderer** (§2.5, PDF-ARCH-010/011). PDFium runs in a utility process, one per
  open document, compiled to WebAssembly: a parser bug corrupts only the engine's linear memory; the module's
  only imports are an in-memory file system, the clock and a read callback over the one file main named. Electron's
  utility processes do not take Node's `--permission` flags (tried), so WebAssembly and "main names the file" are
  the boundary, plus the process: a crash, a hang (no pong for 20 s, or a request past its deadline) or the 1 GB
  memory ceiling ends that process only (PDF-SEC-034, PDF-NFR-005/010).
- **Scripts never run** (PDF-SEC-030): the WebAssembly build has no JavaScript engine and no form-fill
  environment is started. Launch actions, links into other files, form submissions, media and embedded files are
  never followed or opened (PDF-SEC-031/033). A web link is re-read from the document by the main process (the
  renderer names only the link), must be https or mailto without credentials, follows the organisation's rule
  (allow, confirm — the default —, block), and "confirm" is a native dialog (PDF-SEC-032). Active content is
  counted — document scripts, page actions, links and bookmarks page by page, and a pdfid-style scan of the raw
  file for `/JS`, `/Launch`, `/RichMedia`… with `#xx` escapes decoded — and shown in a banner (PDF-SEC-035).
- **IPC** (§23.1, PDF-API-001…003): `pdf:*` inputs are strict (unknown fields refused, not stripped); the
  renderer names a session it opened, pages and tickets; a session is bound to the window that opened it. Local
  files arrive only as handles (see PDFLocalFileBridge in ARCHITECTURE.md): no path is accepted from the
  renderer except from a real drop, turned into paths in the preload as `files:registerDropped` does.
- **At rest** (PDF-NFR-020, PDF-OFF-005): Drive files and attachments are sealed working copies (AES-256-GCM in
  1 MiB chunks, random key in memory only) in `<profile>/PDF/work`, never in a synced folder (Drive sync refuses
  the app's own folder), removed when the tab closes and at start-up. Thumbnails are sealed under a key derived
  (HKDF) from the database key, and not kept without a lasting keyring. Both go with WorkSuite's data at sign-out
  or a wipe.
- **Passwords** (PDF-SEC-013/014): typed into PDF Studio, sent once to the engine; "Remember for this session"
  keeps them in main-process memory until sign-out or quit. Never persisted, logged, audited or put in an error.
- **Print** (§14.4): pages drawn by the engine, served from memory to a hidden window with no preload, no
  JavaScript, no network, its own session and a CSP allowing only those images; nothing is written to disk.
- **Editing** (stage D2): the renderer sends operations, never bytes; each is validated by a strict schema
  (annotation ids `ws-…` or `idx:n`, bounded rects, strokes, text) and by the session's mode and the server's
  permission flags before the engine applies it. The content URL of a server session is fetched without the
  bearer token and only on the `/pdf/content/…` path; uploads carry each chunk's SHA-256. A local file is replaced
  atomically (temporary file, fsync, rename) and only a file the person opened. Recovery snapshots are sealed
  (AES-256-GCM) under keys derived from the database key, never written without one, and wiped at sign-out.
- **Office files from this computer** (`office-local.ts`): the renderer holds handles only. A path comes from the
  main process's open dialog or the OS ("Open with"), is resolved, must be a regular .docx / .xlsx / .pptx whose
  first bytes are a ZIP package, at most 200 MB, and outside WorkSuite's data; `office:writeFile` writes only
  over a file opened that way (atomically), `office:saveCopy` only where the person chose in the save dialog.
  Bytes cross IPC as a checked `Uint8Array` (non-empty, within the limit; strict schemas refuse any path field).
- **Drive covers** are drawn in the window from the file's bytes (read through the proxy, never written to disk
  in the clear) and kept only in PDF Studio's sealed thumbnail cache, under a hashed name, when offline storage is
  allowed; `pdf:coverPut` takes only a `drive:<id>:<version>` name and a JPEG of at most 512 KB.
- **Documents from other modules** open through the download manager: a PDF goes to PDF Studio (inside the app,
  so it is allowed where other applications are not); anything else goes to the OS only with
  `desktop.files.open_external`. Chat attachments are fetched by their signed `/media/{token}`, task attachments
  by a `/d/{token}` grant the server mints for 15 minutes; the renderer names only the token or the ids.
- **Logs and reports** (PDF-NFR-030/031, PDF-AUD-002): a failure is logged with the file's format, size, page
  count, the engine's error and the app version; opening and printing are audited with the file's id, version and
  page count. Never a name, a path, text or a password.

## Credentials (FR-AUTH-02, FR-SEC-03, AC-21)

- Access token: main-process memory only.
- Refresh token, device token, database key: OS credential store through
  `safeStorage` (Keychain, DPAPI, Secret Service/KWallet). On Linux without a
  keyring, Electron's fallback is a fixed key — so nothing is written, the
  session lives in memory, and the app says so.
- Refresh tokens rotate on use; refresh is single-flight so two refreshes never
  revoke each other.

## WorkSuite Events desk (Events SRS §9.4, §9.8, EV-CHK-031..033, EV-OFF-002/003)

A computer registered as a check-in device at an event holds a credential
of its own:

- **The device key** — 256 bits, handed over once when the computer is
  registered at an event (`POST events/{id}/devices`, as a `desktop` device
  named by its sync device id) or given a new key. The main process makes
  both calls and keeps the key in the OS credential store (`event-desk:<server>`),
  per event; no renderer, IPC answer, log or diagnostic bundle carries it. The
  API proxy refuses registering a device, a new key, the heartbeat, the
  offline copy and its upload to pages (`electron/services/api-proxy.ts`).
- **The offline copy** — only the gate's tickets, as `HMAC-SHA256(QR text,
  device key)`, with name, number, company, ticket type, status, whether money
  is owed and presence; no email, phone, address or amount (the server's
  choice). It is AES-256-GCM in the profile database (`event_desk_copy`), per
  server, event and person, and only where the desktop policy lets the
  computer keep data offline and queue changes (a trusted computer). A scan is
  matched against it in the main process; the key never leaves it. A copy
  stolen from the database is useless without the key, and matches nothing on
  another device.
- **The scan queue** — what the desk did offline, in the device's own sequence
  (`event_desk_queue`, encrypted: it holds the scanned QR text). It belongs to
  the person who scanned; another person at the desk sees only that it is
  there.
- **Revocation** — when the server says the device was revoked (`device_revoked`,
  `wipe: true`, on any call or the heartbeat), the key, the copy and the queue
  for that event are removed at once, whoever is signed in, and the desk says
  so (EV-CHK-033). A plain sign-out removes the person's copy (cache) and keeps
  their unsent scans; a remote wipe or "remove WorkSuite's data" removes every
  event desk, key, copy, queue and the badge printer settings.
- **Badges** print from the server's own badge page, fetched by the main
  process (a page cannot hand it something else to print without a dialog),
  in a hidden window with no preload, no script and no network.

## Restaurant terminal (Restaurant SRS RM-PLT-003, RM-COM-003, §4.3–4.4)

- **The terminal key** (`rt_` + 48 hex) is handed over once, to a person with `restaurant.device.manage`, by
  `POST terminals/{id}/pair`. The main process makes the call (after reading the terminal back from the server's
  structure) and keeps the key in the OS credential store (`restaurant-terminal:<server>`); no renderer, IPC answer,
  log or diagnostic bundle carries it. The API proxy adds it as `X-Terminal-Key` to Restaurant API calls only, and
  refuses pages pairing, `sync`, `sync/heartbeat`, `print-jobs/claim` and `print-jobs/{id}/printed|failed`
  (`shared/restaurant.ts: RESTAURANT_MAIN_ONLY`).
- **The copy and the outbox** (`restaurant_copy`, `restaurant_outbox`) are AES-256-GCM in the profile database, per
  server, terminal and person; the copy only where the desktop policy lets the computer keep data offline, the
  outbox only on a computer trusted to queue changes, and only for ops the branch allows offline. A plain sign-out
  removes the person's copy and keeps their unsent orders; unpairing drops the terminal's copy and outbox (and,
  when asked, revokes the key on the server); a remote wipe or "remove WorkSuite's data" removes the key, copy,
  outbox and printer mapping.
- **Printing** is the server's own text for a job this terminal claimed with its key, sent raw to the mapped printer
  (the printer's name passed as an argument or in the environment, never through a shell) or laid out in a hidden
  window with no preload, no script and no network. A page can ask for a test slip, the drawer, or a document the
  server returned (`restaurant:printText`, printable text only), never a path or a printer the settings do not name.

## Updates (FR-UPD-01, WF-25)

1. Manifest signature: Ed25519 over canonical JSON, public key pinned in
   `electron/updater/keys.ts`. An unverifiable manifest is ignored.
2. Artifact SHA-256 and size must match the signed manifest.
3. OS code signature of the new build must be valid and from the same
   publisher as the running one (macOS Team ID, Windows Authenticode subject).
   An unsigned running build cannot establish a publisher and therefore
   does not install updates itself.

The private release key is never in this repository.

## Local AI

- Models come only from WorkSuite's CDN. The catalog is an Ed25519-signed envelope checked against keys pinned in
  the app (`electron/services/local-ai/host.ts`) and refused once expired; each model file is checked against the
  catalog's size and SHA-256 before it is renamed into place, and never loaded otherwise. The signing key is made
  with `scripts/local-ai-catalog.mjs keygen` and never enters the repository.
- llama.cpp runs in its own utility process with no network; windows name models by id and never see a path.
- **On this computer** in the AI dock sends nothing off the computer and is given no WorkSuite data.

## Privacy

- Logs and the diagnostic bundle are redacted (tokens, JWTs, secret query
  parameters, email addresses, bodies); the user previews the bundle and
  chooses where to save it. Nothing is uploaded.
- Notification content follows the privacy mode and is always hidden while
  WorkSuite is locked.
- The app lock opens with the WorkSuite password (checked by the server), Touch
  ID, or a PIN of 4–8 digits set on this computer. Setting a PIN needs the
  password; repeated or consecutive digits are refused; only a salted scrypt
  hash (N=2^15) sealed by the database key is stored; wrong PINs and passwords
  share one count, and five sign the person out. A wiping sign-out removes it.
- Mail bodies render in a sandboxed frame with scripts, forms and remote
  images removed; links open in the browser.
- The clipboard is read only in response to the user's paste; there is no
  clipboard monitoring (FR-XFR-06).
- The device is identified by a random install id and the host name, never by
  hardware serials or MAC addresses (NFR-PRV-03).
- No activity monitoring exists in this version. The Phase 3 agent must meet
  §13.3: assigned policy, acknowledgement, always visible, never keystrokes,
  passwords, clipboard, continuous camera or microphone.
