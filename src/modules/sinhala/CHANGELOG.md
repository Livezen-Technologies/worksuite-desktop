# sinhala — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.0.0 — 2026-10-20

**Added**

- Sinhala Tools (Sinhala Tools blueprint §6, P2): the converter app (id sinhala-tools) — paste or drop legacy Sinhala text (FM Abhaya, DL Manel, Kaputa) and see it in Unicode as you type, pick a profile, copy or save; drop or pick Word documents to convert them on this computer into name (Unicode).docx
- SinhalaService and its worker on the pinned @worksuite/sinhala-core engine: whether the tools show from GET api/sinhala/status; profiles from api/sinhala/profiles?include=map checked by sha256 (and Ed25519 when signed) before use, the last good set kept for offline; Drive files (DOCX, PPTX) converted by the server's job online — its preview shown first, saved as a new version only on Save as new version (POST jobs/{id}/accept; a 409 when the file changed says so) or dropped with Discard (reject) — their offline copies here with the new version uploaded when back online (a conflict keeps both)
- Convert clipboard to Unicode from the tray and a global key (Ctrl/Cmd+Shift+U, changeable); org fonts installed per user on Windows, macOS and Linux (sha256-checked, distributable only)
- The tools stay hidden when the server has no Sinhala API (404), the organisation has them off, or the person lacks sinhala.use
