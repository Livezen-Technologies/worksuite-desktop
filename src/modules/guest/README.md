# Guest mode (Local Profile)

**Continue as Guest** on the sign-in screen puts the main WorkSuite window into guest mode (#149). There is no second window: guest mode uses the same window, sidebar, top bar, theme, tabs and module screens as a signed-in account. Only the session's mode (`app.session.mode = 'guest' | 'account'`) and the enabled modules differ.

On first use the window asks for a display name, with an optional picture and an optional PIN (4–8 digits, kept only as a salted scrypt hash, as the app lock's PIN). No email, verification, server registration, required picture or AI model setup is involved. With a PIN, guest mode asks for it each time it opens, before any local data is read; five wrong PINs wait a minute. A forgotten PIN cannot be recovered; Settings › Backup & data › Delete all starts again.

## Modules

Each catalogue app carries a guest flag (`shared/apps.ts`, `guest: 'local' | 'locked'`), read by the sidebar, the router guard (`shared/access.ts` `GUEST_VISIBLE`, `src/core/tabs.ts`), deep links and ⌘K.

- **Local** — Notes, Tasks, Contacts, Calendar and Meet, on this device's data. Settings and Help stay open.
- **Locked** — Chat, Mail, Drive & Files, Company records, Shared workspaces, HR & People, CRM & Sales and the AI Assistant stay in the sidebar with a lock. Clicking one, a link or deep link to one, or choosing one in ⌘K opens the in-app "Sign in to use …" panel with **Sign in / Create account**. Home, Notifications and My account are not shown to a guest.

## Storage layer

Notes, Tasks, Contacts and Calendar make the same API requests in both modes. In guest mode `src/core/api.ts` sends them over IPC (`local:api`) to `electron/services/local-api.ts`, which answers from the Local Profile's database in the shapes the server answers with; anything that needs an account (sharing, people, notebooks, attachments, repeating events, company directory) answers 403 with a sentence. Nothing in guest mode reaches a WorkSuite server, and a window in guest mode is refused by the API proxy.

Data lives in `profiles/default/guest-workspace.sqlite`, separate from account caches. Its schema is versioned with `PRAGMA user_version` and migrated in place on update: version 2 added the `profile` table; version 3 adds `contacts`, `numbers` (the record numbers the module screens address) and `moved` (what went into which account). Items saved before #149 read as plain-text records. A file from a newer WorkSuite is refused rather than changed. SQLite uses synchronous FULL writes; the file has device-user-only permissions.

## Identity, backup and profile

The avatar menu shows "<name> · Local profile · Saved on this device" and whether the computer is online, with **Sign in / Create account**, **Backup & export data** and **Profile**. Backup & data and Profile are Settings pages; Settings hides what does not apply to a guest. Backups are versioned JSON up to 20 MB (`format: "worksuite-local"`; version 3 adds contacts; versions 1 and 2 still restore), never contain the PIN, are previewed before restoring, and merge without overwriting.

Meet joins by link or code with the profile's display name and no account token, where the meeting server allows guests; the last destination is kept on this device. Starting a meeting needs an account. Task and event reminders are checked every 15 seconds while WorkSuite runs.

## Signing in from guest mode

Signing in happens in the same window and ends guest mode without a restart. The window that was in guest mode (past its PIN) is then asked "Move your local notes, tasks, contacts and calendar events to your WorkSuite account?" — **Move data** or **Keep on this device only**. No other window or account is offered the Local Profile's data, and signing out closes the Local Profile: the next person sees the sign-in screen, and guest mode asks for its PIN again.

Move data (`electron/services/local-workspace-move.ts`) writes a backup of the whole Local Profile first (`profiles/default/guest-move-backup.json`), then uploads each record through the account's normal APIs with an idempotency key of the account, record and revision, marking it moved as soon as the server takes it. Failures are listed per item and can be tried again; a retry uploads only what is left. When the account confirms every record, the moved records are removed from this device and the backup is deleted; until then both stay.
