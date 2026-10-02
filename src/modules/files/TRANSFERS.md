# Shared transfer queue

Every module uses the main process TransferManager. Uploads and downloads share a hard ceiling of two simultaneous file transfers (#94). Drive settings can lower the limit to one, and metered connection policy can lower it further. Old saved settings above two are normalized; IPC rejects new values above two; the scheduler also clamps direct configuration.

Eligible files start in queue order when a slot opens after completion, pause, cancellation or failure. Resume and Retry join the back of the queue and obey the same limit. Temporary failures retry with bounded backoff and release their slot while waiting. A pending retry deadline survives restart, along with partial downloads, upload session IDs and deliberately paused jobs. Closing the panel or changing modules does not stop the main process queue.

The Transfers panel groups Active, Queued, Paused and Completed/Failed entries, displays measured progress, speed, ETA and queue positions, and provides per-file actions plus Pause All and Resume All. Clear Finished only removes terminal history, preserving active, queued and paused transfers. Transfer summaries show active and queued counts.

# Drive settings

Drive Settings is also available in Settings → Files & Sync. Preferences are saved on this device, with Reset to Defaults. Bandwidth caps share a bucket per direction across all modules; changing a cap now wakes waiting transfers immediately and recalculates their wait against the new cap. Unlimited clears pending throttling waits. Cancelled waits remove their timers and subscriptions.

Treat this connection as metered is a device-local override for hotspots and connections with a data allowance. It activates the selected one-file or pause policy immediately; disable it when switching to an unmetered connection. The override is manual and does not claim operating-system detection. Quota belongs to the server account; cache cleanup only removes cached pages and lists. Original files, queued uploads and explicitly kept offline files are retained.
