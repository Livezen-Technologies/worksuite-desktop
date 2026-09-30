# Module development: branches, versions and changelogs

Every desktop module in `src/modules/` has its own version and its own changelog. Work on a module happens on a
short-lived branch of its own, cut from `main` and merged back to `main`. Each module release is tagged. The
WorkSuite server follows the same rules for its modules (`app/Modules/`, its `docs/MODULES.md`). The two are
versioned separately: desktop `pos` 1.3.0 and server `Pos` 2.1.0 are different things.

## What a module carries

```
src/modules/pos/
  module.json     {"module": "pos", "version": "1.3.0", "paths": ["electron/services/pos-till.ts", …]}
  CHANGELOG.md    "## 1.3.0 — 2026-10-02" sections, newest first
```

- **`version`** is semantic:
  - **MAJOR** when something else has to change with it: another module, the IPC contract (`shared/ipc`), the
    server API it needs, or data it keeps on the computer (offline queues, caches, the local database) in a shape
    an older version cannot read.
  - **MINOR** for something new.
  - **PATCH** for a fix.
- **`paths`** are files outside the module's folder that are still its own: its main-process services in
  `electron/services/` (`pos-*.ts`, `local-ai/` for `ai` …). A change there asks for the module's version too. Add
  to it when a module gains a service.
- **The app's version** (`package.json`, the 0.2.x an installer carries) and the root `CHANGELOG.md` stay as
  they are: they are what people install and read. A module's version is that module's history alone.

## Branches

| Branch | For |
|---|---|
| `main` | What is released. Every module's current version. |
| `module/<module>/<topic>` | One piece of work on one module, e.g. `module/pos/drawer-rules`. Cut from `main`, merged back by pull request, then deleted. |

When the work has to change another module or shared code (`src/core`, `shared/`, `electron/main`), do it on the
same branch and give each changed module its own version. Shared code outside every module needs no module
version, but a change to `shared/ipc` usually means a MAJOR for the modules that use the channel.

Keep branches short-lived: days, not weeks. Merge `main` into a branch that has fallen behind (don't rebase a
branch someone else has checked out).

## Making a change

1. `npm run module -- branch pos "drawer rules"` → `module/pos/drawer-rules`, from `origin/main`.
2. Make the change and its tests.
3. Raise the version and write the changelog section in one step:

   ```
   npm run module -- release pos minor "Added: the drawer rules" "Fixed: a receipt's rounding"
   ```

   A note may start with `Added:`, `Changed:`, `Deprecated:`, `Removed:`, `Fixed:` or `Security:`, and is grouped
   under that heading. A note without a prefix is listed as it is. Release once per branch, at the level of the
   biggest change on it.
4. Bump the app's version and root `CHANGELOG.md` as before when this goes into an installer.
5. Open the pull request. **Module versions** (`.github/workflows/modules.yml`) runs the check, and the pull request
   cannot pass while a module it changes has no new version and changelog section.
6. After the merge, on `main`: `npm run module -- tag --create`, then push the tags it names.

## The commands

| `npm run module -- …` | Does |
|---|---|
| `list` | Every module, its version, its newest changelog section and its tag. |
| `branch <module> "<topic>" [--dry]` | Creates `module/<module>/<topic>` from the latest `origin/main`. |
| `release <module> <patch\|minor\|major> "note" …` | Raises the version and writes the changelog section. |
| `check [base] [--skip a,b]` | Lists the modules this branch changed since it left `base` (default `origin/main`); fails (exit 1) for any without a higher version and a matching section. |
| `tag [--create]` | The `<module>/vX.Y.Z` tags `main` is missing; `--create` makes them. |
| `init` | Gives a new module a `module.json` and a `CHANGELOG.md` at 1.0.0. |

`tests/unit/electron/module-versions.test.ts` fails while any module has no `module.json`, or has one whose version
its changelog's newest section does not match.

## Checking before you push

```
git config core.hooksPath scripts/git-hooks      # once per clone
```

The hook runs the check against `origin/main` before every push. `MODULE_SKIP=chat,pos git push` leaves modules out
on purpose, for a mechanical change across many; `git push --no-verify` skips the check entirely. CI still runs
it on the pull request.
