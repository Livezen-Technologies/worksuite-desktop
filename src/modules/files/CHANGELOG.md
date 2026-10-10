# files — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.11.0 — 2026-10-10

**Added**

- right-click, hover ⋯ and keyboard menus on sidebar folders, quick links and the Folders header, rename in place, drag and drop, Undo (#328); redesigned Share dialog (#329)

## 1.10.0 — 2026-10-10

**Added**

- Open with ▸ on Word, Excel and PowerPoint files and an Office files setting per kind (#322); .pptx previews in the slide viewer (#321)

## 1.9.0 — 2026-10-10

- Photo viewer and editor (ENH-03): rating, tags, compare, loupe, region comments, location, slideshow options; a new editor shell with straighten, corners, text presets and effects, shapes, stickers, frames, filter strength and presets, before/after; one Save to Drive dialog with conflict handling; version compare; batch edit; Create image; AI panel; offline editing of synced photos with a recipe sidecar; a Sync conflicts card; drag in and out; Open with › System editor.

## 1.8.6 — 2026-10-08

- Saved WhatsApp conversations take in only what changed (since=), and older pages are not saved

## 1.8.5 — 2026-10-07

**Changed**

- the list view's row checkboxes use the shared lead column with a 32px click area, Select all lined up above them (#290)

## 1.8.4 — 2026-10-06

**Security**

- the renderer's API proxy refuses /api/auth/apps/* — a sign-in handed to WorkSuite Office is the main process's alone (worksuite-office#6).

## 1.8.3 — 2026-10-05

- File viewer: Couldn't open this file with Retry and Open in its app, 60 s limit (#253)

## 1.8.2 — 2026-10-05

- Drive speed limits use the shared NumberField (#232); Share opens the sharing dialog from ?share=1 (#240)

## 1.8.1 — 2026-10-04

- The offline body download asks in the background, carries the message's identity, backs off per message and waits while an account builds its first headers (#228)

## 1.8.0 — 2026-10-03

- The organisation filter is the shared compact switcher (#214): one pill, search, several at once, a default organisation, remembered per person.

## 1.7.1 — 2026-10-03

- Keep local WhatsApp cache reads scoped by server and organisation and support clearing refused API prefixes (#158).

## 1.7.0 — 2026-10-03

- Sharing tells people: the share dialog has Notify people with a message and chat/email choices; Shared with me shows how many new shares you haven't opened (#164).

## 1.6.5 — 2026-10-03

- Sync buttons use the shared Sync button: they spin from the click, can't be pressed twice, show Synced just now or Sync failed · Retry, and keep one width (#165).

## 1.6.4 — 2026-10-03

- A link to a file you can't open offers Request access in the app (#170).

## 1.6.3 — 2026-10-03

- The sidebar's New button is the shared primary action button: same size, colour, plus icon and quiet shadow as every module; the shortcut is in its tooltip (#171).

## 1.6.2 — 2026-10-03

- Mail data files and exports go through the transfer and download paths (ENH-MAIL-03).

## 1.6.1 — 2026-10-03

- The API proxy decides per mailbox whether a message body is kept offline (each mailbox can now have its own keep period).

## 1.6.0 — 2026-10-03

- Add adaptive video playback with automatic/manual quality, bounded buffers, same-origin signed HLS proxying, cancellation on close and recoverable preparation states. Keep original download/local-open available (#56). Production CDN and large-file measurements remain pending.

## 1.5.0 — 2026-10-02

**Fixed**

- Apply bandwidth changes immediately to waiting transfers and activate metered policies through a device-local connection control (#95).

## 1.4.1 — 2026-10-02

**Fixed**

- Enforce a hard maximum of two concurrent transfers across all modules and preserve retry backoff after restart (#94).

## 1.4.0 — 2026-10-02

**Added**

- Meeting recording progress and independent download status on Drive Home and file details (#89).

## 1.3.1 — 2026-10-02

**Fixed**

- Show media processing and playback failure retry guidance (#88).

## 1.3.0 — 2026-10-02

**Added**

- a stacked style for menus opened from a button: an icon tile beside a title and a description, one highlight that follows the pointer and the keyboard, and a lighter shadow (worksuite-desktop#90).

**Changed**

- a menu opened from a button now opens above it when there is no room below, is never wider than the window, and acts only once per opening.
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
