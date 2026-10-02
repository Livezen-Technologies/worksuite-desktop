# calls — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.2.0 — 2026-10-01

**Added**

- a raised-hand badge on call tiles, a hand sound, and a tab row in the call's side panel that scrolls when its tabs do not fit (worksuite-desktop#92).

## 1.1.1 — 2026-10-01

- A call's chat opens through the shared chat-window path, saving the draft first (#103).

## 1.1.0 — 2026-10-01

- A meeting invitation rings like a call (worksuite-desktop#79): meet.ring opens Meet's ring screen once per invitation, never for a meeting this computer is in, only when Meet may open; a missed one is asked for on start and after reconnecting.

## 1.0.2 — 2026-10-01

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.0.1 — 2026-09-30

**Fixed**

- The calls this computer is in now carry their meeting's id, so a meeting's card in Chat can offer Return to meeting instead of Join (#71)
- The Share your screen picker no longer shows "Something went wrong" with "Nothing to share here" (#70): screens and windows are listed separately, so one list the system refuses does not take the other with it; Screen Recording that is off is said as that (separate from the Accessibility permission remote control needs), with Open System Settings, Restart WorkSuite and Check again; a listing that failed shows the system's words with Try again; no windows open is said as that; the list refreshes on Retry and when the window comes back into focus; the chosen quality is remembered; this app's own windows are left out by their media id; what is logged is counts and the system's error, never names or pictures

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
