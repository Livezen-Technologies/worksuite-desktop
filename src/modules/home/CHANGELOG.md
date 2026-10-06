# home — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.6.0 — 2026-10-06

**Added**

- Home lays itself out by its own width — three, two or one column, stat tiles two by two when four don't fit, Customize always visible — so a docked chat drawer never covers it (#264)
- Waiting for me: 'All ›' opens one page of everything waiting for you from every app, with type and organisation filters; rows show the full name and type over date, length and reason with small ✓/✕ actions and open their own item; cover to answer is its own item, and Approve follows the cover rule (#263)

## 1.5.0 — 2026-10-03

- A compact organisation pill on the date line (#214): search, several organisations with Apply, a default organisation, due-today counts; cards refetch for the chosen organisations and the stat numbers are tabular in the app font.

## 1.4.1 — 2026-10-02

- Announcements order urgent, pinned, important, then newest; expired ones drop off at once; edits and withdrawals refresh Home immediately; 'See all' (#98).

## 1.4.0 — 2026-10-02

- Home rebuilt to the optimized design: date and organization line above the greeting, Customize and a New split button; four stat tiles (Due today with overdue, Meetings today with next time, Waiting for you with breakdown, Unread messages with mentions); Today's work with Today/Overdue/Upcoming tabs and tick-to-complete; Today's agenda timeline with an all-day group, NOW marker, next-meeting card with Join/Details and tender meeting actions; right rail with Your daily brief and Ask AI, Waiting for me (invitations, approvals, announcements to read) and Announcements; Recent activity and Recent files. Older saved layouts carry over.

## 1.3.0 — 2026-10-02

**Added**

- Waiting for me lists meeting invitations with title, organiser, date, time, timezone and location or link, and Going, Maybe, Not going and View Meeting. An answered invitation leaves the list but stays in the meeting's details (worksuite-desktop#97).

## 1.2.0 — 2026-10-01

- Home modernised: compact header with company filter, clickable summary cards with compact counts, Due today/Overdue/Upcoming apart, an agenda with Join and Open, Waiting for me with approvals, invitations and acknowledgements, an Announcements widget and reader, grouped activity, files without temporary artifacts, a short grounded summary, widgets that load and retry on their own, resizable and draggable with Reset Layout (#104, #98).

## 1.1.0 — 2026-10-01

**Added**

- Waiting for me lists the invitations awaiting your answer, each flagged when it overlaps something you already have (worksuite-desktop#99).

## 1.0.2 — 2026-10-01

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.0.1 — 2026-09-30

**Changed**

- Ask AI opens the assistant where the person keeps it: the drawer or the floating widget (#61)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
