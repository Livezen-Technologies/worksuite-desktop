# Office shell overlay QA (#184)

The shared placement hook hides the existing Office WebContentsView for shell menus, dialogs, listboxes and toast markers. An overlapping AI drawer or open widget hides it too. The persistent AI launcher reserves a small footer below the native view so the document remains editable and the launcher remains clickable. Capture completes before the hide on the next animation frame; a 250 ms timeout keeps a failed capture from blocking access to the menu. Closing the last overlay restores the same native view and current bounds; no document reload or new editing session occurs. Office's own menus retain their existing snapshot path.

Automated renderer coverage checks overlapping surfaces, native placement restoration, stale captures, inactive tabs, failed/slow captures, toast markers, hidden menus, viewport scrolling and tab actions. Meet, PDF and web previews do not use a separate native view in this repository.

Live native acceptance still needs these checks on macOS, Windows and Linux:

- Open a document, spreadsheet and presentation. Scroll into the content and make an edit.
- Test each in an ordinary tab, a side-by-side docked tab and a detached window.
- Right-click a tab and exercise close, close others/right/all, reopen, pin/unpin, duplicate, copy link, reload, move left/right and open in a new window. Confirm guarded document saves and pinned tabs are respected.
- Open profile, notifications, command search, AI widget/drawer, sort/group menus, a toast and a dialog over the editor. All controls should be visible and clickable, including in a short window.
- Open overlapping overlays and close one at a time. The editor should return only when the last covering surface closes.
- Confirm document contents and scroll position survive, no new editor session starts, and capture-to-view transitions do not visibly flash on the target OS.
- Repeat ordinary menus over Meet video, PDFs and web previews to check renderer stacking.

A capture failure can temporarily expose the placeholder background; access to the overlay takes priority. No installer or native OS QA is implied by a cloud renderer test pass.
