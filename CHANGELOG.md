# Changelog

What changed in WorkSuite Desktop, newest first. Entries are written for the
person who has to live with the change — what it does, and where it bites.

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
