# pos — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.1.0 — 2026-10-06

**Added**

- the counter redesigned for touch — the till bar (till and register, online pill, clock, cashier, Lock, the till's menu) and full-screen counter mode
- a paged five-by-three product grid or list, categories with their counts, recent categories, the quick-action bar, F2 search and F12 pay
- up to five open sales on a till as tabs (Ctrl+N, Ctrl+1…5), and held sales for 24 hours, kept sealed by the main process (pos:carts, pos:cartsSave)
- payment on two panes with the keypad, the sale-complete screen with the receipt on screen, cash in and out and returns from the counter
- receipts print the tax by rate (VAT 18%) and the receipt number as a Code 128 barcode

**Changed**

- opening and closing the register on two panes; closing waits while a sale is open or held on the till
- pairing, the till's settings (device cards) and the customer display redesigned; the side rail's items moved into the till bar's menu

## 1.0.3 — 2026-10-02

- Route missing interface translations through the shared catalog and missing-string tracker (#60).

## 1.0.2 — 2026-10-01

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.0.1 — 2026-10-01

**Fixed**

- the build on macOS and Windows, where a screen and its helper file had names that differed only in case (the screen is now TenderPanel.tsx and ShiftScreen.tsx)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
