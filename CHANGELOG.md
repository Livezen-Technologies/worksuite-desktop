# Changelog

What changed in WorkSuite Desktop, newest first. Entries are written for the
person who has to live with the change — what it does, and where it bites.

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
