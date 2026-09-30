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
LMS), the same one the web's `/elearning` pages use. Every route is behind `elearning.access` (and the person needs the
`elearning` application); each verb checks its own permission — or the course staff role or HR reporting line that
stands for it — for the record's company, and a record outside the person's reach answers 404. `GET options` → `can`
carries every permission for the chosen company (`elearning.course.publish` read as `course_publish`) plus `manager`
and `staff`; a course carries its own `can` (`edit`, `submit`, `publish`, `enroll`…). A refusal's `errors.code` says
what to offer (`revision_conflict`, `not_ready` + `problems`, `setup_required`, `locked` (423), `closed`, `timed`,
`full`, `late_blocked`, `offline_off`…). Writes that can be pressed twice carry an `Idempotency-Key` (create a course or
category, duplicate, assign, join, start an attempt, submit an assignment).

| Screen | Calls |
|---|---|
| Shell, set-up | `GET options?org=`, `GET setup`, `POST setup/steps/{key} {how}`, `POST setup/categories`, `POST setup/finish`; settings at `GET` / `PUT /api/module-settings/elearning/general?org=` |
| My Learning | `GET me/learning` |
| Catalogue | `GET catalog?q=&category_id=&level=&course_type=&max_minutes=&page=`, `GET categories`, `GET catalog/{id}`, `POST catalog/{id}/enroll`, `POST me/enrollments/{id}/withdraw` |
| Taking a course | `GET me/courses/{id}`, `GET me/lessons/{id}` (starts it; 423 with the reason), `POST me/lessons/{id}/progress` (heartbeats: `ranges`, `position`, `pages`, `scrolled_to_end`), `POST me/lessons/{id}/complete` (MANUAL only); media at the signed `/media/{token}` addresses through the API proxy |
| Quizzes | `GET me/assessments/{id}`, `POST me/assessments/{id}/attempts`, `GET me/attempts/{id}`, `PUT me/attempts/{id}/answers/{qid} {response}`, `POST me/attempts/{id}/submit {answers}` |
| Assignments | `GET me/assignments/{id}`, `POST me/assignments/{id}/submissions` (JSON `{text, file_ids, draft}`, or multipart with `files[]`) |
| Dashboard | `GET overview?org=` |
| Categories | `GET categories?org=&archived=1`, `POST categories`, `POST categories/{id}`, `POST categories/reorder {parent_id, ids}`, `POST categories/{id}/archive\|restore\|delete` |
| Courses | `GET courses?status=&course_type=&q=&mine=1&page=`, `GET courses/code?category_id=`, `POST courses`, `GET courses/{id}`, `POST courses/{id}` (with `revision`, `reason`), `POST courses/{id}/submit-review\|recall\|review\|publish\|suspend\|resume\|archive\|reopen\|duplicate\|delete`, `GET reviews`, `POST courses/{id}/staff`, `POST courses/{id}/staff/{staffId}/remove`, `GET courses/{id}/activity`, `GET courses/{id}/preview`, `GET lessons/{id}/preview` |
| Builder | `GET courses/{id}/structure`, `POST courses/{id}/structure {sections, revision}`, `POST courses/{id}/sections`, `POST sections/{id}[/duplicate\|/delete]`, `POST courses/{id}/lessons`, `GET lessons/{id}`, `POST lessons/{id}[/duplicate\|/delete]` |
| Assessments | `GET courses/{id}/assessments`, `POST courses/{id}/assessments`, `GET assessments/{id}`, `POST assessments/{id}[/delete]`, `POST assessments/{id}/questions`, `POST questions/{id}[/delete]`, `POST assessments/{id}/questions/order {ids}`, `GET assessments/{id}/attempts` |
| Assignments (staff) | `GET courses/{id}/assignments`, `POST courses/{id}/assignments`, `POST assignments/{id}[/delete]`, `GET assignments/{id}/submissions` |
| Enrolment | `GET courses/{id}/enrollments`, `GET enrollments?status=&overdue=1&q=`, `POST courses/{id}/enrollments/preview`, `POST courses/{id}/enrollments`, `GET enrollments/{id}`, `POST enrollments/{id}` (due date, mandatory), `POST enrollments/{id}/withdraw\|complete\|reset {reason}`, `POST enrollments/{id}/extensions`, `GET approvals`, `POST enrollments/{id}/decide`, `GET learners`, `GET learners/{userId}` |
| Grading | `GET grading?kind=`, `GET attempts/{id}`, `POST attempts/{id}/grade`, `GET submissions/{id}`, `POST submissions/{id}/review`, `POST submissions/{id}/grade` |

People and departments to assign or name as staff come from `GET /api/chat/directory` and
`GET /api/directory/departments` (where the person may read it); the eLearning API resolves ids, e-mails and employee
numbers itself and says who it could not.

**Offline.** READ_CACHE covers `options`, `me/learning`, `me/courses` (the outlines), `me/lessons` (lessons already
opened), `catalog` and `categories`. A heartbeat with WorkSuite out of reach waits in the offline queue (entity
`progress`) and replays to `POST me/lessons/{id}/progress`; the server credits it against the time since the course
was downloaded. Offline copies of a course:

