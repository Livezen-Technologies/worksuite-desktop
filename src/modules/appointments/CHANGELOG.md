# appointments — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.0.0 — 2026-10-25

**Added**

- Appointments is a native desktop module (Appointments SRS v1.0 §9, the desktop boards D01–D24) over the server's
  `/api/appointments`, replacing the browser page. Its own 88px rail: Today, Calendar, List, Walk-in, Clients,
  Waitlist, Outbox, Reports, Commission, Set up, with the connection, location and desk at the foot
- D01 Today board (arriving — late and the next two hours —, waiting, in service, to check out) with each card's next
  move and a running-late banner; D02 calendar day by stylist with working hours, a mini-month and a stylist filter;
  D04 week for one stylist; Pending and Confirmed cards drag to a new time or stylist — the drop asks why, the server
  checks it like a new booking, and a refusal leaves the card where it was with the reason
- D05 list with queues, filters, ↑ ↓ Enter Space C and Export CSV; D06 new appointment from the server's free times
  (a new client added in place, a deposit said up front); D07 walk-in — who is free now, book and check in
- D08 appointment panel beside any screen or popped out, with D09 check-in, D10 move by week of free times, D11
  cancel with a reason or no-show (and Undo no-show), D12 deposit — taken now (a Billing payment linked as the
  deposit, with a deposit slip) or an unallocated payment linked; failed customer messages are sent again from it
- D03 checkout with the server's quote (retail tiles and scan, stock used, discount where allowed), the deposit
  applied, and D13 the payment recorded in Billing against the invoice with the 80/58 mm receipt printed through the
  desktop's print service
- D14 clients with a preview card; D15 client history with staff-only notes (add, pin, edit, withdraw); D16 waitlist
  with freed-time offers (on a server that has `/api/appointments/waitlist`); D17 reports with Print and Export CSV;
  D18 commission — mark paid, void with a reason, statements, CSV; D19 set-up of stylists' blocks; D20 this desk
  (location, receipt and A4 printers, roll width, print with each payment, running-late alerts); D22 notifications
  about appointments; D23 day sheets per stylist, printed or saved as PDF; D24 command palette (⌘J) and desk keys
  (N, F2, T, D, W, ← →, C, M)
- D21 offline: the day as last read; check-ins and other status moves and client notes wait in the encrypted outbox
  and are sent in order when WorkSuite is back; a refusal stays there with its reason to retry or dismiss. Booking,
  moving, checkout, deposits and set-up are off offline
