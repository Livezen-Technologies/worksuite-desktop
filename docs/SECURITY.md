# Security

## Electron hardening (SRS §3.3, §13.2, NFR-SEC-01)

| Control | Where |
|---|---|
| `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true` on every window; `app.enableSandbox()` | `electron/windows/manager.ts`, `electron/main/index.ts` |
| No `<webview>`, no remote module; `setWindowOpenHandler` denies everything and hands https/mailto to the OS after an allow-list or a confirmation | `electron/security/hardening.ts` |
| `will-navigate` / `will-redirect` / subframe navigation limited to `app://bundle` | `hardening.ts` |
| The UI loads only from `app://bundle` (the asar); remote origins never host shell UI | `electron/protocols/app-protocol.ts` |
| CSP: `default-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'none'` | `hardening.ts` |
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
  mouse (they win for the policy's hold), the share paused. Reserved chords
  are matched by key and modifiers, whatever the order, spelling or extra
  modifiers. A burst pauses control and is reported; other refusals are
  reported every ten seconds, except messages under the other key for a
  moment after a key change.
- **One window shared**: a press or a wheel lands only where the helper sees
  that window under the pointer (not another app covering it); keys wait
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
  Accessibility), xdotool (X11) — started only while control is live, with
  fixed scripts. They take numbers, key names from a prototype-free table and
  base64 text; nothing from the controller is put into a command line. One
  batch is in the helper at a time and each is confirmed before the next, so
  a pause forgets what was waiting and the releases go next. Text goes in
  64-character pieces; on X11 typed text ends its xdotool run. A helper that
  exits on its own pauses control. Windows' UIPI keeps a non-elevated
  WorkSuite from driving elevated windows, and Ctrl+Alt+Delete cannot be
  injected by any app; the person here is asked to press it.
- **Quitting** while controlled or sharing asks first, and stops both;
  stopping ends input here before the server has answered.

## Credentials (FR-AUTH-02, FR-SEC-03, AC-21)

- Access token: main-process memory only.
- Refresh token, device token, database key: OS credential store through
  `safeStorage` (Keychain, DPAPI, Secret Service/KWallet). On Linux without a
  keyring, Electron's fallback is a fixed key — so nothing is written, the
  session lives in memory, and the app says so.
- Refresh tokens rotate on use; refresh is single-flight so two refreshes never
  revoke each other.

## Updates (FR-UPD-01, WF-25)

1. Manifest signature: Ed25519 over canonical JSON, public key pinned in
   `electron/updater/keys.ts`. An unverifiable manifest is ignored.
2. Artifact SHA-256 and size must match the signed manifest.
3. OS code signature of the new build must be valid and from the same
   publisher as the running one (macOS Team ID, Windows Authenticode subject).
   An unsigned running build cannot establish a publisher and therefore
   does not install updates itself.

The private release key is never in this repository.

## Privacy

- Logs and the diagnostic bundle are redacted (tokens, JWTs, secret query
  parameters, email addresses, bodies); the user previews the bundle and
  chooses where to save it. Nothing is uploaded.
- Notification content follows the privacy mode and is always hidden while
  WorkSuite is locked.
- Mail bodies render in a sandboxed frame with scripts, forms and remote
  images removed; links open in the browser.
- The clipboard is read only in response to the user's paste; there is no
  clipboard monitoring (FR-XFR-06).
- The device is identified by a random install id and the host name, never by
  hardware serials or MAC addresses (NFR-PRV-03).
- No activity monitoring exists in this version. The Phase 3 agent must meet
  §13.3: assigned policy, acknowledgement, always visible, never keystrokes,
  passwords, clipboard, continuous camera or microphone.
