# office — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.5.1 — 2026-10-27

**Changed**

- colours from the design tokens, light and dark — the hard-coded hex colours are tokens now (D-G23)

## 1.5.0 — 2026-10-25

**Added**

- WorkSuite Office Local AI policy pass-through (Local AI spec W10). After every bootstrap the app fetches the company's effective policy (GET /api/ai/office-policy, server Ai 1.19.0) and writes it where Office's local worksuite-ai service reads managed configuration: macOS user defaults lk.worksuite.office (AI* keys plus AIPolicy JSON), Windows HKCU\Software\Policies\WorkSuite\Office\AI, Linux ~/.config/worksuite/office/policy.json (0600, XDG_CONFIG_HOME respected). Each carries Source = worksuite-desktop; a policy deployed by MDM or Group Policy is never overwritten or removed.
- An answer that is not exactly the GET /v1/policy shape is refused and the last policy stays; an unmanaged company, or signing out, removes what this app wrote.

## 1.4.0 — 2026-10-20

**Added**

- Sinhala Tools in Office tabs — Convert selection / Convert document to Unicode Sinhala in the tab's menu, sent to the Document Server's plugin as the sinhala.convertSelection / sinhala.convertDocument OfficeCommands (no new origin; the editor's CSP is unchanged); the built-in editor's Sinhala to Unicode converts a .docx on this computer, offline too

## 1.3.3 — 2026-10-20

- A tender document opened from the Tenders module saves back to the tender as its next version, so its Download gives what was edited; the editor can no longer take the window full screen and hide the title bar (#393, #388)

## 1.3.2 — 2026-10-16

- Slide viewer on Windows: the header keeps clear of the window's own buttons, which covered Close.

## 1.3.1 — 2026-10-16

- A document opened while the chat drawer is docked shows beside it instead of saying it is behind the window; only a floating drawer covers it.

## 1.3.0 — 2026-10-13

**Added**

- storage full while saving — edits kept on this computer and uploaded as a new version once there is room (Connection & Startup)

## 1.2.0 — 2026-10-10

**Added**

- the editor fills the tab on the app's background with one header (#326); presentations get a slide viewer with thumbnails, zoom and full-screen Present with presenter view (#321); Open with WorkSuite Office (#322)

## 1.1.2 — 2026-10-03

- Keep shell menus and overlays above the native Office editor without reopening documents (#184).

## 1.1.1 — 2026-10-01

**Fixed**

- Share opens over the document rather than in front of a blank grey page (worksuite-desktop#42). A picture of the editor taken as it opens stays behind the dimmed dialog, as it does for the menus. Moving on to a secure or public link keeps it. Closing with Done, × or Escape brings the same editor back with its changes, selection and scroll as they were, and typing goes on in the document. The editor's own Share and a mention's offer to share do the same, as does Save as version.

## 1.1.0 — 2026-09-30

**Added**

- Open in new window beside Share and ⋯, which moves the document to a window of its own, signed in as the same person with the same access; changes on their way to the Office server go first (Saving changes…), and a document whose last save failed is not moved until it is saved (#39)

**Changed**

- The document header keeps its controls on one line in a narrow window: Share shows its icon only below the large breakpoint, and who else is in the document is hidden below the medium one (#39)

**Fixed**

- The Editing (mode) menu and the More (⋯) menu open above the document editor: the editor is a native view that covered them, so while a menu is open it is hidden and a picture of it taken just before stands in (#39)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
