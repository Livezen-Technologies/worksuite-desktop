# Changelog

What changed in WorkSuite Desktop, newest first. Entries are written for the
person who has to live with the change — what it does, and where it bites.

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
