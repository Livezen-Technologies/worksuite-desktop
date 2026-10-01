# meet — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

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
