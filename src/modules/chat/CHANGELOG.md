# chat — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.18.1 — 2026-10-03

**Fixed**

- a website reply written from a saved reply ("/" or a chip) tells the server which one, so its use is counted and the
  most used come first (RDC-03, with Communication 1.13.0)
- files for a website visitor are held to that website's own size limit from the thread, not a fixed 5 MB (RDC-04)

## 1.18.0 — 2026-10-03

- A file or folder shared with you from Files arrives as a card in your chat with the sharer (or the team's chat), with Open, Download, Show in Files and Request edit access; several files make one card, and the card updates when access changes or ends. The "is open — messages can link to it" notice is a small chip in the message box (#164).
- Right-click any conversation (Chat, WhatsApp, Website): Open in new window, Mark read/unread, Pin (max 5), Archive with an Archived section, Favourite, Mute for 8 hours / 1 week / always, Contact info, calls, Block, Export (.txt or .zip, audited), Clear (keep starred) and Delete with 5-second Undo; group, meeting and System chats get their own actions; WhatsApp adds Assign, waiting/done and Add/Link/Open contact, Website adds Assign, Transfer and Close. Multi-select with Ctrl/Shift-click or Select mode, keyboard shortcuts, muted chats left out of the badge, and one presence source everywhere (#183).
- WhatsApp shows contact names: numbers are matched to Contacts in any format (07x, +94, spaces, dashes) and named contact first (with company), then the saved name, then ~WhatsApp name (Not in contacts), then a formatted number — in the list, header, group senders, mentions, search and tab title. Groups show their real name and member count. Add to contacts and Link to existing contact for unknown numbers, a contact side panel from the header, and live updates when a contact changes. Fixed: "is not connected" while messages arrive, "Message" previews, and photo previews (#176).

## 1.17.0 — 2026-10-03

**Added**

- voice calls from the website chat widget, with the server's Communication 1.11.0 (WS-WCHAT ENH-WCHAT-05, VOICE-10…16,
  VOICE-UI-02/03): a visitor calling rings the call window and the bar under the tabs as an INCOMING VOICE CALL card,
  before chats and invitations, with who, where, whose chat it is, their last words, how long they have waited, Answer
  and Decline (`ring:call`), the strong tone (through Do not disturb unless it shows cards only), the tray's "Answer —"
  and Ctrl/Cmd+Shift+A; a colleague answering first, or the visitor hanging up, is said in the window
- answering joins the call's own LiveKit room with the microphone only (`website/call.ts`), and the thread shows the
  in-call bar: the time, the connection, the visitor speaking, Mute (Ctrl/Cmd+Shift+M), Hold (the microphone off and
  the visitor hearing the hold tone), Invite, Transfer and End, which asks for call notes kept as a note only staff see
  and offers Leave the call when a colleague is on it too; a colleague's call in my chat offers Join call, and a call I
  am on elsewhere offers Rejoin audio or Leave; the tray says "On a call with …" with Return to the call, and the
  updater waits
- Offer call in the thread's header (VOICE-15); rows say "On a call · 2:14" or "Calling"; Missed chats lists the visitors
  waiting to be called back, with their number and best time, logged as Answered, No answer or Wrong number (VOICE-16)
- the ring heartbeat says whether this computer has a microphone (`ring:mic`, from the main window's devices): one
  without is not rung for calls (VOICE-11)

## 1.16.0 — 2026-10-03

**Added**

- live typing, delivered and read in website chats, with the server's Communication 1.11.0 (WS-WCHAT ENH-WCHAT-04,
  LIVE-02…08, LIVE-12): the composer says typing started and stopped (a note's typing marked internal, never shown to
  the visitor); the thread reports the visitor's messages delivered, and read while it is in front, and shows the
  visitor's typing and colleagues' ("Nimal and Dilini are typing…") from the live frames at once; each team message
  is ticked sent, delivered or read, the latest says Delivered or Read with the time, and the visitor's latest says who
  read it; a row in the list says Typing… while its visitor types; unread counts come from the server's read marks

## 1.15.0 — 2026-10-03

**Added**

- several staff in one website chat, with the server's Communication 1.11.0 (WS-WCHAT ENH-WCHAT-03, TEAM-UI-01/02):
  the thread's header shows everybody in it, owner first, with Invite and Transfer; the details panel's "In this chat"
  lists each person's role, when they joined and who invited them, invitations and transfers still waiting with Cancel,
  Leave chat (an owner is offered Transfer or Close instead), Remove for the owner, and a supervisor's Monitor, Join and
  Take over; the Invite dialog picks colleagues by availability, open chats and department (offline people and those
  already in it cannot be picked; somebody not on the site's staff is marked) or a department, with a note; the
  Transfer dialog sends to a colleague, a department or the next available agent, warm or handed over now, with a
  handover note
- the composer's Reply to visitor / Internal note tabs: a note only staff see, amber, with @mentions; notes and the
  staff-only event lines are drawn as such in the thread, and each person signs their first message in a run
- invitations and transfers ring in the call window and the bar under the tabs as INVITATION and TRANSFER TO YOU cards
  with who asks, the note, a countdown, Join chat or Accept, and Decline (`ring:handoff`); the inbox's new Invited
  section lists them; Mine includes chats I take part in, marked Participant, and a row several staff are in shows their
  faces; a declined or unanswered invitation is said in the thread with Try someone else; somebody removed from a chat
  is told and their draft to the visitor is dropped

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
