# Architecture

## Processes (SRS §3.2)

| Process | Runs | Privileges |
|---|---|---|
| **Main** (`electron/main`) | lifecycle, windows, IPC router, tray, protocols, notifications, secure storage, SQLite, session, realtime socket, updater | full Node, never loads web content |
| **Renderer** (`src/`) | React 19 UI for the shell and modules | sandboxed Chromium, no Node, talks only through `window.worksuite` |
| **hash-worker** (`electron/workers`) | SHA-256 of files being uploaded | utility process, no network, reads only paths main names |

Utility processes are run by the `ServiceSupervisor`: pinged every 10 s,
restarted with exponential backoff (1 s → 5 min), marked FAILED after 5
restarts in 10 minutes, shown in Diagnostics and the tray. A helper failing
never takes the window down. The monitoring agent (Phase 3) joins the
supervisor the same way.

## Drive sync

`electron/services/sync/` keeps chosen Drive folders in step with folders on
this computer (WorkSuite Drive FR-SYN-01…06). It runs in the main process;
its hashing (whole files, and the protocol's 4 MiB blocks) runs in the
hash-worker.

- **plan.ts** — pure. Three pictures of a folder — the index (what both sides
  last agreed), this computer, Drive — become actions: moves first (Drive's by
  id, this computer's by inode, so a renamed file keeps its versions and
  shares), then content. A path changed on both sides keeps both copies.
- **local.ts / remote.ts** — the two pictures. Drive's comes from
  `/api/drive/tree` and `/api/drive/list?deep=1`, because the server's journal
  cannot carry a folder sync on its own (see BACKEND.md). What cannot be read
  is *blind*, never *deleted*.
- **protocol.ts** — `/api/sync/*` with the device credential:
  hello → delta → have/block/commit, manifest/block, ack.
- **engine.ts** — passes (a local change, the journal every minute, every
  five minutes, Sync now), each action re-checked against the disk just
  before it runs and written to the index as it completes. Deletions go to a
  recycle bin; a mass deletion waits for a person; a folder missing on either
  side stops that folder instead of reading as "everything was deleted".
- **store.ts** — the index, in the profile database (`sync_folders`,
  `sync_entries`).

## The request paths

```
renderer ──fetch──▶ app://bundle/__api/api/…  ──▶ main: ApiProxy ──▶ WorkSuite API
                                                    │  adds Bearer token, device headers
                                                    │  refuses credential routes (auth, tickets, sync)
                                                    └─ READ_CACHE: stores/serves encrypted answers when offline

renderer ──window.worksuite.x.y()──▶ preload ──ipcRenderer.invoke──▶ main: IpcRouter ──▶ service
                                                    allow-list → zod → sender origin → lock →
                                                    session → permission → rate limit → audit
```

The renderer never holds a token. The access token lives in main-process
memory; the rotating refresh token only in OS secure storage.

## Session lifecycle

`SessionController` (`electron/main/session.ts`):

```
no-server → signed-out → [mfa] → registering → bootstrapping → ready
                                                        ├─ expired  (refresh refused; drafts kept)
                                                        ├─ blocked  (desktop disabled / device limit / admin block)
                                                        └─ revoked  (remote wipe: WorkSuite's data removed)
```

On `ready` it starts realtime, notifications, device heartbeat, queue replay,
transfer recovery and the attendance poll; on the way out it stops them. At
start-up a stored refresh token resumes the session; if the server is
unreachable the cached bootstrap starts the app offline and read-only until it
revalidates.

## Server API families

`probeServer` decides per server:

- `desktop-v1` — the server answers `/.well-known/worksuite-desktop`; the app
  uses `/desktop/v1/bootstrap`, `/devices/register|heartbeat`, signed policies
  and `/releases/manifest`.
- `core` — the existing WorkSuite API; bootstrap is composed from
  `/api/auth/me`, the organizations endpoints and `/api/sync/policy`; devices
  are sync devices; releases are a static signed manifest on the server.

Everything above the service layer is the same for both.

## Local data (§7.2)

One SQLite database per profile (`node:sqlite`, built into Electron — no
native module). Sensitive columns — cached responses, drafts, queued
mutations, notification text, tab state, bootstrap — are AES-256-GCM
ciphertext; the key is in the OS credential store. `synchronous=FULL`: a draft
or a queued change is on disk before the user is told it was saved.

## Renderer

- `core/` — bridge, API client, app state mirrored from main-process events,
  tabs, commands and shortcuts, drafts, i18n, time rules.
- `layouts/` — title bar (52 px), sidebar (220 px), tab strip (40 px),
  workspace, status bar (26 px) — §4.12.
- `modules/` — one folder per desktop module with a validated manifest
  (`modules/registry.ts`, §15). Modules are lazy chunks; each renders inside
  its own error boundary.
- A module may keep its own small registry for parts that arrive later:
  Garage's job card draws its tabs from `modules/garage/registry.ts`
  (`JOB_TABS`, and `EXTRA_VIEWS` for its rail), so a stage of the server's
  Garage module adds one file and one line, not a change to the card. A tab
  is keyed to the Job 360° key its server stage adds, so a server without
  that stage simply does not show it.
- A module's files leave through the download manager by what they are, not
  by a path: `transfers:download` takes a typed variant (for Garage,
  `garageFile`: a report's CSV or a job's delivery note), and the main
  process builds the address it fetches.
- READ_CACHE is declared in a module's manifest and served by the main
  process for the prefixes in `CACHE_PREFIXES` (`electron/main/index.ts`),
  per module, so an app taken away takes its saved answers with it.
- Tabs stay mounted while recent (instant switching) and are suspended after
  the configured idle time; the tab set is saved and restored only for apps
  the user can still open.

## Time

WorkSuite sends two kinds of stamp that look the same. True-UTC stamps (chat,
mail, notifications, activity) are parsed with `parseTs`; the calendar feed is
wall-clock digits already on the reader's clock and is displayed as written
(`wallTimeLabel`) and bucketed by its date digits — exactly as the web client
does.
