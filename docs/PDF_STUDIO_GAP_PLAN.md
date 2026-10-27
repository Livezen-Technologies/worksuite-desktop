# PDF Studio — UI build, gap analysis and plan

Against **WS-PDF-SRS-001 v1.1** (base, "SRS") and **WS-PDF-ENH-01 v1.0** (PDF Studio Pro, "ENH"), and the design
canvas *WorkSuite PDF Studio — UI* (W01–W10, DK01–DK17, A01–A02, M01). Scope here is **WorkSuite Desktop**
(this repository). Server work (`app/Modules/Pdf`) is listed where the desktop depends on it.

Status words: **Built** works end to end · **UI** screen built, its action is off with the reason · **Partial** some
of it works · **Missing** nothing yet.

## 0. PDF Studio Pro on the server (WS-SRS-PDFPRO-001, 2026-10-22)

The server's `app/Modules/PdfPro` (1.0.0) now does what many **UI** rows below waited for, for **Drive PDFs**, and
the desktop reaches it through the **Pro** panel (`ProPanel.tsx`, `pro.ts`): true redaction + sanitise, signature
validation, PAdES signing (server certificates, or a **PKCS#12 file signed on this computer** through
`prepare`/`complete` — `openPkcs12`/`signLocally` with pkijs and WebCrypto), e-sign envelopes with the SIGNING
lock, text find-and-replace, compare with report, shared review, form detection, accessibility, AI and Actions.
`tools.ts` marks those tools **partial** with what works. Still to build on the desktop: canvas-level editing with
the engine, PKCS#11 tokens and the OS keystores, field placement on the canvas, local-file Pro operations.

## 0.1 Tools on this computer, and no dead buttons (audit D-G12, 2026-10-27)

The audit counted the "UI" cells below (30, plus 2 Missing). Each now either works on this computer with the engine
the app ships (PDFium, `@embedpdf/pdfium`; engine ops in `pdfium-provider.ts`, IPC `pdf:edit`, `pdf:derive`,
`pdf:compose`), or says plainly in its panel what it needs — **Needs the WorkSuite server** (PDF Studio Pro, with an
*Open the Pro panel* button for Drive PDFs) or **Needs WorkSuite Office** — instead of a run button that is always
off. Tools with nothing working anywhere are not listed (`hidden` in `tools.ts`). The status columns below are kept
as the history of the plan; this table is the current state.

