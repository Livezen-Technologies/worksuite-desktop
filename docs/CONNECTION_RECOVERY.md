# Connection recovery (#123)

The gateway previously sent RFC 6455 protocol pings every 30 seconds. Browser-style WebSocket APIs hide those frames, so Desktop's application-frame watchdog could retire a healthy quiet socket after 75 seconds. Upload activity can coincide with this behavior; production logs are still required to identify additional load, proxy, authentication or network causes.

The matching WorkSuite server update sends a JSON `ping` alongside the protocol ping. Deploy that gateway update and restart its existing managed process before expecting quiet Desktop/web connections to remain healthy. No gateway authentication, TLS, proxy timeout or production configuration is weakened. Older clients ignore the additional heartbeat.

Both clients require the authenticated `ready` frame before claiming a verified connection. Ticket requests are coalesced; stop/restart invalidates delayed results, retired sockets cannot publish events, handshake/error/heartbeat failures retry with bounded backoff, and repeated ready frames do not duplicate catch-up. Desktop records disconnect reasons, close codes and attempt counts without tickets. Repeated failures point to network/VPN, gateway/proxy and Help → Diagnostics. OS offline evidence is shown separately from inability to reach the configured server.

Uploads retain the shared queue and configured aggregate bandwidth limits. Desktop hashing already runs in its helper worker. Existing tests exercise two-transfer limits, temporary failures, server-confirmed resume positions, cancellation, bandwidth limits and notification catch-up deduplication. Queued transfer and draft persistence is unchanged.

Validation commands:

- Desktop: `npm run check`, `npm run build`, `npm run module -- check origin/main` after committing.
- Web: `npm test -- --maxWorkers=3`, `npm run lint`, `npm run build` from `web`.
- Gateway: `node --test realtime/server.test.cjs` (uses an isolated local listener, random ephemeral signing key and actual 30-second heartbeat).

Deployment acceptance remains: correlate client disconnect/ticket/watchdog logs with gateway/proxy/PHP-FPM logs while uploading a representative large file, running two simultaneous transfers at configured bandwidth limits, limiting network speed, dropping connectivity, sleeping/waking and refreshing the session. Verify chat/calls/notifications, confirmed resume positions, no duplicate events and retained unsaved work on web and native desktop. These production/native scenarios were not established by cloud unit tests. Keep #123 open until that matrix passes.
