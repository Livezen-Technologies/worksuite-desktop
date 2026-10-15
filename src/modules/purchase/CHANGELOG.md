# purchase — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.0.0 — 2026-10-15

- Purchasing SRS-PUR-001 G-21: a dedicated Purchasing app in the desktop registry (`purchase`, over Inventory's tables), with the full rail.

**Added**

- Dashboard (S-01): awaiting approval with the documents waiting on me, awaiting delivery, late deliveries, received and not billed, owed to vendors by age, committed each month, where the money goes, and what needs attention.
- Waiting on me (G-14): the cross-document approvals queue (`GET /api/purchase/approvals?mine=1`) — orders, requests, returns and bills — with Approve, Reject (with a reason) and Open.
- Requests (S-02): new request, the approval chain (submit, approve, reject), raise from what is below minimum, request quotes, turn into draft orders.
- RFQs (G-17): the bid comparison with cheapest and fastest marked, per-line award (the cheapest by default), the split into one draft order per vendor, savings against target, send to vendors; the assistant's summary where the server has AI.
- Purchase orders (S-03, S-05; the "Desktop Purchasing" design): a dense grid with a detail pane — received, billed and paid; the three-way match with each line's landed cost (G-03); the approval chain with Submit, Approve and Reject (G-01); Send with to, cc, message, PDF and portal link (G-05); Close short with a reason (G-06); the rate on an order in another currency and its value in the company's own (G-02); possible duplicates (G-13). Keyboard: ↑↓ move, Enter open, A approve, R receive, / filter.
- Order form: currency and exchange rate, and the server's `possible_duplicate` warning with Save anyway.
- Receiving by scan (S-06; the "Desktop receiving" design): one scan box for the order, each item and each serial; another order's number is refused while one is open; F2 damaged, F3 quality hold; post to stock with ⌘/Ctrl+Enter, or save a draft. Goods received keeps the receipt editor, with Return goods on a posted receipt.
- Quality hold (G-07): release into stock, or reject with a reason and start a return.
- Landed costs (G-03): landed-cost vouchers for freight, duty or insurance that came after the goods, spread over a receipt by value or quantity, with what went into stock and what was expensed.
- Vendor bills (S-08): ageing per currency with a base total, the bill with its match and approval chain (approve, or reject as disputed), payments set against it; enter a bill against an order.
- Payments (S-09) and payment runs (G-20): record a payment in another currency at a rate, set oldest first; propose a run, approval by somebody else, the bank file as CSV or ISO 20022 pain.001 saved on this computer, mark paid.
- Returns (S-07, G-19): from a posted receipt, the approval chain, ship with carrier and tracking, the debit note; a replacement is expected on the order.
- Vendors (S-10) with the weighted scorecard (G-25); Replenishment; Agreements (G-18) — blanket, contract and recurring, release orders.
- Reports (S-11, G-26, G-27): where the money went, spend by department and by project, order cycle time, RFQ savings, maverick spend, vendor delivery — saved as CSV, Excel or PDF.
- Native banners for `purchase.approval` with Approve and Open (`electron/services/purchase-desk.ts`, `shared/purchase.ts`); the documents waiting on me count on the tray and Dock badge, and the tray offers "Purchases to approve".
- The narrow permissions of G-04 (`purchase.request`, `purchase.order`, `purchase.receive`, `payables.bill`, `payables.pay`, `payables.allocate`, with `inventory.purchase` the umbrella for buying, not for paying); offline, Purchasing reads as last seen and every write waits for the connection.

**Changed**

- Purchasing, Vendors and Replenishment moved here from Inventory (`buying.ts`, `Purchasing.tsx`, `Vendors.tsx`, `Replenishment.tsx`).
