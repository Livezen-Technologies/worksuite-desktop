# salon — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 2.0.0 — 2026-10-06

Major because the printer settings kept on this computer can now hold A4 or Letter receipt paper, which 1.x cannot
print, and `salon:printSettingsSet` accepts them.

**Added**

- the front desk redrawn to the SalonMate desktop design (D01–D17). An icon rail — Today, Calendar, Walk-in, Clients, Checkout, Register, Sync, Settings — with whether the desk is online, its register and its printer at the foot; buttons sized for touch throughout
- deposits taken at the desk into the open POS register, from Today, the calendar, and a new booking's Book · take deposit
- New booking by touch — services back to back, each with its stylist or whoever is free, a day strip, every start with taken times struck through, and the deposit a watch-list client is asked for
- Service record — formula, technique and timings, Same as last time, before and after photos from the webcam or a file, and whether the client agrees to website use
- Add retail from the POS catalogue as a sheet — categories, stock, barcode scan, quantities and who sold it
- Paid shows the drawer, store credit, points and advance, what was printed, and the receipt beside it
- Today shows what is owed, chair time booked, the 30-day no-show rate and what needs attention; a tap on free time on the calendar books it
- receipts on A4 or Letter as well as 80 mm and 58 mm rolls

**Changed**

- Printers & receipts are kept with Save, beside a preview of the test receipt; the desk's details, the owners' screens and Pair this computer again move there from the rail
- Sync numbers what waits, offers the stylist's free times nearest a refused booking, and says how the last send went
- the calendar colours bookings by status, marks allergy, advance and deposit owed, and hatches leave and block-outs

## 1.0.1 — 2026-10-01

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
