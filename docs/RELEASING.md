# Releasing

## 1. Version

Bump `version` in `package.json`, add a CHANGELOG entry (`## X.Y.Z — date`),
commit, tag `vX.Y.Z` and push the tag. The **Build** workflow
(`.github/workflows/build.yml`; its release steps are `build/release-ci.mjs`)
then:

1. **checks the tag**: it must be `v` + `package.json`'s version, or the run
   stops before anything is built. The patch number is the Update Center build
   number (`0.2.283` → build 283), so it must be above 0;
2. checks, tests and **packages every platform, signed**: a tag is a release
   build, which fails without its macOS and Windows signing secrets (§2);
3. **publishes to the Update Center** (§4) on the **BETA** channel, stopping at
   READY_FOR_TEST.

A manual run (*Actions › Build › Run workflow*) picks the channel — BETA
(default), DEV, INTERNAL or STABLE — and publishes the branch or tag it is run
on. **STABLE is a release build too**: it must be signed on every platform,
Linux GPG included, whatever the ref. Publish STABLE by running the workflow on
the release's tag. Branch and pull-request builds are never published, and may
be unsigned (each says so in a warning).

**Minimum server version (worksuite-desktop#259).** A release that uses new
server endpoints lists the minimum WorkSuite module versions it needs in its
CHANGELOG entry and release notes, for example "Needs Communication 2.4.0 or
later".

- Record each new feature's version in `MIN_COMMUNICATION`
  (`src/modules/chat/website/widget/serverSupport.ts`). The admin notice can
  then name it.
- Add the feature's key to the server's `GET /api/capabilities` list (see
  [BACKEND.md](BACKEND.md)).
- Beta may ship ahead of the server: unsupported screens stay hidden, and
  admins see the notice. **Stable is not published until the matching server
  version is live** on app.worksuite.lk and the demo server.

## 2. Signing secrets (GitHub → Settings → Secrets)

| Secret | For |
|---|---|
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | Developer ID Application certificate (.p12, base64) |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | notarization (App Store Connect API key) |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Authenticode certificate — or the Azure Trusted Signing set: |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TRUSTED_SIGNING_ACCOUNT`, `AZURE_TRUSTED_SIGNING_PROFILE`, `AZURE_TRUSTED_SIGNING_ENDPOINT` | |
| `UC_CI_TOKEN` | the Update Center CI API client, `<client_id>.<secret>` (kind CI: release.view, release.create, release.upload, release.file.upload, changelog.manage, release.edit) |
| `UC_CI_KEY` | the base64 libsodium Ed25519 **secret** key whose public half the Update Center pins as the CI_ATTESTATION key `ws-ci-1` |
| `UC_SCRIPT_TOKEN` | a read-only token for `Livezen-Technologies/worksite-download` (a fine-grained token or GitHub App token with *Contents: read* on that repository): the publish script lives there, and that repository is private |
| `WS_POLICY_PUBLIC_KEY` | the server's policy-signing public key (PEM). Without it, a release build applies **no** desktop policy unless the account has its own `discovery_key` (`POLICY_UNSIGNED_REFUSED`, see BACKEND.md); the build says so in a warning |

`APPLE_API_KEY` holds the **contents** of the App Store Connect `.p8` key; the
Package step writes it to a file for notarization, which reads a path. Set
`APPLE_TEAM_ID` too: the signed app's Team ID is checked against it.

**Which builds must be signed (audit D-G02).** A *release build* — a pushed
`v*` tag, or a manual run on the STABLE channel (`WS_RELEASE=1`, passed to
electron-builder as `WS_RELEASE_BUILD`) — fails in the package job's first step
when its platform's secrets are missing:

| Platform | A release needs |
|---|---|
| macOS | `MAC_CSC_LINK` + `MAC_CSC_KEY_PASSWORD`, and `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`. After signing, `build/mac-signing.cjs` reads the app back with `codesign` and fails a release that is not Developer ID-signed with the hardened runtime. |
| Windows | `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD`, or the six `AZURE_*` secrets. After packaging, every `.exe` and `.msi` is checked with `Get-AuthenticodeSignature`; a release fails unless each is `Valid`. |
| Linux | `LINUX_GPG_PRIVATE_KEY` on STABLE only (the Update Center takes unsigned Linux packages on BETA, DEV and INTERNAL). |

Every other build (branches, pull requests, manual BETA/DEV/INTERNAL runs on a
branch) packages unsigned and says so in a warning. Unsigned macOS builds are
refused by Gatekeeper on other machines; unsigned Windows builds trigger
SmartScreen; and an unsigned build updates itself only from a test channel
(§4).

**A test DMG without an Apple certificate:** `npm run dist:mac:unsigned`
writes `release/<version>/WorkSuite-<version>-universal.dmg`. It is signed
ad hoc and built **without the hardened runtime**. With hardened runtime and an
ad-hoc signature, macOS refuses to load the Electron framework — the app dies
at launch with `Library not loaded: … Electron Framework` — because library
validation needs a Team ID that an ad-hoc signature does not have. A Developer
ID build keeps the hardened runtime (`npm run dist:mac` with the secrets
above). On another Mac, the first open of an unsigned DMG's app needs
right-click → Open, or `xattr -dr com.apple.quarantine /Applications/WorkSuite.app`.

## 3. The legacy release key (no longer used by CI)

`npm run release:keygen` made the Ed25519 key that signed the self-hosted
manifests of `scripts/release-manifest.mjs`; its public half is still
`RELEASE_PUBLIC_KEY` in `electron/updater/keys.ts`. The app no longer reads
those manifests — it asks the Update Center (§4), whose response keys are
pinned in `electron/updater/update-center.ts` — so the Build workflow's
`manifest` job, which signed one for tags with `WS_RELEASE_PRIVATE_KEY`, is
retired (audit D-G01). The `WS_RELEASE_PRIVATE_KEY` secret can be deleted. The
scripts stay for their tests and for a self-hosted mirror.

## 4. Publish — the WorkSuite Update Center

The app asks the **WorkSuite Update Center** (https://download.worksuitecloud.com,
repo `Livezen-Technologies/worksite-download`) whether to update:
`GET /api/v1/desktop/update?app_id=lk.worksuite.desktop&current_version=…&platform=…&architecture=…&install_type=…&channel=…&device_id=…&os_version=…`
(`electron/updater/update-center.ts`). The answer is signed with the Update
Center's response key (`ws-uc-resp-1`, pinned in that file); the package's
size and SHA-256 sit inside the signed answer, and the download comes from its
15-minute signed URL (the download grant buys a fresh one). A channel that is
not public there falls back to Stable unless a tenant policy names it.

**CI publishes it** (audit D-G01). The Build workflow's `publish` job runs on a
`v*` tag and on a manual run, after every platform has packaged. It checks out
`scripts/publish-release.mjs` from `Livezen-Technologies/worksite-download` at a
pinned commit (the repository variable `UC_SCRIPT_REF` moves it; the script is
given the CI token and key, so it is not taken from a moving branch), and runs
it on Node 20 with `UC_CI_TOKEN` and `UC_CI_KEY` (§2). It publishes:

| `--file` | From the build |
|---|---|
| `windows:x64:exe` | `WorkSuite-Setup-<version>-x64.exe` |
| `macos:arm64:dmg` and `macos:x64:dmg` | the one `WorkSuite-<version>-universal.dmg`, twice |
| `linux:x64:appimage`, `linux:x64:deb`, `linux:x64:rpm` | `WorkSuite-<version>-x86_64.AppImage`, `-amd64.deb`, `-x86_64.rpm` |

with `--version` from `package.json`, `--build` the patch number, `--channel`
BETA (or the manual run's choice), `--commit` the built commit, and the
version's CHANGELOG section as `--notes`. A missing installer stops the job
before anything is sent. **Without `UC_CI_TOKEN`, `UC_CI_KEY` or
`UC_SCRIPT_TOKEN` the job warns and publishes nothing**; the installers are
still the run's artifacts, and can be published by hand as below.

By hand: the Update Center's script (from that repo; Node 20, no
dependencies). Each `--file` is `platform:arch:type:path`; Windows x64, macOS
arm64, macOS x64 and Linux x64 are required. **macOS is one universal DMG**: CI and
`npm run dist:mac` build `WorkSuite-<version>-universal.dmg` (`mac.target` in
`build/electron-builder.config.cjs`; the merge that once failed with "pattern is
too long" works since `x64ArchFiles` names node-llama-cpp's and reflink's one-arch
binaries). The app asks the Update Center for its own architecture (`arm64` or
`x64`, never `universal`) and the Update Center matches the architecture exactly
(`UpdateResolverService`), so **publish that same universal DMG twice**, as
`macos:arm64:dmg` and `macos:x64:dmg`. A package published only as
`macos:universal:dmg` is offered to no Mac. The build number must rise per channel — use the patch number.

```bash
UC_CI_TOKEN_FILE=~/.config/worksuite-release/ci-token \
UC_CI_KEY_FILE=~/.config/worksuite-release/ci-attestation.key \
node scripts/publish-release.mjs --app desktop --app-id lk.worksuite.desktop --channel BETA \
  --version 0.2.125 --build 125 --commit <sha> --summary "WorkSuite Desktop 0.2.125" --notes notes.md \
  --file windows:x64:exe:release/0.2.125/WorkSuite-Setup-0.2.125-x64.exe \
  --file macos:arm64:dmg:release/0.2.125/WorkSuite-0.2.125-universal.dmg \
  --file macos:x64:dmg:release/0.2.125/WorkSuite-0.2.125-universal.dmg \
  --file linux:x64:appimage:release/0.2.125/WorkSuite-0.2.125-x86_64.AppImage \
  --file linux:x64:deb:release/0.2.125/WorkSuite-0.2.125-amd64.deb \
  --file linux:x64:rpm:release/0.2.125/WorkSuite-0.2.125-x86_64.rpm
```

**Every Linux format goes up** (worksuite-desktop#345). Each copy asks for the type it was installed as — an
AppImage for an AppImage, a `.deb` for a `.deb` install (`resources/package-type`), an `.rpm` for an `.rpm` — and is
never offered another. A release without the `.deb` leaves every `.deb` install where it is. A `.deb`/`.rpm` install
updates with one password prompt (`pkexec apt-get install` / `dnf install` of the downloaded, SHA-256-checked
package), or opens the package in the software installer when that prompt cannot be shown.

### Signing Linux packages

The `.deb` and `.rpm` name `Livezen Technologies <support@worksuitecloud.com>` as their maintainer
(`linux.maintainer` in `build/electron-builder.config.cjs`).

The packages are GPG-signed in CI by the optional step *Sign Linux packages (GPG)* in `build.yml`, which runs only
when the `LINUX_GPG_PRIVATE_KEY` secret exists; without it the step says so in a notice and the packages go out
unsigned, as before.

| Secret | For |
|---|---|
| `LINUX_GPG_PRIVATE_KEY` | the ASCII-armoured **private** signing key (`gpg --armor --export-secret-keys <key id>`). Use the same key as the APT/DNF repositories so one public key (`WORKSUITE_REPO_GPG_PUBLIC_KEY`, `https://download.worksuitecloud.com/apt/worksuite.asc`) checks both |
| `LINUX_GPG_PASSPHRASE` | its passphrase, if it has one |

What it signs:

- **`.rpm`**: an embedded signature (`rpmsign --addsign`). Check one with
  `rpm --import worksuite.asc && rpm -K WorkSuite-*.rpm` (it says `digests signatures OK`). dnf and zypper check it
  when `gpgcheck=1` and the key is imported, as the repository's `.repo` file sets up.
- **`.deb` and AppImage**: a detached signature beside each (`WorkSuite-*.deb.asc`, `WorkSuite-*.AppImage.asc`),
  checked with `gpg --verify WorkSuite-*.deb.asc WorkSuite-*.deb`. APT does not check signatures inside a `.deb`;
  what it checks is the repository's signed `InRelease`, which the repository pipeline signs.

The step signs after electron-builder and before the upload, so the SHA-256 the Update Center records is the signed
file's. Publish the `.asc` files with the release so people can check a download by hand. Until packages are signed,
the in-app update of an `.rpm` through zypper passes `--allow-unsigned-rpm` (`electron/updater/linux.ts`); the
downloaded file is still checked against the SHA-256 in the Update Center's signed answer first.

### APT and DNF repositories (worksuite-desktop#351) — off until the repository is live

A `.deb`/`.rpm` install can also list `https://download.worksuitecloud.com/apt` (suites `stable`, `beta`, `dev`,
component `main`) or `/rpm/<channel>` as a package source, so WorkSuite updates arrive with the system's own updates.
**This is off by default and must stay off until the repository answers**: a package source that does not exist yet
breaks `apt update` on every computer that has it.

Off (today's builds), nothing changes: the packages add no source, the channel switch rewrites nothing, Update now
installs the downloaded package, and Diagnostics shows the three repository checks as *Not set up yet*.

On, a build made with `WORKSUITE_LINUX_REPO=1` (`build/linux-repo.cjs`) carries `resources/linux-repo` (the address
and the build's channel), the repository's public key and the root-side helper `resources/worksuite-repo`:

| What | With the switch on |
|---|---|
| `.deb` after-install | `/usr/share/keyrings/worksuite.gpg` and `/etc/apt/sources.list.d/worksuite.sources` (deb822: `Types: deb`, `URIs: …/apt`, `Suites:` the channel, `Components: main`, `Signed-By:` the keyring). An upgrade keeps the suite the file already has. |
| `.rpm` after-install | `/etc/pki/rpm-gpg/RPM-GPG-KEY-worksuite` and `/etc/yum.repos.d/worksuite.repo` (`baseurl=…/rpm/<channel>`, `repo_gpgcheck=1`). |
| Uninstall / purge / erase | Both files go (only a source file carrying WorkSuite's header line; one an administrator wrote stays). Not on an upgrade. |
| Changing the channel | `pkexec resources/worksuite-repo setup <deb\|rpm> <suite>` rewrites `Suites:` / the baseurl. A closed prompt leaves the channel changed and Diagnostics offers Fix. |
| Diagnostics | *Package repository* (the file exists and follows the channel), *Repository signing key*, *Repository version* (`apt-cache policy worksuite` / `dnf repoquery` has the newest version). Each problem has **Fix**: the helper rewrites the key and file and re-reads the lists, behind one password prompt. |
| Update now (`.deb`) | When the source follows this channel and apt already offers exactly the new version from it: `pkexec apt-get install --only-upgrade -y worksuite`. Otherwise, or if that fails, the downloaded package as before. |

**Turning it on** (once the portal's repository is published and `curl -fsI https://download.worksuitecloud.com/apt/dists/stable/InRelease` answers 200, see the portal's `docs/linux-repositories.md`):

1. In this repository's *Settings › Secrets and variables › Actions › Variables*, set `WORKSUITE_REPO_GPG_PUBLIC_KEY`
   to the ASCII-armoured **public** key (`gpg --armor --export <key id>`; the same file as
   `https://download.worksuitecloud.com/apt/worksuite.asc`) and `WORKSUITE_LINUX_REPO` to `1`. A local build takes
   the same two environment variables (the key as a file path or the armoured text); `WORKSUITE_LINUX_REPO_URL`
   overrides the address for a staging repository.
2. Build. The build refuses `WORKSUITE_LINUX_REPO=1` without the key, and refuses a private key.
3. Check a package before publishing it: `dpkg-deb -c WorkSuite-*.deb | grep -E 'resources/(linux-repo|worksuite-repo)'`.
4. Publish the release as usual, then add its `.deb`/`.rpm` to the repository (the portal's *Linux repositories*
   workflow, with the version and channel). Copies installed before the switch get the source with their next
   package update.

To turn it off again, unset `WORKSUITE_LINUX_REPO`: the next package's after-install adds nothing, and Diagnostics'
Fix stops offering itself. Sources already written stay until the package is removed (or `sudo rm
/etc/apt/sources.list.d/worksuite.sources`).

The script stops at **READY_FOR_TEST**; people approve and publish in the
Update Center's `/admin`. Unsigned installers are accepted on BETA, DEV and
INTERNAL only; STABLE needs Authenticode, Developer ID + notarization and GPG
for Linux, and two different approvers. An unsigned running build installs
an update by itself only from a test channel (BETA, DEV, INTERNAL) and only
when it is set to that channel: the signed answer and the package's SHA-256
are then the trust, as for a Linux AppImage. Stable never installs an unsigned
update, and a signed build never takes an unsigned one.

On a Mac the updater takes the `.app` out of the DMG (mounted read-only and
hidden), checks its code signature against the running app's Team ID, and
swaps it in after quit.

A new version downloads by itself and waits for the person's restart. People
can turn that off (Settings › Updates › Download updates automatically) only
where the server's desktop policy sets `auto_update` to `user_choice`; the
default, `enforced`, keeps it on. Critical and required releases download
either way. The title-bar update icon and one system notification per version
tell people when a new version is available or ready.

The older self-hosted manifest (`scripts/release-manifest.mjs`, the
`RELEASE_PUBLIC_KEY` in `electron/updater/keys.ts`) is no longer read by the
app, and CI no longer signs one (§3).

## 4a. Channels, notices and the first run (worksuite-desktop#205)

**Channels.** Settings › Updates offers Stable, Beta and Dev / Nightly — only those the
organisation's desktop policy allows (`auto_update: enforced` locks the channel to `update_channel`;
`user_choice` offers `allowed_update_channels` — Stable always, default all three — and starts a computer on
`update_channel_default` (Beta by default) until its person picks one; a channel the organisation stops allowing is shown as
"Not allowed by your organisation", and the computer falls back to Stable at the next check without a downgrade,
saying so once). Each channel has its own release line:

| Channel | Update Center | electron-updater-style feed | Version format | Pre-releases |
|---|---|---|---|---|
| Stable | `STABLE` | `latest` | `0.2.126` | never |
| Beta | `BETA` | `beta` | `0.2.127-beta.1` | beta / rc |
| Dev / Nightly | `DEV` | `alpha` | `0.2.127-dev.20261003` | all |

Publish each build to its channel with `--channel STABLE|BETA|DEV`. The app refuses a pre-release version on
Stable even if one were offered, and never installs an older version except after the person chooses
**Reinstall Stable now**: that check carries `allow_downgrade=1`, and the Update Center must then answer with
the channel's current build and package even though it is older (status `UPDATE_AVAILABLE`). Without that,
the app says there is nothing to reinstall and waits for the channel to catch up.

**What the app reads from the signed answer.** `release_type` `CRITICAL` or `SECURITY` marks a security update
(stronger banner; downloads even when automatic downloads are off; put off twice, it installs at the next
launch). `highlights` (up to 8 lines) and an optional `summary` are "What's new in X"; `release_notes_url` is
"View full release notes". Pass `--summary` and `--notes` to the publish script so these are filled.

**Fields for the Updates & License screens.** All optional; the app shows what it gets and leaves the rest out.
They sit inside the signed answer like everything else:

| Field | Type | Used for |
|---|---|---|
| `build_number` | integer | "Version 2.7.0 · build 27001" (update dialog) |
| `published_at` | ISO 8601 | "Recommended · 24 Sep 2026" (Settings › Updates) |
| `publisher` | string | "Signed by …" under the package line. Without it the dialog says "Signed release". |
| `security_fixes`, `known_issues[]` | integer, strings | "Security: 1 fix · Known issues: none" |
| `mandatory` | boolean | `true` makes the release required, like status `UPDATE_REQUIRED` |
| `required_by` | ISO 8601 | A required release's own install-by time. Without it the deadline is when this computer first learnt the update was required, plus the desktop policy's `forced_update_deadline_hours`. |
| `max_deferrals` | integer 0–20 | How often a required update may be put off (default 3) |
| `grace_minutes` | integer 1–120 | A `CRITICAL` release installs this many minutes after it is staged (default 5) |
| `package.size`, `package.type` | as before | The package line ("Windows x64 · EXE · 320 MB") |

The app also reads `key_id` (shown as the manifest key) and the existing `release_type` (the badge: RECOMMENDED,
SECURITY, CRITICAL…). The package is always the full installer: there are no delta packages.

**Required updates and the deadline.** A computer is required to update when its version is below the policy's
`minimum_version` for its platform (or the answer's `effective_minimum`), when the answer is `UPDATE_REQUIRED`,
`UNSUPPORTED`, `RELEASE_WITHDRAWN` or `mandatory: true`, or when a business API refuses it. Until the deadline the
app shows a banner with Remind me later (only while the reminder comes back before the deadline, and at most
`max_deferrals` times) and Update Now, and a countdown in the last 6 hours. After the deadline Mail, Chat, Files and
the other modules lock; Settings › Updates, its Diagnostics, License and Sign Out stay open. The first time a
computer learns it is required is kept in `updates/required.json`, so restarting does not reset the clock.

**The server refusing a version.** Any API answer with `code: "UPDATE_REQUIRED"` (or `VERSION_UNSUPPORTED`, or
HTTP 426) locks modules at once, whatever the deadline. A realtime event `desktop.release.published` makes the app
ask the Update Center at once instead of at the next 4-hourly check.

**CRITICAL releases.** `release_type: CRITICAL` downloads even when automatic downloads are off, saves drafts and
open tabs as soon as it is staged, shows the Critical Security Update modal with the time left, and installs when
`grace_minutes` (default 5) are up, ending a call or meeting. `SECURITY` keeps the gentler path above.

**Downloads** resume with HTTP `Range` after Pause, a lost connection (5 tries, up to a minute apart) or a restart
of WorkSuite. The CDN should answer `206 Partial Content` with `Content-Range`; a server that ignores Range still
works, from the start. The download grant is asked once for a fresh URL when the signed URL is refused.

**Diagnostics** (Settings › Updates › Diagnostics) asks the Update Center once without changing anything, asks the
package URL for one byte, reads free space (the package twice on Windows and Linux, three times on macOS for the
DMG, the app and the rollback copy), checks that the install folder is writable, runs SQLite `quick_check`, and
reads when the sign-in was last confirmed. Export saves it as text.

**Checks** run 30 s after launch, every 4 hours and 15 s after the computer wakes. Every check, download,
install, Later, rollback and channel change is written to `updates/history.jsonl` and is `updates.json` in the
Diagnostics report.

**First run and rollback.** Before installing, the app writes `updates/install-marker.json`. The new version
is healthy once its main window has loaded and stayed up 10 s (`health-<version>.ok`).

| Platform | What happens if the new version does not start |
|---|---|
| macOS | The previous `WorkSuite.app` is kept in `updates/rollback/`. The swap script waits up to 180 s for the health file and otherwise puts the previous app back and opens it; the new version also rolls itself back if it starts three times without becoming healthy. |
| Linux AppImage | The previous image is kept as `<AppImage>.previous`; a watchdog script does the same as on macOS. |
| Windows (NSIS) | Not possible automatically: the per-user NSIS installer replaces the previous version and no copy is kept. The failure is reported in the app and in Diagnostics; Safe Mode follows repeated crashes; the person can reinstall from the Update Center. |

The person sees "What's New in X" once (the release's `highlights`, and the local database schema change if the
start migrated it) unless they turned it off in Settings › Updates, or "Updated to X · What's new" when the release
sent no highlights. A rollback shows the Update Failed panel in Settings › Updates with its code
(`UPDATE_INSTALL_FAILED`), the rollback state and a reference (`UA-XXXX-XX`, also in `history.jsonl`).

**Signing and installer formats.** Nothing here changes signing. macOS updates still need Developer ID +
notarisation for Stable (section 2); the updater checks the new app's Team ID against the running one. Windows
updates download the full NSIS installer and run it silently (`/S`): NSIS differential downloads
(`.blockmap`) belong to electron-updater, which this app does not use, so they do not apply. Publish the one
universal DMG as both `macos:arm64` and `macos:x64`, as above.

## 5. Enterprise deployment (§16.2)

- Windows: the `.msi` is machine-wide (Intune, GPO, SCCM); policy in
  `HKLM\Software\Policies\WorkSuite` (`server_url`, `disable_server_change`,
  `proxy_mode`, `proxy_url`, …).
- macOS: the `.pkg` for Jamf/MDM; a configuration profile for
  `com.livezen.worksuite` with the same keys.
- Linux: `.deb`/`.rpm`; `/etc/worksuite/policy.json`.
- Any platform: `enterprise.json` in the app's resources for custom builds.
