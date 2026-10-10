# diagnostics — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.3.0 — 2026-10-10

**Added**

- voice message timings — send to bubble, send to Sent, size per minute — median and 95th percentile (#300)

## 1.2.0 — 2026-10-10

**Added**

- WhatsApp linking — each link attempt with its steps and error (#323)

## 1.1.0 — 2026-10-05

- Screen timings in the report (timings.json) (#252)

## 1.0.3 — 2026-10-03

- The Diagnostics report includes the update history: every check, download, install and rollback (#205).

## 1.0.2 — 2026-10-02

- Include independent Screen Recording status and actual running-app signature verification (#132).

## 1.0.1 — 2026-10-01

**Fixed**

- Include redacted macOS Accessibility permission and app/helper identity details in diagnostic bundles (#84).

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
