# hosting — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.1.1 — 2026-10-26

**Changed**

- the figure cards (KPI, stat and summary tiles) are the shared StatCard — compact, a tinted icon chip and the label above a calm figure, a muted line under it, zero shown muted; cards that open a list are buttons with a focus ring and a soft lift; the same figures and actions as before (Overview, Costs and the import preview)

## 1.1.0 — 2026-10-26

**Added**

- Register a domain — search every connected registrar that can (availability and price), and register with one, confirmed with the price and a step-up (register/search, register)
- Import domains or servers from a CSV with a dry run — the server's column guess to change, what would be added, updated, skipped and why, Apply, and the error rows to save (import/preview, import/apply)
- Reports — the renewal calendar with Export (CSV or Excel) and Print, cost by customer, provider spend, uptime; Export on Domains, Certificates and Servers with the list's filters (reports/{name}, export/{kind}, print/renewals)
- Bulk changes to ticked rows (Space, ⌘-click, the checkboxes): link a customer or project, tags, the responsible person, remove; certificates checked again or no longer watched together (bulk)
- The right-click menu on a domain (Re-read DNS, Watch certificate, Add monitor, Edit links, Create renewal task, Remove), a certificate and a server card
- Look up live in the DNS editor — what public resolvers answer now beside the copy (domains/{id}/lookup)
- Add and edit a server; a synced server's provider-owned fields are shown, not edited
- Edit a domain's links — customer, project, server, responsible, tags, group, notes — from its own company's lists (domains/lookups)
- Confirm it's you for renew, the transfer code, register and power off (428 step_up), and the same request sent again with the proof
- Hosting's count (monitors down, expiring within 7 days) on the macOS Dock badge

**Fixed**

- Every screen reads the server's real answers ({status, message, data} with the list, summary and meta): the overview's counts, renewals and attention; domains' provider, links and supports; the DNS copy's host, can_edit and can_refresh, and a change sends the record as it was seen; certificates' problem, status words and warnings; servers' status, monthly cost and domains; monitors' state and uptime; accounts' Test and Sync, which answer ok false on failure; sync runs; costs grouped by customer, project or provider
- Explain uses GET certificates/{id}/explain and domains/{id}/explain?record=, and says when the explanation is not AI's
- Renew, auto-renew, lock and the transfer code are offered only where the registrar's API has them; auto-renew sends on and lock sends locked
- Power actions follow server_actions; metrics and snapshots say why where the provider has none
- Watch host, Add monitor and Add domain send the company; monitors check every 1, 5 or 15 minutes
- Export zone saves as a .zone.txt file the save dialog accepts
- The alerts read monitors' state (state=down) and the overview's monitors.down

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
