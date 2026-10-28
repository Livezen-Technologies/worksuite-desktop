# account — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.5.0 — 2026-10-28

- Delete this WorkSuite Cloud account from inside the app

## 1.4.3 — 2026-10-27

**Changed**

- the parts this module shares with others now come from src/components (the page, list, record, form, card, call, console and report kits), and a lint rule keeps modules from importing each other (audit D-G08). Nothing a person sees changes.

## 1.4.2 — 2026-10-27

**Changed**

- colours from the design tokens, light and dark — the hard-coded hex colours are tokens now (D-G23)
- its settings screen uses the shared Settings kit (src/components/SettingsKit.tsx): the same headers, cards and rows as Settings (D-G09)

## 1.4.1 — 2026-10-26

**Changed**

- the figure cards (KPI, stat and summary tiles) are the shared StatCard — compact, a tinted icon chip and the label above a calm figure, a muted line under it, zero shown muted; cards that open a list are buttons with a focus ring and a soft lift; the same figures and actions as before

## 1.4.0 — 2026-10-26

**Added**

- Preferred name in Profile settings, an additional name you go by beside your own, which stays unchanged; shown on your profile (#432, needs server Users 1.5.0)

## 1.3.0 — 2026-10-13

**Added**

- Storage page for WorkSuite Cloud accounts — 2 GB breakdown, what isn't counted, desktop cache limit (Connection & Startup)

## 1.2.0 — 2026-10-10

**Added**

- remembered computers under My account › Security — this one marked, remove one or all (#301)

## 1.1.1 — 2026-10-01

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.1.0 — 2026-10-01

**Added**

- the picture editor can hand back a picture unsent (onPick), for the required-picture screen (#46).

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
