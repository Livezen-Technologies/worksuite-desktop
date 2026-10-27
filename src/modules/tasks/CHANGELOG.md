# tasks — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.4.3 — 2026-10-27

**Changed**

- colours from the design tokens, light and dark — the hard-coded hex colours are tokens now (D-G23)

## 1.4.2 — 2026-10-26

**Fixed**

- a description's text is no longer announced as clickable; its links stay links (D-G21)

## 1.4.1 — 2026-10-26

**Fixed**

- a card dropped on another column, or a task completed from the list, the task or Done, stays where it was put; a poll already on its way put the old status back until the next one (#430, #433)

## 1.4.0 — 2026-10-20

- List view: pick tasks with the box at the start of a row and complete, reopen or move them together; the round tick completes a task at once (#392)

## 1.3.0 — 2026-10-14

**Added**

- the task editor as a frame and parts (tasks/editor: TaskEditorFrame, Title, Description, Checklist, Attachments, Conversation and the side fields), composed by the Tasks app's TaskDetail and by Projects' task modal; patchTask() takes a field router (the Tasks app's: every field to /api/tasks/{id})

**Changed**

- nothing for the Tasks app's own editor — the same fields, saving and actions

## 1.2.3 — 2026-10-03

- The sidebar's New button is the shared primary action button: same size, colour, plus icon and quiet shadow as every module; the shortcut is in its tooltip (#171).

## 1.2.2 — 2026-10-03

- New task from a mail message carries its subject, link, due date and assignee (ENH-MAIL-03).

## 1.2.1 — 2026-10-03

- Tasks work on Local Profile data in guest mode (#149).

## 1.2.0 — 2026-10-03

- Added multiple task reminders in creation and detail editors: due time, 15 minutes, 1 hour, 1 day, or custom date/time, with authorized recipients, timezone previews, edit/remove and notification settings guidance (issue #62).

## 1.1.0 — 2026-10-01

- Upcoming view (due in the next week); Due today no longer includes what is already overdue; Home reads the same tasks as the Tasks page (#104).

## 1.0.1 — 2026-10-01

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
