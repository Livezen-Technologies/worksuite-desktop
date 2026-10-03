# notifications — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.5.0 — 2026-10-03

- Settings for Files: choose chat, in-app and email (instant, daily summary or off) for shares, access changes and comments (#164).

## 1.4.4 — 2026-10-03

- Mail banners: choose which new mail alerts, VIPs through quiet hours, more actions, reminders (ENH-MAIL-03).

## 1.4.3 — 2026-10-03

- New-mail notifications have Reply, Archive and Mark read; a mail push refreshes Mail's counts.

## 1.4.2 — 2026-10-03

- Keep locked call and chat banners independent and apply locked sound/privacy controls (#115).

## 1.4.1 — 2026-10-03

- An AI Assistant answer that arrives while the window is not focused shows a desktop banner through the usual notification settings, Do not disturb and banner privacy; while locked it only says New WorkSuite notification (#126).

## 1.4.0 — 2026-10-03

- Prevent upload-time reconnect races, verify gateway readiness and report connection recovery diagnostics (#123).

## 1.3.2 — 2026-10-02

- Incoming calls say 'Incoming voice/video call from X'; while locked they say 'Incoming WorkSuite call' and name the caller only when Show Caller Details is on (#113).

## 1.3.1 — 2026-10-02

- Retry missed chat notifications on the regular poll when the network is not ready after resume or a catch-up request fails. Preserve the missed-message window and avoid repeating partially delivered banners (#114).

## 1.3.0 — 2026-10-02

- Localize privacy-safe native notification summaries while preserving sender names and full user-authored content (#60).

## 1.2.0 — 2026-10-02

**Added**

- a meeting invitation in the notification centre has Going, Maybe, Not going and View Meeting, and on macOS the banner has the three answers (worksuite-desktop#97). Settings says why banners are blocked when they are.

**Fixed**

- chat notifications keep coming while WorkSuite is locked (worksuite-desktop#114). Locked banners say "New message in WorkSuite." unless you allow the sender or a preview. After sleep the connection is replaced at once, and missed messages and notifications are caught up without showing twice. Settings explains when the system may be blocking banners.

## 1.1.0 — 2026-10-02

- Added Open Task, Snooze 15 min and Mark Complete to task reminder notifications. Native actions follow OS support, privacy and lock rules; the notification centre provides actions on every platform (issue #62).

## 1.0.2 — 2026-10-01

**Fixed**

- a notification the realtime push missed now pops up. The one-minute poll reads the list as well as the counts, and an unread notification from the last 15 minutes that this app has not shown yet is shown once (worksuite-desktop#16). Before this, a missed push never appeared as a desktop alert.
- when something is shared with you, or your access to it changes, Drive's Shared with me and lists refresh at once rather than within two minutes (worksuite-desktop#16).

## 1.0.1 — 2026-10-01

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
