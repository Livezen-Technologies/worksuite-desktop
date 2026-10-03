# Screen-share stage (#146)

The shared call workspace selects our own screen publication first, otherwise
an available remote screen publication. Screen and camera remain different
LiveKit tracks and different video elements. A share takes precedence over a
whiteboard, including in the floating card. Removing the publication restores
the normal layout. The existing LocalTrackUnpublished listener refreshes the
meeting after an OS/browser Stop sharing action.

The presenter gets a live preview, a three-pixel red border and a Stop
presenting button. Their camera uses the existing movable, resizable,
minimisable PiP in the focus layout, or the camera strip/column in the other
layouts. Self-view preferences are respected. Remote viewers retain a separate
presenter camera. Screen video is contained and never mirrored.

The desktop outline is a transparent, unfocusable, click-through window tied
to the capture grant for the requesting page. It uses the selected display's
bounds, or read-only window bounds from Windows User32, macOS CoreGraphics, or
X11 xwininfo. It polls serially, hides when bounds are unavailable, and closes
on track removal, source replacement, workspace unmount or capturing-page
destruction. No input injection or Accessibility prompt is used. Wayland
cannot position this overlay; it retains the in-app border. Missing xwininfo,
blocked PowerShell, native-query failures or OS compositor restrictions may
also prevent the desktop outline. Content protection is requested, but whether
the outline is captured is OS dependent.

Automated tests exercise real VideoView track attachment/detachment for local
and remote presenters, camera separation, stop action, PiP hide/restore,
floating-card selection, whiteboard precedence, and native-outline lifecycle
and coordinate parsing. Native APIs are mocked in those unit tests.

Before closing the issue, validate on installed Windows/macOS/Linux clients:

- Two participants: camera on, share each monitor and an external window.
  Confirm both participants see the live share on stage and the presenter camera
  separately. Check screen text is not cropped or mirrored.
- Drag/minimise/restore the camera. Switch source while sharing, move/resize a
  shared window, minimise/restore it, and use mixed-DPI/negative-coordinate
  monitors. Confirm the outline follows the correct surface and takes no input.
- Stop with the in-app button and the OS sharing control, then disconnect/close
  the call. Confirm preview, outline and sharing status disappear.
- Check full screen, floating card, panel open, paused share and whiteboard.
- Verify no outline on an unrelated monitor when native bounds cannot be read;
  sharing must still work with the in-app border.

Electron's existing picker offers screens and windows, not individual browser
tabs. A browser window is supported; adding browser-tab capture is separate
capture-source work. Browser guest meetings use their existing guest layout
rather than this shared desktop workspace. The separate stale-timer report is
not changed here. Do not treat the unit tests as completed native or browser QA.
