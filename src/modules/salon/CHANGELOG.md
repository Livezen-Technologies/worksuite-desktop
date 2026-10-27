# salon — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 2.0.3 — 2026-10-27

**Changed**

- colours from the design tokens, light and dark — the hard-coded hex colours are tokens now (D-G23)

## 2.0.2 — 2026-10-26

**Fixed**

- the calendar's tap-to-book columns are marked as a pointer shortcut; New booking does it from the keyboard (D-G21)

## 2.0.1 — 2026-10-26

**Changed**

- the figure cards (KPI, stat and summary tiles) are the shared StatCard — compact, a tinted icon chip and the label above a calm figure, a muted line under it, zero shown muted; cards that open a list are buttons with a focus ring and a soft lift; the same figures and actions as before

## 2.0.0 — 2026-10-06

Major because the printer settings kept on this computer can now hold A4 or Letter receipt paper, which 1.x cannot
print, and `salon:printSettingsSet` accepts them; the outbox kept on this computer can now hold a `visit.checkout` (a
POS offline sale) that 1.x cannot send, and `salon:outboxAdd` and `salon:deskPair` accept more. Needs the server's
Salon 1.1.0 for products used, the desk's stock location and template, offline sales and sending the receipt.

**Added**

- the front desk redrawn to the SalonMate desktop design (D01–D17). An icon rail — Today, Calendar, Walk-in, Clients, Checkout, Register, Sync, Settings — with whether the desk is online, its register and its printer at the foot; buttons sized for touch throughout
- deposits taken at the desk into the open POS register, from Today, the calendar, and a new booking's Book · take deposit
- New booking by touch — services back to back, each with its stylist or whoever is free, a day strip, every start with taken times struck through, and the deposit a watch-list client is asked for
- Service record — formula, technique and timings, Same as last time, before and after photos from the webcam or a file, and whether the client agrees to website use
- Add retail from the POS catalogue as a sheet — categories, stock, barcode scan, quantities and who sold it
- Paid shows the drawer, store credit, points and advance, what was printed, and the receipt beside it
- Today shows what is owed, chair time booked, the 30-day no-show rate and what needs attention; a tap on free time on the calendar books it
- receipts on A4 or Letter as well as 80 mm and 58 mm rolls
- the calendar's Week and List views: the week a column a day, and as a list narrowed by stylist, state, allergy or a name (CAL-02)
- products used on the service record — from the service's recipe, with the desk's stock to add from, and a check against the client's allergies; checkout takes them from the desk's stock (REC-01, CHK-11)
- the stock location and receipt template chosen when the desk is paired, and changed in Settings by somebody who manages desks (DSK-02); receipts print in the desk's template
- WhatsApp receipt and Email receipt on Paid, to the client's mobile or address, or one typed for this receipt (D07)
- taking payment offline on a desk paired as a POS till: cash or card, a till receipt numbered in the desk's own series, and the invoice issued when WorkSuite answers (POS-11); closing the register waits until they have gone

**Changed**

- Printers & receipts are kept with Save, beside a preview of the test receipt; the desk's details, the owners' screens and Pair this computer again move there from the rail
- Sync numbers what waits, offers the stylist's free times nearest a refused booking, and says how the last send went
- the calendar colours bookings by status, marks allergy, advance and deposit owed, and hatches leave and block-outs

## 1.0.1 — 2026-10-01

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
