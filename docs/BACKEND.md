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
| Passkey sign-in | `/desktop/passkey` in the browser, then `POST /api/auth/passkeys/desktop/exchange` (see below) |
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

### Passkey sign-in

A passkey only works on a page served from the server's own address; the
app's screens are `app://bundle`. So when discovery announces
`passkey_sign_in`, the sign-in screen offers **Sign in with a passkey**:

1. The app makes a PKCE verifier and a state, keeps both in memory, and opens
   `<server>/desktop/passkey?challenge=S256(verifier)&state=…&device=…` in the
   default browser.
2. The page proves a passkey at `POST /api/auth/passkeys/desktop/handoff`
   with the challenge (every web passkey gate applies) and receives a
   one-time code. The browser is not signed in.
3. The page opens `worksuite://auth/callback?code=…&state=…`. The app
   ignores any callback whose state is not the attempt it is waiting for,
   and a replayed one.
4. The app exchanges `{code, code_verifier}` at
   `POST /api/auth/passkeys/desktop/exchange` for tokens, then registers and
   bootstraps as after a password.

The code is good for two minutes and one attempt. Without the verifier,
which never leaves the app, it is worth nothing to another program that
registered `worksuite://`.

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

### Chat, calls and meetings

The communications screens use the web's endpoints. Three details are
specific to the desktop:

- **The media server comes from the bootstrap** (`media.livekit_url`). The
  page policy names every origin a window may reach, and it is fixed when
  the window loads. Call and meeting windows open after the bootstrap, so
  they allow the media server (as `wss:` and `https:`). A server whose
  bootstrap does not announce one cannot carry calls to the desktop.
- **Calls:**
  - `POST /api/chat/calls` places a call, or joins the live one;
  - `POST /api/chat/calls/{uuid}/answer|decline|end` answers, declines and
    ends it; ending twice is a no-op;
  - `GET /api/chat/calls/ringing` is polled while realtime is down;
    otherwise the `chat.call.ringing` and `chat.call.stopped` events drive
    it;
  - `GET /api/chat/calls/history` is the call log;
  - `POST /api/chat/voicemail` leaves a voice message.
  The main process ends a call whose window closes, because a page's beacon
  carries no credentials.
- **Meet:**
  - `/api/meet/*` covers create, schedule, resolve, history, upcoming and
    recordings;
  - `/{uuid}/sfu?pass=` returns the token;
  - the host controls are admit, remove, mute, lock, end-all and
    record/start|stop;
  - the whiteboard is saved with `PUT /{uuid}/whiteboard` and travels live
    on the data channel, topic `wb`.
  The waiting room is LiveKit metadata (`{waiting: true}`, no publish
  grant), not a server list.
- **Meetings:** `/api/meetings/*`, behind the `meeting.*` permissions. The
  list carries `my_role` and `my_rsvp`. The detail carries the agenda timer
  and each person's attendance and permissions.

### Garage

The Garage tab uses the server's Garage API, `/api/garage/v1` (`app/Modules/Garage`), the same one the web's
`/garage` page uses. Every route is behind `garage.access`; each verb checks its own permission for the record's
company and the person's data scope, and a job outside it answers 404. The finer grants come back in
`GET options` → `can` (`garage.parts.issue` read as `parts_issue`), and each screen's answer carries its own `can`.
Writes that can be pressed twice carry an `Idempotency-Key`; a refusal's `errors.code` (`odometer_reason`,
`discount`, `setup`…) says what to ask for.