| Item (rows below) | Outcome |
|---|---|
| Create (DK06, T02) | **Built here:** pictures (PNG, JPEG) to a PDF, fitted on A4/Letter or at their own size; blank pages. Office and web pages: *Needs WorkSuite Office*. |
| Edit (DK03, T05) | **Partial here:** page design (header, footer, watermark, Bates) is the stamp op. Editing a PDF's own text and images: *Needs the WorkSuite server* (Pro panel). Dead buttons removed. |
| Export (DK06, T06) | **Built here:** each page as PNG (72/150/300 dpi), the text as .txt. Word, Excel, PowerPoint, HTML: *Needs WorkSuite Office* (Pro panel Convert for Drive PDFs). |
| Combine (DK04, T03) | **Built here:** PDFs from this computer, in order, page ranges, a bookmark per file, into a new PDF. Non-PDF inputs: *Needs WorkSuite Office*. |
| Organize additions (T04) | **Built here:** duplicate pages (journaled), split into files every n pages. |
| Compress (DK06, T07) | *Needs the WorkSuite server* (PDFium cannot re-encode images; no device optimizer). No run button. |
| Scan & OCR (DK07, T10) | *Needs the WorkSuite server* (Pro panel OCR for Drive PDFs). Scanner and device OCR not in this version. |
| Shared review (DK05, T09) | *Needs the WorkSuite server* (Pro panel); the four dead buttons removed. |
| Fill & Sign (W09, T11) | Partial (unchanged): a drawn or typed signature placed as a mark. |
| E-signatures (DK08, T12) | *Needs the WorkSuite server* (Pro panel). The dead form and buttons removed. |
| Prepare form (DK09, T13) | *Needs the WorkSuite server* (Pro panel). |
| Protect (DK10, T14) | **Built here:** a protected copy — AES-256, open and permissions passwords, print/change/comment/copy permissions — and an unlocked copy of a PDF opened with its password. Certificate encryption: *Needs the WorkSuite server*. |
| Redact (DK10, T15) | **Built here:** patterns and words found, reviewed, then truly removed from the pages (text under them taken out of the content, pictures and drawings wholly inside removed, black boxes drawn), as an edit. Sanitise and reason codes: *Needs the WorkSuite server*. |
| Certificates (DK10, T16) | *Needs the WorkSuite server* (Pro panel signing and validation). |
| Compare (DK11, T17) | *Needs the WorkSuite server* (Pro panel). |
| Accessibility (DK12, T18) | *Needs the WorkSuite server* (Pro panel). |
| Standards (DK12, T19) | **Hidden:** no PDF/A or veraPDF route is wired. |
| Print production (DK13, T20) | **Hidden:** needs colour management in the engine. |
| Measure (DK13, T21) | **Hidden:** needs measurement annotations and path snapping. |
| Bates, header & footer, watermark (DK14, T23) | **Built here:** the stamp op — Bates numbers, Page n of N, the date, diagonal watermarks — on the pages chosen, upright on turned pages, undoable. Latin text (Helvetica). |
| Action wizard (DK14, T22) | *Needs the WorkSuite server* (Pro panel runs saved Actions). |
| AI Assistant (DK15, T24) | *Needs the WorkSuite server* (Pro panel). |
| Offline + recovery (DK16) | Unchanged page; "Offline copies" says *Not in this version* instead of a dead Manage. |
| Settings (DK17) | Dead buttons replaced: default app ("In your system's settings: Default apps"), saved signatures (*Needs the WorkSuite server*), digital IDs ("Chosen when you sign"). |
| Admin policy (A01) | Save says *Saving needs the WorkSuite server (Admin Center › Files › PDF Studio)*; no dead button. |
| Jobs (W08) | Unchanged: the server capability rows (informational). |
| Libraries (T26, Missing) | Not built: admin libraries are the server's; nothing is shown for them. |
| Entitlement (PRO-ENT, Missing) | Not built: needs `pdf_studio_pro` in the session flags; Pro badges stay informational. |

Tests: `tests/unit/electron/pdf-tools.test.ts` (the engine ops on PDFium), `tests/unit/electron/pdf-editing.test.ts`
(the service: journaled stamps, duplicates and undo; protected copy, text, split, combine, pictures), and
`tests/unit/renderer/pdf-tools.test.tsx` (each panel's call, and the server tools' "Needs" with no dead button).

## 1. What this change adds (UI first)

Every desktop screen in the design now exists in `src/modules/pdf`, driven by one tool registry
(`tools.ts`, ENH §4.1). Tools that cannot run yet show their full panel with the run button off and the reason
(ENH PRO-FW-008), plus a "to build" list — the same list as §4 below.

