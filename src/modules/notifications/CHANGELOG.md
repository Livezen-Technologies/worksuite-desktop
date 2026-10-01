# notifications — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.0.2 — 2026-10-01

**Fixed**

- a notification the realtime push missed now pops up. The one-minute poll reads the list as well as the counts, and an unread notification from the last 15 minutes that this app has not shown yet is shown once (worksuite-desktop#16). Before this, a missed push never appeared as a desktop alert.
- when something is shared with you, or your access to it changes, Drive's Shared with me and lists refresh at once rather than within two minutes (worksuite-desktop#16).

## 1.0.1 — 2026-10-01

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
