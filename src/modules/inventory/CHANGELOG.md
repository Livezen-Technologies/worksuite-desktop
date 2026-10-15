# inventory — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

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
