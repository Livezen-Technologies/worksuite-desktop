# mail — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.9.0 — 2026-10-03

- Composer: one formatting row of grouped icon buttons (style, font, size, colour, highlight, align, lists, checklist, indent, line spacing, format painter) with a separate actions row (Attach, Template with Quick Parts, Signature, Suggest times, Mail merge, Options) that moves what doesn't fit into More; pictures from the computer, Files, a link, paste or drag-drop with size, alignment, alt text, link, corners, border, crop and automatic compression, sent inside the message; tables with a grid picker and table tools; emoji, line, quote, code, date, special characters, button, meeting link and merge fields; Word/Excel paste clean-up and paste options; Markdown shortcuts; spelling suggestions on right-click with a language choice (#188).
- Folder and account right-click menus: sync this folder, mark all as read, new subfolder, rename, move, delete, empty Deleted Items/Junk, favourites, unread or total count, keep on this computer (all / recent / headers), properties; core folders protected. Mail shows what this computer saved first and refreshes, opened and next messages open instantly, folder actions work offline with rollback, offline search covers saved mail, and a removed account's saved mail is wiped. Large mailboxes sort and group much faster (#162).

## 1.8.3 — 2026-10-03

- Sync buttons use the shared Sync button: they spin from the click, can't be pressed twice, show Synced just now or Sync failed · Retry, and keep one width (#165). Mail's ↻ icons show the same states.

## 1.8.2 — 2026-10-03

