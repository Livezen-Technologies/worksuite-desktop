# meetings — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.6.3 — 2026-10-27

**Changed**

- colours from the design tokens, light and dark — the hard-coded hex colours are tokens now (D-G23)

## 1.6.2 — 2026-10-26

**Changed**

- the figure cards (KPI, stat and summary tiles) are the shared StatCard — compact, a tinted icon chip and the label above a calm figure, a muted line under it, zero shown muted; cards that open a list are buttons with a focus ring and a soft lift; the same figures and actions as before

## 1.6.1 — 2026-10-16

- The dashboard stacks into one column on a narrow or scaled-up window, and list filters wrap instead of running off the page

## 1.6.0 — 2026-10-13

**Added**

- the new Meetings design (D01–D06). The home has a week's day strip, date badges and answer chips, and its list pages and filters on the server (search, type, related record, day) when the server can. A meeting opens on its Summary: when, where, who runs it and what it is about, your answer, the agenda, and beside them the invitation emails, your recording and the reminder. Notes & Minutes, Transcripts, Q&A & Polls and Schedule a meeting follow the new layouts; Schedule marks each person Free, Busy, Maybe busy or Unknown, and over a clash offers Schedule anyway or Find another time.
- controls follow what the server says you may do with each meeting (its abilities): Edit, Reschedule, Start, Complete, Cancel, Delete, Join, your answer, running the agenda, inviting people, marking attendance and uploading files each appear only when allowed. An older server without abilities gets what the app worked out before, and never Start, Complete or Delete.
- a change refused because the meeting moved on meanwhile (already cancelled or completed, or over for answers) is said plainly, and the meeting is shown as it is now. Files open by a short-lived signed link where the server has one.
- reminder and invitation notifications of their own (D07). A reminder says when the meeting starts and where, with Join, Snooze 5 min and Open; an invitation says when, from whom and what it clashes with, with Going, Maybe and Propose time. They keep to your notification settings, quiet hours and the one-device rule. The tray lists today's meetings, joining the live ones, and the invitations waiting.
- the agenda window (D08), a small window that stays on top with the meeting's shared agenda timer: the live item, the time left or how far it ran over, Pause and Next item for whoever runs the agenda, and quick notes that go into the minutes, kept on this computer until the server can be reached.

## 1.5.0 — 2026-10-02

**Added**

- invitations reliably reach invitees by bell, banner and email (with a calendar file), with reminders and notices of moves and cancellations. The organiser sees an Emails panel with delivery status and Retry (worksuite-desktop#97). Answers update Meetings, Calendar, Home and notifications at once.
- tender meetings are labelled Tender meeting and can be filtered under Related to. Their details offer Open Tender and show the booking timezone (worksuite-desktop#100).
- scheduling a meeting from a tender contact starts with the contact as a guest (worksuite-desktop#118).

## 1.4.1 — 2026-10-02

**Fixed**

- Show live measured recording transfers and recovery controls in meeting details (#89).

## 1.4.0 — 2026-10-01

**Added**

- a Q&A & Polls tab on the meeting's details (worksuite-desktop#92). Hosts, co-hosts and the organiser see everything; participants see the visible questions, without the names of anonymous askers, and the poll results that were shared.
- Scheduling a meeting starts from your Meet defaults, set in Host Controls › My defaults for new meetings (worksuite-desktop#91).


## 1.3.2 — 2026-10-01

- Meetings show the record they were scheduled from (Tender Meeting, Lead, Customer, Supplier) with Open Related Record when the server sends it; Schedule can be prefilled from a record (#100, #101 groundwork).

## 1.3.1 — 2026-10-01

- Accepting an invitation asks about conflicts afresh; cancelling or moving a meeting refreshes the calendar and its conflict answers (#99).

## 1.3.0 — 2026-10-01

**Added**

- schedule conflicts (worksuite-desktop#99). Schedule a meeting marks each person Busy or Maybe busy at that time, without saying what they have, and warns you of your own clash. It checks again before saving, with Schedule anyway. Invitations awaiting your answer are flagged when they clash. Accepting one asks first and offers Propose new time, which tells the organiser the time you suggest; the meeting itself does not move.

## 1.2.0 — 2026-10-01

- Scheduling a meeting on the built-in Meet sets its room settings and passcode, and each person's part (attendee, co-host, presenter) (worksuite-desktop#82).
- Notes & Minutes (worksuite-desktop#80), in the meeting's details and in the meeting itself:
  - The title, date and participants are at the top.
  - Agenda, Discussion and Decisions are formatted text that saves itself (Saving…, Saved, or Couldn't save with Retry).
  - Several people can write at once: a section changed by somebody else meanwhile is never overwritten. You choose Keep both, Use theirs or Replace with mine.
  - Action items have owners and due dates, and become linked tasks once reviewed.
  - Generate with AI drafts from what is written, the agenda and the chat, and never invents decisions, owners or dates.
  - The organiser chooses who can see and edit the minutes, finalises them, and shares them with the people chosen.
  - Minutes can be copied, or exported to PDF or Word.
- Your recordings of a meeting held on Meet are listed under Files, with their state and Open in Drive (worksuite-desktop#68).
- Transcripts tab (worksuite-desktop#81):
  - Shows transcripts made during the meeting and from its recordings.
  - Generate transcript for a recording runs on this computer first, with progress, Cancel and Try again.
  - Review a transcript, and correct speakers, text and unclear marks; corrections are saved on the version read.
  - Copy, or export as TXT or PDF.
  - Email transcript: only to people who may see it, with an editable subject and message. Send it as a link, PDF or TXT as sharing allows, after a preview and a confirmation. Each delivery's status is shown, with Retry.
  - Generate with AI drafts the minutes from the transcript.

## 1.1.0 — 2026-10-01

**Added**

- Draft minutes with AI (#53) in a meeting's Minutes, from the agenda and its notes, what is written so far, the actions, and the meeting's chat. The draft is shown first; used, it fills Summary and Decisions (kept with Save notes) and adds the actions it lists

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
