# billing — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.3.3 — 2026-10-27

**Changed**

- the parts this module shares with others now come from src/components (the page, list, record, form, card, call, console and report kits), and a lint rule keeps modules from importing each other (audit D-G08). Nothing a person sees changes.

## 1.3.2 — 2026-10-27

**Changed**

- colours from the design tokens, light and dark — the hard-coded hex colours are tokens now (D-G23)
- its settings screen uses the shared Settings kit (src/components/SettingsKit.tsx): the same headers, cards and rows as Settings (D-G09)

## 1.3.1 — 2026-10-26

**Changed**

- the figure cards (KPI, stat and summary tiles) are the shared StatCard — compact, a tinted icon chip and the label above a calm figure, a muted line under it, zero shown muted; cards that open a list are buttons with a focus ring and a soft lift; the same figures and actions as before

## 1.3.0 — 2026-10-15

- Billing SRS-BIL-001: D1–D3, send, pay links, native settings

**Added**

- D1 dashboard, D2 invoice (Send, Record payment, PDF and ⋯ up front; a Details side panel with payments, reminders and the pay link) and D3 record payment (the company's payment modes and bank account, the oldest-first split shown, the bank slip dropped on the panel, another currency at a rate).
- The Send dialog (W12, G-05): to and cc, a message template, subject and message, the PDF, a "Pay now" link and WhatsApp, with the server's preview drawn in a sandbox.
- Pay links (G-02/G-03): copy, show as a QR, regenerate, revoke.
- Approval before issue (G-14): submit, approve and reject. Cancelling says the journal is reversed (G-01); a locked period's `period_locked` refusal offers a credit note instead.
- Bulk issue, send, PDF, mark as sent, record payment and cancel, with each refusal and its reason (G-13); exports of invoices, payments, credit notes, customers and reports as CSV, XLSX or PDF, saved to disk; attachments (G-26); statements (G-05); a dispute flag.
- Multi-line credit and debit notes (G-22), unapply and refund credit (G-16); cross-currency allocation (G-17); refunding through the gateway that took the payment.
- Native settings (G-37): payment gateways (catalogue, accounts, a form from each gateway's credentials spec with write-only secrets, test), the CRM connector, WooCommerce stores and members — plus payment reminders and message templates.
- Native banners for the eight `billing.*` events, opening the invoice, payment, note or profile (`shared/billing.ts`); the web's record paths open here; Billing reads offline as last seen, read only.

## 1.2.0 — 2026-10-03

- The organisation filter is the shared compact switcher (#214): one pill, search, several at once, a default organisation, remembered per person.

## 1.1.1 — 2026-10-03

- The sidebar's New button is the shared primary action button: same size, colour, plus icon and quiet shadow as every module; the shortcut is in its tooltip (#171).

## 1.1.0 — 2026-10-02

- Supporting sales links (#96) open the specified company’s issued sales invoices for a calendar date. Preserve the filter in API queries and display its reporting exclusions; avoid displaying stale report records while the scope changes.

## 1.0.1 — 2026-10-01

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
