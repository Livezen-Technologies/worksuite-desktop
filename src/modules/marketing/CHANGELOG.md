# marketing — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

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
