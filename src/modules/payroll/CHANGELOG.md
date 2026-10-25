# payroll — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.0.0 — 2026-10-25

**Added**

- Payroll is a native desktop module (WS-PAYROLL-SRS-001 §D1, the desktop boards D01–D25) over `/api/payroll`
  (server Payroll 1.2.0, docs/payroll-api.md), with its own rail: Home (period, current run, needs attention,
  12-month trend, pay calendar); Runs with status pills, pay-group filter, ↑↓ ↵, ⌘↵ new window and double-click new
  tab; New run (⌘N); the run workspace — Summary, Employees with the selected person's lines, Variance against the
  last run with a threshold, Validation with accept-in-writing, Journal with Post to Finance, Payslips, Payment,
  History — Recalculate (⌘R), Submit, Reject with a reason; Approve run with the checks (different person, blocking
  issues, warnings, variance), the approval chain, a note to the preparer, Touch ID where the computer has it, and
  the journal preview
- Employees with readiness, the pay profile with salary history, approvals and loans, Change salary (a proposal for
  a second person; arrears are the server's); period inputs with drag-and-drop CSV checked as a dry run first; loans
  and advances; final settlements from the HR offboarding case, refused while clearance is open
- Payslip centre with preview (Space) and Save all PDFs, the payslip template (⌘S), disbursements with Save bank
  file… (SHA-256 checked on this computer, written 0600), sent and Mark paid; statutory returns and rule packs;
  reports with Save CSV…; setup (components, structures, pay groups and calendars with Generate <year>); settings
  (⌘S)
- Tray reminders for the cut-off, runs waiting for approval and the pay date, even with the tab closed, and
  `payroll.*` notifications open the right screen (D24)
- Offline, the runs and screens read from the encrypted cache and every action is off, with "Offline · showing
  cached data" (D25)
