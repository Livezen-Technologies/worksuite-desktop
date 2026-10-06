# marketing — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.0.0 — 2026-10-06

**Added**

- Marketing as a desktop module (WS-MKT-SRS-001 v1.1, design "WorkSuite Marketing — Modern UI", DK01–DK14 and D01), over WorkSuite's Marketing module at `/api/marketing`; the web's `/marketing/…` links open here.
- Callback reminders run in the main process, Marketing open or not: the person's own callbacks are read every 5 minutes and ring at the minute they are due with **Call now** (claims that callback's contact, not the head of the queue) and **Snooze 15 min**; a callback that is done or moved stops ringing, snoozed or not, and nothing of the last account rings after sign-out.
- Alt+Ctrl/⌘+N claims the next contact from any app; the tray shows the queue, today's callbacks and what is sending.
- Dates and times are read and written on the WorkSuite clock (the person's zone, then the organisation's, then the computer's), so a scheduled send or a callback says the same time on every computer.
- A screen whose server feature WorkSuite does not offer yet (405, 501, or a 404 for the route) says so instead of failing; a 404 for a record is still an error, and a failed refresh keeps what is on screen.
