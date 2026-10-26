# macOS TestFlight

How to build WorkSuite Desktop for the Mac App Store and send it to TestFlight, Apple's beta-testing service. It is
written for someone doing this for the first time, with no prior knowledge of the app or of Apple's signing system.

## What you are doing, in one paragraph

WorkSuite Desktop is an [Electron](https://www.electronjs.org/) app (a web app packaged as a native desktop app). It is
normally shipped as a direct download (`.dmg`/`.pkg`, see [RELEASING.md](RELEASING.md)). TestFlight is different: the
app has to be built as a **Mac App Store build**, which runs inside Apple's App Sandbox, is signed with the company's
App Store certificates, and is uploaded to **App Store Connect** as a signed **`.pkg`** file. Apple then processes it and
offers it to testers through the TestFlight app.

```
 npm run dist:mas  ──►  WorkSuite-<version>-universal.pkg  ──►  Transporter  ──►  App Store Connect  ──►  TestFlight
 (build + sign)          (one file, Intel + Apple Silicon)       (upload)          (10–30 min processing)    (testers)
```

## Key facts

| | |
|---|---|
| Apple team | Livezen Technologies LLC — team ID **7KQULK6DSS** |
| Bundle ID | `lk.worksuite.desktop` |
| App Store Connect name | **WorkSuite Desktop** (Apple ID `6827131079`) |
| Build command | `npm run dist:mas` |
| Output file | `release/<version>/mas-universal/WorkSuite-<version>-universal.pkg` (about 350 MB) |
| Build time | 15–25 minutes, most of it signing |
| Provisioning profile expires | 26 October 2027 (re-create it then, step 1.3) |

## Words you will see

| Term | Meaning |
|---|---|
| **Bundle ID** | The app's unique name at Apple: `lk.worksuite.desktop`. Must be identical everywhere below. |
| **Certificate** | Proves a file was signed by Livezen. Lives in the Mac's Keychain together with a private key. |
| **Provisioning profile** | A file from Apple that says "this bundle ID, signed by this certificate, may go to the App Store". |
| **Entitlements** | The permissions the sandboxed app asks for (network, camera, microphone, files). In `build/entitlements.mas*.plist`. |
| **App Sandbox** | Apple's isolation for App Store apps. Required; it limits some features (see [Known limits](#known-limits-of-the-sandboxed-build)). |
| **Transporter** | Apple's free Mac app that uploads the `.pkg` to App Store Connect. |
| **Build number** | `CFBundleVersion`. Must go up with every upload of the same version (1, 2, 3…). |
| **`.ipa` / `.xcarchive`** | iPhone and Xcode formats. **Not used here.** A Mac build is a `.pkg` and never appears in Xcode's Organizer. |

## 1. One-time setup

Do this once per team. You need the **Admin** or **Account Holder** role in the Apple Developer team 7KQULK6DSS, and
Xcode installed (only for its account settings; the app itself is not built with Xcode).

### 1.1 Register the bundle ID

[developer.apple.com → Identifiers](https://developer.apple.com/account/resources/identifiers/list) → **+** → App IDs →
App → Continue:

| Field | Value |
|---|---|
| Platform | macOS |
| Description | `WorkSuite Desktop` (letters, numbers and spaces only) |
| Bundle ID | Explicit — `lk.worksuite.desktop` |
| Capabilities | none needed |

### 1.2 Create the two certificates

Easiest in Xcode: **Xcode → Settings → Accounts** → add the Apple ID → select **Livezen Technologies LLC** →
**Manage Certificates…** → **+** → create both:

- **Apple Distribution** — signs the app.
- **Mac Installer Distribution** — signs the `.pkg`. In the Keychain it appears as *3rd Party Mac Developer Installer*.

Check in Terminal:

```bash
security find-identity -v | grep 7KQULK6DSS
```

You must see both lines:

```
"Apple Distribution: Livezen Technologies LLC (7KQULK6DSS)"
"3rd Party Mac Developer Installer: Livezen Technologies LLC (7KQULK6DSS)"
```

If you create a certificate on the website instead, it asks for a **Certificate Signing Request (CSR)**: Keychain Access →
Certificate Assistant → *Request a Certificate From a Certificate Authority…* → enter your email, choose *Saved to disk*,
upload that file, then double-click the downloaded `.cer`. Do this on the Mac that will build — the private key is
created there.

**Back up the certificates.** The private keys exist only on the Mac that created them. In Keychain Access → login →
My Certificates, select both → right-click → **Export 2 items…** → a password-protected `.p12`. Keep it in the company
password vault, never in git. Double-click it on another Mac to build there.

### 1.3 Create the provisioning profile

[developer.apple.com → Profiles](https://developer.apple.com/account/resources/profiles/list) → **+** → Distribution →
**Mac App Store Connect** → App ID `lk.worksuite.desktop` → pick the Apple Distribution certificate from 1.2 → name it
`WorkSuite Mac App Store` → Generate → Download.

Copy it into the project under this exact name:

```bash
cp ~/Downloads/WorkSuite_Mac_App_Store.provisionprofile build/embedded.provisionprofile
```

`*.provisionprofile` is git-ignored — never commit it. To use a profile stored elsewhere, set
`WS_MAS_PROVISIONING_PROFILE=/path/to/file` when building.

If you re-create a certificate, re-create the profile too: a profile is tied to one certificate.

### 1.4 Create the app in App Store Connect

**Required before the first upload.** Without it Transporter fails with *"No suitable application records were found.
Verify your bundle identifier 'lk.worksuite.desktop' is correct…"*.

[appstoreconnect.apple.com → Apps](https://appstoreconnect.apple.com/apps) → check the team switcher says Livezen
Technologies LLC → **+** → **New App**:

| Field | Value |
|---|---|
| Platforms | macOS only |
| Name | `WorkSuite Desktop` |
| Primary language | English (U.S.) |
| Bundle ID | `lk.worksuite.desktop` (if missing from the list, wait 10 minutes after 1.1 and reload) |
| SKU | `worksuite-desktop-mac` |
| User access | Full Access |

## 2. Build the `.pkg` (every release)

```bash
cd worksuite-desktop          # the repository root
npm install
CSC_NAME="Livezen Technologies LLC (7KQULK6DSS)" WS_MAS_BUILD_NUMBER=1 npm run dist:mas
```

- **`CSC_NAME`** makes the build pick the Livezen certificates when the Keychain also holds others (personal or other
  companies').
- **`WS_MAS_BUILD_NUMBER`** is the build number. Use a higher number for every upload of the same version: 1, then 2,
  then 3. When `version` in `package.json` goes up, you may start again at 1.
- The version shown to testers (`CFBundleShortVersionString`) is `version` in `package.json`.

What happens, in order (watch the log): the web code is compiled (`npm run build`), the app is packaged for Intel,
then for Apple Silicon, the two are merged into one universal app, every file is signed, and finally the `.pkg` is
written. Signing is the slow part — every file inside the app is signed and timestamped by Apple's server.

Expected and harmless:

- A warning from `build/mac-signing.cjs` that the app is *not signed with a Developer ID Application certificate* —
  that check is for direct-download builds only.
- A long *duplicate dependency references* line.

If macOS shows *"codesign wants to access key … in your keychain"*, enter the Mac login password and click
**Always Allow**; otherwise the build waits forever.

### Disk space

The build needs about **15 GB free on the startup disk**: Electron and the temporary files are written to the system's
temp folder even when the project is on an external drive. If the startup disk is nearly full, point the temp folder
at a bigger drive:

```bash
mkdir -p "/Volumes/<drive>/.build-tmp"
TMPDIR="/Volumes/<drive>/.build-tmp/" CSC_NAME="…" WS_MAS_BUILD_NUMBER=1 npm run dist:mas
```

### Check the result before uploading

```bash
cd release/*/mas-universal
pkgutil --check-signature *.pkg                    # 3rd Party Mac Developer Installer: Livezen … (7KQULK6DSS)
codesign --verify --deep --strict WorkSuite.app && echo OK
codesign -d --entitlements - WorkSuite.app | grep app-sandbox
lipo -archs WorkSuite.app/Contents/MacOS/WorkSuite # x86_64 arm64
```

`pkgutil` describes the installer certificate as *"(Development)"*. That is how macOS labels this certificate type;
App Store Connect accepts it.

## 3. Upload

**Transporter (recommended).** Install [Transporter](https://apps.apple.com/app/transporter/id1450874784) from the Mac
App Store → sign in with an Apple ID in team 7KQULK6DSS → check the team at the top says Livezen Technologies LLC →
drag in the `.pkg` → **Deliver**. Wait for *Delivered*.

If an upload fails, right-click it in Transporter → Remove, fix the cause, and drag the same `.pkg` in again. A failed
upload does not use up the build number; a delivered one does.

**Command line (for automation).** Create an app-specific password at [account.apple.com](https://account.apple.com) →
Sign-In and Security, then:

```bash
PKG=$(ls release/*/mas-universal/*.pkg)
xcrun altool --validate-app -f "$PKG" -t macos -u <apple-id> -p <app-specific-password>
xcrun altool --upload-app   -f "$PKG" -t macos -u <apple-id> -p <app-specific-password>
```

## 4. TestFlight

1. Open App Store Connect → **WorkSuite Desktop** → **TestFlight**. The build is **not** there right after upload:
   Apple processes it first, usually 10–30 minutes, sometimes an hour for the first build. It then appears as version
   `<version>`, build `<number>`. Apple emails the uploading Apple ID when it is ready, or if it was rejected (subject
   starts with *ITMS-*).
2. Answer **Export Compliance** when asked. The app uses only standard HTTPS/TLS, so the usual answer is *"None of the
   algorithms mentioned above"* — confirm with the team lead.
3. **Internal testers** (people in the App Store Connect team, up to 100): TestFlight → Internal Testing → **+** → add
   them. No review needed.
   **External testers** (anyone, by email): create a group under External Testing and add emails. The first build of
   each version goes through a short Beta App Review (usually under a day).
4. Testers install **TestFlight** from the Mac App Store, accept the invite email, and install WorkSuite from there.
   TestFlight installs updates; the app's own updater does not run.

## Known limits of the sandboxed build

The App Sandbox blocks some things the direct-download build can do. Test these in TestFlight; they need fixing or
hiding in the App Store build before a public release.

| Feature | In the sandbox |
|---|---|
| Remote control (`osascript` / Accessibility) | Blocked — Apple Events to System Events are not allowed |
| Local AI (`node-llama-cpp` native binaries) | May fail to load; untested |
| In-app updater | Must not run — TestFlight / the App Store update the app |
| Default `mailto:` handler, opening `.eml`/`.msg` | Only for files macOS hands to the app |
| Files outside Downloads | Only through the open/save dialog |
| `worksuite://` links, mail, chat, calls, files | Work |

What the sandboxed app may do is set in two files:

- `build/entitlements.mas.plist` — the main app: network, camera, microphone, printing, files the person picks,
  Downloads, and the app group Electron's processes need.
- `build/entitlements.mas.inherit.plist` — every helper process and native binary inside the app; they inherit the
  main app's sandbox.

Adding a permission means adding a key there; Apple may ask why during review.

## Troubleshooting

| Message | Cause and fix |
|---|---|
| Transporter: *No suitable application records were found* | The app does not exist in App Store Connect yet, or exists in another team. Do step 1.4. |
| *Cannot find valid "3rd Party Mac Developer Installer" identity* | Mac Installer Distribution certificate missing (step 1.2). |
| *provisioning profile … doesn't match* / `ITMS-90283` | Profile is for a different bundle ID or certificate. Re-create it (step 1.3). |
| Build ends with no `.pkg` | Look in `release/<version>/mas-universal/`, not `release/<version>/`. If it is not there, read the end of the build log. |
| Build stops or fails part-way, *ENOSPC* | Startup disk full. See [Disk space](#disk-space). |
| Build sits on *signing* for a very long time | A Keychain prompt is waiting behind other windows. Allow it. |
| `ITMS-90296: App sandbox not enabled` | A helper or native binary lacks the inherit entitlements; check `build/entitlements.mas.inherit.plist`. |
| *The bundle version must be higher than the previously uploaded version* | Raise `WS_MAS_BUILD_NUMBER`. |
| `ITMS-90237` / non-public API | Comes from a native module; the email names the binary. |
| Build delivered but not in TestFlight after an hour | Processing failed. Check the uploading Apple ID's email for an *ITMS-* message. |

## Where the configuration lives

| File | What it does |
|---|---|
| `package.json` → `dist:mas` | The build command: `electron-builder --mac mas --universal`. |
| `build/electron-builder.config.cjs` → `mas` | App Store build settings: entitlements, provisioning profile, no hardened runtime, no notarization, build number from `WS_MAS_BUILD_NUMBER`. The bundle ID and product name are shared with the other builds (top of the file); the Info.plist keys come from the `mac` section. |
| `build/entitlements.mas.plist`, `build/entitlements.mas.inherit.plist` | Sandbox permissions (see above). |
| `build/embedded.provisionprofile` | Your local copy of the profile. Not in git. |
| `.gitignore` | Ignores `*.provisionprofile`. |
