# meet — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.27.3 — 2026-10-27

**Changed**

- the parts this module shares with others now come from src/components (the page, list, record, form, card, call, console and report kits), and a lint rule keeps modules from importing each other (audit D-G08). Nothing a person sees changes.

## 1.27.2 — 2026-10-27

**Changed**

- colours from the design tokens, light and dark — the hard-coded hex colours are tokens now (D-G23)
- its settings screen uses the shared Settings kit (src/components/SettingsKit.tsx): the same headers, cards and rows as Settings (D-G09)

## 1.27.1 — 2026-10-25

**Fixed**

- push to talk read the shortcuts from outside the room, so the desktop did not build

## 1.27.0 — 2026-10-23

**Added**

- Push to talk (D06): hold the space bar to be heard and let go to go back to muted — the eleventh key on that artboard, and the only one you hold rather than press. It is listed in Settings › Keyboard shortcuts and can be changed there like the rest, but nothing registers a command behind it: the shell calls `preventDefault()` for any accelerator with a command attached, so a bare Space in the registry would have swallowed every space bar press in every WorkSuite window. The call answers the key itself.
- The key only ever unmutes. Pressed while the microphone is already live it does nothing at all, so letting go can never mute somebody in the middle of a sentence they had chosen to say out loud. It asks the meeting's own `mayMic` — the same answer the mute button reads — so it cannot open a microphone the host has closed, and it leaves the key alone wherever a space would be typed instead.
- Losing the key counts as letting go: the window losing focus, the document being hidden, or the meeting window closing mid-hold all close the microphone. A key held while you switch apps never delivers its `keyup`, and the failure mode of missing one is a live microphone in a meeting its owner has walked away from.

## 1.26.0 — 2026-10-21

**Added**

- Settings › Speech lists the WorkSuite server's whisper speech models to download, SHA-256 checked, and the company's local-speech setting (G-11)

## 1.25.0 — 2026-10-11

