# social-media — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.0.3 — 2026-10-26

**Fixed**

- its rows that open a record on a click are reached with Tab and opened with Enter or Space (audit D-G21)
- a calendar day opens the composer with Enter or Space (D-G21)

## 1.0.2 — 2026-10-26

**Changed**

- the figure cards (KPI, stat and summary tiles) are the shared StatCard — compact, a tinted icon chip and the label above a calm figure, a muted line under it, zero shown muted; cards that open a list are buttons with a focus ring and a soft lift; the same figures and actions as before

## 1.0.1 — 2026-10-06

**Fixed**

- the app is in the launcher, sidebar and search for everyone signed in, like the Phone — it was hidden from all while no server has the module's app row; with no module on the server every screen opens to look at

## 1.0.0 — 2026-10-06

**Added**

- Social Media Manager (WS-SMM-SRS-001 v1.1, design "WorkSuite Social Media Manager — UI"): the app `social-media`, its module rail and twelve screens over `/api/social-media`.
- W01 Overview; W02/D02 Create post with per-network variants, live checks (X weighting, Sinhala and Tamil counting), Split into thread, previews, Drive media and drag-drop into the brand's Drive folder, AI suggestions applied only on a click, autosave with a local copy, version conflicts, Schedule or Send for approval by role, Ctrl/Cmd+Enter.
- W03/D01 Calendar (month, week, list; drag to reschedule; unscheduled drafts); W04 Queue & posting slots (best-time stars, minimum gap, blackouts, reorder, pause, shuffle, evergreen).
- W05 Approvals (steps, comments with mentions, Request changes / Approve / Reject, external review links); W06/D03 Inbox (filters, collision lock, notes, saved replies, AI reply, assign, CRM lead and ticket, messaging windows, J/K).
- W07 Analytics (KPIs, trend, per-network definitions, heat map, posts, inbox metrics, export, scheduled reports); W08 Content library; W09 Campaigns.
- A01 Accounts (OAuth in the browser, choose pages, reconnect, access lists, pause, disconnect with cancel or hold); A02 Module settings (ten sections, provider apps whose secrets are never shown, the kill switch); A03 Publishing log (retries, Mark as posted, CSV).
- Native banner buttons, realtime refresh and offline calendar; what the server lacks is said plainly (docs/SOCIAL_MEDIA.md).
