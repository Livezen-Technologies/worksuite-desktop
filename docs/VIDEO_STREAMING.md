# Drive video playback (#56)

The desktop uses byte-range originals immediately where available. The backend probes and prepares incompatible copies asynchronously. Large local videos (64 MiB or more) request the existing HLS ladder in the background. Completed paths are reused; failed jobs stay failed until explicit retry, stale workers can be retried and active workers send heartbeats. Repeated dead workers eventually fail rather than loop forever.

The player prefers prepared HLS, offers Auto or a specific quality, caps forward/back buffers and releases the engine/source on close. HLS requests use the existing app origin proxy, with narrow playlist/segment paths, streamed response bodies, ranges and abort signals. No wildcard CORS is added. The original remains available for download/open locally during preparation.

New Drive media tokens carry a signed drive scope and stable expiry window. The server checks current preview permission for playlists, segments and originals; downloads additionally require download permission. Legacy tokens for chat/VoIP keep their existing behavior. Local adaptive directories are contained inside the disk root, including symlink checks.

## Deployment and acceptance still pending

Deploy the backend and desktop together; the background media worker and ffmpeg must run on the server. HLS currently supports local storage. Authenticated CDN deployment is not configured or validated here: no CDN host/configuration was supplied. Existing signed server delivery remains in use. A CDN must preserve reader authorization, revocation and relative playlist resolution; do not expose artifacts as public objects.

A generated MOV integration test verifies actual 360p/720p output. It does not establish large-file performance. Before closing #56, validate the actual 801 MB MOV and a large MP4 on the target deployment under fast and throttled connections. Record time to first frame, seek time to an uncached position, buffering events, transferred bytes and renderer/main RSS. Confirm that starting/seeking does not fetch the entire original, quality adapts, manual selection works, closing cancels requests, and revoked readers cannot fetch any new playlist/segment/download.

Production CDN details and representative test-file addresses were requested but unavailable, so those acceptance checks remain open.
