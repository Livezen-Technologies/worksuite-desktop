# support — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.1.0 — 2026-10-06

**Added**

- the native Support module (WS-SUPPORT-SRS-001 FR-DSK-01): registered with its manifest — read cache offline, notifications, file drop, quick actions — and opened natively instead of in the browser; shown to whoever holds support.view (or an as-built ticket.* permission) rather than behind an app slug the server never grants
- the API client for /api/support/v1 with its types, falling back to the as-built /api/tickets (list, show, reply, status, assign, take, agents) on a server without v1, and degrading the rest (views without counts, no badge, no presence)
- deep links worksuite://support and worksuite://support/ticket/{id} (by id or reference, FR-DSK-05); a ticket opens in a tab of its own, brought forward when it is already open (WF-12), and the web's /tickets?ticket= links open it too

## 1.0.0 — 2026-10-06

- The baseline: before this module, the launcher opened Support (`/tickets`) in the browser; there was no desktop module for it.
