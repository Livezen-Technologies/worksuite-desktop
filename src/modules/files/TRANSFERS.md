# Shared transfer queue

Every module uses the main process TransferManager. Uploads and downloads share a hard ceiling of two simultaneous file transfers (#94). Drive settings can lower the limit to one, and metered connection policy can lower it further. Old saved settings above two are normalized; IPC rejects new values above two; the scheduler also clamps direct configuration.

Eligible files start in queue order when a slot opens after completion, pause, cancellation or failure. Resume and Retry join the back of the queue and obey the same limit. Temporary failures retry with bounded backoff and release their slot while waiting. A pending retry deadline survives restart, along with partial downloads, upload session IDs and deliberately paused jobs. Closing the panel or changing modules does not stop the main process queue.

The Transfers panel groups Active, Queued, Paused and Completed/Failed entries, displays measured progress, speed, ETA and queue positions, and provides per-file actions plus Pause All and Resume All. Clear Finished only removes terminal history, preserving active, queued and paused transfers. Transfer summaries show active and queued counts.
