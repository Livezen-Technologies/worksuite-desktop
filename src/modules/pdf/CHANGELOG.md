# pdf — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.3.1 — 2026-10-26

**Fixed**

- a page in Organize is reached with Tab and picked with Enter or Space (D-G21)

## 1.3.0 — 2026-10-22

**Added**

- signing with a smart card or USB token (PKCS#11 through OpenSC): tokens and their certificates are found, the PIN goes to the token library in its environment and is never kept, the key never leaves the token (PRO-SIG-002)
- Convert and OCR — PDF to DOCX/XLSX/PPTX/HTML/EPUB/TXT/images; searchable or editable OCR with language detection (Sinhala, Tamil, English), straightening and cleaning (PRO-CNV-001..005)
- Print production — PDF/X preflight with fixes, separation and overprint previews with the output intent, n-up and booklet imposition with crop and bleed marks (PRO-PRT-001..003)
- share a PDF form by link and see the answers as a table (PRO-FRM-006); who else has the PDF open and on which page (PRO-REV-006)

## 1.2.0 — 2026-10-22

**Added**

- the Pro panel for Drive PDFs (Properties panel › Pro, Review ribbon › Pro) — true redaction and Sanitise a copy, signature validation, signing with a PKCS#12 file on this computer (the key never leaves it; prepare/complete with the server) or a certificate WorkSuite holds, send for signature, find and replace in the document's font, compare versions with a report, shared review replies and statuses, form field detection, accessibility check and fixes, the AI assistant, and running a saved Action — on PDF Studio Pro (server PdfPro 1.0.0)

**Changed**

- the tool registry says honestly which tools now work for Drive PDFs through the server (edit, compare, redact, certificates, e-signatures, prepare a form, accessibility, AI, actions, comments)

## 1.1.1 — 2026-10-13

**Changed**

- PDF storage is kept per account (Connection & Startup)

## 1.1.0 — 2026-10-06

**Added**

- All tools — every Acrobat-class tool (ENH-01 T01–T26) in a searchable panel beside the document, each with its own panel; tools that cannot run yet say why
- PDF Studio home with its module rail (Recent, Starred, Shared, Agreements, Scans, Offline copies, All tools, Jobs, Action wizard, Recover, Settings, Organization policy, Diagnostics), the 18-tool grid and Open from Drive
- sign by drawing or typing a signature placed on the page; find NIC, phone, email, card and bank numbers for redaction; Bates numbering preview; copy the diagnostics report

## 1.0.1 — 2026-10-01

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
