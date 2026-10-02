# meetings — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

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
