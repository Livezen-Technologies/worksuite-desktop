# Backend contract

WorkSuite Desktop runs against any WorkSuite server. When the server announces
the **desktop API (`/desktop/v1`, SRS §8.1)** the app uses it; otherwise it
composes the same things from the **existing WorkSuite API**, which is what
every server had before the desktop API shipped.

The desktop API lives in the WorkSuite repository under
`app/Modules/Desktop`. `php spark desktop:probe` exercises it end to end.

## How the app tells them apart

`GET /.well-known/worksuite-desktop`, no sign-in:

```json
{ "api": "desktop-v1", "api_version": 1, "name": "WorkSuite",
  "minimum_versions": { "windows": "1.2.0" },
  "policy_signed": true, "policy_public_key": "-----BEGIN PUBLIC KEY-----…" }
```

`minimum_versions` is per platform; the app reads its own. `policy_public_key`
is for administrators to check a build against its server. The app never
trusts it: the key it verifies policies with is pinned at build time.

## `/desktop/v1` (used when announced)

Every call carries `Authorization: Bearer <access token>` (WorkSuite's own
sign-in) and, once the laptop is registered, `X-WS-Device: <device id>`.

| Need | Endpoint |
|---|---|
| Register this installation | `POST /desktop/v1/devices/register` `{install_id, name, platform, arch, app_version, os_version, hostname}` → `{device_id, token, trust, policy_version}` (201 new, 200 the same installation again) |
| Heartbeat, directives, commands | `POST /desktop/v1/devices/heartbeat` → `{directives, commands:[{id, command, payload}], trust, policy_version, server_time}` |
| Acknowledge a command | `POST /desktop/v1/devices/commands/{id}/ack` `{status: DONE\|FAILED, result}` |
| Bootstrap (§8.2) | `GET /desktop/v1/bootstrap?organization_id=` |
| Apps | `GET /desktop/v1/apps` → `{apps_gated, apps:[{id: "worksuite.<slug>", slug, name, route, desktop:{native}}]}` |
| Policy only | `GET /desktop/v1/policies?organization_id=` |
| Open a `worksuite://` link | `GET /desktop/v1/links/resolve?url=` → `{valid, module, route, window, allowed, organization_id}` |
| Device-side audit | `POST /desktop/v1/audit` `{events:[{id, action, at, details}]}` (idempotent on `id`) |
| Drive change feed | `GET /desktop/v1/sync/changes?cursor=&limit=`, `POST /desktop/v1/sync/events` |
| File locks | `POST` / `DELETE /desktop/v1/files/{id}/lock` |
| Release manifest | `GET /desktop/v1/releases/manifest?platform=&arch=&channel=` (no sign-in; served exactly as signed) |

Administration, for people with the `desktop.*` permissions, limited to the
people and companies they administer:

| Need | Endpoint | Permission |
|---|---|---|
| Fleet | `GET /desktop/v1/admin/devices?q=&os=&state=&user_id=` | `desktop.devices.manage` |
| Act on a device | `POST /desktop/v1/admin/devices/{id}/{revoke\|sign-out\|disable-sync\|enable-sync\|disable-desktop\|enable-desktop\|require-update\|refresh-policy\|trust\|untrust}` | `desktop.devices.manage` |
| Policies | `GET /desktop/v1/admin/policies`, `PUT /desktop/v1/admin/policies/{platform\|organization:<id>\|device:<id>}` `{policy}` | `desktop.policies.manage` (platform: super-administrator only) |
| Releases | `GET` / `PUT /desktop/v1/admin/releases` `{manifest?, settings?}` | publishing: `desktop.releases.manage`; a company's minimum version: `desktop.policies.manage` there |

Policies layer platform → organization → device, each with a version that
only goes up. Error envelopes carry the §8.3 `code` the app acts on:
`DEVICE_REVOKED`, `DEVICE_NOT_REGISTERED`, `DESKTOP_ACCESS_DISABLED`,
`DEVICE_LIMIT`, `INVALID_LINK`, `FILE_LOCKED`, `SYNC_CURSOR_EXPIRED`,
`POLICY_DENIED`.

### Revocation

Revoking a laptop ends its session and queues a wipe. The server answers
`401 DEVICE_REVOKED` to any `desktop/*` call **and to the token refresh**
from that laptop, even once its session has gone. The app's next API call
after revocation is a 401; the app answers a 401 by refreshing, and the refresh
tells it to wipe. The five-minute heartbeat catches a laptop that makes no
calls at all. Registering the same installation again, after signing in again,
makes a new device; the revoked one stays revoked.

### Signed policies

The server signs `desktop_policy` with Ed25519 over canonical JSON when
`desktop.policySigningKey` is set in its `.env`. `php spark desktop:keys` makes a key
and prints the public half; build the app with it as
`MAIN_VITE_POLICY_PUBLIC_KEY`. A build with a pinned key refuses unsigned or
wrongly signed policies and keeps the last one it accepted. A build without
one applies policies as unsigned, the same trust as the rest of the API.
Changing the key is a coordinated change: builds pinned to the old key refuse
every new policy until they are updated.

### Releases

The server never signs releases. Livezen signs each manifest offline (see
[RELEASING.md](RELEASING.md)) and publishes it with
`PUT /desktop/v1/admin/releases {manifest}`. The server refuses a manifest that
does not verify against the release key the app pins.

## The existing API (servers without `/desktop/v1`)

| Need | Endpoint |
|---|---|
| Recognise a server | `GET /api/auth/config` |
| Sign in / MFA / refresh / sign out | `POST /api/auth/login`, `/api/auth/mfa`, `/api/auth/refresh`, `/api/auth/logout` |
| User, permissions, app access | `GET /api/auth/me` |
| Organizations | `GET /api/directory/organizations` (with `directory.view`), else `GET /api/tasks/organizations` |
| Device registration | `POST /api/sync/devices` (returns the device token Drive sync will use) |
| Heartbeat + directives (block, wipe, required version, offline allowed) | `POST /api/sync/devices/{id}/health` |
| Device trust | `GET /api/sync/fleet` (`trusted`, `state`) |
| Device policy | `GET /api/sync/policy` (`allow_offline`), unsigned and applied as such |
| Realtime | `GET /api/notifications/realtime-ticket` → WebSocket |
| Notifications, badges | `GET /api/notifications`, `/api/notifications/unread-count`, `/api/badges`, `/api/chat/unread`, `/api/mail/unread?unified=1` |
| Modules | the same endpoints the web client uses (mail, chat, calendar, tasks, files, CRM, HR, search, activity, dashboard, uploads, downloads) |

On these servers the app grants the Employee row of the §10 role matrix,
applies the sync policy and device directives unsigned, and keeps device-side
audit events in its local outbox.

Releases on such a server are static files at
`https://<server>/desktop/releases/<channel>/manifest.json` (e.g. under
`public/desktop/releases/`), checked at start-up and every four hours.

## Not provided yet

- `monitoring_policy` is always `null`, and every `feature_flags` entry is
  false: Drive sync, monitoring, kiosk and AI are later phases.
- Permissions are the same in every company: WorkSuite grants them
  installation-wide, so switching organizations reloads them but they do not
  change.
