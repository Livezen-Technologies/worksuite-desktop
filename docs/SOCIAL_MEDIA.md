# Social Media Manager on WorkSuite Desktop — gap analysis and build

Against **WS-SMM-SRS-001 v1.1** (03 Oct 2026, *Draft for review*) and the design canvas *WorkSuite Social Media
Manager — UI* (18 artboards: W01–W09, A01–A03, D01–D03, M01–M02, the shared module rail). The SRS was written
against the server branch `mail-task-details-ui`, which could not be read from here; the server module
(`app/Modules/SocialMedia`, app `worksuite.social-media`) is new there too.

## 1. What this adds

The desktop had no Social Media Manager. The internal company feed (the catalogue's `social`, opened in the browser)
is a different thing (SRS Q-01/Q-02) and is untouched. Built now, in `src/modules/social-media` (module
`social-media` 1.0.0):

| Area | Where | SRS |
|---|---|---|
| App | `shared/apps.ts` entry `social-media` (app slug `social-media`, permission `social.view`, web path `/social-media`); manifest in `src/modules/registry.ts` (DRAFTS offline, notifications, file drop, "New social post" quick action); deep links `worksuite://social-media[/posts|/inbox|/approvals/<id>]` | DSK-001, ADM-007, C9 |
| Shell | `Nav.tsx` — the 240 px module rail of the design (Publish · Engage · Plan · Administer, badges, Create post, "N accounts in M brands"); `SocialMediaPage.tsx` router; the kill-switch banner; `parts.tsx` | DSK-001, SCH-008 |
| Data | `api.ts` — every route of SRS §15 and the proposals below, typed after the data model (§12); `access.ts` — the `social.*` family (§14) and per-account Use ⊂ Publish ⊂ Manage | ACC-011, §14, §15 |
| Engine | `lib/text.ts` — captions counted the networks' way (NFC; X weighs links 23, emoji 2; Sinhala and Tamil by code point), split into a numbered thread; UTM tagging; `lib/validate.ts` — each variant checked live against its capability set; `lib/networks.ts` — the §6 capability sets and per-network metric definitions | CMP-003/004/008, MED-004, ANL-008, NFR-12, AC-04, AC-18 |
| W01 Overview | `screens/Overview.tsx` | ACC-005, SCH-003, INB-008, ANL-002 |
| W02 / D02 Create post | `composer/` — Original + per-network variants, live checks and fixes, previews, Drive media and OS drag-drop into the brand's Drive folder, AI suggestions (never applied unasked), autosave and a local copy, version conflicts, Schedule / Send for approval by role, Ctrl/Cmd+Enter | CMP-001…015, MED-001…004, SCH-001, APR-002, DSK-003/005 |
| W03 / D01 Calendar | `screens/Calendar.tsx` — Month, Week (the D01 hour grid), List; filters; drag to reschedule; unscheduled drafts | SCH-002…005, SCH-011 |
| W04 Queue & slots | `screens/Queue.tsx` — weekly slots with best-time stars, minimum gap, blackouts, reorder / pause / shuffle, evergreen | SCH-006…008, SCH-010 |
| W05 Approvals | `screens/Approvals.tsx` — steps, comments with @mentions, Request changes / Approve / Reject, external review links | APR-001…008 |
| W06 / D03 Inbox | `screens/Inbox.tsx` — filters, threads, collision lock, reply / internal note, saved replies, AI suggestion, assign, CRM lead and ticket, messaging windows, J/K | INB-001…012, AI-002 |
| W07 Analytics | `screens/Analytics.tsx` — KPIs against the previous period, trend, by account with each network's definitions, heat map, posts, inbox metrics, export and scheduled reports | ANL-001…009 |
| W08 Library · W09 Campaigns | `screens/Library.tsx`, `screens/Campaigns.tsx` | MED-005…007, CPG-001…004 |
| A01 Accounts | `admin/Accounts.tsx` — connect in the browser (OAuth), choose pages, reconnect / renew, access lists, brand, pause, disconnect with cancel-or-hold | ACC-001…013 |
| A02 Module settings | `admin/Settings.tsx` — the ten standard sections; provider apps whose secrets are never shown again; the kill switch | ADM-001…007, SCH-008 |
| A03 Publishing log | `admin/PublishLog.tsx` — every attempt, Reconnect & retry, Mark as posted, CSV export | PUB-003, PUB-011 |
| Desktop | Native banners with View post / Approve / Reply / Copy caption (`shared/social-notices.ts`, `electron/services/notifications.ts`); realtime `social.*` refetch (`src/core/query.ts`); posts, accounts and brands kept for offline (`electron/main/index.ts` READ_CACHE) | DSK-002…005, NTF-002, AC-16 |

**Not here:** M01/M02 are WorkSuite Mobile's (a separate app). Listening (LST, P5) and competitor benchmarks
(ANL-010, P5) show a plain "later phase" state.

**Honest degradation (NFR-10, the Phone's rule).** Every call goes through `optional()`. A server without the module
answers 404 everywhere: the rail and every screen still draw, a banner says *Social Media Manager isn't on this
WorkSuite server yet*, and each panel says the same where its data would be — nothing is invented. A super-admin
(`apps: '*'`) sees the app; anyone else sees it once the server lists the `social-media` app for them and grants
`social.view`.

**Never on the desktop:** network tokens or app secrets (NFR-04: the server keeps them in CoreSecretService; the
desktop only sees what was granted, in words); publishing (C3: the server's scheduler publishes, so a post goes out
with the computer off); anything AI wrote sent or published without a click (C6, AC-13).

## 2. What the server needs (the contract)

All under `/api/social-media`, the usual `{status, message, data}` envelope, UTC ISO-8601 stamps, optimistic
`version` on writes (409 with `data.current` and `data.by` on a conflict), cursor pagination where lists are long.
Shapes are the types in `src/modules/social-media/api.ts`.

**From SRS §15, as listed:** `accounts` (GET), `accounts/connect` (POST → `{redirect_url}`; the desktop sends
`client: "desktop"` and opens the URL in the browser), `oauth/callback`, `accounts/{id}/reconnect`,
`accounts/{id}` (DELETE `{future_posts: cancel|hold}`), `accounts/{id}/access` (PUT `{entries}`), `brands[/{id}]`,
`posts` (GET filters `from, to, brand_id, account_id, network, status, label, campaign_id, owner_id, unscheduled, q`;
POST), `posts/{id}` (GET → `{post, events}`; PUT), `posts/{id}/validate|schedule|submit|decision|cancel|duplicate`,
`targets/{id}/retry|mark-posted`, `targets/{id}/remote` (DELETE), `posts/{id}/comments`, `posts/{id}/review-links`,
`media/renditions`, `library[/{id}]` (`?kind=`), `queue/slots` (GET/PUT, `brand_id` or `account_id`),
`queue/reorder {target_ids | shuffle}`, `queue/pause {paused}`, `blackouts[/{id}]`, `pause-all {paused, reason}`,
`bulk/preview|commit`, `campaigns[/{id}]`, `inbox/threads` (GET → `{threads, counts}`), `inbox/threads/{id}`
(→ `{thread}` with `messages`, `crm`, `ticket`, `viewing`, `window_ends_at`, `actions`),
`inbox/threads/{id}/reply|note|assign|status|convert`, `inbox/saved-replies[/{id}]`, `inbox/rules`,
`analytics/overview|posts|heatmap|export`, `reports/schedules`, `log`, `settings/{section}`,
`settings/provider-apps/{network}` (PUT).

**Proposed by the desktop — asked for, and said plainly when absent:**

| Need | Call |
|---|---|
| The rail's badges, the kill-switch banner, the composer's organisation settings (G-01) | `GET status` → `{paused_all, paused_at, paused_by, ai_enabled, alt_text_required, default_timezone, default_brand_id, counts: {accounts, brands, accounts_attention, approvals_waiting, inbox_open, inbox_assigned_to_me, failed_7d, held}, permissions?}` |
| Choosing pages after the browser comes back (WF-01 step 5) | `GET accounts/connect/assets` → `{assets: [{external_id, network, display_name, handle, account_type, avatar_url, already_connected, missing}]}`; `POST accounts/connect/assets {external_ids, brand_id}` |
| Reading an access list; brand and pause per account (ACC-010/011, PUB-010) | `GET accounts/{id}/access` → `{access}`; `PUT accounts/{id} {brand_id?, paused?}` |
| Deleting a draft; revoking a review link (APR-005) | `DELETE posts/{id}`; `GET posts/{id}/review-links` → `{links}`; `DELETE posts/{id}/review-links/{linkId}` |
| The composer's Add to queue / Best time preview (SCH-001, WF-07) | `GET queue/next?account_ids=1,2&mode=queue\|best` → `{times: [{account_id, at, label}], window}` |
| Evergreen settings (SCH-010) | `PUT queue/evergreen {brand_id, reshare, skip_days, ai_rewrite}`; `queue/slots` answers `evergreen`, `next`, `queued_total`, `fills_until`, `blackouts_count`, `min_gap_minutes`, `paused`, `timezone` |
| AI in the composer and the inbox, through CoreAIService (CMP-009, AI-001/002) | `POST ai/compose {action: write\|rewrite\|shorten\|tone\|translate\|hashtags\|alt_text, text, network, tone, language, brief, file_id}` → `{suggestion, options?}`; `POST inbox/threads/{id}/suggest` → `{reply, sentiment, intent, language, summary}` |
| Media from Drive into the library (MED-002) | `POST library {kind: "media", file_ids, brand_id}` → `{items}` |
| Inbox metrics (ANL-005) | `GET analytics/inbox?from&to&brand_id` → `{volume, median_first_reply_minutes, median_resolution_minutes, by_agent, by_brand}` |
| Reading provider apps (ADM-002) | `GET settings/provider-apps` → `{redirect_uri, apps: [{network, label, product, covers, mode, enabled, client_id, has_secret, secret_set_at, status, status_note, tier, webhook}]}` — never a secret |
| Post saves (CMP-009, SCH-001) | `POST/PUT posts` also take `ai_used`, `scheduled_at`, `schedule_mode`, `entered_timezone`, so the AI flag and a draft's chosen time are kept |
| Delete an inbox item at the network (INB-004) | `DELETE inbox/threads/{id}/remote` → 204 |
| Campaign review links (CPG-004) | `POST campaigns/{id}/review-links` → `{link}` — the button stays disabled until it exists |
| Advanced settings (ADM-005) | `POST export` → `{job_id}`; `POST webhooks/resubscribe` → `{accounts}` |
| Overview's "past reply target" (INB-008) | `status.counts.inbox_past_target` |
| People to assign (INB-005) | a user/team directory route; today "Someone else…" asks for an id |
| Native banners (DSK-002, WF-17) | notifications with `event` `social.*`, `category` `social_media` and a `/social-media/...` link; a manual reminder adds `actions: [{copy: "<caption>"}]` for Copy caption; realtime `social.*` events (ids only) refresh the screens |

## 3. Open questions this build had to answer

- **Q-01 naming.** App id `social-media`, route `/social-media`, notification category `social_media` — separate from
  `social`. A notification whose link is `/social-media/...` is filed under Social Media whatever its category.
- **Q-04 first networks.** All nine networks are drawn; which ones can be connected is the server's (provider apps).
- **Times.** Shown on the reader's clock, with the brand's zone beside it when it differs (SCH-002). The design's
  sample "Thu 09 Oct 2026" is a Friday; the screens compute weekdays, they do not copy the mock.
