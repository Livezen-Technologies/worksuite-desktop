# files — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.1.3 — 2026-10-01

**Fixed**

- Escape closes the Share dialog wherever the keyboard is, and the dialog takes the keyboard when it opens. Over a document, the keyboard was still in the editor (worksuite-desktop#42).

## 1.1.2 — 2026-10-01

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.1.1 — 2026-10-01

**Security**

- PDF previews and covers use pdf.js 6.3, past a high-severity advisory (GHSA-hq66-cqwq-w95j: script could run when a crafted PDF was opened).

## 1.1.0 — 2026-10-01

**Added**

- Home leaves out downloads in progress (.part, .crdownload), temporary and lock files and the system's own (#41)
- a file with no picture shows its kind's icon over its tag; each Home file has a ⋯ with its actions and Open containing folder (#41)
- Home's sections show their shape while loading, and say when they are empty (#41)

**Changed**

- Home has one compact header — search, New (the rail's menu) and Upload — in place of the banner that repeated Upload and New folder (#41)
- Continue working and Recently opened show up to three files as compact rows and more as tiles, six at most with See all; Recently opened says when a file was opened (#41)
- Shared by link lists each file once (grouped by file, not name), says who can open it, and offers Copy link and Manage (#41)
- the rail's filters read Documents, Media and other files, By date (the full list on hover); storage and sync lines no longer cut off (#41)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