- The setup banner after choosing Outlook shortcuts is clearer and fits any window: Import email first, Add signature and Set as default mail app second (in More when narrow), and a dismiss icon; dismissing is remembered (#187).

## 1.8.1 — 2026-10-03

- The message menu is drawn by the shared context menu (#183).

## 1.8.0 — 2026-10-03

- WorkSuite links in messages open in an app tab, not the browser; verified WorkSuite notification mail shows an action card with the item's current state and buttons (Open, Download, Show in Files, Join meeting, Snooze, Mark done), spoofed mail a warning and no buttons; Open in WorkSuite by Reply (#170).

## 1.7.0 — 2026-10-03

- New email is the shared split button with New email from a template, in a new window, an event invite and a contact (#171). One accurate sync status: an out-of-date account is amber, never green; N of M mailboxes live from the real connections; the footer card opens each account's state with Sync now, Fix and Sync all (#172). Sort & Group menu with icons, a direction switch in the field's words, the current sort on the toolbar, Show conversations, Apply to all folders, Reset to default and grouping by conversation (#168).

## 1.6.0 — 2026-10-03

- ENH-MAIL-03 phases 4–5: data files — import PST, MBOX, EML and MSG (parsed in a separate sandboxed process, no duplicates on re-import) and export; open .eml/.msg; archive policy per folder; Report phishing; safe links checked on this computer and against the organisation's blocked list; Recall, voting and read-receipt answers (guaranteed only between WorkSuite mailboxes, as the app says); S/MIME signature checking; pictures loaded on request through WorkSuite; harmful attachments saved but never opened; reminder window and offline reminders; tasks, contacts and meetings from a message, contact groups, Add from signature, Reply with meeting, Mentioned me; Quick Steps copy to folder, Log in CRM and helpdesk ticket; ignore and clean up conversation; conditional formatting, plain text per sender and immersive reader; which mail alerts, VIPs through quiet hours, more banner actions; Apps pane, Catch up, Suggest times and more drafting tools; decline invitations while away; mail merge; screen-reader new-mail announcements.

## 1.5.0 — 2026-10-03

- ENH-MAIL-03 (Outlook-class) phases 1–3: All Accounts folders (Inbox, Sent, Drafts… across every account) and Sync all with one shared sync status, per-account sync details and log; Focused and Other with Move / Always move; pins; snooze with a Snoozed view; flags with dates that become tasks; categories shared with Calendar and Tasks; Sweep; multi-select with a selection pane; view settings per folder; WorkSuite, Outlook or Gmail keyboard shortcuts with a shortcut sheet and rebinding; Favorites, Go to folder and Find in message; Quick Steps and Quick Parts; importance, sensitivity and receipts; signatures per account with fields from your profile; rules with exceptions, rules that run on this computer, Run now and rule errors; forgotten-attachment and missing-subject checks; @mentions; meeting invitations in the message with Accept / Tentative / Decline / Propose new time, updates and cancellations; My Day pane with events, flagged mail and tasks; people cards and a VIP view; recipient suggestions from your recent contacts; automatic replies with separate inside and outside messages; external-sender tag and first-time sender hint.

## 1.4.0 — 2026-10-03

- Mail SRS v2.2 and designs D04–D14: Import my old mail (D08) with progress, folders, what wasn't copied, pause/resume/cancel; shared mailboxes (D06) with internal notes, snooze (woken by a customer reply), who else is viewing, reply as the shared address or as an internal note; search (D07) with an attachments panel, Folder/Label/From filter chips and Best match; Accounts & offline (D04) with offline counts per account, download message bodies, app passwords and making WorkSuite the mailto: handler (prefilled compose that never sends on its own); Storage & sync (D09) with a breakdown against the organisation's limit, keep period per mailbox and the WorkSuite copy's window and use; Appearance & reading (D10): open in tabs, previews in the list, dark email content with a light card for designed emails; Copy link, Save to Files (message or attachment), Start meeting and Remind me (D13/D14); automatic reply, filters and blocked/safe senders; signatures in Settings. A mailto: body or a meeting invitation opens as your own text, not a quote, and Bcc from a mailto: link is kept.

## 1.3.0 — 2026-10-03

- Compose has a real editor (design D05): a visible writing surface with a formatting toolbar — undo/redo, Normal/Heading/Subheading, bold, italic, underline, strikethrough, text colour and highlight, link (http/https/mailto only), table, bulleted and numbered lists, indent, quote, clear formatting — with Ctrl/⌘ shortcuts and Markdown-style list starts; recipients as chips with suggestions from Contacts; Attach from Files; Insert template; the signature below a '-- ' line; Write with AI works on your own words only; the quoted email is a collapsible block left untouched; mail is sent as cleaned HTML with a matching plain-text part; old plain drafts are converted; Send is one control with equal halves, Send later is secondary and Discard is quiet red text. Pasted pictures are attached rather than placed inline.

## 1.2.1 — 2026-10-03

- The switches in a mailbox's Manage dialog show their names and a one-line hint (Show in the unified inbox, Notify me about new mail, Pause syncing) — they were bare toggles; Remove… reads as a red danger action.
- New email is a 44 px brand-gradient button with white text, a glow, an N shortcut chip and a 1 px lift on hover; the search button beside it is a 44 px glass square labelled Search mail (/) (#148).

## 1.2.0 — 2026-10-03

- Mail rebuilt to the WorkSuite Mail desktop design: sidebar with mailboxes and a unified inbox, smart views with counts (Unread, Starred, Important, Today, Has attachments, Scheduled, Drafts), folders, labels and a sync card; list with search across all mailboxes, filter chips, date groups and account badges; reading pane with message tabs, full toolbar, SPF/DKIM/DMARC chip, AI Summarise / Action items / Translate, action bar and status bar; offline banner, queued actions marked on rows and a Waiting to send panel with Undo; Add a mailbox (WorkSuite Local mailboxes from your admin, Microsoft 365, Google, IMAP/SMTP, POP3/send-only, offline period); compose in its own tab with Send later and Undo send; shared-inbox tabs and assignment; search operators (from:, to:, has:attachment, is:unread, is:starred, before:, after:); density, reading-pane, sort/group and conversation menus; More menu actions; keyboard shortcuts (j/k, Enter, e, #, !, s, u, r/a/f, n, /). Message HTML stays sanitised and remote images blocked.

## 1.1.0 — 2026-10-03

**Added**

- AI tools (#53): Write with AI in a new message or reply (Draft a reply from the email you answer, Improve writing, Make shorter, Make professional, Fix spelling and grammar) and Summarise on an open email. It uses the model on this computer first and online AI only when allowed, and what it writes is shown to check and edit before it replaces your text. The quoted email is never rewritten

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
