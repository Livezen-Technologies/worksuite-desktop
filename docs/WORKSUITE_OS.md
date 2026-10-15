# WorkSuite OS mode

On WorkSuite OS the operating system does what a standalone desktop client does for itself. In OS mode the app
uses the OS's services and turns its own off. Code: `shared/os-mode.ts`, `electron/services/os-mode.ts`.

**When it is on:** when `/etc/worksuite/os-release` exists (the WorkSuite OS image writes it), or when the app is
started with `--worksuite-os` or `WORKSUITE_OS=1` (development and tests). `WORKSUITE_OS=0` turns it off on a
WorkSuite OS computer (support only). When OS mode is off, every flow below runs exactly as before.

| | Standalone | OS mode |
|---|---|---|
| Sign-in | server step, password, two-step, passkey | the OS credentials broker; **the app never asks for a password** |
| Device | `devices/register` + heartbeat every 5 min | the OS device agent's enrolment; the agent checks in |
| Updates | signed self-updater, AppImage / .deb / .rpm installs | off: the OS package manager updates the `worksuite-desktop` package |
| Lock | app lock (timer, system lock, manual) | off: the OS screen lock covers the app |
| worksuite:// | registered by the app | registered by WorkSuite OS (the package's `worksuite.desktop`) |

## Sign-in: the credentials broker

`worksuite-credentials` (Worksuite-OS `services/credentials`) listens on `$XDG_RUNTIME_DIR/worksuite/credentials.sock`
(mode 0600). Each connection carries one JSON request on one line:

- `Status` returns `[{id, server_url, name?, state}]`
- `GetAccessToken {account_id, force_refresh}` returns `"<token>"`, with `expires_at` (ms)
- `SignIn {server_url, mode}` opens the system browser (OIDC + PKCE) and returns `{id, name, server_url}`

At startup the app opens a broker account:

1. It uses an account that is already signed in, preferring one on the enrolled organization's server.
2. If no account is signed in, it calls `SignIn` with the same target rule the OS shell uses: the enrolled server
   (enterprise), then a previous account's server, then WorkSuite Cloud (personal).
3. It makes that server the open account, the same way choosing a server does.

`BrokerTokenEndpoint` is that account's `TokenEndpoint` (kind `broker`):

- AuthService keeps its single-flight refresh and timers, and each refresh is a forced `GetAccessToken`.
- Where a refresh token would be stored, the app keeps the marker `wsos-broker:<account id>`. The real refresh token
  stays in the broker's keyring.
- If the broker has lost the grant (`sign_in_required`), the session ends. If the broker is locked or not running,
  the session stands (offline) and the request is retried later.
- Sign-out never revokes anything, because the session belongs to the OS.

The renderer shows `OsSignIn` instead of every server and password screen (`AuthState.osManaged`).
`auth:osSignIn` runs the broker sign-in again. In OS mode, `auth:signIn` and `auth:passkeyStart` are refused.

## Device: the device agent

`worksuite-device-agent` publishes two files. Both are 0644, readable by every user, and are also read by the
broker and the sync service:

- `/run/worksuite-device-agent/status.json`, which holds `managed`, `device_id`, `server` and `org_name`
- `/run/worksuite-device-agent/device-token`, the device credential

When the computer is enrolled, `DeviceService` uses that device: it does not register itself and sends no
heartbeats, because the agent checks in and carries out the organization's commands. It sends the credential as
`X-WS-Device`, as the OS services do, and treats the computer as managed (`TRUSTED`).

A WorkSuite OS computer that is not enrolled (a personal one) registers as before. No new agent or broker method was
needed, because the credential is already readable by user services.

## Opening a module

`worksuite --module=<home|mail|chat|calendar|tasks|files|crm|hr>` (or `--module <id>`) opens through the same path
as `worksuite://<id>`. That means the same link grammar and permission checks. A second launch hands the module or
link to the running instance (single instance). An unknown module just opens the app.

The WorkSuite OS start menu launches `/usr/bin/worksuite --module=<id>`.
