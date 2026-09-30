# office — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.1.0 — 2026-09-30

**Added**

- Open in new window beside Share and ⋯, which moves the document to a window of its own, signed in as the same person with the same access; changes on their way to the Office server go first (Saving changes…), and a document whose last save failed is not moved until it is saved (#39)

**Changed**

- The document header keeps its controls on one line in a narrow window: Share shows its icon only below the large breakpoint, and who else is in the document is hidden below the medium one (#39)

**Fixed**

- The Editing (mode) menu and the More (⋯) menu open above the document editor: the editor is a native view that covered them, so while a menu is open it is hidden and a picture of it taken just before stands in (#39)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