| Screen | Where | Status |
|---|---|---|
| DK01 Home | `/pdf` — module rail, 18-tool grid, Recent (this computer), drop zone, Open from Drive | Built (Recent is local until `GET api/files/pdf/recent`) |
| DK02 Viewer + All tools | "All tools" in the document title bar → searchable grouped panel → tool panel, "‹ All tools" back; status bar shows location · base version · mode · engine | Built |
| DK03 Edit PDF | Tool panel: add text/image/link/crop, format text, objects, page design | UI |
| DK04 Organize + Combine | Organize → existing page grid; Combine panel with file list, ranges, reorder, bookmarks/TOC options | Organize Partial · Combine UI |
| DK05 Comment + shared review | Comment → existing Annotate ribbon + Comments panel; shared review block | Comment Partial · Review UI |
| DK06 Create / Export / Compress | Three panels with sources, formats, presets, advanced optimizer | UI |
| DK07 Scan & OCR | Pages, languages (eng/sin/tam), output, where it runs, enhance, suspects | UI |
| DK08 Request e-signatures | Recipients (order, role, verification), subject, message, deadline, reminders, language, field palette; Agreements page | UI |
| DK09 Prepare form | Field palette, properties tabs, safe-formula field | UI |
| DK10 Protect / certificates / redact | Protect (method, passwords with strength meter, permissions, AES); Certificates (signature count, sign/certify); **Redact finds NIC/phone/email/card/bank/words through the engine's search** and lists hits masked | Protect UI · Certs UI · Redact Partial |
| DK11 Compare | Old/new, view mode, ignore options | UI |
| DK12 Accessibility + standards | Fix actions, check categories, PDF/A·UA·X rows, Save as | UI |
| DK13 Print production + measure | Output preview, preflight profile, prepress; distance/perimeter/area, scale, snap | UI |
| DK14 Action wizard + Bates | 5 built-in actions with steps; **Bates preview computed live** | UI |
| DK15 AI Assistant | Suggested prompts, ask box, policy note | UI |
| DK16 Offline + recovery | Offline copies page; Recover page (explains the per-document recovery that exists) | UI |
| DK17 Settings › PDF Studio | `/pdf?view=settings` — opening, editing & review, offline, engine; org-locked rows | UI (stored on this computer, not applied yet) |
| A01 Admin policy | `/pdf?view=admin` — every §13.2 policy key, defaults, Reset; Save off | UI |
| A02 Diagnostics | Existing device checks + **Copy report** + server/activity note | Partial |
| W08 Jobs | `/pdf?view=jobs` — server capability rows | UI |
| W09 Fill & sign | **Draw or type a signature and place it on the current page** as an annotation (needs Annotate) | Partial |
| W02–W07, W10 | Already in the workspace: viewer, annotate, organize, lock banners, save/conflict dialog, versions/activity panel | Built/Partial (see §3) |
| M01 Mobile | Not this repository | — |

## 2. What was already built on the desktop (before this change)

PDFium (WASM) engine in a worker process per document; view (4 layouts, zoom 25–6400 %, fit, full screen,
present, read mode); thumbnails, bookmarks, search (case/word/regex, comments, bookmarks), attachments panel;
properties and the active-content blocker; print dialog; password prompt; local, Drive and mail sources; drag-drop;
PDF Studio server contract for Drive files (sessions, heartbeat, modes, edit lock + takeover, chunked upload,
save version/copy, 409 conflict with keep-both / upload-as-new / use-cloud); 11 annotation kinds in the file;
organise (rotate, delete, move, blank, insert from PDF, extract); undo/redo journal; sealed recovery per document;
Versions and Activity panels; PDF Diagnostics.

## 3. Gap analysis — base SRS requirements on Desktop

