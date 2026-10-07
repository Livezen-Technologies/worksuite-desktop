# Phone (VoIP) on WorkSuite Desktop — gap analysis and build

Against **WS-VOIP-SRS-001 v1.1** (02 Oct 2026) and the design canvas *WorkSuite Phone (VoIP) — Modern UI*
(23 artboards: W01–W07, A01–A12, D01–D04). Server baseline read for the contract: `Livezen-Technologies/worksuite`
`main` @ 4d7ab1c (5 Oct 2026) — `app/Modules/Voip` is unchanged from the SRS baseline (module 1.0.0).

## 1. The gap this closes

Before this change the desktop had **no Phone at all**: `src/modules/calls` is Chat's LiveKit calling, and the only
VoIP touch was Website chat's *Call back* posting `/api/voip/call`. The SRS's §2.1 said "Desktop: same web phone
today; planned compact phone window" — but the desktop does not embed the web app, so every web screen (W01–W07,
A01–A12) and the desktop window (D01) were missing.

Built now, in `src/modules/phone` (module `phone` 1.0.0) with its main-process side in `electron/services/phone.ts`:

| Area | Screens / pieces | SRS |
|---|---|---|
| Softphone engine | `softphone/engine.ts` — sip.js over WSS, registration + backoff reconnect, multi-line, hold, mute, RTP DTMF, blind/attended transfer, ConfBridge conference, park/record via `calls/control`, MOS, DND/locked → 486 | SP-01/02/03/04/07/10, CTL-01…05 |
| Shell host | `softphone/PhoneHost.tsx` — starts at sign-in in the main window, survives lock (a call is never cut), ring toast anywhere (W03), call dock, missed-call + incoming native notifications | SP-01/03, CTL-05, NOT-01, DEV-01 |
| Cross-window | `softphone/client.ts` — `BroadcastChannel('ws-phone')`: the compact window mirrors state and sends commands; audio stays in the main window | DEV-01 |
| Agent | W01 Dialer, W02 InCall (+ wrap-up), W04 History (+CSV), W05 CallDetail, W06 Voicemail, W07 Forwarding/DND/hot desk | SP-04/05/09, CTL-06, POP-01/05, HIS-01/03/07/08, REC-02/06, FWD-01…06, EXT-06 |
| Supervise | A01 Live board (listen/whisper/barge, pause), A10 Reports, A11 Recordings & intelligence | RPT-01…06, REC-01…05, AI-01/02 |
| Administer | A02 Extensions (+HR provisioning, CSV import/export), A03 secret shown once + QR, A04 servers & mappings, A05 editor & test, A06 trunks/gateways/SIMs/routes + tester, A07 inbound & IVR builder, A08 queues & ring groups, A09 short codes + config diff + apply, A12 settings & sync runs, cloud FreePBX wizard | EXT-01…10, SRV-01…08, TRK-01…05, IVR-01…04, DP-01…06, ADM-02/03, SYN-01…03, DEP-01/03/05 |
| D01 | `CompactPhone.tsx` in an always-on-top `phone` window; global shortcuts Alt+Cmd/Ctrl+A/H/M | DEV-01 |
| G-07 | `CallButton` / `placeCall` — Contacts' phone menu calls through the Phone with `contact_id` | SP-08 |
| Status (#288) | `StatusMenu.tsx` (the pill and the shared `Menu` in W01's header), `status.ts` (one status with the top bar, calls' own, Do not disturb for a while, the switch), `lib/callstatus.ts`; the engine rings loud (Available), silent (Busy) or not here (Do not disturb, Away → 486, missed call to Calls and the bell) | FWD-05, NOT-01 |

**Calls are placed the SRS way (WF-05):** `POST /api/voip/call` (the switch rings this phone, then the number); the
engine answers its own ring-back (matched on this extension's own caller ID within 20 s), so every desktop call writes
the call-log row and the CRM activity. If the server cannot reach its switch over AMI (502/503) but SIP is up, the
call goes out directly and the person is told it will not be in history until CDR import exists (G-01).

**Honest degradation (NFR-10):** every endpoint the SRS proposes but the server does not yet have is called through
`optional()`; a 404/405/501 renders "isn't offered by this WorkSuite server yet" with what still works, never a fake.
Where the server's existing data can stand in, it does and says so (Live board from `/live` + `reports/queues` +
presence; call path from the call record; route tester computed locally from Asterisk patterns; speed dials kept on
this computer).

## 2. What the desktop needed from Electron (now done)

| Need | Change |
|---|---|
| The page CSP blocked `wss://pbx…` | `phone:prepare` — main asks `GET /api/voip/softphone` for `ws_uri`, keeps only its origin (`phone_servers`), adds it to `connect-src` via `cspSources().media`. A page never names an origin. First time: the main window restarts once (the policy is fixed per load). |
| No renderer global shortcuts | `phone:shortcuts` — Alt+CmdOrCtrl+A/H/M held while registered, released on sign-out / app removed; presses arrive as `phone:shortcut` |
| No renderer notifications | `phone:notify` — strict schema, `module: 'phone'`, `category: 'voip'`, link `/phone` or `/phone/calls`; `delivery: 'silent'` (Busy: no sound) or `'bell'` (turned away by Do not disturb or Away: the bell only, no banner) |
| A compact always-on-top window | `WindowKind 'phone'` (360×640, pinnable) |
| CSV export (downloads are blocked) | `files:saveText` also takes `.csv` (8 MB) |
| Catalogue | `phone` app (no server slug, like the web's — G-13), sidebar *work*, deep links `worksuite://phone`, `phone/calls/:id`; `voip` notifications visible with Phone or Chat |

## 3. Server gaps that remain (Livezen-Technologies/worksuite)

The desktop calls these; until they land the screens say so. Contract: [BACKEND.md § Phone](BACKEND.md#phone-ws-voip-srs-001).

| ID | Impact | Gap | Desktop today |
|---|---|---|---|
| S-1 | High | `GET live` open to everyone | Live board shown only with voip.reports/supervise; still readable by API |
| S-2 | High | screen-pop bypasses CRM/Billing permissions | Shown only for the caller's own calls; server must filter |
| S-3 | Medium | notes/analyse/intelligence check only existence | Desktop never offers them outside the person's calls |
| S-4 | Low | sync-runs open to all | Shown under Administer only |
| S-5 | Info | plaintext SIP secret to browser | Kept in memory only; main never stores it |
| G-01 | High | no CDR ingestion | Calls placed via `/call` are logged; inbound appear once CDR exists; notes/wrap-up wait for the row (AfterCall retries 0/15/45 s) |
| G-02 | High | two connection paths | Desktop uses `ws_uri` from `/softphone` and per-server `apply`; server must make `/softphone` per-server |
| G-03 | High | no CRUD for trunks, routes, gateways, SIMs, SMS, queues, ring groups, IVR, speed dials | Full editors built against the proposed API; "not offered" until then |
| G-04 | Medium | click-to-call rows lack uniqueid | Unlinked tab in A11 |
| G-05 | Medium | no inbound DID routing | A07 DID editor built; "not offered" |
| G-06 | Medium | hard-coded Google STUN | Engine uses whatever `ice` the server sends (TURN with credentials works as soon as it is sent) |
| G-08 | Medium | HR auto-provision not wired | "Provision from HR" calls `POST extensions/provision-hr` |
| G-09 | Medium | settings/config gated on non-existent admin.manage | Settings and Dial plan say so on 403 |
| G-10 | Medium | voip.voicemail / pbx_offline / queue_overflow never raised | Desktop raises its own missed/incoming notifications |
| G-11 | Low | registrations never written | W07 shows this computer, plus the list when served |
| G-12 | Medium | FreePBX driver untested | Shown on A04 cards |
| G-13 | Low | no `voip` application row | Phone shown to all, like the web |
| G-14 | Medium | no org_id scoping | Reports pass `org_id` when the person has several companies |
| G-17 | High | recordings read from local spool | A11 explains; ARI fetch is server work |
| G-18 | Medium | no gateway adapters | A06 "Read status" calls `POST gateways/{id}/poll` |
| #288 | Medium | no Busy/Away modes, DND end time or per-channel status on the switch; no end time on Chat's presence | Status works on this computer (Busy silent, DND/Away → 486); `PUT me/dnd` sends `dnd` plus `status`/`until`; the desktop ends a timed DND itself; Away's forwarding read from the "When busy" rule |

Proposed new endpoints the desktop already uses: `me`, `me/dnd`, `me/caller-id`, `speed-dials`, `registrations`,
`wrapup-codes`, `calls/{id}/wrapup`, `calls/{id}/events`, `voicemail/{id}/heard|forward`, `DELETE recordings/{id}`,
`supervisor/board`, `supervise`, `supervise/stop`, `queues/{id}/pause`, `trunks`, `routes` (+`order`, `test`),
`gateways` (+`poll`), `sim-cards`, `sms`, `inbound-routes`, `ivr-flows`, `queues` (+`agents`), `ring-groups`,
`mappings`, `extensions/{id}/provisioning|setup-email`, `extensions/import`, `extensions/provision-hr`,
`PUT forwards/{id}`. Optional fields read when present: `ScreenPop`-linked `contact`/`linked` on history rows,
`config.applied`/`pending`, `volume.heat`, `softphone.server`/`ice_expires_at`, `me.away_forward_to`, and
`status`/`until` in the answer to `PUT me/dnd` (#288).

## 4. Not in this change

- **Mobile (D02–D04, VOIP-DEV-02):** belongs to `worksuite-mobile` (CallKit / ConnectionService push).
- **The server side** (§3 above) — separate repository and PR.
- **Real-PBX verification:** the engine is unit-tested with sip.js mocked; it has not been run against Asterisk here.
  Commissioning tests T-01…T-10 (SRS §15) apply once a switch is connected.
