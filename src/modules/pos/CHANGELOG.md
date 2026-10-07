# pos — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.3.0 — 2026-10-07

**Added**

- the catalogue copy a product a row (pos_products, pos-catalogue.ts) — read whole a page at a time, then only what changed since (catalogue/changes: edits, deletions, prices, categories); a download that stops half way leaves the copy the till had; a copy kept as one blob split into rows on first read; the status counts rows and decrypts no product (worksuite-desktop#296)
- the catalogue brought up to date every catalogue_minutes (30 by default), at once on reconnect, when the till opens and on Sync now (sales and catalogue both); its progress, last sync and errors in the till bar's pill and tooltip, the sync drawer and This till; Online · synced only when sales and catalogue both are
- search on the till's own copy (search.ts) — an index per catalogue version, word starts above the middle of a word, the exact code or barcode first, a scan by map, 150 ms debounce (11 ms worst at 20,000 products); WorkSuite's products/search only while the copy is empty or loading
- product pictures kept for offline (pos-thumbs.ts, /__local/pos-thumb/<id>) within a quota (200 MB), the least recently shown dropped first, all of them when the disk runs low; cleared with the till and in a wipe
- the till's own settings (pos:tillSettings) — Accept card offline (recorded only, no verification), the catalogue's interval, the pictures' room; Sales' Needs review filter and the product_archived and negative_stock flags

**Changed**

- offline the till takes cash only unless Accept card offline is on; the register does not close while sales wait or were refused (online too) — a manager (pos.register.view_all) may close anyway once they confirm

**Fixed**

- the last sync time is stamped only when the sync went through, and a background catalogue refresh that failed is tried again in two minutes, not half an hour

## 1.2.0 — 2026-10-06

**Added**

- customers and loyalty at the counter (D04) — CRM search, quick add with duplicate candidates, the customer card (12-month spend, visits, tier, points, store credit, last purchases), points to spend, points earned on the sale-complete screen, the receipt and the customer display
- a manager's override (D09) — discount past the cashier's rights, refund, void and cash out past the company's figure: approvers, a 6-dot PIN and keypad, or a request sent to the managers and polled; the action is sent again with approval_id, the PIN never kept
- the company's configured tenders — LankaQR, gift voucher (code and balance), store credit and account for a named customer; the old four where none are configured
- stock, promotion badges and pictures on the grid; the category tree and favourites in the category picker; today's top sellers from WorkSuite; promotions and points as lines of the cart's totals (apply_promotions online, promotion_ids [] offline)
- held sales on WorkSuite (park and recall across tills), the local hold kept as the fallback; refund-to and each line's condition in returns; the drawer's X and Z report from WorkSuite; the device's name at pairing and in This till; Forget this till unpairs on the server
- receipts printed by the company's published template (blocks, 58/80 mm, footer, Code 128 or QR); without one the receipt is unchanged byte for byte

**Changed**

- every Phase 2 part is lit only by the server's options.capabilities flags and only online; an older server sees the Phase 1 requests

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
