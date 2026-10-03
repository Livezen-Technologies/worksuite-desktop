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
  --version 0.2.124 --build 124 --commit <sha> --summary "WorkSuite Desktop 0.2.124" --notes notes.md \
  --file windows:x64:exe:release/0.2.124/WorkSuite-Setup-0.2.124-x64.exe \
  --file macos:arm64:dmg:release/0.2.124/WorkSuite-0.2.124-arm64.dmg \
  --file macos:x64:dmg:release/0.2.124/WorkSuite-0.2.124-x64.dmg \
  --file linux:x64:appimage:release/0.2.124/WorkSuite-0.2.124-x86_64.AppImage
```

The script stops at **READY_FOR_TEST**; people approve and publish in the
Update Center's `/admin`. Unsigned installers are accepted on BETA, DEV and
INTERNAL only; STABLE needs Authenticode, Developer ID + notarization and GPG
for Linux, and two different approvers. An unsigned running build still never
installs an update by itself (it says so and offers the download) — only a
Linux AppImage, whose trust is the signed answer and its SHA-256, does.

On a Mac the updater takes the `.app` out of the DMG (mounted read-only and
hidden), checks its code signature against the running app's Team ID, and
swaps it in after quit.

The older self-hosted manifest (`scripts/release-manifest.mjs`, the
`RELEASE_PUBLIC_KEY` in `electron/updater/keys.ts`) is no longer read by the
app.

## 5. Enterprise deployment (§16.2)

- Windows: the `.msi` is machine-wide (Intune, GPO, SCCM); policy in
  `HKLM\Software\Policies\WorkSuite` (`server_url`, `disable_server_change`,
  `proxy_mode`, `proxy_url`, …).
- macOS: the `.pkg` for Jamf/MDM; a configuration profile for
  `com.livezen.worksuite` with the same keys.
- Linux: `.deb`/`.rpm`; `/etc/worksuite/policy.json`.
- Any platform: `enterprise.json` in the app's resources for custom builds.