| Area | Requirement(s) | Desktop today | Gap |
|---|---|---|---|
| Open | PDF-OPEN-001 | Drive, local, mail, Files/Mail hand-off | `worksuite://pdf/open?file=` deep link; record attachments (Tender, Garage…) hand-off audit |
| | PDF-OPEN-002 home | **Built here** (local Recent) | `GET api/files/pdf/recent`, `GET …/active` for live status chips and "being edited now" |
| | PDF-OPEN-003 registry/launcher | Module exists | Confirm launcher tile + Drive "Open with PDF Studio" default (server registry) |
| | PDF-OPEN-004/005 OS integration | Drop + dialog | File association, Open With, Dock/taskbar drop, "make default" prompt (electron-builder `fileAssociations`, `open-file`/argv handling) |
| | PDF-OPEN-013 split view | Tabs only | Split view of two PDFs / two versions with synced scroll |
| View | PDF-VIEW-005 "What you can do" | Reasons on buttons | Right-panel list of effective flags + why (from session flags) |
| | PDF-VIEW-006 presence | Lock holder only | Who else has it open (session list in heartbeat) |
| | PDF-VIEW-002 layers | — | Optional content (layers) panel |
| Annotate | PDF-ANN-002 threads | Edit/delete comment | Replies (IRT), @mentions, resolve/status, filter/sort |
| | PDF-ANN-001/ACR-030 tools | 11 kinds | Arrow, polygon, cloud, callout, replace/insert text, eraser, attach file, audio; opacity/fill controls |
| | PDF-ANN-005 index | — | Server `pdf_annotation_index` + `GET …/pdf/annotations` |
| Organise | PDF-ORG-002/005 | Most ops | Duplicate, replace, split, page labels, "Changes in this session" list, drag between tabs |
| | PDF-ORG-004 bookmarks editor | Read-only outline | Add/rename/nest/reorder bookmarks (engine op) |
| Save | PDF-SAVE-006 Compare choice | 3 of 4 choices | "Compare" choice → compare view |
| | PDF-SAVE-010 checkpoint | Recovery autosave | Checkpoint version every N min (policy) |
| | PDF-SAVE-021 quota | Error text | "Save to this computer" action on 413 |
| Lock | PDF-COL-002 | Banner + takeover | "Ask for edit access" (`POST …/lock/request`), "Notify me when free" (`…/lock/watch`) |
| | PDF-COL-007 | — | SIGNING and OFFICE lock types |
| Desktop | PDF-DSK-002 menu | Shortcuts | Native menu bar entries (File/Edit/View/Document/Tools) for PDF commands; Alt+1/2/3 modes, Ctrl+R rotate, Ctrl+\ split |
| | PDF-DSK-003 offline | Pending save when offline | "Keep an offline copy" cache + outbox list (DK16) |
| | PDF-DSK-004 recovery dialog | Per-document recovery | Start-up dialog listing all drafts with Drive state (`pdf:recoveryList`) |
| | PDF-DSK-005 print | Print dialog | Duplex/booklet/poster/multiple-per-sheet; print audit `POST …/pdf/audit` |
| | PDF-DSK-006 settings | **UI here** | Apply prefs (open target, start mode, author, cache); move under Settings module; `api/files/pdf/preferences` |
| | PDF-DSK-007 tray | — | Tray notifications: lock request, lock lost, job finished, outbox uploaded |
| | PDF-DSK-008 diagnostics | Device checks | Server half via `GET api/files/pdf/diagnostics`; recovery store + outbox checks |
| Tools | PDF-TOOL-001…008 | — | Desktop client for `api/files/{id}/pdf/tools/*` and jobs (W08); server must move tools behind `files.pdf.*` + policy (F-05) |
| Forms/sign | PDF-FORM-001, PDF-SIGN-001/002 | **Drawn/typed mark** | AcroForm fill in the engine, saved signatures, in-person mode |
| Redact/protect | PDF-RED-001…003, PDF-SEC-001 | **Pattern find** | Marks, apply, sanitize, protect job |
| Admin | PDF-ADM-001…003 | **UI here** | Wire `GET/PUT api/admin/files/pdf/policy` (exists on server), `GET api/admin/files/pdf/locks` (to add) |

Server-side findings F-01…F-15 (SRS §4) stay open except **F-01** (desktop client now exists) and, in UI terms,
**F-06/F-07** (admin and home screens exist on the desktop; their APIs do not all exist).

## 4. Gap analysis — Pro tools (ENH T01–T26)

The registry in `src/modules/pdf/tools.ts` is the source of truth for each tool's missing pieces; the All tools page
(`/pdf?view=tools`) shows them in the app. Summary:

| Tool | Status | Main blockers |
|---|---|---|
| T01 Home / All tools / quick toolbar | Partial | Pro entitlement flag in session (`pro: true`), favourites, command palette "PDF: <tool>" |
| T02 Create | UI | Device images→PDF; server `POST api/files/pdf/create`; scanner bridge; web capture with SSRF guard |
| T03 Combine | Partial | Engine "assemble new document" op; bookmarks/TOC; `POST api/files/pdf/combine` for non-PDF |
| T04 Organize | Partial | Duplicate, replace, split, labels, cross-tab drag |
| T05 Edit | UI | Content-stream text edit, HarfBuzz/FreeType font pipeline, image/link/page-design ops |
| T06 Export | UI | Device image/text export; `POST api/files/{id}/pdf/export` |
| T07 Compress | UI | Server optimize under new route; device optimizer |
| T08 Comment | Partial | Threads, statuses, remaining tools, summarize, FDF/XFDF, Make task |
| T09 Shared review | UI | `api/files/{id}/pdf/reviews`, external reviewer OTP |
| T10 Scan & OCR | UI | Device OCR (tesseract eng/sin/tam) + text-layer writer; scanner bridge; suspects |
| T11 Fill & Sign | Partial | AcroForm fill, saved signatures API, in-person mode |
| T12 E-signatures | UI | PDFAgreementService, signing page, SIGNING lock, metering |
| T13 Prepare form | UI | Field ops, detection, safe formula engine, mappings/responses |
| T14 Protect | UI | Server qpdf job; device AES-256 writer; cert encryption |
| T15 Redact | Partial | Marks, apply, sanitize, verification |
| T16 Certificates | UI | Validation (pkijs), keystore bridges, PAdES, TSA, trust list |
| T17 Compare | UI | Two-document view, text/visual diff, report |
| T18/T19 Accessibility, standards | UI | Structure tree, checker, autotag; veraPDF |
| T20/T21 Print production, measure | UI | LittleCMS, preflight; measure annotations + snapping |
| T22 Actions | UI | `api/pdf/actions`, local runner |
| T23 Bates & index | UI | Text-stamp op, multi-file run, log CSV |
| T24 AI | UI | `api/files/{id}/pdf/ai/*` via CoreAIService, citations on canvas |
| T25 Attachments / portfolios | Partial | Attachments listed; add/save to Drive/delete, portfolios, rich media |
| T26 Libraries | Missing | Admin libraries (stamps, presets, policies, profiles) + sync |
| Entitlement (PRO-ENT) | Missing | `pdf_studio_pro` in session flags; Pro badge gating (badges shown, not enforced) |

