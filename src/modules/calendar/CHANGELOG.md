# calendar — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.3.0 — 2026-10-01

- Schedule conflicts asked before a drag or resize moves anything; overlapping entries flagged on Week, Day and Month; Choose another time returns to the times; duplicates and people whose availability is unknown are said (#99).

## 1.2.0 — 2026-10-01

**Added**

- schedule conflicts (worksuite-desktop#99). Saving an event checks it for you and everyone on it, including each occurrence of a repeating one. When it overlaps something, a Schedule Conflict dialog shows what: a title and time where you may see it, otherwise Busy. It offers View conflict, Choose another time and Save anyway. An invitation waiting for your answer shows what it overlaps, and Accept asks first.
- dragging an event onto something else says so, with Undo in the bar.

## 1.1.1 — 2026-10-01

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.1.0 — 2026-10-01

**Added**

- an entry from another module opens the one record it is about — Open Task, Open Meeting, View Tender, Open Subscription, Open Leave Request, Open Project, Open Asset — after checking it is still there; a deleted or unshared record says so (#64).
- Escape closes the drawer; a deleted event says so instead of showing an empty form.

**Fixed**

- subscription renewals are listed for people with Expenses, where those subscriptions are kept, and open them there; tenders open in the Tenders tab, not the browser.

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
