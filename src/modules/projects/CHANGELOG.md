# projects — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.6.4 — 2026-10-26

**Fixed**

- its rows that open a record on a click are reached with Tab and opened with Enter or Space (audit D-G21)

## 1.6.3 — 2026-10-26

**Changed**

- the figure cards (KPI, stat and summary tiles) are the shared StatCard — compact, a tinted icon chip and the label above a calm figure, a muted line under it, zero shown muted; cards that open a list are buttons with a focus ring and a soft lift; the same figures and actions as before

## 1.6.2 — 2026-10-26

**Fixed**

- a card dragged on the project board no longer jumps back to its old column while a poll was on its way (#430)

## 1.6.1 — 2026-10-16

- Page heads wrap their actions under the title on a narrow or scaled-up window

## 1.6.0 — 2026-10-16

**Added**

- a project's external members on its Team tab — clients and people at other companies, with company and role (client, collaborator, observer); Add someone outside (name, email, company, role, note) or someone at another company found by search (guest-candidates?q=), Edit and Remove for can_manage, online only
- Share with client in the project's header — its password-protected status links (who for, sections, expiry, views, Active / Expired / Withdrawn) with Withdraw and Change password, and New link: label, for, password and confirm (8+, Generate a strong one, Copy), sections (progress, milestones, timeline, updates on by default; tasks), optional expiry, Email the link to them for an external member; the address shown once with Copy and the reminder to send the password separately
- client updates in the same dialog — listed for everyone, posted, edited and deleted by the project's manager, a lead or project.manage
- Export report in the project's header — the whole project as PDF or Excel through the download manager (transfers:download with projectReport → GET /api/projects/{id}/report?format=pdf|xlsx), opened when it lands

## 1.5.0 — 2026-10-14

**Added**

- a project task opens in the task modal (PRJ-TED-01..10, D06) — the Tasks app's editor, centred (up to 1180 × 860) over a dimmed board, list, My work, Time, Milestones or a notification's link, /projects/<id>/tasks/<task> and ?task=; it replaces the side panel (TaskPanel), which is gone
- its header — Project › number, the type, Saving…/Saved, Copy link (⌘L / Ctrl+L), a window of its own (⌥⌘O / Ctrl+Alt+O), ⋯ Duplicate, Convert to sub-task of…, Move to another project…, Save as template task, Archive, Delete…, and Complete / Reopen (completed / to do, never the Tasks app's done; ⌘Enter / Ctrl+Enter)
- the Tasks editor's title, description, checklist, attachments and conversation, with Dependencies (waits on / blocks, a picker on the same project, a loop refused with the tasks named) and Time (logged against the estimate, Start timer, Log time, entries Pending / Approved / Sent back / Invoiced with a lock); the side panel's Status in the project's words (Blocked asks why first), Priority, Assignee and Reviewer from the members, Start, Due, Reminders, the Project group (Project read-only, Type, Sprint, Milestone, Parent, Points, Estimate, Billable, the blocked reason), Tags, Progress, Company (read-only), Watchers and Review
- one read, GET /api/tasks/{id} with its project block (GET /api/projects/tasks/{id} on an older server); each change through the endpoint that owns its rule — Tasks fields to /api/tasks/{id}, the project's to PUT /api/projects/tasks/{id}, the status as the board's move; what the reader may not change is shown read-only with the reason, never hidden (PRJ-TED-08)
- offline it opens from the copy kept on this computer with a banner; the status, a comment and logged time go to the outbox, everything else says it needs a connection, and what waits or needs your choice is named in the modal
- T timer, L log time, J/K the next and previous task of the view behind without closing; Time's entries and a milestone's tasks open the modal

## 1.4.0 — 2026-10-14

**Added**

- a project's tasks as a list (PRJ-LST-01..10, D05) — the Board | List switch beside the title and ⌘⇧L / Ctrl+Shift+L, /projects/<id>/board?view=list and /projects/<id>/list; switching keeps the filter and the selected task, a task opened from the list and New window keep the view
- the view a project opens in and the list's layout (group, sort, columns, collapsed groups, quick filters) remembered per person and per project in /api/prefs/projects.task_view(.p<id>), shared with the web, with a copy on this computer for offline
- columns Number, Title (Bug, blocked reason, what waits in the outbox), Status, Assignee, Priority, Due (late in words), Sprint, Milestone, Points, Logged / estimate (over in red) and Updated, with a column chooser; group by Status (board order, counts, points, WIP warning, Completed collapsed), Assignee (open count, load), Sprint, Milestone, Priority or None; header sort asc → desc → off, shift-click adds a key; quick filters Mine, Overdue, Blocked, Bugs, Hide completed
- inline Status — the board's own move and outbox entry, a reason asked for Blocked — and Assignee, Priority and Due; ticked rows (Space, Shift-click for a range) moved, assigned, prioritised, put in a sprint, given a due date or deleted together through POST tasks/bulk, the answer read as '2 updated, 1 refused' naming each refused task (one by one on a server without tasks/bulk); offline, status moves still queue and every other edit and bulk say they need a connection
- the list's keys — J/K and ↑/↓, Home/End, Enter, Space, ⇧←/→ change status, T timer, L log time, N new task in the focused group, ←/→ on a group header, Esc; a treegrid with aria-sort and aria-expanded, moves and bulk results announced, 150 rows drawn at a time; Export CSV of the rows and columns as shown (UTF-8 with a BOM) through the save dialog
- the board's column headers show the WIP warning ('WIP 4 of 3') when the server sets a limit (PRJ-TSK-04)

**Changed**

- web links to /projects/<id>/list open here

## 1.3.1 — 2026-10-13

**Changed**

- the offline outbox follows the open account (Connection & Startup)

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
