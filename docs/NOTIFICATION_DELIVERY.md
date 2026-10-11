# Coordinated notification delivery (#339)

Deploy the server before Desktop 0.2.238 and Mobile 1.2.2. Run the normal module migrations, including
`Notifications/2026-10-11-001000_NotificationDeviceDelivery.php`. It adds device presence, alert claims and
email-worker leases; it does not rewrite existing notification rows. Keep the notification delivery worker
and realtime gateway running. Presence expires after 60 seconds and clients refresh it every 20 seconds.

Authenticated heartbeat and claim endpoints live under `/api/notifications/devices`; mobile uses the
corresponding mobile-v1 routes. The server derives the signed-in user. A numeric notification claim must
belong to that user and be unread. Clients on an older server retain legacy behavior only for missing
routes (404/405); a failed request or missing migration suppresses new popups while badges remain available.

A focused device viewing the event context suppresses attention everywhere. Otherwise an active desktop
(focused or input within 120 seconds) wins, then an active browser, then an active phone. If all devices are
idle, a running desktop handles the native alert; otherwise one registered phone gets the push. Account
settings can turn desktop priority off. Browser tabs elect one leader using Web Locks and share presence
through BroadcastChannel. Clients keep the most recent 500 shown keys; the server's unique SQL claim and
optional Redis `SET NX EX 86400` prevent another device winning the same event for 24 hours.

Chat live events and their bell rows share the message key. Mail live events and bell rows share mailbox
and message keys. Generic rows use their notification ID. Producers with an explicit event ID also reserve
that ID before inserting. Producers must reuse the same event ID when retrying. Contexts include chat,
website conversation, ticket and mail message. Same-item bursts within 60 seconds update one bell entry;
chat native notices reuse their context identifier. Calls retain ringing preferences and claim attention
once, bypassing DND/quiet hours. Other alerts retain normal quiet-hour and channel preferences.

`notification.read` carries `ids`, `all` and `contextKeys`. Connected clients invalidate counts and close
matching tracked OS notices immediately. Offline devices reconcile on reconnect; the server cannot remove
an OS notification from a disconnected phone. Native notification replacement and removal depend on the
platform's supported notification APIs. Browser mail alerts preserve their grouping and action behavior.

Per-event popup, sound, mobile and email choices are independent. Email waits 15 minutes by default
(configurable per event), checks that entries are still unread, and combines due events for that user into
one digest. A per-user worker lease avoids parallel digests. Existing specialized share/overdue digests
retain their delivery paths. SMTP and push-provider delivery were not exercised with production accounts.

Verification covers deterministic target selection, viewing suppression, per-user claims, replay protection,
expiry, delayed digest cancellation, browser leader election, manual dismissals, and pending-call teardown.
