# sales — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.3.1 — 2026-10-26

**Changed**

- the figure cards (KPI, stat and summary tiles) are the shared StatCard — compact, a tinted icon chip and the label above a calm figure, a muted line under it, zero shown muted; cards that open a list are buttons with a focus ring and a soft lift; the same figures and actions as before

## 1.3.0 — 2026-10-25

- Printers on this computer says that label printers are Label Studio's where the organisation has Label Studio, and
  opens Label Studio › Printers (WS-LABEL-SRS-001 §2.1: superseded when the module is on, kept for installs without it).

## 1.2.0 — 2026-10-15

- Sales (OMS) SRS v1.1: D-01…D-14, shipping desk, dispatch
  - Approvals (D-05): the queue waiting on me, decided with A / R / Enter; native banners with Approve and Open (`oms.approval`), Approve decides from the banner; the tray, the Dock and the rail count the queue (`/api/badges` `sales`), once.
  - Keyboard (FR-DSK-03): ↑/↓, Enter, Space, ⌘/Ctrl+N, ⌘/Ctrl+F, Esc; an order opens in a new tab or its own window (FR-DSK-04).
  - Orders and the drawer: overdue, payment and date filters, saved views, comments with mentions, cancel with a reason, retry a failed hand-off, payment link, re-order, approval preview and coupon check on New order.
  - Printing on this computer (FR-DSK-06, FR-LBL-06): a printer per kind (Settings › Printers); labels as raw ZPL through the system's raw print path, or PDF; delivery notes laid out from Inventory's record; reports saved as the server's PDF.
  - Offline (FR-DSK-07): order lists, orders, the dashboard and the companies read from this computer's copy; every write waits for the connection.
  - Shipping desk (D-13): scan the note, check items, weigh, choose a courier, book, label prints by itself; close the day with the manifest. Dispatch board (D-14): live routes, stops, ETA and cash.
  - New main-process service `electron/services/sales-desk.ts` (+ `shared/sales.ts`, `shared/ipc/sales-channels.ts`), now this module's paths.

## 1.1.0 — 2026-10-03

- The organisation filter is the shared compact switcher (#214): one pill, search, several at once, a default organisation, remembered per person.

## 1.0.3 — 2026-10-03

- Sync buttons use the shared Sync button: they spin from the click, can't be pressed twice, show Synced just now or Sync failed · Retry, and keep one width (#165).

## 1.0.2 — 2026-10-03

- The sidebar's New button is the shared primary action button: same size, colour, plus icon and quiet shadow as every module; the shortcut is in its tooltip (#171).

## 1.0.1 — 2026-10-01

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