## 5. Plan with tasks

Each task names its requirement IDs and where the work goes (**D** desktop main/engine, **R** renderer, **S**
server, **I** IPC contract — an `shared/ipc` change is a MAJOR for `pdf`). Sizes: S ≤ 2 days, M ≤ 1 week, L > 1 week.

### Phase A — Wire what the server already has (desktop, ~2 weeks)

| # | Task | Reqs | Where | Size |
|---|---|---|---|---|
| A1 | Admin policy: `GET/PUT api/admin/files/pdf/policy` behind `files.pdf.admin`; show A01 only to admins; Save + audit | PDF-ADM-001 | R, I | S |
| A2 | "What you can do" right panel from session flags + reasons | PDF-VIEW-005 | R | S |
| A3 | Server half of PDF Diagnostics (`GET api/files/pdf/diagnostics`) merged into A02 | PDF-DSK-008 | D, I, R | S |
| A4 | Print and export audit (`POST …/pdf/audit`) | PDF-AUD-001, PDF-DSK-005 | D | S |
| A5 | Capabilities: read `GET api/files/pdf/capabilities`; feed tool availability (server tools installed) into `tools.ts` gates and W08 rows | PDF-TOOL-006 | D, I, R | S |
| A6 | Apply Settings prefs: open target, start mode, author name, page cache; move the page into the Settings module | PDF-DSK-006 | R, D | M |
| A7 | Save-conflict "Compare" choice opens versions side by side (needs C1) | PDF-SAVE-006 | R | S |

### Phase B — Server additions the desktop needs (server team, in parallel)

| # | Task | Reqs | Size |
|---|---|---|---|
| B1 | `GET api/files/pdf/recent`, `GET …/active` | PDF-OPEN-002 | M |
| B2 | `GET api/admin/files/pdf/locks`; `POST …/lock/request`, `…/lock/watch` + notifications | PDF-ADM-002, PDF-COL-002 | M |
| B3 | Server tools under `api/files/{id}/pdf/tools/*` with `files.pdf.*` + policy + org job limit; `GET api/files/pdf/jobs`, cancel | F-05, PDF-TOOL-007/008 | L |
| B4 | `api/files/pdf/preferences`, `api/files/pdf/signatures` | PDF-DSK-006, PRO-FIL-002 | M |
| B5 | Tool registry + entitlement: `GET api/files/pdf/tools`, `pro` flag in session, `pdf_tool_runs`, 402 `PDF_PRO_REQUIRED` | PRO-ENT-001, PRO-FW-007 | L |
| B6 | Annotation index `GET …/pdf/annotations` | PDF-ANN-005 | M |

### Phase C — Desktop features on the existing engine (~4–6 weeks)

