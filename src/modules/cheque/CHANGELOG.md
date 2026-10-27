# cheque — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.2.0 — 2026-10-27

**Added**

- read-only offline from the encrypted cache — what was last read, under an "Offline · read-only" banner with its "as of" time; every change waits for the connection and is refused before it is sent; secrets, files, exports and one-time answers are never kept (D-G14)

**Changed**

- colours from the design tokens, light and dark — the hard-coded hex colours are tokens now (D-G23)

## 1.1.1 — 2026-10-26

**Changed**

- the figure cards (KPI, stat and summary tiles) are the shared StatCard — compact, a tinted icon chip and the label above a calm figure, a muted line under it, zero shown muted; cards that open a list are buttons with a focus ring and a soft lift; the same figures and actions as before

## 1.1.0 — 2026-10-25

**Added**

- printed signatures drawn from the signed layout (PNG only), step-up on 428 STEP_UP_REQUIRED, reconcile note, batch from payment run
- start cheques from Expense reimbursements and Billing refunds, returned-cheque letters, the server's PDFs (preview, voucher, calibration sheet, return letter)

## 1.0.1 — 2026-10-25

- Verify the layout hash over layout_canonical; drop JSON_PRESERVE_ZERO_FRACTION reconstruction

## 1.0.0 — 2026-10-25

**Added**

- Cheque Manager is a native desktop module (Cheque SRS v1.0, the desktop boards D01–D06) over `/api/cheque`
  (server docs/cheque-api.md): this computer as the certified print station. Home (D01) with what prints here, what
  waits for approval, a batch that needs attention, the printers here with their profiles and recent prints; the
  print queue (D02) — one bank account per run, in leaf order, with how to load the printer and the profile's
  offsets; direct print and confirm (D03) — printed correctly, or the leaf is unused (stays reserved) or spoiled
  (VOID, next leaf), and a reprint request with a reason; calibration (D04) — the A4 sheet, a test on a voided leaf,
  X/Y nudged by 0.1 mm with where the printer will land, offsets saved to this computer's profile only and each run
  recorded with its residual; batch runs (D05) printed leaf by leaf with pause and stop; and an interrupted batch
  (D06) reconciled leaf by leaf — printed OK, spoiled or blank — with the server's account of what follows before
  anything is committed.
- `CorePrintService` (electron/services/core-print.ts): exact-size printing in millimetres through the OS spooler —
  margins none, scale 100, page size in microns, an extra offset and 180° rotation applied at render — from a hidden
  window with no script and no network, plus Ed25519 checks over canonical JSON. Cheques use it; it is shared for
  any module printing on pre-printed stock.
- The print station protocol of docs/cheque-api.md: this computer registers (`POST /stations`, heartbeat), the job
  is made for this station and claimed by the main process, which prints only when the envelope's signature, device
  id, expiry and layout hash check out and the server's model has no problems, and reports sent / spooled / failed.
  A leaf is never consumed by printing, only by the person's confirmation or a batch's reconciliation.
