# inventory — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.4.0 — 2026-10-15

**Added**

- Dashboard (D1, "Desktop inventory dashboard"): "Inventory dashboard" with Open in new window and Receive goods; five
  tiles (stock value, units on hand, low, out of stock, adjustments to approve); a large "Coming in and going out"
  chart (received / issued, 14 days) beside a **This computer** card — barcode scanner heard or not, the label
  printer, the offline copy (products · warehouses · size) and changes waiting to sync.
- Rail: grouped Workspace / Control / Trade / Insight / Setup / Administration / **Desktop** (Scanner & printer,
  Offline data → "This computer" screen: printers, offline copy size, queued changes, Try to sync now, Clear offline
  copy); **Receiving** under Trade for those who may receive goods; count badges red (stock stays amber); 32 px rows.
- Products in tabs (D2): opening a product shows it in a tab beside a compact list (picture, name, code · category,
  on hand / low / out); several stay open (up to 8, on the address `?tab=prod&open=…&product=…`, so they survive a
  restart); × or middle-click closes a tab and shows its neighbour. Right-click (or Shift+F10) on any row: Open in new
  tab, Open in new window (⌘/Ctrl+↵), Open Product 360, Print label (⌘/Ctrl+P), Adjust stock, Duplicate, Edit. The
  search box takes a scan: an exact code or barcode opens the product.
- Duplicate a product: a new product filled in from another, without its code and barcode.
- Offline stock count (D3): a sheet open for counting takes the whole screen — one scan box (each scan adds 1, a
  typed number sets the line), Product / Bin / Expected / Counted / Variance / Saved, the just-scanned line
  highlighted. Works offline from this computer's copy: counts are kept at once in the encrypted draft store, sent as
  one "save lines" write through the app's offline queue (sent now, or queued and replayed in order), and each line
  says where it is — on this computer, waiting to send, sent HH:MM, or changed online (choose which to keep). A
  "Waiting to send" side panel with Try to sync now; Post to stock is disabled offline ("needs connection") and sends
  anything unsent first; Print sheet prints a count sheet. Unknown codes are refused ("… is not on CNT-…"); a barcode
  WorkSuite resolves online is learnt so it scans offline too.
- Receive with scanner (D4, `?tab=rcv`): scan the PO, then each item or serial — Purchasing's scan rules (wrong item
  and over-quantity refused, duplicate serial refused) plus: a serial WorkSuite already knows is refused with the unit
  it belongs to (`GET /api/inventory/scan`); a table with per-line progress bars, Ordered / Scanned / Serials / Bin;
  "N more to scan"; F2 damaged, F3 quality hold, ⌘/Ctrl+Enter posts; Save draft / Post receipt (online only); a Unit
  labels panel (50 × 25 mm, QR of the serial) printing after each scan or "Print N labels now". Scanner keystrokes
  are taken even when the scan box has lost focus.
- Product 360 (D5, V2, `?tab=p360&pid=…&p3=…`), from the product pane, the drawer and the row menu: header with
  completeness, Open in browser and Save (⌘/Ctrl+S); tabs Overview (completeness by section with links, stock and
  reach, pricing with masked cost, channels, SEO health, top documents, activity), General, Media (drop photos from
  Finder/Explorer — HEIC to JPEG, large photos reduced; role, alt text, public, order, remove; "From this computer"
  list), Variants (matrix axes, combinations, missing, Generate missing; bulk barcodes / on / off), Specifications
  (attribute-set fields by kind, per-field server errors), Documents (type, languages, visibility, revision, expiry),
  Channels (state, missing fields with Fix → the right tab, Publish / Unpublish / Turn on / off) and SEO (slug, meta
  title / description with length guidance, canonical, robots, language, translations, redirects, Draft with AI when
  the server offers it, a search-result preview).

**Changed**

- The product drawer's body is shared with the Products pane (ProductContent); the drawer gains Open 360.

## 1.3.0 — 2026-10-15

**Changed**

- Purchasing, Vendors and Replenishment are the Purchasing app's own screens (SRS-PUR-001 G-21): Inventory's rail, dashboard and search open them there, and the old addresses (`?tab=pur`, `?tab=ven`, `?tab=rpl`) are sent to it.

**Removed**

- buying.ts, Purchasing.tsx, Vendors.tsx and Replenishment.tsx, now in the purchase module.

## 1.2.0 — 2026-10-03

- The organisation filter is the shared compact switcher (#214): one pill, search, several at once, a default organisation, remembered per person.

## 1.1.0 — 2026-10-01

**Added**

- Reusable product description editor with portable rich formatting, safe paste, history and expandable editing (#66)

**Fixed**

- Preserve description formatting in details and guard unsaved product changes

## 1.0.1 — 2026-10-01

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
