# Local guest workspace

The guest workspace runs in a separate window and never initializes account state. Its main-process IPC handlers accept only registered local workspace windows. Guest meeting and local windows are excluded from account broadcasts, workspace IPC, the private API proxy and the private local-cache protocol.

Data lives in `profiles/default/guest-workspace.sqlite`, separate from account caches. SQLite uses synchronous FULL writes; the database file has device-user-only permissions. Guest data is not encrypted or uploaded automatically. The UI explains that it belongs to the device profile and that exported JSON backups must be kept private.

Notes are plain text. Tasks have completion, due dates and reminders. Events have absolute start/end instants and reminders; the monthly view displays device-local dates. Reminders are checked every 15 seconds while WorkSuite runs, including in the background. Missed reminders can appear on reopening; operating-system notification settings may suppress them. Delivery acknowledgments survive restarts and backup restore.

Export/restore use a versioned JSON backup up to 20 MB; writes are capacity-limited so every dataset remains restorable. Restore validates the entire file before writing, merges records, and skips identical content without overwriting current records. Delete All requires a typed confirmation and removes local records, meeting destinations and import history. User-exported backup files remain under the user's control.

An authenticated account receives only an import offer count. Review is explicit and reads account titles to identify potential duplicates. The preview names the account and organization, lets the user select items, and defaults to skipping potential duplicates. Confirmed import uses frozen account credentials and origin, checks the account and each local revision, supplies stable Idempotency-Key headers, and records completed fingerprints per account. Local originals remain; retries skip completed content. Notes/events belong to the selected user; tasks use the selected organization. Existing account permissions still apply.

Meeting joining depends on desktop #85 and server Communication 1.3.0. A device can use its local tools without any server or account; live meetings need internet and a guest-enabled meeting server.
