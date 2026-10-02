# files — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.2.1 — 2026-10-02

**Fixed**

- Show Processing until media is ready and offer retry guidance when playback fails (#88).

## 1.2.0 — 2026-10-01

**Added**

- One transfer queue for every upload and download in the app, two at a time by default (worksuite-desktop#94):
  - The rest wait their turn in the order they were added, and the next starts when one finishes, is paused, is cancelled or fails.
  - The Transfers panel has Active (progress, speed, time left), Queued (place in line) and Completed & failed sections, and a summary such as "2 transferring · 8 queued".
  - Pause, Resume, Cancel and Retry for each file, plus Pause all and Resume all. Resuming or retrying goes back into the queue.
  - A temporary failure is tried again a few times, each try later than the last, without holding a slot.
  - The queue survives a lost connection and a restart, and partial transfers carry on from where they stopped.
  - A transfer is never started twice, and an upload that already reached the server is not sent again.
  - Clear finished removes only finished entries.
- Drive › Settings, also in Settings › Files & Sync (worksuite-desktop#95). It applies to this computer, says so, and has Reset to defaults:
  - **Transfers:** how many at once in total, with optional upload and download limits within it. Changes apply at once: lowering the limit lets the running ones finish.
  - **Bandwidth:** upload and download caps, Unlimited or Custom in KB/s or MB/s, shared by every transfer going that way.
  - **Connection:** pause and resume all, resume automatically after reconnecting, and what to do on a metered connection.
  - **Downloads:** the download folder, or ask where to save each time, and the default answer to a name conflict (Ask, Keep both, Skip, Replace).
  - **Storage & Sync:** Drive quota, local cache and offline files. The cache can be cleared without touching any file, pending upload or offline file, and synced folders are managed from here.
  - **Notifications:** for finished and failed transfers.
  - These settings do not change account storage or server file-size limits.

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