| Need | Endpoint |
|---|---|
| What a course may take offline | `GET me/courses/{id}/download-manifest` → `{course_id, version, revision, total_bytes, files:[{lesson_id, file_id, name, mime, bytes, url, protected}], license:{expires_at, encrypted}}`; 409 `offline_off` when the company keeps none. Asking starts the server's credit clock for progress played offline. |
| Each file | its `url` (`/media/{token}`, Drive's signed address, good to the end of the next hour), fetched by the main process with `Range` to resume |
| Which copies may stay | `POST me/downloads/validate {course_ids}` → `{courses:[{course_id, active, ended_at}]}` |

The main process fetches the manifest and the files itself (the renderer names a course, never an address) and keeps
them sealed in the profile (see ARCHITECTURE.md). A course the server does not answer `active: true` for is removed;
so is one past `license.expires_at`, without asking. A lesson that allows downloading can also be saved to the
downloads folder: `transfers:download` with `elearningMedia` (the token of its `file.urls.download`).

What the desktop cannot do because the server does not:

- **No people lookup in eLearning.** Assigning learners and naming staff use Chat's directory and the Directory's
  departments; branches are taken by HR id only (there is no list of branches to choose from).
- **Office documents and presentations** are served as the original file (`urls.view`), with no rendition a
  desktop can show, so they are not shown in the app and a PAGES rule on them cannot be met from the desktop.
- **A kept copy cannot tell it is stale** after a published course is edited in place: `me/courses/{id}` carries the
  course `version` but not its builder `revision`, and `me/downloads/validate` says only active or not. The desktop
  compares the version; lesson edits within a version go unnoticed until the course is downloaded again.
- **The manifest has files only**: no captions (`tracks`), article bodies or quiz content, so captions do not play
  offline and an article is readable offline only if it was opened before.
- **Leaving a course** is offered for an optional, self-joined course; whether the company allows it
  (`elearning_learner_withdraw`) is not in the course's answer, so the server may refuse.
- A grader's view of an attempt carries option ids, not labels; the desktop reads them from the assessment's own
  question list (a retired question version's options may show as ids).
- On a `/desktop/v1` server, `links/resolve` does not know `worksuite://elearning/…` (`Desktop/Libraries/LinkGrammar`
  and `Links::APP_OF`), so those links open without the server's record check (the tab's own requests are still
  checked).
- The server declares no Home widgets for eLearning.

### Hotel PMS

The Hotel PMS tab uses the server's Hotel PMS API, `/api/pms/v1` (`app/Modules/Pms`, stages A, B1 and B2), the same
one the web's `/pms` pages use. Every route is behind `pms.access` (and the person needs the `pms` application); each
verb checks its own permission in the record's company and property, and a record outside the person's data scope
answers 404. `GET options?org=&property_id=` → `permissions` carries the person's `pms.*` in that company, which the
rail and the buttons follow. A refusal's `errors.code` says what to offer (`room_not_ready` with `overridable`,
`balance` with `folios`, `restricted` with `reasons`, `possible_duplicate` with `candidates`, `no_longer_available`,
`early_departure`, `over_limit`, `step_failed`, `version_conflict`…). Writes that can be pressed twice carry an
`Idempotency-Key` (a booking, a walk-in, a check-in, a check-out, a charge, a payment, a deposit, a guest, a request,
a fault).

