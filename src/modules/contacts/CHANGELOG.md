# contacts — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.3.1 — 2026-10-27

**Changed**

- colours from the design tokens, light and dark — the hard-coded hex colours are tokens now (D-G23)
- its settings screen uses the shared Settings kit (src/components/SettingsKit.tsx): the same headers, cards and rows as Settings (D-G09)

## 1.3.0 — 2026-10-06

**Added**

- Call on my WorkSuite phone in a contact's phone menu, placed and logged through the Phone (WS-VOIP-SRS-001 G-07)
- /contacts?new=1&mobile=… opens a new contact with that number (the Phone's Create contact, VOIP-POP-05)

## 1.2.0 — 2026-10-03

- Two-way sync with Google Contacts, Outlook / Microsoft 365, iCloud and other CardDAV address books (Mac Contacts needs a native add-on, not yet built): a preview before the first sync, matched contacts linked instead of duplicated, per-field conflict rules with a Sync conflicts list, deletions archived or unlinked, a per-account log, Settings › Contacts › Accounts & sync, an Accounts filter in the sidebar, source marks, "Synced with …" with Unlink, and Tidy up › Possible duplicates with a side-by-side merge and Undo. Also: one New contact / Import / Export each, no repeated name as subtitle, one phone format, and imports no longer default to Customer (#175).

## 1.1.0 — 2026-10-03

- Phone numbers are indexed in E.164 so WhatsApp (and later Calls and SMS) can match them; a contact's drawer has a WhatsApp action (#176).

## 1.0.2 — 2026-10-03

- The sidebar's New button is the shared primary action button: same size, colour, plus icon and quiet shadow as every module; the shortcut is in its tooltip (#171).

## 1.0.1 — 2026-10-02

- Open the conversation on a contact opens it in Chat's WhatsApp channel instead of the browser (#35).

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
