# expenses — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.3.0 — 2026-10-27

**Added**

- read-only offline from the encrypted cache — what was last read, under an "Offline · read-only" banner with its "as of" time; every change waits for the connection and is refused before it is sent; secrets, files, exports and one-time answers are never kept (D-G14)

**Changed**

- colours from the design tokens, light and dark — the hard-coded hex colours are tokens now (D-G23)

## 1.2.2 — 2026-10-26

**Fixed**

- a subscription card is reached with Tab and opened with Enter or Space (D-G21)

## 1.2.1 — 2026-10-26

**Changed**

- the figure cards (KPI, stat and summary tiles) are the shared StatCard — compact, a tinted icon chip and the label above a calm figure, a muted line under it, zero shown muted; cards that open a list are buttons with a focus ring and a soft lift; the same figures and actions as before

## 1.2.0 — 2026-10-03

- The organisation filter is the shared compact switcher (#214): one pill, search, several at once, a default organisation, remembered per person.

## 1.1.0 — 2026-10-03

- Claims can be linked to a tender (Linked to: Tender), filtered by tender, and opened from the tender; bid bond categories are refundable with Mark refunded (#159).

## 1.0.2 — 2026-10-03

- The sidebar's New button is the shared primary action button: same size, colour, plus icon and quiet shadow as every module; the shortcut is in its tooltip (#171).

## 1.0.1 — 2026-10-01

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
