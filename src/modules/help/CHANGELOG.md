# help — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.0.4 — 2026-10-26

**Fixed**

- a guide's text is no longer announced as clickable; its links stay links (D-G21)

## 1.0.3 — 2026-10-26

**Fixed**

- the Help button in Hosting opens the Hosting & Domains guide

## 1.0.2 — 2026-10-25

- Label Studio in the guide index

## 1.0.1 — 2026-10-25

- Cheque Manager has a place in the guide index (no guide yet).

## 1.0.0 — 2026-10-22

- User guides in the app: the list of guides with search, a guide's overview, workflows, settings and FAQ, and a workflow's steps (`/help?guide=<key>&workflow=<slug>`), over the server's GET /api/help/guides; the last copies read here open offline
- "User guide" in the title bar for the tab in front and in a docked tab's bar, in Help › User Guide and the profile menu; it honours the Admin Center's guides_show_link, a module's guide turned off, and a company page (external_url, opened in the system browser); apps that open in the browser get the web guide
