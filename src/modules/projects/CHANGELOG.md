# projects — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.2.0 — 2026-10-10

**Added**

- Budget & cost natively (W12) — the portfolio's totals for one company in its reporting currency at Finance's rates, each project in its own currency, the projects Finance has no rate for named, how a budget moved and labour by person; one project's budget at /projects/<id>/budget; Export saves the budget report as CSV
- Risks natively (W13) — the register by score with Open, Mitigating, Realised, Closed and All, the impact × probability heat map in words, Raise a risk, edit, delete (with project.manage), read-only otherwise; one project's at /projects/<id>/risks
- Change requests in full (W14) — every request in reach with Waiting, Approved, Rejected and All and their counts, a project filter, Raise, Withdraw for the raiser, and the decision with what approval does (budget, end date and hours before and after, the health it would then have), a note required to reject, and moving the baseline with an agreed delay; one project's at /projects/<id>/changes
- Reports natively (W15) — all ten reports at /projects/reports/<kind> with company, period and client filters, Export as CSV, Excel or PDF saved through the download manager (transfers:download projectsReport), Schedule email and the Scheduled emails list (Send now, Pause/Resume, Edit, Delete)
- the company selector's shared module (company.tsx: useProjectCompany, withOrg); portfolio reads carry the chosen company

**Changed**

- links to /projects/budget, /projects/risks, /projects/reports and a project's budget, risks and changes open in the app; the rail has a Governance group; every governance write waits for a connection

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
