# hr — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.4.1 — 2026-10-16

- Page heads and side panels fit a scaled-up window: actions wrap under the title, and full-height panels keep clear of the window buttons

## 1.4.0 — 2026-10-06

**Changed**

- Review leave — the cover's answer in the Cover card (Accept/Decline only for the cover person), an approval-only footer that wraps instead of cutting off Approve, balances as chips, days late with its period, the decision shown after it (#262)

**Fixed**

- Approve before the cover accepts asks first (Approve anyway · Remind · Open request) or shows 'Waiting for cover', never an error toast (#262, #263)

## 1.3.0 — 2026-10-03

- The organisation filter is the shared compact switcher (#214): one pill, search, several at once, a default organisation, remembered per person.

## 1.2.0 — 2026-10-02

- Announcements to several companies (#98): the company picker offers only companies you may publish to, with 'All companies you may publish to', Clear Selection, a count and chips marked 'draft only' where you may write but not publish; Publish is disabled with the reason when such a company is chosen; the acknowledgement report separates 'Acknowledged earlier text' and 'Read, not acknowledged' and filters by the companies you may read it in; edits, withdrawal and expiry refresh open consoles and readers at once.

## 1.1.0 — 2026-10-01

- Announcements to several companies or all you may publish to: searchable company picker with chips, Select All and Clear, the audience said before publishing, Save Draft and Publish Announcement, edit, expiry, pinned, withdraw, a company filter on the list and the report (#98).

## 1.0.2 — 2026-10-01

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.0.1 — 2026-10-01

**Fixed**

- a leave request opened from a link (the calendar, a notification) is highlighted in the list for the person who asked for it, instead of opening a review they would be refused; one that has gone says so (#64).

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
