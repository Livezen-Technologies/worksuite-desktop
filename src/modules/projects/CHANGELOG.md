# projects — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.3.0 — 2026-10-11

**Added**

- New project starts from a template (#337) — search, Blank, Copy an existing project, Company templates, My templates and the built-in Template packs by category; each card with icon, one line and tags
- choosing a template fills the form (name, category, priority, billable, estimated hours, budget, description, start as), with what to include, a person for each role, a tender to link, and a Preview tab that lays the phases and tasks on the chosen dates — working days, skipping public holidays — the same way the server builds them (templates.ts schedule())
- Create project builds the whole project in one call (POST /api/projects/from-library), shows progress for a large template, says what was not applied, and opens the project; the footer reads 'Created from template X vN'
- Templates page — packs, company, mine and archived; duplicate, edit (name, scope, plan as JSON), version history and restore, archive, export and import as JSON, usage count
- Save as template from any project with the parts to include and personal or company scope; the project page names the template it was made from

**Fixed**

- New project's Budget shows the amount beside the currency; Starts and Ends use the app's date field (DateField, '11 Oct 2026', typed day first or picked) instead of yyyy-mm-dd

## 1.2.0 — 2026-10-10

**Added**

- All projects natively (W02): status tabs with counts, search, Company, Client, Manager, Health and Priority filters in the address, table and cards, pages
- Templates, and New project (W03) over any view — blank or from a template with the parts to copy, in the chosen company, with the next code and the end date as baseline
- Clients (W16): list, detail with projects and money, add, edit, archive and restore; contact details hidden from people on none of the client's projects
- a project's page (W04): overview, team and members with load by week, edit, re-add and remove (W05), settings with edit, baseline history and re-baseline, status moves with the server's confirmations, template, delete, activity and files; the board is its Board tab
- the Activity log, Module settings (W17: numbering, money, planning, time, WIP limits, alerts, categories) and the full Dashboard (W01)
- company.tsx, the shared company selector (useProjectCompany, withOrg) on the organisation filter
- Timeline & Gantt (W08) — a project's bars on its calendar, critical path and slack in words, milestones, today, planned end vs baseline and the finish forecast, Days/Weeks/Months, Skip weekends, and the dependencies with their lag
- Milestones & billing (W10) — tabs with counts, New/Edit/Delete, Mark achieved (with Mark achieved anyway? and a reason when tasks are open), Ready to invoice in the company's currency, Draft invoices in Billing and Raise invoice, with links to the drafts and what Billing refused
- Sprints (W09) — plan, edit, start, cancel, delete, the committed/added/done/remaining figures and forecast, burndown and velocity, the sprint backlog, and Complete sprint with a retrospective and where unfinished work is carried over
- Team workload — each person's load by week with totals, across the company's projects or one project's
- Time & approvals in full (W11) — the approval queue by person (Approve, Approve all, Send back with a note, Mark billable / non-billable, filters by week, project, person and billing), the Summary by project and by person, Start timer on a project or task, and my week's sent-back notes, lock reasons and Delete
- Budget & cost natively (W12) — the portfolio's totals for one company in its reporting currency at Finance's rates, each project in its own currency, the projects Finance has no rate for named, how a budget moved and labour by person; one project's budget at /projects/<id>/budget; Export saves the budget report as CSV
- Risks natively (W13) — the register by score with Open, Mitigating, Realised, Closed and All, the impact × probability heat map in words, Raise a risk, edit, delete (with project.manage), read-only otherwise; one project's at /projects/<id>/risks
- Change requests in full (W14) — every request in reach with Waiting, Approved, Rejected and All and their counts, a project filter, Raise, Withdraw for the raiser, and the decision with what approval does (budget, end date and hours before and after, the health it would then have), a note required to reject, and moving the baseline with an agreed delay; one project's at /projects/<id>/changes
- Reports natively (W15) — all ten reports at /projects/reports/<kind> with company, period and client filters, Export as CSV, Excel or PDF saved through the download manager (transfers:download projectsReport), Schedule email and the Scheduled emails list (Send now, Pause/Resume, Edit, Delete)
- /projects/board opens the board of the project last worked in, and a project's page shows all of the web's tabs over its board, timeline, milestones, sprints, budget, risks and changes

**Changed**

- /projects/{id} and ?project= open the project's overview (the web's); its board is /projects/{id}/board
- /projects[/<id>]/timeline, /milestones, /sprints[/<id>], /projects/workload and /projects/time?tab=queue|summary open in the app instead of the browser; the board's Timeline (⌘2) opens here; approvals and every delivery change wait for a connection offline
- links to /projects/budget, /projects/risks, /projects/reports and a project's budget, risks and changes open in the app; the rail has a Governance group; every governance write waits for a connection
- the rail is grouped as the web's (Portfolio, Work, Delivery, Governance, Administer); the one Projects page left on the web is a project's own Time tab
- one kit for every screen (screens/kit.tsx); the governance screens use company.tsx's CompanySelect

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
