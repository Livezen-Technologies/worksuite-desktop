# Browser guest meetings (#140)

Deploy the companion WorkSuite server PR (Communication 1.10.0), run `php spark migrate --all`, and publish its rebuilt web assets before releasing Desktop 0.2.84 (Meet 1.10.0). The public URL remains `/meet/{uuid}`.

Guests choose Join in Browser, supply their name and any meeting passcode, and check devices with camera/microphone off initially. Device checks ask permission only when enabled. Speaker test uses the system output device. Guests can join with both devices off. Open Desktop App and Download App remain optional.

Guest admission and media permissions remain enforced by the existing server/LiveKit rules. Guests wait without capturing media until admitted; admitted participants with no publishing rights can still watch. Browser meeting chat is separate from workspace conversations and uses a meeting-scoped guest token, checked against live admission on every request. The server enforces guest access and chat policy, returns only name/guest/text/id fields, and shows the latest 100 meeting messages. Messages are stored against the meeting and cascade-delete with it. Workspace files, conversations and support records are unavailable to browser guests.

Desktop hosts use Browser meeting chat to exchange messages with browser participants. Desktop guest chat remains available for existing desktop guest clients. Workspace conversation remains a separate members-only section. These are distinct conversations; desktop guest messages do not automatically appear in browser meeting chat.

## Real-browser acceptance checks

Automated component tests and rollback-only server probes cover entry/errors/token scope/host policy; they do not establish actual device or network behavior. Before release, test with a desktop host and an incognito browser guest against a configured LiveKit server:

- Chrome, Edge, Firefox, Safari, iOS Safari and Android Chrome: open a meeting link without an account or app. Confirm the browser entry is primary and no avatar/AI onboarding appears.
- No permission prompt on landing or initially in device checks. Enable devices deliberately; check preview/microphone input and speaker tone. Deny permissions, then join with both off. Leave/rejoin and confirm permissions remain under user control.
- Test passcodes, guests disabled, locked/ended/invalid meetings, host absent, waiting-room admission/denial/removal. Media and chat must stay unavailable while waiting or after removal. Turn all guest publishing off and confirm an admitted guest can still watch.
- Verify two-way audio/video, browser/desktop host chat and guest labels. Toggle chat everyone/hosts/off while connected. Workspace conversation/file/support data must remain inaccessible to guests.
- Where supported and allowed, share a screen; mobile/unsupported browsers show guidance. Host media policy disables prohibited camera/mic/share controls.
- At a narrow mobile width, verify entry, controls and drawers remain usable. Drop and restore the network: automatic reconnection remains on the meeting page; terminal disconnection provides retry without mandatory sign-in. Rejoining still respects host policy.
- Test Open Desktop App with an installed app and Download App without one. Desktop links use the existing `worksuite://meet/{uuid}` grammar.
