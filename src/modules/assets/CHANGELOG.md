# assets — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.1.4 — 2026-10-27

**Changed**

- the parts this module shares with others now come from src/components (the page, list, record, form, card, call, console and report kits), and a lint rule keeps modules from importing each other (audit D-G08). Nothing a person sees changes.

## 1.1.3 — 2026-10-27

**Changed**

- colours from the design tokens, light and dark — the hard-coded hex colours are tokens now (D-G23)
- its settings screen uses the shared Settings kit (src/components/SettingsKit.tsx): the same headers, cards and rows as Settings (D-G09)

## 1.1.2 — 2026-10-26

**Fixed**

- its rows that open a record on a click are reached with Tab and opened with Enter or Space (audit D-G21)

## 1.1.1 — 2026-10-26

**Changed**

- the figure cards (KPI, stat and summary tiles) are the shared StatCard — compact, a tinted icon chip and the label above a calm figure, a muted line under it, zero shown muted; cards that open a list are buttons with a focus ring and a soft lift; the same figures and actions as before

## 1.1.0 — 2026-10-25

**Added**

- approve or decline bookings waiting for approval, labels through Label Studio and labels printed recorded, licence subscription, Inventory warehouse on consumable moves

## 1.0.0 — 2026-10-25

**Added**

- Assets is a native desktop module (WS-ASSET-SRS-001 T-17, the "Assets — Desktop" boards D01–D26) over
  `/api/assets` (server Assets 1.1), with its own rail: Dashboard (D04, with the "belong to no company" notice and
  D26's filing screen), All assets (D01: filter box that takes a USB-scanner scan, ↑↓ ↵, ⌘↵ / double-click for a new
  tab, the selected asset beside the list, Export to CSV), one asset (D05 overview, D06 custody with the handover
  note as PDF and Record return, D07 the server's depreciation schedule, upkeep, documents with drag-to-attach,
  history; E / R / T / ⌘P), Add / edit (D08, ⌘N, ⌘S), My equipment (D09: confirm a handover, report a problem,
  request equipment), Requests with bulk decide and Issue… (D10, D11), Transfers (D12), Bookings (D13), Maintenance
  (D14), Preventive plans (D15), Licences with a logged key reveal (D16), Consumables (D17), Audit runs by scan or
  F / E / M (D18), Disposal & write-off (D19), Reports with Copy, CSV, PDF and Print (D20), Import & export (D21),
  Labels (D22), Lists & fields (D23), Settings with This computer (D24) and the Activity log (D25).
- The scan station (D02): Issue, Return, Loan out / in and Look up with a keyboard-wedge barcode or QR scanner; an
  ID card's employee number picks the person; refusals are logged as the server gave them.
- Labels (D22): QR, Code 128 or both, on a 62 mm roll, a 1 in thermal label or an A4 sheet, to the printer chosen for
  this computer, or saved as PDF.
- Alerts and tray (D03, `electron/services/assets-alerts.ts`, `shared/assets.ts`): handovers to confirm, loans
  overdue and approvals waiting raise a notification once each with the tab closed; `asset.*` notices open the right
  screen and carry "I received it" / "Approve" / "Open booking" buttons that open it; the tray has "Assets · N waiting
  for you", Open scan station, My equipment and Report a problem.
- Offline: the register, assets opened, my assets and the lists are read from the encrypted cache (never a licence
  key); every act is off until WorkSuite is back.
- Assets 1.1 endpoints (`resolve`, `checkout`/`checkin`, `bookings`, `plans`, `issues`,
  `assignments/{id}/acknowledge`, `people`, `import`) are used where the server has them; on an older server the scan
  station falls back to the register's exact-match search, loans to an issue with a due date, and the rest say they
  need a newer server.
