# support — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.1.0 — 2026-10-06

**Added**

- the native Support module (WS-SUPPORT-SRS-001 FR-DSK-01): registered with its manifest — read cache offline, notifications, file drop, quick actions — and opened natively instead of in the browser; shown to whoever holds support.view (or an as-built ticket.* permission) rather than behind an app slug the server never grants
- the API client for /api/support/v1 with its types, falling back to the as-built /api/tickets (list, show, reply, status, assign, take, agents) on a server without v1, and degrading the rest (views without counts, no badge, no presence)
- deep links worksuite://support and worksuite://support/ticket/{id} (by id or reference, FR-DSK-05); a ticket opens in a tab of its own, brought forward when it is already open (WF-12), and the web's /tickets?ticket= links open it too
- the support inbox, D-01: three panes — the views rail with live counts (overdue red, unassigned amber), saved views and the organisation filter; compact rows (status dot, channel icon, monospace reference, Urgent/High chip, requester, SLA chip, unread bold with a blue edge) a page at a time with the server's cursor; search, status and priority filters and the sort; the reading pane with the header, who else is on the ticket, the conversation with notes marked Internal and "New since you last viewed", Take it, Resolve and Open in tab
- the inline reply in the reading pane: a reply or an internal note (a note unless chosen), ⌘↵ / Ctrl+Enter to send, a retry key so a resend is one message, and the draft kept on this computer per ticket
- the keyboard of FR-WSP-06: j/k move, Enter or O opens the ticket's tab, R reply, N note, E resolve (with what fixed it, sent with the version shown), / search
- availability: Online or Away (Chat's presence, the one routing reads) and my open tickets against my capacity, ⌥⌘A / Ctrl+Alt+A to switch
- live: desk hints ask the lists, counts and badges again (once for a burst), ticket hints that ticket, presence hints show who is on it; without the realtime gateway the inbox polls every 30 s; a ticket read in the pane is marked read once it has been shown for a moment (fetched with peek), and says I am here (viewing, typing, left)
- the ticket tab, D-02: the conversation with "New since you last viewed" and earlier messages on request, the journal (Activity), what it is linked to and its files; Take it, Follow, Remote, Escalate, Resolve, and the web for the rest; merged and trashed tickets read-only; who else is on it (viewing every 30 s, typing, left when the tab closes or goes behind another)
- the properties: status through the moves allowed, priority, assignee with presence and load, team, category, department, due date and tags, each sent with the version shown — a ticket somebody changed first opens the conflict review (keep theirs, or set mine on top)
- the side panels: the SLA's first, next and resolution timers as the server keeps them, the requester with their other tickets and CRM contact, the files (opened with the system's application), related records, and remote support — RustDesk's Connect and the server settings to import
- the full composer: To and CC, "/" canned responses filled in by the server, @mentions in notes, the status after sending, files dropped on it (a drop target naming the ticket), pasted (a screenshot becomes a named PNG with its picture) or chosen — uploaded and scanned at once, ten of 25 MB at most — and the draft with all of it kept per ticket; the reading pane's inline reply is the same composer
- native notifications, D-03 (electron/services/support-notices.ts): the desk's notifications shown with their own buttons — an assignment with Open and Take later (back in an hour while still mine and unread), a requester's reply with Open, Mark read and a reply typed in the banner (a public reply, macOS and Windows), a mention in a note (from the ticket's hint) answered with a note, an SLA warning or breach with Open and Snooze 10 min that stays until acted on — worded from the ticket as it stands; per-kind banner and sound, quiet hours except an urgent ticket's, low-priority tickets in an hourly digest; a reply that cannot be sent is kept as the ticket's draft
- the count on the rail, the Dock, the taskbar and the tray (FR-DSK-04): my live tickets with something unread (GET badges), asked every minute, after the desk's hints and when a ticket is read here; the bell's support notifications are not counted again

## 1.0.0 — 2026-10-06

- The baseline: before this module, the launcher opened Support (`/tickets`) in the browser; there was no desktop module for it.
