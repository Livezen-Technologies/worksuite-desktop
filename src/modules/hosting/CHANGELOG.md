# hosting — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.0.0 — 2026-10-26

**Added**

- Hosting & Domains is a native desktop module (Hosting & Domains SRS v1.0 HDM-DSK-01…05, boards D-01…D-08) over
  `/api/hosting`: the Business app `hosting` (globe, cyan), an 88 px rail (Overview, Domains, Expiring, DNS,
  Certificates, Servers, Monitors, Costs, Accounts, Sync history); Domains with the keyboard list (↑↓ ↵, ⌘↵ new tab,
  ⌘⇧↵ pop out) and the side preview; a domain or a server in its own tab or window; the DNS editor with the record
  form (type-aware checks, the CNAME rule, a server picker for A/AAAA, ⌘N / ⌘R / ⌘S, Export zone as BIND);
  certificates with the detail panel and Explain with AI where the server has it; the servers grid with power off
  confirmed by typing the server's name; monitors and incidents; costs; provider accounts with Test, Sync and the
  schedule; sync history; ⌘N, ⌘⇧S (sync all), F5, Alt+1…0 and command palette entries. The tray badge and menu
  count monitors down and items expiring within 7 days, raised as native notifications too. Offline the register
  is read-only from the encrypted cache with its "as of" time and every change is off. Routes new in the SRS show
  "needs a server update" on an older server.
