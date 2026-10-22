# marketing — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.1.0 — 2026-10-22

- SRS v2.0 on the desktop: data quality, consent, deliverability, journeys, forms, scoring, WhatsApp/SMS, analytics, template gallery

## Unreleased

- WS-D (SRS v2.0): `Channels.tsx` (WhatsApp & SMS campaigns: new campaign with live SMS part count, the server's estimate, send, cancel, results per message), `Analytics.tsx` (results by period/channel/topic, funnel, attribution, UTM builder, site tracking snippet, scheduled reports, CSV/PDF export through `saveServerFile`), `Planning.tsx` (`MarketingCalendar`, `Budgets` with ROI), `Webhooks.tsx` (add, test, on/off, new secret, deliveries and retry), `calls-record.tsx` (a call's CDR and recording on the contact page), `wsd.ts` (shapes); views `channels`, `analytics`, `calendar`, `budgets`, `webhooks` in the rail; options `can.channels|budgets|webhooks`; Reports links to Analytics instead of a planned card.
- WS-C (SRS v2.0): `Automation.tsx` (journey list and visual builder: trigger/step/settings panels, insert on any arrow, per-step figures, people, dry-run test), `Forms.tsx` (forms and landing pages), `Scoring.tsx` (rules, threshold, decay), `automation-parts.tsx` (journey graph helpers, snapshot panel, AI segment draft, contact score card, AI copy sheet); `audience-rules.tsx` gains `RuleTree` (nested groups ≤ 3), `rulesOf`, `leaves`, form/journey values; views `forms` and `scoring` in the rail; options `can.journeys|forms|scores`.
- WS-B (SRS v2.0): `email-governance.tsx` (deliverability panel + fixes + AI rewrite + seed tests, version history, approval bar and waiting list, languages, repeat/feed, saved blocks, who sees each block, re-permission card, script versions), `Deliverability.tsx` (domain health, warm-up) and view `deliverability` in the rail; block rules (`data-show-segment` / `data-hide-segment`) kept by `email-blocks.ts`; campaign status `recurring`; draft fields `variants`, `recurrence`, `text_body`, `daily_cap`.
- WS-A (SRS v2.0): `DataQuality.tsx` (duplicates, merge + undo, custom fields), `CompanyPage.tsx`, reach per channel on Lists, time zone / DOI / lawful basis / export / erase / re-permission on the contact page, typed custom fields and time zone in `audience-contact.tsx`, background import progress and cancel in `Import.tsx`; view `quality` in the rail.
- Templates: a gallery of the server's 100 system templates with kind, subcategory, search and preview (`email-gallery.tsx`).

## 1.0.0 — 2026-10-06

**Added**

- Marketing as a native desktop module (WS-MKT-SRS-001 v1.1, DK01–DK14), in a tab of its own instead of the browser.
  The rail has New campaign and four sections, Audience, Email, Calls and Insights, and its footer says how bulk mail
  leaves (the relay at priority 8, or "No mail route yet").
- Audience: the dashboard with go-live readiness, contacts with masked phones and last activity, the contact page
  (timeline, consent, campaigns), organisations, lists, segments with a rule builder and a live sample, the import
  wizard with matching and a file of rejected rows, and consent & suppression with the ledger and its export.
- Email: campaigns with status counts, progress, pace and human opens; the three-step editor (setup, a block editor
  that writes the same HTML as the web, review & send with the pre-send check); the report with funnel, top links,
  open quality, deliverability and A/B; templates; topics.
- Calls: call campaigns, the campaign view, My call queue with claim, skip, the ten wrap-up outcomes and callbacks,
  and scripts.
- Insights: reports across email and call campaigns; Automation shown as planned (phase 4), never as working.
- Native (MKT-DSK-01): a global Next contact shortcut held only while no WorkSuite window is focused; the tray shows
  campaigns sending and callbacks due; callback reminders with Call now and Snooze 15 min; a notice when the bounce
  guard pauses a campaign; `worksuite://marketing/…` links.
- CSV exports save through the desktop's own save dialog.