| Screen | Calls |
|---|---|
| Shell, overview | `GET options?org=`, `GET overview` |
| Board, jobs | `GET board`, `GET jobs?view=&q=&page=`, `POST jobs/{id}/drop {column}` |
| Walk-in | `GET search?q=`, `POST customers` (409 with `candidates`), `POST vehicles` (409 with `duplicate`), `POST jobs` (409 with `open`; `confirm_open`) |
| Job 360° | `GET jobs/{id}`, `POST jobs/{id}` (edit), `POST jobs/{id}/move {to}`, `POST jobs/{id}/cancel {reason, note}`, `POST jobs/{id}/notes`, `POST notes/{id}/visibility` |
| Check-in | `GET` / `POST jobs/{id}/checkin`, `POST jobs/{id}/checkin/sign {image, signer_name, signer_relation}`, `POST jobs/{id}/checkin/complete {email, odometer_reason?}`, `POST jobs/{id}/checkin/email`, `POST jobs/{id}/media` (multipart: `file`, `subject` checkin / damage, `slot`), `DELETE media/{id}` |
| Media | `GET media/{id}` (thumbnails, through the API proxy), `POST jobs/{id}/media` (`subject` job / inspection_item), `POST media/{id}/visibility`, `DELETE media/{id}` |
| Inspection | `GET jobs/{id}/inspections`, `POST jobs/{id}/inspections {template_id}`, `POST inspections/{id} {items, customer_note, internal_note}`, `POST inspections/{id}/complete`, `POST recommendations/{id}/status` |
| Diagnosis | `GET jobs/{id}/diagnosis`, `POST jobs/{id}/diagnosis {complaint}`, `POST diagnosis/{id}`, `POST jobs/{id}/dtc`, `POST jobs/{id}/diagnosis/signoff`, `GET parts?job=&q=` |
| Estimate | `GET jobs/{id}/estimates`, `POST jobs/{id}/estimates {summary?}`, `POST estimates/{id}/lines[/{line}]`, `DELETE estimates/{id}/lines/{line}`, `POST estimates/{id}/recommendations {ids}`, `POST estimates/{id}/approve-discount`, `POST estimates/{id}/send {message, email}` (answers the link once), `POST estimates/{id}/decision {method, decisions, name, note, signature?}`, `POST estimates/{id}/changes` |
| Work | `GET jobs/{id}/work`, `POST jobs/{id}/work-orders`, `POST work-orders/{id}`, `GET work-orders/{id}/suggest`, `POST work-orders/{id}/assign`, `POST work-orders/{id}/bay`, `POST work-orders/{id}/start\|pause\|complete\|cancel`, `POST work-orders/{id}/additional`, `POST jobs/{id}/additional/price {ids}`, `POST work-orders/{id}/labour`, `POST labour/{id}/correct`, `POST jobs/{id}/parts`, `POST jobs/{id}/removed-parts` |
| My work, parts counter | `GET my-work`, `GET parts-queue?view=&q=`, `POST parts-scan {job, code}`, `POST parts-usage/{id}/reserve\|requisition\|issue\|used\|return\|release` |
| Quality & delivery | `GET jobs/{id}/delivery`, `POST quality-checks/{id}/start`, `POST quality-checks/{id} {items}`, `POST quality-checks/{id}/pass\|fail`, `POST jobs/{id}/road-test`, `POST jobs/{id}/ready {items_present}`, `POST jobs/{id}/invoice`, `POST jobs/{id}/pay {amount, method, reference}`, `POST jobs/{id}/handover`, `POST customers/{id}/credit {limit, note}` |
| Vehicles | `GET vehicles?q=&type=&page=`, `GET vehicles/{id}` (the 360°), `POST vehicles/{id}`, `POST vehicles/{id}/odometer {reading, reason?}`, `POST vehicles/{id}/transfer {client_id, note}`, `POST vehicles/{id}/notes` |
| Customers | `GET customers?q=&page=`, `GET customers/{id}?org=`, `POST customers/{id}/prefs`, `POST customers/{id}/credit` |
| Workshop | `GET workshop`, `GET workshop/employees?q=`, `POST workshop/{branches\|workshops\|bays\|technicians\|rates\|service-types\|models\|inspection-templates}[/{id}]`, `POST bays/{id}/status {status, note}` |
| Set-up, settings | `GET setup`, `POST setup/steps/{key} {how}`, `POST setup/finish`; the module's settings at `GET` / `PUT /api/module-settings/garage/general?org=` |
| Reports | `GET reports`, `GET reports/{name}?from=&to=&branch_id=` |

**Documents** leave through the download manager (`transfers:download` with `garageDoc`, `shared/garage-docs.ts`),
by what they are; the main process builds the address: `jobs/{id}/checkin/sheet`, `estimates/{id}/print`,
`work-orders/{id}/sheet`, `jobs/{id}/delivery-note` (pages the server renders for printing, saved as `.html` and
opened in the browser) and `reports/{name}?format=csv` (for `garage.report.export`).

**Offline.** READ_CACHE covers `options`, `overview`, `board`, `my-work`, `jobs` (lists, job cards and their
tabs), `vehicles`, `customers` and `workshop`. A timer's start or pause with WorkSuite out of reach waits in the
offline queue with `at`, the moment it was pressed, which the server books as `OFFLINE_SYNC` (within twelve hours).
Every other write needs the server.

What the desktop cannot do because the server does not (SRS Phase 1 **M** items):

- The overview has no revenue today, technicians working, appointments, technician workload, parts consumption,
  customer updates or reminders (FR-DSH-01/02); a board card has no technician (FR-BRD-02).
- No next-service-due on a vehicle (FR-VEH-05), and no per-vehicle inspections, parts-replaced or documents lists
  (FR-VEH-04; they are on each job).
- Documents are HTML pages for printing: no PDF, WhatsApp or share link for them, and no job card, inspection, QC,
  road-test, parts-issue or warranty documents (FR-CHK-07, FR-DOC-02/03).
