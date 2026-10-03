# chat — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.14.0 — 2026-10-03

**Added**

- website chats, with the server's Communication 1.11.0: each row in the list says what was said last (who said it,
  unless it was the visitor) and how many visitor messages wait unread; search, after a pause in typing, goes to the
  server and covers what was said and closed chats; Reply on a message quotes it above the answer, for the visitor
  too (RDC-10); From Drive sends the visitor a copy of a Drive file, never a link, refused with the server's reason
  when the visitor cannot receive it (RDC-05)

## 1.13.0 — 2026-10-03

**Added**

- website chats ring through the server's ring sessions (WS-WCHAT RING-49, RING-10/11/05/12): this computer heartbeats as a ringing device and stays silent, window still showing, while another of your devices has the ring; Silence goes to the server and holds on all your devices until at risk; a chat given to you counts down to its handover with Pass to next; the window says why a ring stopped — the visitor left, ended it, it was closed or blocked, or who joined. An older server without ring sessions rings as before

## 1.12.0 — 2026-10-03

**Added**

- a website chat in a small window of its own (WS-WCHAT RDC-16): Open in new window from the conversation's header opens just the thread with Team Chat's composer in its window look, Accept and Close in its header; one window per conversation, its draft carried over, Open in main app back to the workspace

**Changed**

- the composer and a notification's reply build the same outbox reply to a visitor (shared/website-reply.ts)

## 1.11.0 — 2026-10-03

**Added**

- the Website Chats inbox as drawn in WS-WCHAT-SRS v1.5 (CHAT-UI-00): Open, Mine and Closed with counts over the list; rows with the visitor's on-site dot, a live waiting timer, Awaiting reply / You / At risk / Offline / priority chips, the site and whether they are away; a bell on a chat ringing here and amber with the bell struck through when silenced on this computer (RING-UI-04)
- "Pick a conversation" says how many visitors are waiting and how long the longest has, with Open the longest waiting and Visitors online; J and K move through the list

**Changed**

- the website thread's details panel (CHAT-UI-01): the visitor at the top with their email, then Visitor, Journey (each page with its time) and Shared files (open from the panel); the header's avatar shows whether the visitor is on the site

## 1.10.2 — 2026-10-03

- Show every shared record card without a coloured message frame, with grouped captions and receipts; quiet completed task urgency (#173).

## 1.10.1 — 2026-10-03

- Keep newer composer drafts when a pending send finishes and prevent duplicate submissions (#156).

## 1.10.0 — 2026-10-03

- Use the shared chat composer for WhatsApp with channel sending, attachment validation, AI, drafts and blocked controls (#156).

## 1.9.0 — 2026-10-02

- Messenger and Instagram as channels of Chat (#36): connect from + Add Channel (Facebook Login in the browser, then pick the Page or Instagram account); toolbar channels with unread badges and a warning when an account is not connected; conversation list with search and Unread, each labelled with channel and account; read and reply with attachments (Instagram: images, video, audio; Messenger: any file up to 25 MB); the composer explains when sending is unavailable (no permission, not connected, outside the 24-hour window, unsupported or too large attachment); settings with status, errors, Check connection, Reconnect and Disconnect; no call buttons.

## 1.8.0 — 2026-10-02

- WhatsApp is a channel of Chat (#35): it replaces the separate WhatsApp entry (sidebar, launcher, search), and old WhatsApp links, tabs, notifications and worksuite://whatsapp deep links open the same conversation in Chat; the channel shows to anyone with WhatsApp access, also before a number is connected if they may connect one; attachments display (pictures inline, files open, Office files in a tab); send files with a caption, approved templates once the 24-hour window has closed, and start a conversation from a number; WhatsApp settings (numbers, status, Check connection, Link again, Make default, Unlink, Connect a number) from the list's gear and Add a channel; Chat access alone never opens WhatsApp, and WhatsApp-only people see only that channel.

## 1.7.0 — 2026-10-02

- Chat › Calls tab in the full Chat page, shared with the drawer (#113); call cards and the log say Busy, No answer and Cancelled and refresh as calls ring and stop; Voice and Video call buttons show only where the room supports calling (not website visitors, notice rooms or unconfigured servers).

## 1.6.0 — 2026-10-02

**Added**

- Separate opt-in plain text chat while locked, with hidden conversation previews and unlock required for files, linked records and other modules.

## 1.5.0 — 2026-10-01

**Added**

- Instant outgoing media bubbles with previews, accurate upload stages, cancellation and retry (#83)
- Original Quality option and background image optimization

**Changed**

- Voice, camera and pasted media use durable native chunk uploads with ordered message confirmation and background sending

## 1.4.0 — 2026-10-01

- Chats open in windows of their own: Open in New Window from the drawer and conversation, Open in main app, several at once, drafts and uploads kept on close, closed on sign-out (#103).

## 1.3.0 — 2026-10-01

**Added**

- type / in the message box for Load saved replies (searchable) and Suggest reply (from the conversation, with Local AI or the workspace's assistant); what is picked goes into the box to edit and is sent only when you send it — in Team Chat, website chats and WhatsApp (#32)
- AI tools in the message box (#53), for Team Chat and website chats: Suggest a reply, Summarise the conversation, Improve writing, Make shorter, Make professional, Fix spelling and grammar. They use the model on this computer first and online AI only when allowed. The result is shown to check and edit first, then put in the box (never sent by itself) or copied

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.2.0 — 2026-10-01

**Added**

- A channel toolbar down the far left of Chat (#33): Chat, Web Chat and WhatsApp, each with its unread (or waiting) count, a warning when a number is not connected, and "Add a channel". Picking a channel shows its conversations in the list; ↑ ↓ Home End move along it, and it stays when the list is hidden
- WhatsApp conversations in Chat: the numbers shared with you, the list (All, Unread, Waiting, Mine, a number picker, search), the thread, and a reply box whose draft is kept per conversation. It says why a reply cannot be sent (a viewer's access, the 24-hour window, a number that is not connected)
- "Add a channel": where WhatsApp and Web Chat stand for you; connect a WhatsApp number by QR code, or link a disconnected one again; set up the website widget or a Business Platform number on the web
- Profile pictures in Chat (#37): people's current pictures in the conversation list, the conversation's header, beside their messages, in the details, the member lists, the new-conversation picker and @-mentions; the initials (on the colour that name always has) when there is none, it fails to load, or its owner does not show it to you. A changed picture shows without signing out. Groups keep their rounded-square initials. A WhatsApp contact's picture shows when the server sends one
- A Meet meeting's card in a conversation (#71): the meeting's name (cut short, with the whole of it on hover), who started it and when, Live (with a pulsing dot) or Ended, and one action — **Join** (it shows that it is joining and cannot be pressed twice), **Return to meeting** when this computer is already in it, or **View details** once it has ended (when it started, how long it ran, who was in it, whether it was recorded). A removed meeting has no action. Smaller in the chat drawer
- The conversation list can be made wider or narrower by dragging its edge, or with the arrow keys once the edge is focused; it stays between 240 px and 560 px, is remembered on this computer, and a double-click (or Enter) puts it back to 300 px (#34)

## 1.1.0 — 2026-10-01

**Added**

- attachments open in a preview over the conversation — pictures with zoom, rotate, full screen and ‹ › through the conversation's (or the Media tab's) pictures; video and sound with their players; CSV as a table (first 1,000 rows); text as text — with the name, type, size, Download and Open in app, loading, error and Try again (#38)

**Changed**

- a PDF still opens in PDF Studio and a Word, Excel or PowerPoint file in a WorkSuite tab; Web Chat files open in the same preview (#38)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
