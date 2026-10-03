# Releasing

## 1. Version

Bump `version` in `package.json`, add a CHANGELOG entry, commit, tag `vX.Y.Z`
and push the tag. The **Build** workflow checks, packages every platform, and
— for tags — signs a release manifest.

## 2. Signing secrets (GitHub → Settings → Secrets)

| Secret | For |
|---|---|
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | Developer ID Application certificate (.p12, base64) |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | notarization (App Store Connect API key) |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Authenticode certificate — or the Azure Trusted Signing set: |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TRUSTED_SIGNING_ACCOUNT`, `AZURE_TRUSTED_SIGNING_PROFILE`, `AZURE_TRUSTED_SIGNING_ENDPOINT` | |
| `WS_RELEASE_PRIVATE_KEY` | the Ed25519 release key (PEM) that signs manifests |
| `WS_POLICY_PUBLIC_KEY` | optional: the server's policy-signing public key (PEM) |

Without the platform secrets the builds are unsigned. Unsigned macOS builds
are refused by Gatekeeper on other machines; unsigned Windows builds trigger
SmartScreen; and no unsigned build can update itself.

**A test DMG without an Apple certificate:** `npm run dist:mac:unsigned`
writes `release/<version>/WorkSuite-<version>-universal.dmg`. It is signed
ad hoc and built **without the hardened runtime**. With hardened runtime and an
ad-hoc signature, macOS refuses to load the Electron framework — the app dies
at launch with `Library not loaded: … Electron Framework` — because library
validation needs a Team ID that an ad-hoc signature does not have. A Developer
ID build keeps the hardened runtime (`npm run dist:mac` with the secrets
above). On another Mac, the first open of an unsigned DMG's app needs
right-click → Open, or `xattr -dr com.apple.quarantine /Applications/WorkSuite.app`.

## 3. The release key

Generated once with `npm run release:keygen`: the private key goes to
`~/.worksuite-desktop-release/release-ed25519.pem` (mode 600) and must be moved
to the release vault and the `WS_RELEASE_PRIVATE_KEY` secret; the public key
is written into `electron/updater/keys.ts`. Rotating it means shipping one
release, signed with the old key, whose app pins the new one.

## 4. Publish — the WorkSuite Update Center

The app asks the **WorkSuite Update Center** (https://download.worksuitecloud.com,
repo `Livezen-Technologies/worksite-download`) whether to update:
`GET /api/v1/desktop/update?app_id=lk.worksuite.desktop&current_version=…&platform=…&architecture=…&install_type=…&channel=…&device_id=…&os_version=…`
(`electron/updater/update-center.ts`). The answer is signed with the Update
Center's response key (`ws-uc-resp-1`, pinned in that file); the package's
size and SHA-256 sit inside the signed answer, and the download comes from its
15-minute signed URL (the download grant buys a fresh one). A channel that is
not public there falls back to Stable unless a tenant policy names it.

Publish a build with the Update Center's script (from that repo; Node 20, no
dependencies). Each `--file` is `platform:arch:type:path`; Windows x64, macOS
arm64, macOS x64 and Linux x64 are required. Build one DMG per Mac architecture
(`electron-builder --mac dmg --arm64 --x64`): the universal merge currently
fails with "pattern is too long". The build number must rise per channel — use the patch number.

```bash
UC_CI_TOKEN_FILE=~/.config/worksuite-release/ci-token \
UC_CI_KEY_FILE=~/.config/worksuite-release/ci-attestation.key \
node scripts/publish-release.mjs --app desktop --app-id lk.worksuite.desktop --channel BETA \
  --version 0.2.125 --build 125 --commit <sha> --summary "WorkSuite Desktop 0.2.125" --notes notes.md \
  --file windows:x64:exe:release/0.2.125/WorkSuite-Setup-0.2.125-x64.exe \
  --file macos:arm64:dmg:release/0.2.125/WorkSuite-0.2.125-arm64.dmg \
  --file macos:x64:dmg:release/0.2.125/WorkSuite-0.2.125-x64.dmg \
  --file linux:x64:appimage:release/0.2.125/WorkSuite-0.2.125-x86_64.AppImage
```

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

The older self-hosted manifest (`scripts/release-manifest.mjs`, the
`RELEASE_PUBLIC_KEY` in `electron/updater/keys.ts`) is no longer read by the
app.

## 4a. Channels, notices and the first run (worksuite-desktop#205)

**Channels.** Settings › About › Channel offers Stable, Beta and Dev / Nightly — only those the
organisation's desktop policy allows (`auto_update: enforced` locks the channel to `update_channel`;
`user_choice` offers `allowed_update_channels` — Stable always, default all three — and starts a computer on
`update_channel_default` until its person picks one; a channel the organisation stops allowing is shown as
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

The person sees "Updated to X · What's new" once, or a notice that the update was rolled back.

**Signing and installer formats.** Nothing here changes signing. macOS updates still need Developer ID +
notarisation for Stable (section 2); the updater checks the new app's Team ID against the running one. Windows
updates download the full NSIS installer and run it silently (`/S`): NSIS differential downloads
(`.blockmap`) belong to electron-updater, which this app does not use, so they do not apply. Publish one DMG per
Mac architecture as above (`build/electron-builder.config.cjs` still lists `universal` targets; the release
command overrides them with `--arm64 --x64`).

## 5. Enterprise deployment (§16.2)

- Windows: the `.msi` is machine-wide (Intune, GPO, SCCM); policy in
  `HKLM\Software\Policies\WorkSuite` (`server_url`, `disable_server_change`,
  `proxy_mode`, `proxy_url`, …).
- macOS: the `.pkg` for Jamf/MDM; a configuration profile for
  `com.livezen.worksuite` with the same keys.
- Linux: `.deb`/`.rpm`; `/etc/worksuite/policy.json`.
- Any platform: `enterprise.json` in the app's resources for custom builds.
