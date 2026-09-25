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

## 3. The release key

Generated once with `npm run release:keygen`: the private key goes to
`~/.worksuite-desktop-release/release-ed25519.pem` (mode 600) and must be moved
to the release vault and the `WS_RELEASE_PRIVATE_KEY` secret; the public key
is written into `electron/updater/keys.ts`. Rotating it means shipping one
release, signed with the old key, whose app pins the new one.

## 4. Publish

Put the installers and `manifest.json` side by side where clients look:

- servers with the desktop API: `/desktop/v1/releases/manifest` (served by the backend);
- other servers: `https://<server>/desktop/releases/<channel>/manifest.json`.

Manually:

```bash
node scripts/release-manifest.mjs --dir release/0.2.0 --channel stable --base-url ./ [--critical] [--minimum 0.1.0]
```

`--critical` makes clients install at the policy deadline (default 24 h, with
warnings at 4 h, 1 h and 10 min); `--minimum` makes older clients show the
blocking Update Required screen.

## 5. Enterprise deployment (§16.2)

- Windows: the `.msi` is machine-wide (Intune, GPO, SCCM); policy in
  `HKLM\Software\Policies\WorkSuite` (`server_url`, `disable_server_change`,
  `proxy_mode`, `proxy_url`, …).
- macOS: the `.pkg` for Jamf/MDM; a configuration profile for
  `com.livezen.worksuite` with the same keys.
- Linux: `.deb`/`.rpm`; `/etc/worksuite/policy.json`.
- Any platform: `enterprise.json` in the app's resources for custom builds.
