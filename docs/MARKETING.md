# Marketing on WorkSuite Desktop — gap analysis and build

Against **WS-MKT-SRS-001 v1.1** (03 Oct 2026) and the design canvas *WorkSuite Marketing — Modern UI*
(claude.ai/artifact/2Nis2JE8CTTfA1QwBKXNU5, 32 boards: W01–W13 web, DK01–DK14 the same screens in the desktop
window, D01 desktop notifications and tray, M01 mobile, P01 the public preference centre, R01 automation, and the
shared module rail).

Two things about the inputs:

- The canvas link that came with the request (claude.ai/artifact/FiNR3SiPKcPAgHMKrXv1Sq) is *WorkSuite Phone (VoIP) —
  Modern UI*, the Phone's design, which the desktop already carries since 0.2.188 ([PHONE.md](PHONE.md)). The Marketing
  canvas used here is the one SRS §19 names.
- The server (`Livezen-Technologies/worksuite`: `app/Modules/Marketing`, `web/src/pages/marketing`) could not be
  attached in this session. The API contract is therefore derived from SRS §7.1 and the requirement texts, not read
  from the controllers — see §5 for what to check before this ships, and [BACKEND.md § Marketing](BACKEND.md#marketing-ws-mkt-srs-001).

## 1. The gap this closes

Before this change the desktop had **no Marketing**: the catalogue entry was `surface: 'browser'`, so the launcher
handed `/marketing` to the browser. None of the desktop screens (DK01–DK14) existed, and none of D01 — the call-queue
tab, the global next-contact shortcut, native callback and campaign notifications, tray counts (MKT-DSK-01) — nor the
desktop half of callback reminders to the minute (MKT-CAL-12, G-01).

Built now, in `src/modules/marketing` (module `marketing` 1.0.0) with its main-process side in
`electron/services/marketing.ts`:

| Board | Screen | Files | SRS |
|---|---|---|---|
| Shell | The 240 px module rail: New campaign, company, Audience · Email · Calls · Insights, sending route at the foot | `Nav.tsx`, `MarketingPage.tsx` | §19 |
| DK01 | Dashboard with the go-live readiness panel, KPIs, weekly delivery, recent campaigns, calls, consent coverage | `audience/Dashboard.tsx` | DSH-01/02, WF-01 |
| DK02 | Contacts: search, filters, bulk bar (list, tag, CRM, suppress, do-not-call, archive), export | `audience/Contacts.tsx` | AUD-01/04/05/07, IMP-05 |
| — | Add / edit a contact with dedupe before saving ("Update existing") and first consent per channel | `audience/ContactEditor.tsx` | AUD-01/02, WF-02 |
| DK03 | Contact: profile, consent chips, suppression, timeline · consent ledger · campaigns · calls, CRM hand-over, call | `audience/ContactDetail.tsx` | AUD-06/08/09, CON-01/02, CRM-01/02, SUP-01 |
| — | Organisations and their contacts | `audience/Organisations.tsx` | AUD-03 |
| — | Lists: size, consent coverage, last use; members; export | `audience/Lists.tsx` | LST-01/02, IMP-05 |
| DK04 | Segments and the segment builder: ≤ 20 rules over 19 fields, live count and sample, save as list, snapshots | `audience/Segments.tsx`, `audience/SegmentBuilder.tsx`, `lib/segment.ts` | SEG-01..06, 08, WF-04 |
| DK05 | CSV import: limits checked before upload, column mapping, preview (new / update / in-file / rejected), batch consent decision, lists and tags, report | `audience/Import.tsx`, `lib/csv.ts`, `lib/dedupe.ts` | IMP-01..06, WF-03, AC-07 |
| DK12 | Consent & suppression: suppression list, append-only ledger, do-not-call, topics; add, remove with a reason | `consent/Consent.tsx` | CON-01/02/07/09, SUP-01..05, WF-05, AC-03/13 |
| P01 | Topics and the preference centre as contacts see it | `consent/Topics.tsx` | CON-04..06, WF-11 |
| DK06 | Email campaigns by state | `email/Campaigns.tsx` | EML-01/04 |
| — | A campaign's setup before it exists, from a starter or a template | `email/NewCampaign.tsx` | EML-02/03, WF-06 |
| DK07 | The editor: blocks, closed merge tags with fallbacks, public images, desktop / mobile / plain-text previews, autosave, history | `email/Editor.tsx`, `lib/blocks.ts`, `lib/merge.ts` | EDT-01..06, WF-06 |
| DK08 | Review & send: pre-send check, ≤ 5 tests, sender and subject, audience after exclusions, A/B, local time, schedule / pause / resume / cancel | `email/ReviewSend.tsx` | CHK-01..03, ABT-01..03, SND-04/05, EML-05, WF-07..09, AC-05 |
| DK09 | Campaign report: funnel, open quality, top links, deliverability, A/B | `email/Report.tsx` | TRK-01..03, ABT-02, AC-04/06 |
| — | Templates | `email/Templates.tsx` | EDT-02 |
| DK10 | Call campaigns and the supervisor's view: KPIs, agents live, ten outcomes, rules, consent hold-back | `calls/CallCampaigns.tsx`, `calls/CallCampaign.tsx`, `calls/CallCampaignEditor.tsx` | CAL-01/02/05/08/13/15, WF-12, AC-12 |
| DK11 | My call queue: atomic claim, idle release, click-to-call through WorkSuite Phone, script, ten outcomes, wrap-up with callback, CRM hand-over and follow-up email | `calls/Queue.tsx` | CAL-03..11, CRM-01, WF-13/14, AC-08..11 |
| — | Versioned six-section scripts | `calls/Scripts.tsx` | CAL-07 |
| — | Reports across campaigns | `admin/Reports.tsx` | TRK-03, ANL-01 |
| DK14 | Automation (planned, phase 4): shown as planned, nothing runs | `admin/Automation.tsx` | AUT-01..03, WF-15 |
| DK13 | Settings: General, User access, Permissions, Organization, Sending, Calls, Consent, Notifications, Advanced | `admin/Settings.tsx` | SET-01/02, CON-03 |
| D01 | Callback reminders at the minute (Call now · Snooze 15 min), next contact from anywhere, tray counts | `electron/services/marketing.ts`, `shared/marketing.ts`, `MarketingHost.tsx`, `electron/tray/tray.ts` | DSK-01, CAL-12 |

**Honest degradation.** Every Target capability (the SRS's "not in the code") is asked for through `optional()`; a
server that answers 404/405/501 gets "isn't offered by this WorkSuite server yet" or the design's violet *Planned*
mark — never invented numbers. A 403 shows the server's own words.

## 2. Requirement status on the desktop

**Done** — the screen does it over the server's capability. **Done · asks** — built; asks the server for the SRS's
target endpoint and says so plainly until it exists. **Server** — the server's behaviour; the desktop shows its
effect. **Planned** — the design's planned state, nothing faked. **Elsewhere** — another repository.

| ID | SRS | Desktop |
|---|---|---|
| MKT-AUD-01..06 | Built | Done — Contacts, editor, detail, organisations, bulk bar, timeline |
| MKT-AUD-07 masked phones | Target | Done — numbers shown masked when the server marks them (`phone_masked`) |
| MKT-AUD-08 merge, AUD-09 erase | Target | Done · asks — contact › Merge, Erase (with a reason) |
| MKT-LST-01, LST-02 | Built, Partial | Done — size, consent coverage and last use as the server sends them |
| MKT-SEG-01, 03, 04, 05 | Built/Partial | Done — builder, live count and sample, "suppressed are excluded at send", Save as list |
| MKT-SEG-02 | Built | Server — evaluated at preview, schedule and send |
| MKT-SEG-06 | Target | Planned — call outcome, callback due and CRM lead status listed, disabled until offered |
| MKT-SEG-07 nested groups | Target (C) | Not in this change |
| MKT-SEG-08 snapshots | Target | Done · asks — Snapshot card |
| MKT-IMP-01, 02, 03, 05 | Built/Partial | Done — limits before upload, mapping, preview with match keys, consent decision required, export |
| MKT-IMP-04, IMP-06 | Target | Done · asks — rejected rows CSV, background progress |
| MKT-CON-01, 02, 04 | Built | Done — record consent with basis and evidence, derived chips, topics |
| MKT-CON-03 | Partial | Done — the company setting (Settings › Consent) and the hold-back on call campaigns |
| MKT-CON-05, 06 | Built | Server — the public preference centre (P01) and its ledger rows ("Contact"); Topics shows its preview |
| MKT-CON-07 ledger export | Target | Done · asks |
| MKT-CON-08 re-permission template | Target | Server — a template the server provides appears among templates |
| MKT-CON-09 double opt-in | Target | Planned — said from `settings.consent.double_opt_in` |
| MKT-SUP-01 | Built | Done — suppression list, add suppression, suppress from a contact or the bulk bar |
| MKT-SUP-02, 03 | Built | Server — said on the screens ("checked at queue and send time, survives re-import") |
| MKT-SUP-04 | Partial | Server (B-4) — SES rows appear once SNS is wired |
| MKT-SUP-05 remove with a reason | Target | Done · asks |
| MKT-EML-01..04 | Built | Done — states and their actions, audience, sender, duplicate |
| MKT-EML-05 approval | Target | Done · asks — "Request approval" when scheduling is refused |
| MKT-EDT-01..04 | Built | Done — blocks, starters, previews, templates, public images, closed merge tags |
| MKT-EDT-05 alt text | Target | Done — the editor warns; the server's check should block too |
| MKT-EDT-06 autosave, versions | Target | Done (autosave) · asks (version history) |
| MKT-CHK-01, 03 | Built | Done — blockers vs warnings, Schedule disabled while blocked (AC-05), ≤ 5 tests |
| MKT-CHK-02 | Partial | Server — the domain blocker is the server's check |
| MKT-SND-01..03, 07, 09 | Built | Server — the rail's foot shows route, priority and pace |
| MKT-SND-04, 05, 06, 08 | Built | Done — local time, pause/resume, bounce-guard state; owner notices arrive as WorkSuite notifications |
| MKT-SND-10 | Target | Server — Settings › Sending lists the server's routes, transactional ones refused |
| MKT-SND-11, TRK-04 | Fix | Ops (B-2, B-4) — the readiness panel names them once served |
| MKT-ABT-01, 02 | Built | Done — 10–50 % test, 1–72 h window, winner by human opens, both variants in the report |
| MKT-ABT-03 winner by clicks | Target | Planned |
| MKT-TRK-01, 02 | Built | Server; the report shows open quality |
| MKT-TRK-03 | Partial | Done — funnel, top links, open quality, deliverability, unsubscribes |
| MKT-CAL-01..11 | Built (02 Partial) | Done — campaign setup, B-5 said plainly, claim/release/skip, ten outcomes, retries, callbacks as Tasks, scripts, results, do-not-call, hand-over, click-to-call |
| MKT-CAL-12 reminders to the minute | Target | Done (desktop) · asks `queue/callbacks` — reminders run in the main process |
| MKT-CAL-13 local calling hours | Partial | Done — the campaign's hours "in the contact's local time" |
| MKT-CAL-14 recording / CDR | Target | Not in this change (depends on VoIP G-01/G-04) |
| MKT-CAL-15 live view | Partial | Done · asks `call-campaigns/{id}/live`; the campaign's own agent figures until then |
| MKT-CRM-01..03 | Built | Done — from a contact, the bulk bar and the wrap-up; the lead number shown |
| MKT-DSH-01, DSH-02 | Built, Target | Done, Done · asks |
| MKT-SET-01, 02 | Partial | Done — the standard tabs (General/Advanced through module settings) and Sending, Calls, Consent |
| MKT-AUT-01..03, WAP-01, SMS-01, SCO-01 | Target | Planned — DK14 shows the planned journey, journeys listed if offered |
| MKT-ANL-01 | Target | Done · asks — Reports › Across campaigns |
| MKT-FRM-01/02 | Target | Elsewhere — Forms and the Customer Portal |
| MKT-AI-01 | Target | Not in this change |
| MKT-DSK-01 | Target | **Done** — call-queue tab, next-contact shortcut, native callback notifications (campaign notices through WorkSuite notifications), tray counts |
| MKT-MOB-01 | Target | Elsewhere — `worksuite-mobile` |

Non-functional: NFR-11 — labelled controls, tab semantics, scrolling tables, wrapping toolbars (verify with a screen
reader before release); NFR-12 — the app bundles Noto Sans Sinhala and Tamil, and the CSV reader keeps UTF-8 text as it
is; NFR-02/03/04 are the server's timings (the segment count is debounced and cancelled while typing).

## 3. What the desktop needed from Electron (now done)

| Need | Change |
|---|---|
| Reminders at the minute, with or without a Marketing tab | `MarketingService` reads `GET /api/marketing/queue/callbacks` every 5 minutes (and on `marketing:refresh` after an outcome is saved), keeps a timer per callback due in the next 6 hours, and raises a native notification at the minute |
| Call now / Snooze on a banner | `Incoming.buttons` in the notification service: a banner's own buttons, run by whoever raised it; locked, they open the link instead |
| Next contact from anywhere | `marketing:configure {shortcut}` — `Alt+Ctrl/Cmd+N` held only while the person holds `marketing.call.make`; it opens `/marketing/queue?next=1` through the app's own navigation. The design's Ctrl+Shift+N is already *Move Tab to New Window*, so the Phone's Alt+Ctrl/Cmd family is used |
| Tray counts | `TrayModel.marketing`: Call queue waiting, Callbacks today, Sending now, Next contact (with its key) — only with Marketing, the queue lines only for agents |
| Catalogue and links | `marketing` is `surface: 'native'` (sidebar *business*); deep links `worksuite://marketing`, `marketing/campaigns/:id`, `marketing/contacts/:id`, `marketing/queue`; the web's `/marketing/…` paths open here; quick actions New campaign and Next contact |

## 4. What the server and the web still owe

From the SRS (unchanged by this work — they are the server's and operations'):

| # | Item | Owner |
|---|---|---|
| B-1 | Marketing switched off for every company | Admin |
| B-2 / MKT-SND-11 | `marketing:send` cron not installed in production | Ops |
| B-3 / MKT-SND-10 | SES sandbox; no marketing route in CoreMailInfrastructureService | Ops / Admin |
| B-4 / MKT-TRK-04, SUP-04 | SES bounce and complaint notifications (SNS) not ingested | Ops |
| B-5 | Nobody holds `marketing.call.make` | Admin |
| Q-1..Q-5 | Phone consent basis for imported vendors, rollout, email basis, control plane, phase 4 order | Business |

Endpoints the desktop asks for and the SRS targets (contract in [BACKEND.md](BACKEND.md#marketing-ws-mkt-srs-001)):
`readiness`, `contacts/match`, `tags`, `sources`, `contacts/{id}/merge`, `contacts/{id}/erase`,
`segments/{id}/snapshots`, `imports/{id}`, `imports/{id}/rejected`, `consent-ledger/export`,
`DELETE suppressions/{id}`, `merge-tags`, `campaigns/{id}/versions` (+ restore), `campaigns/{id}/approval`,
`call-campaigns/{id}/live`, `queue/callbacks`, `scripts/{id}/versions`, `journeys`, `analytics`.

**The web (W01–W13, R01, P01) is not changed here** — it lives in `Livezen-Technologies/worksuite`
(`web/src/pages/marketing`), which this session could not attach. Its gaps are the Target and Partial rows of §2
(readiness panel, merge/erase, snapshots, rejected rows, ledger export, suppression removal, versions, approvals,
callbacks to the minute, live board, analytics, automation) plus making the web screens match the design.

## 5. Verify against the server before release

Because the controllers were not readable, check these on a server with the Marketing module (`php artisan route:list
--path=api/marketing`) and align `src/modules/marketing/api.ts` where a name differs:

1. Paths: `dashboard`, `contacts` (+ `bulk`, `export`, `{id}/timeline|consent|campaigns|calls|handover|archive`),
   `organisations`, `lists` (+ `members`, `export`), `segments` (+ `preview`, `to-list`, `export`), `imports`
   (+ `preview`, `commit`), `suppressions`, `consent-ledger`, `topics`, `campaigns` (+ `content`, `duplicate`, `check`,
   `tests`, `audience`, `schedule`, `unschedule`, `pause`, `resume`, `cancel`, `report`, `report/export`),
   `templates`, `images`, `call-campaigns` (+ `start|pause|resume|finish`), `agents`, `queue` (+ `next`,
   `{claim}/release|skip|outcome`), `scripts`, `settings`.
2. Answer shapes — the field names in `api.ts` (`email_consent`, `phone_consent`, `email_suppressed`, `do_not_call`,
   `recipients_count`, `human_opens`, `open_quality`…).
3. The claim's lost race (409 or 423) and the content save's stale version (409).
4. Which of the 23 permissions gate which route — the desktop only keys on `marketing.call.make`.

A path spelled differently shows "isn't offered by this WorkSuite server yet" on that screen, never wrong data.

## 6. Not in this change

- **The web screens** (W01–W13, R01) and the **public preference centre** (P01) — `Livezen-Technologies/worksuite`.
- **WorkSuite Mobile** (M01, MKT-MOB-01) — `worksuite-mobile`.
- **Server work** (§4) — separate repository.
- **MKT-SEG-07** (nested rule groups), **MKT-CAL-14** (recordings, waits on VoIP), **MKT-AI-01**.
