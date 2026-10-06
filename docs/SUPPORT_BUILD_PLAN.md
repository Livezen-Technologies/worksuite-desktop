# Support module — build plan (WS-SUPPORT-SRS-001 v1.0)

Builds the Support module described in *WorkSuite Support Module — SRS v1.0* (4 Oct 2026) and drawn in the
design file (46 screens: W-01…W-19 web, D-01…D-12 desktop, M-01…M-15 mobile) across both repositories:

| Repo | Part | Where |
|---|---|---|
| `Livezen-Technologies/worksuite` | Server: data model, services, API v1, realtime | `app/Modules/Support` |
| `Livezen-Technologies/worksuite` | Web UI W-01…W-19 (agent, admin, public, portal) | `web/src/pages/support/*` (replaces `TicketsPage.tsx`) |
| `Livezen-Technologies/worksuite-desktop` | Desktop D-01…D-12 (native Support module) | `src/modules/support/*`, `electron/services/support-*.ts` |

Mobile (M-01…M-15) lives in `worksuite-mobile`; that repo isn't in this session, so mobile is limited to the server
gateway `/api/mobile/v1/support/*` (T08).

## Ground rules

- **Server first, clients follow.** Every client screen calls `/api/v1/support/*`. The as-built `api/tickets*` and
  `api/kb*` routes stay as aliases for two releases (§16.3).
- **One write path** (§4.1). Every change to a ticket goes through `TicketService`. That service validates the
  state machine (§6.2), bumps `version`, writes a field-level `ticket_events` row and raises realtime and
  notifications.
- **Organization first.** Every table has `organization_id`. A foreign id answers 404, never 403 (AC-01).
- **Internal by default.** The composer defaults to an internal note. No customer or public path can return an
  internal note (AC-03).
- **Humans decide.** AI only produces drafts, and nothing is sent without an agent's action (AC-17).
- **Shared design rules** (§19.2) apply everywhere:
  - Status colours: New blue, Open amber, In progress indigo, Pending customer violet, Pending internal fuchsia,
    Escalated red, Resolved green, Closed slate.
  - Priority: only Urgent (solid red) and High (orange) are coloured strongly.
  - SLA chips: green, amber, red, or grey when paused.
  - Every list shows the channel icon and the reference in monospace.
  - AI content carries a violet "AI" badge.
- **Versioning.** Each repo follows its own `docs/MODULES.md`:
  - Server `Support` module and desktop `support` module each get a version and changelog per task.
  - Each task also carries its tests and its row in the traceability tables.

## Tasks (done one by one, each a reviewable commit set)

### Phase A — Server foundation (worksuite · SRS Ph1)

| # | Task | Covers |
|---|---|---|
| **T01** | Data model v2 migration: extend `tickets` / `ticket_messages` / `ticket_events`; add `support_sequences`, `support_departments`, `support_teams(+members)`, `support_categories`, `support_tags` + `ticket_tags`, `ticket_watchers`, `ticket_links`, `ticket_attachments`, `support_saved_views`, `support_canned_responses`. Back-fill `organization_id` from the author's company and map `pending` → `pending_customer`. | §16.1, G-03, G-09, G-24 |
| **T02** | `TicketService`: status state machine (8 statuses), `version` optimistic lock (409 with current state), field-level events, per-org reference prefix and sequence, `support.*` permission catalogue with legacy-slug aliases, data scopes (own / team / department / org). | §5, §6, FR-STS, FR-TKT-10, G-07, G-08, G-27 |
| **T03** | API v1 (staff), part 1: list with views, filters, sort, cursor pagination and live counts; show; create; PATCH with `version`; messages (reply/note, mentions, attachments via Core Storage); assign / self-take; transition; agents; saved views; canned responses; trash/restore. Realtime `support.{orgId}`. | §16.2, FR-WSP, FR-ASN, FR-COM, G-05, G-12, G-13, G-26 |
| **T04** | API v1, part 2: merge/split + duplicate detection, bulk actions, links (CRM, invoice, asset, chat), watchers, collision presence ("is viewing / typing"). Chat conversion v2: append to open ticket, transcript with page/browser, `POST /api/v1/support/conversions`. `POST /api/desktop/support`. | FR-TKT-06/07, FR-LCH, G-14, G-19, G-21 |

### Phase B — Web agent workspace (worksuite · W-01…W-09)

