# Recording organization and playback

Desktop #88 sends the meeting UUID and recording client ID when requesting an upload folder. Communication 1.4.0 groups cloud and local segments under `Meeting Recordings / Meeting Title – Date [Meet ID]`. Folder lookup survives changes to the meeting title, and owner-scoped database locks serialize folder creation. Timestamped segment names remain distinct, and resumed desktop transfers keep their existing transfer IDs. Cloud filing recovers an already-written file after a missing recording acknowledgment.

Available transcripts and finalized minutes, including action items, are immutable text snapshots in the meeting host's recording folder. Finalization/completion saves them, and recording/detail reads retry document synchronization. Content-based names prevent duplicate snapshots. Existing recording ownership and Drive permissions are preserved; these operations grant no new sharing rights. Documents are not copied to other recorders' folders.

Meet and meeting details reuse Drive's player through the existing Open in Drive and Play Recording actions. The player uses the authenticated stream route with HTTP Range support and provides seeking, volume, speed and full screen. Processing and playback failures show status and retry guidance. Meet cards show duration, file size and permission-checked signed video posters when the server's media worker has generated them. FFmpeg and the existing media worker are required for derived posters and conversion; the file-type icon remains while a poster is unavailable.

# Capture feedback and participant notices

Meet 1.6.0 requires Communication 1.5.0 for recording feedback (#87). Local recording prepares its server row, then confirms active capture after Chromium fires MediaRecorder.onstart. Cloud recording stays in Starting Recording until LiveKit reports EGRESS_ACTIVE. Duplicate requests are serialized. Stopping remains visible while capture is ending; processing and upload are separate stages after capture ends.

The red Recording On indicator, elapsed time and participant banner remain visible in normal, full screen and floating meeting windows. Participants and guests refresh confirmed capture state every three seconds and on reconnection; recording changes announce through speech synthesis, with a notification sound fallback. Repeated updates do not repeat announcements. Guest responses expose only whether capture is active and its start time.

Failed startup and stop requests show retry guidance. Cloud confirmation waits up to 30 seconds, within a 45-second operation deadline; an uncertain request preserves the last confirmed capture state and can be stopped or retried. Late confirmation refreshes that state. Audio playback still follows operating system volume and mute settings.
