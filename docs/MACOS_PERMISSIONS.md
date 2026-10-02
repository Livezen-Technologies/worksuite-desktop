# macOS screen sharing and remote control (#132)

Screen Recording / Screen & System Audio Recording controls capture. Accessibility controls input. Sharing must work with remote control unavailable, and a permission check must never inject input or approve a participant's request.

## Findings and changes

The picker already queried screens and windows independently, but the display-media handler queried both types together. A failure listing windows could therefore prevent capture of a screen that the picker had successfully listed. Capture now discovers only the selected kind, revalidates the source before requesting media, bounds discovery to ten seconds, and rechecks trust/selection generation before granting it. A disappeared source, discovery failure, permission denial and media startup/publication failure have distinct messages.

The Accessibility probe previously collapsed the helper's event-posting preflight result into a single Accessibility answer. It now records AXIsProcessTrusted and CGPreflightPostEventAccess separately, using the same osascript binary and launch context as the injector. Helper Accessibility enabled with event posting denied is a contradictory check, reported as Unable to Verify. It is not evidence that input works, and control remains unavailable. App/helper disagreement, native check errors and running executable identity are visible under Settings → Remote control.

Permission probes are invalidated when settings are opened, app windows regain focus and the computer resumes. A superseded probe cannot restore stale permission. Check Again starts a fresh verification. Screen Recording has its own Granted/Denied/Checking/Unable to Verify status, and an unknown check does not block discovered sources. Restart advice follows an observed denied-to-granted transition with unavailable capture, rather than every discovery failure.

Diagnostics include redacted running executable/bundle paths, signing identifier/team/hash, actual `codesign --verify --strict` outcome, duplicate /Applications copy detection, app translocation, helper check evidence and Screen Recording status. They contain no captures or input. The native macOS causes of an individual installation's failure cannot be confirmed from Linux unit tests.

## Automated validation

Run `npm run check` and `npm run build`. Focused tests cover native-check disagreement/invalidation, independent source discovery, capture grant/trust, picker refresh, startup error classification and existing explicit-control consent gates.

## Installed-build acceptance (requires macOS and another participant)

Record macOS version, WorkSuite version, the running app path and Diagnostics permission/signature fields. Use the installed signed application, not a terminal-launched development Electron process, because macOS permission responsibility can differ.

1. Disable Accessibility while leaving Screen Recording enabled. Check Again must show the actual app/helper results. Share a screen and a window; the other participant must see the chosen content and subsequent changes. No remote input may occur.
2. Change Screen Recording independently. Return from System Settings and use Check Again. Confirm Denied is separate from unavailable verification or discovery errors. Use the Screen Recording / Screen & System Audio Recording settings link, not Accessibility. If permission changed during this process and capture remains unavailable, restart and repeat.
3. Enable Accessibility, return, and check app Accessibility, helper Accessibility and helper event-posting separately. If checks disagree, record diagnostics and the running copy/path; do not blindly reset TCC. Compare duplicate installations and signature identities before changing any permission entries.
4. Have the other participant request control. Verify there is no helper input before local approval, reject one request, then explicitly approve a new request. Verify mouse/keyboard input on the selected content, and Stop/emergency-stop/revocation behavior.
5. Repeat after an app update, launching a different installed copy/path, quitting/restarting and sleep/wake. During source discovery close the chosen window, and repeat a switch while an old request is pending. No retired request may capture a replacement source.
6. Record each actual outcome, errors, restart requirements and whether the other participant received frames. The OS input harness `node tests/os/remote-control/check.mjs` is supplementary; a shell-launched helper alone does not validate installed-app TCC responsibility or network delivery.

Keep #132 open until this installed-build matrix and remote-participant delivery are verified. Cloud checks validate the implementation, not installed macOS permission behavior.

# Accessibility still Denied after it is granted (#147)

## Root causes found in the code

