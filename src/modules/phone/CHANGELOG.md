# phone — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.1.0 — 2026-10-07

**Added**

- calls share one status with the top bar unless given their own; Busy rings silently, Do not disturb and Away send callers to voicemail or forwarding, the missed call kept in Calls and the bell (#288)

**Changed**

- the Phone's Status is a pill and the shared menu instead of the system dropdown — Available, Busy, Do not disturb and Away with dots and descriptions, Do not disturb for a set time with its end on the pill, and Call settings (#288)

## 1.0.0 — 2026-10-06

**Added**

- The Phone (WS-VOIP-SRS-001 v1.1, design "WorkSuite Phone (VoIP) — Modern UI"): a SIP softphone (sip.js over WSS) held by the main window from sign-in to sign-out, registering the person's own extension (`GET /api/voip/softphone`), with reconnect and plain states for no extension, no PBX, a refused password and a first-time page-policy restart.
- Calls placed the SRS way (WF-05): `POST /api/voip/call` rings this phone first and the ring-back is answered here, so every call is logged with its CRM activity; direct SIP when the server cannot reach its switch, said as such.
- In-call (W02): mute, hold, keypad (RTP DTMF), transfer now / speak first (REFER, REFER with Replaces), conference in the extension's own ConfBridge room, park and recording control through `calls/control`, add call, audio devices and echo test, MOS from WebRTC statistics, screen pop with CRM and billing items, notes saved to the call, follow-up task, wrap-up outcome.
- Ringing anywhere (W03): the call toast with account context, Answer / To voicemail / Decline, call waiting with Hold & answer, the call dock on every page, missed calls and native notifications.
- My phone: dial pad & recents with live contact match, caller-ID line, My day and speed dials (W01); history with filters, linked records, Create contact and CSV export (W04); call detail with recording player, pinned notes, call path and the honest intelligence panel (W05); voicemail (W06); forwarding rules, DND, devices and hot desk (W07).
- Supervise and administer, shown by permission: live board with listen / whisper / barge and agent pause (A01), extensions with HR provisioning, CSV import/export and the SIP secret shown once with a provisioning QR (A02, A03), PBX servers and health, mappings, server editor and connection test (A04, A05), trunks, GSM gateways, SIMs, outbound routes, a route tester and the recommended Sri Lankan routes (A06), inbound numbers and the IVR builder (A07), queues and ring groups (A08), short codes and configuration review with diff and apply (A09), call reports (A10), recordings, import and retention (A11), telephony settings and sync runs (A12), and the cloud FreePBX setup wizard (VOIP-DEP-05).
- The compact always-on-top phone window (D01) with global shortcuts Alt+Cmd/Ctrl+A / H / M.
- What the server does not offer yet (G-03, G-05, VOIP-RPT-05, VOIP-FWD-05, VOIP-CTL-06…) is asked for and, when absent, said plainly instead of pretended; the contract is in docs/BACKEND.md § Phone.
