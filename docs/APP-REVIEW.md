# Mac App Store review

What Apple's reviewers check that this app has to answer for, where each answer lives in the code, and what is
deliberately not offered in the App Store build. Written to be read beside [TESTFLIGHT.md](TESTFLIGHT.md), which is
how the build is made. [ENH-AUTH-01 §5]

## Sign-in

| Guideline | How the app answers |
|---|---|
| 4.8 Sign in with Apple | Required only where the app offers another third-party sign-in. WorkSuite Cloud's federation (Google, Microsoft, Apple) **answers 501 today**, so the app offers none of the three, and 4.8 does not apply to this build. The day federation lands, Apple's option has to land with it — `api/src/desktop/startup.ts` `supportedMethods()` is the one place that decides. |
| 5.1.1(ii) Sign-in is only required where it is needed | *Use WorkSuite without an account* opens the app in guest mode, and *Join a meeting* works signed out. Both are switches an administrator can turn off (Desktop Management), not something the App Store build hides. |
| 2.3.1 No hidden or nonfunctional features | A sign-in method the server cannot perform is never drawn. The startup screen takes its methods from the published configuration **intersected with what the server can actually do**, so a reviewer cannot reach a button that leads nowhere. |
| 4.0 Browser sign-in | Sign-in opens in the system browser (RFC 8252), with PKCE, and the app never sees the password. The sandbox needs `com.apple.security.network.server` for the one-shot loopback listener that receives the redirect — that is the entitlement's whole purpose. |
| 5.1.1(v) Account deletion | *My account → Storage → Delete this account* begins it inside the app (`src/modules/account/DeleteAccount.tsx`, `POST /api/v1/account/deletion`). The server schedules the deletion, emails the confirmation and keeps a grace period; what is kept afterwards (invoices already issued) is listed on the screen. Deleting ends every sign-in, so the app signs out. |

### Creating an account

With `signup.mode = in_app` the account is created in the app (`electron/services/cloud/in-app-signup.ts`); with
`browser` it opens the sign-up page instead; with `off` the card is not shown. The password is typed only to create
the account and is never exchanged for a session: the session comes from an authorization code bound to a PKCE
challenge the main process made. Nothing of it is written to disk.

## Privacy

What to declare in App Store Connect's **App Privacy**, and why each one is there.

| Data | Linked to the person | Why | Where |
|---|---|---|---|
| Name, email address | Yes | The account itself | Sign-in / sign-up |
| Photos (profile picture) | Yes | A picture the person chooses | My account → Profile pictures |
| Contacts, calendars, mail, files, chats | Yes | The workspace's own content, stored in the account | Every module |
| Coarse diagnostics (crash and error logs) | No | Fixing faults | Settings → Diagnostics, off by default |
| Camera, microphone | Yes, while in use | Calls and meetings | Meet |

Nothing is used for tracking across other companies' apps or websites, nothing is sold, and there is no advertising
identifier: the **Tracking** section of App Privacy is answered *No*.

The usage strings macOS shows are in `build/entitlements.mas.plist`'s camera and microphone entitlements and the
app's `Info.plist` (`NSCameraUsageDescription`, `NSMicrophoneUsageDescription`). Keep them specific — "WorkSuite uses
the camera for meetings you join" — because a vague string is a common rejection.

## Payments

The App Store build sells nothing and shows no prices. *Upgrade* and *Plan & billing* open the account portal in the
browser, which is where a plan is bought. Guideline 3.1.3(b) covers this ("multiplatform services" may let an account
bought elsewhere be used in the app); the build must not gain a purchase button without In-App Purchase being added
with it.

## Updates and code

`process.mas` turns the in-app updater off (`electron/main/wiring/lifecycle.ts`), so the App Store build never
downloads or runs code of its own — the App Store updates it. Settings → Updates says so rather than offering a
button that does nothing. The direct-download builds are unchanged.

## Before each submission

- [ ] The startup screen offers only methods the server can perform — check `/.well-known/worksuite` `startup.methods` against `supportedMethods()`.
- [ ] *Delete this account* is reachable, and its refusals (sole owner of an organization with members, or a paid plan still running) read clearly.
- [ ] Guest mode and *Join a meeting* work signed out, if they are switched on for the build the reviewer gets.
- [ ] App Privacy answers match the table above.
- [ ] A test account is given in App Store Connect's review notes, already verified, with a workspace that has content in it.
- [ ] No price, purchase button or external payment link is reachable in the app.
- [ ] `npm run dist:mas` was built from the same commit as the release, and the sandbox limits in TESTFLIGHT.md still hold.
