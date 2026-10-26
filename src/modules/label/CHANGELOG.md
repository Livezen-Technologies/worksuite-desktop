# label — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.1.0 — 2026-10-25

**Added**

- the gateway's company from pairing, the signed update channel with SHA-256 checked downloads, pause and resume printers

**Security**

- heartbeat printer commands send their bytes only under a verified signed envelope

## 1.0.0 — 2026-10-25

**Added**

- Label Studio is a native desktop module (WS-LABEL-SRS-001 §4.27, the desktop boards D01–D07) over `/api/labels`
  (server Label module, docs/label-api.md): Home (D01), Designer with the server's preview, ⌘S and a dialog-free test
  print (D02), the print station for keyboard-wedge scanners with reprint and a reason (D03), Printers on this
  computer — OS queues and raw-TCP LAN printers, Discover, register and approval state (D04), Running batches with
  per-label progress and the reconciliation sheet (D05), and the Print Gateway's pairing (D06) and status (D07). The
  web's screens (templates, batches, sequences, queue, history) open from the rail.
- The print host (`electron/services/label/`, server docs/label-api.md "Desktop print host"): CorePrintService claims
  jobs on a lease, verifies each chunk's Ed25519
  envelope, sends raw through `sendRaw` or TCP 9100, asks a Zebra `~HS` before each chunk, reports every confirmed
  label and keeps a journal so nothing prints twice after a crash, a cut connection or a printer stop; sequence jobs
  never resume by themselves (C-08).
- The Print Gateway as a tray/headless mode (`--print-gateway`, `--pair-url= --pair-code=`, start with the OS): its
  own Ed25519 device key in the OS key store, 15-minute tokens signed for with it, outbound HTTPS only (heartbeat
  every 30 seconds, claim polled every 5), signed jobs only, its own approved printers only, and its identity
  forgotten on revocation.
- Sales › Printers links to Label Studio's printers where the organisation has Label Studio (SRS §2.1).