| # | Task | Reqs | Where | Size |
|---|---|---|---|---|
| C1 | Compare: two documents in one workspace, synced scroll, text diff from the engine text layer, report | PDF-TOOL-005, PRO-CMP-001…004 | D, R | L |
| C2 | Comment threads: replies (IRT), statuses, @mentions, filter/sort; arrow, polygon, cloud, callout, opacity | PDF-ANN-002, PRO-CMT-001…003 | D, R | L |
| C3 | Organize additions: duplicate, replace, split, page labels, "Changes in this session" list from the journal | PDF-ORG-002/005, PRO-ORG-001/003 | D, R | M |
| C4 | Combine into a new PDF (engine assemble op), bookmarks per file, TOC page, save to Drive folder | PRO-CMB-001…004 | D, R, I | M |
| C5 | Text-stamp op → Bates, header & footer, watermark (add/update/remove) | PRO-EDT-007, PRO-BAT-001/002 | D, R, I | M |
| C6 | Export pages as PNG/JPEG/TIFF and text from the engine | PRO-EXP-001 (std part) | D, R | S |
| C7 | Redaction marks + apply (remove text/vector/image under marks) + verification + sanitize | PDF-RED-001/003, PRO-RED-001…006 | D, R, I | L |
| C8 | AcroForm read/fill in the engine; required-field progress; image/initial signatures | PDF-FORM-001, PRO-FIL-001/002 | D, R, I | L |
| C9 | Start-up recovery dialog (`pdf:recoveryList`), offline copy cache + outbox list | PDF-DSK-003/004 | D, R, I | M |
| C10 | OS integration: file association, Open With, `open-file`/argv, default-app prompt, `worksuite://pdf/open` | PDF-OPEN-004/005 | D | M |
| C11 | Native menu entries and remaining shortcuts (Alt+1/2/3, Ctrl+R, Ctrl+\\), split view | PDF-DSK-002, PDF-OPEN-013 | D, R | M |
| C12 | Tray notifications for lock lost/request, job done, outbox uploaded | PDF-DSK-007 | D | S |
| C13 | Signature validation panel (pkijs over the engine's signature dictionaries) | PRO-CER-005 | D, R | M |

### Phase D — Server-backed Pro tools (after B3/B5)

| # | Task | Reqs | Size |
|---|---|---|---|
| D1 | Jobs page (W08) + OCR, compress, protect, PDF/A, convert/export runs from the panels | PDF-TOOL-001…004/007, PRO-OPT, PRO-PRT, PRO-EXP | M |
| D2 | Create PDF from Office / web page (server), images/text (device) | PRO-CRE-001…005 | L |
| D3 | Device OCR (tesseract eng/sin/tam in the worker) + invisible text layer + suspects correction | PRO-OCR-001…006 | L |
| D4 | Shared review (`api/files/{id}/pdf/reviews`) | PRO-REV-001…005 | L |
| D5 | AI Assistant (`api/files/{id}/pdf/ai/*`), citations highlight | PRO-AI-001…006 | M |
| D6 | Pro entitlement gating and seat badge from session flags | PRO-ENT-001/002 | S |

### Phase E — Heavy engine work and P4/P5 (quarters, not weeks)

E1 content editing (PRO-EDT-001…009; HarfBuzz/FreeType, Sinhala/Tamil shaping) · E2 e-signature agreements +
signing page + SIGNING lock (PRO-SGN-*) · E3 digital signing/certify/TSA (PRO-CER-001…004, keystore bridges) ·
E4 Prepare form + safe formula engine + mappings/responses (PRO-FRM-*) · E5 accessibility + standards (veraPDF)
(PRO-ACC, PRO-STD) · E6 print production + measure (PRO-PRP, PRO-MEA) · E7 Action wizard (PRO-ACT) ·
E8 libraries (PRO-LIB) · E9 scanner bridges (PRO-OCR-001) · E10 Edit text in Office round-trip (OFFICE lock).

## 6. Risks and decisions to take

- **Engine write ops** (C4, C5, C7, C8, E1) extend `pdfEditOpSchema` and the IPC contract: one MAJOR for `pdf`
  per batch; plan them together.
- **Recent and settings are local** until B1/B4 land; they do not follow the person across devices.
- **Pro badges are informational** until B5/D6: nothing is withheld by entitlement today.
- **Redaction find** runs the engine's regex search; the bank/card patterns are broad by design (review list
  before applying). Hits are masked on screen.
- **Signing as a mark** (W09 today) is an electronic signature mark only — no certificate, no witness record.
