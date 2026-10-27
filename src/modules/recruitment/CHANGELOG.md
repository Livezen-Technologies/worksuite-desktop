# recruitment — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.1.1 — 2026-10-27

**Changed**

- the parts this module shares with others now come from src/components (the page, list, record, form, card, call, console and report kits), and a lint rule keeps modules from importing each other (audit D-G08). Nothing a person sees changes.

## 1.1.0 — 2026-10-27

**Added**

- read-only offline from the encrypted cache — what was last read, under an "Offline · read-only" banner with its "as of" time; every change waits for the connection and is refused before it is sent; secrets, files, exports and one-time answers are never kept (D-G14)

**Changed**

- colours from the design tokens, light and dark — the hard-coded hex colours are tokens now (D-G23)

## 1.0.0 — 2026-10-20

- Recruitment on the desktop (WS-REC SRS §9, gap doc §9.3 D01–D05) over the staff API `/api/recruitment`, app id
  `recruitment`, route `/recruitment`, with its own 220px nav; what the desktop does not draw opens on the web.

**Added**

- D01 Pipeline board: job picker, the job's stages as columns, cards with duplicate / knockout / SLA flags, average
  rating and days in stage; drag a card to move it. Moving back, or out of the pipeline, asks for a reason first (§3.10).
- D02 Review queue: new applications with the CV in the desktop's file viewer; J / K next and previous, A advance,
  S shortlist, R reject with a reason (the email waits for the server's undo window; Undo on the toast).
- D03 Interviews today: Join Meet through Meetings' own join (the interview's Meet room or online link), which also
  opens the scorecard in a window beside the call; "starts in", observer rows, open scorecards warned about.
- D04 Scorecard: the interview kit and the scorecard in a resizable docked panel, or popped out into its own window;
  ratings 1–5 per criterion, a comment required on a 1 or a 5, a recommendation, Save draft and Submit.
- D05 Approvals waiting on me: requisitions, selections and offers with Approve, Reject and Return (a comment needed
  to reject or return).
- Desktop notifications: `recruitment.interview_scheduled` / `interview_changed` open Interviews today,
  `evaluation_due` / `evaluation_overdue` the scorecard, `offer_waiting` / `requisition_waiting` Approvals,
  `application_received` the review queue (`shared/recruitment.ts`).
- The launcher tile (People), the `worksuite://recruitment` deep link, and permissions from `/api/recruitment/meta`
  `can{}` on every screen and action.
