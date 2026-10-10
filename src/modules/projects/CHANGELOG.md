# projects — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.2.0 — 2026-10-10

**Added**

- All projects natively (W02): status tabs with counts, search, Company, Client, Manager, Health and Priority filters in the address, table and cards, pages
- Templates, and New project (W03) over any view — blank or from a template with the parts to copy, in the chosen company, with the next code and the end date as baseline
- Clients (W16): list, detail with projects and money, add, edit, archive and restore; contact details hidden from people on none of the client's projects
- a project's page (W04): overview, team and members with load by week, edit, re-add and remove (W05), settings with edit, baseline history and re-baseline, status moves with the server's confirmations, template, delete, activity and files; the board is its Board tab
- the Activity log, Module settings (W17: numbering, money, planning, time, WIP limits, alerts, categories) and the full Dashboard (W01)
- company.tsx, the shared company selector (useProjectCompany, withOrg) on the organisation filter

**Changed**

- /projects/{id} and ?project= open the project's overview (the web's); its board is /projects/{id}/board

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
