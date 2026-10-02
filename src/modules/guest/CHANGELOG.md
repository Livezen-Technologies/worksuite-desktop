# Guest workspace

## 1.1.0 — 2026-10-03

- Local Profile (#141): Continue as Guest on the login screen; first use asks for a display name with an optional picture and 4–8 digit PIN (salted hash, five wrong tries wait a minute); header shows the name with Local Profile · Saved on This Device and a separate online/offline indicator; search across local notes, tasks and events; reminders explain they don't fire while WorkSuite is fully closed; schema migrations keep data across updates; Join Meeting by link or code with the local name when online; a locked Needs a WorkSuite account list for online-only features; restore shows a preview of what will be added before anything is written; backups carry the name and picture, never the PIN; Sign In / Create Account with a grouped, selectable, PIN-protected import review — nothing is uploaded or merged automatically.

## 1.0.0 — 2026-10-02

### Added
- Device-only Notes, Tasks and Calendar, durable storage, local reminders, backup/restore and deletion, and offline-retained guest meeting destinations (#86).
- Explicit account import with preview, item selection, duplicate review, account binding and idempotent writes. No automatic uploads.
