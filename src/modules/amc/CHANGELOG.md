# amc — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.0.1 — 2026-10-26

**Changed**

- the figure cards (KPI, stat and summary tiles) are the shared StatCard — compact, a tinted icon chip and the label above a calm figure, a muted line under it, zero shown muted; cards that open a list are buttons with a focus ring and a soft lift; the same figures and actions as before

## 1.0.0 — 2026-10-21

- AMC & Service on the desktop (WS-AMC-SRS-001 T-15) over the staff API `/api/amc` (WorkSuite docs/amc/API.md), app
  id `amc`, route `/amc?view=…` — the server's own link shape — with its own nav; what the desktop does not draw opens
  on the web.

**Added**
- D-01 dashboard: the server's tiles (requests and SLA, visits today/overdue, contracts, warranties) and its three
  short lists (needs attention, overdue visits, renewals due).
- D-02 dispatch timeline: every technician's day hour by hour (`dispatch/timeline`); drag a waiting request or an
  unassigned job onto a row to give it out at that half hour; pick a job for the dispatch assistant's ranked
  technicians and reasons (`dispatch/suggest`, T-08); tick overdue preventive visits and give them out in one go
  (`dispatch/give-out`).
- D-03 request window, in the main window or popped out on its own (`&solo=1`): details, visits, customer messages
  and history in tabs; Acknowledge / Called the customer (first contact), Give to…, Reopen.
- OS banners for `amc.request.logged` with **Open** and **Give to** (NOT-02); neither acts on the request by itself.
- Contracts, renewals, estimates, units and warranties (and requests) as the server's paged lists — search, filter,
  sort, page — with a read-only detail beside them; changes open on the web.
- Deep links `worksuite://amc`, `amc/dispatch`, `amc/requests/:id`, `amc/contracts/:id`, `amc/estimates/:id`,
  `amc/units/:id`, `amc/warranties/:id`.
- Offline: the last answers under `/api/amc` stay readable (READ_CACHE), marked as saved; every write is off offline.
