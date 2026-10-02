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
