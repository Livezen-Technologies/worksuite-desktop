# WhatsApp local sync (#158)

## Implemented local-first reads

Accounts, chat lists and opened conversations hydrate from encrypted main-process SQLite responses while an independent live request runs. Cache keys separate server, organisation and user. The existing Vault encrypts payloads; the existing storage policy and LRU bound disk use. Sign-out removes the user's records. A server refusal clears saved WhatsApp reads. Local cache reads never contact the server or forward a mutation, and cannot bypass module access or the offline-cache preference.

The shared renderer hook keeps recently opened queries for ten minutes, avoids replacing a live result with a delayed cache read and retains readable data through a network error. Lists show Updating while fetching. New messages auto-scroll only when the user was already near the bottom.

This is a response cache, not the complete relational message store requested by the issue. It caches conversations already opened and each list/filter response already fetched. A first installation has no local history. Existing paged snapshot polling remains authoritative.

## Required before closing #158

- Server change feed with an opaque per-number cursor, stable ordering, message/status edits and deletion tombstones, number-access revocations, and cursor-expiry recovery. The current inbox GET endpoints do not expose this contract.
- Server idempotency contract for queued sends, including text/reply/template/media validation and reconciliation of provider acceptance. Automatic replay must not duplicate a message whose request timed out after provider delivery. Disconnection must not bypass the 24-hour window or send permissions.
- Separate encrypted local accounts/chats/messages/media records, transactional cursor commits and an offline text/contact index. Encryption must cover searchable text; a plaintext FTS side table would defeat payload encryption.
- First-sync coordinator (100 chats, 50 messages each), locally retained older pages, account access cleanup, and configurable retention.
- Bounded thumbnail/full-media cache with secure on-demand reads, eviction, settings and clear action.
- Virtual lists, prefetch, older-message scroll anchoring, realtime/catch-up updates and actual outbox pending/retry UI.
- Device/account acceptance using 500 chats and 50k messages. Measure cold persisted list load, recent-chat switching, paging and 10k-message scroll performance. Unit-test durations do not demonstrate those targets.

Do not describe snapshot polling as delta sync, or the response cache as completion of this issue. Keep the integration draft until the remaining contracts and acceptance paths are implemented.
