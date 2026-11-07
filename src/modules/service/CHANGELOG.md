# service — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.0.0 — 2026-11-07

**Added**

- Service & Repair on the desktop: dashboard, repair jobs and the job card (status steps, diagnosis, parts, quotations, QA and handover, activity), the Kanban board, check-in with device intake checklists and consent, and the device registry, over `/api/v1/service`
- Inventory and Billing wired in: add a stocked part from Inventory (what is free shown) or the customer's own, release a reservation or return a used part as defective, pick quotation part lines from Inventory, make the job's invoice in Billing from the approved lines and open it in Invoices, and open a part in Inventory