1. **Release builds could ship ad-hoc signed.** CI built macOS packages "unsigned" whenever `MAC_CSC_LINK` was absent, including tagged releases, and nothing checked the result. An ad-hoc (or Electron's linker-signed) build's designated requirement is the hash of that exact binary. macOS stores Accessibility against that requirement, so after an update (or with a second copy) System Settings still shows WorkSuite switched on, but the entry no longer matches the running binary, and AXIsProcessTrusted in the app, AXIsProcessTrusted in the helper and CGPreflightPostEventAccess all return false. No in-app check can change that; only a stable Developer ID signature (or removing and re-adding the entry) does.
2. **"Granted, restart needed" was reported as Unable to verify or Denied.** When the app's own check said yes and the helper's event-posting preflight still said no (macOS often applies a grant to event posting only for a new process), the state was a "contradiction" (`unknown`) or `denied` with prose saying "quit and reopen". There was no Restart action, so the banner kept saying the computer could not be controlled.
3. **Re-checks were not pushed or polled.** Main re-checked on window focus but did not tell the renderer; the Settings screen only re-read every 5 s, and a background re-check showed "Checking…" over the last answer. There was no re-check when WorkSuite became the active app (`did-become-active`).
4. **The running copy's identity was only in exported diagnostics.** Bundle ID, Team ID, signing identity, translocation and another installed copy were not shown where the person sees Denied.

The helper was not a cause: it is Apple's `/usr/bin/osascript`, started as a direct child of the main process (no shell, `open`, launchd or `detached`), so macOS counts WorkSuite as its responsible process and WorkSuite's own Accessibility entry covers it. It is not listed separately and needs no signing of its own. A development Electron started from Terminal is the exception: there Terminal (or Electron) is responsible, which the on-screen identity warnings say.

## Changes

- **Check again** calls AXIsProcessTrusted (`isTrustedAccessibilityClient(false)`) again in the main process and asks the helper again: the running input helper over its stdin/stdout pipe (`?n perm`, which re-runs AXIsProcessTrusted and CGPreflightPostEventAccess inside it), or, when none is running, a new helper process. No answer is reused.
- **Automatic re-checks**: when WorkSuite becomes active or a window takes focus (main process, result broadcast as `rc:changed`), when the Settings window regains focus or visibility, and every 2 s while the banner asks for access and the window is visible. Polling stops once access is granted or the screen closes; the last answer stays on screen during a periodic check.
- **Restart WorkSuite**: when the app is trusted but the helper's event posting is not, the banner says "Access granted — restart WorkSuite to finish" with a Restart WorkSuite button (`rc:restart`: control and sharing stop, which ends the input helper; check helpers are killed; `app.relaunch()` + `app.exit()`). If the same mismatch remains after that restart, the banner says the helper is not covered and lists steps (open from Applications in Finder, remove and re-add the entry, restart) instead of offering endless restarts.
- **Diagnostics on screen**: running copy path, bundle ID, Team ID and signing identity (a personal development certificate's name is withheld), helper path, which helper answered, plus warnings for ad-hoc signing, translocation, another copy in /Applications and development builds. An expandable "Still shows Denied…?" section explains removing and re-adding the entry and `tccutil reset Accessibility lk.worksuite.desktop`. Exported diagnostics add the helper's own signature and launch method.
- **Release signing**: `build/mac-signing.cjs` refuses to start a macOS release (a `v*` tag, or `WS_RELEASE_BUILD=1`) without `CSC_LINK`/`CSC_NAME`, and after signing reads the app back with `codesign -dv`: a release must carry a "Developer ID Application" authority, a Team ID (equal to `APPLE_TEAM_ID` when set), the hardened runtime and identifier `lk.worksuite.desktop`. Non-release builds print a loud warning instead. `CSC_NAME` selects the identity when several are in the keychain.

Release CI secrets for macOS: `MAC_CSC_LINK` + `MAC_CSC_KEY_PASSWORD` (Developer ID Application .p12), optionally `MAC_CSC_NAME`; `APPLE_TEAM_ID`; notarization through `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` (or Apple ID + app-specific password + `APPLE_TEAM_ID`).

## Manual checklist (installed, signed build on a Mac)

Record for each row: macOS version, WorkSuite version, running copy path, bundle ID, Team ID and signing identity from Settings → Remote control → Running app and input-helper checks, and the banner text before and after.

| # | Scenario | Steps | Expected |
| - | -------- | ----- | -------- |
| 1 | Fresh install | Install the DMG/pkg to /Applications, open from Finder, open Settings → Remote control. Click Open Accessibility settings, turn WorkSuite on, return to WorkSuite without clicking anything. | Within 2 s (or on returning) the banner reads "This computer can be controlled when you allow it" or "Access granted — restart WorkSuite to finish". Never Denied with WorkSuite switched on. Team ID shows the release team; no identity warnings. |
| 2 | Restart needed | If row 1 shows the restart banner, click Restart WorkSuite. | WorkSuite quits and reopens (any running input helper ends with it); the banner shows Accessibility access enabled; "Let people ask to control my screen" can be turned on. |
| 3 | Check again | With Settings open, turn WorkSuite off in System Settings, then on again; click Check again after each. | Each click shows the new state at once (Permission required, then granted or restart). |
| 4 | Update | Grant access, then install the next signed version over it (updater or a new DMG). | After the update the banner shows granted without touching System Settings. With an ad-hoc build, the ad-hoc warning shows and the entry must be removed and re-added — record this. |
| 5 | Moved to /Applications | Open WorkSuite from ~/Downloads (unmoved, quarantined). | Diagnostics show the translocated path and the warning to move it to Applications. Move it, open it from /Applications, grant again: granted. |
| 6 | Two copies | Keep a second WorkSuite.app elsewhere, open it. | The "Another copy of WorkSuite is in Applications" warning shows; the running path differs from /Applications. |
| 7 | Removed and re-granted | Quit; in System Settings remove WorkSuite (−); open WorkSuite; grant via + and /Applications/WorkSuite.app. Then `tccutil reset Accessibility lk.worksuite.desktop` and grant again. | Each time the banner updates within 2 s or after one Restart WorkSuite. |
| 8 | Helper not covered | Start the installed app's binary from Terminal (`/Applications/WorkSuite.app/Contents/MacOS/WorkSuite`) with only WorkSuite allowed. | App Accessibility may read Granted while helper event posting reads Denied; after Restart WorkSuite (which relaunches through the app) it is granted, or the helper steps are shown. |
| 9 | Live control | Grant, have another participant request control and approve. During control use Check again. | Details show the answer came from the running helper; input works; Stop and the emergency stop still end control. |
| 10 | Release CI | Push a `v*` tag without `MAC_CSC_LINK`. | The macOS package job fails with "Refusing to build a macOS release". With the certificate, `codesign -dv --verbose=4 /Applications/WorkSuite.app` shows "Developer ID Application", the Team ID and `flags=…(runtime)`. |

Only a Mac can confirm: macOS's actual TCC matching against the signed build, whether CGPreflightPostEventAccess needs the relaunch, that `app.relaunch()` produces a process macOS attributes to WorkSuite (not to the old process), Gatekeeper translocation paths, and notarization.
