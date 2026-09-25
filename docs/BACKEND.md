# Backend contract

WorkSuite Desktop runs against the **existing WorkSuite API** and prefers the
**desktop API (`/desktop/v1`, SRS §8.1)** when a server announces it.

## What the existing API provides (used today)

| Need | Endpoint |
|---|---|
| Recognise a server | `GET /api/auth/config` |
| Sign in / MFA / refresh / sign out | `POST /api/auth/login`, `/api/auth/mfa`, `/api/auth/refresh`, `/api/auth/logout` |
| User, permissions, app access | `GET /api/auth/me` |
| Organizations | `GET /api/directory/organizations` (with `directory.view`), else `GET /api/tasks/organizations` |
| Device registration | `POST /api/sync/devices` (returns the device token Drive sync will use) |
| Heartbeat + directives (block, wipe, required version, offline allowed) | `POST /api/sync/devices/{id}/health` |
| Device trust | `GET /api/sync/fleet` (`trusted`, `state`) |
| Device policy | `GET /api/sync/policy` (`allow_offline`) — unsigned, applied as such |
| Realtime | `GET /api/notifications/realtime-ticket` → WebSocket |
| Notifications, badges | `GET /api/notifications`, `/api/notifications/unread-count`, `/api/badges`, `/api/chat/unread`, `/api/mail/unread?unified=1` |
| Modules | the same endpoints the web client uses (mail, chat, calendar, tasks, files, CRM, HR, search, activity, dashboard, uploads, downloads) |

Two things the existing API cannot provide, so the client supplies safe
defaults and says so in Diagnostics:

- **A signed desktop policy.** The client applies the sync policy and device
  directives over the authenticated TLS session and records them as unsigned.
- **Desktop permission keys** (`desktop.*`, §10). The client grants the
  Employee row of the role matrix and still applies policy and device trust
  on top.

## What `/desktop/v1` should add (server work)

1. `GET /.well-known/worksuite-desktop` → `{ "api": "desktop-v1", "name": "…", "minimum_version": "…" }` — how the client detects it.
2. `GET /desktop/v1/bootstrap?organization_id=` — the §8.2 shape, with
   `desktop_policy` signed (Ed25519 over canonical JSON, the `signature`
   field alongside). Build the client with `MAIN_VITE_POLICY_PUBLIC_KEY` set
   to the matching public key.
3. `POST /desktop/v1/devices/register`, `POST /desktop/v1/devices/heartbeat`
   returning `directives` in the same shape as `/api/sync/devices/{id}/health`,
   plus `trust`.
4. `GET /desktop/v1/releases/manifest?platform=&arch=&channel=` — the signed
   release manifest (see [RELEASING.md](RELEASING.md)).
5. `POST /desktop/v1/audit` — `{ events: [{ id, action, at, details }] }` for
   actions that only happen on the device (organization switch, local wipe,
   diagnostic export). Until it exists these stay in the local audit outbox.
6. Error `code`s from §8.3 in error envelopes (`DEVICE_REVOKED`,
   `DESKTOP_ACCESS_DISABLED`, `VERSION_UNSUPPORTED`, …); the client already
   acts on them.

## Releases on a server without `/desktop/v1`

Host the signed manifest and installers as static files at
`https://<server>/desktop/releases/<channel>/manifest.json` (e.g. under
`public/desktop/releases/`). The client checks there at start-up and every
four hours.
