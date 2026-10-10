# projects — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.2.0 — 2026-10-10

**Added**

- Timeline & Gantt (W08) — a project's bars on its calendar, critical path and slack in words, milestones, today, planned end vs baseline and the finish forecast, Days/Weeks/Months, Skip weekends, and the dependencies with their lag
- Milestones & billing (W10) — tabs with counts, New/Edit/Delete, Mark achieved (with Mark achieved anyway? and a reason when tasks are open), Ready to invoice in the company's currency, Draft invoices in Billing and Raise invoice, with links to the drafts and what Billing refused
- Sprints (W09) — plan, edit, start, cancel, delete, the committed/added/done/remaining figures and forecast, burndown and velocity, the sprint backlog, and Complete sprint with a retrospective and where unfinished work is carried over
- Team workload — each person's load by week with totals, across the company's projects or one project's
- Time & approvals in full (W11) — the approval queue by person (Approve, Approve all, Send back with a note, Mark billable / non-billable, filters by week, project, person and billing), the Summary by project and by person, Start timer on a project or task, and my week's sent-back notes, lock reasons and Delete

**Changed**

- /projects[/<id>]/timeline, /milestones, /sprints[/<id>], /projects/workload and /projects/time?tab=queue|summary open in the app instead of the browser; the board's Timeline (⌘2) opens here; approvals and every delivery change wait for a connection offline

## 1.1.0 — 2026-10-09

**Added**

- Projects is a desktop app (PRJ-DSK-01, G-13): the project switcher (⌘P), Dashboard, My work, Time & approvals and change requests, pinned and recent projects, and a project's board in a tab — J/K and ←/→ to move about, Shift+←/→ to move a card, Enter to open it, T to start its timer, L to log time, N for a new task, ⌘F to filter, ⌘2 for the timeline on the web, ⌥⌘O for a window of its own; the running timer in the title bar
- the tray timer (PRJ-DSK-02, PRJ-TIM-05): what runs, Stop, Switch to (one click stops it and starts the other), today's and this week's totals, Open timesheet; an always-on-top mini timer with pause, stop and the entry's note; after 15 idle minutes, Keep 15 min or Drop idle time — which leaves exactly one entry
- banners with buttons (PRJ-DSK-03): a change request waiting (Review) and an overdue task (Open task, Snooze 1 day), opening in the app
- My work (PRJ-TSK-05, D03): overdue, today and this week on your own calendar, complete and start a timer from the row, filters, today's time on a line with totals by project, and what waits on you
- offline (PRJ-DSK-04, NFR-09, D04): pinned boards, your tasks and 30 days of your time kept; moves, notes and time kept in an outbox and sent in order, once, when the connection returns; a move the server changed meanwhile asks you (keep theirs or apply mine); approvals, budget and change decisions wait for a connection
- worksuite://projects/{id} and worksuite://projects/{id}/tasks/{task}, and the web's project and task links, open the record here (G-12, acceptance #9)

## 1.0.0 — 2026-10-09

- The baseline: before this module, Projects opened in the browser (the catalogue's `surface: browser`); its first native release is 1.1.0.
