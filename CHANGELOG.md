# Changelog

What changed in WorkSuite Desktop, newest first. Entries are written for the
person who has to live with the change — what it does, and where it bites.

---

## 2026-10-02 — 0.2.85: browser guest meetings

- Desktop hosts can read and reply to browser guests in Browser meeting chat. Guests remain limited to the current meeting, and the server enforces admission and host chat settings.
- Keep workspace conversations available to signed-in members and desktop guest chat available in their own expandable sections.

Modules: Meet 1.10.0. Deploy Communication 1.10.0 and its browser chat migration first. Browser camera/microphone checks, permission guidance, waiting-room admission and reconnection are provided by the web/server update for #140; see `docs/BROWSER_GUEST_MEETINGS.md` for deployment and real-browser acceptance checks.


---

## 2026-10-02 — 0.2.84: Messenger and Instagram in Chat

Facebook Messenger and Instagram Direct join Chat, Web Chat and WhatsApp as channels (#36):

- **Connect from + Add Channel.** Facebook Login opens in your browser; then pick the Facebook Page, or the Instagram professional account linked to it. Pages you can't use are greyed out with the reason (no messaging role on the Page, or a permission was declined).
- **In the toolbar,** each connected channel shows its unread count, and a warning if an account has lost its connection.
- **Read and reply in the same chat view.** Every conversation shows its channel and account ("Messenger · Your Page", "@name · Instagram"). Send text and files — Instagram takes images, video and audio; Messenger takes any file up to 25 MB.
- **Clear when you can't send.** Both platforms only allow replies within 24 hours of the customer's last message; the box says so, as it does when you lack permission, the account is disconnected or an attachment isn't supported.
- **Channel settings** show the connection status and any error (sign-in expired, permission removed, not receiving messages), with Check connection, Reconnect and Disconnect. Conversations are kept after disconnecting.
- No call buttons on these channels.

Needs the server update (new Meta module and its migrations), a Meta app with its App ID, App Secret and webhook set up on the server, and Meta's App Review before customers outside your app's testers can connect.

---

## 2026-10-02 — 0.2.83: a tidier meeting More menu

The meeting More menu was one long list that could run off the window. It is now grouped and fits (#124):

- **Three groups.** Meeting Tools (recording, transcription, Activities › Q&A, Polls, Notes, Files, Whiteboard; Meeting Info › details, join link, room settings), Host Controls (host controls, livestreaming, Lock/Unlock Meeting, recording settings) and View & Layout (Layout, Video, Full Screen, floating window). Secondary options sit in submenus, so the menu is short.
- **Says what is going on.** Stop Recording, Stop Transcription, Unlock Meeting, Exit Full Screen. Something you can't use stays visible, greyed, with the reason — "Only the host and co-hosts can lock the meeting".
- **Stays on screen.** It opens above the call controls without covering them, flips to fit, scrolls when the window is short, and becomes a bottom sheet on narrow windows.
- **Keyboard friendly.** Arrow keys, Home/End, typing a letter, Right/Left for submenus, Escape or a click outside closes it and puts the focus back on More.
- Direct calls' More menu gets the same look, with Audio › Speaker and Noise Suppression.

---

## 2026-10-02 — 0.2.82: WhatsApp lives in Chat

WhatsApp is now a channel of Chat, next to Chat and Web Chat, instead of a separate app that opened the web (#35):

- **One place.** The separate WhatsApp entry is gone from the sidebar, launcher and search. Old WhatsApp links, open tabs, notifications and `worksuite://whatsapp` links open the same conversation in Chat's WhatsApp channel.
- **Reply properly.** Pictures show inline and files open on this computer; send files with a caption (up to 25 MB); once the 24-hour window has closed, send an approved template; start a conversation with a number from the new + button or a contact's "Open the conversation".
- **Settings in the channel.** The gear in the WhatsApp list (and Add a channel) shows each number with its status, and offers Check connection, Link again, Make default, Unlink and Connect a number — each only where you are allowed. Broadcasts, templates and business hours stay on the web, one click away.
- **Same access as before.** Chat access alone does not open WhatsApp. Someone with WhatsApp but not Chat still gets a WhatsApp entry, which opens Chat showing only the WhatsApp channel. WhatsApp threads have no call buttons.

No server change needed.

---

## 2026-10-02 — 0.2.81: announcements to several companies

Publishing an announcement to more than one company is tightened up and kept current everywhere (#98):

- **Only companies you may publish to.** The company picker offers just those, with "All companies you may publish to", Clear Selection, a count and removable chips. A company where you may draft but not publish is marked "draft only", and Publish says why it is unavailable. The server checks each company too — before, ticking a company you were refused alongside one you were allowed let the announcement through.
- **Audience before publishing.** "Will reach N people in M companies", with the per-company breakdown, and a confirm step. Save Draft stays; drafts never reach anyone.
- **Home's Announcements.** Urgent first, then pinned, then important, then newest — a pinned announcement no longer sinks below an unpinned important one. Expired ones disappear at once; "See all" opens the full list.
- **Edits, withdrawal and expiry show everywhere straight away.** Home, an open announcement and the HR console refresh as soon as it changes, and notifications already sent are updated (or expire) with it.
- **Acknowledgement report.** "Acknowledged earlier text" and "Read, not acknowledged" are told apart, filtered by the companies you may see the report for.
- One notification per person, even if they belong to several of the chosen companies.

Needs the server update (HR module and its migration).

---

## 2026-10-02 — 0.2.80: macOS permissions and screen capture

- Screen sharing checks Screen Recording / Screen & System Audio Recording separately from Accessibility. The picker refreshes after returning from System Settings and shows Granted, Denied, Checking or Unable to Verify.
- Capture validates only the chosen screen or window, so a failed window list cannot block a valid screen. Discovery timeouts, disappeared selections and capture startup failures have specific errors; retired requests cannot capture an old selection.
- Remote control shows running-app and input-helper permission evidence, refreshes stale checks after settings changes and sleep/wake, and reports contradictory native checks as unverifiable. Screen sharing remains available while control is unavailable or being checked; participant control still requires explicit approval.
- Diagnostics includes Screen Recording status and actual app-signature verification. Restart advice requires observed permission-change evidence instead of a generic capture failure.

Modules: Calls 1.4.1, Meet 1.8.1, Settings 1.9.4, Diagnostics 1.0.2. Installed signed macOS builds and delivery to another participant still require the acceptance tests in `docs/MACOS_PERMISSIONS.md` (#132).

---

## 2026-10-02 — 0.2.79: images in the AI Assistant

You can now give the AI Assistant pictures — screenshots, photos of documents, scans (#59):

- **Add images** with the image button, by dropping them on the panel, or by pasting. Thumbnails show before sending, with a large preview and Remove. PNG, JPEG, WebP, GIF and BMP, up to 10 MB each and 5 per message; anything refused says why.
- **Extract Text** reads English, Sinhala and Tamil — also mixed — on this computer, keeps lines and paragraphs, and has Copy Text. Words it is unsure of are underlined; what it cannot read says `[unreadable]` instead of being guessed. The first use downloads about 5.5 MB of language data from `cdn.jsdelivr.net` (each file's size and checksum are verified); firewalled sites need to allow that host.
- **Ask about an image** and the question goes to a model your administrator has marked as able to read images — only online, and only when online fallback is on in AI Assistant settings. The Local AI engine cannot look at images yet, so without an online vision model a card offers Extract Text, answering from the image's text on this computer, the settings, or Local AI setup. Your question and images stay in the box.
- Progress reads Reading image → Extracting text → Preparing reply. Stop or a failure puts the question and images back; Try again resends them.
- Text inside an image is treated as something to read, never as instructions to the assistant.

Needs the server update (AI module) and an administrator ticking **Images** on a vision-capable model in AI settings.

---

## 2026-10-02 — 0.2.78: direct calls from Chat, separate from meetings

Voice and video calls from a conversation are their own thing now — no meeting invitation, room link or calendar event (#113):

- **Clear call states** — Calling, Ringing (once the other person's device shows the ring), Connecting, Connected, Busy, Declined and No answer.
- **Incoming calls** — "Incoming voice/video call from X" with Answer and Decline; while locked, "Incoming WorkSuite call", naming the caller only when Show Caller Details is on.
- **Call window** — Maximise and speaker selection join minimise, mute, camera and end. Switching voice to video turns on only your camera.
- **Connection loss** — "Reconnecting…" with the clock still running; the call rejoins for up to 30 seconds before ending.
- **Call history** — a Calls tab in the full Chat page; Busy / No answer / Cancelled on call cards and in the log; Call again after a call ends. An unanswered call now rings the full 45 seconds and is recorded as missed.
- **Only where calling works** — no call buttons in website-visitor chats, notice rooms or where the server has no calling set up.

Needs the server update with the Communication migration (`php spark migrate --all`). With an older server calls still work; they just read Ringing straight away.

---

## 2026-10-02 — 0.2.77: the new Home

Home now follows the "WorkSuite Home — Optimized" design, on your real data:

- **Header** — the date and organization picker above the greeting, with Customize and a New split button.
- **Four tiles** — Due today (with overdue in red), Meetings today (with the next time), Waiting for you (invitations · approvals · announcements) and Unread messages (with mentions). Each opens its page.
- **Today's work** — Today / Overdue / Upcoming tabs; tick a task to complete it; "Add a task".
- **Today's agenda** — all-day renewals grouped, a timeline with a NOW line, ended meetings with Recording & notes, the next meeting highlighted with Join / Details, and tender meetings with Open tender / View meeting.
- **Right rail** — Your daily brief with Ask AI, Waiting for me (invitations with Going / Maybe / Not going, approvals, announcements to read) and Announcements.
- **Recent activity and Recent files** at the bottom.

Saved Home layouts carry over: hidden cards stay hidden and your order is kept. The greeting no longer says "Good evening" all day when the 12-hour clock is set.

---

## 2026-10-02 — 0.2.76: meeting invitations that arrive; tender meetings and contact persons; the AI Assistant works in the background; chat notifications while locked

- **Meeting invitations reach people** (#97).
  - Invitees get a notification, a desktop banner and an email with a calendar file.
  - Invitations are listed in the notification centre, Meetings › Invitations and Home › Waiting for me. Each shows
    the organiser, date, time, timezone and where, with Going, Maybe, Not going and View Meeting.
  - Answers update every view without a refresh.
  - Reminders, and notices of moves and cancellations, arrive even when the organiser's app is closed.
  - The organiser sees which emails failed and can retry them.
  - Settings says when banners are blocked on this computer.
- **Tender meetings** (#100).
  - Pre-bid meetings, site visits, clarifications and presentations scheduled on a tender are real meetings in
    Meetings and the Calendar. They have invitations, answers, reminders and conflict checks.
  - They are labelled Tender meeting and can be filtered, with Open Tender, View Meeting and Join.
  - Edits, moves and cancellations stay in step. Closing dates stay separate.
- **Contact Persons on tenders** (#118).
  - Add new contacts or link existing ones. Duplicates are suggested first.
  - Each contact has a tender role and one is the Primary Contact.
  - Open, email, call or schedule a meeting from the list.
  - Unlinking keeps the contact, and changes appear in the tender's history.
  - Being listed gives no access to the tender.
- **The AI Assistant works in the background** (#110).
  - Minimise it, or move to another app, while it answers.
  - The launcher shows Thinking, Working, Needs your input, Complete or Failed.
  - A small notice says "Your answer is ready" or "Needs your input". It never takes the keyboard or opens the
    assistant.
  - Stop processing and Try again are always available. Auto-minimize after sending is a setting.
  - The status says whether it is answering on this computer or with online AI.
- **Chat notifications while locked** (#114).
  - Messages keep arriving while WorkSuite is locked.
  - Locked banners say "New message in WorkSuite." unless you allow the sender or a preview.
  - Badges update straight away.
  - After sleep the connection reconnects straight away and missed messages are caught up, without showing twice.
  - Clicking a locked banner opens chat in restricted mode when that is allowed. Otherwise it asks you to unlock,
    then opens the conversation.
- Where it bites:
  - These need the matching WorkSuite server. Run its migrations and its install seeder (the seeder gives default
    roles the meeting permissions), and add the new `meetings:deliver` cron line.
  - With online AI, Stop stops waiting for the answer but does not cancel the request on the server.
  - The app cannot read the system's notification permission on macOS or Windows, so Settings says where to check.

## 2026-10-02 — 0.2.75: Q&A, polls and raise hand; Host Controls; a clearer New meeting menu

- **Q&A** (#92):
  - Participants ask questions and upvote them, one vote each.
  - Hosts and co-hosts answer them, mark them answered, or hide inappropriate ones. Participants never see hidden
    questions.
- **Polls** (#92):
  - Hosts and co-hosts create single- or multiple-choice polls, launch them and close voting.
  - Results reach participants only when the host shares them.
  - Each person votes once, and everyone sees how many have voted.
- **Anonymous or named:** before you send a question or a vote, the screen says whether your name will be shown.
- **Raise hand** (#92):
  - The toolbar button puts a hand badge on your tile and in People, in the order hands went up.
  - Hosts are told when a hand goes up, and can lower one hand or all of them. You can lower your own.
  - Raising your hand never turns your microphone on.
- **Host Controls:** Q&A, anonymous questions, polls and raise hand can each be switched off.
- **Sync:** everything stays the same across devices and reconnects.
- **Meeting details:** a new **Q&A & Polls** tab. The organiser, hosts and co-hosts see everything. Participants
  see the visible questions, without anonymous names, and the poll results that were shared.
- **Host Controls** (#91): the host and co-hosts get a toolbar button that opens one drawer.
  - **Participant permissions:** screen sharing, reactions, microphone and camera.
    - Turning the microphone or camera off stops it straight away, and participants are told why.
    - Turning it back on lets them switch it on themselves.
  - **Chat:** chat on or off for participants.
  - **Meeting access:** Host must join first (a co-host counts), and the access mode:
    - **Open:** anyone with the link joins.
    - **Trusted:** invited people come straight in; everyone else asks to be let in.
    - **Restricted:** only invited people can ask to be let in.
    - Guest requests can be switched on or off.
  - **Activities:** whiteboard, Q&A, polls, raise hand, recording and transcription.
  - **This meeting vs. future meetings:** "This meeting" settings are kept apart from "My defaults for new meetings",
    which new and scheduled meetings start from.
  - **Updates:** changes reach everyone at once and come back after a reconnect.
  - **Reactions:** meetings now have emoji reactions.
- Where it bites (#91):
  - Rooms made before this read their old settings as Open or Trusted, so invited people may now come straight in
    where they used to wait in the waiting room.
  - People waiting to be let in join the meeting's conversation only once they are admitted.
  - Reactions and whiteboard drawing are held back by every app, not by the server.

- **New meeting menu** (#90):
  - Each choice is an icon beside its title with a short description underneath: Start now, Create link for later,
    Schedule in Calendar.
  - One option is highlighted at a time, by mouse or arrow keys, and the shadow is lighter.
  - The menu opens above the button when there is no room below.
  - Choosing twice quickly starts only one meeting.
  - Every menu opened from a button now flips above it when it would not fit below.
- Where it bites:
  - This needs WorkSuite Communication 1.3.0 and Meeting 1.4.0 on the server. Run its migrations (two new ones).
  - Against an older server, Raise hand is greyed out, and Q&A and Polls have nothing to show.
  - An anonymous poll keeps no name with a vote, so not even the host can see who chose what.
## Unreleased

- **Drag to create calendar events** (#63). Select empty time slots in Day or Week in quarter hours; the highlight shows the start, end, duration and displayed timezone. Release to fill in New Event, then add the title, attendees, location, description and reminder before saving. Month dates and the All Day row select inclusive multi-day events. The calendar scrolls near its edges; Escape cancels without creating anything. Creation respects calendar access and offline status, and the New event button and keyboard shortcut remain available.

## 2026-10-01 — 0.2.74: Chats in windows of their own; schedule conflicts asked before moving; a modern Home with announcements

- **Chats open in windows of their own** (#103). **Open in new window** in a conversation's header — in Chat and in
  the chat drawer — opens it in its own window, with the system's own minimise, maximise and close. Several can be
  open at once; each new one opens a step away from the last so none hides another, and opening a conversation
  that already has a window brings that window forward (restoring it if minimised). What you had typed goes with
  it. **Open in main app** in the window's title bar shows the conversation in the main window and closes the
  window. A window is no longer kept above everything else by default; the pin in its title bar does that, and a
  call's chat still starts on top. Windows remember their size and place, and come back onto a connected screen.
- Where it bites: closing a chat window saves the draft first, and waits for a pasted picture or voice message
  still going up (the window minimises meanwhile, then closes); files picked from disk always carried on without
  the window. Signing out closes every chat window (and every other secondary window) at once; locking WorkSuite
  hides them behind the lock screen as before.

- **Schedule conflicts, finished** (#99). Dragging or stretching an entry onto something else now asks first —
  **Move anyway** or leave it where it was — instead of moving it and warning afterwards. Day, Week and Month flag
  the entries that overlap another of your commitments (⚠); the same meeting seen twice (as a meeting and as a
  calendar invitation) is not a clash with itself. **Choose another time** takes you back to the start time.
  Accepting an invitation asks the server again rather than trusting the list, so something added since is caught.
  A meeting cancelled or moved refreshes the calendar and its warnings. Saving something that is already in your
  calendar says so; people whose availability cannot be checked are named.

- **Home, modernised** (#104). A compact header — greeting, date, a company filter, **Customize** and **New**. The
  cards along the top are buttons and count exactly what they open: **Due today**, **Overdue** and **Upcoming**
  (the next week) are now apart, as are meetings, what is waiting for you and unread messages; big numbers are
  shortened (1.2K) with the exact number on hover. **Agenda** lists today with the kind of each entry (a meeting, a
  task, a *Tender Meeting*…), **Join** for meetings and a way to the record. **Waiting for me** gathers approvals,
  meeting invitations you have not answered and announcements to acknowledge. **Recent files** show a preview
  where there is one, the type and whether the file is still being processed, and leave out temporary upload
  pieces; **Activity** shows a run of similar updates as one line (×12) rather than one per upload part. The daily
  summary is a few short points, each going to where it came from. Every widget loads on its own, says when it
  failed and offers **Retry**. **Customize** shows, hides, reorders and widens widgets (or drag one by its handle
  onto another), and **Reset Layout** puts it all back. The page narrows to one column in a small window.
- **Announcements on Home** (#98). The **Announcements** widget shows those sent to you for the company chosen at
  the top — urgent and pinned first — with who sent it and when; open one to read it (it is marked read) and
  **Acknowledge** where that is asked for. **See all** lists every one. A notification about an announcement opens
  it on Home; one withdrawn or expired since says it is no longer available.
- **Announcements to several companies** (#98), in HR → Announcements: choose companies from a searchable list
  with chips, how many are chosen, **Select All** and **Clear** (at least one is needed). Before anything goes out it
  says how many people it reaches in which companies — someone in two of them is counted, and notified, once.
  **Save Draft** keeps it unseen; **Publish Announcement** asks first. An announcement can be edited, given an
  expiry date, pinned, and **withdrawn** (it disappears for everyone; who read it stays in the report). The list
  and the read report can be narrowed to one company, and the report shows each person's company. Announcement
  notifications reach everyone they were sent to, whether or not they have the HR app.
- Where it bites: the Tasks page's **Due today** no longer includes tasks whose time today has already passed —
  those are **Overdue**. Grouped activity, file previews and states, and the summary's points and sources need
  the WorkSuite Dashboard update for #104; an older server shows what it sends. Announcements need WorkSuite HR 1.1.0
  for several companies, authors and withdrawal; on a server without announcements the widget is not shown.

## 2026-10-01 — 0.2.73: Meet roles, ring-in, notes, recording and transcripts; Drive sharing alerts, the transfer queue and Drive settings; schedule conflicts

- **Meet roles and room settings** (#82). Meetings have a host, co-hosts, presenters and participants.
  - The host can hand over hosting, add co-hosts and choose who may present.
  - Leaving as host passes the meeting to a co-host.
  - Room settings decide who may join, whether there is a waiting room, and who may present, invite, chat, record
    and see transcripts. They can be set when the meeting is scheduled.
- **Ring people into a meeting that is on** (#79). Invite someone from inside the call and their app rings, as a
  call does.
- **Notes & Minutes** (#80). Minutes are written together during the meeting and saved as you go. They stay with
  the meeting's details afterwards, and can be drafted from the transcript and chat.
- **Recording, on the server or on this computer** (#68).
  - Server recording is fixed.
  - A meeting can also be recorded on this computer and saved to Drive in the background.
  - The local copy is kept for as long as Settings › Meet › Recording says.
- **Recording status** (#89).
  - Each recording shows where it is: Recording, Finalizing, Queued, Processing, Uploading to Drive, Ready to play,
    Paused or Failed.
  - Downloading is shown apart from playback.
  - Progress is shown only when it can be measured.
  - Separate badges say Saved locally, Saved to Drive and Ready to play.
  - Actions: Try again, Pause, Resume, Cancel transfer, Play, Open in Drive.
  - A stuck step says what to do, and you are told when a recording is ready or fails.
- **Transcripts** (#81).
  - Meetings are transcribed on this computer with a speech model you add in Settings › Local AI, or on the
    WorkSuite server where that is allowed.
  - Transcripts can be corrected, exported and emailed.
- **Drive sharing reaches people** (#16). Something shared with you appears in Shared with me at once. Its alert
  still pops up when the live notice was missed, for example while the computer was asleep.
- **Share keeps the document in view** (#42). Share opens over the document, which stays visible and dimmed behind
  it. Closing returns to the same editor, with its changes, selection and scroll.
- **One transfer queue** (#94).
  - Uploads and downloads run two at a time; the rest wait in order.
  - The Transfers panel has Active, Queued and Finished sections.
  - Each file can be paused, resumed, cancelled or retried, and there are Pause all and Resume all.
  - A temporary failure is retried automatically.
  - The queue survives a restart, and nothing is sent twice.
- **Drive › Settings** (#95), also in Settings › Files & Sync:
  - how many transfers run at once, and upload and download speed caps;
  - the download folder, and what to do when a name is already taken;
  - Drive quota, local cache and offline storage, and transfer notifications;
  - Reset to defaults. These settings apply to this computer only.
- **Schedule conflicts** (#99).
  - Saving an event or meeting that overlaps something else shows the overlap first. You see what it is where you
    may see it, and Busy where you may not.
  - Scheduling a meeting marks each person busy or free.
  - Invitations that clash are flagged in Meetings, Calendar and Home's Waiting for me. Accepting one asks first
    and offers Propose new time.
- Where it bites:
  - These need the matching WorkSuite server (Communication 1.2.0, Meeting 1.2.0, Calendar 1.2.0, Ai 1.1.0,
    Core 1.0.2, Notifications 1.1.0). Run its migrations.
  - Against an older server, the new parts stay out of the way.
  - The metered-connection setting is kept, but the app cannot yet tell when a connection is metered.

## 2026-10-01 — 0.2.72: A profile picture before the workspace; calendar entries open their record; search on the server's index

- **Add your profile picture** (#46). When the server requires a profile picture and your account has none, the app
  shows this screen after sign-in instead of the workspace: on your first sign-in, and again if your picture is
  removed. **Upload Picture** opens the picture editor (move, zoom and turn it inside the round frame); an avatar
  can be made instead where the organisation allows it. The picture shows as it will look, and goes up only on
  **Save and Continue**; if that fails it says why and offers **Try again**. **Sign Out** is the only other way on.
  The supported types, the largest size and the smallest picture are listed under the preview.
- Where it bites: the server decides (WorkSuite Users 1.1.0, *Require a profile picture*, on by default). An older
  server never asks. A picture waiting for an administrator's review counts, so nobody is held here. Started
  offline from the copy kept on this computer, the app does not ask: nothing could be sent anyway.

- **Calendar entries open the record they are about** (#64). A task, meeting, tender, subscription renewal, leave
  request, project date or asset date opens a summary — title, type, date and time, status — with a button that
  says what it opens (**Open Task**, **View Tender**, **Open Subscription**, **Open Leave Request**, **Open
  Project**, **Open Asset**…) and goes to that record, not to the app's list. Tenders and subscriptions now open in
  their own tabs (they went to the browser, or nowhere). Projects and assets open on the web, at that project or
  asset. If the record was deleted, or is no longer shared with you, since the calendar loaded, the summary says so
  instead of opening. Works from Day, Week, Month, the all-day row and the Today list; Tab and Enter open entries;
  Escape closes the summary; the calendar keeps its day, view and filters when you come back.
- Where it bites: exact project and asset links need WorkSuite Calendar 1.1.0 on the server; before that, those
  open the Projects or Assets list as they did. Asset licences and audits belong to no single asset and open the
  register. Your own leave request, opened from the calendar, is highlighted in HR → Leave rather than opening the
  approver's review, which would refuse you.

- **Search answers from the server's new search index** (#57, with WorkSuite Search 1.1.0). Results come back
  ranked — an exact name or number first — with the words marked wherever they start a word (Sinhala and Tamil
  vowel signs included) and, where the match was in the content, a snippet showing why, in the list and the
  preview. Filter by **When** (past week, month, year), **Mine**, and **Company** when you belong to more than
  one; choosing a group (Tab) now asks the server for that group, and gets more of it. While the server is still
  building its index, a line says so and which apps are searched the slower way meanwhile, so an empty answer is
  not read as "nothing there". When your access changes, results found under the old access are dropped.
- Where it bites: an older server sends none of this, and search works as before. Offline search is unchanged.

- **The Mac build packages again.** The universal (Intel + Apple silicon) merge stopped at Local AI's native
  libraries, which come one package per Mac and are the same file in both halves; the builder is now told so.
- **Security: PDFs are shown with pdf.js 6.3** (was 5.7). pdf.js 5.6–6.2 could run a crafted PDF's script when it
  was opened (GHSA-hq66-cqwq-w95j, high). The file viewer and Drive's PDF covers are the two places it is used;
  nothing else about them changed.

## 2026-10-01 — 0.2.71: Chat's channel toolbar (WhatsApp in Chat), profile pictures, a resizable conversation list; AI Assistant scrolling; Local AI first-use setup and Gemma 3 4B; Office menus and Open in new window; Meet Home and pre-join redesign; meeting cards in Chat; screen sharing fixed

- **A channel toolbar down the far left of Chat** (#33): Chat, Web Chat and WhatsApp, each with its unread count
  (waiting visitors for Web Chat) and a warning dot when a WhatsApp number is not connected. Hover for the name and
  the count. A channel is there once you have it: Web Chat if you answer website chat, WhatsApp once a number is
  shared with you. The toolbar stays when the conversation list is hidden, and ↑ / ↓ move along it from the keyboard.
- **WhatsApp conversations in Chat.** The list (All, Unread, Waiting, Mine; a number picker when you have more than
  one), the conversation, and a reply box. What you type is kept per conversation, so switching channels loses
  nothing. When a reply cannot go, it says why: you can only view that number, it is more than 24 hours since they
  wrote (templates are sent from WhatsApp on the web), or the number is not connected. Broadcasts, templates, labels
  and number settings stay on the web (the ↗ button).
- **"+ Add a channel"** lists WhatsApp and Web Chat and where each stands for you. Connect a WhatsApp number by
  scanning a QR code with its phone (needs the "connect WhatsApp numbers" permission), or link one that dropped
  again; a Business Platform number and the website chat widget are set up on the web.
- **Profile pictures in Chat** (#37): people's current pictures in the conversation list, the conversation header,
  beside their messages, in the details and member lists, the new-conversation picker and @-mentions. No picture,
  one that will not load, or one its owner does not show you: their initials, on the colour that name always has.
  When somebody changes their picture it changes here too, without signing out (the server announces it; pictures
  are also checked again after 15 minutes). Group conversations keep their rounded-square initials, so they never
  look like a person. WhatsApp contacts' pictures show once the server provides them; it does not fetch them yet.
- **Share your screen works again** (#70). The picker showed "Something went wrong" and "Nothing to share here"
  and left Share greyed out: on a Mac with Screen Recording off, asking the system for its screens failed outright,
  and that failure hid the permission's own message. Now screens and windows are listed separately (a window list
  that fails leaves the screens), and the picker says one true thing: **Screen Recording is off** — with Open
  System Settings, Restart WorkSuite (macOS applies it to a restarted app) and Check again; **the list could not be
  made** — with what the system said and Try again; or **nothing of that kind is open**. It looks again when you
  come back from System Settings. Screen Recording is separate from Accessibility, which only remote control needs,
  and a meeting's picker no longer waits for that check. The quality you chose is kept. While sharing, the bar
  still says what you are sharing, with Stop sharing in the Share menu.
- **Meet Home, redesigned** (#67). Starting and joining come first: **New meeting** (Start now, Create a link for
  later, Schedule in Calendar) and the code or link box with its **Join** — a code or link that is wrong says why,
  right there. Below, upcoming meetings by day in compact cards (time, length, host, people) with **Join** only
  when the meeting can be joined, and recent meetings and recordings in compact sections with **See all**; each row
  has one action and a ⋯ menu for the rest (Open chat, Copy link, Copy meeting ID; Download, Rename, Delete). Empty
  sections offer Schedule a meeting or Start a meeting. **Check camera and microphone** is on the page. Lengths read
  "1 h 20 min"; a past meeting nobody ended no longer shows days of minutes (it shows no length).
- **The pre-join screen, redesigned** (#69). Your camera's picture (in proportion; your avatar when it is off) with
  microphone and camera buttons that show their state, the devices together with a live microphone level and **Test
  speaker**, and the meeting — title, organizer, who is in it, whether you host — with **Join now**, which shows it is
  joining and cannot be pressed twice. A blocked, missing or busy device says what to do (Open privacy settings, Try
  again); so does a failed connection. The devices you choose, and whether the microphone and camera are on, are
  remembered on this computer and used when you join.
- **A meeting's card in Chat, polished** (#71). A Meet meeting shared in a conversation shows its name (cut short
  when long, with the whole of it on hover), who started it and when, and whether it is **Live** (a pulsing green
  dot) or **Ended**. It has one action: **Join** — which says it is joining and cannot be pressed twice — or
  **Return to meeting** when you are already in it on this computer, or **View details** once it has ended: when it
  started, how long it ran, who was in it and whether it was recorded. A meeting that was removed says so, with no
  action. The card is smaller in the chat drawer. It needs the server's Communication 1.1.0 for the meeting's name
  and start; an older server shows "Meeting" and the time it was shared.
- **Office: the Editing and ⋯ menus open again** (#39). In a Word, Excel or PowerPoint document open in WorkSuite, the
  mode menu (Editing / Reviewing / Commenting / Viewing) and More (⋯) opened behind the document — the editor is a
  native view laid over the page, and covered them. Now the editor steps aside while a menu is open, and a picture of
  it taken just before stays in its place, so the document does not vanish. The menus keep to the window, move with
  ↑ ↓, and close with Escape or a click elsewhere; they offer only what your access allows.
- **Office: Open in new window**, beside Share and ⋯, moves the document to a window of its own, as you, with the
  same access. Changes still on their way to the Office server go first ("Saving changes…"); if the last save failed
  it says so, with Retry, and leaves the document where it is. In a narrow window the header stays on one line (Share
  becomes its icon; who else is in the document is hidden).
- **"Set up your AI Assistant"** (#49). The first time the assistant opens with nothing on this computer that can
  answer, it offers the model that suits it — name, download size, the free space it needs — with **Download and Set
  Up** and **Not Now** (asked again in a week; Settings → Local AI has it meanwhile). Space is checked first (too little
  says how much is needed and blocks it); too little memory is a warning. The setup shows its stages — Downloading →
  Verifying → Preparing AI → Ready — with percentage, size and time left, can be paused, cancelled, resumed and tried
  again, and carries on with the panel closed. Errors say what to do: check the connection and resume, free up space,
  download afresh, or test again / choose another model. Local chat is offered only once the model has loaded and
  answered; then **"Your AI Assistant is ready to use"** and **Start Chatting**. Nothing is offered once a model works.
- **Gemma 3 4B on this computer** (#55). With a server that has it (WorkSuite Server with Ai 1.1.0), Settings →
  Local AI lists Gemma 3 4B with its version, download size (about 2.5 GB), the memory it needs and the computers it
  suits, and its licence — the Gemma Terms of Use, with the notice they require. **Download and set up** fetches it
  (pause, cancel, resume where it stopped, try again), checks it against the SHA-256 the server names, then **loads
  it and has it answer** before it says **Ready to use**; a file this computer cannot run says why and is not used.
  **Use this model** makes it the default. The assistant offers the same setup the first time, while nothing is set
  up here ("Not now" hides it). Which model answers is unchanged: WorkSuite AI unless you pick On this computer, and
  On this computer when you are offline.
- **The AI Assistant keeps the latest in view** (#50), in both WorkSuite AI and On this computer. While you are at
  the end of the conversation it follows new messages and a streaming answer as it grows, and an image that loads or
  a panel you resize no longer pushes the end behind the box. Scroll up to read and it stays there; when something
  new arrives below, **Jump to latest** appears. Scrolling back down, Jump to latest, or sending a message follows
  again. Only the conversation scrolls: the header, the WorkSuite AI / On this computer switch and the box stay put,
  in Quick Ask too.
- **Drag the right edge of Chat's conversation list** to make it wider or narrower (#34). The edge shows the resize
  cursor and a highlight on hover; the list stays between 240 px and 560 px, and never leaves the conversation less
  than about 480 px of the window. Long names and previews end in "…" at any width.
- **The width is remembered** on this computer, across restarts. A double-click on the edge puts it back to 300 px.
- **From the keyboard:** Tab to the edge, then ← / → (Shift for bigger steps), Home / End for the narrowest and
  widest, Enter for the default.

---

## 2026-10-01 — Drive Home: less empty space, easier to find things

**Changed**

- **One compact header** with search, **New** and **Upload**. The banner that repeated Upload and New folder is gone.
- **Continue working and Recently opened** fit the number of files. Up to three show as compact rows, and more as
  tiles. Each shows six at most, with See all for the rest. Recently opened says when you opened a file, not when it
  last changed.
- **Shared by link** lists each file once, even with several links, and keeps two files with the same name apart.
  Each file says who can open it (anybody with the link, with the password, or named people), and has **Copy link**
  and **Manage**.
- **Starred folders** are compact cards, six at most.
- **The Drive sidebar's filters** read **Documents**, **Media and other files** and **By date**. Hover over one for
  its full list. The storage and sync lines no longer get cut off.
- **Narrow windows:** the page fits without clipping. The header wraps, and Starred folders and Shared by link stack.

**Added**

- **Downloads in progress and leftovers are left out:** `.part` and `.crdownload` downloads, temporary and lock
  files (`~$…`, `.~lock…`, `.tmp`) and system files (`.DS_Store`, `Thumbs.db`) no longer appear in Home's sections.
- **No more blank cards:** a file without a picture shows its kind's icon over its type.
- **A ⋯ button on every Home file** opens its actions (preview, share, download, star) and **Open containing
  folder**, from the keyboard as well as by right-clicking.
- **While Home loads**, each section shows its shape. Each one says when it's empty, and an error offers Try again.

---

## 2026-10-01 — Chat attachments open in a preview

**Added**

- **Clicking an attachment in Chat opens it over the conversation**, in a message, in the Details panel's Media,
  Files and Audio tabs, and in Web Chat:
  - **Pictures:** zoom (−, +, Fit), rotate, full screen, and ‹ › (or ← →) through the conversation's pictures, or the
    Media tab's.
  - **Video and sound:** play, seek and volume.
  - **CSV:** a table, the first 1,000 rows.
  - **Text files:** shown as text, readable and scrollable.
  - **Everything shows** the file's name, type and size, with **Download** (saved, not opened) and **Open in app**.
    A file with no preview, or larger than 2 MB for CSV and text, offers those two instead.
  - **Loading, errors and retry:** each preview shows that it's loading, says what went wrong (including "You no
    longer have access to this file."), and offers Try again.
  - **Closing** (Esc, or Back) returns to the same place in the conversation, on the attachment that was clicked.
- A **PDF** still opens in PDF Studio (pages, zoom, search). A **Word, Excel or PowerPoint** file still opens in a
  WorkSuite DOC, Sheet or Slides tab.

---

## 2026-09-30 — The AI Assistant as a floating widget; Thinking…; About

**Added**

- **Settings › AI Assistant › Display mode:** the header's AI button and its drawer (as before), a **floating chat
  widget**, or **Hidden**. The widget is an Ask AI button in the bottom-right corner of the workspace that opens the
  same Ask, Write and Changes, with Minimize, Maximize / Restore and Close. It stays inside the workspace, never over
  the sidebar, tabs, status bar or a side drawer. Escape minimizes it. In Hidden, the shortcut and the command palette
  still open the assistant.
- **One conversation, wherever it shows.** Closing or minimizing the drawer or the widget, or switching between them,
  keeps the messages, the question being written, the files picked and an answer on its way (closing the drawer used
  to start over). The launcher and the header button turn while an answer is coming, and count answers that arrived
  while it was closed. **Sound for new answers** (off at first) chimes for them. **New conversation** starts afresh.
- **Try again** under an answer that failed asks the same question again in its place.

**Changed**

- **Thinking…** with the AI sparkle pulsing replaces "Looking into it…", from the moment a question is sent until
  the answer starts to show. With reduced motion the sparkle stands still. A local answer is no longer read out word
  by word as it streams.
- **About** names the owner in full: WorkSuite is owned and developed by Livezen Technologies LLC, © this year, with
  worksuiteone.com opening in the default browser. The open-source notice stands on its own line. Installers carry
  the same copyright.

---

## 2026-09-30 — The lock screen unlocks on the last digit of the PIN

**Changed**

- **No Unlock click for a PIN.** The PIN field has the cursor as soon as the lock screen shows, and the PIN is
  checked as soon as its last digit is typed or pasted. It says "Unlocking…" meanwhile and sends it once. A wrong PIN
  says so (with the attempt count; five wrong PINs or passwords still sign you out), empties the field and puts the
  cursor back. The password, Touch ID and Sign out work as before, and the password still waits for Unlock.
- WorkSuite now keeps how many digits the PIN has (never the digits), with its sealed hash. A PIN set before this
  version needs Unlock once more; from then on it goes on its last digit.

---

## 2026-09-30 — Modules carry their own version and changelog

Nothing changes in the app. For developers: every module in `src/modules/` now has a `module.json` (its version,
and its main-process files in `electron/services/`) and a `CHANGELOG.md`, all starting at 1.0.0. Work on a module
goes on a `module/<module>/<topic>` branch; `npm run module -- release <module> patch|minor|major "…"` raises the
version and writes the section; `npm run module -- check` fails a pull request that changes a module without doing
so (`.github/workflows/modules.yml`, and a pre-push hook: `git config core.hooksPath scripts/git-hooks`); releases
are tagged `<module>/vX.Y.Z`. See `docs/MODULES.md`.

---

## 2026-09-30 — 0.2.70: Hotel PMS door locks; POS follows the new drawer and payment rules

**Added**

- **Hotel PMS door locks.** Desk devices → Door-lock server, per property (its password or API key in the OS keystore,
  a connection test, card read). Keys from check-in, room move and the stay run on the hotel's on-site Salto (SHIP),
  Vingcard (Visionline / Vostio) or dormakaba (Ambiance / Saflok) server and are reported back to WorkSuite; TTLock
  passcodes are issued by WorkSuite and shown once. Each vendor is off until configured; the vendors' message formats
  are confirmed during certification.

**Changed**

- **POS: no sale without an open register.** A tap or scan says to open the register first. A sale refused
  `drawer_closed` or `session_not_here` keeps its reason and can be sent again into the register open now, or
  dropped. Sales history shows and filters Late, Payment missing and Price differs, and receipts print "Payment
  missing". "POS is switched off" now names the real switch: Admin Centre → Apps → POS.

---

## 2026-09-30 — 0.2.69: a slow AI answer says so

"The server answered 502." in the AI dock, on a request that makes the assistant act (an invoice for 10 Windows
11 Pro keys): the web server in front of WorkSuite gave up on a turn that ran too long. The dock now says
"WorkSuite took too long to answer this — the AI model may still be starting. Try again in a moment, or ask for
one thing at a time." The server keeps a turn within its time (WorkSuite server update), so this should rarely
be seen at all.

---

## 2026-09-30 — 0.2.68: Local AI uses AI Studio's models

"Local AI" showed `net::ERR_SSL_UNRECOGNIZED_NAME_ALERT` and no models: it asked for its catalog at
`cdn.worksuite.app`, which does not serve one.

**Changed**

- **Models to download come from your WorkSuite server**, which makes them from the models your workspace offers
  on AI Studio (aistudio.livezentech.com): each is the file AI Studio's nodes run, with its size and SHA-256. A
  download that does not hash to exactly that is refused. The last list is kept for offline use. The CDN is asked
  only if the server has no list and a signing key is pinned — so it is no longer contacted at all.
- **Settings → Local AI → AI Studio**: whether the connection works, the models the assistant answers with, and a
  Test button for each. An administrator (`ai.settings`) can find the models already on AI Studio and choose
  which the workspace offers.
- **The assistant answers either way**: with a model on this computer when one is downloaded (and always when
  offline), or with AI Studio through WorkSuite — the switch at the top of the AI dock.

**Needs** the WorkSuite server with `GET /api/ai/local/catalog`, and AI Studio's key and secret set there. An
older server leaves Local AI as it was.

---

## 2026-09-30 — 0.2.67: product pictures, and the AI dock no longer takes the window down

**New: pictures on products** (needs the server's product pictures update)

- **Inventory → New product / Edit product** has a Pictures section. Add
  several at once or drop them onto it; drag them into order, make one the main
  picture (★), remove one. JPEG, PNG, WebP or GIF, up to 12. A large photo is
  made smaller before it is sent; a PNG keeps its transparency.
- A new product's pictures are sent once it is saved. If the server refuses
  one, the product is still added and the message says so; edit it to add that
  picture again.
- The first picture is the main one: the product list shows it as a thumbnail
  and the product panel shows all of them above the stock figures.

"This screen stopped working — destroy_ is not a function" (or, before
0.2.64, an empty window) on closing the AI Assistant, on opening Chat while
it was open, and on Lock now.

**Fixed**

- The cause: this version of Chromium (152) returns a Promise from
  `scrollIntoView`, `scrollTo` and `scrollBy`. The AI dock scrolled to its
  last answer in an effect written so that it returned that Promise, and
  React calls whatever an effect returns when it closes — so anything that
  closed the dock (closing it, Chat taking its place, the lock screen
  covering everything) failed. The effect no longer returns anything; the
  lock screen's and a new order's focus effects are written the same way.
- A lint rule now refuses an effect that returns a scroll, focus or play
  call, or is `async`, and a test runs the dock with the DOM answering as
  Chromium does.

---

## 2026-09-30 — 0.2.66: POS and Restaurant on the desktop; Hotel PMS completed

**Added**

- **POS on the desktop** (native, no longer the browser). A counter PC is paired as a till; its credential is kept in
  the OS keystore and sent only by the main process to the till's own door. Cashiers open, top up and close the
  drawer (note-by-note count, blind close and the allowed difference as the company sets them) and print X and Z
  reports. They sell from WorkSuite's catalogue kept on the computer (refreshed in the background, also with nobody
  signed in; no Inventory access needed), with a barcode scanner, customer, discounts within the company's rights and
  ceiling, and cash/card/split payment with change, priced by WorkSuite with an offline preview. Offline sales are
  numbered on the till and sent in order, never twice. Receipts print on the thermal printer without a dialog and the
  drawer opens; WorkSuite's own receipt is reprinted or e-mailed; sales can be refunded (all or chosen items) and
  voided within their shift; sales WorkSuite priced differently are flagged for review. A second screen shows the
  customer their cart.
- **Restaurant Manager on the desktop** (native). The computer pairs as a terminal (key in the OS credential store,
  sent as `X-Terminal-Key`): a waiter/cashier till with the live floor (seat, move, merge, split), order taking with
  modifiers, seats, courses, send/fire/hold and approved voids, server-priced bills with splits, multi-tender
  payments, change and the drawer, and cashier sessions; a kitchen display per station with the expo; and a print
  agent that prints kitchen tickets and bills silently on this computer's printers. Offline, the till works from a
  sealed menu and floor copy and queues orders, with conflicts shown to a manager.
- **Hotel PMS**: apply a reservation's deposit to its open folios; housekeeping tasks moved, assigned and created, room
  status changes and restocks with Inventory products; maintenance end to end (report, assign, start, hold, resolve,
  close, out of order, parts, photos, "Mine"); lost & found; guest requests assigned to a person; guest documents
  saved or removed and duplicate guests merged; a native tape chart that moves bookings after the server's price
  preview; invoices with the Billing outbox and retry; KPIs and reports with CSV export where permitted.
- **Restaurant till, more**: discounts (order or line), items on the house and price overrides with a reason, taken
  back before payment; refunds and a tax invoice from a bill; anything above a person's limit asks a manager as voids
  do. A combo's components are chosen in the order screen. A Reservations screen at the host stand (the day's
  bookings, a table timeline, availability, book, seat, cancel, no-show). Screens refresh on the server's live pushes,
  with the catch-up poll as a fallback.
- **Hotel PMS**: photos on housekeeping tasks. Guest documents and report exports go through the download manager
  (`pms:download`), with the organisation's download policy checked in the main process — they land in Downloads and
  show in Transfers instead of a save dialog.

## 2026-09-30 — 0.2.65: Local AI, the lock PIN, Drive covers and Office files reach the app

Twenty-two things the app could do were never connected to its windows, so
each answered "WorkSuite Desktop is not available.":

**Fixed**

- **Settings → Local AI**: "This computer" no longer stays on Checking…, and
  Check for models, Restart, downloading, choosing, checking and removing a
  model, and asking it in the AI dock all reach the app.
- **The lock screen's PIN**: setting, clearing and unlocking with it.
- **Drive's first-page covers** are kept on this computer again instead of
  being drawn each time.
- **The built-in Office editor**: opening a file from this computer, saving
  it, Save a copy, and the offline copies.

A test now fails the build when a channel the contract lists is not on the
window's bridge under its own name.

Local AI still has no models to offer until WorkSuite publishes its signed
model catalog; Check for models now says why.

---

## 2026-09-30 — 0.2.64: a screen that fails no longer empties the window

Opening the AI Assistant, the Chat drawer or the lock screen could leave the
window empty — only its background, nothing to click — when something in
them failed to draw. Nothing caught the failure, so everything was taken down
with it.

**Fixed**

- **The AI dock, the Chat drawer, the minimised chats and every panel over the
  workspace** (search, apps, notifications, transfers, organisations, your
  profile menu, the network and clock popovers) now fail on their own: the
  panel says it stopped working and what went wrong, with **Try again**,
  **Close** and **Copy details**. The rest of WorkSuite keeps working.
- **The window as a whole** says what went wrong, with **Try again**, **Reload
  window** and **Copy details**, instead of going blank.
- **The lock screen stays locked if it fails**: a plain password form takes
  its place, never the workspace it was covering.

**Changed**

- A window's errors are written to the app's log (`main.log` in the logs
  folder — on a Mac, `~/Library/Application Support/WorkSuite/logs`), at most
  200 per window, so a failure can be read afterwards.

---

## 2026-09-30 — 0.2.63: Local AI in Settings and the AI dock

**Added**

- **Settings → Local AI**: this computer (cores, memory, GPU, free space and its tier), Local AI's state with
  **Restart**, the model catalog with **Check for models**, and the catalog's chat models — **Download** with a
  progress bar, **Pause / Resume / Discard**, **Try again** after a failed check, and once installed **Use this
  model**, **Check** (the file against the catalog again) and **Remove**. Models the computer's tier does not
  cover say **May be slow here**.
- **AI Assistant → Ask → On this computer**: with a model installed, the panel offers **WorkSuite AI** or **On
  this computer**. On this computer the answer streams in as it is written, **Stop** ends it, nothing leaves the
  computer, and answers carry an "On this computer" mark. It is chosen by itself while WorkSuite is offline.
  The model does not see WorkSuite data (no tab record, no files) and changes nothing.
- **Qwen3.5 is the Local AI model family** (`docs/local-ai/catalog.qwen3.5.json`, Q4_K_M): 4B is the standard
  download and recommended on most computers, 9B on strong ones, 2B on small ones, 0.8B offered for the smallest.
  `docs/local-ai/README.md` explains the choice and what comes next (tool calling with confirmation, documents,
  scanned pages).
- `scripts/local-ai-catalog.mjs`: `fill` (each model's SHA-256 and size from the GGUF files), `keygen` (an Ed25519 pair; the private key stays out of the repository),
  `hash` (a model's SHA-256 and size), `sign` (checks the catalog and writes the envelope the CDN serves) and
  `verify`.

---

## 2026-09-30 — 0.2.62: Office online in the Document Server, offline in the built-in editor; lock PIN; Local AI groundwork

**Added**

- **A PIN for the app lock** (Settings → Security → PIN): 4 to 8 digits, set or changed with your WorkSuite
  password, and it unlocks WorkSuite on this computer — also offline, where the password cannot be checked. The
  lock screen asks for it first when one is set (**Use password instead** is one click away). Wrong PINs count
  with wrong passwords: five and you are signed out. Only a salted scrypt hash is kept, sealed with the
  database key; it is removed with the rest of your data when a sign-out wipes this computer.
- **Local AI groundwork (WS-SRS-LAI, desktop phase 0/1)** — not yet in the UI: llama.cpp (node-llama-cpp) in a
  separate `ws-local-ai` process with a GPU-or-CPU start, crash limit and idle unload; a model manager that
  takes models only from WorkSuite's CDN through an Ed25519-signed, expiring catalog, with resumable downloads
  checked by size and SHA-256; and the typed `ai:local*` IPC channels. No catalog key is pinned yet, so no
  catalog is accepted until one ships. Installers leave out node-llama-cpp's CUDA builds.

**Fixed**

- **Settings → Files & Sync** showed "Drive sync is not part of this version" although Drive sync is: it now
  shows sync's state, each synced folder (files, size, Show), **Sync now**, **Pause / Resume**, **Reconnect**, and
  **Set up sync… / Manage sync…** (Files → Devices); where sync is not allowed it says why (policy, role, device).
- **Settings → General → Organizations** ran over its label with many organizations: they are chips that wrap
  now, and a row's value never takes more than 60% of the width.

**Changed**

- **Online, Office files always open in the Document Server** (EuroOffice) inside a WorkSuite DOC / Sheet /
  Slides tab. A mail attachment, tender file, chat file or file from this computer is first copied into
  **My files → WorkSuite copies** and opens as that Drive file. A copy of a file on this computer stays linked:
  its changes are written back to the file when the tab closes (the Document Server saves a moment later, so it
  is written twice to be sure), or at once with **Update the file now**. If the copy cannot be made, **Edit it
  here without the Drive** uses the built-in editor.
- **Offline, the built-in editor (BetterOffice)**: a Drive file with a copy on this computer (a synced folder,
  or one opened in another app) is edited on that copy, which goes to the Drive when WorkSuite is online again;
  without one the tab says it is not on this computer. Files from this computer open there as before.
- A server without a working Document Server still gets the built-in editor, now with a banner saying why.
- **Drive shows the first page of PDFs and Office files** in the grid (the server makes thumbnails for pictures
  only): drawn on this computer once a card is on screen — PDFs by pdf.js, presentations by BetterOffice's slide
  renderer, Word and Excel files by a hidden read-only editor — one at a time, files up to 25 MB, and kept in PDF
  Studio's sealed thumbnail cache per file version (only where offline storage is allowed).
- **Drive's toolbar**: **Details** now opens with nothing selected (the folder you are in, or a summary of the
  view), and **Refresh** reloads the list and spins until it has.
- **PDF Studio's side panels**: the tabs are a segmented control that fits the panel (the chosen one named, the
  others as icons), and the search options are toggle chips.
- **AI Assistant → Ask** uses the Chat composer's box: the question, the file button and Send in one bordered
  field with its focus ring, and "Enter to send · Shift+Enter for a new line" under it.
- The built-in editor is no longer offered by hand while online (the file menu's **Edit in WorkSuite
  (built-in)** and the EuroOffice header's **Built-in editor** are gone).

---

## 2026-09-30 — 0.2.61: WorkSuite DOC, Sheet and Slides — Office files from every module in a tab

**Added**

- **WorkSuite DOC / Sheet / Slides**: every Office tab says which it is (DOC for Word, ODT and RTF files, Sheet
  for Excel, ODS and CSV, Slides for PowerPoint and ODP) in its WorkSuite-owned header.
- **Mail, Tenders and Chat open Office files in a tab**: a .docx, .xlsx or .pptx mail attachment, tender
  document, checklist file, letter or library file, or chat attachment opens in a WorkSuite DOC / Sheet / Slides
  tab instead of Word, Excel or PowerPoint. Such a document has nowhere to go back to: **Save to Drive** makes it
  a file in My files (and closing the tab with changes does the same, so nothing is lost); **Save a copy** writes
  it where you choose.
- **Files from this computer**: **Open from this computer** on the Office home, and .docx / .xlsx / .pptx files
  the operating system hands over ("Open with WorkSuite"), open in a tab and **Save** writes back to the same file
  (atomically). The page never sees a path: the main process issues a handle for a file from its own dialog or
  from the OS, checked by its name and its first bytes, and outside WorkSuite's own data.
- Every Office tab can **Save a copy** on this computer.
- **Office → New works on every server**: Document, Spreadsheet and Presentation were greyed out on a server
  without the Office API. A new file now comes from the server's Office API, else from Drive's own blank
  documents (`POST /api/files/create`), and only on a server with neither from WorkSuite's own blank file
  (`scripts/make-blank-office.py`) uploaded to My files — then opens in a WorkSuite DOC / Sheet / Slides tab.
  **From a template** still needs WorkSuite Office on the server.

**Changed**

- Office tabs are one per document for attachments and local files too (the same attachment brings its tab
  forward; two attachments are two tabs).
- Older formats (.doc, .xls, .odt…) from Mail, Tenders and Chat still download and open as before; from the
  Drive they open in EuroOffice.

---

## 2026-09-30 — 0.2.60: Office documents edit inside WorkSuite — EuroOffice, or the built-in editor

**Added**

- **EuroOffice inside the app on every server**: on a server with the
  EuroOffice editor but not the newer Office API (`GET /api/office/config/{id}`,
  the web's own editor), Word, Excel and PowerPoint files now open in
  WorkSuite's editor tab — the Document Server's editor in the app's isolated
  view — instead of Word, Excel or PowerPoint on this computer. The Document
  Server saves to the Drive as you edit; the tab says Saving… / Saved to your
  Drive.
- **Built-in editor (BetterOffice)**: .docx, .xlsx and .pptx files can be
  edited inside WorkSuite with no Document Server and no Office app on this
  computer — BetterOffice's Rust engines compiled to WebAssembly, with open,
  metric-compatible fonts bundled (nothing is fetched from the internet).
  The file is read from the Drive and saved back as a new version (Save,
  the editor's own Save, and when the tab closes). It opens by itself when
  the server has no EuroOffice editor, from **Built-in editor** in an
  EuroOffice tab, and from **Edit in WorkSuite (built-in)** in a file's menu.
- **New window** in both Office editors' headers moves the document to a
  window of its own (changes are saved first).

**Changed**

- The app's content security policy allows WebAssembly to compile
  (`'wasm-unsafe-eval'`) for the built-in editor; JavaScript `eval` and
  scripts from anywhere but the app itself are still refused.
- Office files no longer go to an installed app by default on a server
  without the Office API; **Open in Word / Excel / PowerPoint** stays in the
  file's menu, and the editors offer **Open in desktop app**.

---

## 2026-09-30 — 0.2.59: the App Launcher in the top bar, side panels that hide

**Added**

- **App Launcher button** in the top bar, beside the WorkSuite name: every
  app you have, as tiles (the same launcher as More apps in the sidebar).
- **Hide and show side panels**: every module's side menu — HR, Billing,
  CRM, Sales, Inventory, Expenses, Finance, Tenders, Contacts, Tasks, Notes,
  Drive, Mail folders, Calendars, Chat conversations and website chats,
  eLearning (and a course's outline), Events, Garage, Hotel PMS, SalonMate
  and Notifications — and the Tenders review and website visitor panels
  have a handle on their edge that hides them; a narrow strip with the panel
  icon brings them back. Each panel's choice is remembered on this computer.

---

## 2026-09-30 — 0.2.58: PDF Studio editing, documents open on this computer, the Office tile

PDF Studio edits (stage D2): annotations, pages, saving back to Drive as a new
version or a copy, with the server's lock, conflicts, undo and recovery. Every
module's documents now open on this computer — PDFs in PDF Studio, Word, Excel
and PowerPoint files in WorkSuite's editor or the installed application —
never in the browser. Office has a tile of its own.

**Added**

- **PDF Studio — Annotate** (PDF-ANN): highlight, underline, strike out and
  squiggle across text (the words under the drag, found by the engine),
  notes, text boxes, freehand drawing, rectangles, ellipses, lines and
  stamps (Approved, Rejected, Draft, Confidential…), in six colours with a
  width and opacity. Select, move and delete; every annotation carries its
  author and time. The **Comments** panel lists them by page.
- **PDF Studio — Organize** (PDF-PAGE): every page as a thumbnail; select
  (Shift for a range, Ctrl/⌘ for more), drag into a new order, rotate,
  delete, insert a blank page or another PDF's pages, and extract pages to a
  new PDF.
- **Modes and the server's lock** (PDF-EDIT, PDF-LOCK): View, Annotate and
  Edit, as the server's session allows (`POST /api/files/{id}/pdf/sessions`);
  Edit takes the file's lock, with **Take over** where the server offers it.
  A heartbeat keeps the session; a lost lock says who has it and stops
  saving to that version.
- **Saving** (PDF-SAVE): **Save** makes a new Drive version (uploaded in
  checked 4 MiB chunks, `POST /api/files/{id}/pdf/save`), **Save a copy**
  another file beside it; a local PDF is saved in place (written to a
  temporary file, synced, then renamed). When someone saved first, the
  conflict dialog offers Keep both, Save as a new version anyway, or Use
  theirs. Offline, a save waits on this computer and goes when WorkSuite is
  back. The title bar says Unsaved changes / Saving… / Saved · vN / Saved on
  this computer.
- **Undo and redo** (Ctrl/⌘ Z, Ctrl/⌘ Shift Z or Ctrl/⌘ Y) across every
  change since the file was opened.
- **Recovery** (PDF-REC): unsaved work is snapshotted, sealed, on the
  server's autosave interval and when the tab closes; opening the file again
  offers to restore it.
- **Office tile**: Office in the launcher and the sidebar search, with **New
  Document / Spreadsheet / Presentation**, **From a template** (in My files,
  opened for editing), the copies being edited in Word, Excel or PowerPoint,
  and the Office files opened lately.

**Changed**

- **Documents from every module open on this computer**: a download started
  with "open" now opens a PDF in PDF Studio (even where the organisation
  does not allow other applications) and anything else in the application
  the system has for it. Chat attachments, task attachments, HR documents
  (View) and leave evidence are downloaded and opened that way instead of in
  the browser; invoices, credit notes, receipts, purchase orders and mail
  attachments that are PDFs open in PDF Studio.
- **Office files on a server without WorkSuite Office** open in the
  installed Word, Excel or PowerPoint on a tracked copy that is saved back to
  the Drive, not in the web's editor. A type the administrator set to
  "Preview" opens read-only in the installed application when it can be
  downloaded.
- A local PDF opened in PDF Studio is editable (Annotate and Edit), saved in
  place.

---

## 2026-09-29 — 0.2.57: WorkSuite Events — the Event Desk

WorkSuite Events opens in its own tab for whoever has the app (and
`events.access`), over the server's `/api/events/v1`: the **Event Desk** —
check-in, check-out and re-entry at a gate, scanning, search, walk-ins,
badge printing and offline check-in (Events SRS §15.2, §9, §8.4) — and the
organiser's read of an event. What each person sees is what the server says
they may do in the event's company. Counts, capacity, money and every
verdict online are the server's, shown in its own words; planning — events,
tickets, forms, the schedule, screens, badge templates, gates and devices —
is the web's.

**Added**

- **Events**: the events you reach, live ones first, and the events this
  computer is a check-in device at.
- **This computer at an event's gate** (EV-CHK-031..033): registered as a
  `desktop` check-in device by its sync device id. The server hands over the
  device key once; it is kept in the OS credential store and never reaches a
  page, a log or the diagnostic bundle. Its state as the server sees it, a
  new key, and stopping (never with scans still unsent, unless you say so).
  The event's devices are listed; managing them is the web's.
- **Event Desk Mode** (EV-POR-010..012): the event's name, a large scan area
  that keeps the keyboard's focus — a USB or Bluetooth scanner types into it
  and presses Enter, and so can you with a registration number — the result
  in its colour with its icon and words (and a tone), the attendee, ticket
  and where they are, the live counters (Inside, Checked in, today's), and
  Search, Walk-in and Print badge. **F2 / Alt+S** search, **F3 / Alt+W**
  walk-in, **F4 / Alt+P** print, **F6 / Alt+O** check in or out, **Enter** on
  an empty field presses the result's button, **Esc** clears. Full screen on
  the desk alone. The camera scans where the system reads QR codes itself
  (macOS).
- **Check-in, check-out and re-entry** with the server's answers (the Check
  In button, or the gate's automatic check-in); a ticket waiting for its
  payment offers **Take payment** (Billing's methods, with a reference) to
  those who may.
- **Search** (EV-CHK-050): name, number, phone, email, company or ticket;
  arrows and Enter pick and scan.
- **Walk-in** (EV-CHK-040..042): name, a phone or an email, the ticket, the
  published form's fields and consents for it, the payment or its waiver, a
  promo code — one press registers, checks in and prints the badge.
- **Badges** (EV-BDG-010..014): printed on the desk's own printer —
  silently when set so, at the template's size or the printer's label — from
  the server's badge page, each reported printed or failed; the gate's
  automatic print on check-in printed at once; a reprint asks its reason;
  **pre-printing** by ticket, sorted by name or company, in runs of fifty;
  the print queue; badges sent to the desk's printer by name (from a phone at
  a door) taken while the desk is open.
- **Offline check-in** (EV-OFF-001..013): when WorkSuite does not answer
  within six seconds the desk answers from its copy of the gate's tickets
  with the server's own ScanRules — the same checks in the same order, the
  same sentences — and keeps the check-in, check-out, refused attempt or
  walk-in (with a provisional number) for WorkSuite; they go up by
  themselves when it answers, recorded once however often sent. The copy is
  kept current every fifteen seconds while online; the desk warns of its own
  second entry and says that entries at other gates show late. **To review**:
  the server's possible duplicates and conflicts (resolve with a note,
  dismiss with a reason) and what the server made of each offline scan.
- **Live counters**, also in a window of their own for a second screen;
  **recent scans** at this desk or everywhere.
- **Today's program** and **session doors** (EV-CHK-060): a room's entrance
  scans into its session, online; who holds a place.
- **Event 360** read: the server's counts, each with what it counts, the
  capacity, ticket money for financial viewers and the live view;
  **registrations** by list, a registration with its answers and badge
  prints, **attendees** and a profile. The **emergency message** on every
  screen of the event, typed confirmation, for those who may raise it.
- `worksuite://events`, `worksuite://events/<id>`, `…/<id>/desk` and
  `…/<id>/counters`; the server's notifications (`/events/<id>`,
  `/events/<id>/registrations/<id>`, `/events/<id>/checkin/reconciliation`,
  `/events/<id>/devices`, `/events/<id>/schedule`…) open their screen here;
  notices of category `events` show only to people who have the app.

**Works offline**

- The desk scans, checks in and out, searches (name, number, company,
  ticket — the copy holds no email or phone) and takes walk-ins from this
  computer's copy of the gate's tickets: hashes under the device key, name,
  number, company, ticket, status, whether money is owed and presence — no
  email, phone, address or amount — encrypted in the profile, per server,
  event and person. It goes when it expires, when the event's offline
  check-in is switched off, or when the device is revoked (with the key and
  the queue, at once).
- Scans made offline belong to the person who made them: another person
  signed in at the desk sees only that they wait, and a plain sign-out keeps
  them for their maker.
- The person's permissions, the events and their gates are the last copy
  (READ_CACHE), so a desk opened with the line down still scans.
- Everything else — counters, recent scans, review, badges, payments, the
  program, Event 360 — waits for WorkSuite.

**Where it bites**

- Offline check-in needs a computer the desktop policy lets keep data
  offline and queue changes (a trusted one), and the event's offline
  check-in switched on.
- Desk staff need to see the event (`events.event.view`) as well as check
  in: the server hides every event, and every check-in call, from anyone who
  does not.
- A desktop check-in device needs a server with WorkSuite Desktop's device
  registry (the `/desktop/v1` API).
- Badges print without the logo and the photo (the server's badge page names
  them without a picture); the event's name stands in the logo's place.
- A walk-in kept offline carries the standard fields only; a form that asks
  for more makes the server queue it for review.
- The camera reads QR codes only where the system does (macOS); elsewhere a
  USB scanner or the typed number does the job.
- Tests: the docked-workspace tests no longer leave an unhandled error for
  the next test. The tab store saves on a 500 ms timer that could fire after a
  test had restored its mocks, and the store's `.catch` then met `undefined`;
  the teardown now keeps the mocked call answering with a promise.

---

## 2026-09-29 — 0.2.56: PDF Studio — the viewer

PDFs now open inside WorkSuite, in **PDF Studio** (WorkSuite PDF Studio SRS,
stage D1): from Files, from Mail, from this computer, or handed over by the
operating system — each in a tab of its own. This first stage **views**:
annotation, page tools, saving back to Drive, autosave and offline editing
come with the next stage, and the app says so where their buttons will be.

**Added**

- **Opening** (§5). A PDF in Files opens in PDF Studio instead of the
  browser; a tab already showing it comes to the front. A PDF attached to an
  email opens for **preview only** (the original stays as it arrived; other
  attachments still download and open). **Open a PDF…** (Ctrl/⌘ O) and
  dropping PDFs on PDF Studio open files from this computer, read where they
  are and never uploaded. A PDF the system hands to WorkSuite ("Open with…"
  and choosing WorkSuite) opens in a new tab. The web's `/pdf?file=` links
  open here too. Opening a Drive file asks WorkSuite first; nothing of the
  file is fetched before it says yes (PDF-OPEN-010).
- **The viewer** (§6). PDFium draws the pages — the engine inside Chrome —
  in a separate process for each document. Only the pages on screen exist,
  each drawn small first and sharp once scrolling stops, in tiles at high
  zoom; a page scrolled past stops being drawn. A 2,000-page PDF opens
  without drawing it. Single page, continuous, two pages, two pages
  continuous; zoom 25 %–6400 %, fit width, fit page, actual size, Ctrl/⌘ +
  wheel; full screen, presentation (one page on black, arrow keys) and read
  mode. Page thumbnails, bookmarks (the outline), links inside the document.
- **Find** (Ctrl/⌘ F; Ctrl/⌘ Shift F adds comments and bookmarks): match
  case, whole word, regular expression; results stream in as pages are
  searched, each with its page and the words around it, and are highlighted
  on the page.
- **Password-protected PDFs** (PDF-OPEN-008): "Enter PDF password", with
  "Remember for this session" — kept in memory until you sign out or quit,
  never saved, never sent.
- **Print** (Ctrl/⌘ P, §14.4): all pages, this page or a range; fit or
  actual size; with or without comments and form fields; standard or high
  quality; printer, copies, orientation and two-sided in the system dialog.
  Up to 500 pages a job.
- **Properties, versions, activity**: the document's facts, its own security
  settings and what was found in it; for a Drive file its versions and
  activity, and who is editing it if someone is.
- **Download** a Drive PDF or an attachment through the download manager.
- **PDF Diagnostics** (Help → Diagnostics → PDF Diagnostics, or from PDF
  Studio): the engine, its process, drawing, fonts, temporary storage,
  WorkSuite's PDF service, the local database, printing; OCR and conversion
  said to be later.
- The keyboard shortcuts of §4.3 (Open, Save, Print, Find, Zoom, H for the
  hand, V for select) go through WorkSuite's shortcut registry: Settings lists
  them and changes them.

**Safe by default** (§12.5)

- Scripts in PDFs never run: the engine has none, and nothing else would run
  them. Actions that start a program or open another file are never followed.
  A web link asks first ("Open this link from the PDF?"); only https and mail
  links leave the app. Embedded files are listed, never opened. A banner says
  what was found and blocked; Properties counts it.
- The engine runs in its own process per document, inside WebAssembly: a
  malformed PDF can crash only that process. The tab then says so and offers
  **Retry**; the rest of WorkSuite carries on. A document past its memory
  ceiling (1 GB) or an engine that stops answering is ended the same way.
- Drive files and attachments are kept while open as sealed working copies
  (AES-256-GCM, key in memory only) in WorkSuite's own folder, removed when
  the tab closes and at start-up; page thumbnails are cached sealed, and all
  of it is removed with WorkSuite's data at sign-out or a remote wipe.
- Passwords, paths, file names and document text are never logged, audited
  or reported. Opening and printing are audited with the file's id, version
  and page count. A failure is logged with the file's format, size and page
  count and the engine's error — that is what a diagnostic report carries.

**Where it bites**

- **Read only.** Annotation, page organising, saving as a Drive version,
  autosave, crash recovery, offline editing and edit locks arrive with the
  next stage. Save (Ctrl/⌘ S) says so.
- **Text cannot be selected or copied yet**; the Select tool follows links.
- **Chat attachments** still open the way they did.
- A Drive PDF needs WorkSuite to open; files kept offline for PDF Studio come
  with offline editing.
- Printing sends pages as images at 150 dpi (300 at high quality), up to 500
  pages at a time; a printer's own PDF handling is not used.
- **WorkSuite is not registered as a PDF handler** (the desktop claims no
  common file types, FR-DL-06): choose it in "Open with…". Dropping a PDF on
  the Dock icon works once macOS knows WorkSuite opens PDFs, which needs that
  registration.
- The engine in its own process, a 2,000-page file, a crashed worker and a
  print job laid out from memory were tried for real on Linux (under Xvfb,
  `tests/os/pdf/check.mjs`); the "PDF engine" workflow runs the same on
  Windows and macOS and has not run there yet. The system print dialog and a
  real printer have not been tried.

**For administrators**

- New dependency `@embedpdf/pdfium` 2.15.1 (MIT; PDFium itself BSD-3-Clause
  and Apache-2.0), a WebAssembly build of PDFium. MuPDF was not used: it is
  AGPL or commercial.
- The organisation's PDF Studio policies (print, copy, export, external
  links, local files, largest PDF) are checked everywhere they apply, but
  read their defaults until the server's PDF Studio service sends its own
  (all on, links ask first, 2 GB). The desktop's own `downloads` policy and
  `desktop.downloads` permission already govern Download.

---

## 2026-09-29 — 0.2.55: Office documents in WorkSuite tabs

Word, Excel and PowerPoint files from Drive open in a WorkSuite tab with the
Office editor — the Document Server's own ONLYOFFICE editor, over the
server's new Office API (WorkSuite Drive — ONLYOFFICE Office File
Integration SRS, the desktop's MVP). No browser window, no download. What
you may do in a document is what the server says; saving goes straight
from the editor to Drive, never through this computer.

**Added**

- **Opening**: double-click (or Enter, Open) an Office file in Files and it
  opens in a tab of its own, named after the file. Opening it again brings
  that tab forward — in this window or the one it was torn off into —
  instead of a second copy. What opening does is the server's choice for
  that kind of file (edit, read, or the web's preview); the file menu adds
  **Edit** and **Open read-only**.
- **The tab's header**: the file's name; **Saving…** while your changes are
  on their way, then **Saved · 14:32**, with the last WorkSuite version
  beside it (version, time, who); **Save failed** or **Saving is delayed**
  in the server's words, with **Retry**; who else is in it (● Samali ●
  Ishan, editing or viewing); the **mode** — Editing, Reviewing (changes
  tracked), Commenting, Viewing — as far as the server allows; **Share**
  (WorkSuite's share dialog); and **⋯**: Download, Download as PDF, Save as
  PDF to Drive, Save as version…, Version history, Open in Microsoft Word /
  Excel / PowerPoint or the default app, Convert & Edit (DOC, XLS, PPT),
  keep the document to yourself while you edit, reload the editor. Each
  appears only when the server's permissions for you allow it.
- **Read-only** documents say why, in the server's sentence ("You can view
  this document, but you don't have permission to edit it.", "Samali is
  editing — you can view until the lock is released."), with **Switch to
  edit** when that becomes possible. "A newer version is available" when
  someone uploads or restores one; you choose when to open it.
- **Closing a tab with changes** shows "Saving changes…" and waits — ten
  seconds at most — for them to reach the Office server, asks it to save,
  and then closes. Switching company closes that company's documents.
- **Version history** beside the document: download a version, restore
  one as the current version (everyone in the document is offered it).
- **In the editor**: rename (the file in Drive, and the title for everyone
  in it), Share, mentions in comments (the server tells the people you
  mention who can open the document, and offers to share it with those
  who cannot — a mention never shares it), Edit from a read-only document.
- **+ New → Document, Spreadsheet, Presentation** make the file on the
  server ("Untitled Document.docx"…) and open it for editing; **From a
  template…** lists your company's templates and WorkSuite's.
- **Convert & Edit** for DOC, XLS and PPT: "This legacy file will be
  converted to DOCX for editing." — a new file beside the original, which
  stays as it is; or View Only.
- **Open in Microsoft Word / Excel / PowerPoint** (where installed) or the
  **default app**, from the file menu or the tab. A file Drive sync keeps
  on this computer opens where sync keeps it, and sync takes the changes
  back. Any other file is downloaded (it shows in Transfers) and watched:
  when you save it there, Files and the document's tab offer **Upload as
  new version**. If Drive has moved on meanwhile: "The cloud file changed
  while you were editing." — **Keep Both**, **Review**, **Upload as New
  Version** or **Cancel**. Nothing goes back without you, and nothing newer
  is overwritten.

**Works offline**

- An Office file offline says so: "You're offline. This file is available
  on this device." with **Preview** (macOS Quick Look) and **Open in
  External App** when a copy is here — synced, or opened in another app
  before — and "WorkSuite Office editing requires a connection." There is
  no Office editing offline; the tab opens by itself when WorkSuite is
  back. Files still knows how to route Office files offline (the server's
  formats are kept with Files' offline answers).

**Security**

- The editor runs in a view of its own, in its own process and in an
  in-memory storage partition per company — cleared when the company's last
  document closes, at sign-out and when quitting. Its page can reach the
  configured Document Server and nothing else of the network, cannot
  navigate away, has no access to WorkSuite's API or your sign-in, and
  talks to the app through a four-function bridge whose every message is
  checked. Links from documents open in your browser after the usual
  check. The editor's own "Download as" is off; documents leave through
  the tab's Download and Export. See docs/SECURITY.md.
- While the editor has the keyboard, its shortcuts are its own: ⌘/Ctrl+K
  inserts a link rather than opening Search, ⌘/Ctrl+L aligns left rather
  than locking WorkSuite. Closing and opening tabs still work.

**Where it bites**

- **Not yet tried against a real Document Server.** Everything here is
  built to the server's contract and unit-tested with the editor faked;
  loading ONLYOFFICE's editor into the desktop's own page, printing from
  it, and co-editing with the web need a server to confirm.
- A Document Server must be served over HTTPS for the desktop (plain HTTP
  only on this computer, in a development build). The desktop refuses to
  load the editor from anywhere else, with that sentence.
- The editor's @mention list fills only as you type, and only with an
  editor that sends what was typed; otherwise mention people by address
  (the server needs two letters to search).
- A menu, dialog or the command palette hides the document while it is open
  (the editor is a native view and would cover them). Toasts and minimised
  chats can sit under the editor.
- A tab torn off into its own window, or docked back, opens the document
  again there (a new session on the same document; nothing is lost).
  Closing such a window does not wait for unsent changes the way closing a
  tab does; the Office server keeps what it has.
- A Keep Both copy made from the document's tab goes to the top of My
  Drive (the server does not say which folder the document is in); from
  Files it goes beside the original.
- An edited copy goes back in one request, so a copy larger than the
  server's upload limit cannot go back with the conflict check.
- Word, Excel and PowerPoint are offered only where they are installed in
  the usual place (macOS Applications, Windows' App Paths); Linux offers
  the default app.
- A server without the Office API keeps the old way: Office files open in
  the web's editor in your browser.

---

## 2026-09-29 — 0.2.54: Hotel PMS at the front desk

Hotel PMS opens in its own tab for whoever has the app (and `pms.access`),
over the server's `/api/pms/v1`: the front desk, the cashier and the night
audit of a hotel (PMS-DSK-001). What each person sees is what the server
says they may do — the rail, the rack's quick actions, every button. Money,
prices, availability, taxes, balances and the business date are the
server's; the desktop writes them as they come, and shows a refusal in the
server's own sentence. The back office — rates, rooms and room types,
packages, taxes, reports, settings and the set-up wizard — is on the web
("Back office on the web" in the rail).

**Added**

- **A property selector** in the rail (kept on this computer; a record of
  another property moves it), with the property's **business date** — "today"
  for the desk until the night audit moves it on.
- **Room rack** (PMS-FD-001…005): every room by building and floor with the
  server's status badge — colour, icon and words — the counts by status (a
  click filters), and filters by building, floor, room type, housekeeping
  status, VIP and due in/out. A click opens the room's quick actions as the
  server lists them for you: new reservation, walk-in, block room (the
  reservations on it named, to move), report a fault, view room; for an
  occupied room also open folio, post charge, room move, check-out and extend
  stay. The arrivals, departures and in-house lists are one click away. It
  follows the house: the server's live nudges refresh it, and it asks again
  every half minute.
- **Arrivals** with each room's readiness (a number, in service, empty,
  clean or inspected) and the guest's ID, deposit and requests; **Assign
  rooms** for the day (VIPs first) or one room at a time from the server's
  candidates — another type is an upgrade or a downgrade, complimentary or
  paid. **Departures** and **In house**, with the registration cards of the
  day's arrivals printed in one go.
- **Check-in** (PMS-CKI-001…005, AC-06): the quick screen — rooms, readiness,
  flagged preferences, ID and guarantee ticks, the early check-in offer,
  cash-only, keys per room — and one button (**Alt+I**). A room that is not
  ready is refused unless someone who may override gives a reason; the
  server's refusal is shown as it is. Several rooms check in together or one
  by one. Then the keys (the property's door-lock system), and the
  **registration card**: printed, or signed on the screen (or a signature
  pad) and kept as the guest's document.
- **Walk-in** (PMS-WLK-001/002) on one screen: how long, what is free
  tonight at what price (a rate not on offer says why), the guest, the room
  (or the best ready one), a payment if there is one — checked in with one
  press.
- **Reservations**: the property's list by status, and **search** across the
  properties you reach by guest name, email or phone, confirmation number,
  channel reference or room (**Alt+F**). A reservation's page: the rooms and
  their prices night by night, the moves the server offers you from its
  status, cancel (the plan's fee, or waived by someone who may), change dates
  and requests, assign rooms, the deposit (take, waive, refund), its history.
- **New reservation** (PMS-RSV-010, AC-01, AC-03): availability for the
  stay with every rate's price or the server's reasons, the guest found or
  added — "Possible existing guest found" when the details match someone
  (AC-05) — the details, and one booking per press; a restriction is booked
  through only by someone who may, with a reason. **Alt+N** (and Ctrl/⌘+N).
- **A guest in house**: the stay (key, ID, card, what the room may be
  charged), **room move** (the old room goes to housekeeping; a paid or
  complimentary upgrade; a room not ready only with the override),
  **extend or shorten**, **keys** (issue, revoke, ask the lock system),
  **charges to the room** and the credit limit, **split folio** and
  **routing** of charge types to another folio.
- **Folios** (§10): lines with their taxes, payments, totals and the tax
  summary; **post a charge** (**Alt+P**), void a line of today, adjust or move
  a line with a reason, **take a payment** (card by the slip's reference and
  last four digits — never a card number), refund, void a waiting payment,
  settle, reopen, move a company's balance to its account, raise the
  invoice, **print** the receipt, invoice or statement.
- **Check-out** (PMS-CKO-001…003): each room in house with its folios, the
  mini bar still to be charged, the deposit to apply, late check-out, an
  early departure, the company's balance to its account; the folios that
  still owe named when the server refuses; the invoices or receipts after,
  to print.
- **Cashier** (§10.7): open a shift at this terminal with the opening cash,
  what it took by method, close it by counting the drawer (a variance within
  the property's allowance reconciles itself; beyond it someone else
  approves it with a reason), the shift's payments, its printed report.
- **Night audit** (§13.1, AC-10, AC-11): the business date, the checks with
  their counts, each blocker with a way to its record and — for the general
  manager — an override with a reason; **Run** once nothing is open, the ten
  steps as they go, a failed step in the server's words and **Resume**; the
  report (occupancy, ADR, RevPAR, revenue, taxes, payments, movements) on
  screen and printed, and earlier audits.
- **Housekeeping** as the desk reads it: every room's housekeeping status
  beside its front-office status, and the day's cleaning tasks.
- **Guests**: lookup across guests and CRM contacts, a guest's profile,
  reservations and documents (identification only for people who may see
  it), a document added from this computer.
- **Guest requests**: take one for a room, and move the open ones on.
- **Dashboard**: the server's widgets on the business date, each opening its
  list.
- **Desk devices** (PMS-DSK-002): the device agent seam — ID scanner, key
  encoder, registration-card and receipt printer, signature pad, cash drawer,
  card terminal — with the "no device" providers and this computer's own
  printing for cards and receipts. No vendor driver ships.
- **Windows** (PMS-DSK-004): the rack, a reservation, a stay or a folio in a
  window of its own — the rack on one screen, a reservation on another.
- `worksuite://pms`, `worksuite://pms/reservations/<id>` and
  `worksuite://pms/rooms/<id>`; the server's notifications
  (`/pms/reservations/<id>`, `/pms/folios/<id>`, `/pms/rooms/<id>`,
  `/pms/front-desk?arrivals=`, `/pms/night-audit`, `/pms/cashier/<id>`,
  `/pms/requests/<id>`…) open their screen in the tab; notices of category
  `pms` show only to people who have the app.

**Works offline** (PMS-DSK-003)

- The room rack, the arrivals, departures and in-house lists, the property
  list and its options are kept (READ_CACHE, per property) and shown with a
  clear banner when WorkSuite cannot be reached.
- Nothing is queued: check-ins, walk-ins, new bookings, charges, payments,
  refunds and the night audit wait for WorkSuite, so no room or payment is
  taken against what this computer cannot see. Money is not kept for offline
  reading, and balances are hidden on the rack while offline.

**Where it bites**

- The desk's hardware is the seam only: without a vendor driver, keys follow
  the property's door-lock system on the server (or are handed over by hand),
  the guest signs on the screen, and a card taken on a standalone terminal is
  recorded with the slip's reference and last four digits.
- Registration cards print once a guest is checked in: the server's card is
  a stay's, so cards cannot be printed ahead for the day's arrivals.
- Check-out needs "See folios" as well as "Check guests out" (the server's
  rule: the folios are the check-out).
- A cashier who may post charges but not read reservations types the charge
  code (the server lists charge codes to rate managers and reservation
  readers).
- On a Mac, Option+letter in a text field types its character (ñ, é…); the
  desk's shortcuts work anywhere else on the screen.
- The tape-chart calendar, rates, rooms, packages, taxes, reports and
  settings are the web's.

---

## 2026-09-29 — 0.2.53: eLearning on the desktop

eLearning opens in its own tab for whoever has the app (and
`elearning.access`), over the server's `/api/elearning/v1` — learners take
their courses here, and the training team builds, reviews, publishes,
assigns and grades them here. Nothing in eLearning sends you to the web.
What each person sees is what the server says they may do: the rail, the
buttons and each course's actions follow its `can`.

**Added**

- **My Learning**: assigned, in progress, completed, overdue and waiting
  for approval; Continue learning with Resume (the lesson you left); upcoming
  deadlines; the quizzes and assignments still open; courses waiting for
  approval; recommendations with the server's reason; what you completed.
- **Course catalogue**: search by title, code, summary or category, with
  category, level, type and length filters; a course's page with its outline,
  what completes it and places left; **Join** (open courses), **Ask to
  join** (courses that need approval, to your manager) or the server's
  reason why not; take a request back.
- **Taking a course**: the outline with each lesson's progress and, for a
  locked lesson, why (release date, a lesson to finish first); the
  completion rule as a checklist; Start / Resume. Lessons:
  - **Video and audio** resume where you stopped, at 0.5×–2×, with the
    server's captions, full screen and picture-in-picture. **Only what is
    actually played counts**: the player reports the ranges played every 15
    seconds and whenever playback stops; skipping ahead plays nothing, and
    the server credits no faster than time allows (it says so when it
    trims a claim).
  - **Articles** count as read at the end (with the time spent, counted on
    the server); **PDFs** count each page shown; images and documents open
    in the app's viewer; **links** open in your browser.
  - **Mark complete** where that is the lesson's rule; Previous / Next,
    also **Alt+←** / **Alt+→**; **Save a copy** where the lesson allows
    downloading (through the download manager).
  - **Open in a window**: take the course beside your work.
  - **Leave the course** (an optional course you joined yourself, where the
    company allows it).
- **Quizzes**: the rules, your attempts and the best score (as the quiz
  shows it), start or carry on; every question type — single and multiple
  choice, true/false, short answer, fill in the blanks, number, matching,
  ordering (up/down, keyboard), long answer and files from Drive. Each answer
  is saved as it is given; **the time left is the server's**; a quiz that
  times out is submitted as it stood. Results: the score, passed or not, and
  the answers and explanations as far as the quiz shows them. Learners never
  receive the key before submitting.
- **Assignments**: the brief, the due date that holds for you, attempts
  left; hand in text and files — from Drive, or from this computer (up to
  25 MB together) — as a draft or for grading; late work marked or refused as
  the assignment says; grades and feedback.
- **Kept offline** (see below): the courses on this computer.
- **For the training team** (by permission, or as a course's instructor,
  author or evaluator, or a line manager):
  - **Training dashboard**: the ten KPIs (a later phase's are "Later", never
    zero), completions over six months, learning progress, popular and
    recently completed courses, daily learner activity, grading by
    instructors.
  - **Courses**: by status, type or search, or only yours; **New course**
    with the code the server offers from the category.
  - **A course**: its lifecycle — submit for review (with a note), recall,
    approve or return (with a comment), publish now or later, suspend (with
    a reason), resume, archive, reopen as a new version, duplicate, delete a
    never-published draft — with the server's list of what stops it (every
    problem, and the set-up when that is it). **Details** (type, level,
    language, enrolment and visibility — later phases' choices named, not
    offered — dates, due days, places, pass score, weighting, certificate,
    and the **completion rule**: every or any of mandatory lessons, a
    progress, passing an assessment, completing an assignment), saved with
    the revision it was read at: someone else's change is offered, never
    overwritten. **Staff**, **Activity** (the audit), **Preview as a
    learner** (nothing recorded).
  - **The builder**: sections and lessons **dragged** into place (or moved
    with their arrows), across sections too, every move sent with the
    revision; add, edit, duplicate, hide, unpublish, delete; each lesson's
    type, file from Drive (with Drive's preparing/failed state), text, link,
    quiz or assignment, completion rule and its settings, mandatory,
    duration, release date, prerequisite, downloading allowed; preview.
  - **Assessments**: settings (pass mark, timer, attempts, cooldown, what
    counts, when answers show, shuffling, negative marking, window, due,
    final) and questions of every type with their key, reordered; the
    attempts. Editing a question someone answered keeps that version.
  - **Assignments**: the brief, marks, pass score, file types and sizes,
    attempts, late work and penalty; the submissions.
  - **Enrolments**: a course's learners, or everyone you follow; **Assign
    learners** by person, whole departments, branches or a list of e-mails
    or employee numbers — previewed first (new, already there, blocked,
    outside your reach, not found), then assigned once — with a due date,
    mandatory and a note. An **enrolment's page**: lesson by lesson, the
    rule's checklist, the history; due date and mandatory, **extension or
    extra attempts**, **mark complete**, **reset**, **withdraw** (each with
    its reason, audited).
  - **Requests to join** (approve, or decline with a reason), **Learners**
    (most overdue first) and a learner's courses, **Reviews** waiting for
    you.
  - **Grading**: the queue, oldest first, never your own work; grade a
    quiz's answers that need a person, or a submission (take it for review,
    score, feedback, ask for it again); changing a grade asks why. Any of them
    opens in a window of its own.
  - **Set-up wizard** (the fourteen default categories in one step) and
    **Settings** (the company's eLearning settings).
- `worksuite://elearning`, `worksuite://elearning/courses/<id>` and
  `worksuite://elearning/catalog/<id>`; the server's notifications
  (`/elearning/my/courses/<id>`, `/elearning/grading`, `/elearning/approvals`,
  `/elearning/learners/<id>`…) open their screen in the tab.

**Works offline**

- My Learning, the catalogue, your courses' outlines and the lessons you have
  opened show their last copy when WorkSuite cannot be reached.
- **Courses kept for offline learning.** **Keep offline** on a course takes
  the lesson files the server's download manifest lists through the download
  manager (they show in Transfers, and pause and resume there) into
  WorkSuite's own profile, encrypted, and they play from there without
  WorkSuite. They are never saved to your downloads folder, opened in another
  app or shown in a folder, whether or not the lesson allows downloading.
- Progress made offline (a kept video played, an article read) waits in the
  offline queue and is sent when WorkSuite is back; the server credits it
  against the time since the course was downloaded.
- Every other change needs WorkSuite: the buttons wait for it.

**Where it bites**

- A kept course goes when the server says the learning ended (you left or
  were withdrawn, the course was suspended or archived, the company turned
  offline copies off), when its licence — the course's end date — runs out
  (online or not), when this computer's policy forbids offline data, when
  the app is taken away, and on a sign-out that removes WorkSuite's data.
- A kept course is checked with WorkSuite at sign-in and on reconnecting. The
  addresses in a download manifest are good for about an hour: a download
  that stops for longer asks for **Download again**.
- Word, Excel and PowerPoint lessons cannot be shown inside the app (the
  server sends the original file only); where the lesson allows downloading
  they can be saved, and a "view the pages" rule on them cannot be met from
  the desktop.
- Video plays the server's browser-playable version; there is no quality
  choice yet (the adaptive rendition needs an HLS player in the app).
- Files from this computer for an assignment go through the desktop's API
  proxy, 25 MB a submission; put larger ones in Drive and choose them there.
- Offline, reading time is not counted — only reaching the end of an
  article, the pages of a PDF and the parts of a video played are kept for
  WorkSuite. An article with a minimum reading time completes once it is
  read online.

**Not in eLearning yet** (later phases on the server)

- Certificates, live classes, learning paths and programs, compliance rules,
  the content library and question bank, transcripts, report exports.

---

## 2026-09-29 — 0.2.52: all of Garage on the desktop

Everything the server's Garage does now happens in the Garage tab: check-in
with photos and the customer's signature, the inspection, diagnosis and
estimate, the work, quality check, road test, invoice and handover, vehicles
and customers, reports, the workshop, the set-up wizard and the settings.
Nothing in Garage sends you to the web any more. Printed documents — the
check-in sheet, an estimate, a work order sheet, the delivery note — and
report exports go through the download manager and show in Transfers.

**Added**

- **Check-in** (opens from the job card, and straight after a walk-in for
  whoever checks vehicles in): odometer and fuel, what the customer says,
  what is left in the vehicle and any valuables, the condition of every area
  with "mark the rest good", damage on the diagram, photos in their slots —
  dropped on the window, chosen, or taken with the camera — and the
  customer's signature last. The bar at the bottom lists what the server
  still wants; a reading lower than the last one asks why, for someone who
  may accept it. A change after signing clears the signature and says so.
  Once complete: the check-in sheet (view or save), and "Email it again".
- **The job card is a Job 360°**, with the tracker and tabs:
  - **Check-in**: readings, condition, damage, photos and the signature.
  - **Inspection**: start from the suggested template; each light is saved
    as it is tapped, measurements and notes when the field is left; photos
    per item; what the customer sees, for someone who may publish; complete,
    then the recommendations to leave for later, decline or reopen.
  - **Diagnosis**: a finding for every complaint (no fault found counts),
    cause, repair, labour, urgency and parts from Inventory; fault codes as
    read; sign-off where the company asks for it.
  - **Estimate**: every version; labour, parts, services and other lines
    priced by the server, with availability and who pays; recommendations in
    one step; send (the customer's link shown once, to copy into WhatsApp);
    discount approval; the decision given by phone, in person (signed) or by
    email, line by line; changes asked; the next version; print.
  - **Work**: each work order's people, bay and time; Start and Pause for
    the technician — or, for someone who assigns work, for each technician
    on it — Complete, Found more work, People with suggestions, Bay with a
    slot, Cancel with a reason, and the work order sheet; parts with the
    counter's actions; additional work priced for the customer; every labour
    entry, with corrections that keep the original; removed parts.
  - **Quality & delivery**: the quality check item by item, pass, or fail
    with the work that goes back; the road test; the final review and Mark
    ready; the invoice and payment, for people who handle money; credit
    terms; the handover with the customer's signature, and the delivery note.
  - **Media**: photos, videos and PDFs, dropped, chosen or from the camera;
    shown to the customer or not; removed.
  - **Activity**: the job's timeline.
  - **Edit** (priority, type, promised time, advisor, what was asked for),
    and notes that someone who may publish shows to the customer or hides.
- **Vehicles** and the **Vehicle 360°**: the owner and earlier owners,
  where it is now, the mileage history, the service history with the work,
  parts, technicians, invoice and the workmanship warranty on each job,
  insurance and warranty, photos, notes and activity. Edit, record a
  reading, transfer to a new owner, add a note, start a new job.
- **Customers**: CRM's customers who have a vehicle or a job here, with what
  they owe (for people who may see money), how they like to be reached,
  their vehicles, their service history across every vehicle, and credit
  terms for people who manage Garage.
- **Reports**: job aging, technician work, estimate against actual, quality
  and rework, parts consumption, and — for people who may see money —
  revenue and job profitability, by date and branch; CSV for people who may
  export.
- **Workshop**: the bay board (each bay's vehicle, job and status, set by
  someone who assigns work), branches and their parts warehouse, the
  technician roster from HR, labour rates, service types, makes and models,
  and inspection templates.
- **Set-up wizard** and **Settings** (the company's Garage settings). People
  who manage Garage land on the wizard until the company is set up; everyone
  else is told it is being set up.
- **Overview**: waiting for parts, delivered today and bays available.

**Changed**

- **The rail** has Vehicles, Customers, Reports, Workshop, Set-up wizard and
  Settings in the app; "On the web" is gone.
- `worksuite://garage/vehicles/<id>` and `/garage?vehicle=<id>` open the
  Vehicle 360°; `/garage?checkin=<id>` opens the check-in; `&jt=` picks a
  job card's tab.
- **A new walk-in** opens its check-in.

**Fixed**

- The job card offered "Cancelled" as a move beside Cancel the job; the move
  was refused without a reason. Cancelling is now only Cancel the job, which
  asks why.
- The job card offered "The customer may see it" on a note to people who
  may not publish, whose note the server then refused. It is offered to
  people who may publish; others add staff notes.

**Works offline**

- Job cards (with the tabs opened), vehicles, customers and the workshop now
  open from their last copy when WorkSuite cannot be reached, beside the
  overview, the board and My work. A bar says the screen is the last copy.
- Every other change needs WorkSuite: the buttons wait for it. A
  technician's Start and Pause, on My work or the Work tab, are still kept
  with the moment they were pressed and sent when it is back.

**Where it bites**

- Documents are pages WorkSuite prints, saved as `.html` and opened in your
  browser to read or print; the server does not make PDFs of them.
- Uploads over 25 MB cannot pass the desktop's API proxy: add long videos
  from the web or a phone.

**Not in Garage yet** (the server does not have them)

- Revenue today, technicians working, today's appointments and service
  reminders on the overview; role dashboards; the TV board.
- Sending the check-in sheet or the estimate by WhatsApp from WorkSuite
  (copy the estimate's link instead), and a customer portal.
- Appointments, service packages, reminders, warranty claims, customer
  opt-outs per channel, and the workshop calendar.

---

## 2026-09-29 — 0.2.52: Tenders — meeting minutes open on Mac and Windows

**Fixed**

- **A tender meeting's minutes** did not open in the Mac and Windows builds.
  The screen (`Minutes.tsx`) and the code that reads and writes the minutes
  text (`minutes.ts`) had names differing only in capitals, which Mac and
  Windows treat as the same file, so the Meetings tab loaded the wrong one.
  The text code is now `minutesText.ts`. Linux was not affected.

---

## 2026-09-29 — 0.2.51: Garage on the desktop

Garage & Service Center opens in its own tab, for whoever has the Garage app.
The counter, the board, the technician's terminal and the parts counter are
here; the screens with photos, signatures and money stay on the web for now,
one click away from the rail and the job card.

**Added**

- **Overview.** Open jobs, checked in today, awaiting approval, in progress,
  ready for delivery and overdue — each a way into its list — with what is
  late, the bays, and the latest open jobs.
- **Job board.** A column per stage; drag a card to move the job on. A move
  the job's flow refuses, or one that only happens through an action (sending
  an estimate), stays where it was and says why.
- **Jobs.** The web's lists (new, estimates, awaiting approval, waiting for
  parts, QC, ready, overdue…), searchable by plate, job number or customer.
- **New walk-in.** One box for the plate, VIN, phone or name; the vehicle and
  its owner, or new ones (a likely duplicate in CRM is offered first); then
  the job card. A vehicle with an open job is asked about before a second
  card is made.
- **Job card.** Who and what, the moves it can make from where it is, cancel
  with a reason, work orders with who is on the clock, parts, notes (internal
  or for the customer) and history.
- **My work**, for a technician: their work orders in the order to do them,
  with big Start, Pause (with a reason), Complete, Ask for a part and Found
  more work buttons, and the running timer.
- **Parts counter.** Scan the job number, then the part's barcode — a scanner
  that types works as it is — and that job's row opens ready to issue. The
  queues to reserve, reserved, out and returned; issue, used, return and
  release. More than was approved needs a reason, from someone who may.

**Works offline**

- **The timer keeps going without WorkSuite.** A start or a pause with
  WorkSuite out of reach waits in the offline queue with the moment it was
  pressed, and WorkSuite books it at that moment when it answers (up to 12
  hours back). The card says it started offline.
- The overview, the board and My work open from their last copy when
  WorkSuite cannot be reached.

**On the web for now**

- Check-in (photos, marks, the customer's signature), inspections and
  diagnosis, estimates and approvals, QC, road test, invoice and handover,
  vehicles, customers, reports, the workshop and set-up. Until a company's
  set-up is finished, Garage sends a manager to it on the web.

---

## 2026-09-29 — 0.2.50: apps you were not given stay hidden

An app you were not given is not there at all: not in a list, not behind a
button, not one link or shortcut away, and not in the browser instead. What
you may open is what the server says (the bootstrap's apps, from its
AppGate) — somebody not set up has Home, Search, Calendar, Tasks, Chat,
Notes, Mail and Files, HR and the other apps without an app of their own on
the server stay on for everyone, and anything else appears only once it is
granted. Everything below asks that one list.

Your own payslips and your own expense claims stay yours, like HR: My pay in
HR, its downloads and payslip notifications work without the Payroll app,
and without the Expenses app you still open Expenses to file and follow your
own claims (the server shows you only those).

**Changed**

- **Tabs.** A tab never opens on an app you may not open — not from a link,
  a button, a deep link, the tray, **Reopen closed tab** or a tab
  moving to another app's page. You are told "You don't have access to
  this." instead.
- **Links no longer fall back to the browser.** A link into an app you may
  not open — in a notification, a chat card or message, a search result,
  Home's approvals — used to open it on the web; it is now refused. The
  same holds for apps that only open in the browser (Finance, Support,
  WhatsApp…), and for the app's own checks: the browser, other windows and
  external links to this server refuse such a page whatever asks for it.
- **Access changes arrive by themselves.** When your administrator gives or
  takes an app, the app notices within moments (the server's
  `access.changed`), and checks again every ten minutes while you are
  online, and after a reconnect. An app taken away leaves the sidebar, its
  tabs and its windows close — a call in Chat included — and you are told
  it is no longer available.
- **Buttons into other apps** — make a task or a note from a message, email,
  chat with or meet a contact, open an invoice from an order or a product,
  a customer's subscriptions, an event's meeting notes, raise a ticket from
  a website chat, send a file to Chat, pick from Drive — show only when you
  have the app they open. A chat card of a record in an app you do not have
  says only that you have no access. Calendar's Show list leaves out apps
  you do not have.
- **The tray** shows unread Chat and Mail, and offers New Task, New Email,
  Open Chat, Upload File and New Lead, only for the apps you have. The
  unread counts on the tray, the Dock and the title bar leave out apps you
  do not have.
- **AI.** The title bar's AI button, its shortcut, the palette's command, View › AI
  Assistant and Home's **Ask AI** appear only with the AI app. Before, the
  button showed for everybody.
- **Home** counts unread messages only from Chat and Mail you have, and its
  Activity card needs Activity.
- **Shortcuts and the menu** run a command only when the palette would list
  it: a shortcut into an app you do not have does nothing.
- **Notifications.** The bell's drawer and the notification centre leave out
  anything that would open an app you do not have (one without a link
  stays), and their Apps lists leave those apps out. No desktop banner
  appears for such an app, and Mail is not checked for new mail if you do
  not have it. Notification settings list only your apps, and the
  categories that belong to no app.
- **Offline.** What this computer saved of an app is removed when the app
  is taken away, and never shown, served or searched while you do not have
  it.

**Where it bites**

- A link someone shares into an app you were not given now says "You don't
  have access to this." Where you used to reach it on the web, ask your
  administrator for the app instead.
- Losing an app while a call or a record window of it is open closes that
  window, and the call with it.
- Changes you made offline in an app that was since taken away are not
  thrown away, but the server refuses them when they are sent.

---

## 2026-09-29 — 0.2.49: fixes from the desktop QA sheet — staying signed in, Forgot password, Home

From "Desktop App QA Task Sheet": each item names its test.

**Fixed**

- **Signed out again straight after unlocking (QA-002, QA-003, critical).**
  - Unlocking WorkSuite with your password checks it by signing in once more.
    The app then signed its old session out, using the new session's token.
  - WorkSuite's sign-out also ends the session of the token it is called with,
    so every unlock ended the session it had just opened.
  - The next request, within half a minute, was refused with *Session ended.
    Please sign in again*, and the app asked for your password again, and again
    after the next lock.
  - Now the session the check opens is closed at once, and yours carries on.
    It was only locked, not ended.
- **The lock screen said a right password was wrong** when the server refused
  for another reason: an access policy, a suspended account, a second factor it
  requires. It now shows the server's reason, and such a refusal no longer
  counts towards the five attempts that sign you out. A wrong password says
  how many of the five are used.
- **Forgot your password? did nothing (QA-004).**
  - The link asks the app to open the web app's reset page. That request is
    only allowed once you are signed in, so from the sign-in screen it was
    always refused, and silently.
  - The link now opens the page while signed out, as does *Open WorkSuite in
    browser* on the "this computer was removed" screen.
  - Only these two named pages open this way, not any address.
- **Today's Tasks was empty for people with tasks due today (QA-014).**
  - Home asked only for the tasks you created, or are the first assignee of. A
    task you were added to afterwards was left out, though the Tasks page shows
    it.
  - Home also compared the day the task's setter typed with today. For a task
    with a time, that is their day, not yours.
  - Home now fetches both lists and reads the due time on your clock, as the
    Tasks page does.
  - *Tasks due today* no longer counts overdue tasks. The *Today's work* card
    lists them first.
- **Customize opened Settings (QA-015).** It now opens a panel listing Home's
  cards. Show or hide each one and move it up or down. It is kept on this
  computer.
- **Meetings on Home opened the Calendar (QA-018).** It opens Meetings when you
  have that app, and the count is of meetings, not every event with a time.

**Changed**

- **Signing in with a passkey (QA-006):** after a minute with nothing back from
  the browser, the screen says the likely reason: a passkey works only once it
  has been added to your WorkSuite account on that server, on the web under My
  account › Security.
- **Adding a passkey (QA-010)** now says up front that the browser will ask
  for your WorkSuite password. The server asks for it on purpose: a new way
  into your account needs a fresh proof that it is you.

**Server** (`Livezen-Technologies/worksuite`, same day): the calendar no
longer shows other people's projects (QA-023).

---

## 2026-09-29 — 0.2.48: The AI assistant on the desktop — ask about your work, confirm what it proposes, files from this computer

From the AI dock (Ctrl/Cmd+Shift+A), Quick Ask, and the tray. Needs a
WorkSuite server with the assistant's desktop service
(WS-AI-SRS-001 phase 6). Against an older server, Quick Ask and the writing
assistant work as before.

**Added**

- **Ask the assistant in the dock.** The dock now has three tabs:
  - **Ask**: the server's assistant.
  - **Write**: the writing assistant, as before.
  - **Changes**: what the assistant has proposed.

  Ask reads only what you can open. It is given the record the tab beside it
  shows (a task, a note, a file, a chat, a CRM lead, deal or account, a
  contact), and you can untick **Use this tab** to leave it out. A tab showing
  a list gives it nothing.
- **Changes are cards, confirmed in the main window.** When the assistant
  proposes a change (a task, an event, an email), it is a card with the
  module's own preview. Only **Confirm** on the card, in the main window, makes
  it happen:
  - Confirming goes through the main process, which refuses any other window
    and records it.
  - The page's connection to the server refuses the confirm route outright.
  - A change that reaches outside the company is marked, and each outside
    recipient is named.
  - **Undo** is offered for thirty seconds where the module can undo.
- **Quick Ask can ask.** Over any app, **Ask** puts a question about the
  selected text to the assistant. The selection goes with the first question
  only. **Insert** puts the answer where you were, only when you click it. A
  card that appears in Quick Ask cannot be confirmed there: **Review in
  WorkSuite** opens it in the main window.
- **Waiting changes are announced.** A change waiting for you, proposed here,
  on another computer or on the web, arrives as a notification and shows in
  the tray.
  - The notification only opens the dock's Changes view. It has no buttons,
    so nothing, and certainly nothing that reaches outside, is confirmed from
    it.
  - What was already waiting when you signed in is counted, not announced.
- **A file from this computer.** The paperclip in Ask opens a file picker.
  - A file in a synced Drive folder is asked about by its Drive id, and
    nothing is uploaded.
  - Any other file sends only its words, which the server keeps for a day and
    for you alone (up to 10 MB: text, PDF, Word, Excel, PowerPoint and
    OpenDocument).
  - Only a file you pick is read. Nothing on this computer is scanned.

**Changed**

- **What this computer may do is the stricter of two policies:**
  - the device policy, which has three new keys, `ai_quick_ask`, `ai_insert`
    and `ai_local_files` (or `ai.quick_ask` and so on), each on unless
    set to `false`;
  - the company's AI policy on the server.

  Quick Ask's shortcut, Insert and the paperclip each need both. A file is
  refused in the main process when either policy says no, and again by the
  server when the company's does.
- **Quick Ask for the assistant alone.** Quick Ask is offered to people who
  have the assistant (`ai.assistant.use`) as well as the writing assistant.

**Known limits**

- **The dock does not stream.** Answers arrive whole.
- **No local-file context on older servers.** Against a server without the
  assistant's desktop service, the paperclip is not offered.
- **Choose files with the picker.** Dropping a file on the dock does nothing
  yet.

## 2026-09-29 — 0.2.47: Tenders — the bell and push instead of Team Chat

With WorkSuite Server 3.1 (`Livezen-Technologies/worksuite#31`), the server
itself notifies people about the tender checklist: in the bell, as a push to
their phone and desktop, and by email for a document sent back.

**Changed**

- **Reviewing a file** (the review screen and the line's *Send back*) no
  longer messages people in Team Chat by default when the server notifies.
  - The screen says who will be notified of your decision.
  - After you decide, the toast says who was notified: *Sent back. Dimuthu
    and Dinusha were notified.*
  - *Also message … in Team Chat* is still there, unticked, for when you want
    a conversation too.
- **An approval's comment** now goes to the server, which puts it in the
  approval notice. It is not stored, as before.
- **Against an older server**, which does not notify, nothing changes: the
  Team Chat message stays ticked by default, as in 0.2.46.

**What the server now notifies** (nothing to do in the app — they arrive like
any other WorkSuite notification, and clicking one opens the tender's
Checklist):

- a document **sent back** to its uploader and the line's chaser, with the
  reason;
- a document **approved**, with the reviewer's comment if there was one;
- a document **waiting for review**, to the line's chaser, the tender's owner
  and the tender's creator;
- a checklist line **given to you** to get;
- a tender **assigned to you**.

---

## 2026-09-29 — 0.2.46: Tenders — upload progress, reviewing files in the app, who uploaded it, meeting minutes

From the Tender checklist and the Meetings tab.

**Added**

- **Uploads show their progress** under the line they go to: the file, how
  much of it has gone, and a bar — *Preparing…*, the percentage, then
  *Filing…* while WorkSuite stores it. Cancel is beside it. Files are sent in
  about twenty parts (from 256 KB to 8 MB each), so a small file no longer sits
  at 0% and jumps to done.
- **Review a file inside WorkSuite**: click the file's name on a checklist
  line. PDFs open in a viewer in the app (page through, zoom, fit to width),
  and so do images and text files; anything else offers *Open in its app* or
  *Save a copy*. Beside the file: who uploaded it and when, who chased it,
  earlier versions, and the notes from earlier reviews. **Approve**, or
  **Send back** with a comment, and the next file waiting for review opens.
  A PDF is drawn as pictures of its pages; its links and scripts do not run.
- **Who uploaded it**: each line shows *Uploaded by …* with the file.
- **Sending back tells the owner**: when a file is sent back (from the review
  screen or the line's menu), the person who uploaded it — and whoever chased
  it — gets a Team Chat message with the comment and a link to the tender. The
  box *Tell … in Chat* is ticked by default; untick it to say nothing. An
  approval with a comment is passed on the same way.
- **Meeting minutes**, on each meeting in a tender's **Meetings** tab:
  **Minutes** opens the notes and the *points agreed*. Add a point (Enter),
  and make it into:
  - a **Task**: for anyone, with a due date and a priority, tagged
    “tender”, and linked back to the tender;
  - a **Reminder**: an event in your own calendar at the day and time you
    choose, which WorkSuite reminds you of when it comes;
  - a **Follow-up**: another meeting on this tender, held the same way as
    this one, with the point as its first line.
  The point then shows what it became (*Task #482*, *Reminder · Friday 3 Oct,
  09:00*), and clicking it opens the task or the day in the calendar.
  Converting saves the minutes at once. The minutes stay one text on the
  server, so the web shows them as written: each point is a "- " line, and
  what it became is noted in brackets at the end.

**Changed**

- A meeting's minutes are no longer typed in its **Edit** sheet; they have
  their own **Minutes** button beside it. Minutes already written are kept as
  notes, and any "-", "•" or "1." lines in them become points.
- The **Attach** menu on a line opens where it fits — above the button when
  the line is near the bottom of the window — instead of being cut off by the
  card.

**Known limits**

- The notice goes to Team Chat, not to the bell: WorkSuite's Tender module
  sends no notification of its own when a file is reviewed. That needs a
  change on the server.
- A follow-up here is a meeting on the tender. CRM follow-ups belong to a
  lead, and a tender has none.

---

## 2026-09-28 — 0.2.45: the AI Assistant on the desktop — Quick Ask, the dock, its settings

From "WorkSuite AI Assistant — Web + Desktop UIs", on the server's writing
assistant (`/api/ai/write`, which every role may use).

**Added**

- **Quick Ask** over any app: select text anywhere, press **⌥Space** on a
  Mac (**Ctrl+Alt+Space** elsewhere), and a small window opens with it —
  **Translate** (into the language you choose), **Rewrite**, **Shorten**,
  **Make professional**, **Fix grammar**, **Make a task**, **Ask WorkSuite**.
  The answer is shown; **Insert** pastes it back into the app you were in,
  **Copy** copies it, **Open in WorkSuite** takes it to the AI dock. Esc, or
  clicking elsewhere, closes it.
- The selection is read once, when you press the shortcut, and nothing else
  on your screen is: on Linux the selected text is read as it is; elsewhere
  WorkSuite presses Copy in that app and puts your clipboard back straight
  after. Insert pastes only when you click it, and restores the clipboard too.
- **The AI dock** (Ctrl/Cmd+Shift+A) is the same assistant beside every tab,
  for text you type or paste — no longer a "coming soon" card.
- **Settings › AI Assistant**: Quick Ask on or off and its shortcut (it says
  when another app already has it), inserting into other apps, the dock at
  start-up, and the language Translate goes to. The tray has **Quick Ask**.

**Where it bites**

- On a Mac, reading the selection and inserting need WorkSuite in System
  Settings › Privacy & Security › Accessibility; without it Quick Ask uses
  what you copied last, and says so. Wayland sessions have no Insert.
- The assistant never reads the tab beside it. Summaries of WorkSuite files
  with page references, comparing versions, files from this computer, and
  actions waiting for your confirmation (and their tray entry and alerts)
  need an assistant service the server does not have yet.
- The server's writing assistant has no "Summarize"; **Shorten** is the
  nearest. Text is limited to 8,000 characters.

---

## 2026-09-28 — 0.2.44: Website chats ring like calls, and answer from Team Chat's composer

From the Website Live Chat SRS v1.4 (ENH-WCHAT-01 and -02), the desktop's
part, on the server as it is today.

**Ringing (RING-40…48)**

- **A chat from your websites rings until someone joins it** — in a small
  window at the bottom right, over other apps and full-screen ones where the
  system allows, with WorkSuite's window minimised or closed to the tray. It
  never takes the keyboard from what you are typing in.
- The window shows who is waiting, on which site, where they are, what page
  they are reading and what they asked, how long they have waited and which
  step of the escalation reached you; **Join chat** and **Silence**. Other
  chats ringing are listed under it with their own Join — at risk first,
  then assigned to you, then the longest waiting.
- **Join** accepts the chat (or opens one assigned to you) and brings
  WorkSuite forward on it. A moment too late, it says who has it; when a
  colleague joins, it says so and stops.
- **Silence** mutes one chat on this computer until it becomes at risk,
  when it rings again with the stronger tone. At risk, high, urgent and VIP
  chats use a stronger tone; an offline enquiry shows without ringing.
- While a chat rings: a bar under your tabs, the tray icon and its menu
  (**Join**, **Open Website Chats**, **Ringing settings…**), the Dock bouncing
  on a Mac, the taskbar flashing elsewhere, and **Ctrl+Shift+J** (**⌘⇧J**)
  joining from any app — registered only while something rings.
- **Settings › Notifications › Website chats**: ring over other apps, what
  Do not disturb does (the window without sound — the default; only at risk;
  as usual), the join shortcut, the ringtone volume with a test, and starting
  WorkSuite with the computer.
- Locked, the window says a chat is waiting and nothing about who.

**The website thread's composer (RDC-01…08, 14)**

- It is Team Chat's composer now, with the website set: attach (documents,
  images, the camera), paste, drop from the computer, emoji. Mentions, voice
  messages, urgent, sharing records and Drive links are not there — a
  visitor could receive none of them.
- **Saved replies**: the first six as chips above the box, and **/** in the
  box to find any by shortcut or title; Enter inserts it.
- A file a visitor cannot receive (an SVG, a video, anything over 5 MB) is
  refused before it is uploaded, with the reason.
- Replies go through the outbox: offline, a reply shows as pending in the
  thread and is sent once when WorkSuite reconnects; a refused one says why,
  with Retry and Discard. Drafts stay per conversation, across restarts.

**Fixed**

- The "Chat assigned to you" card read the conversation to show it, and on
  this server reading a conversation is joining it: the visitor was told you
  had joined, and the assignment counted as seen, before you pressed
  anything. The call window reads only the server's list of what is ringing.

**Where it bites**

- The server has no ring sessions, ring heartbeat or silence yet (ENH-01
  R1): silence is for this computer only, the desktop and a browser tab can
  both sound, and the ring stops when the server stops listing the chat
  rather than when the visitor leaves. With the organisation's ring time set
  (not the default), the tone stops at that time and the window stays.
- Not in this release, as none of their server APIs exist yet: several
  staff in a chat, invite and transfer (ENH-03); live typing and read
  receipts (ENH-04); voice calls from the widget (ENH-05); copying a Drive
  file to a visitor, reply quotes and delivery marks (RDC-05, 09, 10).

---

## 2026-09-28 — 0.2.43: SalonMate, part 3 — working offline, and the desk's notifications

The front desk keeps working when WorkSuite cannot be reached. It opens from
its own copy of the day, keeps new clients, bookings and check-ins, and sends
them in order when the line is back. WorkSuite checks each one again then.
Money still needs WorkSuite.

**Added**

- **The day's copy.** Each paired desk keeps its copy, encrypted, per
  server, desk and person, where the company's desktop policy lets this
  computer keep data offline. It holds the menu, the stylists, the clients
  seen in the last year with the worst allergy on file, and the book from
  yesterday to the salon's "days ahead". Only what changed is fetched each
  minute, and the whole copy every hour. Screens use the copy only when
  WorkSuite does not answer, and say how old it is.
  - **Today** is worked out from the copy by the server's own rules.
  - **The calendar** draws any day the copy holds.
  - **Clients** are searched by name, email, or part of the mobile, typed
    as "077…" or "+9477…".
- **Working offline.** These are kept on this computer and sent when
  WorkSuite answers:
  - a new client;
  - a walk-in started now, with the allergy read out and ticked first, as
    online;
  - a booking at a time on the salon's clock;
  - a check-in from Today or the calendar.

  They go in the order they were made, and a booking for a new client
  follows the client. WorkSuite judges each as of when it was made (within
  a day).
- **Changes to send.** What waits, and what WorkSuite would not do as it
  was, with the choices it offered:
  - take the nearest free time;
  - choose a time;
  - "it is this client" (for a new client WorkSuite already knows);
  - change it;
  - send again;
  - drop it, together with what depended on it.

  The rail counts what waits, and the status bar's "pending changes"
  includes it.
- **Notifications for the desk**, from the system tray even with the window
  closed:
  - WorkSuite's "ready to pay" alert opens the desk's payment for that
    visit. "Booked online" opens Today.
  - A client who cancels today's visit from their own link now tells the
    desk. WorkSuite itself raises nothing for that.
  - A change WorkSuite refused tells the desk too.

  SalonMate has its own switch under Settings → Notifications.

**Where it bites**

- Only a **trusted** computer keeps changes to send (WorkSuite → Devices →
  Trust), and only for a company that lets its desks book offline (the
  SalonMate setting, on by default). Otherwise the desk says why and does
  not offer to keep anything.
- Payments, deposits, the register and closing the day need WorkSuite and
  say so. So do receipts.
- Offline, nobody's diary is guessed at. Whether a stylist is free, a
  tier's price and a deposit come from WorkSuite when it answers. A time
  that turns out to be taken comes back with the nearest free one.
- Changes belong to whoever made them: WorkSuite takes each person's as
  theirs. They wait through a plain sign-out. Somebody else signed in at
  the counter sees only that they are there. "Pair this computer again"
  drops them, and warns first. A remote wipe or "Sign out and remove
  WorkSuite data" removes the copy and the changes.
- A change older than a day is judged as of now when it arrives.

**Security**

- The generic offline queue (`offline:submit`) now keeps only writes the
  API proxy would let a page make. A page could previously queue a request
  to `/api/salon/v1/desk/pair`, or another path the proxy refuses, and have
  it sent later.

**Checked**

- Unit tests:
  - what is sent, in which order, and what is held behind a refusal;
  - how a refusal's local ids resolve and what is sent again;
  - the choices a refusal offers;
  - the copy's bootstrap, delta with overlap, hourly refresh and window;
  - cancellations the desk hears of, and phone search;
  - trust and company rules, and what belongs to whom;
  - the board and calendar from the copy, and the salon clock across a
    change of clocks.
- `tests/e2e/salon-3.mjs`, against a real server through a relay that cuts
  the line: the desk keeps a new client's booking, a check-in from the
  calendar, and a booking at a taken time. With the line back, the first
  two are in WorkSuite as made. The third comes back refused with the
  nearest time, and taking it books it. 13/13. `salon.mjs` (12/12) and
  `salon-2.mjs` (12/12) pass as before.

---

## 2026-09-28 — Multi-window docking: tabs in their own windows, and side by side (ships in 0.2.43)

Any tab can now leave the main window and come back. Drag it out of the tab
strip and let go anywhere off the window, and it becomes its own window
there; dock it back and it is a tab again. Or dock one tab beside the one
you are working in, and see both at once.

**Added**

- **Tear a tab off.** Drag a tab out of the window, or choose **Move to new
  window** in its menu (**Ctrl+Shift+N**, **⌘⇧N** on a Mac, or *File › Move
  Tab to New Window*). The window opens where the tab was let go — its title
  bar under the pointer — and a second one opens a step down from the first.
- **Dock it back.** A torn-off window has **Dock to main window** and **Dock
  beside the main window's tab** in its title bar; or drag its name, at the
  left of the title bar, onto the main window: onto the tab strip, between
  two tabs, to open it there; onto the right of the page to dock it beside;
  anywhere else on the page to open it as a tab. The main window comes to the
  front if it was in the tray.
- **Side by side.** **Dock beside** in a tab's menu (**Ctrl+Shift+D**, **⌘⇧D**,
  or *View › Dock Tab Beside*), or drag a tab to the right of the page. The
  docked tab has its own bar — **Swap sides**, **Move to new window**,
  **Undock** — and is marked in the tab strip. Drag the divider to share the
  width (a quarter to three quarters; double-click for half and half, or the
  arrow keys once it has focus). Clicking the docked tab in the strip swaps
  the two.
- **Where you left them.** With *Restore tabs at start* on, the docked tab and
  its width come back, and so do the torn-off windows, each where it was, on
  whatever it had moved to. Never in Safe Mode.

**Where it bites**

- A tab moves by its address: a form half filled in, a scroll position or an
  unsent draft that is not saved as a draft stays behind.
- Signing out closes the torn-off windows (they show your data); the same
  person gets them back at the next sign-in. Signing out with "remove
  WorkSuite's data", or a remote wipe, forgets them.
- A window closed with its own close button is closed, not docked: it does
  not come back at the next start.
- Dragging between windows is the operating system's drag. It is covered by
  unit tests; the end-to-end run (`tests/e2e/docking.mjs`) uses the buttons
  and menus instead, which DevTools input can press.
- Only one tab docks beside at a time, on the right. Windows do not snap to
  each other.

**Under the hood**

- New IPC: `windows:detach`, `windows:dock`, `windows:adopt`,
  `windows:describe`, `windows:restoreDetached`. Tearing off, taking a window
  in and restoring are the main window's alone. What a docked window shows is
  the main process's own record of it, never what a drag or a page says: a
  drag carries only the window's id.
- Torn-off windows are remembered per person, encrypted, in `tab_sessions`
  (`window = 'detached'`), beside the main window's tabs, which now also keep
  the docked tab (`side`).

---

## 2026-09-28 — Drive sync: keep Drive folders on this computer (ships in 0.2.43)

Choose Drive folders in **Files → Sync devices** (or **Keep on this computer…**
on a folder) and they are kept in step with a folder here —
`~/WorkSuite Drive/<folder>` unless you pick another. Work on the files in any
app, offline too; changes go both ways, and only what changed travels.

**Added**

- **Sync devices**, as in the Drive designs: your devices with their state
  ("Up to date · 2 min ago", "Syncing 14 items", "Not seen for 42 days"),
  **Manage** (rename, wipe its synced copy, remove) and **Sign out**; the
  company's sync policy; and **On this Mac** — the folders kept here, how each
  syncs (two-way, upload only, download only), what it is doing, anything it
  could not sync and why, **Show in Finder**, **Pause**, **Stop syncing**
  (nothing is deleted), and recent activity.
- A **SYNC** column in file lists: ✓ on this computer, ☁ online only, ↻ on its
  way, ⚠ both copies kept.
- **On this Mac** and **Local path** in a file's or folder's Details, with
  **Show in Finder**; **Keep on this computer…** for a folder that is not.
- The status bar says what sync is doing, and the Drive rail shows it under
  the storage meter.

**How it behaves**

- Renames and moves, on either side, move the file — it keeps its versions,
  comments, shares and links.
- A file changed on both sides is kept twice: Drive's under its name, this
  computer's beside it as "<name> (<you>'s conflicted copy <date>)", which then
  goes up to Drive too. The folder shows it for a day.
- Deletions go to a recycle bin: Drive's, or this computer's Trash. More than
  25 files at once, or more than 30% of a folder (a disk not plugged in looks
  the same), waits for you:
  delete them there too, or bring them back.
- A folder missing on either side stops that folder's sync; nothing is
  deleted anywhere because of it.
- A file still being saved is left until it settles. Names this computer
  cannot hold, files the policy refuses, password-locked folders and links
  are listed with the reason, and left alone.
- An administrator's **Disable sync**, a remote wipe, and sign-out with
  "remove data" are obeyed: a wipe removes the files sync put here and
  nothing else.

**Server gaps found** (no server change in this release)

- The Drive SRS lists "deletions are events" (FR-SYN-02) as built, but
  trashing a file records no journal event, and folders record none at all;
  events also carry a file's name without its folder. The app does not rely on
  the journal for either (see docs/BACKEND.md).
- `SyncController::commit` assembles a file in memory; the app sends files
  past 256 MiB by the chunked upload.

## 2026-09-28 — Expenses: the whole module, natively (ships in 0.2.43)

Expenses opens here now instead of in the browser, under Business in the
sidebar, and every screen of it is drawn by the app. Links to Expenses screens
(`/expenses?tab=…`, `?claim=`, `?advance=`, `?sub=`) open here too, and **File
an Expense** is a quick action. Only the settings sections the web draws with
its shared admin screens (User Access, Screens & components, Organization,
Notifications, the change log) still open in the browser, marked as such.

**The app**

- **The company switcher** at the top of the rail picks any number of
  companies, with favourites, "Only" and a search once there are more than
  six. Reads add the selection up, as the server does; **writes happen in one
  company** — filing a claim, a budget, a payment run — and a screen that
  needs one says so and offers to narrow to it, rather than guessing. The
  selection rides in the tab's address and is remembered per person, always
  checked against the companies you still hold. A company you can only read
  through consolidated reporting is marked, and never offered for a write.
- **The rail** shows what the server's area map allows in the companies
  selected (asked of the same resolver its route filters use), with the
  approvals and unmatched-card counts as badges, and a quick bar for what is
  waiting on you. A hidden screen reached by a link says so, and **Settings ›
  My access** — open to everyone — says why.
- Money stays the server's text and is added up in cents. Where the companies
  selected use different currencies, the screens show one figure per
  currency, or counts, never a sum across currencies.

**Claims**

- **My expenses, My team, Organization.** Search, status, category, dates and
  "flagged only"; paged, with the server's total for the whole filtered set.
  Bulk approve and decline (with a reason) on team and organization, every
  refusal listed with its sentence.
- **One claim** opens beside the list: its facts, the receipt (drop or pick,
  images shown in place, Open and **Save a copy** through the downloads
  tray), what the rules said, look-alikes, the card match, and the approval
  trail by round. Approve with a note, decline with a reason, edit and
  resubmit, reopen with a reason, receipt reading, earlier versions.
- **File an expense** — expense, mileage or per diem — with the live preview
  of what the policies, budgets and routing will say before it is filed
  (blocks, warnings, the rate used), receipt reading that copies in and asks
  you to check, cost centre, related records and charging to an advance.
  Vehicle, country and city come from the company's rate schedule, because
  the server matches them exactly. A refused claim shows every rule that
  refused it.

**Approvals and advances**

- **Approvals**: your queue across companies — claims and advances, oldest
  first, a week's wait in red — filtered by the selection with what it hides
  counted, bulk decisions, reassigning a step (to approvers only), and the
  look-alike claims to settle as the same expense twice or not.
- **Advances**: what you are holding, request (with project and vendor
  pickers, and the "still to settle" check), the drawer with who owes whom in
  words, approve, record as paid out, settle (figures first, then frozen),
  and charge a claim to it.

**Money out**

- **Corporate cards**: statements imported from a file or pasted, with what
  was new, already on file or unreadable; unmatched lines with ranked
  suggestions and their reasons; match, unmatch, set aside and put back.
- **Reimbursements**: claims waiting to be paid by person, payment runs
  totalled in cents, the bank CSV through the downloads tray, mark paid (it
  says no money moves), cancel.
- **Accounting export**: prepare a batch for dates, "does not balance" in red,
  export only what balances, void what is not yet exported, the lines.
- **Petty cash**: funds in the company's currency, spend, top up, reconcile
  with the difference as you type, refill to the ceiling, close.

**Rules and suppliers**

- **Budgets**: used, committed, approved, paid and remaining, "at this rate"
  (said to be arithmetic, not a prediction), what consumed it, create, edit,
  close. **Policies**: each rule's caps as one sentence, refuses or flags,
  archive; and **approval routing** — the chains, stalled claims, and "who
  would it ask?".
- **Vendors**: purchases, paid, claims and last transaction; new, archive,
  restore, delete. **Subscriptions**: renewals (overdue first), totals per
  currency, this company or all of yours; the drawer edits in place, moves a
  subscription between companies, keeps its invoices and payments, lists
  the expenses charged to it and files a new one against it; pause, resume,
  cancel, reactivate.

**Insight and setup**

- **Dashboard** (KPIs, what needs somebody, the monthly trend, by category,
  renewals, budgets, petty cash — each linking to its screen), **Analytics**
  and **Reports** (the named reports and the claims summary, one currency at a
  time, exported as CSV through the downloads tray where the area allows),
  **All organizations** (every company you report on, totals per currency).
- **Settings**: company rules, cost centres, categories, mileage, per diem and
  exchange rates, who gets told, activity, setting up a company, and **My
  access**.

**Server gaps found** (no server change in this release; details in the
commit)

- **Security:** card-match suggestions (`Cards::suggest`) never check the
  transaction's company, so a finance user in one company can read another
  company's claim descriptions, claimants and amounts by transaction id.
  Editing a subscription (`SubscriptionController::update`) likewise never
  checks it is visible to the caller.
- The stale-approval guard never fires: the claim's revision is not passed to
  the approval engine.
- Several totals add up amounts in different currencies: the multi-company
  dashboard, unmatched card lines, the classic claims summary, vendor totals,
  petty cash, and the subscriptions overview (which the web labels LKR).
- Editing a budget on the web turns a quarterly or yearly budget monthly,
  refuses any non-company scope, and clears its category and owner; the
  budget's claim list ignores its scope.
- Several writes act in the company last remembered rather than the one on
  screen (new subscriptions, the subscription's expenses, the web's petty
  cash); a new petty-cash fund defaults to LKR.
- Editing only a subscription's amount resets its exchange rate to 1;
  clearing a stated renewal date does nothing.
- "Mine" on Advances returns everyone's for finance; a step can be
  reassigned to somebody who cannot approve it; editing a card blanks the
  fields not sent; claim lists omit the company and the unconverted count; an
  Asset link on a claim is dropped.

---

## 2026-09-28 — Finance: the whole module, natively (ships in 0.2.43)

Finance opens here now instead of in the browser, under Business in the
sidebar, and every screen of it is drawn by the app. Links to Finance screens
(`/finance?tab=…`) open here too. Only Finance's printable report and its
public shared-report links are still the web's own pages, and open in the
browser.

**The app**

- **The rail**, in the web's order, with the company picker at the top. It
  picks one company, because the books are that company's: a trial balance
  across two companies is not a report. The company rides in the tab's
  address, so a restored tab reopens on the same books, and is remembered per
  person — always checked against the companies you still hold. A company
  without books says so in the picker.
- Money is handled as the server's text throughout and added up in cents, so
  no figure is ever rounded through a float. An amount you may not see is a
  dash and a sentence naming the grant, never 0.00. A refusal shows every
  problem the server names, not the first.

**The books**

- **Overview.** The management accounts on one page: whether the ledger
  balances and what is outstanding, the result for the year with the sentence
  that says what it leaves out, bank against ledger, what is owed each way
  with its age and whether it agrees with its control account, and what is
  not in the figures yet. **Opening the books** for a company that has none —
  base currency, first month, first year — picked, not typed, and said to
  happen once.
- **Chart of accounts.** The tree, headings apart from accounts, system
  accounts locked, archived ones marked; find; new account; archive; fixed or
  variable on cost accounts.
- **Bank accounts.** Which accounts are bank accounts, their currency, and a
  statement per account: import a CSV, text or HTML file (up to 8 MB) or paste
  rows; what loaded, what was already on file and what could not be read,
  with every problem; park lines (singly or several) with a reason; the
  import history with its proved or missing closing balances.
- **Reconciliation.** Per account, its periods and how far it is locked;
  reconcile a period (prefilled from the latest proved statement); then the
  workspace — the difference as the headline with its working, match what is
  obvious, scored suggestions with their reasons in words, choose one
  yourself, park, and agree and lock (held, with its reasons, until the
  difference is nil and nothing up to the end date is unmatched); reopen with
  a reason.
- **Journals.** Filtered to what is not yet posted, posted, or reversals. One
  journal opens beside the list with its lines and its next step — submit,
  approve (by somebody other than the writer), post, then reverse with a
  reason and its own date if you like. A reversal that succeeds with a
  warning says so. **New journal** balances as you type.

**Who owes what**

- **Receivables and Payables.** Ageing as at a date (or the end of last
  month), the tie-out against the control account first — agreeing, or out by
  how much and where to look — the five buckets per party, and each party's
  documents in their own currency with the books' figure beneath.
- **Not in the ledger.** Every document with no journal, with every reason
  the server gives; **Post it** / **Try anyway** for those who may post, and
  the journal it made one click away. Supplier debit notes are included.

**Reports**

- **General ledger** (an account and dates, kept in the tab's address;
  opening and running balance; links to journals and reversals; up to 5,000
  lines, and it says when there are more), **Trial balance** (position or
  movements, balanced or out by how much), **Profit and loss** and **Balance
  sheet** (sections from the chart, subtotals, last year beside this one —
  including accounts that moved only last year — and the balanced check),
  **Cash flow and equity** (the indirect statement and the changes in
  equity, each checked against the balance sheet). Any account opens its
  general ledger.
- **Financial overview** and **Cash flow overview**: KPIs against the window
  before, a monthly trend, margins, cost and revenue by account, cost by
  dimension, cost variance, health signals, cash in and out by category, and
  the forecast (labelled estimated; horizons over three months need the
  forecast manage grant). Figures can be shown in another currency at the
  server's rates; a missing rate is refused and said, never assumed 1.
- **Budget vs actual**, and **All companies** — every company you reach, in
  each one's currency or one you choose, with a company that has no rate
  listed and not added.
- **Export** (the report's summary) and **Transactions** (every journal line
  in the window) save CSV files through the downloads tray; **Print** opens
  the web's printable report; **Share link** makes a link for somebody
  without an account (shown once, expires in 7 days). Each is offered only to
  those the server would let through.
- **Year-end close.** The close checklist, what blocks the year and what only
  warns (each linked to where to fix it), versions — generate, approve (by
  somebody other than the generator, with nothing blocking and the books
  unchanged since), lock, reopen with a reason — and the history. Any fiscal
  year can be chosen.

**Setup**

- **Budgets.** Create empty or from last year's actuals, copy (into the next
  year if you like), approve (one plan per year), archive; the account ×
  month grid grouped by type, totalled in cents, with income, cost and
  planned profit, a find box, and keyboard movement. Saving replaces the
  whole grid, and says so.
- **Exchange rates** (the installation's, said as much), **Shared reports**
  (see and revoke), **Tax codes** (rates dated and never edited — a new rate
  closes the current one, and says on which day), **Fixed-asset accounts**,
  **Depreciation** (preview, post a month, the months charged with their
  journals, and the brought-forward split), **Purchase accounts**.
- **Settings**: the accounting profile, and **Area access** — people by area,
  presets, end dates, never your own row. The screen says plainly that the
  server does not enforce these grants yet: they change what the screens
  show.
- **My access.** Whose books you can open, and why not the others; and your
  Finance permissions.

**Server gaps found** (no server change in this release; details in the
commit)

- Area-access grants are not enforced by the API (known, SRS §12 #1).
- Several endpoints return every column as text, so flags like `"0"` read as
  true to a careless client; the web's year-end never shows "does not
  balance", and its budget editor marks every row inactive. The desktop
  converts once, on arrival.
- A reconciliation lock keeps no "bank only" figure, so a locked period's
  working cannot be reproduced; the lock's refusal sentence omits it too.
- A budget holding a since-archived account can be neither saved nor copied.
- Year-end opens on the newest open year, which at year end is the next one.
- The dashboard exports' permission comment and route filter disagree;
  translated CSVs run numeric account codes through the rate; the public
  share page ignores the currency it was made in.
- The depreciation screen's permission envelope names an area that does not
  exist, so it always says no (the desktop gates on the posting permission).
- A tax rate starting before the current one fails with a database error
  (the desktop refuses it first).

---

## 2026-09-28 — 0.2.42: SalonMate, part 2 — taking the money, receipts and the drawer

The desk now takes payment itself, into the POS register it was paired
with, prints the receipt straight to the counter's printer and opens the
cash drawer. It opens the register in the morning and closes the day at
night. Working offline comes with the next release.

**Added**

- **Take payment**, from Today's "Ready to pay", a booking on the calendar,
  or the rail.
  - The bill is WorkSuite's: the lines at booked prices, the member
    discount, points, the advance applied once, store credit, and what is
    left to pay. Points, store credit and retail from the desk's shelf are
    priced again by the server as they are added.
  - The money is the cashier's: cash on a keypad with the round sums a
    client might hand over, a card, LankaQR, a transfer (each with its
    reference), or a split. Over what is due, with cash in it, the desk
    asks: give change, or keep it as store credit.
  - One press is one invoice. After a dropped connection, pressing again
    sends the same payment; it can never be taken twice.
  - A visit that is checked out and still owes is paid against its
    invoice.
- **Paid.** What to give back, in large type; what was taken; points
  earned; store credit now; the POS sale's number; the receipt again; the
  drawer; and **Book the next visit** when WorkSuite suggests one.
- **Receipts, printed without asking.** The receipt goes straight to this
  desk's receipt printer as the payment is taken, on an 80 mm or 58 mm
  roll, as long as the receipt and no longer. It is WorkSuite's own
  receipt, in English, Sinhala and Tamil. Copies, printing by itself, and
  printing without the dialog are each a setting. With no printer chosen,
  the print dialog asks.
- **The cash drawer**, plugged into the receipt printer, opens when cash is
  taken, or from Paid or Printers. It is sent the ESC/POS pulse on pin 2
  or 5. Every opening is recorded in the desktop's audit log.
- **Register.** Open it on a float counted note by note (or as one
  figure). Pay cash in and take it out, each with a reason. See the sales,
  the cash in, the change given and what the drawer should hold (hidden
  under a blind close).
- **Close the day.** Count the drawer and close the register. The
  difference is WorkSuite's, and a reason is needed when the count is out.
  The Z-report prints from what the close answered, and stays on screen to
  print again. Beside it is the salon's day: taken by tender, what was not
  new money, visits not checked out (with Take payment), invoices still
  owing and commission. The day's summary prints too.
- **Printers**: the receipt printer and its roll, an A4 printer for
  full-page copies, copies, automatic and silent printing, the drawer, a
  test receipt and a test of the drawer. Kept on this computer, per
  server, and forgotten by "Sign out and remove WorkSuite data". WorkSuite
  is told as well, so owners see how each desk prints.

**Where it bites**

- Silent printing goes only to the printer this desk was set up with, and
  only for SalonMate's receipts and pages. Everything else still prints
  through the dialog.
- The drawer needs a printer that takes ESC/POS commands, as thermal
  receipt printers do. A drawer the printer's driver opens by itself
  should be left as "None, or opened by the printer's driver". On Windows
  the drawer goes through PowerShell; a computer that blocks it says so.
- Pay in and Take out are not sent again by themselves. If WorkSuite does
  not answer, the desk says so and asks you to look at the register before
  doing it again.
- Deposits are still taken in WorkSuite on the web. See the server notes
  below.

**Server notes** (Livezen-Technologies/worksuite; not changed here)

- A cash deposit taken at a desk is not added to the register's session,
  so the drawer counts over by it at close. That is why the desk does not
  take deposits yet.
- The register's pay-in and take-out are not kept under an idempotency
  key, so a retried request records twice.
- With `salon_desk_require_register` off, payments are not recorded into
  an open register even when the desk is paired with one.
- Each payment against a part-paid invoice records a POS sale for the
  whole invoice total, so a session's sales total over-counts. Cash
  figures are right.

**Checked**

- Unit tests for the page a receipt prints from, its size on the roll,
  the drawer's pulse and how it reaches a printer on each system, the
  printer settings, the print channels, and the cashier's arithmetic (the
  keypad, change, the count).
- `tests/e2e/salon-2.mjs`, run against a local WorkSuite with CUPS
  printers that capture their jobs. It covers: pair with a register; set
  up the printer and drawer; open the register on a counted float; pay a
  visit in cash with LKR 500.00 change; close the day counted short.
  - The drawer received `1b 70 00 19 fa` each time.
  - The receipt and the Z-report arrived as 80 mm pages sized to their
    content, without a dialog.

---

## 2026-09-28 — 0.2.41: SalonMate, part 1 — the front desk at the counter

SalonMate is in the launcher, native, for anyone whose company has it and
who may view it. This computer is paired as one location's front desk, and
from then on it does the counter's daily work: who is next, check-in with
the allergy read out, walk-ins, bookings, clients, and the day by stylist.
Taking money, printing and working offline come in the next two releases;
until then the desk sends people to pay where they pay today.

**Added**

- **Pairing this computer** as a front desk: a name, the location, and the
  POS register its money will go to (or none). An owner approves it in
  SalonMate → Front desk PCs; the screen moves on by itself when they have.
  Someone who may approve desks is approved at once.
  - The desk's key is kept in this computer's credential store, per server,
    and added to SalonMate's requests by the app itself. The screens never
    see it, and it cannot be read from them or sent anywhere else.
  - Once revoked, a desk's bookings and check-ins are refused at once, and
    the screen says it is revoked at its next check (five minutes at most).
    **Pair this computer again…** forgets the pairing here; the old desk
    stays listed on the server until an owner revokes it. **Sign out and
    remove WorkSuite data** (Settings), or a remote wipe, forgets every
    pairing.
  - The desk checks in with WorkSuite every five minutes, so owners see
    which desks are alive.
- **Today.** Who arrives next and who is late, with a deposit owed or an
  advance paid, and their allergy. Who is ready to pay and how much is
  left after any advance. Who is in a chair and until when, and who is
  free. Walk-in, New booking, Find a client and the day by stylist are one
  press away. Refreshed every minute; its day and times are the salon's
  clock, not this computer's.
- **Check-in**, from Today or the calendar. A client with an allergy at or
  above the salon's threshold has it read out first, and check-in waits
  until "I have told the stylist…" is ticked. A service that needs a patch
  test the client doesn't have asks why you are going ahead. The server
  decides and keeps the acknowledgement; the desk only asks.
- **Walk-in and New booking.** Pick services; only stylists who do every
  one of them here are offered, each with when they are next free, from the
  same availability check every booking uses. The price and any deposit
  come from the server's quote.
  - **Start now** books, checks in (through the allergy read-out) and starts
    in one step. **Book a later slot** shows a stylist's free times, day by
    day.
  - Taken in the meantime? The nearest free time is offered to book
    instead.
  - Find the client by any part of their name, mobile or email, or add one.
    WorkSuite asks whether a new client is somebody it already knows.
- **Clients.** Search, then the card: the allergy first, the patch test on
  file, points, store credit, what they owe and their last visits. Record an
  allergy as the client tells it. **Book again** opens a booking with the
  same services and stylist. **Open full record** opens it in WorkSuite on
  the web.
- **The day by stylist.** Each stylist's working hours, every booking as a
  block, and a line at the time now. Press a booking to check it in or open
  the client. Day before, day after, today.
- **Owners' screens on the web** — reports, commission, settings, the list
  of desks — open in the browser from the rail.

**Where it bites**

- Every write is one attempt under one key. After a dropped connection,
  pressing again repeats the same attempt, never a second booking. The key
  is renewed only once WorkSuite has answered.
- The desk's key is never shown, logged or copied to the screens. A screen
  that tries to send its own key header has it dropped by the app.
- The app's API proxy now refuses any address with a `/./` segment, so its
  list of refused addresses always sees the path the server will.
- Money, receipts, the cash drawer and closing the day are not native yet.
  The Ready to pay list shows what is owed, but nothing here takes it.
- Nothing works offline yet. With WorkSuite unreachable each screen says
  it could not load, with Retry.

**Server this needs**

- The SalonMate module in WorkSuite (merged to main in a94372b, not
  deployed yet), including desk keys (`salon_desks.key_hash`). Against a
  server without it, SalonMate is not offered.

**Checked**

- Unit tests for the desk's credential store and the app adding its key,
  the check-in read-out, stylists offered, next free times, the salon's
  clock, and tab addresses.
- `tests/e2e/salon.mjs`, run against a local WorkSuite: pair, Today, a
  client, Book again, the booking on the calendar, check-in through the
  allergy read-out, forget. It cleans up what it made.

## 2026-09-28 — Meet: pointing at and drawing on a shared screen; the controller's name at the pointer (ships in 0.2.43)

The last part of WS-MEET-ENH-01 the desktop did not have (RC-PTR-01…03,
RC08, RC-INP-04).

**Added**

- **Pointer and Annotate over somebody's shared screen**, beside Request
  control: a laser pointer with your name, and pen, arrow, rectangle, text
  and highlight in six colours, with Clear mine. It is the web client's own
  format on its own topic, so browsers and this app see each other's. The
  marks are painted over the picture on each screen; the shared computer is
  not changed. Off while you control that screen, and when the meeting or
  the person sharing turns it off.
- **Sharing: Clear viewers' annotations** and **Turn viewers' annotations
  off** in the share menu, and the status line says who is pointing.
- **Being controlled: the controller's name beside the pointer** while they
  move it, gone a moment after they stop, when you move your own mouse, and
  before every click and scroll they send — it is never what a click lands
  on.

**Fixed**

- The Tenders tests' type imports, which failed the lint step of every
  build.

---

## 2026-09-28 — Meet remote control: the input helpers, checked on real systems (ships in 0.2.43)

A check that drives each input helper against a test window reporting what
arrives (`tests/os/remote-control/check.mjs`), run by CI on Windows, macOS
and Linux whenever the helpers change. On Linux it found:

**Fixed**

- **With one window shared, clicks landed a title bar too low** — near
  the bottom edge, on the app below. The xdotool that Debian and Ubuntu ship
  places a window inside its frame by the frame's offset twice; the
  window's place now comes from xwininfo, and without it one shared window
  takes no clicks (Settings says to install x11-utils; a whole screen works
  without it).
- **Accented letters, other scripts and emoji were not typed** when the
  app ran without a UTF-8 locale (no LANG, or LANG=C): xdotool reads text in
  its locale. It now runs in a UTF-8 one.
- **A character the keyboard layout lacks could come out wrong**: xdotool
  types it on a spare key it remaps, and without a pause the app read the key
  before the remapping. Text with such characters is typed with xdotool's
  usual 12 ms between keys; plain text stays instant.

---

## 2026-09-28 — Meet remote control: the Windows and macOS helpers, checked from Linux (ships in 0.2.43)

Neither helper has run on its own system yet. The Windows one ran under
PowerShell against a stand-in for Windows' input functions, and passed; the
macOS one, run against a stand-in for its bridge, did not:

**Fixed**

- **On a Mac, a double-click did nothing more than two clicks** — no file
  opened, no word was selected. macOS does not work out double-clicks from
  posted events; each click now says which click it is.
- **On a Mac, a modifier could stay on after it was let go**, so a V typed
  after Command+C could arrive as Command+V. Keys now carry exactly the
  modifiers held, none once they are let go.
- **On a Mac, a small sideways scroll was lost**, and scrolling now uses the
  system's own scroll event where the scripting bridge has it.
- **On a Mac, typed text could be silently refused**: it goes through System
  Events, and the app did not declare Apple Events. It now does, with a
  sentence for the prompt macOS shows once.

**Changed**

- The Linux .deb recommends xdotool and x11-utils (xwininfo), which remote
  control needs; with the .rpm and the AppImage, the app says what to
  install.

---

## 2026-09-28 — Meet remote control, tried for real on Linux (ships in 0.2.43)

The shared computer's side run under a real X server (Xvfb and openbox) with
xdotool and real Electron windows. Moves, clicks, keys, typed text and the
wheel landed; the real-click rule, the red bar and the emergency chord held.
Three things did not work, and are fixed:

**Fixed**

- **On Linux, the person here moving their mouse out on the desktop did not
  hold the controller back.** Electron only learns where the pointer is from
  events on its own windows, so away from them its reading stood still. The
  pointer is now read through xdotool while control lasts.
- **On Linux, with one window shared, clicks on it were refused.** xdotool
  names the frame the window manager draws around a window, not the window;
  `xwininfo` now says whether the shared window is inside that frame. Where
  xwininfo is missing, clicks go through only while the shared window is the
  one in front.
- **On Linux, with one window shared, a click could make the next ones
  wait.** Checking what is under the pointer takes the pointer there, and
  that move could be taken for the person here using the mouse, holding the
  controller back for a second and a half. It now counts as the
  controller's.

---

## 2026-09-28 — Meet remote control: what the security review found (ships in 0.2.43)

Three reviews of the code that lets someone else drive this computer. Nothing
let input through without the current key; these are the gaps they found.

**Fixed**

- **A page could take a file offered to the shared computer** through the
  API proxy, skipping the red bar's Accept and its real-click check (the
  server checks only who the receiver is). Taking, fetching and offering
  files now go through the main process only; the controller's own Accept
  goes there too and takes only files sent to the controller.
- **Reserved chords written another way got through** (`Meta + L` locked the
  screen, `Alt+Ctrl+Shift+Esc` fired the emergency stop as if the person
  here had). They are now matched by key and modifiers in any order,
  spelling or with extras; the policy's chord is normalised the same way.
- **A lock or sleep during the approval or a key change was lost**, and
  control went live unpaused. It now holds, and is told to the server when
  control goes active. Only the person's own Resume lifts it.
- **Queued input could run after a pause, and a late-running queued click
  could pass for the person's own.** One batch at a time is in the input
  helper, each confirmed; a pause forgets the rest and the releases go next;
  the real-click check counts from when the helper finished, with nothing
  queued.
- **On Linux**, anything after typed text in a batch was typed as words (so
  key-ups were lost), and ending a session could throw away the releases.
- **One window shared**: clicks could land on another app covering it, and
  keys could reach other apps for up to a second after Alt+Tab. Presses now
  need that window under the pointer, keys wait until it has been seen in
  front, and app switching (Alt+Tab, Command+Tab) is not passed on.
- **A screen share whose display could not be matched** sent input to the
  primary display. It now takes none, unless there is only one display.
- **Any participant could flood the control channel** and crowd out the
  controller: the meeting window now relays only the controller's messages.
- The grant must say it is one, name this computer and name its key (the
  server now puts the key's SHA-256 in the signed grant); only Ed25519 keys.
- Leases can't be stamped far into the future; a key change no longer sends
  administrators false "unsigned message" alerts; an input helper that exits
  pauses control; stopping ends input before the server answers; offered
  files are streamed from disk rather than read into memory; typed text lets
  go of held modifiers first; the key table has no prototype.

**Changed**

- The rate limits were raised to what a person can make with a 120 Hz
  trackpad and a held key (240 pointer and 60 key events a second), so fast
  scrolling no longer trips the burst alarm.
- The special-keys menu now says "Ask for Ctrl + Alt + Delete": no app can
  send it; the person at the computer is asked to press it.

---

## 2026-09-28 — Meet remote control (ships in 0.2.43)

WS-MEET-ENH-01, the desktop's part. The server and web sides shipped
earlier; a browser can be watched but never controlled, so this is what
makes remote control work.

**Added**

- **Control another participant's shared screen** from a meeting window:
  Request control (with a reason, and the server's sentence when it isn't
  offered), the wait, then mouse, wheel, keyboard, special keys and text
  mode; Release control. Turned off by the `remote_control_controller`
  policy.
- **Be controlled, when you allow it.** Sharing from WorkSuite Desktop
  registers the share as the desktop's; the picker offers the quality and
  "Let people ask to control what I share". A request opens a prompt above
  everything (RC03): who asks and why, what they may do, for how long.
  Allowing needs a click with this computer's own mouse or keyboard. While
  control lasts, a red bar stays at the top of the screen with Pause and
  Stop (RC04), the tray says so, and the emergency chord stops it at once.
  Moving your own mouse always wins. Control pauses by itself for the lock
  screen, sleep, a user switch, the secure desktop, and password managers
  or system prompts; only you resume it. Quitting asks first (RC15).
- **Settings › Remote control** (RC09): whether this computer can be
  controlled and why not, the default for "Let people ask", the emergency
  chord, and on a Mac the way to Accessibility.
- **A second person asking** while someone has control gets the same prompt,
  worded as a handover: the first loses control when you allow it.
- **Files during control** (RC06), when the grant allows file transfer.
  Either end can send: "Send a file" on the controller's bar, or on the red
  bar here, which opens the system's file dialog (nothing is injected while
  it is open). Files sent to you wait on the red bar with Accept and
  Decline; accepting needs your own click, and a program asks a second
  time. Accepted files arrive in the download folder and the transfer list.
  Up to 512 MB each; the `remote_file_receive` policy can turn receiving off.

**Needs**

- **Windows:** Windows PowerShell (always there unless removed by policy).
  Elevated windows can't be driven by a non-elevated WorkSuite.
- **macOS:** WorkSuite in Privacy & Security › Accessibility.
- **Linux:** an X11 session and `xdotool`. Wayland sessions can share but
  not be controlled.

**Not yet**

- The input helpers have been exercised with a stand-in in the tests, not
  yet on real Windows, macOS and X11 machines.
- Switching screens for the controller (monitor switch) is wired through
  the meeting window but not yet tried with a real second display.
- Viewers' pointers and annotations are not drawn over this computer's
  screen while it is shared; they show in the meeting window only.

## 2026-09-27 — 0.2.40: Tenders, part 3 — the document library, reports and settings

Tenders is now fully native: nothing in its rail opens in the browser. The
whole tender can still be opened there from its own page.

**Added**

- **Document library.** The company's own certificates — registration, tax,
  financials, insurance, certifications, references — kept once and filed
  against every bid's checklist.
  - Tiles for what is in the library, what has expired, what expires within
    60 days, and what has no file (details alone satisfy nothing). The
    rail's badge counts the expired ones.
  - Soonest to lapse first, with the days left or since. Search, and filter
    by state.
  - **Open** a document's file. Add or edit one with its kind, reference,
    issue and expiry dates, and a file chosen from this computer or from
    Drive. With every company in view, it asks which company the document
    is for.
  - Remove one or several. A document a live bid's checklist is filed from
    is refused and named.
- **Reports**, for this month, this quarter, this year, the last 12 months,
  all time, or two dates of your choosing.
  - What came in: how many, how many are still open, by sector and by
    industry.
  - What was decided: won, lost, cancelled, the win rate, and the value
    awarded per currency.
  - Why we lost: the reasons given, who won instead, and how far above the
    winning price our bid was.
  - A period that ends before it starts is refused, and nothing is shown
    for it.
- **Settings**, for those who may set Tenders up.
  - **Scoring rules**, each read as a sentence ("Published budget ceiling is
    at least 1,000,000"). Add, edit, switch off and on, remove, and score
    every open tender again. The form offers only comparisons that can match
    what the rule looks at, and a rule that would move nothing is refused.
  - **Sources**: the ways tenders can arrive, with why a way can't be used
    yet, and each source's recent runs (seen, kept, already here,
    unreadable).
  - **General**: the module's switches, such as whether a required document
    must be approved before a bid goes out.

**Server fixes this needed** (LHCP 144c025b, not deployed yet)

- A library document's file could be opened only by whoever uploaded it.
  There's now a route for the company, and each document says which company
  it belongs to.
- The report counted cancelled tenders as open, and worked its win rate from
  tenders *added* in the period while its loss analysis used losses
  *decided* in it. Its days were UTC days.
- A scoring rule that could never fire was saved without a word.
- A tender source's configuration went to anyone who could view tenders.

---

## 2026-09-27 — 0.2.39: Tenders, part 2 — a tender's working tabs

A tender's working tabs now open here instead of in the browser: the
checklist, documents, bonds, meetings, budget, approvals, the buyer's notice
and its letters, and recording the submission and what the buyer said. Only
the document library, reports and settings still open in the browser.

**Added**

- **Checklist.** The buyer's requirements, section by section in the
  buyer's order.
  - Progress is the share of required lines that are ready, as the server
    counts it: something readable on file, not sent back, not expired. A
    tender with nothing required says "No checklist" rather than 100%.
  - Filters: all, outstanding, missing, pending review, sent back,
    approved, optional.
  - Each line shows its file (open it, or an earlier version), who chases
    it, its expiry, and, when it doesn't count, why — in the words the
    pipeline uses when it refuses to move the tender on.
  - **Attach** from this computer or from Drive, or drop a file on the
    line. Each becomes the line's next version and waits for review.
  - **Approve** and **Send back…** need the approval permission, and a
    reason for sending back. Approve is not offered on a line with nothing
    on it.
  - Add a line, add a standard pack, edit a line (chased by, expiry,
    required), remove. Approve or remove several at once.
- **Documents.** Add the buyer's notice, the specification, our bid,
  clarifications, addenda or the award letter, from this computer, from
  Drive, or by dropping files on the list. Open or save each one; replace it
  with a new version; rename it, change its kind, mark it final; take it off
  the tender (the file stays in Drive). What you may do is the server's
  answer, so buttons that would be refused aren't shown. A file held by the
  malware scan, or removed from Drive, says so.
- **Bonds.** Bid securities and guarantees, soonest to lapse first, with the
  days left. Anything inside thirty days is called out. At the top, the
  total still tied up per currency. Record, edit, attach a copy, remove.
- **Meetings.** Pre-bid, site visit, clarification and opening, on your
  clock. Mandatory ones say so, as does a past one not recorded as
  attended. The questions deadline, who went and the minutes are kept with
  each meeting.
- **Budget.** Cost lines and the margin against our bid. The margin appears
  only once a bid value is entered. Below them, what has actually been
  spent: the expense claims filed against the tender, for those who may see
  Expenses.
- **Approvals.** The sign-off chain, with Approve, Reject (with a reason)
  and Skip for those who may. Add a step, optionally naming who approves.
- **Notice.** The buyer's notice as transcribed: who the letters go to, the
  committee, how and when the documents are issued, the fee and its terms,
  the envelope procedure. Beside it, what is kept elsewhere (closing time,
  pre-bid meeting, bid security) and where to change it. **Write the
  letter** produces the request for the bid documents as a PDF to open.
- **Submission.** **Record a submission** — how, when, the bid value, the
  receipt number — moves the tender to Submitted. Anything outstanding is
  listed first, and **Record it anyway** keeps what was missing in the
  history. **Record** what the buyer said at evaluation, with a score.
- Opening a tender always reads it afresh, so one someone else has just
  moved doesn't show its old stage and moves.

**Server fixes this needed** (LHCP 69cb5d8f, deployed 11:00 UTC 2026-09-27)

- A checklist line with nothing on it could be approved.
- An owner, a line's "chased by" or an approver could be someone from a
  different company, or anyone at all in the approver's case.
- Budget lines turned figures they couldn't read into 0; line totals were
  cut rather than rounded.
- A mistyped bid value left the tender at Submitted with nothing recorded.
- An edit could remove a bond's amount or a meeting's time, and moving a
  meeting read a time given without a zone on the editor's clock.

---

## 2026-09-27 — 0.2.38: Tenders, part 1 — the app, the lists, the board, one tender's workspace

Tenders opens here now instead of in the browser, under Business in the
sidebar. Links to a tender (`/tenders?open=…`, from notifications, search
and the stream) open it here too. A tender's working tabs (checklist,
documents, bonds, meetings, budget, costs, approvals), the document library,
reports and settings still open in the browser.

**Added**

- **The rail.** The company picker; **New tender** for those who may create
  them; Dashboard, Pipeline and All tenders. Below them: new opportunities
  and following (coming in), preparing, submitted and evaluation (in hand),
  won and lost (decided), each with its count. Then the library, reports
  and settings (in the browser), and My access.
- **The dashboard.**
  - Tiles: open, being prepared, awaiting a decision, win rate.
  - How ready each bid is: mandatory documents done against days left.
  - What closes this week.
  - The value in play and awarded, per currency and never added across
    currencies, and the library's expired documents.
  - Where there are any: bids that closed and were never moved on,
    approvals waiting, bonds about to lapse, meetings coming up, and
    whether each feed still brings anything in.
- **The lists.**
  - Each rail item seeds the filters: search, stage, outcome, owner (or
    nobody), priority, closing within 7/14/30 days or closed-still-open,
    following, not scored.
  - A sort in either direction, paging, and a footer counting the whole
    filtered set by stage, with its published ceilings per currency.
  - Tick tenders to follow or stop following them. Those who manage
    tenders can also set the owner or the priority, move them, or remove
    them. Awarded, won, lost and cancelled are never bulk moves. Each
    tender that refuses a move is named with its reason.
- **The pipeline board.** A lane per working stage, closing soonest first.
  Each card shows its score, priority, time left, owner and budget. Won
  and lost are counts that open their lists.
- **A tender's workspace.**
  - The header: stage, score, priority, following, buyer and number,
    closing time and time left, published ceiling, our bid, and the award
    or winning price.
  - Follow, Edit, and the moves the tender can make from where it is.
  - A move with things outstanding — mandatory requirements unmet,
    approvals not given — lists them first. **Move anyway** asks why, and
    the history keeps both the reason and what was missing.
  - **Won…** records the awarded value, and the client, deal and project
    follow. **Lost…** needs a reason and takes the winner, their price and
    what we would do differently. When the news comes before the paperwork,
    either can be recorded out of order, and the history says so.
  - Tabs:
    - **Overview:** the tender's facts, its description, why it scored
      what it did, and its approval steps.
    - **Submission & result:** why it was lost, or what it won;
      submissions; what the buyer said.
    - **History:** every stage move.
    - **Notes & activity:** add a note.
- **New tender.** Type one in, or paste a CSV. The paste is checked first
  (what would be imported, what is already here, what cannot be read), and
  nothing is kept until you import. With every company selected, the form
  asks which company the tender is for.
- **Edit** sends only what changed. It won't re-arm the closing reminders
  unless the closing time actually moved, and it leaves every field you
  didn't touch as it is on the server — including one somebody else has just
  changed.
- **My access.** The companies whose tenders you can see — a hard boundary:
  a tender in another company does not open, even from a link — what you
  may do, and every Tenders permission.

**Server fixes this needed** (LHCP 691c7c5c, deployed 10:27 UTC 2026-09-27)

- A search for `RFQ_12` matched `RFQ-12` too, because `_` was a wildcard.
- A tender could be renamed to a blank title.
- Moving several tenders to Preparing didn't make their tasks or folders,
  and moving several to Management approval didn't tell the approvers.
- Two people moving one tender at once both succeeded.
- A refused win or loss didn't say whether it could be recorded anyway.
- Preparation tasks were dated using the wrong time zone.

---

## 2026-09-27 — 0.2.37: Inventory, part 5 — reports, replenishment, brands & units, settings, My access

Every Inventory screen now opens here: none sends you to the browser.
Sales orders still open in Sales & Orders, or in the browser for anyone
who can't use it. The dashboard's Reports and Replenishment links stay in
the app too.

**Added**

- **Reports.** Fifteen, picked from a list grouped as stock, movement,
  money and serials: valuation, balance, aging, by warehouse, movement,
  fast moving, dead stock, ABC, expiry, product profitability, by vendor,
  and the serial register, movement, warranty, labels and tags.
  - Each shows its headline figure, any tiles (aging by age, profitability
    totals, label counts) or state counts, its tables, and the server's
    note on how the figures were worked out.
  - The warehouse is the one picked in the rail. Each report can also be
    narrowed by its own window, unit state or which labels.
  - Reports that are all money aren't offered to people without cost
    access; in the rest they see a dash for costs.
- **Replenishment.** What's below its minimum, soonest to run out first:
  available, coming, minimum, how much to order, use per day, days of cover
  and the vendor. Tick lines, or none for all, and **Raise requests**, which
  opens Purchasing › Requests with them there.
- **Brands & units.** Three panels:
  - **Brands:** new, edit (including archive) and delete.
  - **Units:** new, a base unit or one made of a base unit at a factor,
    and remove.
  - **Attributes:** new with their values; add a value in place with
    **+ value**; remove.

  Brands and attributes are for those who keep the catalogue, units for
  those who set Inventory up.
- **Settings**, for those who may set Inventory up:
  - **Rules & numbering:** each switch and prefix with its note, saving
    only what changed. This includes "Buyers may approve their own
    purchasing documents".
  - **Warehouses:** the list, new and edit. One warehouse shows its
    locations, what it holds most of, and who can act there. You can add
    a location and archive it (refused while it holds stock).
  - Labels, User access, Screens, Organization, Notifications and History
    open the settings in the browser (marked).
- **My access:** which of your companies' warehouses you can act in and
  why, the rule that naming the first person closes a warehouse, whether
  costs reach you, and every Inventory permission, granted or not.

**Server fixes this needed** (LHCP `775f0be4`, deployed 09:03 UTC 2026-09-27)

- The vendor report counted each order once per receipt, and each receipt
  once per order.
- The movement report's daily values went to people without cost access.
- My access showed other companies' warehouses.
- A brand could be renamed to nothing, and duplicate brand names or unit
  codes were accepted.
- A value added to an attribute later sorted first.

**Tests**

- Unit:
  - which reports are offered without cost access;
  - what each report is asked, and how each answer is read (headline,
    tiles, notes, tables);
  - the unit, rules and warehouse forms;
  - a warehouse's "0" switch read as off.
- End-to-end, against a local server (`tests/e2e/inventory-5.mjs`, 20
  checks, all passing). Covered:
  - no Inventory screen sending you to the browser;
  - the valuation, movement, vendor and serial reports, the vendor report
    matching the orders it counts;
  - a product two short of ten raised as a purchase request;
  - a brand, a unit and an attribute made, with a duplicate refused;
  - a rule changed and put back;
  - a warehouse made (not called the default), given a location and
    archived;
  - My access naming the reader's warehouses and permissions.
- The part 1, 3 and 4 end-to-end runs still pass.

---

## 2026-09-27 — 0.2.36: Inventory, part 4 — manufacturing, and sales orders in Sales & Orders

Manufacturing now opens here instead of in the browser. Sales orders — in
the rail, on the dashboard and in the rail's search — open in Sales &
Orders for anyone who can use it; for anyone else they still open in the
browser. Reports, replenishment, brands and units, settings and "My access"
still open in the browser.

**Added**

- **Manufacturing: jobs.**
  - The list, by state: what each job makes, where, how many are planned
    and made (scrap in red), and the unit cost for those who see costs.
  - One job shows its parts: needed, used and available, with a shortage
    in amber. Once complete it shows what it cost.
  - **New job:** the recipe (active ones only), where it's made, how many,
    a planned date and notes. "Start a job" on a recipe fills it in.
  - **Release:** reserves the parts, and says which are short.
  - **Record a run:** good units made (blank means the rest), scrapped, and
    the batch and expiry or the serials for a tracked product. It asks
    first, since it can't be undone here. A job can be finished in several
    runs.
  - **Cancel job** while nothing is made; **Delete** a draft.
- **Manufacturing: recipes.**
  - The list, with search and state.
  - One recipe shows each part per run, its waste and what's needed (waste
    divides). Those who see costs also get unit costs and the estimated
    cost of one run.
  - **New recipe and Edit:** what it makes, how many one run makes, name,
    version, and the parts with quantity and waste %. Labour and overhead
    per run are set by those who see costs; anyone else keeps what's there.
    Serialised parts are left out, because a run uses parts by quantity.
  - **Make it the recipe used**, **Archive**, and **Delete** (refused once
    jobs were built from it).
- **Raise invoice** in a Sales & Orders order: a draft invoice in Billing
  for what was delivered and not yet invoiced (for services, what was
  ordered). It's offered on a confirmed order with something still to
  invoice, to anyone who may raise invoices.

**Server fixes this needed** (LHCP `e21fd2f3`, deployed 08:07 UTC 2026-09-27)

- Two quick presses completed a job twice, using the parts and making the
  goods twice. Release and cancel had the same race.
- A job finished in several runs undercharged labour and overhead, and its
  unit cost was only the last run's.
- A blank "good units made" ignored the scrap.
- A released job showed a false shortage of the parts it had reserved.
- A job's detail had no product, warehouse or unit.
- Draft and archived recipes could be built.
- Costs went to people who may not see them.
- Two quick presses raised two invoices for the same goods.
- An unconfirmed or cancelled order could be invoiced.

**Tests**

- Unit:
  - what each job state allows;
  - "the rest" counts the scrap;
  - the job and run forms (batch, serials);
  - the recipe form: costs only from those who see them; no empty recipe,
    no product as its own part, no 100% waste;
  - waste divides;
  - when Raise invoice is offered.
- End-to-end, against a local server (`tests/e2e/inventory-4.mjs`, 20
  checks, all passing). Covered:
  - a recipe made, costed at 65 each and made the recipe used;
  - a job started from it, named, and released without a false shortage;
  - two runs: half the parts used first, then the rest;
  - the planned labour left alone, each unit costing 65, the goods on the
    shelf;
  - two presses of Complete making the goods once;
  - a draft recipe refused;
  - Sales orders opening Sales & Orders;
  - an invoice raised there for what was delivered, once;
  - an unconfirmed order refused.
- The part 1 and Sales & Orders end-to-end runs still pass.

---

## 2026-09-27 — 0.2.35: purchasing, as decided

The owner's decisions on the purchasing questions 0.2.34 raised, on the
screens here.

**Changed**

- **Whoever raised an order or request isn't offered Approve.** The order
  says "You raised this order, so someone else approves it", and a request
  says the same. A team of one can allow it with the purchasing setting
  "Buyers may approve their own purchasing documents", in Inventory →
  Settings (in the browser for now).
- **Buyers see and set prices even without cost access.** An order's
  Unit cost column, and the unit cost on New order and Edit, now show for
  anyone who may buy, not only those who see cost prices.
- **PDF is offered only to those who see an order's prices.** Anyone else
  sees its lines and quantities, with a dash for the money.

**Server fixes this needed** (LHCP `fbceb4ab`, deployed 07:30 UTC 2026-09-27)

- Order, bill and payment amounts were sent to anyone who could view
  inventory.
- The raiser of an order or request could approve it.
- The vendor link led nowhere; it now opens the vendor's page.
- Orders took "tax inclusive", then added the tax on top anyway.
- Orders, bills and payments numbered across companies.

**Tests**

- Unit: Approve is left off, with the reason shown, when the server says
  this person may not approve. An older server that doesn't say changes
  nothing.
- End-to-end, against a local server (`tests/e2e/inventory-3.mjs`, 18
  checks, all passing). New checks:
  - the raiser of a new order sees the reason instead of Approve;
  - the server refuses them for the order and for a request;
  - with self-approval allowed, the order is approved here;
  - the run puts the setting back as it found it.

---

## 2026-09-27 — 0.2.34: Inventory, part 3 — purchasing and vendors

Purchasing and Vendors now open here instead of in the browser. The rail's
search opens an order, a goods receipt or a vendor here, and the
dashboard's purchase-order and "to reorder" links do too. Sales orders,
manufacturing, reports, replenishment, brands and units, and settings still
open in the browser.

**Added**

- **Purchasing: orders.**
  - The list, by state or search, with vendor, where it is delivered, when
    it is expected (late ones in red), how much is still to come, and the
    total.
  - One order shows its lines (ordered, received, unit cost for those who
    may see costs, line total), its freight, insurance and duty, and its
    receipts.
  - **New order and Edit:** vendor, where it is delivered, expected date,
    our reference, freight, insurance, duty, and lines. A blank unit cost
    takes the catalogue's. Someone who may not see costs doesn't set them,
    and a line they change keeps its own.
  - **Approve**, **Receive goods** (it makes the draft receipt and opens
    it), **PDF** (filed in the Drive and opened), **Cancel order** (until
    anything has arrived) and **Delete** (a draft or a cancelled one).
- **Purchasing: receipts.**
  - The list, with the order, vendor, warehouse, status, when received,
    their invoice and the value.
  - A draft receipt is checked before posting:
    - their invoice and delivery note, and the freight and duty on this
      delivery (it arrives filled with the order's share);
    - per line, what was accepted and what was rejected, with why;
    - the batch and expiry for a batch-tracked product, and a serial per
      unit for a serialised one.
  - **Post — put this stock on the shelf** (confirmed first) and
    **Discard**.
  - A posted receipt shows its landed costs.
- **Purchasing: requests.**
  - What people have asked for, by state: lines with the preferred vendor
    and the note.
  - **Raise from what is below minimum**, **Approve**, and **Turn into
    draft orders** (one per vendor).
- **Vendors.**
  - The list, with type, contact, terms, lead time, orders, spend (for
    those who may see costs) and status; search, status, type and
    favourites.
  - One vendor opens with:
    - an overview: orders, values, on-time delivery, lead time and rejects
      on arrival, compliance, contract and documents;
    - people: contacts and addresses;
    - trade terms, with bank and credit only for those who may see cost;
    - orders and history, whose orders and receipts open here.
  - Favourite, Edit and Archive.
- **New vendor and Edit vendor:** name, code, status (with a reason when
  it isn't active), and the general, financial (bank for cost holders) and
  purchasing essentials. As you type, "This may already be on file" names
  likely duplicates. Only the fields you changed are saved. Contacts,
  addresses, documents, contract and custom fields are still edited in the
  browser.

**Server fixes this needed** (LHCP `5ea03135` and `f7c5e298`, deployed
06:33 UTC 2026-09-27)

- A receipt could post twice.
- A cancelled order came back to life when its draft receipt was posted.
- An order's freight, insurance and duty never reached stock cost.
- Saving an order dropped most fields, and repriced hidden costs to 0.
- Saving a vendor without cost access wiped its bank details.
- Bills and vendor payments had no company check.
- An awarded order had no company.
- A vendor's records showed other companies' documents.
- The vendor portal token, and several costs, went to everyone.
- A goods receipt's detail had no names.
- The bill filters were broken.

**Tests**

- Unit: what each order state allows, the order form (blank and hidden
  costs never sent), receipt checks (batch, serials, rejects) and vendor
  saves (only what changed; never bank details from someone who may not
  see them).
- End-to-end, against a local server (`tests/e2e/inventory-3.mjs`, 15
  checks, all passing):
  - a vendor made with its bank details, and edited without losing them;
  - an order raised with freight, edited (freight kept, duty and reference
    added) and approved;
  - goods received with the order's 250 of charges, nine accepted and one
    rejected as damaged, posted at price plus charges;
  - the order part received;
  - its history reached from the vendor;
  - a request approved and turned into a draft order.
- Parts 1 and 2's end-to-end runs still pass.

---

## 2026-09-27 — 0.2.33: Inventory — approval by a second person

**Changed**

- **Approve** isn't offered on an adjustment to whoever raised it *or last
  changed it*, or on a transfer to whoever raised it, unless they manage
  inventory. The panel says why.
- **Reverse** now makes the reversal as a draft, which goes through
  approval like any other adjustment before it posts. The confirmation says
  so.

**Server change this needs** (LHCP `30c8fa0e`, deployed 05:44 UTC
2026-09-27): the same three rules on the server, with a new `edited_by`
column on adjustments.

**Tests**

- Unit: the transfer rule.
- End-to-end (`tests/e2e/inventory-2.mjs`, 17 checks, all passing): a
  reversal starts as a draft, is sent for approval and approved, then
  posts.

---

## 2026-09-27 — 0.2.32: Inventory, part 2 — adjustments, transfers, counts, batches and serials

Inventory's control screens now open here instead of in the browser:
Adjustments, Transfers, Stock counts, and Batches & serials. Opening stock
is recorded here too. The rail's search opens an adjustment, a transfer, a
serial unit or the batches here. The dashboard's "needs attention" links
for these, and its New adjustment button, open here as well.

**Added**

- **Adjustments:**
  - the list, by status, with reference, warehouse, reason, lines, value,
    who raised it and when;
  - one adjustment shows its lines (serial and batch named), what they are
    expected to be worth before posting, and where it stands.
  - **New adjustment:** warehouse, reason, why, and lines. A negative
    quantity writes stock off; a positive one brings it on. A batch-tracked
    line names its batch (and expiry when brought on); a serialised line
    names one serial per unit.
  - **Edit** a draft or rejected one, **Send for approval**, **Approve** or
    **Reject** (with the reason added to its note), **Post to stock**,
    **Reverse** a posted one (it opens the reversal to post), and
    **Delete** one that hasn't posted.
  - Approve isn't offered to whoever raised it, unless they manage
    inventory, and the panel says why.
- **Transfers:**
  - the list, with from, to, status, lines, units, shipped and received;
  - one transfer shows what was asked, sent and received;
  - **New transfer:** from, to, date, expected, carrier, tracking number,
    and lines, each naming its batch where it has one. Serialised products
    move by an adjustment at each end, so they aren't offered.
  - **Approve**, **Ship**, **Receive** (with what arrived typed per line),
    **Cancel** and **Delete**.
- **Stock counts:**
  - the list, with kind, status, how many counted, variances and value;
  - **New count:** warehouse, kind (random sample with how many lines,
    cycle, full physical, spot check), everything or one category;
  - **Start counting** freezes what is expected. Type the counts, and the
    variance and value are worked out as you type; lines that moved since
    the sheet was frozen are marked.
  - **Save counts**, **Post variances** (it saves first), **Cancel**,
    **Delete**. An empty count is left out, never read as zero.
  - A posted count links to the adjustment it made.
- **Batches & serials:**
  - **Batches** in stock, soonest to expire first;
  - **Serials**, every unit with its tags, status, warehouse, customer and
    warranty, and a scan box for a barcode, QR reference, NFC tag or serial;
  - **Expiring** within the usual window, or 30, 60 or 90 days. Expired
    stock is flagged, with a way to start the write-off.
  - A unit opens with how it is identified, what is known, and everything
    it did. Those who manage inventory can attach or remove its NFC tag.
- **Record opening stock** (Setup, in the rail): warehouse, as-at date, and
  lines with quantity and unit cost, batch or serials where needed.
  Products already moving in that warehouse are skipped and named.

**Fixed**

- Renaming a category saves reliably. It read the name from the screen's
  state, which could lag a quick type-and-leave, so the rename was
  sometimes dropped.

**Server fixes this needed** (LHCP `415299bb`, deployed 05:22 UTC 2026-09-27)

- A serial unit's detail and the scan returned its cost unmasked, and an
  adjustment's create, save and post responses returned its value
  unmasked.
- A serial unit's detail could open the wrong unit: another unit whose
  barcode matched its serial number.
- The detail views of adjustments, transfers and counts had no names (the
  web printed "undefined").
- A cancelled transfer could ship when approval is off.
- Two presses of Post, Ship or Receive could both go through. Rows are now
  locked.
- A short receipt advised writing off stock that shipping had already
  removed.
- A count with a batch-tracked difference could never post. It now says
  why, and what to do.
- Warehouse viewers were listed as able to act.

**Tests**

- Unit: what each status allows, the forms' checks and bodies (batch,
  serial, signed quantities, typed minus signs), empty counts, line
  values, opening stock, and a unit's tags.
- End-to-end, against a local server (`tests/e2e/inventory-2.mjs`, 17
  checks, all passing):
  - an adjustment raised, approved, posted and reversed;
  - two cameras brought on by serial, listed, opened and scanned;
  - a transfer shipped and received four of five, with the shortfall not
    taken twice;
  - a count posting a difference of one, and its adjustment;
  - opening stock for a batch, seen in Batches and Expiring.
- Part 1's end-to-end run and Files' still pass.

---

## 2026-09-27 — 0.2.31: Files — drag to select

**Fixed**

- **Dragging the mouse over files didn't select them.** Files had no
  drag-to-select, and a click on empty space didn't clear the selection
  either. Now, in the list or the grid:
  - press on empty space and drag: a rectangle follows the pointer, and
    every file and folder it touches is selected;
  - hold Shift or ⌘/Ctrl to add to what is already selected;
  - dragging near the top or bottom edge scrolls the list;
  - a plain click on empty space clears the selection.
- Dragging a file itself still moves it into a folder, as before. In the
  list, where rows fill the width, the rectangle starts from the space below
  the rows.

**Tests**

- Unit: the rectangle whichever way it is dragged, and which tiles it
  touches.
- End-to-end (`tests/e2e/files.mjs`, now 37 checks, all passing): a drag
  across two tiles selects exactly those two, and a click on empty space
  clears it.

---

## 2026-09-27 — 0.2.30: Inventory, part 1

Inventory now opens here: its rail, the dashboard, products, the stock
overview and movements. The other screens in the rail (adjustments,
transfers, counts, batches and serials, purchasing, sales orders, vendors,
manufacturing, reports, replenishment, brands and units, settings, my access)
open in the browser, marked. `/inventory?product=` and
`/inventory/products/<id>` links open the product here.

**Added**

- **The rail:**
  - a company picker (for anyone in more than one company) and a warehouse
    picker. The warehouse narrows the dashboard, stock and movements;
  - **Scan or search.** A code, barcode or serial typed or scanned and
    followed by Enter opens its product. Other hits (documents, batches,
    vendors, warehouses) open in the browser;
  - badges: what is low or out, and what is waiting in each document type.
- **Dashboard:**
  - products, categories, vendors and warehouses;
  - stock value, units on hand, low stock and out of stock;
  - what needs attention;
  - fourteen days of stock received and issued;
  - what is coming in and going out, and stock health;
  - each warehouse with its value;
  - the latest movements;
  - what runs out soonest at the rate it moves, and what to reorder;
  - the last stock count, and any negative stock.
- **Products:**
  - The category tree beside the list. Choosing a category includes
    everything filed under it, and each shows its count.
  - Search, stock state (in, at or below minimum, out) and archived.
  - Columns: tracking, available against on hand, incoming, sold, price
    and cost. Load more, 50 at a time.
- **A product** opens as a drawer:
  - **Overview:** available, on hand, reserved and incoming; each warehouse
    with its average cost; consumption and days of cover; variants, bundle
    contents, specification, details and price lists.
  - **Sales:** the invoices it was sold on. Each opens in Invoices.
  - **Purchase:** the orders and supplier bills it was bought on.
  - **History:** every movement and catalogue edit.
  - **Archive** or **Restore**, for those who edit the catalogue.
- **New product and Edit:**
  - name, code (generated when blank), barcode, kind, category, brand and
    unit;
  - whether it is held in stock, with tracking and costing;
  - selling price, cost price (only for those who may see costs), tax,
    reorder point and quantity, lead time, and description.
  - Tracking and costing are locked while stock is on hand anywhere, since
    the server would refuse the change.
  - Someone looking at every company chooses which company the product
    belongs to.
- **Categories:**
  - rename in place (it saves as you leave the field);
  - move one under another, taking everything beneath it along;
  - add at the top or under one;
  - delete an empty one. The dialog warns first when a category still holds
    products or sub-categories.
- **Stock:**
  - a line per product (per product and warehouse when one is chosen),
    with available against on hand and reserved, incoming, the minimum,
    average cost, value and when it last moved;
  - search, "at or below minimum", "out of stock", "has reservations" and
    "show zero";
  - the head gives the number of lines and their total value.
- **Movements:**
  - when, product (with serial or batch), warehouse and bin, reason and
    reference, quantity, unit cost, value, the balance it left, and who;
  - narrowed by product or reference, warehouse, reason, direction and
    dates.
  - A row opens its product's history.
- Cost figures are a dash for anyone without the cost permission, never
  0.00.
- Opening stock is stored as midnight on its day, so it shows as that day.
  Read as an instant, it would have shown the reader's hour at UTC
  midnight ("5:30 AM").

**Server fixes this needed** (LHCP, deployed 04:15 UTC 2026-09-27)

- **e308e777:**
  - Costs reached people without the cost permission: a product's variant
    costs, a saved product's cost price and a stock count's variance.
  - A product's purchase history listed every company's bills and orders.
  - The stock overview valued a product held in several warehouses at the
    dearest one's cost. On MySQL its "all warehouses" view and its "at or
    below minimum" filter failed. It now also returns its line count and
    total value, which the desktop shows only once deployed.
  - The drawer lacked category, brand and unit names. Consumption was
    hidden from anyone without the cost permission.
  - Sales returns were recorded as adjustments.
- **a5589bbc:** adding a category, brand or unit with no company chosen,
  for someone in two, failed with a bare server error. It now says which
  company is missing.

**Tests**

- Unit: permissions; numbers the server sends as text; masked costs; the
  category tree, its counts and where a category may move; the product
  form; movement wording; what needs attention; the midnight rule; and the
  product links.
- End-to-end, against a local server (`tests/e2e/inventory.mjs`, 23
  checks, all passing):
  - the dashboard and the browser-only screens;
  - the tree nested and counted;
  - a parent category narrowing the list;
  - a product found by search, and its drawer's four tabs;
  - tracking and costing locked on a stocked product;
  - an edit;
  - a new product with category, price and minimum;
  - categories renamed, added, refused and deleted;
  - stock and movements found by search, with the product's name keeping
    its room;
  - a barcode scanned into the rail.

---

## 2026-09-27 — 0.2.29: Billing, part 2

The rest of Billing now opens here instead of in the browser: Payments,
Credit and debit notes, Recurring, Customers, Reports and Settings. The rail's
search opens an invoice, note, payment or customer here, and "payments on
account" opens Payments narrowed to them. Only the settings that hold
credentials stay in the browser (marked): payment gateways, the CRM
connector, WooCommerce stores and members.

**Added**

- **Payments:**
  - the list, with search, method and "unallocated only", plus what was
    received and what is on account;
  - a refund is its own row, going out.
  - One payment shows its details, the invoices it is set against (each
    removable) and its refunds, with the rate used when it is not in the
    base currency.
  - **Allocate:** settle the oldest invoices first, or type amounts per
    invoice. The amounts start where oldest-first would put them.
  - **Refund** (needs `billing.credit`): only what is not set against an
    invoice. The sheet says what was received, what is on invoices, what was
    refunded already and what is free.
  - **Receipt:** the PDF, filed in the Drive and downloaded.
  - **Transfer slips:** the customer's proof of payment. Attach PDFs or
    images (up to 10 MB), download and remove them.
  - **Delete** a payment that is on nothing.
- **Credit and debit notes:**
  - the two lists, with number, customer, what the note is against, status,
    amount and what is unused;
  - one note shows its details, lines and what it is applied to;
  - Issue: a credit note against an invoice is applied to it at once;
  - Apply a standing credit to an invoice, the PDF, and Delete draft.
  - **New note:** credit or debit; the customer; against an invoice or none
    (with the company for a standalone note); amount, line and reason. A
    credit note is capped at what the invoice still owes.
  - An issued invoice has **Raise credit note**, which starts one against
    it.
- **Customers:**
  - largest outstanding first, with invoices, billed, outstanding, overdue
    and on account; search and "owing only";
  - one customer shows their figures, how old their debt is, and their
    invoices, payments and recurring billing, each opening here. Their
    subscriptions open in the browser.
- **Recurring:**
  - each profile's schedule, next run (and how far ahead it is invoiced),
    state and invoices generated; how many are due and how many cannot run;
  - **Run** a due profile. It raises a draft to review, or an issued invoice
    if the profile issues automatically, and opens it;
  - **Set the company** on a profile that cannot run without one;
  - one profile shows its schedule, the next few dates, its lines, and the
    invoices and payments it produced;
  - Pause, Resume and Remove;
  - **New profile:** name, customer, company, frequency, first invoice,
    optional end, lines (with products and taxes), and "Issue
    automatically". It is off unless ticked.
  - A profile run by Subscriptions says so, and is changed there.
- **Reports:** Aging (by customer), Revenue (by month, customer or project),
  Tax (by rate), Customers (with average days to pay), Payments (by method,
  by month, and money on account) and What sold. The window is a preset or
  your own dates. The server has no export for these.
- **Settings:**
  - **General:** numbering, money, letterhead, document and branding, for
    one company at a time. These come from the server's own field list, so
    a new setting appears without a release. The accent colour has a
    picker; the logo is chosen in the browser.
  - **Tax rates:** add one (sales or withholding, compound, on every
    invoice), retire it, or bring it back.
  - **Exchange rates:** record a rate as "1 EUR equals, in LKR", with a
    worked example ("100 EUR is 33,000 LKR"), and remove it.
  - **Payment modes:** add, edit and remove.
  - **Currencies:** add, edit, make base (until the first invoice), remove
    unused.
  - **Data access**, with your Billing permissions.

**Changed**

- The settings form People uses (now shared) can read and save one company's
  settings. People's own settings are unchanged.
- A customer's own outstanding, overdue and on-account figures are exact
  ("LKR 4,750.00", not "LKR 5k").

**Server fixes this needed** (LHCP, committed, **not deployed**)

- **a6c98a18:**
  - A payment could be allocated to a credit note, including by "settle the
    oldest first".
  - Customers showed credit notes as money owed.
  - The tax report overstated Charged and Net.
  - Exchange rates were labelled the wrong way round. Anybody following the
    old label entered the rate inverted.
  - The web never showed a payment's transfer slips.
- **539e2fe4:** raising a credit or debit note **against an invoice** has
  failed with a server error since 2026-08-21, on the web and here.

Until those are deployed, production has these problems whichever app is
used.

**Tests**

- Unit: what can be refunded, the oldest-first plan (by due date, then id,
  to the cent), and why a profile will or will not run.
- End-to-end, against a local server (`tests/e2e/billing-2.mjs`, 21 checks,
  all passing):
  - money on account allocated oldest-first, then taken off;
  - a refund, and the receipt;
  - a credit note raised from an invoice and applied when issued;
  - a standalone debit note;
  - the customer owing invoice − credit + debit, to the cent;
  - a profile made, run (a draft), paused, resumed and removed;
  - every report;
  - a tax rate added and retired;
  - an exchange rate recorded the right way round;
  - a payment mode;
  - currencies and data access.
- The Billing part 1 and Orders end-to-end runs still pass.

---

## 2026-09-27 — 0.2.28: Billing (invoices), part 1

From the "Bill*" designs. **Invoices** now opens here, in the sidebar under
Business, instead of in the browser. The server's invoice links open the
invoice here too: `/billing?invoice=…` and `/billing/invoices/…`, from
notifications, shares and chat cards. What you may do follows the server's
Billing permissions:
- `billing.invoice` makes and edits drafts;
- `billing.issue` issues, records as sent and cancels;
- `billing.payment` records and removes payments;
- `billing.manage` stands in for all of them.

**Added**

- **The rail:**
  - a company picker when you work in several;
  - New invoice;
  - a search over invoices, credit notes, payments and customers;
  - Dashboard;
  - Invoices, with the overdue count;
  - "needs attention": drafts not yet issued, payments on account;
  - the sales flow: Quotes opens in CRM, and Deliveries and Sales returns
    in Sales & Orders.

  Payments, Credit notes, Recurring, Customers, Reports and Settings open in
  the browser for now, marked. That is part 2.
- **Dashboard:**
  - outstanding, overdue, billed and received this month;
  - drafts, unallocated payments, credit balance, recurring due;
  - how old the money is;
  - six months of billed against received;
  - recurring due, longest overdue, due in the next week, recent activity.

  An overdue or due invoice opens from the dashboard. Totals are in the base
  currency; each invoice in a list is in its own.
- **Invoices:**
  - search, status, "unpaid only" and sort;
  - the tallies by status;
  - pages of 50;
  - for those who may issue, the list's two bulk acts: record several as
    sent, and cancel several. Issuing is never done in bulk, on the server
    or here.
- **Open invoices are tabs** above the list, as the design draws them. Each
  is named by its number, or "Draft #id" until it is issued, and closes
  with its ×.
- **A draft:**
  - its lines (description, quantity, rate, discount, and the taxes on each
    line, chosen from a short list);
  - products found by name or code;
  - the discount on the invoice, the due date, notes and terms;
  - Save draft, Issue (numbered and frozen, after a warning) and Delete
    draft.
  - The totals, taxes and withholding are the server's, and say so when
    there are unsaved changes.
- **An issued invoice:**
  - its lines are read-only;
  - PDF, on the company's letterhead through the share service. Without
    `share.download`, it downloads the one Billing files in the Drive;
  - Record as sent ("How was it sent?"; this sends nothing);
  - Record payment, Duplicate, and Cancel invoice (with the reason, while
    nothing has been paid);
  - Settlement: the payments and credit notes against it, with Remove to
    take a payment off;
  - History.
- **New invoice:**
  - customer (searched), company when you work in several, type, date,
    payment terms (showing the due date), PO number, warehouse, sale agent
    (if you can see the staff list);
  - ship to, the lines, a discount as an amount or a percentage, notes and
    terms;
  - **Save as draft** or **Create invoice** (created and issued).
  - Bill to is not typed: when the invoice is issued, the server takes it
    from the customer's record.
- **Record a payment:**
  - on an invoice, allocated to it, in its currency and its company;
  - from the dashboard, a receipt for a customer, settling their oldest
    invoices or held on account;
  - method, date, bank account (if you can see Finance's), bank reference
    and a note.

  It records money that has already moved; it charges nothing.

**Not yet**

- Payments, credit and debit notes, recurring invoices, customers, reports
  and settings (part 2).
- Adding billable work (time, expenses, milestones) to a draft.
- The invoice's team, and a revenue account on each line.

**Server fix this needed** (LHCP 4214d4f1, committed, **not deployed**)

- An invoice did not say which company it was in. A payment recorded against
  it therefore went to a different company. A payment settles only its own
  company's invoices, so the money was held on account and the invoice
  stayed owing, for anybody who works in several companies.
- Until that is deployed, the desktop's payment on an invoice has the same
  limit as the web's.

**Tests**

- Unit:
  - who may do what;
  - status and method names;
  - a line's amount and the due date;
  - the ageing shares;
  - which lines are sent, and how;
  - the open tabs;
  - the server's links.
- End-to-end, against a local server (`tests/e2e/billing.mjs`, 19 checks, all
  passing):
  - the dashboard;
  - a new invoice with a product, a typed line and a tax, saved as a draft
    and opened as a tab;
  - the draft edited and saved;
  - issued and numbered, with its lines read-only;
  - recorded as sent;
  - a part payment recorded and removed;
  - duplicated, and the duplicate deleted;
  - cancelled with a reason;
  - bulk "mark as sent" and cancel;
  - a receipt held on account.
- The Orders end-to-end run still passes.

---

## 2026-09-27 — 0.2.27: Sales & Orders, part 2

From the "12 · Orders (OMS)" designs. The rest of Sales & Orders now opens
here instead of in the browser: Activity, Reports, Coupons, Approval rules,
Settings and My access. The rail leaves out a screen you lack the permission
for: Reports needs `oms.reports.view`, Coupons `oms.coupons.view`, and
Settings `oms.settings`.

**Added**

- **Activity:**
  - every change to every order, newest first;
  - a section per day on your own clock (the stamps are UTC, so an evening
    event stays on that evening);
  - search, and filters by kind and by person, each with its count;
  - pages of older events;
  - an order number opens the order;
  - it refreshes itself every minute.
- **Reports:** Summary, Sales performance, Order status, Payment, Order
  ageing, Returns and Coupon usage.
  - The window is a preset (this month, last week, this quarter, …) or your
    own dates, and is remembered on this computer.
  - The Summary has its eight figures, order value by currency, and the
    status and ageing bars, as the design draws it.
  - Sales performance groups by month, day, customer, salesperson,
    assignee, company, source, product, category, status, type or priority,
    with bars and the detail table. Months and days are written as words
    ("September 2026").
  - Money is never added across currencies: there is a row per currency, as
    the server gives it.
  - Each report ends with the server's own note on what its figures rest on.
  - **Export** downloads the server's CSV of the report (needs
    `oms.orders.export`). It goes through Transfers, as the order list's
    export does.
- **Coupons:**
  - the list shows code, name, what it takes off, minimum order, when it
    runs, how often it has been used, and its state;
  - the state is the server's, so an Active coupon whose end date has
    passed says Expired;
  - with `oms.coupons.manage`, you can add, edit and remove coupons;
  - a coupon that has been used keeps its code;
  - somebody in several companies says which company a new coupon is for.
    Only an administrator may make one for every company.
- **Approval rules:**
  - the rules in step order, each read as the server writes it ("Order
    total is more than 250,000 → needs oms.orders.approve · every
    company"), with "off" on a rule that is switched off;
  - with `oms.settings`, you can add, edit, switch off and remove rules;
  - what a rule can ask about, and how it compares, come from the server;
  - a rule can apply to one company;
  - removing a rule does not change orders already waiting on it.
- **Settings:**
  - General: the defaults a new order starts with, drawn from the server's
    own list of settings. The default warehouse is chosen from the
    warehouses by name.
  - Advanced, for those who may see it.
  - Sales Channels:
    - every kind of channel, set up or not, with its status;
    - add a channel, open it, Test it, and see its connection, mapping, sync
      and logs;
    - switch the shop's webhook orders on and off;
    - remove a channel;
    - a shop's **Sync now** runs here page by page, with the steps and
      progress, **Cancel**, and **Carry on** for a run that was cut off.
  - User Access, Screens & components, Organization, Notifications, History
    and Change log are the installation's settings screens, and open in the
    browser (marked).
- **My access:**
  - which companies you work in;
  - what the company picker narrows and what it does not, with the server's
    warning that a company is a filter, not a boundary;
  - Orders' permissions, granted or not.

**Changed**

- **New order starts from Orders' defaults:** the default priority, the
  default warehouse and the default currency. Anything you choose on the form
  still wins.
- **People → Settings** uses the same settings form as Orders (now shared).
  Nothing about it changes.

**Server fixes this needed** (LHCP, committed, **not deployed**)

- 624d7307: a channel added as "Not tied to one company" (the form's
  default) was saved, then missing from the list. Opening it said "There is
  no such channel."
- e7a9e9d0: the in-app CRM channel always showed "Error", and its Test was a
  server error. It counted customers by a `deleted_at` column that the
  `clients` table does not have.

Until those are deployed, both show on production as described.

**Tests**

- Unit: report windows (weeks from Monday, month lengths, leap years,
  quarters), activity grouped by the reader's day and never twice, event
  names, report periods in words, coupon worth, runs and uses, rule lines,
  channel tones and sync times.
- End-to-end, against a local server (`tests/e2e/sales-2.mjs`, 22 checks,
  all passing):
  - every screen opens from the rail;
  - Activity filters;
  - both reports draw, and Export answers;
  - a coupon and a rule are added, edited and removed;
  - settings save and New order starts from them;
  - a channel is added, tested (the log shows it) and removed;
  - My access lists the permissions.
  - Everything it makes is removed at the end.
- Also rerun and passing: the part 1 Orders run (12 checks), and the People
  admin run that saves an HR setting.

---

## 2026-09-27 — 0.2.26: Orders' dropdowns search

Every dropdown in Sales & Orders is now the app's own list, not the system
menu. The long ones (customer, company, warehouse, assignee, send to) have a
search box.

**Changed**

- **New order → Customer** searches as you type, by name, email or phone. The
  search runs on the server, so customers beyond the first page are found too.
  Each row shows the email and phone under the name. The one you picked stays
  shown even when a later search would not find it.
- **Company, Warehouse and Priority** on the New order form use the same list.
  Each warehouse shows its code beside its name.
- **The rest of Sales & Orders** uses the same list:
  - the order list's Source and Priority filters;
  - the bulk bar's Assign to, Move to and Priority to;
  - the order drawer's Assigned to and Send to;
  - the rail's company picker.

  The lists of people and companies can be searched.
- The dropdown (`Select`) can take its search from the caller (`onSearch`).
  When it does, it shows the caller's answers as given, "Searching…" while
  they load, and your own text when nothing matches.

**Fixed**

- **Scan units** on the New order form: the icon sat above the label. It now
  sits beside it, and the button keeps its height.

**Not changed**

- The date fields (delivery date, order date) are still the system's date
  picker. The app has no date picker of its own yet.

---

## 2026-09-27 — 0.2.25: Sales & Orders, part 1

From the "12 · Orders (OMS)" designs. Sales & Orders now opens here, in the
sidebar under Business, instead of in the browser. The server's order links
(`/oms?order=…`, in notifications and shares) open the order here too.

An order is Inventory's sales order. Inventory creates it, confirms it
(reserving the stock), delivers, invoices and cancels it. Orders adds
approval, the statuses in between, assignment, the timeline and the boards.
Each button here goes to whichever of the two does that thing properly.

**Added**

- **The rail**, as the design groups it:
  - Pending approval.
  - All orders, with each status still moving and those finished.
  - Fulfilment and Returns, each with its count.
  - A company picker when you work in several.
  - Activity, Reports, Coupons, Approval rules, Settings and My access open
    in the browser for now, marked. That is part 2.
- **Dashboard:**
  - Orders, still moving, open value and delivered or completed.
  - Open value is per currency; the server's single figure adds rupees to
    dollars.
  - Where the moving orders stand, what needs a person, the latest orders,
    and where orders come from.
- **All orders:**
  - Search, source, priority and "mine", with Load more.
  - Export: a CSV of exactly what the list shows.
  - Select orders to assign, move on, reprioritise or delete together. Each
    one that cannot be changed is named.
- **The order drawer:**
  - Overview: dates, type, salesperson, the assignee (changeable), the money
    and the payment as recorded.
  - Items: ordered, reserved, delivered and invoiced.
  - Approval: each step and who decided it.
  - Activity (the timeline) and Linked (deliveries and invoices).
  - Buttons for what you may do next: Submit for approval, Approve, Reject
    (with a reason), Confirm, Cancel order, and the later moves.
  - Copy, PDF, and Share by email, WhatsApp, a chat or a shareable link
    (live links can be withdrawn).
- **New order:**
  - A customer, the warehouse it ships from, dates, currency and priority.
  - A company, when you work in several.
  - Lines found by product name, code or barcode (a scanner's Enter adds
    the exact match), or **Scan units** one serial, QR or tag at a time. A
    unit that may not be sold says why.
  - A price left empty is the price list's. Totals are worked out by the
    server.
  - It makes a draft and reserves nothing.
- **Fulfilment:**
  - Waiting to be picked: raise a delivery note for everything still to go.
  - Ready to send: dispatch it, which cannot be undone, or cancel the note.
  - Out with the customer: confirm it was delivered.
- **Returns:** asked for, waiting for the goods, owed a credit, and settled.
  Approve, receive back and raise the credit note, each asked about first.
  Orders marked returned with no return document are flagged.

**Guarded**

- **Approval only through its own endpoints.** An approval state is never
  set by a plain status change, since the server's status endpoint let
  approval be skipped.
  - Only submit, approve and reject make those moves.
  - The bulk "move to…" offers only processing, ready, shipped, out for
    delivery and completed.
- **Confirming goes through Inventory**, which reserves the stock. It
  follows the order's own `confirm` from a server with the 2026-09-27 Orders
  fixes (LHCP 3c0f3881), and is disabled with the reason when an approval
  rule still applies.
- **Cancelling releases the reservation.** It goes through Orders on a
  fixed server, so the timeline says so, and through Inventory before that.

**Tests**

- `sales.test.ts`:
  - no approval move offered as a status change;
  - confirm and cancel sent where they belong, on an old server and a fixed
    one;
  - bulk statuses;
  - status names;
  - the server's order links.
- `tests/e2e/sales.mjs` (12 checks) makes its own warehouse, products,
  opening stock, customer and approval rule, then through the UI:
  - creates an order;
  - submits it, approved at once with no rule;
  - confirms it (stock reserved);
  - raises, dispatches and delivers it from Fulfilment;
  - approves a large order an approval rule holds, and rejects another with
    a reason;
  - sets priority on both;
  - downloads the PDF, and cancels one (reservation released).
  - It needs a user holding oms.*, inventory.* and crm.*; locally, the "E2E
    Orders" role. It leaves a delivered order and its fixtures behind.
- It found a server gap: the order drawer said "No customer" (LHCP
  19263308). `shell.mjs` still passes.

---

## 2026-09-27 — 0.2.24: notifications redrawn — the drawer, the center, the settings; uploads ask before replacing

From the design "WorkSuite Desktop — Notifications". Also in this release:
uploads ask before a file of the same name (the entry below).

**Added**

- **The bell opens a drawer.**
  - It shows what is new, in three sections: **Needs you**, **Today**,
    **Earlier**.
    - **Needs you** is unread and either a decision for you (a leave
      request, an expense or payroll approval, a review, a signature) or
      sent as urgent.
  - **All / Unread / Mentions / Approvals**, and an **Apps** menu with each
    app's count.
  - Each row shows its app, what happened, how long ago, and one button from
    its own link: **Join** a meeting, **Reply** in a conversation,
    **Review** a decision, **Open** anything else.
  - On hover: **mark read or unread**, **snooze** (1 hour, 3 hours,
    tomorrow 9:00, Monday 9:00), **dismiss** (to Done). Snooze and dismiss
    can be undone from the toast.
  - "N alike" when the server folded repeats into one.
  - **Do not disturb** in the footer stops this computer's banners and
    sounds until 8:00 tomorrow.
- **The notification center** (`/notifications`):
  - Views: **Inbox, Mentions, Approvals, Assigned to me, Snoozed, Done**.
    Each app has its unread count.
  - Search; **Mark all read**.
  - Select rows for **Mark read / unread, Snooze, Done** (or **Back to the
    inbox**). With one app selected, also **Mute on this computer**.
  - A **preview** of the one selected: all its text, and the record it is
    about as its live card (a task, deal, invoice…, read with your access).
    Its buttons, and where else it was sent ("also sent by email").
- **Notification settings** (`/notifications/settings`), the drawer's gear:
  - **A grid of every kind of notification by channel:**
    - **In app**, **This computer**, **Email**, **Browser push** and
      **System conversation**, where the server offers each.
    - Each column has a switch for the whole channel.
    - **This computer** mutes one kind's banners here only. The server's
      categories (Projects, Expenses, Security…) can now each be muted, not
      just the nine old app switches.
  - **Quiet hours:**
    - From, to and time zone.
    - What email and pushes do meanwhile (wait, stay in the bell only, or
      not be sent).
    - Whether urgent ones come through.
    - **Silence this computer too**, for the same hours.
  - **This computer:** banners, sound, what banners show, a **badge count
    on the app icon** (new; off clears the Dock and taskbar count), and a
    test notification.
  - Settings › Notifications now opens this screen.

**Not offered, because the server does not do it yet**

- **Actions the server can't take:** approving or rejecting from the
  notification itself, or marking a task done from it. No notification
  carries an action the server can run, so rows open the record instead.
- **Things notifications don't carry:** the sender's picture and the
  company a notification came from. These aren't on a notification.
- **Settings the server doesn't act on:** per-app daily or weekly digests,
  quiet hours by weekday, "group similar" and "hide duplicates" switches,
  mobile push and WhatsApp.

**Fixed**

- **Project and task alerts could not be muted.** The server calls them
  `projects` and the switch was `tasks`.
- The bell's count now leaves out snoozed notifications. This is the
  server's fix, live since 20:12 UTC 2026-09-26.

**Changed**

- The drawer and the center read the server's notification center
  (`/api/notifications/centre`), not the old list. The old list showed
  snoozed and archived notifications as if they were new.

**Tests**

- `notifications.test.ts`: sections, mentions, approvals and assignments,
  the row's button, snooze times.
- `tests/e2e/notifications.mjs`:
  - the drawer: sections, the count, snooze and Undo, dismiss and Undo, an
    app filter, Do not disturb;
  - the center: every view, the preview, selection;
  - settings: a category muted on this computer.
- `tests/e2e/upload-conflict.mjs`: Replace, Keep both, Skip.

---

## 2026-09-27 — Uploads ask before a file of the same name (ships in 0.2.24)

**Added**

- **Uploading a file whose name is already in the folder asks first:**
  **Replace**, **Keep both** or **Skip**, with **Cancel upload** for the
  whole lot. This covers the Upload button, files dropped on a folder or the
  list, and `/files?upload=1`.
  - **Replace:** the upload becomes the file's new version. The one there
    now stays in its version history, and the file keeps its shares and
    comments. It is offered only for a file you may change; otherwise
    that file can only be kept alongside.
  - **Keep both:** the upload is saved under the next free name the server
    gives, `name (1).ext`, `name (2).ext`…
  - **Skip:** that file is not uploaded.
  - One question per clash, with "Do the same for the other N files" when
    more are waiting. Names compare without regard to case.
  - Files inside a dropped or chosen folder are not asked about: they land
    in folders of their own.
- Needs the server's `POST /api/uploads/conflicts` and `replace_file_id`
  (LHCP 9a7159e1). Against a server without them nothing is asked, and
  uploads go as before.
  - A Replace sent to a server that does not confirm it (`init` answers
    `replaces`) stops before any bytes go. It never quietly adds a second
    file of the same name.

**Changed**

- The upload target for Files takes an optional `replaceFileId` and `name`.
  Both are kept with the transfer, so a paused or resumed upload still
  replaces, or still uses its new name.

**Tests**

- A local check drops a real file on My Drive through the DevTools protocol
  and answers Replace (version 2 of the same file), Keep both
  (`name (1).txt`) and Skip (nothing uploaded). `files.mjs` still passes.

---

## 2026-09-27 — 0.2.23: records shared in chat show as cards; the HR dashboard stays in the app

**Added**

- **A WorkSuite record named in a message shows as a card**, in the chat
  drawer and on the Chat page. This covers a task, note, calendar event,
  contact, meeting, Meet link, CRM deal, lead or account, invoice, or Drive
  file or folder, from the design "Chat — shared items as cards".
  - Each card is read with the reader's own access, from the endpoint that
    record's own screen uses. So one person can see what another cannot:
    - a record you cannot see, or one deleted since, says "You can't open
      this" instead of its title;
    - a missing module permission says "You don't have access".
  - The line that was only the record's address is hidden under its card.
    An address inside a sentence is left in the sentence.
  - At most four cards per message.
- **Meet cards** read the meeting's public facts (`/api/meet/{uuid}/public`):
  title, host, locked, needs a passcode, ended. They never read
  `/api/meet/{uuid}`, which creates a chat room and mints a join token for
  whoever asks. That endpoint cannot tell who is in the call right now, so a
  card never says "Live now".
- **Share from WorkSuite**: a **+** beside the paperclip in every message
  box.
  - It lists Drive, meetings, notes, tasks, calendar events, the CRM,
    invoices and contacts, plus "Upload from computer".
  - The picker searches each kind with that module's own list, shows the
    card as it will look, and sends the record's address. Each reader's app
    draws the card.
  - Drive still goes through its own picker, which first checks that
    everybody in the conversation can open the file.
- **A WorkSuite link typed or pasted into the message box** shows "Link
  detected · will show as a card" above it.
- **HR › Departments is drawn here**, instead of opening Organization in the
  browser.
  - The tree of departments with code, manager and headcount, for this
    company and those no company was ever set on.
  - `directory.manage` adds, edits (name, code, parent, manager) and deletes
    them. The server refuses to delete one that still has people or
    sub-departments, and its reason is shown.
  - A department is never offered as its own parent, or as the parent of
    anything above it.
  - Shown only to people with `directory.view`.

**Fixed**

- **The HR dashboard's links opened the browser.** Each now opens here:
  - **Add employee** opens the Directory with the form open;
  - **Departments** opens the new screen;
  - **Missing check-outs** opens its screen;
  - an **onboarding row** opens that person's onboarding;
  - **Manage** beside the holidays opens Settings on Public holidays.
- **Cards and other wide content no longer overflow the chat drawer.** A
  bubble holding a card takes the card's width and gives it up in a narrow
  column, instead of being pushed off the left edge.
- **Departments whose parents loop, or that name themselves as parent, are
  listed** at the top level. The server's data can hold such a loop. Rows
  are indented by where they are drawn, not by the server's depth, which
  counts up the loop.

**Tests**

- `record-links.test.ts`: which addresses name which records, and that
  every address the picker sends reads back as the same record.
- `hr-departments.test.ts`: the department tree.
- `hr-admin-2.mjs`: the dashboard's links, and a department added, coded
  and deleted. The run removes any department it leaves behind.
- A local check of the cards in the drawer, light and dark, and of sharing
  a task through the picker.

---

## 2026-09-27 — Packaging: a Linux .deb

**Added**

- **`worksuite_<version>_amd64.deb`** for Ubuntu and Debian, from 0.2.22 on.
  electron-builder's deb target runs fpm, which needs GNU tar, and this Mac
  has only bsdtar. So `build/make-deb.py` packs the same Linux build the
  AppImage uses, laid out as electron-builder's deb would lay it out:
  - the app in `/opt/WorkSuite`, and a `worksuite` command (through
    update-alternatives where there is one);
  - a menu entry that also handles `worksuite://` links and `.worksuite`
    references, and icons at every size;
  - `chrome-sandbox` made SUID only where user namespaces don't work;
  - the AppArmor profile Ubuntu 24.04 needs before Electron's sandbox will
    start.

  Its dependencies accept both the old library names and 24.04's `t64`
  ones. Removing the package takes the command and the AppArmor profile
  with it. It is built from a clean checkout of the release commit, not
  from the working tree.

---

## 2026-09-27 — 0.2.22: CRM, part 2 — accounts, quotes, the price list, lead intake, settings

**Added**

- **CRM is now fully drawn by the desktop.** Accounts, Quotes, Price list,
  Lead intake, Settings and My access open here instead of in the browser.
  Searching the CRM for an account opens it here too.
  - **Accounts:**
    - the list, filtered by type or to your own, with health, owner,
      contacts, open deals, open value and last activity;
    - an account opens as a customer overview. It has tiles for open
      deals, won, projects and meetings, its details and contacts, and
      its deals, quotes, projects and meetings, each opening where it
      lives;
    - a timeline with a box for a note on the customer's file;
    - type, health and owner are set from the drawer. Health is "set by a
      person, not guessed".
    - New account (names must be unique), and Add a contact, optionally
      as the main contact.
  - **Quotes:**
    - the list with what is out in each status;
    - a draft opens in the editor: lines from the price list or typed,
      quantity, rate, discount and tax per line, a discount on the whole,
      and notes and terms;
    - totals are worked out as the server works them out, while typing;
    - PDF saves to your downloads (and to your Drive, as the server does);
    - Mark as sent records how it went and fixes the figures;
    - a sent quote is read-only, with Accepted, Declined and Revise.
      Revise makes a new draft and marks the old quote expired, which the
      dialog says, "even though it was accepted" where it was.
    - A draft can be deleted.
  - **Price list:** products with code, kind, price, tax and unit. New,
    Edit, Retire ("it comes out of the picker; quotes that already use it
    keep their lines") and Bring back.
  - **Lead intake:**
    - web-form sources, each with its own address to copy;
    - Change gives a source a new address (the old one stops at once);
    - Remove stops it taking anything new;
    - field mappings for forms that use other names;
    - who gets its leads, and whether it is accepting;
    - Deliveries shows what each post was judged to be, with what arrived;
    - Import a spreadsheet: a CSV previewed first (new, already here,
      refused, line by line), then imported.
  - **Settings:** quote prefix and padding, default currency, how long a
    quote is valid, when a deal counts as stalled, and the company details
    and terms printed on quotes. They are the installation's; read-only
    without CRM settings.
  - **My access:** each CRM right, and whether it is granted directly or
    through Manage CRM.
- `tests/e2e/crm.mjs` covers all of it (30 checks):
  - accounts: new, health, a contact, a note;
  - a quote: a price-list line, the totals the server makes, sent, revised;
  - the price list: a product added and retired;
  - lead intake: a source that a form posts a lead to, and its delivery log;
  - settings.

  The follow-up step no longer depends on the time of day: a follow-up for
  tomorrow is "To come" just after midnight.

---

## 2026-09-26 — 0.2.21: calls and meetings, redrawn around the shared screen

**Changed**

- **One call surface for video calls and meetings** (CallWorkspace), laid out
  by a single set of rules (`calls/ui/layout.ts`) instead of each screen
  deciding for itself.
  - **A shared screen is the main view, and the camera stays.** Before, a
    screen share replaced the other person's video. Now their camera sits
    in a picture-in-picture box, with your own small view inside it.
    - Drag the box anywhere; it settles in the nearest corner.
    - Resize it from its inner corner; the size and corner are remembered.
    - It keeps clear of the controls.
    - Hide it, and a chip brings it back.
  - **The screen is never cropped.** It uses object-fit: contain, centred
    on a dark stage. Cameras fill their tiles, with a Fit/Fill choice under
    More.
  - **Layouts** (the grid button): Auto, Focus, Side by side and Grid.
    - While something is shared: Focus puts people in the corner, Side by
      side puts them in a column, and Grid puts them in a strip under the
      screen.
    - Otherwise: the speaker large with you in the corner for two people, a
      grid for three to nine, and the speaker with a strip for more.
    - The strip scrolls sideways and folds away.
  - **One compact control bar** floats over the stage: mic, sound, camera,
    share, chat, layout, more, and hang up. It fades when the mouse is still
    and stays while you use it.
  - **Sharing has its own menu:**
    - Share something else (switch without stopping);
    - Pause sharing (the others see "Screen sharing paused");
    - Stop sharing.

    A line above the bar says what you are sharing. On Windows you can share
    the computer's sound too.
  - **The panel sits beside the stage, not over it:** Conversation for a
    call; People, Chat, Board, Files and Info for a meeting.
    - Drag its edge to resize it (320–600 px, remembered).
    - In a narrow window it lies over the call instead.
    - Opening it only resizes the stage; the call is not touched.
  - **Full screen** (header button, F11) takes the whole call surface, panel
    and controls included. Esc or the button leaves it, and the panel,
    layout and corner video are as they were.
  - **The header** has Keep on top, Shrink to a floating window, Maximise
    and Full screen.
  - **The floating window is a card** (380 × 250) that stays on top of other
    apps. It shows the shared screen with the speaker in its corner, or the
    speaker, with mute, camera, chat, back to the call and hang up.
  - **View options** under More: show or hide your own video, mirror it,
    Fit or Fill, and the corner video.
- **A voice call becomes the call surface when a picture appears.** That
  means a camera or a shared screen on either side. Its narrow window grows
  to a video call's size. Before, it stayed the voice design, with a small
  picture on top and six big buttons under it.
- **The meeting's whiteboard can go on the main stage.** Use On stage in
  the Board panel, or More → Whiteboard on stage. People stay in the
  corner, and Full screen makes the board fill the screen. The board now
  redraws whenever it is resized.

**Added**

- **"In a meeting · Design review · 12:04" in the main window's title
  bar**, for any call or meeting going on in another window. One click
  brings that window back: out of the floating card, out of the Dock or
  taskbar, and in front. Meetings now report themselves to the app the way
  calls did. Closing a meeting's window does not post a call hang-up for
  it.
- `tests/e2e/call-layout.mjs` checks the layout in a real window without a
  media server. It uses a test-only preview (`/calls/preview`) that shows
  only in unpackaged runs started with `WS_E2E_FAKE_MEDIA`, with made-up
  people and a canvas for the shared screen. It covers: the shared screen
  with the corner video and chat, the layouts, full screen with the panel
  inside it, the floating card and back, a grid, the speaker, the board on
  stage, a paused share, and the main window's pill. The layout rules have
  unit tests.

Not yet: the AI tab in the panel, and remote control. The layout keeps room
for remote control (Meet ENH-01), but it has no controls yet.

---

## 2026-09-26 — 0.2.20: links in chat open, and the HR pickers leave out leavers

**Fixed**

- **Addresses in chat messages are links now.** A meeting invitation's
  "Join: https://…/meet/<id>" was plain text that could only be copied.
  - A meeting link opens that meeting's window here. That covers this
    server, and app.worksuite.lk, where the server's own invitations point.
  - Any other address on this server opens in its tab, or in the browser
    for an app the desktop does not draw yet.
  - Anything else goes to the browser; a site the app doesn't know asks
    first.
  - Full stops and brackets at the end of a sentence stay outside the link.
  - This covers the chat drawer, the Chat page and the meeting's own chat.
- **People who have left are no longer offered in the HR pickers.** This
  covers leave on someone's behalf, Reports to, schedule assignment and
  onboarding. The desktop used to count a leaver with no exit date as still
  here, unlike the server, which counts them as gone from every day. It now
  uses the server's rule, and pickers also leave out archived records. The
  other pickers (chat, tasks, calendar, notes, Drive sharing, meetings, CRM
  owners) get the same rule from the server. It takes effect once that is
  deployed.

---

## 2026-09-26 — 0.2.19: Enter in dialogs, and the chat drawer on dark

**Fixed**

- **Enter creates the folder.** A dialog took focus back from its own field
  every time the screen behind it redrew. After that, typing went nowhere and
  Enter reached the dialog, not the name box. Dialogs now take focus only
  once, when they open, and leave it with a field that already has it. The
  New folder name is focused as soon as the dialog opens, and Enter creates
  it. This holds for every dialog, not only Files.
- **The chat drawer on dark:**
  - The wallpaper sits a step below the surface colour, so bubbles, the day
    chip, the call pill and the record banner stand off it.
  - The other person's bubbles are a shade lighter than the wallpaper.
  - Inside your own bubbles the accents go pale, so they stay readable on
    indigo: the record link ("Open folder"), the reply quote, the file's
    Open, and the waveform of a voice note.
  - A record card in your own bubble is set into it, not a dark hole in it.
  - "Shared a folder from Drive" and "Open folder" no longer run together.
  - The read ticks are a lighter blue on dark.
  - A voice note that has not been played no longer shows its first bar lit.
  - The attach menu's coloured tiles have dark versions.

---

## 2026-09-26 — 0.2.18: CRM, part 1 — dashboard, leads, follow-ups and the pipeline

**Added**

- **CRM is drawn by the desktop now**, replacing the read-only lead list.
  - **The rail** has New lead, Search the CRM (leads, accounts, contacts,
    deals), and the sections with their counts: open deals, new leads, and
    late follow-ups in red. It also shows today's tasks and meetings, and My
    access. Accounts, Quotes, Price list, Lead intake, Settings and My access
    still open in the browser (part 2).
  - **Dashboard:** my pipeline or the team's.
    - Eight figures: open deals, weighted forecast, won this month, win
      rate, new leads, tasks and meetings today, stalled deals.
    - Panels: pipeline by stage, leads by status, follow-ups, stalled deals,
      quotes out, who is carrying the pipeline, lead sources, where leads
      arrive, and recent activity.
  - **Leads:**
    - The working views (Late, Due today, Nothing scheduled, Unassigned)
      with counts.
    - Filters by status, rating and owner (mine or nobody's — the server
      cannot filter by one named person); sorting; bulk reassign.
    - A lead opens in a drawer, always read afresh:
      - contact and qualification;
      - why it scored what it did;
      - possible duplicates, with Merge;
      - status (unqualified asks why) and owner;
      - notes;
      - the next follow-up, and **Schedule a follow-up** (kind, day, time,
        what for, priority, reminder);
      - the timeline, with a call, note, email, meeting or WhatsApp
        recorded on it.
    - **Convert** makes an account, a contact and, if wanted, a deal. The
      converted lead is read-only and links to its deal.
    - **New lead** asks which company files it when you work in several and
      "All organizations" is showing.
  - **Follow-ups:**
    - Due today, Late, To come, Done and Called off; mine, or everybody's
      for whoever may see them.
    - **How did it go?** records the outcome and can set the next one.
    - **Move**, and **Call it off** with a reason.
    - Times are on the clock the follow-up was agreed in.
  - **Pipeline board:**
    - Deals in stage columns, with value, owner, expected close and "Nd in
      stage".
    - **Drag a card** to move it. Into Lost asks why, which is recorded on
      the deal and the customer's timeline.
    - A deal opens in a drawer: value, stage and weighted figures, a stage
      control, details, its quotes, and the timeline with a note recorded.
    - **New deal.**
- **Buttons follow CRM permissions:** `crm.lead`, `crm.deal`, `crm.manage`
  (merge and bulk reassign), and the follow-up permissions, including
  `crm.manage` covering everything but `crm.view`.

**Notes**

- Moving a follow-up rebuilds its reminders from what is sent, so the app
  sends a 30-minute one; the web sends none and loses them.
- e2e: `tests/e2e/crm.mjs` (18 checks). It needs a CRM role on the test
  user and cleans up everything it names "E2E CRM …".

---

## 2026-09-26 — 0.2.17: Completed shows the completed hire

**Fixed**

- **HR › Onboarding › Completed showed the wrong person.** The case you
  last had open under In progress stayed on screen beside the Completed
  list — an in-progress hire with no documents, next to a list of finished
  ones. Changing the filter now opens that filter's first hire. A link to
  one hire (from a notification) still opens that hire.

---

## 2026-09-26 — 0.2.16: the organisation switcher in the sidebar, onboarding redrawn, the Dock count fixed

**Changed**

- **The organisation you are working in is now at the top of the
  sidebar**, as a card with its tile, its name and "Organization · 1 of 2"
  (or "All organizations · 2 organizations"). The title bar keeps search.
  Click the card to open the switcher under it. With the sidebar collapsed,
  the card is the first icon, with a count, and the switcher opens beside
  it. The switcher has:
  - "Find an organization";
  - **All organizations** ("Everything you can see, across both");
  - each company with **your role in it** and a tick on the current one;
  - **shortcuts**: ⌃0 for All organizations and ⌃1–⌃9 for the list on
    macOS; Ctrl+Alt+0–9 on Windows and Linux, where Ctrl+1–9 already switch
    tabs;
  - arrow keys and Enter;
  - for whoever manages the directory: **Manage organizations** (opens the
    Directory in the browser) and **Create an organization** (a name, and
    optionally a legal name and country, with your time zone; the app
    switches to it when you are a member).
- **HR › Onboarding redrawn:**
  - With nobody chosen, the first hire is shown.
  - The case lays itself out by the room it has: beside the list on a
    laptop the steps take the full width, with documents and bank details
    below; on a wide screen they sit side by side.
  - A step's reason ("Still needs date of birth, phone number, …") is no
    longer cut off.
  - Every step has the action that fixes it: Edit details, Open profile,
    Open, Add, Mark as done, Mark….
  - **Continue onboarding** runs the next step's action.
  - The header card shows the hire, their employment type and joining date.
  - "Still outstanding" is gone: the steps already said it.
- **HR › My onboarding**: a welcome header with your joining date,
  progress and next step; a layout that fits the window; and proper
  messages when you are not being onboarded.

**Fixed**

- **The Dock icon showed "99+".** It added every unread email in every
  inbox you can open, shared mailboxes included. The badge on the Dock,
  the taskbar and the tray now counts what needs you: unread chat and
  unread notifications, the two red counts on the title bar. The Mail count
  stays in the sidebar and the tray menu.
- **Your picture in the title bar** is now 32 px with a thin indigo edge, as
  designed, instead of sitting inside a heavy grey ring that made it look
  bigger than the buttons beside it.
- A lint error in the 0.2.15 account e2e test (an unused helper).

**Notes**

- **Roles in the switcher need the server's LHCP f0a593a7** (the desktop
  bootstrap now includes `role`), which is not yet deployed. Until then
  each company says "Member".
- The shell e2e's break step fails after about 20:30 Colombo time: the
  server treats a clock-in after the shift's end plus grace as a missing
  check-out. That is a server rule and is logged as a separate task.

---

## 2026-09-26 — 0.2.15: My account, and your real picture in the title bar

**Added**

- **My account** — open it from your picture in the title bar, or "My
  account" in the command palette. Every screen works against the same
  server endpoints as the web, so the two always agree.
  - **Your picture instead of your initials**, in the title bar, the account
    menu and every account screen. It follows changes made on the web.
  - **The account menu** shows how you appear to others (Online, Busy, Do
    not disturb, Away, Appear offline — with the Chat app) and when you
    clocked in (with HR). It has My account's sections, this computer's
    Settings, Help, Lock and Sign out. The Security row says whether
    two-factor is on.
  - **My profile**: your picture, name, job and company, local time, how to
    reach you, and what your organisation set. With HR you also see your
    working hours and who you report to. A checklist shows what is still
    missing (picture, phone, two-factor, passkey), and a security summary.
  - **Profile settings**:
    - your name and phone, which you can change;
    - your time zone;
    - who sees your picture;
    - email, company, department and job title, shown read-only with who
      changes them.
  - **Profile pictures**:
    - upload a photo, then move, zoom or rotate it in a round frame before
      it is saved;
    - or make an avatar (initials, abstract or illustrated, ten
      backgrounds, skin tones, a border);
    - earlier photos and avatars can be used again, saved as a copy,
      changed (avatars) or deleted;
    - choose who sees your picture;
    - a picture waiting for an administrator's approval says so, and can
      be withdrawn.
  - **Security**:
    - **Two-factor**: turn it on by scanning a QR code or typing the key,
      entering the code, and saving the ten backup codes (as a file or by
      copying); make new codes; turn it off with your password.
    - **Passkeys**: rename or revoke them. A passkey is still *added* in
      the browser (the button opens it), because it belongs to WorkSuite's
      web address.
    - **Where you're signed in**, with this computer marked. Sign one
      device out, or all the others.
    - **Recent sign-ins**, including failed attempts on your address. The
      rail shows a count when there were failed attempts this week.
  - **Changing your password keeps this computer signed in.** The server
    signs out every session, this one included, so the app signs straight
    back in with the new password. With two-factor on, it asks for the code
    first.
  - **Preferences**: time zone, whether it is detected automatically,
    language, date and time format, first day of the week (the company's
    or your own), plus theme, density and read receipts.
  - **Notifications**: the account's own settings, which apply on every
    device — on/off, sound, email and in-app, quiet hours with their time
    zone, which kinds reach you by which channel, and chat alerts and Do
    not disturb. The whole set is saved on every change, because the
    server replaces it.
  - **My access**: which modules you can open and why, and which
    permissions you hold.
- Web links to `/account/settings?tab=…`, `/account/security` and
  `/account/access` open here. Settings' Security, Notifications and time
  zone rows point to My account.

**Changed**

- **The API proxy now filters `/api/auth` by method**, so the renderer can
  manage your own two-factor, passkeys and sessions:
  - still refused: answering a sign-in (`POST /auth/mfa`), exchanging a
    passkey code, ending every session at once, and changing the password;
  - password changes go through the main process (`auth:changePassword`).
  - The tests list every allowed and refused call.

**Notes**

- **Needs the server's `GET /api/auth/sign-ins`** (LHCP 36660ea1, not yet
  deployed) for Recent sign-ins and "password changed … ago". Until it is
  deployed, those two parts are simply not shown.
- New IPC channels:
  - `auth:sessionId` — this app's session, from the token's `sid`;
  - `auth:changePassword`, `auth:renewMfa` and `auth:renewCancel`;
  - `files:saveText` — save a short text file through a save dialog.
  - `transfers:download` also takes `picture`, one of your profile
    pictures.
- **Session revocation is immediate** on the server. Between a password
  change and the new session, the app holds token refreshes, so a request
  made in that gap waits instead of signing the app out.
- **Fixed before release**: pasting a whole six-digit code submitted
  before the code had registered.

---

## 2026-09-26 — 0.2.14: the unread count shows on the Dock icon

**Fixed**

- **The Dock icon now shows the unread count** (unread chat, mail and
  notifications, the same count as the menu-bar icon). The app has always
  set it: macOS reported the Dock label as "99+". But macOS draws an app's
  Dock badge only when the app is registered for notifications, and an
  unsigned (ad-hoc) build never is — WorkSuite had no entry in System
  Settings → Notifications at all. So on macOS the count is now painted onto
  the icon itself, in the system badge's red pill ("7", "42", "99+"), and
  the plain icon comes back when nothing is unread.
- The same cause very likely stops native notification banners on macOS.
  Both come back properly once the app is signed with a Developer ID
  certificate, which is still to be set up.

**Notes**

- New IPC `app:setDockIcon` (a PNG data URL, macOS only). The renderer
  paints the badge (`src/core/dock-badge.ts`) and repaints only when the
  count changes. `app.setBadgeCount()` is still used on Windows and Linux.

---

## 2026-09-26 — 0.2.13: HR, part 2b — onboarding, leaving, schedules and settings; one searchable dropdown everywhere; dark mode fixed

**Added**

- **Every HR screen is now drawn on the desktop.** Only Departments still
  opens in the browser, because it belongs to Organization.
- **Onboarding** (`hr.onboarding.manage`): new hires with how far each has
  got and what is next, and one hire's steps, required documents and bank
  details.
  - **New employee** starts an onboarding: the person, the job, the manager,
    the schedule, and a login now or later.
  - Record the two steps HR ticks by hand ("Mark as done"). "Mark…" marks
    any step as blocked, as not applicable, or clears the mark, with a
    reason.
  - Approve or reject a required document (rejecting says why), or upload
    it on their behalf.
  - **Activate** once nothing is left; if something is, the reasons are
    shown in full. Edit details and Cancel onboarding sit beside it.
- **My onboarding**: where I am, the documents HR needs from me, my own
  details (saved field by field, as the server takes them), my documents
  and my bank details.
- **Resignations** (`hr.resignation.view`, or anyone the approval chain
  asks):
  - The requests, filtered by where they stand.
  - One request in full: the reason, the letter (opens it), the terms
    accepted, the approval chain with who is being waited on, the notice
    rule, the offboarding it started, and its events.
  - Whoever the chain is waiting on can approve (perhaps on a different
    last day), return it for changes, or decline. HR can move an approved
    last working day.
- **My resignation**:
  - Start one as a draft. Nothing is sent until you submit, having read and
    accepted the current terms.
  - Attach a letter, or have one written from your answers. Ask for early
    release where the rule allows it.
  - Once sent, follow the approval chain and withdraw it (after approval,
    withdrawing becomes a request of its own).
- **Offboarding** (`hr.offboarding.view`): everyone leaving, and one case.
  - Each department's progress and sign-off (or reopen).
  - The checklist: attach evidence, record an asset's return and its
    condition, mark done, waive with a reason, undo, add an item.
  - Their login: hold it on, release the hold, or switch it off now.
  - The exit interview's answers, and HR's private notes.
  - **Handover**: write items to colleagues, send them, and move the
    leaver's open work to someone in one go.
  - **Complete offboarding** says what is still in the way if it cannot.
  - Every action follows the case's own flags, so department sign-offs work
    for the people each department names.
- **Work schedules** (`hr.schedule.manage`):
  - Create and edit patterns: working days and hours (a night shift is shown
    as running past midnight), breaks, the grace rules, and the day the
    hours start.
  - A start day already passed asks before changing days already worked.
  - Assign a schedule to employees or departments, end an assignment, and
    read a schedule's history.
  - Duplicate, set as default, deactivate, reactivate or delete.
- **Settings**:
  - **General** is drawn from the server's own list of fields, so a new
    setting appears here without a desktop release. Unsaved changes are
    marked, and field errors show under their field.
  - **Leave types**: add, edit, archive and restore.
  - **Public holidays**: by year, add and remove.
  - **Devices** (the device settings) for `hr.device.manage`.
  - Resignation rules and offboarding checklists stay in the browser for
    now. There is a link to them.
- **Announcements** (`hr.announcement.view`):
  - Write a draft for a company. Your line breaks are kept and your text is
    escaped.
  - Sending says in words who it goes to.
  - See who has read and acknowledged it, and delete it.
- **Devices** (`hr.device.manage`):
  - Terminals with online, offline, punches-today and unidentified counts.
  - Add one and see its key once. Approve a waiting one.
  - Setup: the address to type into it, and its location, punch rule,
    allowed addresses, clock and HTTPS.
  - People: map enrolment ids to people. Also Punches, Commands (send one)
    and the Raw log.
- Notification links to a resignation or an offboarding case open it here,
  even for someone without the list (an approver, a department's clearer).
  Waiting on me opens them here too.

**Changed**

- **One dropdown for the whole app.** Every native select is gone —
  124 across 49 screens (Mail, Chat, Calendar, Tasks, Notes, Files,
  Meetings, Meet, Contacts, Settings and HR) — and so is the old `Select`
  wrapper. They are all the same component now (`components/Select`):
  - It looks the same everywhere: a rounded field with a chevron, and a
    floating list with a check mark on the choice, grouped options, and
    the placeholder dimmed.
  - A list longer than six options has a **search box**. It narrows as you
    type, ignoring case and accents, and says when nothing matches.
  - Shorter lists answer to type-ahead: press a letter to pick.
  - Arrow keys, Home/End, Enter and Escape work. Escape closes only the
    list, not the dialog around it.
  - The list never gets cut off by a panel or a dialog. It opens upward
    when there is no room below, and follows the field on scroll.
  - A dropdown in a toolbar keeps the compact size, one on the file
    viewers keeps the dark look, and a filter that is set stays
    highlighted.

**Fixed — dark mode**

- **Native pickers follow the theme.** Date and time pickers and native
  scrollbars opened light grey in dark mode, because the theme never set
  CSS `color-scheme`. They are dark now, and so are the calendar and clock
  icons inside date and time fields.
- **Floating panels have an edge.** The app launcher, search, the
  attendance popover, dialogs, drawers and dropdown lists had only a navy
  shadow and a navy hairline, both invisible on the dark ground. Panels
  blended into the page, and rounded corners looked square. Shadows are now
  black in dark mode, and every floating panel has a pale hairline
  (`--ws-edge`). 57 shadows across 25 files use the themed colour.
- **Cards inside a panel are no longer black holes.** Cards set into a
  panel used the page colour, which in dark mode is darker than the panel:
  the launcher's selected tile was a black box, and search's Create cards
  and tip, the attendance tiles and the popover footer looked cut out. They
  use a new "well" colour (`--ws-well`): a shade below the panel in light,
  a shade above it in dark. The launcher's selected tile is a soft blue.
- **Colours that come with the data stay readable.**
  - Calendar events, their titles in the Today list, the app name in the
    search preview and chat sender names were drawn in their own colour. A
    deep indigo could not be read on the dark grid.
  - In dark mode they are mixed towards white, and an event's tint is
    stronger.
  - Avatar initials, file badges and the search highlight have dark
    colours of their own.
  - Danger and success boxes (calendar, chat, HR, the Decline button,
    notes) no longer have pale pink or green borders on dark.

**Fixed**

- **Task dates.**
  - The date field shrank to a sliver whenever a time was shown beside it:
    the time field's width lost to a shared `w-full`, so it took the whole
    row.
  - In the task's details the date and time now stack, date on top.
  - In New task the start and due dates have a row of their own, half each,
    so a whole date fits beside its time.

**Notes**

- `transfers:download` gained resignation letters (`hrLetter`, by id, or
  `mine`).
- New e2e `tests/e2e/hr-admin-2.mjs` (29 checks) covers onboarding,
  resignations, offboarding, schedules, settings, leave types, holidays,
  announcements and devices. It also checks the dropdown's search and
  keyboard on a live screen. It removes what it makes.
- Every suite that drove a native select now picks through the dropdown
  (`choose` / `chooseIn` in the harness).
- Found on the way, not changed here: the server names people only from
  their login, so a new hire started without one shows as "Employee
  EMP-…" in lists even though HR typed their name. It is flagged as its
  own task.

---

## 2026-09-26 — 0.2.12: HR, part 2a — the Directory, profiles and the time screens

**Added**

- **Directory** (HR staff, `hr.view`): everyone whose record you may open,
  searchable by name or number, with Current, Left and Everyone.
  - A row opens a drawer: employment facts, the login behind the record
    (link a login that has no record yet, or unlink), this year's leave
    balance and leave history.
  - **Add employee** (`hr.manage`) creates a bare record: a number (blank
    takes the next one), a login, the kind of employment, a status and a
    manager. It opens the new profile.
- **An employee's profile**, with the design's thirteen tabs, each shown
  only when the server says you may see that section:
  - Overview, Personal, Employment (with their working hours and who reports
    to them), Organizations (set a staff number, make a company the
    default), Attendance (month by month, with Correct on a day), Timesheet
    (their weeks, and what each logged), Leave (balances by year),
    Documents (their file; HR also chooses who may see what it adds), Bank,
    Requests (approve, decline or withdraw where allowed), Notes (HR only,
    manager and HR, or shared), Security and Activity.
  - **Edit** changes employment, personal, emergency-contact and address
    details in one form, with a reason recorded against each field. Only
    fields you changed are sent, so an untouched date is never cleared.
  - **Manage** a leave balance: entitled, carried in and used — or set what
    is available and the entitlement follows. "Count used days again"
    recounts from the approved requests.
  - **Bank**: the account is masked. "Show the full number" needs
    `hr.bank.view` and is logged (the list of who looked is shown).
    "Change" clears the verification, and somebody other than whoever typed
    the number has to verify it.
  - Email, Chat, User account (opens in the browser) and New request sit in
    the header.
- **Team attendance** (`hr.manage`): one day for everyone you may see —
  in, out, break, net, where it was worked and the status — with the day's
  counts (click one to filter), the web's fifteen filters, and **Correct**
  on every row. It refreshes every minute.
- **Missing check-outs** (`hr.manage`): days somebody checked in and never
  checked out, how long each has waited, its review state and whether it
  holds pay, with "Record the time".
- **Timesheet approvals** (anyone who reviews timesheets): the weeks people
  submitted — View what was logged, Approve, or Send back with what needs
  changing.
- **Reports**: attendance over any period — the totals, a line per
  employee and the days the chosen kind keeps (late, early, overtime,
  absence, missing check-outs, remote). **Export CSV** saves it to
  Downloads.
- **Work pattern**: your own attendance, leave and expense score with how it
  was worked out, and your team's for `hr.kpi.view`. A score the server
  withholds says why instead of showing a number.
- **My access**: whose records you can open and why, and every HR
  permission — held, held only through `hr.manage`, or not held.
- A web link to a profile (`/hr/employees/12`) opens that profile here.

**Changed**

- Only Onboarding, Resignations, Offboarding, Work schedules, Settings,
  Devices, Announcements, My onboarding and My resignation still open in
  the browser. Departments stays there too (it belongs to Organization).
- The rail now shows **Timesheet approvals** to line managers who review
  their reports' weeks even without `hr.view`; before, it asked the server
  only for HR staff.

**Fixed**

- "Non-working day" and similar neutral states no longer show in the
  "working" blue.

**Notes**

- `transfers:download` gained an employee's HR document (`hrEmployee`) and
  the attendance report CSV (`hrReport`, with the type, dates and
  department validated).
- `tests/e2e/hr-admin.mjs` (32 checks) runs as HR against the local server.
  The e2e user gets a local HR-admin role for the run only. What the run
  makes is taken away: the added employee, the partner's corrected day, the
  submitted week, notes, the job-level change and the balance.
- Found on the way, not changed here: the server's work-pattern score
  counts the days before someone joined as unapproved absences. It is
  flagged as its own task.

---

## 2026-09-26 — 0.2.11: HR, part 1 — the People rail and your own HR on the desktop

**Added**

- **HR has its own rail** ("People"), like the web's, with a company-scope
  button at the top. It is gated on the same permissions as the web, so
  people see only what they may open. The Time and Administration sections
  fold away unless you are in one of them.
- **Nine HR screens are now drawn on the desktop:**
  - **Dashboard** (staff with `hr.view`): headcount, who is out today,
    onboarding, recent joiners, employment types and the coming holidays.
  - **My HR**: your employment facts, recent attendance, leave balance and
    personal details. "Ask to change a detail" sends a profile request —
    your own record is not edited directly, the same as on the web.
  - **My pay**: payslips by year, each with its lines; "PDF" saves the
    payslip to Downloads.
  - **My documents**: add documents (drop them or choose them, with a
    title, category and expiry), filter, list or grid, view in the browser
    and download. Renaming, archiving and deleting appear only where the
    server allows them.
  - **Requests**: your HR requests and, for reviewers, the team's, with
    Approve, Decline and Withdraw. Cover asks ("Can you cover this?") sit
    at the top when someone has named you.
  - **My attendance**: today's card and the month's history. Clock in and
    out open the header clock; "Ask to correct" on a day sends an
    attendance request, already filled in.
  - **Timesheet**: day, week and month views, by project or by task. Log,
    edit and delete work, and "Submit week" sends the week for review. A
    week that was sent back says so at the top.
  - **Leave**: request leave (full day, half day or short leave, with the
    person responsible, evidence and what it will cost from your balance),
    withdraw it, and a month calendar of who is away. Those who decide
    leave can Review, Approve, Reject or Send back from the list.
  - **Waiting on me**: everything that needs your decision, behind eight
    tiles you can filter by. Leave rows say why it is yours ("you were
    asked" or "HR approval") and can be reviewed, approved or declined in
    place; HR requests too.
- **Review leave** opens a drawer with the request, overlapping leave, the
  cover answer, evidence, balances and recent attendance. When you are the
  person named as responsible, it also offers Accept or Decline cover.

**Changed**

- **The rest of HR still opens in the browser** — Directory, Team
  attendance, Onboarding, Resignations, Offboarding, Schedules, Reports and
  Settings. Those rail items carry an arrow mark. A link to one of them
  (`/hr?tab=…`) also opens in the browser. Resignation and offboarding rows
  in Waiting on me open their case there.
- **Reports** shows only for people with `hr.view`. The web shows it to
  everyone, but the report endpoints refuse anyone without it.

**Fixed**

- **Home no longer crashes** after opening HR. HR's approvals query shared
  a cache key with Home's "Waiting for me", whose data has a different
  shape; HR's now has its own key.
- Opening one folded rail section no longer folds the other one back.
- Leave ids come back from the server as text; they are now numbers, so
  "is this mine" and "can I decide it" compare correctly.

**Notes**

- Payslips and HR documents download through the same download queue as
  mail attachments, and land in Downloads.
- `tests/e2e/hr.mjs` walks the whole of part 1 against the local server
  with two e2e employees, one of whom asks the other for cover. It cleans
  up what it creates. Renaming, archiving and deleting your own document
  are skipped there: the server does not allow them for employees.
- Part 2 — the manager and HR-admin screens that still open in the browser
  — comes next.

---

## 2026-09-26 — 0.2.10: The chat drawer's messages, to the new drawer design

**Changed**

- **Messages in the chat drawer** now look like the owner's drawer design:
  - The chat sits on a light dotted background.
  - Your messages are in light indigo bubbles and theirs in white. The time
    and the ticks sit inside the bubble: one grey tick for sent, two grey for
    delivered, two blue for read.
  - "Today" and "Yesterday" pills separate the days.
  - In a group, the sender's name appears in a colour of its own.
  - A reply shows the message it answers, quoted in the bubble.
  - Reactions hang off the bottom of the bubble as small pills.
  - Voice messages have a round play button inside the bubble.
  - A record card (a CRM lead, for example) has a red edge and its own
    "Open" link.
  - Missed and declined calls show as a pill with Call back.
- **Acting on a message in the drawer:**
  - Hovering (or clicking) a message shows a compact bar on its top edge:
    react, reply, star and more.
  - React opens a pill of six emoji, plus a + for the full picker. The pill
    always stays inside the drawer.
  - More opens a menu: Reply, Copy message, Copy link, Pin message,
    Forward…, Create task (named after the message), Edit (your own
    messages) and Delete…. It opens upward when the message is down by the
    message box, and it also stays inside the drawer.
- **The drawer's header:**
  - A larger picture with a presence dot.
  - "typing…" in green while the other person types.
  - Call and video buttons, and a ⋮ menu with Open in Chat and Mute.
  - Minimise and close. The separate "open in Chat" button went into the
    ⋮ menu.
- **The record you have open** now shows as a card at the top of the
  conversation. It has the app's icon, an "Attach record" button, and a ×
  to hide it.
- **The quick actions** (Create task, Save as note, Search) are chips with
  icons.
- **The drawer's message box is a rounded field.** It has emoji, urgent and
  attach buttons inside, and a round microphone button beside it. The
  microphone turns into Send as soon as there is something to send.

**Fixed**

- The calls end-to-end test checked "reply with a message and decline"
  before the decline had landed. It now waits for its own reply and the
  ended call.

**Notes**

- Only the drawer changes. The full Chat page keeps its ChatMain look and
  the round-button menu from 0.2.9.
- The chat e2e now also checks, in the drawer:
  - the pill message box;
  - the compact bar;
  - that the reactions pill stays inside the drawer, and the pick is stored;
  - that the menu opens upward by the message box, with the design's items.

---

## 2026-09-26 — 0.2.9: Search, the app launcher, the clock, calls, chat and the chat drawer, to the new designs

**Changed**

- **Global search** (⌘K; GlobalSearch) is a bigger box with a preview.
  - Before you type, it shows your recent searches, eight apps to jump to,
    and things to create (new mail, task, event, note, contact, upload).
  - Results come grouped, with one filter per group and a count on each.
    Tab steps through the filters; Backspace in an empty box clears one.
  - The part that matched is highlighted.
  - The selected result is previewed on the right, with Open (↵),
    New window (⌘↵) and Copy link.
  - A single click selects a result; a double click or Enter opens it.
  - `>` switches to commands: apps to go to, things to create, and every
    shell command with its shortcut.
  - Offline, it still searches what is saved on this computer, and says so.
- **The app launcher** (AppLauncher) shows apps as tiles.
  - A big search box at the top.
  - A Recent row: the last four apps you opened. It is kept on this
    computer only, per person.
  - Category filters with counts.
  - Each tile shows its unread count. Apps that open in the browser carry a
    corner mark.
  - Arrow keys move over the grid, Enter opens, ⌘Enter opens in a new
    window, and Tab changes category.
  - Right-click (or a tile's ⋯) opens the app in a new tab or window, or
    pins it to the sidebar.
  - An app name that doesn't match anything offers to search WorkSuite
    for it.
- **Clock in / out in the title bar** (ClockIn). The pill shows where the
  day is: "Clock In", the time worked, "On break · 14m", or ✓ with the
  day's total.
  - It opens "Today's attendance" with a ring, the shift, and the time still
    to go.
  - **Clocking in now takes two clicks**, where it used to take one. The
    popover asks where you are working first, from the company's own list
    of work locations, and that place is stored on the day.
  - Break and Resume start and end a break, and the break is timed.
  - Clocking out asks what kind of day it was (optional; kept for reports),
    takes a note, and waits for "I confirm that I am clocking out".
  - When the day is done, the popover shows the total, the clock-in and
    clock-out times, and any overtime. Where the company allows it, it also
    offers "Clock in again…".
  - Where the company requires a location to clock in, the popover asks
    why there is none. The desktop cannot share a location yet.
- **The voice call window** (CallWindow, CallVoice): the dark gradient
  window.
  - A large picture of the person, with a green glow while they talk and a
    mark when you are muted.
  - Moving voice bars, and labels for "You are muted" and "Noise suppression
    on".
  - Round controls: mute, speaker, video, share screen, noise, chat, and a
    red hang-up button.
  - Its own title bar, with a Keep on top pin.
  - While it rings out, a ringtone volume slider and "Mute the ringtone".
  - If it can't connect, it offers Retry, Chat and End the call.
  - When the call ends, the window stays for a few seconds with Call again,
    Message and Close. It used to close after a second and a half.
- **The incoming call** is a notification card with a countdown bar showing
  how long it will keep ringing.
  - Dismiss (×) stops it ringing on this computer, without declining.
  - The quick replies are chips above a reply box.
- **Chat.**
  - A message's actions are now behind a small round button on the message.
    It opens the reactions above the message and a menu with Reply, Forward,
    Copy link, Star, Pin, Edit, Copy text and Delete.
  - The menu opens upward when the message is at the bottom of the thread.
  - The chat drawer is laid out like ChatDrawerCalls:
    - Chats / Calls / Archived tabs with counts: unread chats, and calls
      missed today.
    - All / Unread / Mentions filters.
    - Larger rows showing "You:", muted, pinned and @mention marks.
    - Pinned chats come first, and an Archived row sits at the top.
    - The call log calls back or joins in one click.
  - A conversation in the drawer (ChatDrawer):
    - A slimmer header: back, the person and whether they are online, call,
      video, more, minimise, open in Chat, close.
    - The "Context: … is open" bar is tinted, as designed.
    - Three quick actions above the message box:
      - **Create task** opens a new task named after the conversation.
      - **Save as note** keeps the loaded messages as a note, with Open on
        the toast.
      - **Search in conversation** opens the search.
  - The page behind the drawer is no longer dimmed and stays usable. The
    drawer closes from its own buttons, and clicking the page no longer
    closes it.
  - Drag the drawer's left edge to resize it (360–900 px). The width is
    remembered; a double click puts it back.
  - Minimised conversations wait as dark pills at the bottom left, with
    their unread count.

**Added**

- **A floating call bar.** Minimise shrinks a voice call to a small bar that
  stays on top of other apps. It has mute, open and hang up. Its size and
  place are never saved as the call window's.

**Fixed**

- The calls end-to-end test followed the old voice recorder. It was out of
  date since the composer redesign.

**Notes**

- New tests:
  - `tests/e2e/shell.mjs`: 21 checks — the launcher, search, and a whole
    working day from the clock.
  - Unit tests for the launcher grid, recent apps, the search highlight and
    filters, and the attendance helpers. 206 unit tests in total.
- The chat, calls (now also the drawer's quick actions) and contacts
  end-to-end suites pass on the new screens.
- The shell suite needs the signed-in person linked to an employee. On the
  local server, the probe user now has one, `E2E-47671`.

---

## 2026-09-26 — 0.2.8: Files part 2 — the editors, the player, folder uploads and downloads into the Drive

**Added**

- **The code editor** (DriveCode). Text and code files open in it; a
  read-only view is one click away.
  - The file on the right, and an earlier version on the left, with the
    lines taken out and put in marked. Compare it with any version, with
    your last save, or with nothing.
  - ⌘S saves a new version. The status bar shows the changes (+/−), the
    line and column, the indent, the encoding and the line endings.
  - Format lays out JSON again, and tidies trailing spaces in anything else.
  - Tab indents the way the file does.
  - It holds the file's edit lock while it is open. If someone else is
    editing, it opens read-only and says who.
  - If somebody saves a newer version first, yours is refused rather than
    written over it. "Load theirs" brings theirs in and copies yours to paste
    back; "Save mine over it" keeps theirs in Versions.
- **The image editor** (DriveImage):
  - Crop (free, 1:1, 4:3, 3:2, 16:9), turn and flip, eleven adjustments
    (exposure, brightness, contrast, highlights, shadows, saturation,
    vibrance, temperature, tint, hue, gamma), looks (mono, sepia, warm, cool,
    vivid, fade), a text watermark (nine positions, opacity, size; shrunk to
    fit), resize, and Info (camera details and versions to restore).
  - Undo (⌘Z), and Compare (hold) for the original.
  - "Save as version N" makes the next version of the file; "Save as copy"
    puts the result beside the original.
- **The media player** (DriveMedia):
  - Video and sound with their own controls: play, seek, volume, speed,
    subtitles, picture in picture, full screen.
  - It carries on from where you stopped.
  - Keys: space plays, ← → move 5 seconds, ⇧← ⇧→ go to the file before or
    after, M mutes, F goes full screen.
  - Comments pinned to a moment, marked on the seek bar (click to jump).
  - Description and tags are saved as you go.
  - When the server can't prepare media, the original still plays, with a
    note saying so.
- **Upload a folder** (New ▾ → Upload folder…, or drop a folder from
  Finder). Everything in it goes up into folders of the same names. Hidden
  files and links are left out; up to 2,000 files at a time.
- **Downloads into Drive** (New ▾ → Download from URL or magnet…): the
  server fetches a web address or magnet link straight into the folder.
  Pause, resume, retry, cancel. Offered to those allowed (urls.manage).
- **The uploads tray** (bottom right) shows what is going up, a folder's
  files by their place in it, with a link to Transfers.
- Pictures show "Edit image" in the viewer, the details panel and the menu.
  Text files show "Edit".

**Fixed**

- **The app could show "A JavaScript error occurred in the main process —
  database is not open" when quitting.** A window saving its place, or the
  status timer, ran after the local database had closed. Window places are
  now saved first, the timers stop, and a late question to the closed
  database gets nothing back instead of an error.

**Changed**

- The app now reads the server's signed media addresses (`/media/…`)
  through its own connection. It needs this so the image editor can save
  what it draws; the addresses are read only.

---

## 2026-09-26 — 0.2.7: Files, native, to the Drive designs (part 1: the Drive)

**Added**

- **Files is rebuilt to the Drive designs.** The old online-only page is gone.
- **The rail** (DriveRail):
  - **New ▾** makes a folder, a Document, Spreadsheet or Presentation (they
    open in Office on the web), a text file or a Markdown note. **⬆** uploads.
  - Home, My Drive, Recent, Starred, Shared with me and Shared by me, with
    counts.
  - Your folders as a tree, in their colours, with locks and stars. Drop
    files or rows onto a folder to put them there.
  - Find by type or date: Images; PDFs, documents, sheets and slides; video,
    audio, archives and code; today, yesterday, this week and this month.
  - Tidy up (Duplicates, Large files, Storage, Recycle bin) and Settings
    (Secure links, Drive notifications, Sharing between companies for those
    allowed).
  - How much space is used, and of how much.
- **Home** (DriveHome): search the whole Drive, Continue working, Recently
  opened, starred folders and what is out on a public link.
- **A folder** (DriveFolder):
  - The breadcrumb, whose last part opens the folder's menu. New folder and
    Upload sit beside it.
  - Search, a type filter, eight sorts, and list or grid (remembered).
  - The list shows name (with a thumbnail, star and lock), owner, modified
    and size. The grid shows pictures as tiles.
  - Choose with a click, ⌘/Ctrl and Shift. The dark selection bar can Share,
    Move, Copy to, Download, Zip, Send to Chat and Move to trash.
  - Right-click or ⋯ for the menu; right-click empty space for New folder,
    Upload, Select all and Refresh. Drop files from Finder to upload.
  - Keys: Enter opens, Space previews, F2 renames, Del trashes, ⌘A selects
    all, ⇧⌘N makes a folder, ↑↓ move, Backspace goes up, / searches, Esc
    clears.
- **The file menu** shows only what the server allows:
  - Open, Preview, Edit in Office, Open locally, Open in the browser.
  - Share…, Secure link…, Copy public link, Send to Chat…, Discuss in Chat….
  - Rename, Move…, Copy to…, Duplicate, Zip, View contents, Versions,
    Download, Star, Move to trash.
- **The folder menu**: Open, Details, Share…, Get link…, Send to Chat,
  Download (zip), Password lock (for the owner), Rename, Move…, Star, Delete.
- **The details panel** (DriveGrid, right) has a picture, the star, Open,
  Share and Open locally, and five tabs:
  - **Details:** type, size, place, owner, dates, version and your access; an
    editable description; linked records (find and link one, or unlink); and
    which changes you are told about.
  - **Activity:** filtered by changes, comments, sharing, records and views.
  - **Comments:** reply, resolve, 👍, and edit or remove your own.
  - **Versions:** restore, download or upload a new one.
  - **Access:** who can open it and how.
- **The viewer** (DriveMedia) shows pictures (Fit or 100%), video, audio and
  text, with ‹ › and ← → through the files around it, a strip of them and
  their details. PDFs open in WorkSuite's PDF reader in the browser.
- **Share** (DriveShare):
  - Find people, teams, departments, roles or companies, and give a level
    (can view, can edit, full access), optionally without download.
  - Change or remove what is there, see what comes from the folders above,
    stop or restart inheriting, and lift a refusal.
  - Effective access shows who can open it and why.
  - Public and secure links, Copy WorkSuite link and Send to Chat.
- **Secure link** (DriveSecureLink): a label, 1 hour to never, a download
  limit, a password and an IP lock. It is copied as soon as it is made.
- **Send to Chat** (DriveDialogs): a person, a conversation or a team. When
  they can't open the file it offers Grant view, Grant edit or Send secure
  link.
- **Password-locked folders:** lock with a password and confirmation, and
  unlock with the current one. A locked folder asks for its password before
  it shows anything, from its owner too; the password is kept until you quit.
- **Archives:** see inside a zip, and extract it into the Drive. Zip several
  files into one.
- **Shared with me** (DriveShared): filter by type, your access, when it was
  shared, company, location and module. Shared folders are listed first; the
  table shows owner, company, location, related record, module, your access
  and when. Shared by me lists what you have put on a link.
- **Recycle bin:** restore, delete forever, restore all, empty. Trashing a
  file offers Undo.
- **Storage:** used against your quota, what could be freed, where the space
  went, and the largest files.
- **Duplicates:** keep the newest copy and trash the rest.
- **Secure links:** every link with its rules, uses, expiry and status; Copy,
  the downloads log and Revoke. Public links are listed too.
- **Drive notifications:** your defaults.
- **Sharing between companies:** add or remove partners.

**Fixed**

- **Uploads from the app now say what they are.** The app never sent a
  file's media type, and the server stores what the upload says, so every
  file uploaded from the app since 0.1.0 has none: the server shows no
  preview for them, here or on the web. New uploads carry it. Older ones
  still preview here (from the file itself), but the web won't preview them
  until the server fills the type in.
- **A wrong folder password no longer signs you out.** The server answers a
  wrong folder password with 401. The app took any 401 that survived a token
  refresh as the end of the session. It now signs out only when the refresh
  itself is refused.
- Search boxes drew a second focus ring inside their own border (Files and
  Contacts).

**Not built yet (part 2)**

- The code editor with version compare, the image editor, the full media
  player (streaming, subtitles, markers, playlists), uploading a folder with
  its structure, and downloads from a URL or magnet.
- Anything that needs Drive sync on this Mac: "on this PC" states, Show in
  Finder, Keep offline, Free up space.
- Tags are not shown: the server returns them only from its media and image
  editors.

**Found on the server, not changed**

- A folder's password is checked only when listing it with `files/browse`
  and downloading it as a zip. `drive/list`, search and the per-file routes
  ignore it. This app reads locked folders through `files/browse`.
- A deleted folder can't be restored: there is no folder recycle bin, and the
  files inside it stay counted but can't be browsed.
- `PUT /api/folders/{id}` and `POST /api/folders` answer with the folder's
  `password_hash`.
- Renaming `a.txt` to `a.md` keeps the extension `txt`.

---

## 2026-09-26 — 0.2.6: Contacts, native, to the Contacts designs

**Added**

- **Contacts opens in the app** instead of the browser. It's in More apps, can
  be pinned, and has a "New Contact" quick action.
- **The rail:** + New contact; All contacts, Favorites, Employees, Customers
  and Vendors, with counts; Archived; the Company directory. Then your
  groups, each with its colour and count: + makes one in place, and the one
  open can be deleted (its contacts are kept). Import and Export sit at the
  bottom.
- **The page:** the six counts (total, employees, customers, vendors,
  favourites, birthdays in the next 30 days), a search over names, emails,
  company, job, phones and labels, and the people as cards or a list (the
  choice is remembered). Each card has the colour avatar, what they do and
  where, the type and first label, and a star.
- **A contact** opens beside the list:
  - the header stars, edits, archives or restores, and deletes (after
    asking);
  - one click to **Email** (a new mail to them), **Chat** (for a contact
    linked to a teammate), **Meet** (a meeting starts in its window),
    **Schedule** (a new event already titled "Meeting with …") or **Task**
    (a new task, "Follow up with …"). Each goes on their timeline, as on the
    web;
  - **Details:** Communication, Business and More (address, birthday,
    groups), social links and the notes field. An email or website opens;
    anything can be copied. A phone number offers **Send a WhatsApp
    message** (the web's send dialog: the number, which of your WhatsApp
    numbers, and the words, all seen before it goes), **Open the
    conversation** and **Call**;
  - **Notes:** add with Ctrl+Enter, pin (pinned ones first), edit and delete;
  - **Activity:** everything done with them, newest first.
- **New and edit contact** has every field the web keeps: name, type,
  birthday, job, department and company; the emails, phones and website; the
  address; the customer, employee and vendor IDs and tax number; nine social
  handles; groups as toggles; labels; notes. A contact made inside a group or
  a type's view starts in it.
- **Company directory:** everybody here, with Everyone / Not saved / Saved.
  Add saves a colleague as a contact linked to them, so Chat works.
- **Import** walks the four steps of the design: choose a file (CSV or JSON;
  drop it or choose it; the template can be downloaded), match the columns
  (matched already from the header), check (ready, warnings, and what will
  not import and why), import. Choose what happens to a record that already
  exists. The rows that did not import download as a file. The list shows
  the new contacts at once. Import is only offered to those the server lets
  import contacts (contacts.manage), as on the web.
- **Export** as CSV or vCard, to your downloads.
- **Keys:** N new contact, / search, Esc closes the contact.

**Changed**

- A new event (`/calendar?new=1&title=…`) and a new task
  (`/tasks?new=1&title=…`) can start with a title.
- Mail's `?compose=1&to=…` starts a message to that address.
- The app can hand a phone number to the system to call (`tel:`, digits and a
  leading + only; anything else is refused). On a Mac, FaceTime asks first.

**Not built (not in the web either)**

- An archived contact is only reachable from the Archived view added here;
  the web has none.

---

## 2026-09-26 — 0.2.5: Notes, native, to the NotesMain and NotesExtras designs

**Added**

- **Notes opens in the app** instead of the browser. It's in More apps, can be
  pinned to the sidebar, and has a "New Note" quick action.
- **The rail:** + New note; All notes, Favorites, Pinned, Shared with me and
  Archived, with counts. Then your notebooks, each with a colour, its count
  and its sections (fold them away). Notebooks and sections can be created
  (a notebook with its first section), renamed and deleted; their notes stay.
- **The list:** each note's title, favourite and pinned marks, the first lines,
  when it was edited and its tags. Search looks in titles, text and tags.
  Notes opens on the first note.
- **The note:**
  - The header says where the note lives and whether it's saved, with
    ★ Favorite, Version history, Share, and ⋯: Pin, Favorite, Duplicate,
    Share, Version history, Move to…, Convert to task, Archive and Delete.
  - The toolbar has the text style, bold, italic, underline, headings,
    bulleted and numbered lists, ☐ to-dos (click the box to tick it), quote,
    code, link, pictures and tables.
  - The Linked bar shows its contacts, events and tasks, with Link to a
    contact…, Link to an event… and Convert to task ("Converted to task ·
    Open").
  - Under the title: who has it ("Editors: you, Samali · Viewer: Nuwan"),
    and its tags.
  - **It saves itself** a moment after you stop typing, and at once when you
    open another note, so nothing typed just before switching is lost. A
    save that fails says so and tries again when the connection is back.
    ⌘S saves now.
  - Pictures (pasted, dropped or chosen) go into your Drive and into the note.
    They show for everybody who can read the note; this needs the server
    change deployed with it.
  - Someone a note is shared with to view reads it; an editor edits the
    title, tags and text.
- **New note** has a title, the notebook or section, and a template: Blank,
  Meeting notes, Project documentation, Standard operating procedure, Daily
  journal or To-do list.
- **Share** finds teammates and adds them as editors or viewers; roles can be
  changed and access removed.
- **Version history** lists the saved versions. Preview one, or compare it
  with the note now (words taken out in red, put in in green), and restore
  it. What the note says now is kept as a version first.
- **Keys:** N new note, / search.

**Changed**

- Tasks and Notes clean rich text with the same code (`core/rich`). Notes
  allow what the server's rich profile does: headings, tables, rules and a
  few safe styles.

**Not built (no server support yet)**

- The design's third level (a section inside a section), and its "What is
  this note about?" field.

---

## 2026-09-26 — 0.2.4: Tasks, to the TaskRail, TasksList, TasksBoard, TaskDetail and TaskNew designs

**Added**

- **The rail:** + New task, then All active, Assigned to me, Due today,
  Overdue, Completed and Shared with me, each with what is still open there.
  Your lists follow, each with its colour and open count. A list can be
  favourited, renamed, recoloured or deleted; deleting it keeps its tasks.
  "+ New list" makes one.
- **The list:** open tasks grouped Overdue, Today, This week, Later and No due
  date. Each row has a tick to complete, the list, the status (changed in
  place), priority, assignee, due ("Today 6 PM", "Fri", "12 Oct"; red when
  late) and progress. Completed tasks come newest first. There is quick add
  ("Enter to add to My tasks", or to the list shown), a search, and filters
  for status, assignee and priority.
- **The board:** a column per status (Backlog when anything is in it). Cards
  show priority, a tag, the title, progress, the due date, the checklist and
  the assignee. Drag a card to another column, or add straight into one.
  Lists open as a board and the views as a list; B and L switch.
- **A task opens over the page:**
  - The header has Copy link, Duplicate, Archive, Delete…, and Complete
    (or Reopen). Changes save as you make them.
  - The left side has the title, a description with formatting, the
    checklist (tick, rename by double-click, remove), and attachments. Drop
    files on it, attach files, or choose from Drive. Files preview and
    download.
  - Comments have bold, italic, underline, lists, links, emoji, @ to mention
    somebody, and files from the computer or Drive. Activity is the other tab.
  - The right side has status, priority, assignee, start and due (a day, with
    a time if wanted), list, organisation, tags and progress. Progress
    follows the checklist when there is one. Then who is on the task
    (Manage adds assignees, reviewers, followers and shares, with what a
    share may do), Follow, and the review: Submit for review; for the
    reviewer, Approve or Request changes.
  - Only what you may change is offered.
- **New task** has a title, description, list, status, priority, assignee,
  start, due, estimated hours, company and tags. It warns when the due date
  is before the start, and opens the task once it is made.
- **Offline:** completing, changing a field and creating a task are queued
  and sent when the connection is back.
- **Keys:** N new task, B/L board or list, / search; Esc closes a task.
- **Needs the server change deployed with this:** reviewers, followers and
  shares can open a task, and "Shared with me" lists them.

**Changed**

- Reopening a finished task sets its progress back to 0 (unless a checklist
  decides it). Completing had set it to 100, and a reopened task showed as
  finished.
- The chat composer's From Drive uses the same Drive picker as Tasks.

**Fixed**

- Dialogs that reach the top of the window (the task view, any dialog, the
  launcher and the search) now take clicks there. On macOS the top bar moves
  the window, and a click on a dialog's button over it could move the window
  instead.

---

## 2026-09-26 — 0.2.3: Calendar, to the CalendarWeek design

**Added**

- **Calendar is native.** Day, Week and Month over everything the calendar
  brings: your events, meetings, tasks, leave, holidays, projects and
  sprints, tender closings, asset dates and subscription renewals.
  - **The left rail:** + New event, a small month (the days shown are marked;
    a day opens it), the nine categories to show or hide (remembered on this
    computer), and today's list.
  - **The toolbar:** Today, ‹ ›, the range ("21 – 27 September 2026"),
    Day/Week/Month, Import .ics, Export .ics and Subscribe.
  - **Keys:** T today, N new event, D/W/M the view, ← → to move.
- **Drag to reschedule, stretch to change the end, and undo.**
  - Your own events, and meetings you organise or host, move by dragging in
    quarter hours, to another time or day. In Month they drop on another day
    and keep their time. Their bottom edge stretches.
  - Every change shows "Moved to 10:00 AM · Undo" for twelve seconds.
  - Moving a meeting reschedules it, and everybody invited is told.
- **Repeating events ask "Move the whole series?"**
  - **Only this one** (for the event's owner) makes a one-off at the new time
    with the same people, video meeting and reminder, and skips that date in
    the series.
  - **Move every occurrence** moves the series by the distance dragged, from
    its own first date.
  - Both can be undone. Undoing "only this one" needs the server change
    deployed with this (`unskip`).
- **The event drawer** creates and edits events. It covers:
  - title, start and end, all day, repeat and until, reminder, category,
    colour, location and description;
  - a video meeting;
  - attendees invited as viewers or editors, with their roles and replies,
    and your own reply to an invitation;
  - meeting notes (a note linked to the event);
  - Delete, or for a repeating event, skip just this date.

  Anything else opens as a summary, with Open to where it lives.
- **Subscribe** makes your calendar link for Google Calendar, Apple Calendar
  (as webcal://) or Outlook, with the steps for each. The link is shown once,
  when it is made; it can be replaced or stopped. It says when a calendar
  last read it.
- **Import .ics** reports how many events arrived, which were skipped and why.
  **Export .ics** saves your calendar to your downloads.

**Fixed**

- **Opening an occurrence of a repeating event, then saving it, would have
  moved the whole series to start on that day.** The drawer now shows and
  saves the series' own times, and says a change applies to every occurrence.
- **Every dialog's text sat against its left edge.** The dialog body now has
  its padding, and the dialog box no longer draws a focus ring around itself.

---

## 2026-09-26 — 0.2.2: Chat opens on your last conversation

**Changed**

- **Chat opens on a conversation, not on "Pick a conversation".** Opening
  Chat with no conversation named shows the one you had open last. If that
  one is gone or archived, it shows the most recent. The choice is remembered
  on this computer, per person. The empty pane is only for somebody with no
  conversations at all ("No conversations yet").
- **The filters fit on one line.** All, Unread, Mentions and Website stay as
  pills. Archived moved into the list as its own row at the top ("Archived · 3"),
  shown when something is archived. It opens the archived conversations,
  with a way back. The five pills needed more room than the list has, so
  Archived wrapped onto a second line under the others.

---

## 2026-09-26 — 0.2.1

The polished chat composer and the passkey sign-in fix below, as version
0.2.1. The server side (the department in the @ list) was deployed at 21:07
UTC on 2026-09-25.

---

## 2026-09-26 — The chat composer, to the "Chat composer — polished" design

**Changed**

- **The message box is icons now:** attach, urgent, emoji and send around
  the text. Send is disabled until there is something to send. Under the box:
  "Enter to send · Shift + Enter for a new line · @ to mention".
- **The paperclip opens eight choices:** Document, Image, Video, Audio (each
  opens the file dialog on those types), Any file, From Drive, Camera / Photo
  and Voice message. The separate GIF and Voice buttons are gone. GIFs are
  under Image, and a voice message is under the paperclip.
- **Files wait in a tray until Send.** Picking, dropping or pasting a file
  no longer sends it straight away. Each file shows as a card: Ready to send,
  Waiting, Sending… with its progress, or Failed with ↻ to try again. × takes
  it out. While files are waiting, the box asks for a caption, and the words go
  with the first file (the reply too).
- **Editing happens in the composer.** Edit, under More, puts the message in
  the box under an amber "Editing message" bar that shows the original. Attach
  and urgent step aside, and send becomes ✓ "Save the change". Cancel or Esc
  leaves it unchanged. Your unsent draft is kept while you edit. Before, the
  message turned into a small box inside the thread.
- **The @ list** is headed "People in this chat" and anchored at the "@".
  Each person has their presence dot and "Department · online / away /
  offline" (the department needs the server change deployed with this).
  Teams and departments follow. ↑↓, Enter and Esc work as the list's footer says.
- **Several people typing** show in a line above the box ("Samali and Chamudi
  are typing…") instead of in the header. Typing needs the server's realtime.
- **Reply** shows "Replying to …" with the snippet above the box; × or Esc
  cancels.
- **Emoji** has a search ("party" finds 🥳 🎉) and your frequently used ones
  first. They are counted on this computer only.
- **A voice message records in place of the box:** delete, the red dot, the
  time, a live level meter, stop and send. Stop keeps the recording to send
  or delete; send stops and sends at once.
- **The drawer, the pop-out and the call and Meet panels** use the same
  composer in a compact size, without the hints line.

**Added**

- **Urgent.** People allowed to send urgent messages (`chat.message.urgent`)
  have the ⚠ toggle. It turns the box red. An urgent message reaches people
  who only want priority notifications and is labelled Urgent in the thread.
  Urgent turns itself off after sending. An urgent message is never queued
  offline, so it is never delivered late. With files, the urgent words go as
  their own message, because a file cannot be urgent.
- **From Drive:** browse your Drive and send files as cards. If somebody in
  the conversation cannot open a file, nothing more is sent, and you choose:
  grant view or edit, send a secure link (1, 7 or 30 days) or cancel. This is
  the same question the web asks.
- **Camera / Photo:** take a picture (retake or use it), and it joins the tray.
- The transfer manager can download your calendar (.ics) and contacts
  (.csv / .vcf) exports, for the Calendar and Contacts screens to come.

**Fixed**

- Deleting a conversation's last message left its text as the conversation's
  preview in the list until something else refreshed it.

---

## 2026-09-26 — Passkey sign-in showed only after a restart

**Fixed**

- **"Sign in with a passkey" was missing after signing out.** The sign-in
  screen offers a passkey only when the server says it takes them. The app
  keeps the server's description from when the address was first entered,
  and re-read it only when it started up signed out. A server set up before
  passkey sign-in existed kept a description without it. The button then
  stayed hidden after signing out, or after a session ended, until the app
  was quit and reopened. The app now re-reads the server every time it
  arrives at the sign-in screen, at most every 30 seconds.

---

## 2026-09-26 — 0.2.0: chat, website chat, calls, Meet and Meetings, to the new designs

**Added**

- **Chat, redone to the ChatMain design.**
  - The rail has your status (Available, Busy, Do not disturb, Away), starred
    messages, **+ New conversation** and a search that also looks inside
    messages from three letters.
  - Filters are All, Unread, Mentions, Website and Archived. Conversations
    are grouped into Pinned, Direct and Groups & channels.
  - Each conversation has a header with search in the conversation, voice
    and video call buttons, and a details panel: members with presence,
    shared media, files, links, audio, pins, and notification settings.
  - Hovering a message offers React, Reply, Forward…, Star, Pin, Copy link
    and More (Edit, Copy text, Delete…). Delete asks whether to delete for
    everyone or only for you.
  - Pinned messages sit in a banner above the thread. Shared records (a
    Drive file, a leave request) show as cards.
  - The composer has Attach, Emoji, **GIF** (sends a .gif from your
    computer; there is no GIF search), Voice and Send. Typing **@** in a
    group offers people, teams, departments and @everyone. Only the names
    still in the text when you send are mentioned.
  - New conversations, forwarding, group details (rename, roles, remove,
    leave) and per-conversation notifications follow ChatExtras.
- **Website chats get their own workspace** (WebChatInbox), from **Website**
  in the Chat rail or any website-chat notification.
  - The sections are Inbox, Live chats, Offline enquiries, Missed chats,
    Assigned to me, Unassigned, Awaiting reply, Starred and Closed, each with
    its count. The list can be filtered by site.
  - The thread header sets the assignee and priority, stars and closes the
    chat. Saved replies are one click above the composer.
  - The visitor panel shows their details, the pages of this visit and
    earlier chats. It can **raise a support ticket** from the chat and
    **block the visitor** (for people who configure widgets).
  - **Live dashboard** (WebChatLive): seven figures for today (on the site
    now, visitors, chats started, open, waiting on us, at risk, median
    first reply); who is on your sites and what they are reading; and, for
    whoever you pick, the pages of this visit and **Start the conversation**
    (or Open the chat, if they already have one). It also shows where
    visitors came from and their devices.
  - **Chat assigned to you**: a website chat given to you waits in the
    corner of the main window, wherever you are, with the visitor's
    question, page, device and place. It offers **Accept**, **Later** (two
    minutes) and **Ignore**.
  - Reports and widget setup open on the web.
- **The chat drawer** (ChatDrawer, ChatDrawerCalls): **Chat** in the title
  bar, or the "Chat over this screen" command, opens chat over whatever you
  are doing.
  - The tabs are Chats, Calls and Archived. **Calls** is the call log, with
    filters (all, missed, incoming, outgoing) and Call back, Call again or
    Join.
  - A conversation opens in place, with call buttons. When the screen
    behind it is a record, **Attach record** posts a link to it.
  - Minimising leaves the conversation as a pill in the corner.
- **Voice and video calls from any conversation** (CallVoice, CallVideo).
  - A call opens in its own always-on-top window, one call at a time. A
    voice call is compact; a video call has the conversation beside it.
  - Controls: mute, speaker or sound, add video or camera, **share a screen
    or a window** (picked in our own picker, FR-COM-05), noise cancellation
    and chat.
  - If nobody picks up in 30 seconds, or the person is busy or away, you
    can **leave a voice message**. It lands in the conversation.
  - Closing the window, or quitting the app, hangs up on the server.
  - Updates wait while a call is on.
- **Calls leave a card in the thread** (ChatDrawer): **Samali is calling ·
  Join** while it is on. Afterwards the card reads, depending on how it went:
  **Missed voice call · Call back**, **Declined**, **No answer · Call
  again** (your own calls), or **Video call · 4 min**. A Meet card says
  **started a meeting** and opens the meeting.
  - The card's state comes from the call itself on every fetch.
  - This needs WorkSuite from 2026-09-25 20:16 UTC, which writes the card
    and says whether it is a call or a meeting.
- **Incoming calls ring in a small window** at the top right of the screen
  you are on, over everything, without taking the keyboard. It offers
  Decline, Accept, **Answer with voice only** (for video calls), a
  ringtone volume and mute, and **Reply with message…** (a quick reply,
  then decline). A ring shows only while you are signed in and unlocked.
  With realtime down, the app checks for rings every 5 seconds.
- **Meet is a desktop module** (MeetHome, MeetLobby, MeetRoom, MeetCreated).
  - The home has **New meeting** (start now, create one for later, or
    schedule one), **join by code or link**, upcoming meetings, recent
    ones, and your recordings (rename, download, delete).
  - A meeting made for later shows its link, ID, passcode and a **QR code**.
    It can be copied, emailed, sent to a conversation or shared on
    WhatsApp.
  - Each meeting opens in its own window. The lobby shows your camera, lets
    you choose the camera, microphone and speaker, and has a microphone
    level meter. You then **Join now** as the host, or **Ask to join**.
  - In the room:
    - a grid of people, with the screen being shared shown large;
    - mute, camera and share (the same picker as calls);
    - for the host, recording, **End for all** and admitting or denying
      people waiting at the door;
    - a drawer with People, Chat (the meeting's conversation), a
      **whiteboard** everyone draws on at once, Files and Info (link, ID,
      passcode, sharing, and locking the meeting).
  - **Meet** in a conversation's header starts a meeting for that
    conversation.
- **Meetings is a desktop module** (MeetingsDash, MeetingDetail,
  MeetingSchedule), for people with `meeting.view`.
  - The dashboard has six figures, upcoming meetings by type, invitations
    you answer in place (Going, Maybe, Not going), your action items and
    today's meeting rooms. The tabs are My meetings, Invitations, Meeting
    rooms and Recurring; reports and setup open on the web.
  - A meeting's page:
    - **Agenda** runs the shared agenda timer (start, pause, done, skip)
      and adds items.
    - **People** adds people and takes attendance.
    - **Minutes** saves and finalises decisions, the summary and notes, and
      turns actions into tasks.
    - It also has **Summary**, **Files**, the saved **Board** and
      **Activity**, with Open in Chat, Cancel meeting and Join.
  - **Schedule a meeting**: type, priority and times on your WorkSuite
    clock; online on the built-in Meet, Jitsi or a pasted link, a free room,
    or an address; people, guests and an agenda.

The version is now **0.2.0**. The camera usage text in the macOS
permission prompt now mentions meetings.

**Needs the server** (WorkSuite, deployed with this update)

- `GET /desktop/v1/bootstrap` announces the media server (`media.livekit_url`).
  The page's security policy is fixed when a window opens, so the app must
  know the media server before the first call. Without it, calls cannot
  connect.
- `GET /api/chat/calls/history` is the native call log. `GET /api/chat/calls`
  is taken by an older handler.
- The website thread reads the conversation's priority.
- The meetings list says each person's own role and answer (`my_role`,
  `my_rsvp`), so invitations can be shown.
- A meeting's detail now sends the agenda timer (`status`, `started_at`,
  `elapsed_seconds`) and each person's `attendance` and `permissions`. The
  web's People and Agenda tabs already read these, and until now got
  nothing.
- Ending a call that has already ended changes nothing. Before, a second
  "end" (a retry, a closing window) re-finished a cancelled call as
  **answered**, so the log said a call nobody took was answered. The
  desktop also hangs up only once.
- A Meet recording downloads through the transfer manager
  (`transfers:download` with `recording`).

**Tests**

- End-to-end runs against a local WorkSuite:
  - `tests/e2e/chat.mjs`: 12 checks, now including star, pin and @mention.
  - `tests/e2e/website-chat.mjs`: 12 checks, including priority, star and
    the live dashboard.
  - `tests/e2e/meet.mjs` (new): 9 checks — the Meet home, a meeting for
    later with its QR code, the meeting window and lobby, Join reaching the
    server, scheduling, the agenda timer, attendance and minutes.
  - `tests/e2e/calls.mjs` (new): 17 checks — placing a call, the server
    ringing, hanging up (once, staying cancelled), Decline, Reply with
    message, a voice message, and the chat drawer's call log, conversation
    and minimised pill.
    It runs against a placeholder media server, because no LiveKit runs
    locally. **Sound and video themselves are not yet tested end to end**,
    for calls or Meet.
- The harness turns off lock-with-computer and the idle lock in the test
  profile. A run on a Mac whose screen locked mid-test had the app lock too,
  and a locked app, rightly, never rings.
- The harness can now drive the app's other windows (`attach`). A step whose
  window closes, or that takes over 30 seconds, now fails instead of hanging
  the run.

---

## 2026-09-25 — Sign in with a passkey, and clock in from the title bar

**Added**

- **Sign in with a passkey.** On a server that offers it (WorkSuite with
  `/desktop/v1`), the sign-in screen has **Sign in with a passkey** under the
  password form.
  - The app opens the server's passkey page in your browser, where Touch ID,
    Windows Hello, your phone or a security key work as they do on the web.
    WorkSuite then finishes signing you in here.
  - While it waits, the screen says so and offers **Open the browser again**
    and **Use my password instead**.
  - How it works: the browser proves the passkey and gets a one-time code; the
    app exchanges it with a PKCE verifier that never leaves the app. See
    [docs/BACKEND.md](docs/BACKEND.md).
- **Clock in and out from the title bar**, beside the connection pill, for
  anybody linked to an employee record.
  - **Clock in** is one click.
  - While clocked in, the pill shows the time worked. Clicking it opens a
    popover with a note field and **Clock out**, so a stray click cannot end
    the working day.
  - A policy that requires a note opens the popover for clocking in too.
  - The tray, the title bar and the HR page all clock through one
    main-process action (`hr:clock`). Each updates the other two at once;
    before, the tray only noticed a clock-in on the HR page within five
    minutes.

**Fixed**

- **Attendance times were off by the time zone.** Attendance stamps are
  wall-clock times on the company's clock, but the HR page and the tray read
  them as UTC. In Colombo a 22:25 clock-in showed as 3:55 AM, and the
  running time stayed at zero. Times are now shown as the digits the server
  sent. Time worked counts on from the server's own total, as the web does,
  and stands still during a break.
- **Messages from the main process were lost on the sign-in screen.** They
  were only listened for inside the signed-in shell. The listener now lives
  at the app's root.

**Checked**

- `tests/e2e/passkey.mjs` passes 15 of 15 against WorkSuite running locally.
  It plays the browser with a software authenticator signing real WebAuthn
  assertions, and hands the callback to the app as the OS does. It covers:
  - an unsolicited callback, a wrong state and a replay, each refused;
  - the sign-in completing as the passkey's owner;
  - clocking in with one click, and the server holding the check-in;
  - clocking out through the popover.

  It found three problems the unit tests could not, all fixed before this
  commit:
  - the new channels were missing from the preload bridge;
  - a stray callback cancelled the attempt it was not for;
  - toasts were dropped on the sign-in screen.
- 89 unit tests: 7 for passkey sign-in (the challenge is S256 of the verifier
  sent at the exchange; a wrong state, a second completion and a refused
  exchange each fail cleanly; a newer start replaces an older one; discovery
  accepts only same-server paths) and 4 for the attendance time rules.
  Typecheck and lint pass.

## 2026-09-25 — A macOS DMG that opens without an Apple certificate

**Added**

- `npm run dist:mac:unsigned` builds a universal (Apple silicon + Intel) DMG
  signed ad hoc, for testing before the Developer ID certificate exists.

**Found**

- **An ad-hoc-signed build with the hardened runtime does not start.** The
  first test DMG died at launch with `Library not loaded: … Electron
  Framework`: library validation needs a Team ID, and an ad-hoc signature has
  none. The unsigned script turns the hardened runtime off. `dist:mac` with a
  Developer ID keeps it on.

**Checked**

- `WorkSuite-0.1.0-universal.dmg` (219 MB) mounts, and the app inside is
  universal (x86_64 + arm64) and verifies with `codesign --verify --deep --strict`.
- It launches from the DMG: the GPU, network and renderer processes start and
  its profile is written.

**Where it bites**

- On any Mac but the one that built it, Gatekeeper refuses the unsigned app
  on first open. Right-click → Open, or run `xattr -dr com.apple.quarantine`
  on it after copying it to Applications. It cannot update itself.

## 2026-09-25 — The desktop API arrives on the server

WorkSuite now serves `/desktop/v1` (in the WorkSuite repository,
`app/Modules/Desktop`). A server that has it announces it at
`/.well-known/worksuite-desktop`, and the app uses it from the next sign-in;
older servers carry on through the existing API. See
[docs/BACKEND.md](docs/BACKEND.md).

**Changed**

- **Commands from the fleet view.** Revoke, sign out, turn sync off, require
  an update and refresh policy reach the laptop on its next heartbeat. The app
  carries each one out and reports back (`commands/{id}/ack`), once.
- **Revocation also arrives on the token refresh.** A refused refresh with
  `DEVICE_REVOKED` wipes WorkSuite's data from the laptop, as the heartbeat
  directive does, instead of leaving a sign-in screen for whoever has it.
- **`worksuite://` links are checked by the server.** On a desktop-v1 server
  the app asks `/desktop/v1/links/resolve` whether the person may open the
  record and in which company. A record they cannot open says so, and names
  nothing about it.
- **Apps come from the server's list by slug** (`worksuite.<slug>`), so an
  app the server has switched off is not shown in the sidebar.
- **Discovery reads the per-platform minimum version** (`minimum_versions`),
  as well as a single `minimum_version`.

**Where it bites**

- **Unsigned policies are applied when the build has no policy key.** Before,
  a build with no `MAIN_VITE_POLICY_PUBLIC_KEY` refused every desktop-v1
  policy, because there was nothing to verify it against. Now it applies the
  policy as unsigned, the same trust as the rest of the API. A build with a
  pinned key still refuses anything unsigned or wrongly signed and keeps the
  last policy it accepted.
- **Policies are signed only if the server has a key.** Run
  `php spark desktop:keys` on the server, put the secret in its `.env`, and
  build the app with the printed public key.

**Checked**

- 78 unit tests (one new: discovery of a desktop-v1 server and its
  per-platform minimum), typecheck and lint.
- The end-to-end smoke test against a local WorkSuite with `/desktop/v1`,
  28 of 28, registering through `/desktop/v1/devices/register`.
- A policy signed by the server's PHP signer verifies with the app's own
  verification code, and a changed field fails it.

## 2026-09-25 — WorkSuite Desktop 0.1.0: Phase 1 foundation

**Added**

- **The desktop shell** from the SRS v1.1 designs: navy title bar with the
  organization selector, search, connection pill, transfers, notifications, AI
  and account; the permission-filtered sidebar; tabs with the full tab manager
  (pin, duplicate, reload, close others/right, reopen closed, drag to reorder,
  open in a window); the status bar; light, dark and system themes; compact
  and comfortable density.
- **Sign-in** with WorkSuite's own login and two-step verification, on the
  existing API. The access token never leaves the main process; the rotating
  refresh token lives only in the OS credential store.
- **Device registration and heartbeat.** Each installation registers as a
  WorkSuite device and reports health every five minutes; a block, wipe or
  required version set in the fleet view reaches it within one heartbeat.
- **Phase 1 modules:** Home dashboard, Mail (three panes, combined inbox,
  shared mailboxes), Chat (threads, pending offline messages, mini window,
  file drop and pasted screenshots), Calendar, Tasks, Files (online), CRM
  leads, HR self-service (clock in/out, leave, approvals), Notifications,
  Activity, Settings, Diagnostics. Every other app the user can open is in
  the launcher and opens in the browser, labelled so.
- **Offline:** recently opened data readable offline, encrypted; changes that
  modules allow offline queue in order and replay with idempotency keys;
  conflicts are shown, never overwritten; drafts are saved as you type.
- **Native notifications** with privacy modes, do-not-disturb and pause; the
  tray with unread counts, Clock In, quick actions and state icons.
- **`worksuite://` deep links**, checked against an allow-listed grammar and
  the user's access.
- **Signed updates:** Ed25519-signed manifests, SHA-256, OS code-signature and
  same-publisher checks, channels, the Update Required screen, busy-aware
  restarts and critical-update deadlines.
- **App lock** after inactivity or with the computer; unlock with the
  WorkSuite password or Touch ID.
- **Diagnostics** with health checks, Safe Mode after repeated crashes, and a
  redacted support report the user previews before saving.
- CI for macOS, Windows and Linux; a signed-manifest release script; unit
  tests (77) and an end-to-end smoke test (28 checks) against a real server.

**Security**

- Sandboxed renderer with no Node, context isolation, CSP, a validated IPC
  allow-list with sender, lock, session, permission and rate checks, and
  hardened Electron fuses (no RunAsNode, no NODE_OPTIONS, asar integrity).

**Known limitations**

- Builds are unsigned until signing credentials are added to CI; unsigned
  builds run but do not update themselves.
- WorkSuite Drive folder sync, calls and Meet, the desktop AI assistant, the
  monitoring agent, hardware and kiosk are later phases.
- The server's `/desktop/v1` API does not exist yet; the client composes its
  bootstrap from the existing API and treats its policy as unsigned.
