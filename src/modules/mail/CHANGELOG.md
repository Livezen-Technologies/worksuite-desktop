# mail — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.2.1 — 2026-10-03

- The switches in a mailbox's Manage dialog show their names and a one-line hint (Show in the unified inbox, Notify me about new mail, Pause syncing) — they were bare toggles; Remove… reads as a red danger action.

## 1.2.0 — 2026-10-03

- Mail rebuilt to the WorkSuite Mail desktop design: sidebar with mailboxes and a unified inbox, smart views with counts (Unread, Starred, Important, Today, Has attachments, Scheduled, Drafts), folders, labels and a sync card; list with search across all mailboxes, filter chips, date groups and account badges; reading pane with message tabs, full toolbar, SPF/DKIM/DMARC chip, AI Summarise / Action items / Translate, action bar and status bar; offline banner, queued actions marked on rows and a Waiting to send panel with Undo; Add a mailbox (WorkSuite Local mailboxes from your admin, Microsoft 365, Google, IMAP/SMTP, POP3/send-only, offline period); compose in its own tab with Send later and Undo send; shared-inbox tabs and assignment; search operators (from:, to:, has:attachment, is:unread, is:starred, before:, after:); density, reading-pane, sort/group and conversation menus; More menu actions; keyboard shortcuts (j/k, Enter, e, #, !, s, u, r/a/f, n, /). Message HTML stays sanitised and remote images blocked.

## 1.1.0 — 2026-10-01

**Added**

- AI tools (#53): Write with AI in a new message or reply (Draft a reply from the email you answer, Improve writing, Make shorter, Make professional, Fix spelling and grammar) and Summarise on an open email. It uses the model on this computer first and online AI only when allowed, and what it writes is shown to check and edit before it replaces your text. The quoted email is never rewritten

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
