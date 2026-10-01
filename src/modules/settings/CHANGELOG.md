# settings — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

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
