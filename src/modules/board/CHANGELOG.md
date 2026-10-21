# board — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.0.0 — 2026-10-21

- WorkSuite Board on the desktop (SRS-BOARD-001 v1.2 §13.2 D-01..D-13, §5.26 FR-DX, §5.22 / §5.27.6 offline and
  devices) over `/api/board`, app id `board`, route `/board?view=…`, with its own 220px rail. Built to the server's
  contract (worksuite `docs/board/API.md`, Board module 1.0.0): every path, body, shape and error code below is the
  server's.

**Added**

- D-01 Home from `GET /dashboard` (`tabs`, `upcoming` with `flags{new,amended}`, `whats_new`, `pending_decisions`,
  `actions`, `calendar`); permissions from `GET /meta` `can{}`; Director brief (`POST /ai/brief {meeting_id}`:
  decision items, high-risk items, pending actions, suggested questions).
- D-02 Agenda (`GET /meetings/{id}/agenda`, nested items flattened, withheld items as the server's placeholder) with
  papers, my notes, comment count, last seen and flags; AI Summary (`POST /ai/summarize {paper_id}`), Actions, Notes
  drawers; my attendance (`POST /meetings/{id}/attendance {state: ACCEPTED|REMOTE|EXCUSED|DECLINED}`), location,
  online link, organiser, chair, quorum label; participants with their attendance state and item-only access.
- D-03 calendar (`GET /meetings?from=&to=`), filtered by board or committee; D-04 item comments
  (`GET|POST /meetings/{id}/comments`, `agenda_item_id`, `audience: ALL|SPECIFIC|PRIVATE`, `shared_with`, 2,000
  characters) beside the AI summary.
- D-05 Board packs offline, in the main process's encrypted vault (`electron/services/board-vault.ts`, AES-256-GCM
  under a per-person key in the OS credential store, files bound to their names). This computer registers as a
  Board device (`POST /devices {device_uid, name, platform, public_key}`, the raw Ed25519 key, base64) and names
  itself on every Board request (`X-Board-Device`). A pack is the signed grant (`POST /offline/grants
  {board_meeting_id, device_uid}`), the agenda and my notes taken with it, and the member's rendition
  (`GET /packs/versions/{id}/file?member=me`); it expires at the grant's `expires_at`; sync re-reads the grant
  (`GET /offline/manifest/{grantId}`) and flags a newer pack version. A device waiting for approval says so.
- Revocation and blocking (FR-DEV-02/03): `POST /devices/check-in` answering `WIPE`, or `403 {errors: {code:
  device_blocked|device_revoked, command: WIPE}}` on any Board call, erase the vault folder and its keys only —
  never personal files — and the wipe is reported with `POST /devices/{id}/wiped {result, grants}`; `PURGE_GRANTS`
  erases just the meetings named.
- Offline queue (FR-OFF-02): annotations through `POST /annotations/sync` (last writer wins by `client_uuid` and
  `updated_at`), acknowledgements through `POST /packs/versions/{id}/acknowledge`.
- Offline circular responses (FR-VOT-08, FR-CIR-05): the open circulars that allow it (`GET /circulars?tab=open`,
  `allow_offline`) are kept at each sync; a response before the deadline is signed when recorded over the server's
  canonical JSON (`{"circular_id","comment","device_signed_at","response","user_id"}`, keys sorted, comment trimmed
  or null) and uploaded to `POST /circulars/{id}/offline-responses {responses:[{device_uid, response, comment,
  device_signed_at, signature, client_uuid}]}`; the server's ACCEPTED / REJECTED and its reason are shown. Others'
  responses only after mine, never on a secret circular.
- D-06 annotations (`GET|POST /annotations`, kinds and `PRIVATE|SELECTED|COMMITTEE|SECRETARY|EVERYONE`, the quote as
  the anchor), mine / shared, detached notes re-saved against the paper's current version, export; the reader with
  each paper's exact version (`GET /papers/versions/{id}/file`) or the vault's rendition, and acknowledge pack.
- D-07 search (`GET /search`, the server's `[[term]]` highlights; offline in kept packs).
- D-08 approvals (`GET /approvals?box=waiting`, kinds PAPER, MINUTES, CIRCULAR, SIGNATURE, AGENDA, PACK) decided
  through `POST /approvals/{id}/decide`; signing minutes with a drawn signature or an acknowledgement over the
  minutes' SHA-256, Touch ID where the OS offers it, and the server's step-up (428 → password) when it asks; circular
  responses (`POST /circulars/{id}/respond {response, comment}`, signed ones with the signing body).
- D-09 my actions (`GET /actions?owner=me`, `PATCH /actions/{id} {status}`), D-10 archive (`GET /archive`) with the
  integrity check (`POST /integrity/check`).
- D-12 live room: present items (`POST /meetings/{id}/present {agenda_item_id, page}`), the quorum, the resolution on
  the floor (`GET /resolutions?meeting_id=`), votes (`GET /votes?meeting_id=`, `POST /votes`, `/open`, `/cast
  {choice: FOR|AGAINST|ABSTAIN…}`, `/close`) that cannot open without quorum, the chair's casting vote on a tie
  (`409 casting_vote_required`, then `/close {casting_choice}`), secret or open tally, the member's ballot online
  only with the step-up when the board asks. Realtime frames `{type: "board.realtime", channel:
  "board.meeting.{id}", event, seq, data}` from the per-person gateway, and `GET /meetings/{id}/events?after={seq}`
  replayed every few seconds (reconnect, or where the gateway is off).
- D-13 live minutes (`GET|POST /meetings/{id}/minutes`, `PUT /minutes/{id}/autosave {blocks, client_rev}`,
  `POST /minutes/{id} {blocks}`, `GET /minutes/{id}/versions`, compare by `seq`), the secretary's blocks beside the
  read-only record blocks, and non-binding polls (`POST /meetings/{id}/polls`, `/polls/{id}/close`,
  `/insert-minutes`).
- `worksuite://board[/meetings/:id[/room]|/circulars/:id]` deep links, the launcher tile, and the Board notification
  keys (`board.meeting.published|updated|cancelled`, `board.pack.*`, `board.vote.opened|closing`, `board.circular.*`,
  `board.approval.requested`, `board.minutes.review`, `board.action.*`, …) opening their screen by `board_meeting_id`
  / `circular_id`.

**Not on the desktop (the server has no route for it)**

- Sending a meeting notice and per-member delivery status (D-11): Board tells participants itself on publish; there
  is no notices endpoint to call.
- A progress note on an action: `PATCH /actions/{id}` takes the status only.