| # | Task | Screen |
|---|---|---|
| T05 | Support shell (rail, views with counts, saved views, availability) + **W-02 Unified inbox** (list/table mode, bulk bar, filters, keyboard) | W-02 |
| T06 | **W-03/W-04/W-05 Ticket detail**: conversation, context panel, composer (reply/note, canned, CC), internal-note collaboration, mentions, activity log, remote support | W-03, W-04, W-05 |
| T07 | **W-06 New ticket**, **W-07 Live chat → ticket**, **W-08 Merge & duplicates**, **W-09 Escalate & resolve dialogs** | W-06…W-09 |
| T08 | Mobile gateway `/api/mobile/v1/support/*` (aliases over v1, vocabulary mapping) | §15.3, G-22 |

### Phase C — Channels, SLA, automation (worksuite · SRS Ph2–3)

| # | Task | Screen |
|---|---|---|
| T09 | DeliveryService: outbound email reply with `[TKT-…]` threading, delivery status. Email-to-ticket intake. **W-15 Channels** settings. | G-01, G-02, W-15, AC-02 |
| T10 | SlaService + business calendars, pause rules, warnings/breaches, escalation. **W-13 SLA policies & hours**. | G-04, W-13, AC-07 |
| T11 | RoutingService (teams, round-robin/load, availability), AutomationEngine (triggers, conditions, actions, dry-run, auto-close). **W-14 Automation rules**. | G-10, G-11, W-14, AC-08/09 |
| T12 | **W-16 Roles & permissions** + per-org settings (departments, teams, categories, statuses, fields, templates) | G-25, W-16 |

### Phase D — Customers, KB, reporting (worksuite · SRS Ph2/Ph4)

| # | Task | Screen |
|---|---|---|
| T13 | Public form + OTP status check + guest reply: **W-17**, **W-18** | FR-PUB, AC-05 |
| T14 | Customer portal API + CSAT: **W-19** | FR-POR, FR-CSAT, AC-14 |
| T15 | KB v1 (categories, lifecycle, versions, visibility, feedback, languages): **W-10 KB manager**, **W-11 Article editor** | G-06, AC-13 |
| T16 | Reporting service + daily metrics: **W-01 Support dashboard**, **W-12 Reports & analytics** | G-17 |
| T17 | AI assist endpoints via CoreAIService (summary, suggested reply, classify, duplicates, KB draft) | §14, AC-17 |

### Phase E — WorkSuite Desktop native Support (worksuite-desktop · D-01…D-12)

| # | Task | Screen |
|---|---|---|
| T18 | `support` module scaffold: registry and manifest, `shared/apps.ts` → native, API client, types, deep links `worksuite://support/ticket/{id}` | FR-DSK-01/05 |
| T19 | **D-01 Support inbox (three-pane)**: views, compact rows, reading pane, inline reply, availability, j/k/R/N/E | D-01 |
| T20 | **D-02 Ticket tab**: tabs, properties/SLA/requester panels, composer, drag-and-drop/paste screenshots, drafts, RustDesk connect | D-02 |
| T21 | **D-03 Native notifications** (Open / Take later / inline Reply / Snooze, per-event settings, quiet hours) + rail/dock badge | D-03 |
| T22 | **D-04 Quick-reply mini window** (always on top, canned, Reply/Note, set status) | D-04 |
| T23 | **D-05 Tray / menu-bar mini dashboard** | D-05 |
| T24 | **D-06 Website chat → ticket (native sheet)** | D-06 |
| T25 | **D-07 Urgent ticket pop-up** (SLA countdown, Take it / Assign / Dismiss) | D-07 |
| T26 | **D-08 Command palette ⌘K** support results and actions, copy deep link | D-08 |
| T27 | **D-09 Offline cache, outbox and conflict review** | D-09 |
| T28 | **D-10 KB & AI side panel** (⌘J) | D-10 |
| T29 | **D-11 Help & Guide → Contact Support** (real ticket, diagnostics, capture window, my requests) | D-11 |
| T30 | **D-12 Wallboard** on a second display | D-12 |

### Phase F — Release

| # | Task |
|---|---|
| T31 | Remove the as-built aliases' UI (`TicketsPage.tsx`), docs (`docs/BACKEND.md`, traceability), acceptance tests AC-01…AC-18, release notes in both repos |

## Branches and pull requests

- Both repositories work on `claude/vibrant-ritchie-sllkch`, one draft pull request each, and each task lands as its
  own commit(s).
- Desktop tasks wait for the server API they call. When the server lacks a v1 route, the desktop API client falls
  back to the as-built route, so a desktop release never breaks against an older server.