| Screen | Calls |
|---|---|
| Shell | `GET properties`, `GET options?org=&property_id=` |
| Rack | `GET properties/{id}/rack` (the whole rack, filtered here), `POST rooms/{id}/outages {kind: blocked}`, `POST properties/{id}/maintenance`, `GET properties/{id}/in-house` (the stay behind a room's guest) |
| Lists | `GET properties/{id}/arrivals?date=`, `GET properties/{id}/departures?date=`, `GET properties/{id}/in-house`, `POST properties/{id}/assign-rooms {date}`, `GET stays/{id}/registration-card` |
| Assign a room | `GET reservation-rooms/{id}/rooms?any_type=`, `POST reservation-rooms/{id} {room_id, version, upgrade_type?, reason?}`, `POST reservations/{id}/assign` |
| Reservations | `GET properties/{id}/reservations?status=&page=`, `GET search?q=`, `GET reservations/{id}`, `POST reservations/{id}` (dates, ETA, requests, notes, with `version`), `POST reservations/{id}/status`, `POST reservations/{id}/cancel`, `GET reservations/{id}/history` |
| Deposit | `GET reservations/{id}/deposit`, `POST reservations/{id}/deposit/payments`, `POST deposits/{id}/waive\|refund`, `GET properties/{id}/folios?status=open&q=<confirmation>` then `POST reservations/{id}/deposit/apply {folio_id, amount?}` |
| New reservation | `GET availability?property_id=&arrival=&departure=&adults=&children=&rooms=&source_id=&promo_code=`, `POST properties/{id}/reservations` |
| Guests | `GET guests?q=&org=`, `POST guests/check`, `POST guests` (`client_id`, or the details with `force`), `GET guests/{id}`, `GET guests/{id}/reservations`, `POST guests/{id}/documents` (multipart), `GET guest-documents/{id}` (the file, fetched by the main process's download manager through `pms:download`), `DELETE guest-documents/{id}`, `POST guests/{id}/merge {from_guest_id, reason}`, `POST guests/{id}/identity` (a scanned ID, confirmed) |
| Check-in | `GET reservations/{id}/check-in`, `POST reservations/{id}/check-in {rooms, id_verified, guarantee_verified, override_reason, early_checkin, posting_allowed, keys, version}`, `POST stays/{id}/registration-card {document_id}` |
| Walk-in | `GET availability` (tonight), `POST properties/{id}/walk-ins {…, payment?}` |
| A stay | `GET stays/{id}`, `POST stays/{id}` (charges allowed, credit limit), `POST stays/{id}/move`, `POST stays/{id}/departure`, `POST stays/{id}/keys`, `POST stays/{id}/folios`, `POST stays/{id}/routing`, `DELETE routing-rules/{id}`, `POST stays/{id}/charges` |
| Folios | `GET folios/{id}`, `GET folios/{id}/document`, `GET properties/{id}/services`, `POST folios/{id}/charges`, `POST folio-items/{id}/void\|adjust\|transfer`, `POST folios/{id}/payments`, `POST payments/{id}/refund\|void`, `POST folios/{id}/settle\|reopen\|transfer-ar\|invoice` |
| Check-out | `GET reservations/{id}/check-out`, `POST reservations/{id}/check-out {rooms, early, late_checkout, apply_deposit, transfer_ar}` |
| Cashier | `GET properties/{id}/cashier-sessions`, `POST properties/{id}/cashier-sessions`, `GET cashier-sessions/{id}`, `POST cashier-sessions/{id}/close\|reconcile` |
| Night audit | `GET properties/{id}/night-audit`, `POST properties/{id}/night-audit/check\|run`, `GET night-audits/{id}`, `POST night-audit-blockers/{id}/override` |
| Housekeeping, rooms | `GET properties/{id}/housekeeping/tasks`, `POST properties/{id}/housekeeping/tasks` (idempotent), `POST properties/{id}/housekeeping/generate`, `GET properties/{id}/housekeeping/staff`, `GET housekeeping-tasks/{id}`, `POST housekeeping-tasks/{id}/{action}\|assign\|checklist`, `POST housekeeping-tasks/{id}/photos` (multipart, 10 MB, 12 a task; `GET …/photos/{file}` shown), `GET rooms/{id}`, `GET rooms/{id}/history`, `POST rooms/{id}/housekeeping {to, version, reason?}`, `POST outages/{id}/release` |
| Restocks | `POST housekeeping-tasks/{id}/restocks`, `POST rooms/{id}/restocks` (`{items: [{product_id, quantity, kind, chargeable}]}`, idempotent); products from Inventory's `GET /api/inventory/products/lookup?q=&org_id=` |
| Maintenance | `GET properties/{id}/maintenance?open=&category=`, `GET properties/{id}/maintenance/my`, `GET rooms/{id}/maintenance`, `POST properties/{id}/maintenance` (idempotent, `assigned_to?`, `out_of_order?`), `GET maintenance-issues/{id}`, `POST maintenance-issues/{id}/{action}`, `…/out-of-order`, `…/back-in-service`, `…/parts` (idempotent), `…/photos` (multipart) |
| Lost and found | `GET properties/{id}/lost-found?open=&due=&q=`, `POST properties/{id}/lost-found` (idempotent), `GET lost-found/{id}`, `POST lost-found/{id}/{store\|claim\|return\|dispose}`, `POST lost-found/{id}/photo` (multipart) |
| Requests, dashboard | `GET properties/{id}/requests?open=1`, `POST properties/{id}/requests`, `GET guest-requests/{id}`, `POST guest-requests/{id}/{action}` (`assign {assigned_to}` from the company directory, `GET /api/chat/directory`), `GET properties/{id}/dashboard` |
| Tape chart | `GET properties/{id}/calendar?from=&days=7\|14\|30`, `POST calendar/preview`, `POST calendar/move {…, version, reason?}` |
| Invoices | `GET properties/{id}/folios?status=settled\|transferred_ar\|closed`, `POST folios/{id}/invoice`, `GET properties/{id}/outbox?status=`, `POST outbox/{id}/retry` |
| KPIs, reports | `GET properties/{id}/kpis?from=&to=`, `GET properties/{id}/reports`, `GET properties/{id}/reports/{key}?from=&to=&room_type_id=&source_id=&rate_plan_id=`, the export `…&format=csv\|xlsx\|pdf` fetched by the main process (`pms:download`), `GET properties/{id}/room-types`, `GET properties/{id}/rate-plans` |

**Printed pages** (registration cards, receipts, invoices, statements, shift and night-audit reports) are laid out on
the desktop from the server's answers (`registration-card`, `folios/{id}/document`, the shift, the audit's `report`) and
printed through the OS dialog; the server renders none.

**Files saved on this computer.** A guest's document and a report's export go through `pms:download`
(`shared/pms-files.ts`): the page names the file (`guest-document {document}` or `report {property, report, format,
query}`), the main process builds the `/api/pms/v1` address, refuses without `desktop.downloads` (the channel's
permission, and again in the handler, so the organization's policy and the device's trust decide in the main process,
not only the screen) and hands it to the download manager, which fetches it signed in into the downloads folder and
writes `file.download {kind: pms-document|pms-report}` to the audit log. No bytes cross IPC.

**Offline.** READ_CACHE covers `options`, `properties`, and per property `rack`, `arrivals`, `departures`, `in-house`,
`business-date` and `front-desk/lists` (`shared/pms-cache.ts`). Nothing is queued: every write needs the server
(PMS-DSK-003). The server's live nudges (`pms.room`, `pms.hk_task`, `pms.request` on the realtime socket) refresh the
rack and the lists; without them they are read again every 30 seconds.

What the desktop cannot do because the server does not:

- **A reservation does not name its stays, and the rack's guest does not name their stay.** The desktop finds the stay
  in `GET properties/{id}/in-house` by reservation (room) to open a folio, post a charge, move or extend from the rack or
  a reservation. A `stays: [{id, reservation_room_id, room_number}]` on the reservation view (and `stay_id` on the
  rack's guest) would save the call.
- **Night-audit blockers come without their `link`.** `NightAudit::conditions()` builds one, `blockers()` drops it; the
  desktop derives it from `ref_type`/`ref_id` (reservation, stay, folio, cashier). A pending payment (`ref_type:
  payment`) and a night without a rate (`night`) open nothing.
- **Registration cards exist only for a stay.** FD-005's "print registration cards" for the day's arrivals before
  they arrive cannot be served; the desktop prints them for guests checked in today. The server keeps a signed card
  as an uploaded guest document; it renders no card (the desktop draws card and signature into a PNG).
- **No card payload for a key encoder.** `POST stays/{id}/keys` answers `{ok, status, message}` from the property's
  `DoorLockProvider`; a desk-side encoder has nothing to write. Keys are the server's door-lock integration.
- **Payment methods are not in `options`**; the desktop carries `PaymentMachine::METHODS` (less `deposit`).
- **Charge codes are listed only to rate managers and reservation readers** (`GET properties/{id}/services`); a cashier
  with `pms.folio.post` alone types the code.
- **A stay's move takes the reservation's `version`**, which the stay does not carry: the desktop sends none (the
  server's claim still guards it).
- **No staff list for guest requests or maintenance.** Only housekeeping has one (`housekeeping/staff`);
  `properties/{id}/staff` needs `pms.settings.manage`. The desktop offers the company directory
  (`/api/chat/directory`) and the server refuses anyone without `pms.guest_request.manage` / `pms.maintenance.manage` at
  the property, in its own words. A `GET properties/{id}/requests/staff` and `…/maintenance/staff` (who may take it,
  with their open work) would let the picker offer only those.
- **An `assign` move says it needs nobody.** `GuestRequestMachine` and `MaintenanceMachine` guard `assignee` but list
  `needs: []`, and a lost item's `claim` guards `claimant` the same way; the desktop knows to ask for a person or a
  claimant. The options' labels are the target state's ("Assigned", "Cancelled"), not the verb.
- **No PMS product lookup.** Restocks and parts name Inventory products; `/api/pms/v1` has no product list (the mobile
  gateway has `pms/properties/{id}/products`), so the desktop uses Inventory's own lookup, which needs Inventory
  (`inventory.view`). An attendant without Inventory cannot record a restock from the desktop.
- **Folios cannot be listed by reservation.** Applying a deposit asks `properties/{id}/folios?q=<confirmation>` and
  keeps the reservation's own; a `reservation_id` filter would say it exactly.
- **The billing outbox is `pms.settings.manage`'s only**; finance staff who follow Billing hand-offs cannot see it.
- **A new housekeeping task names a room from the rack**; a supervisor without any rack permission has no room list to
  choose from (`properties/{id}/rooms` is the back office's).
- **Check-out needs `pms.folio.view`** besides `pms.checkout` (`StaysController::checkOutScreen`).
- On a `/desktop/v1` server, `links/resolve` does not know `worksuite://pms/…` (`Desktop/Libraries/LinkGrammar`,
  `Links::APP_OF`): those links open without the server's record check (the tab's own requests are still checked).

### PDF Studio

PDF Studio (stage D1, the viewer) uses the server's existing PDF and Drive routes. Editing (stage D2) uses the
server's PDF Studio API (`app/Modules/Pdf`); on a server without it (`/pdf/sessions` answers a plain 404) a Drive PDF
opens read-only as in D1, and local files are still edited and saved in place.

| For (D2) | Calls |
|---|---|
| A session | `POST /api/files/{id}/pdf/sessions {mode, client_type, device_id, device_name, lock_type?, takeover?}` → `session`, `mode`, `available_modes`, `permissions`, `lock`, `policy.autosave_interval_s`, `timeouts`, `content.url` (`/pdf/content/{token}`, fetched without the bearer token) |
| Keeping it | `POST …/pdf/sessions/{sid}/heartbeat {active}` → `lock_lost`, `downgraded`; `POST …/mode {mode, takeover?}`; `DELETE …/pdf/sessions/{sid}` when the tab closes |
| Saving | `POST /api/files/{id}/pdf/uploads {size, sha256, chunk_size, session_id}`, `PUT …/uploads/{uid}/chunks/{n}` (header `X-Chunk-Sha256`), then `POST /api/files/{id}/pdf/save {upload_id, mode: new_version\|copy, base_version, session_id, summary, client_type, device_id, offline, edited_at, resolution?, name?, note?}` |
| Refusals | `{status:'error', message, errors:{code…}}`: `409 PDF_VERSION_CONFLICT` (`server_version`, `saved_by`, `saved_at`, actions) → the conflict dialog; `409 PDF_FILE_LOCKED` (`lock`, `take_over`) → Take over; `PDF_UPLOAD_INVALID` → the chunk is sent again |

Documents from other modules open through `transfers:download` with `open: true`; two sources are new:
`chatMedia` (a chat attachment's `download_url`, `/media/{token}?download=1`) and `taskAttachment`
(`POST /api/tasks/{task}/attachments/{id}/link` → `url` ending `/d/{token}`, fetched as `/d/{token}`).

| For | Calls |
|---|---|
| Opening a Drive PDF | `GET /api/pdf/{id}/status` first (PdfAccess "open": 404 when the file cannot be seen; its `file.version`, `lock`, `versions`, `timeline` feed the title bar and the Review panel), then `GET /api/files/{id}/download` streamed into a sealed working copy |
| A file shared to view only | `/download` answers 403: `GET /api/drive/preview/{id}` → its `url` (`/media/<token>`, the viewer's own signed address) instead; print and download are then off |
| A mail attachment | `GET /api/mail/messages/{uid}/attachments/{ref}?folder=&dl=1&mailbox=` (preview only) |
| Download | `transfers:download` (`fileId`, or the mail attachment's parts), as before |
| PDF Diagnostics | `GET /api/pdf/capabilities` (the server's PDF service answering) |

The organisation's PDF Studio policies (§21.2: print, copy, export, external links, local files, Max PDF Size) are
checked by the desktop but read defaults (everything on, links confirmed, 2 GB) until the server's PDF Studio
service (stage S) sends them; stage D2 wires them (`DesktopPdfService`'s `policy()`). Opening
and printing are audited on the desktop (`pdf.opened`, `pdf.printed`: source, file id, version, pages) and sent to
`/desktop/v1/audit` where the server offers it.

### WorkSuite Events — the Event Desk

The Events tab uses the server's Events API, `/api/events/v1` (`app/Modules/EventManager`, stages A, B1 and B2), the
same one the web's `/events` pages use. Every route is behind `events.access` (and the person needs the `events`
application); each verb checks its own permission in the event's company and at the event, and a record outside the
person's data scope answers 404 (403 when seen but not permitted). `GET options?org=` → `permissions` carries the
person's `events.*` in that company, which the rail and the buttons follow. A refusal's `errors.code` says what to
offer (`confirm` → the reprint's reason, `already_queued` → print the waiting job, `device_revoked` + `wipe` → wipe,
`device_suspended`, `device_untrusted`, `device_key_missing`, `offline_off`, `not_inside`, `walkins_off`…).

| Screen | Calls |
|---|---|
| Events, the shell | `GET events?per_page=&sort=`, `GET events/{id}`, `GET options?org=` |
| This computer (main process) | `POST events/{id}/devices {name, gate_id, device_ref_type: desktop, device_ref_id: <sync device id>, platform, app_version}` → the key, once; `POST devices/{id}/key`; `POST devices/{id}/heartbeat {app_version, queue_size}`; `GET events/{id}/gates`, `GET events/{id}/devices` (read) |
| Offline (main process) | `GET events/{id}/checkin/bootstrap?device_id=&after_id=&limit=` (pages of 2,000), `GET …/checkin/changes?device_id=&after=` (every 15 s), `POST …/checkin/sync {device_id, batch_uuid, cursor, queue_size, items}` |
| The desk (main process) | `POST events/{id}/scan`, `/check-in`, `/check-out` `{code \| registration_id, gate_id, device_id, client_uuid}` — a fresh `client_uuid` each; six seconds before the desk answers from its copy |
| Search, walk-in, payment | `GET events/{id}/checkin/search?q=`, `GET events/{id}/ticket-types`, `GET events/{id}/form`, `GET options/live`, `POST events/{id}/walk-ins` (+ `Idempotency-Key`), `GET registrations/{id}/payment`, `POST registrations/{id}/payment/take` (+ `Idempotency-Key`) |
| Counters, recent, review | `GET events/{id}/checkin/summary` (every 10 s), `GET …/checkin/recent?device_id=`, `GET …/checkin/reconciliation?status=`, `POST reconciliation/{id}/resolve\|dismiss` |
| Badges | `POST registrations/{id}/badge/print {device_id, printer, reason, confirm}`, `GET events/{id}/badge-prints/sheet?ids=` (printed by the main process), `POST badge-prints/{id}/printed\|failed\|dispatch\|retry\|cancel`, `GET events/{id}/badge-prints?status=&printer=`, `POST events/{id}/badge-prints/bulk`, `GET events/{id}/badge-templates`, `GET registrations/{id}/badge/prints` |
| Program, session doors | `GET events/{id}/sessions`, `GET events/{id}/checkin/sessions`, `POST events/{id}/checkin/sessions/{sid}`, `GET sessions/{id}/registrations` |
| Event 360, people | `GET events/{id}/overview`, `GET events/{id}/dashboard?mode=auto`, `GET events/{id}/registrations?list=&q=&page=`, `GET registrations/{id}`, `GET attendees?org=&q=`, `GET attendees/{id}` |
| Emergency message | `GET events/{id}/screens/overrides?open=1`, `POST events/{id}/screens/override {message, targets: ALL, confirmation}`, `POST screen-overrides/{id}/clear {reason}` |

**Offline.** READ_CACHE keeps `options`, the events list, the event and its gates (`shared/event-desk.ts:
eventsCached`), so a desk opened with the line down knows what the person may do there; the desk's own copy of the
gate's tickets and its queue are the main process's (below). Everything else waits for WorkSuite.

**The key and the copy.** Registering, a new key, the heartbeat, the bootstrap, the changes and the upload are the
main process's (the API proxy refuses them to pages): the key the server hands over is kept in the OS credential
store, the copy and the queue encrypted in the profile. A scanned QR is matched against the copy by
`HMAC-SHA256(text trimmed and in capitals, key)` in the main process, and judged with the server's `ScanRules`
(`shared/event-desk.ts`, the same order and sentences). A PUBLISHED event past its start is taken as LIVE offline, as
the server's sweep makes it every minute. `device_sequence` is one more than the last and never below the clock in
milliseconds, so a counter that restarted is not taken for old scans.

What the desktop cannot do because the server does not:

- **A check-in agent needs `events.event.view`.** Every check-in route first asks whether the person sees the event
  (`EventManagerController::sees()`, `events.event.view`), and `GET events` lists only those events: SRS §18.1's
  Check-In Agent (`checkin.use`, `checkout.use`, `walkin.create`, `badge.print`) without it gets 404 everywhere. Give
  desk staff the event view, or make `sees()` accept `events.checkin.use` at the event.
- **A desktop device needs the Desktop module on the server.** Registering checks `desktop_devices` by
  `sync_device_id`; on a server without it (the existing API only) the server refuses ("WorkSuite Desktop's device
  registry is not installed here").
- **Badges carry no pictures.** The badge page names the logo and the attendee's photo by Files id
  (`data-file-id`) with no image: the event's name prints in the logo's place and no photo prints. A data URI (or an
  address the desk may read) in `Badges::html()` would print them. A sheet of several templates is laid out at the
  first one's size (`@page`).
- **Photo verification** sends a Files id; the only address for it is the owner's download (`files/{id}/download`).
  The desk shows the photo where that answers and says "not readable here" otherwise.
- **The scans a person made offline go up as theirs only.** `checkin/sync` records whoever syncs as `recorded_by`,
  with no per-item scanner, so the desk keeps each person's queue for them: after a shift change it waits until they
  sign in at the desk again. A `scanned_by` per item (checked against the device's staff) would let it go at once.
- **Switching offline check-in off also refuses the upload** (`offline_off` on `checkin/sync`): scans made offline
  before that wait until it is on again.
- **The offline copy has no registration form**, so a walk-in kept offline carries the standard fields (name, email,
  phone, company); a form with other required fields or consents makes the server queue it as
  `PROVISIONAL_WALK_IN` for review.
- **Offline, a ticket of another gate is "not in this gate's copy"**, where online it is `ACCESS_DENIED` with the
  gates that admit it (the copy holds the gate's tickets only, by design).
- **No desk PIN** (EV-POR-013 "may require a PIN to leave the locked view"): the server keeps none; the desk's full
  screen is left with Esc, as any other.
- **Session doors, the counters, recent scans and review are online only**: the server has no offline copy for them.
- On a `/desktop/v1` server, `links/resolve` does not know `worksuite://events/…` (`Desktop/Libraries/LinkGrammar`,
  `Links::APP_OF`): those links open without the server's record check (the tab's own requests are still checked).

### POS — the till

The POS tab makes this computer a till of WorkSuite's POS (`app/Modules/Pos`, its `README.md`). It uses the staff API
(`/api/pos`, the signed-in person's session, the same one the web's POS pages use — `pos.access` and the per-verb
permissions) for the drawer, what the till sells and the cart's price, and the till's own door (`/api/pos/device/*`,
the till's `wsp_` credential from `Pos\Libraries\DeviceAuth`, no session) for its sales, the catalogue in the
background, and refunds, voids, receipts and e-mail of its own sales. The mobile POS API (`/api/mobile/v1/pos/*`) is
not reachable: its `mobile` filter takes only mobile access tokens (`aud=mobile`), so a desktop token is refused there.

| Need | Calls |
|---|---|
| Pairing (main process) | `GET api/pos/setup` → `{terminals: [{id, code, name, org_id, org_name, branch_name, warehouse_id, warehouse_name, in_use, device_name}]}`; `POST api/pos/terminals/{id}/pair {device_name, device_info, app_version, take_over}` → `{token, expires_at, terminal}` (409 `in_use` without `take_over`) |
| The till's door (main process, till credential) | `POST api/pos/device/heartbeat {app_version, pending_count}` every minute → `{terminal, server_time}`; `POST api/pos/device/sales {sales: [...]}`, at most 25 → `{results: [{ref, status: created\|duplicate\|rejected, number, message, code?, total?, review?, flags?}]}` (`code`: `drawer_closed`, `session_not_here`; `flags`: `price_differs`, `payment_missing`, `late`); 401 `reauth` → pair again, 503 → POS off, wait (the server's sentence shown; without one, "an administrator turns it on in Admin Centre → Apps → POS") |
| Shell and shift | `GET api/pos/options` (`capabilities`, incl. `drawer_required`, `late_sales`, `payment_missing`, `flags`; per company `can` — incl. `refund`, `void`, `discount`, `discount_override`, `max_discount_pct` — and `rules {count_to_close, blind_close, variance_tolerance}`), `GET api/pos/registers`, `GET api/pos/sessions/{id}`, `POST api/pos/sessions {register_id, opening_float, denominations?, note?}`, `POST api/pos/sessions/{id}/cash {direction, amount, reason, reference?}`, `POST api/pos/sessions/{id}/close {denominations? \| counted_cash, variance_reason?}` — READ_CACHE keeps `options`, `registers`, `sessions` and `setup` |
| Catalogue | In the background (main process, till credential, every 30 min, nobody need be signed in): `GET api/pos/device/catalogue?since_version=`; on request (the person's session): `GET api/pos/catalogue?org=&since_version=` — `{version, unchanged: true}` when current. Only where `capabilities.catalogue` is false or the call answers 404 (an older server): Inventory's `GET api/inventory/products?page=&per_page=100&include_variants=1` (needs `inventory.view`) |
| The cart's price | `POST api/pos/price {org_id, lines: [{product_id, quantity}], discount_pct}` (`pos.sale.create`, the discount the person's to give) where `capabilities.price`; on an older server `GET api/inventory/price?product_id=&qty=&kind=sell` per line; otherwise the catalogue's preview (marked provisional) |
| A code not in the catalogue | `GET api/pos/products/lookup?org=&code=` where `capabilities.lookup`; on an older server `GET api/inventory/products/lookup?q=` (exact match) |
| Refund, void (main process, till credential) | `POST api/pos/device/sales/{ref}/refund {ref: <receipt>-R<n>, cashier_id, reason, lines?: [{product_id, quantity}], restock?}`, `POST …/void {ref: <receipt>-V, cashier_id, reason}` → `{refund: {ref, kind, amount, cash_out, tenders, lines, credit_note, …}, sale}` (201; 200 when the same `ref` was had) — where `capabilities.refund` / `.void` and `can.refund` / `.void` |
| Receipt, e-mail (main process, till credential) | `GET api/pos/device/sales/{ref}/receipt` → `{receipt}` (`Receipt::data`, with `payment_missing` and `status: payment_missing`, printed as a "Payment missing" line) for a reprint, where `capabilities.receipt`; `POST api/pos/device/sales/{ref}/email {email?}` where `capabilities.email_receipt` |

**A sale as the till sends it** (`electron/services/pos-outbox.ts: saleBody`): `ref` (the receipt number,
`<TILL CODE>-<6 hex per pairing>-<000001>`), `date`, `currency`, `paid: true`, `customer {name?, phone?, email?}`,
`lines [{description, sku, product_id, quantity, unit_price, discount_pct, tax_rate, net, tax, total}]`, `subtotal`,
`discount`, `tax`, `total`, `cashier_id`, `note`, `session_id`, `register_id`, `tenders [{method, amount, reference?}]`,
`change_given`, `offline` (priced from the catalogue, WorkSuite out of reach), `expected_total`, `catalogue_version`.
WorkSuite prices it again from `product_id` and records it in the named session's drawer; a total that differs is
answered as `total` with a `review` note, kept on the sale and shown in Sales. A sale refused while the cashier waits is
removed from the till (nothing was sold); one refused later stays with the reason, to send again or drop.

**No drawer, no sale** (`Pos\Libraries\Sales::admit`). WorkSuite takes a sale only into an open register session; the
register screen starts none without one open at this till (a pick or a scan says to open the register; the cart shows
the way there). A sale that names this till's session after it closed is still taken when its `date` falls in that
session's open window — sold offline while the drawer was open — flagged `late`; the closed count is not rewritten.
Otherwise it is `rejected` with `code: drawer_closed` (or `session_not_here`, the session another till's) and kept with
that code and the sentence; *Send again* sends it into the register open now (`pos:resolve {session_id}`, the sale's
`session_id` changed on this computer) and is not offered without one; *Drop* removes it. The till always sends
tenders, so its own sales are never `payment_missing`; a sale flagged so on the server (a till that sent none) shows
the flag and prints "Payment missing". Sales history shows each sale's `flags` and filters them as the web's `review`
filter does (all, to review, price differs, payment missing, late) — from the till's own record.

What the desktop asked of the server, now there (`claude/sweet-hamilton-46vqu8`):

- ~~Capabilities in `GET api/pos/options`~~ — done: `capabilities {catalogue, price, lookup, device_catalogue, sales,
  receipt, email, email_receipt, refund, void, settle, reprice, discount_rights, review, drawer_required, late_sales,
  payment_missing, flags, customer_display}`.
- ~~Catalogue, price and lookup on the staff API and the device door~~ — done; a cashier needs no Inventory
  permission.
- ~~Device sales that are real sales~~ — done: priced again, into the session's drawer, stock, payment and Finance;
  `expected_total` / `review`.
- ~~Refund, void, e-mail~~ — done, on the staff API (by order id) and the device door (by receipt number, the cashier
  named); the till uses the door for its own sales.
- ~~Receipt data~~ — done: `sales/{id}/receipt`, `device/sales/{ref}/receipt` (JSON, or `?format=html&paper=`).
- ~~Discount rights~~ — done: `can.discount`, `can.discount_override`, `can.max_discount_pct` (null no ceiling, 0 none).
  The super-administrator-only stand-in is gone: a server that does not say offers no discount.
- ~~Close rules~~ — done: `rules {count_to_close, blind_close, variance_tolerance}`.

Still open:

- On a `/desktop/v1` server, `links/resolve` does not know `worksuite://pos` or `worksuite://pos/sales/{ref}`.
- The till's history is its own record (90 days); `GET api/pos/sales?review=` (other tills', the server's review queue)
  is not shown yet — the till filters its own sales by their flags.

### Restaurant Manager — till, kitchen screen, print agent

The Restaurant tab uses the server's Restaurant API, `/api/restaurant/v1` (`app/Modules/Restaurant`, stages A, B1 and
B2 — the contract the module's README and `web-api-b1.md` / `web-api-b2.md` describe), the same one the web back
office uses. Every route is behind `restaurant.access` (and the person needs the `restaurant` application); each verb
checks its own permission in the company, and a record outside the person's data scope answers 404. `GET options?org=`
→ `can` carries the person's `restaurant.*` in that company as `order_create`, `kitchen_manage`…, which the rail and the
buttons follow. Every call names the company (`?org=`) the terminal was paired in. A refusal's `errors.code` says what
to offer (`version_conflict` → refresh, `approval_required` / `approval_needed` with `errors.approval` → ask for the
approval, `key_reused`, `in_progress`, `terminal`).

This computer is one of the branch's **terminals**: the key `POST terminals/{id}/pair` hands over is kept by the main
process and sent as `X-Terminal-Key` on every Restaurant call (the API proxy adds it to the screens' calls), so the
server knows which till sent an order, which station a kitchen screen is and which printers this computer hosts.

| Screen | Calls |
|---|---|
| Pairing (main process) | `GET structure?org=&branch_id=` (the terminal read back), `POST terminals/{id}/pair` → `device_key` (`rt_` + 48 hex), once; `POST terminals/{id}/revoke` on unpair when asked |
| The shell | `GET options?org=`, `GET pos?branch_id=` (the terminal, business date, the person's cashier session, the till's policy: tenders, `offline_actions`) |
| Floor | `GET floor?branch_id=`; `POST floor/tables/{id}/seat\|open\|free\|request-bill {…, version}`; `POST floor/sessions/{id}/move\|merge\|split {…, versions}`; `POST tables/{id}/clean\|unblock {version}` |
| Order | `GET menu/branch/{branch}?channel=` (a combo's `combo.components`); `POST orders {branch_id, order_type, uuid, lines, send}` (a combo line carries `combo: [{component_id, item_id, variant_id?}]` for its choice components); `GET orders/{id}`; `POST orders/{id}/items {lines, send, version}`; `POST orders/{id}/send\|fire\|hold\|serve\|print-kot`; `POST orders/{id}/items/{line}/void {reason, qty, version, approval_id?}` |
| Discounts, comps, price overrides | `POST adjustments/discount {order_id, order_item_id?, pct\|amount, reason, terminal_id, approval_id?}` (`restaurant.discount.apply`), `POST adjustments/comp {order_item_id, reason, approval_id?}` (`restaurant.comp`), `POST adjustments/price {order_item_id, unit_price, reason, approval_id?}` (`restaurant.price.override`); above the limit 403 `approval_needed` with `approval` → ask, then the same again with `approval_id`; `GET adjustments?order_id=` (for `payment.process`, `report.view` or `cashier.close`), `POST adjustments/{id}/remove {reason}` before anything is paid |
| Approvals | `POST approvals {branch_id, action, amount, pct, reason, subject_type, subject_id, order_id, terminal_id}`; `GET approvals/{id}` (every 3 s); `POST approvals/{id}/approve {pin}` (the approver's PIN at the till); `GET approvals`, `POST approvals/{id}/approve\|reject` |
| Bill | `GET bills/preview?order_id=`; `POST bills {order_id, mode: single\|seat\|item\|equal\|amount, count, amounts, parts}`; `POST bills/{id}/present\|void`; `POST bills/{id}/print` (`queued: false` → the returned `document.text` printed here); `POST bills/{id}/payments {tenders, terminal_id, version}` + `Idempotency-Key` (kept for every retry of one attempt) → `change_given`, `open_drawer`; `GET payments?order_id=`, `POST payments/{id}/refund {amount, reason, method, terminal_id, approval_id?}` + `Idempotency-Key` (kept until answered; `restaurant.refund`) → `open_drawer`; `POST bills/{id}/invoice {client_id?}` (a whole-order bill; the customer from `GET customers?q=`) |
| Host stand | `GET reservations?branch_id=&date=`, `GET reservations/timeline?branch_id=&date=`, `GET reservations/availability?branch_id=&date=&time=&guests=` (free tables, or `suggestions`), `POST reservations {branch_id, date, time, guests, name, phone, occasion, special_requests, table_id?, source: phone, uuid}`, `POST reservations/{id}/confirm\|arrive\|seat\|cancel\|no_show {version, table_id, guests, table_version, reason}` as the booking's `choices` offer them (`reservation.view` / `reservation.manage`) |
| Cashier | `GET cashier-sessions/mine`, `GET cashier-sessions/{id}` (X / Z report), `POST cashier-sessions {branch_id, terminal_id, pos_register_id, opening_float}`, `POST …/{id}/cash {direction, amount, reason, approval_id?}`, `POST …/{id}/no-sale {reason}`, `POST …/{id}/start_close`, `POST …/{id}/close {counted_cash, reason, approval_id?}` |
| Kitchen | `GET kitchen?branch_id=&station_id=` (the terminal's station by default), `GET kitchen/expo?branch_id=`, `POST kitchen/tickets/{id}/accept\|start\|bump\|recall\|serve\|print {version}`, `POST kitchen/tickets/{id}/items/{item}/done\|undo {version}` |
| Live | `restaurant.live {seq, branch_id, entity, id, version, kind}` on the realtime socket (`Live::emit` → the gateway, fanned out as `realtime:event`): the screens refresh what the entity touches at once; behind it `GET live?branch_id=&after=&limit=` every 3–10 s while a screen shows (every 30 s while the socket is connected), from the heartbeat's `last_seq`; `reload` → everything refreshed |
| Print agent (main process) | `POST print-jobs/claim {printer_ids, limit}` every 4 s for the printers mapped here, `POST print-jobs/{id}/printed\|failed {error}`; screens: `GET print-jobs?branch_id=`, `POST print-jobs/{id}/reprint` |
| Offline (main process) | `POST sync {branch_id, ops: [{op: create_order\|add_items\|send, client_ref, data}]}` + `Idempotency-Key` per batch; `POST sync/heartbeat {queue_size, app_version, online, last_sync_at, printers}` every 30 s; the copy: `GET pos`, `GET floor`, `GET menu/branch/{id}` (every 5 min) |
| Conflicts | `GET sync/conflicts?branch_id=&status=open`, `POST sync/conflicts/{id}/resolve {action: attach\|dismiss, table_id, guests, note}` (for `restaurant.order.cancel`) |

What the desktop cannot do because the server does not:

- **No offline payment by order.** The server's `sync` answers `cash_payment` with `elsewhere` ("play it back to the
  payments route"), but a payment needs a bill id, and an order made offline has none until it is billed online. The
  till therefore queues orders, lines and sends only; money waits for WorkSuite. An op that bills and pays an order
  by its uuid (or `POST bills` accepting `order_uuid`) would let a cash takeaway be settled offline.
- **The offline queue runs as the person, not the terminal.** `POST sync` needs `restaurant.order.create` and records
  the signed-in person, so each person's queue waits for them (a shift change leaves it until they sign in again).
- **A terminal cannot ask who it is.** There is no `GET terminals/me` by key: pairing reads the terminal from
  `structure` first, and a station or mode changed later in the back office is seen only when paired again.
  Re-pairing a terminal rotates its key and silently stops the computer that had it.
- **A kitchen screen's cook needs `pos.access` for `GET pos`** (it is `pos.access` or `order.create`); without it the
  till's context (business date, cashier session) is simply not shown there.
- **Kitchen tickets are plain text.** The print job carries `text` (32 columns) and the fields; the agent prints the
  text. §13.2's large type needs either an ESC/POS rendering from the server or the agent laying out the fields
  (a later step). A 58 mm roll is sent the same 32 columns.
- **Heartbeat printer states** are `online`, `offline`, `error`, `paper_out`; the agent reports `online` or `error`
  (it cannot tell paper out from other failures through the OS spooler).
- **A push does not say what the screen needs.** `restaurant.live` names the entity and id only, so the screen reads
  the record again; the push's `payload` is empty for most entities.
- **A tax invoice needs a CRM customer.** `bills/{id}/invoice` refuses without `client_id` unless the order has one;
  the till looks the customer up (`GET customers?q=`) — adding a new one stays with `POST customers`
  (`restaurant.customer.manage`), which the till does not offer yet.
- **Combo components with modifiers.** A choice component's pick may carry `modifiers`; the till sends the pick
  only, so a component whose item has a required modifier group is refused by the server in its own words.
- **Refunds go back to the tender they came from.** Another method needs a manager on the server; the till always
  sends the payment's own `method`.

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

## Office documents

The Office tab and Files use the server's Office API (`app/Modules/EuroOffice`, on Drive's paths); the full client
contract is kept with the server work (`office_docs/web-api.md`). Everything is decided there — the mode, what the
person may do (`permissions`), what saving has reached — and every refusal's `errors.code` says what to offer.

| Need | Calls |
|---|---|
| Open, reload, renew | `POST /api/files/{id}/office/session {client_type: DESKTOP_WIN\|DESKTOP_MAC\|DESKTOP_LINUX, layout: desktop, lang, mode_requested?}`, `GET …/office/config?session_id=&lang=&layout=` (a `replaced_session_id` means a new session on the new key) |
| Keep alive, mode, close | `POST …/office/session/{sid}/heartbeat {ready_ms?}` every `heartbeat_interval_s`, `POST …/office/session/{sid}/mode {mode}`, `DELETE …/office/session/{sid}?reason=CLOSED\|ORG_SWITCH` |
| Saving | `POST …/office/force-save {session_id, version_label?, description?}` (closing a tab; Save as version), `POST …/office/save/retry`; the save status comes in the bootstrap and every heartbeat |
| Collaboration | presence in the heartbeat; `POST/DELETE …/office/lock` (keep to myself / release); `GET …/office/mentionable?q=`, `POST …/office/mentions {emails, action_link}` (never comment text); rename with Drive's `PUT /api/files/{id} {name}` then `POST …/office/meta` |
| Routing, menus | `GET /api/files/office/types?org_id=` (READ_CACHE, `files`), `GET …/office/actions?client_type=` |
| New, templates | `GET /api/files/office/templates`, `POST /api/files/office/new {type\|template_id, folder_id}` |
| Export, convert | `POST …/office/export {target_format: pdf, destination: DOWNLOAD\|DRIVE}` — a download's `download_url` is fetched by its token as `/office/exports/{token}` from the configured server through the download manager (`transfers:download` with `officeExport`); `POST …/office/convert-legacy` |
| Versions | Drive's `GET /api/files/{id}/versions`, `POST …/versions/{row}/restore`, `GET …/versions/{row}/download` |
| An edited copy back | `POST /api/files/{id}/versions` (multipart `file`, `base_version`) from the main process; `409 OFFICE_VERSION_CONFLICT` with `base_version`, `server_version`, `actions`. Keep Both goes up through the upload manager as a new file |

Realtime `office.*` events about an open document only trigger its heartbeat early; nothing is patched from them.

What the desktop cannot do because the server does not (yet):

- **The editor's @mention list is empty unless the editor sends what was typed.** `…/office/mentionable` answers
  nothing under two characters, and ONLYOFFICE's `onRequestUsers` asks for the whole list without a search term (only
  editors that search as you type send one). Mentions typed as an address still notify through `…/office/mentions`.
  An empty term answering the people who can open the file (bounded) would fill the list.
- **The bootstrap's `file` has no folder or company.** The tab is bound to the company chosen when it opened (not the
  file's own), and a Keep Both copy made from the Office tab lands at the top of My Drive rather than beside the
  original (from Files it goes beside it). `file.folder_id` and `file.organization_id` in the bootstrap would fix both.
- **Only the multipart version upload checks `base_version`.** The chunked uploader (`/api/uploads/*` with
  `replace_file_id`) does not, so an edited copy larger than the server's single-request upload limit cannot go back
  with the conflict check; the desktop reports the server's refusal instead of falling back to an unchecked replace.
- **`save_as_copy` and `download_working_copy`** are listed in a failed save's `actions` but have no route; the desktop
  offers Retry only.
- **`/api/files/office/types` answers one company's settings** (the chosen one, or the person's first): a Drive list
  spanning companies is routed by those defaults; each file's menu asks `…/office/actions`, which is exact.
- **No link opens a document in the desktop.** The web's "Open in Desktop App" has no `worksuite://` form for an
  Office file, and `links/resolve` (`Desktop/Libraries/LinkGrammar`) knows none.

## Not provided yet

- `monitoring_policy` is always `null`, and every `feature_flags` entry is
  false: monitoring, kiosk and AI are later phases. Drive sync is governed
  by `file_sync`, `personal_device_mode`, `removable_media_sync` and
  `wipe_on_revoke` in the desktop policy, and the sync policy
  (`/api/sync/policy`) for sizes, types and ignore patterns.
- Permissions are the same in every company: WorkSuite grants them
  installation-wide, so switching organizations reloads them but they do not
  change.
