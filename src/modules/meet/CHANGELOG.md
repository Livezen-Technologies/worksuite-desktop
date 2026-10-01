# meet — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.2.0 — 2026-10-01

- Meeting roles (worksuite-desktop#82): Host, Co-host, Presenter and Participant badges; name co-hosts and presenters, hand the host role on, leave as host with a hand-over or end for everyone; Room settings tab (name, passcode, lock, who can join, waiting room, join before host, who can present, invite, chat, record and see transcripts) with the meeting's activity; share and record offered only when allowed.
- Inviting people into a meeting that is on (worksuite-desktop#79): Add people in the People panel (search, pictures, availability, several at once) and Invite & Ring; each invitation shows Ringing, Joined, Declined, No answer or Unavailable, with Cancel and Ring again after a short wait. The person rung gets an always-on-top invitation with Accept and Decline that rings by their notification and Do not disturb settings, stops on every device once answered, cancelled, timed out or the meeting ends, and opens the meeting with the microphone and camera off.

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
