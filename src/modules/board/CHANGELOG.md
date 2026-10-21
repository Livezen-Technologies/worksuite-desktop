# board — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.0.0 — 2026-10-21

- WorkSuite Board on the desktop (SRS-BOARD-001 v1.2 §13.2 D-01..D-13, §5.26 FR-DX, §5.22 / §5.27.6 offline and
  devices) over `/api/board` (§9), app id `board`, route `/board?view=…`, with its own 220px rail.

**Added**

- D-01 Home: board / committee tabs, the meeting strip with NEW / AMENDED, the month, shared documents and notices,
  "What's new for you" counters; Director brief (`POST /ai/brief`) and Open next pack.
- D-02 Agenda with file, notes, comments, last seen, status and flags; AI Summary / Actions / Notes drawers; my
  attendance reply, location and Meet link, organiser, quorum; participants with item-only access.
- D-03 two-month calendar with the month's meetings; D-04 item comments (this item / all, all / specific / private,
  2,000 characters) beside the AI summary with page citations.
- D-05 Board packs offline: the main process's encrypted vault (`electron/services/board-vault.ts`) — AES-256-GCM
  under a per-person key in the OS credential store, files bound to their names; grant + manifest + the member's
  rendition; expiry at the soonest of grant, max offline days and archive date; update ready; trust and last sync.
- Revocation and blocking (FR-DEV-02/03): `board.device.revoked|blocked` or DEVICE_REVOKED / DEVICE_BLOCKED erase the
  vault folder and its keys only — never personal files — and the wipe is reported at the next contact.
- Offline queue (FR-OFF-02) for annotations, acknowledgements and notes, the latest edit of an item winning.
- Offline circular responses (FR-VOT-08, FR-CIR-05): only where the policy allows, before the deadline, never a
  live vote; signed with the device's Ed25519 key when recorded, uploaded to `/circulars/{id}/offline-responses`,
  and the server's acceptance or reason shown. Others' responses only after mine, never on a secret circular.
- D-06 annotations (mine / shared, detached with re-attach, export), the pack reader with notes (online or from the
  vault), D-07 search (offline in kept packs), D-08 approvals and signing (draw / saved / certificate, version and
  SHA-256, Touch ID where the OS offers it, else the server's step-up), D-09 my actions, D-10 archive with integrity
  check, D-11 send notice with channels and delivery, D-12 live room (present, quorum, open vote blocked without
  quorum, live or secret tally, member ballot online only), D-13 live minutes with autosave, versions and compare,
  and non-binding polls inserted into the minutes.
- `worksuite://board[/meetings/:id[/room]|/circulars/:id]` deep links, the launcher tile, notifications.
