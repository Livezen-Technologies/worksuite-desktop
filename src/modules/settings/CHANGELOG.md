# settings — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.14.0 — 2026-10-03

- Settings › App launcher (#201): size, popover or full screen, recent apps, badges, browser mark and names, pinned apps with drag to reorder (up to 8), show or hide each app, group by, sort, open in, keyboard shortcut and Reset to default — synced to all your devices; administrators set the organisation's default pinned apps and order.

## 1.13.1 — 2026-10-03

- WhatsApp and Meta channel settings use the theme's colours in dark mode (#155).

## 1.13.0 — 2026-10-03

- Settings › Contacts › Accounts & sync: connect, sync now, settings, log and disconnect each address-book account (#175).
- Sync buttons use the shared Sync button: they spin from the click, can't be pressed twice, show Synced just now or Sync failed · Retry, and keep one width (#165).
- Settings › Desktop › Links: open WorkSuite links in the app, Mail links in a new or the current tab, ask before running actions from links (#170).
- Menus draw the icon column only when an item has an icon, so no blank gap before labels (#168); the shared primary New button and menu-open animation (#171, #168).

## 1.12.0 — 2026-10-03

**Added**

- Settings › Notifications › Website chats says whether this computer rings for you, and Where to ring — this app when it is running, the browser first, or every device — kept on the server for all your devices (RING-UI-08)

## 1.11.5 — 2026-10-03

- High contrast in Appearance; Sinhala and Tamil text for the Outlook-class Mail features (ENH-MAIL-03).

## 1.11.4 — 2026-10-03

- Make app locking opt-in by default, preserve saved choices and explicit policies, and disable inactive automatic-lock controls (#181).

## 1.11.3 — 2026-10-03

- Command palette shows a command's shortcut hint; Mail commands, Quick Steps, automatic replies and rules can be run from it.

## 1.11.2 — 2026-10-03

- Sinhala and Tamil text for the Manage dialog's hints.
- Command palette result footer (#148): Open is a 44 px brand-gradient button with a glass ↵ chip; New window and Copy link are 40 px glass buttons showing Ctrl/⌘+↵ and Ctrl/⌘+C only when they work; Copy link turns into Copied with a check for 1.5 s; focus rings everywhere, no lift or scale with reduced motion. Ctrl/⌘+C copies the result's link when nothing is selected.
- Remote control on macOS (#147): Check again really asks macOS again (the app and its input helper, no cached answer); the status also re-checks when you return to WorkSuite and every 2 s while access is missing; "Access granted — restart WorkSuite to finish" with a Restart button when macOS needs a relaunch; the running copy's path, bundle ID, Team ID and signing identity are shown, with warnings for unsigned, translocated or duplicate copies, and steps to remove and re-add the permission.
- Guest mode (#149): Backup & Data and Profile live in the normal Settings for a Local Profile, with account-only options hidden; ⌘K lists locked apps that open the Sign in panel; Sinhala and Tamil text.
- Settings › Mail gains Import mail, Rules & blocked senders, Signatures, Storage & sync and Appearance & reading, and can make WorkSuite your mail app for mailto: links; Sinhala and Tamil text.

## 1.11.1 — 2026-10-03

- Settings › Mail: accounts with status and Repair, Manage, offline period and local size with Clear, notifications and badge; storage and sync; appearance; Sinhala and Tamil text for Mail.

## 1.11.0 — 2026-10-03

- Add verified per-account lock-screen controls, custom idle timeouts and separate sleep and notification preferences (#115).

## 1.10.2 — 2026-10-03

- AI Assistant setting Auto-minimize when I continue working (on by default) (#126); Sinhala and Tamil text for it.
- Login screen: Continue as Guest, with a short explanation; Sinhala and Tamil text for the Local Profile (#141).

## 1.10.1 — 2026-10-03

- Default new or missing AI display preferences to the floating widget without opening chat at startup (#127).

## 1.10.0 — 2026-10-03

- Modernized global search filters, responsive result details, file metadata and stable selection (#129).

## 1.9.6 — 2026-10-03

- Sinhala and Tamil text for the Messenger and Instagram channels (#36).

## 1.9.5 — 2026-10-02

- Sinhala and Tamil text for announcements (#98).
- Sinhala and Tamil text for the WhatsApp channel; search no longer lists WhatsApp as its own app — it opens Chat's WhatsApp channel (#35).
- Sinhala and Tamil text for the meeting More menu (#124).

## 1.9.4 — 2026-10-02

- Expose running-app and helper permission evidence; invalidate stale macOS Accessibility checks (#132).

## 1.9.3 — 2026-10-02

- Sinhala and Tamil text for images in the AI Assistant (#59).

## 1.9.2 — 2026-10-02

- Sinhala and Tamil text for the new call states (#113).

## 1.9.1 — 2026-10-02

- Greeting now picks morning/afternoon/evening correctly when the 12-hour clock is set; Sinhala and Tamil text for the new Home.

## 1.9.0 — 2026-10-02

- Add a shared Sinhala/Tamil localization pipeline, first-time language selection, per-user language persistence, locale formatting and reproducible translation audits. Catalogs are drafts; full translation and fluent review remain pending (#60).

## 1.8.0 — 2026-10-02

**Added**

- Settings › AI Assistant › Auto-minimize after sending, and an AI Assistant row under Notifications › By app to mute the assistant's notices (worksuite-desktop#110).
- Security › Access while locked: show the sender, and show a preview, in notifications while WorkSuite is locked (both off by default, within the organisation's minimum) (worksuite-desktop#114).

## 1.7.2 — 2026-10-02

- Cancel outdated global searches during debounce, hide stale results, and isolate online/offline search caches by server, user and access refresh (#57).

## 1.7.1 — 2026-10-02

**Added**

- Meet Livestreaming destination settings with masked stream keys and platform eligibility guidance.

## 1.7.0 — 2026-10-02

**Added**

- Security access-while-locked preferences for calls, caller details and plain text chat, constrained by organization policy.

## 1.6.0 — 2026-10-01

**Added**

- Seven persistent dark color profiles with palette previews and reset in Preferences Appearance (#73)

**Changed**

- Shared theme tokens and legacy window chrome follow the selected profile across all renderer windows
## 1.5.1 — 2026-10-01

**Fixed**

- Verify the running macOS input helper, distinguish unavailable permission checks, and refresh Accessibility status without blanket reset advice (#84).

## 1.5.0 — 2026-10-01

**Added**

- Settings › Files & Sync shows Drive settings: transfers, bandwidth, storage and notifications for this computer (worksuite-desktop#95).

## 1.4.0 — 2026-10-01

- Settings › Meet › Recording (worksuite-desktop#68): how meetings are recorded from this computer — on the server or here, quality, layout, the Drive folder, where local recordings are saved and how long the local copy is kept.
- Speech model for meeting transcripts, in Settings › Local AI and Settings › Meet › Transcription (worksuite-desktop#81): add, change or remove a whisper.cpp model so transcripts are made on this computer.

## 1.3.0 — 2026-10-01

**Added**

- Settings › AI Assistant › Allow online fallback (#52): on by default, it explains that the question and the content needed are sent to WorkSuite AI when the model on this computer cannot answer. Off, nothing leaves the computer
- Settings › AI Assistant › Module Access (#51) — per module, Read data and Create or update for WorkSuite AI and Local AI; administrators set the organization's limit under For everyone

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

**Fixed**

- Settings › Remote control no longer says "This computer can be shared, but not controlled" once macOS Accessibility is on (#47). Access is asked again on opening the screen, on coming back from System Settings, and with Check again. It is also asked of the helper that injects the input. "Accessibility access enabled" shows when it is on. When it still reads as off after a visit to System Settings, the screen explains removing an earlier version's entry or reopening WorkSuite, instead of asking again. Granting it never starts a session: each request still needs your approval

## 1.2.0 — 2026-10-01

**Added**

- Settings → Local AI shows the time left while a model downloads (#49)
- Settings → Local AI shows each model's version, download size, the memory and computer tier it needs, its licence (with a link) and required notice; Download and set up, Cancel during a download, Setting up… while the model is tried, Ready to use once it answered, and Test / Test again (#55)

## 1.1.0 — 2026-09-30

**Added**

- AI Assistant › Display mode — Header icon & drawer, Floating chat widget, or Hidden — and Sound for new answers (#61)

**Changed**

- About names Livezen Technologies LLC as owner, with this year's copyright and worksuiteone.com, opened in the default browser; the open-source notice stands apart (#48)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