- Estimates go out by email and the link; no WhatsApp sending or portal (FR-APR-01), no service packages (FR-EST-07).
- Labour rates are by class, hourly or flat; no customer, contract, warranty or internal-fleet rates (FR-PRC-01).
- No customer opt-out per channel (FR-REM-05) or per-branch notification switches (FR-NTF-03).

### eLearning

The eLearning tab uses the server's eLearning API, `/api/elearning/v1` (`app/Modules/Elearning`, phase P1 — Core
LMS). Offline copies of a course:

| Need | Endpoint |
|---|---|
| What a course may take offline | `GET me/courses/{id}/download-manifest` → `{course_id, version, revision, total_bytes, files:[{lesson_id, file_id, name, mime, bytes, url, protected}], license:{expires_at, encrypted}}`; 409 `offline_off` when the company keeps none. Asking starts the server's credit clock for progress played offline. |
| Each file | its `url` (`/media/{token}`, Drive's signed address, good to the end of the next hour), fetched by the main process with `Range` to resume |
| Which copies may stay | `POST me/downloads/validate {course_ids}` → `{courses:[{course_id, active, ended_at}]}` |

The main process fetches the manifest and the files itself (the renderer names a course, never an address) and keeps
them sealed in the profile (see ARCHITECTURE.md). A course the server does not answer `active: true` for is removed;
so is one past `license.expires_at`, without asking.

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
| Modules | the same endpoints the web client uses (mail, chat, calendar, tasks, files, CRM, HR, finance, expenses, search, activity, dashboard, uploads, downloads) |

On these servers the app grants the Employee row of the §10 role matrix,
applies the sync policy and device directives unsigned, and keeps device-side
audit events in its local outbox.

Releases on such a server are static files at
`https://<server>/desktop/releases/<channel>/manifest.json` (e.g. under
`public/desktop/releases/`), checked at start-up and every four hours.

## Drive sync

The same on both API families. The device credential registration returns
is sent as `X-Device-Token`; nothing else is.

| Need | Endpoint |
|---|---|
| Who am I, the policy, pause or wipe | `POST /api/sync/hello` |
| Has Drive changed (this computer's own writes excluded) | `GET /api/sync/delta?since=&limit=1`, then `POST /api/sync/ack {cursor}` |
| Upload only what Drive lacks | `POST /api/sync/have {hashes}`, `POST /api/sync/block` (raw, `X-Block-Hash`), `POST /api/sync/commit {name, blocks, sha256, file_id?, base_version?, folder_id?}` |
| Download only what differs | `GET /api/sync/files/{id}/manifest`, `GET /api/sync/files/{id}/block/{idx}` |
| The record of a pass | `POST /api/sync/session`, `POST /api/sync/session/{id}/close` |
| Confirm a wipe | `POST /api/sync/wiped` |

With the session, as the Files screens use them: the picture of a folder
(`GET /api/drive/tree`, `GET /api/drive/list?folder_id=&deep=1`), folders
(`POST /api/folders`, `PUT /api/folders/{id}`, `POST /api/drive/folders/{id}/move`,
`DELETE /api/folders/{id}`), renames and moves (`PUT /api/files/{id}`), the
recycle bin (`DELETE /api/files/{id}`), a colleague's file
(`GET /api/files/{id}/download`), what the block protocol cannot take — an
empty file, one past 64 blocks, a colleague's file — (`/api/uploads/*`, with
`replace_file_id` for a new version), and the device centre
(`GET /api/sync/devices`, `PUT /api/sync/devices/{id}/roots`, `…/logout`,
`…/wipe`).

What the server does not give sync, and how the app copes:

- **The journal is a hint, not the truth.** Events name a file without its
  folder; trashing a file records nothing; folders record nothing. The app
  compares pictures instead and uses the journal only to know when to look.
  Recording `folder_id`, trash and restore, and folder events in
  `SyncEngine::record` would let a pass skip the listing when nothing moved.
- **Only the owner's files go through the protocol** (`SyncController::visible`),
  so a colleague's file in your folder travels by the ordinary download and
  upload, whole.
- **A commit is assembled in PHP's memory**, so files past 64 blocks (256 MiB)
  use the chunked upload instead.
- **Deleting a folder does not take its files to the recycle bin**; the app
  deletes a Drive folder only once it is empty.

## Not provided yet

- `monitoring_policy` is always `null`, and every `feature_flags` entry is
  false: monitoring, kiosk and AI are later phases. Drive sync is governed
  by `file_sync`, `personal_device_mode`, `removable_media_sync` and
  `wipe_on_revoke` in the desktop policy, and the sync policy
  (`/api/sync/policy`) for sizes, types and ignore patterns.
- Permissions are the same in every company: WorkSuite grants them
  installation-wide, so switching organizations reloads them but they do not
  change.
