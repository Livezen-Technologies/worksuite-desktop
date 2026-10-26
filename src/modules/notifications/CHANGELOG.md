# notifications — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 2.7.0 — 2026-10-25

**Added**

- payroll notifications open the run, its approval or My payslips

## 2.6.1 — 2026-10-22

- Website-chat notifications open in Chat and count as Chat for mute and access (#407)

## 2.6.0 — 2026-10-21

**Added**

- AMC's new-request banner (amc.request.logged) carries Open and Give to, and AMC notices link to the desktop's AMC screen

## 2.5.0 — 2026-10-21

**Added**

- WorkSuite Board's notifications (board.*) open the Board screen for them — the agenda, the live room, packs, approvals or actions (shared/board.ts); Board has its own tone in the list.

## 2.4.0 — 2026-10-20

- Recruitment's look in the notification list (icon, name, colours) for the new Recruitment app.

## 2.3.1 — 2026-10-19

**Fixed**

- The notification drawer, rows, menus, centre and settings inherit live appearance tokens instead of fixed navy colors, including light/dark and color-profile changes (#382).

## 2.3.0 — 2026-10-15

**Added**

- Purchasing's approvals (SRS-PUR-001 G-21): an unread `purchase.approval` entry is counted once, as Purchasing's queue, on the badge (`purchaseNotices`); purchasing and payables notices are filed under Purchasing.

## 2.2.0 — 2026-10-15

**Added**

- a claimed notification carries the event's own facts (`data`: an order approval's `order_id` and `step`), and the count of orders waiting on my approval (`/api/badges` `sales`) with the bell's approval entries it stands for, so the badge counts them once (WS-OMS-SRS-001 FR-DSK-05)

## 2.1.0 — 2026-10-13

**Added**

- a module's own banner for a bell entry (Meetings' reminders and invitations) claims attention under that entry's key, so one device shows it, and is handed the notification's own actions.

## 2.0.0 — 2026-10-11

**Added**

- One server-selected device requests each alert; other devices update badges, and reading or dismissing clears connected devices.

## 1.13.0 — 2026-10-11

- Mail banners now come from the new-mail alert service (ENH-MAIL-05); the taskbar/dock badge counts included inboxes, chat and the bell without double-counting mail.

## 1.12.1 — 2026-10-07

**Fixed**

- a returning visitor's website chat notifies again with 'Returning visitor · last chat with …' and the new message, instead of being taken for one already shown (#291)

## 1.12.0 — 2026-10-06

**Added**

- banners a module words and answers itself (its buttons, a reply box, staying until acted on, its sound) — Support's, with Open, Take later, Mark read, Snooze and a typed reply (WS-SUPPORT-SRS-001 D-03)
- Notification settings › Support — per kind, In app, a banner here and its sound; SLA banners that stay; low-priority tickets in an hourly digest; the Quick reply shortcut (⌃⌥R / Ctrl+Alt+R from any app) and the urgent ticket pop-up on or off

**Changed**

- unread notifications about support tickets are left out of the Dock and tray count, which counts those tickets by the desk's own measure

## 1.11.0 — 2026-10-06

**Added**

- Marketing callback reminders with Call now and Snooze 15 min on the banner, and Marketing in the module list

## 1.10.0 — 2026-10-06

**Added**

- Social Media Manager's banners carry View post, Approve, Reply and Copy caption; its notifications are filed under Social Media, not the internal Social stream

## 1.9.0 — 2026-10-05

- Critical native notification when visitor messages are not reaching staff

## 1.8.0 — 2026-10-05

- Ring test notification and permission detection (#251)

## 1.7.0 — 2026-10-04

- Website chat banners (#230): none while I am reading that conversation; a visitor writing again in my chat says 'Visitor CC1B: Are u there' with Reply, only while WorkSuite is not in front; one banner per conversation, saying how many messages; it goes when the chat is answered; the badge counts visitors waiting on me.

## 1.6.1 — 2026-10-03

- A bell entry when a WorkSuite update is ready, once per version (#205).

## 1.6.0 — 2026-10-03

- Settings for Files: choose chat, in-app and email (instant, daily summary or off) for shares, access changes and comments (#164).

## 1.5.0 — 2026-10-03

**Added**

- reply to a website visitor from the notification (WS-WCHAT RDC-15) on macOS and Windows: the reply goes through the outbox like one typed in the conversation (waiting while offline, sent once); a refused reply is kept as the conversation's draft, which opens with the reason; locked, with content hidden, or on Linux, the banner opens the conversation instead

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