- Host controls only for the people who may use them (worksuite-desktop#348): one permission table, the server's, builds the People tab, each person's menu, the waiting room and More — a guest or a staff participant sees no Mute all, Remove, Admit or Lock, not even greyed out, and a person's menu offers them Pin for me; only the host sees End for everyone and Make co-host

**Added**

- Mute all, Turn off camera, Stop their screen share, Ask to unmute or turn on camera, Spotlight for everyone and Pin for me; controls appear and go the moment a co-host role arrives on the connection or meeting.role_changed is heard; when the host's connection goes and does not come back, the room asks the server to pass the host role on (to a co-host, else whoever signed in has been here longest, never a guest)

## 1.24.0 — 2026-10-11

- Invitations in the People panel follow what actually happened (worksuite-desktop#347): Ringing with its time, Didn't answer, Declined with their reason, Invite cancelled, Joining… only after Accept, Couldn't join, Busy in another call and Offline, each with Cancel, Ring again, Remove, Copy link or Message; the ring screen sends Accept, Decline with a message and Not now to the server; the host's badge comes from the meeting's host id

## 1.23.0 — 2026-10-11

- The meeting's side panel is four tabs — Chat, People, Q&A and More — with Polls, Board, Notes and Files behind More as cards that each say what the tool is for. Nothing is removed; a support session keeps the three RC-SUP-03 leaves it.
- One chat composer with a picker that says who will read the message: Everyone (the meeting's own chat, which guests see) or Staff only (the workspace conversation, which they cannot). It replaces three stacked composers, none of which said where a message would go.
- A message typed while the chat connection is down is kept and retried, and says 'Waiting to send', instead of being lost to an error.

## 1.22.0 — 2026-10-11

- Your personal room on Meet home (D01): one address you give out once — the link, Start, Copy link, and renaming with what it costs said first (the old link stops working, and the name you give up becomes free).
- Rejoin the meeting you were last in, when it is still open and from the last day (D07).
- Meet home says whether the camera and microphone are ready without switching either on: the permission the system granted and the devices chosen last time (D07).

## 1.21.0 — 2026-10-11

- A support session has its own tab in the meeting window: who is being helped, the ticket, the computer, what control was allowed and by whom, the files, and End session with an outcome (RC10).
- A support code an agent can read out — nine digits, once, ten minutes — with a live countdown, Copy code, Copy invite link and a pasteable invitation; the link opens the web join page, so it works for somebody without WorkSuite installed (RC11).
- Meet home's code box accepts a support code too: the meeting is looked up first and the support code redeemed only when there is no such meeting, because redeeming spends it.
- AI assist inside the session tab: Summarise so far, Draft checklist and Draft ticket note, each marked a draft and kept nowhere until Copy to chat or Add to ticket notes, with the server's own sentence about what assist reads (RC17).
- A support session reduces the room to Chat, Files and Session, as the server's RC-SUP-03 says.

## 1.20.0 — 2026-10-11

- Settings › Remote control shows its checks — what can be captured, the displays and which the picker offers, whether input can reach this computer, and the clipboard policy — with Run checks again; the same rows go into the support report.
- The two things the organisation decides are named: how long a controller's input waits after you move your own mouse, and what may be put on your clipboard.
- Settings lists the apps nobody can control — password managers and the system's own prompts — read from the list the service itself matches against.

## 1.19.0 — 2026-10-11

- Share your screen on Meet home: makes a meeting and opens its pre-join screen with the share waiting, camera off — the ⌘⇧E key now does this instead of only opening the page.
- Meet home prints the keys for new meeting, join next and share screen, read from the person's own shortcuts and left out when the global keys are turned off.
- An amber line on Meet home when the system has refused screen recording or accessibility, with Fix in Settings — a denial only, never a permission this computer does not have.

## 1.18.0 — 2026-10-10

- When a control session ends, the controller gets a card saying who ended it, that the screen is still shared, and how long the session lasted — instead of a toast that is gone before it is read.

## 1.17.0 — 2026-10-10

- The call bar says it is encrypted in transit and names the mute and camera keys, and warns when this run is not using the GPU.
- After the emergency stop, the notice says nobody can use your mouse or keyboard and — while a share is still live — that your screen is still visible, with where to stop it.

## 1.16.0 — 2026-10-10

- The pre-join offers Join muted, Audio only and Present beside Join now; each overrides this screen's switches for one join, and what is remembered stays as it was. Present opens the share picker on arrival, if the host allows presenting.
- A device check on the pre-join: what the camera is really sending, what the microphone was actually opened with, and whether a share of this screen could be controlled. Remembering the chosen devices can now be turned off, and turning it off forgets what was kept.

## 1.15.0 — 2026-10-10

- The sharing bar: a strip at the top of the screen you are sharing, with what is being shared, how long for, mute, the camera, the chat, Pause and Stop sharing. The call window is behind whatever you are showing, so stopping a share used to mean finding it again.
- The bar is its own window, content-protected so it never appears inside the capture, and it sits on the display being shared rather than the main one. It keeps no state: the meeting reports, and every button goes back the same way.

## 1.14.0 — 2026-10-10

- What the camera sends on battery follows Settings › Meet › Behaviour: Auto, 720p or 360p. Read as the room is built, since a capture resolution is set at join.

## 1.13.0 — 2026-10-10

- Meet in the tray: Join next with the meeting's name, Start instant meeting, Share screen, and — only while this computer is in a meeting — mute and the camera. Each line shows its key, and the main process reads the next meeting itself so the tray is right with every window closed.
- Audio only on an invitation to a meeting: joins with your microphone as you last had it and the camera off, where Accept leaves both off.

## 1.12.0 — 2026-10-10

- Meet's keyboard shortcuts: mute, camera, join the next meeting, share a screen, start a meeting, raise a hand, float the call, and the two notes keys. The first five are held for the whole computer so they work with WorkSuite behind whatever you are presenting.
- Four of the design's eleven keys were already WorkSuite's own, so they keep the design's letter and take the free modifier instead: the shortcuts page shows every clash rather than one key quietly losing.

## 1.11.1 — 2026-10-05

- Connection warning in the call bar (#254)

## 1.11.0 — 2026-10-05

- Recordings: Screen Recording check, live-track check, WebM first, 1 s pieces, 5 s empty check, frame check before upload, one card per recording (#240)

## 1.10.3 — 2026-10-03

**Fixed**

- In a meeting, a presenter sees what they share on the stage, with Stop presenting, and their camera in a separate tile (#146); the call workspace and the outline are calls 1.5.3

## 1.10.2 — 2026-10-03

- In guest mode Meet offers joining by link or code with the Local Profile's name; starting a meeting needs an account (#149).

## 1.10.1 — 2026-10-03

- A guest meeting opened from a Local Profile fills in the profile's name; the guest window now reads the meeting's current state (ended, locked) from the server instead of what it was when the link was first opened (#141).

## 1.10.0 — 2026-10-02

- Add meeting-scoped browser guest chat for desktop hosts (#140); requires Communication 1.10.0 on the server.

## 1.9.0 — 2026-10-02

- The meeting More menu is grouped into Meeting Tools (Recording, Transcription, Activities, Meeting Info), Host Controls (Host controls, Livestreaming, Lock/Unlock Meeting, Recording Settings) and View & Layout (#124); labels follow state (Stop Recording, Stop Transcription, Unlock Meeting, Exit Full Screen); actions you may not use stay visible, disabled, with the reason.

## 1.8.1 — 2026-10-02

- Refresh Accessibility asynchronously when opening the share picker without holding up screen sharing (#132).

## 1.8.0 — 2026-10-02

- Add Share Document in the meeting toolbar and Files panel, with Drive selection and device uploads. Open shared Office documents and PDFs in WorkSuite windows while the meeting remains connected, and select the document window for presentation (#109).
- List shared Drive documents using the server's current per-reader access decisions. Explain attachment-copy editing and external editing limitations. Meeting-only grants, guest document access and document navigation synchronization remain outstanding.

## 1.7.2 — 2026-10-02

- Route missing interface translations through the shared catalog and missing-string tracker (#60).

## 1.7.1 — 2026-10-02

- Handle missing recording lists safely during Drive polling and use the shared accessible checkbox in livestream destination selection (merge verification for #89/#93).

## 1.7.0 — 2026-10-02

**Added**

- Saved livestream destinations, optional YouTube account connection, per-destination media previews and host/co-host broadcast controls.

**Fixed**

- Livestreaming stays independent of recording and notifies current and newly joining participants.

## 1.6.1 — 2026-10-02

**Fixed**

- Share recording transfer controls and verified playback status across Meet, meeting details and Drive (#89).

## 1.6.0 — 2026-10-02

**Added**

- Confirmed recording startup and stop feedback, participant notices and retry actions (#87).

## 1.5.0 — 2026-10-02

**Added**

- Isolated guest joining and meeting-specific Drive recordings with transcript/minutes snapshots (#85, #88).

## 1.4.0 — 2026-10-01

**Added**

- Q&A, Polls and Raise hand in the meeting (worksuite-desktop#92). Participants ask and upvote questions; hosts and co-hosts answer, mark answered and hide them. Hosts create single- or multiple-choice polls, launch them, close voting and share the results, and each person votes once while everyone sees how many have voted. Before you send, each question and poll says whether your name will be shown. Raised hands show on tiles and in People, in the order they went up. Hosts are told when a hand goes up and can lower one or all, and raising a hand never turns the microphone on. Host Controls switch each one on or off, and the state is kept across devices and reconnects. Labels are in English, Sinhala and Tamil.
- **New meeting menu** (worksuite-desktop#90): each choice is an icon beside its title, with a short description underneath (Start now, Create link for later, Schedule in Calendar).
  - One option is highlighted at a time, following the pointer or the arrow keys.
  - The shadow is lighter.
  - The menu opens above the button when there is no room below.
  - Choosing twice before the menu closes starts only one meeting.
  - Labels are in English, Sinhala and Tamil.
- **Host Controls** (worksuite-desktop#91): a toolbar button, for the host and co-hosts only, opens a drawer with four groups.
  - **Participant permissions:** screen sharing, reactions, microphone and camera.
    - Turning the microphone or camera off stops it at once, and the button tells the participant why it is off.
    - Turning it back on lets participants switch it on themselves; it does not switch on by itself.
  - **Chat:** chat on or off for participants.
  - **Meeting access:**
    - Host must join first; a co-host counts as the host.
    - Open, Trusted or Restricted access, and Allow guests to request access.
  - **Activities:** whiteboard, Q&A, polls, raise hand, recording and transcription.
  - **Two tabs:** "This meeting", and "My defaults for new meetings" for future meetings.
  - **Updates:** changes reach everyone at once, and participants are told what was turned off. Settings come back after a reconnect.
  - **Reactions:** new emoji reactions in the meeting.
  - **Scheduling:** the form starts from your defaults.

- Join desktop meetings as a guest, with device checks, passcode and host admission, scoped guest permissions, reconnection, guest chat, and post-meeting actions (#85).


**Added**

- Meeting recording folders with timestamped segments and video thumbnails and duration (#88).

## 1.3.0 — 2026-10-01

**Added**

- recording status you can follow (worksuite-desktop#89). States: Recording, Finalizing, Queued, Processing, Uploading to Drive, Ready to play, Paused and Failed. Downloading and Downloaded are tracked apart from playback. Progress, size and time left are shown when measured, and an animated bar when they are not. Separate badges say Saved locally, Saved to Drive and Ready to play.
- actions on a recording: Try again, Pause, Resume, Cancel transfer, Play, Open in Drive and Show the file. Status follows you across modules and survives a restart. A transfer paused by a lost connection, a full disk or a full Drive says so. A stuck step says what to do instead of spinning. You are notified when a recording is ready or fails. Ready to play appears only after the video is checked as complete. Cancelling or a failure never deletes the local recording.

## 1.2.0 — 2026-10-01

- Meeting roles (worksuite-desktop#82): Host, Co-host, Presenter and Participant badges; name co-hosts and presenters, hand the host role on, leave as host with a hand-over or end for everyone; Room settings tab (name, passcode, lock, who can join, waiting room, join before host, who can present, invite, chat, record and see transcripts) with the meeting's activity; share and record offered only when allowed.
- Inviting people into a meeting that is on (worksuite-desktop#79): Add people in the People panel (search, pictures, availability, several at once) and Invite & Ring; each invitation shows Ringing, Joined, Declined, No answer or Unavailable, with Cancel and Ring again after a short wait. The person rung gets an always-on-top invitation with Accept and Decline that rings by their notification and Do not disturb settings, stops on every device once answered, cancelled, timed out or the meeting ends, and opens the meeting with the microphone and camera off.
- Notes tab in the meeting (worksuite-desktop#80): the meeting's Notes & Minutes, written during the call; a meeting started in Meet gets its meeting record the first time its host or a co-host opens Notes, so the minutes stay in the meeting's details.
- Recording, fixed and extended (worksuite-desktop#68):
  - Start and Stop Recording follow what the media server actually does. A badge shows the elapsed time to everyone, and everyone is told when a recording starts and stops.
  - Settings › Meet › Recording (also in the meeting) chooses the method, the quality, the layout (grid, speaker, shared screen), the Drive folder (default Meeting Recordings), where local recordings are saved, and how long the local copy is kept.
  - Record Locally on This Device draws the meeting in the chosen layout with everybody's sound. Before starting it checks the microphone and the free disk space.
  - The recording is written to disk as it goes. It is finished on this computer, then uploaded to your Drive in the background. Meet Home shows each step: Recording, Processing, Uploading, Ready.
  - You can leave the meeting while it finishes. An interrupted upload continues after a restart without making a second file. A recording cut off by a crash is kept and finished.
  - The local copy is deleted only after Drive's copy is checked, and then only as chosen.
  - Failures say what went wrong, with Try again.
  - Recordings are linked from the meeting's details and Meet Home, and are private to their owner in Drive.
- Transcription (worksuite-desktop#81):
  - Start transcription in English, Sinhala or Tamil. It is transcribed on this computer with a whisper.cpp speech model (Settings › Local AI or Meet › Transcription), and online only when local cannot and Allow online fallback is on.
  - Everybody in the meeting sees it is on and who started it.
  - Each person's words carry their name; a guest without one is an unidentified speaker. Unclear speech is marked.
  - You can choose to email the transcript automatically after the meeting, to chosen people.
  - Stopping, or leaving, keeps what was said.
  - Recordings in Meet Home lead to their transcripts.

## 1.1.1 — 2026-10-01

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.1.0 — 2026-09-30

**Added**

- Codes and links are checked as they are entered, with the reason inline (not a Meet link, a meeting ID has 9 digits, no meeting has that ID, it has ended) (#67)
- Check camera and microphone on Meet Home, with the same preview and device settings as the pre-join screen (#67)
- Device problems say what to do — blocked (Open privacy settings), not found, in use by another app — with Try again; a failed connection has Try again; the chosen devices and whether the microphone and camera are on are remembered on this computer and used when joining (#69)
- The words of a meeting's card in Chat (#71), kept with Meet's other strings

**Changed**

- Meet Home redesigned (#67): a short welcome with New meeting (Start now, Create a link for later, Schedule in Calendar) and the code or link box beside its Join, a light illustration; upcoming meetings grouped by day in compact cards with time, length, host and people, and Join only when the meeting can be joined (15 minutes before its start to its end, or live), Open details otherwise; recent meetings and recordings as compact sections with See all; one action per row and a ⋯ menu for Open chat, Copy link, Copy meeting ID, Download, Rename and Delete; empty states that offer Schedule a meeting or Start a meeting
- The pre-join screen redesigned (#69): a centred two-column layout, the camera's picture in proportion (your avatar when it is off), icon microphone and camera switches with tooltips and their state, camera / microphone / speaker together with a live microphone level and Test speaker, the meeting's title, organizer, who is in it and whether you host, and Join now with its progress, sent once

**Fixed**

- Share your screen opens at once in a meeting: it no longer waits on the remote-control check (Accessibility), which never blocks sharing; if that check fails, sharing still goes ahead without control (#70)
- A past meeting nobody ended showed its length as days of minutes; a length is shown only between a minute and 12 hours, as hours and minutes (#67)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
