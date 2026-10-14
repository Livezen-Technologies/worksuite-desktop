# crm — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.1.0 — 2026-10-14

**Added**

- the six CRM screens follow the new CRM design in the dark navy theme — dashboard headline figures and panels, leads with view counts and a bulk bar, the pipeline board with column and board totals and weighted values, follow-ups tabs with How did it go? / Move / Call off, the account as a Customer 360 page, and the quote on its own page with fixed number columns and a totals block
- company scope — every CRM list, board, dashboard, search and report asks for the company the desktop is showing (org_id), and New lead, deal, account and quote ask which company when All is showing
- follow-ups on deals and accounts (Schedule a follow-up on the deal drawer and the account page), Schedule on the Follow-ups view with a lead/deal/account picker, and follow-ups that open the record they are about
- bulk actions on leads — assign, change status, schedule a follow-up, delete — one request, with what was refused said; StatusBar tallies under leads, accounts, quotes and the board
- Search the CRM groups leads, deals, accounts, contacts and quotes and opens the right record (a contact opens its account)
- Reports (Insight): won against forecast by month, why deals were lost, days in each stage, lead sources and each owner, with Export
- Export as CSV for leads, follow-ups, accounts, quotes and reports; a server without the export gets the rows on screen
- quotes can be marked accepted or declined (with a reason) and converted to an invoice where Billing offers it; a converted quote links to its invoice
- Pipelines and stages in CRM settings — add, rename, default, delete pipelines; add, edit, reorder and delete stages, with the server's refusals explained

**Changed**

- the rail groups are Sales, Catalogue, Insight and Set up (Lead intake, Settings, My access), and shows the company the CRM is showing

**Fixed**

- a converted lead's Open account and a deal's quotes open in the desktop instead of the browser

## 1.0.2 — 2026-10-03

- The sidebar's New button is the shared primary action button: same size, colour, plus icon and quiet shadow as every module; the shortcut is in its tooltip (#171).

## 1.0.1 — 2026-10-01

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
