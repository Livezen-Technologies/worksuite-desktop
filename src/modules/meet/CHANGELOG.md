# meet — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

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
