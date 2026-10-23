# ai — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.12.0 — 2026-10-23

Built against the published desktop design boards D01–D10. Nine of the ten were already here; these are the gaps
that were real, and the places the designs were followed only as far as they were true.

**Added**

- **Edit a proposed change before confirming it** (boards D01, D06, D08). The card offered Confirm and Cancel and
  nothing in between, so a proposal that was nearly right could only be thrown away and asked for again. The server
  had been ready throughout — `PUT /api/ai/pending/{id}` validates changed arguments, supersedes the proposal and
  returns a new version to confirm — and only the client never called it. Edit opens the proposal's own arguments:
  the strings and numbers, since the desktop knows no tool's schema, with objects and lists sent back as the
  assistant built them and named under the form as left alone, together with the fact that an edit never changes
  which record the change is about. A field that arrived as a number goes back as a number.
- **"Local AI ready · <model> · works offline"** in the sidebar's footer and **"Local AI: Ready · <model>"** in the
  tray (boards D01, D02, D04–D06). Whether a model answers on this computer decides whether the assistant works on
  a plane, and it could only be learnt by opening Settings. Both use the same test the panel uses, so neither
  promises an offline answer from a computer that would go online instead; both say nothing when nothing is set up,
  and the strip is left out at icon width.
- **Language packs** in Settings › Local AI (board D10), with **Download** (`ai:ocrInstall`). The reading packs for
  English, Sinhala and Tamil were already real and pinned by size and SHA-256, but invisible and fetched from a CDN
  on the first picture that needed them — so reading Sinhala for the first time needed a connection, and whoever
  found that out was at a site with no signal. The list shows sizes and what is installed, and a pack can be
  fetched in advance by the same checked path as the automatic download.
- **The question named in the background notice** (board D02). "Your answer is ready" could not be matched to a
  question by somebody who had put the assistant down, changed tab and asked something else while it worked. It is
  withheld along with the answer while WorkSuite is locked.

**Changed**

- **Quick Ask says whether the text is replaced or inserted** (board D03): "Replace selection in Word" when the
  selection really was read, "Insert into Word" when Quick Ask opened with what was copied last and nothing is
  highlighted. The footer carries the guarantee that nothing is written back until it is clicked, which was stated
  only in Settings before.
- **Module Access says on the row when a module needs a server update** (board D05). The reason was on the cell's
  `title`, which a keyboard user never sees, a touch user cannot reach and a screen reader does not announce, so
  boxes that simply would not tick read as broken rather than as not there yet. The organisation columns carry it
  as `aria-description` too; the personal columns already did.

**Fixed**

- A card put the superseded proposal back on screen after an edit. It kept its own copy of what it had last done
  and compared it to the proposal it was given by id, so because an edit returns a *new* id the edited version was
  discarded — a saved edit looked as though it had done nothing while the server had already replaced it.

**Not built, on purpose**

- **The three-way "Which AI answers" selector** (Auto / Local only / Online only) on boards D01, D06 and D09. The
  WorkSuite AI / On this computer switch was removed deliberately in 1.3.0 for one "Allow online fallback" setting,
  and "Online only" does not exist in the app at all: local wins whenever a model can answer. Putting the selector
  back is a product decision, and its third state is a change to `AiPrefs`, not a relocation.
- **The L1–L3 risk ladder and the structured To / Subject / Attach preview** (boards D01, D06, D08). The card has
  two tiers — "Internal change" and "Reaches outside" — from the server's `risk`, and renders the server's own
  preview lines. Both are server contract changes.
- **Help & Guide and the image reader as workspace tabs** (boards D07, D08). Both live inside the assistant panel
  by an existing decision; moving them is a surface change, not a gap.
- **"Files from this computer" as a person's own switch** (board D09). It is a company and device rule today
  (`AiRules.localFiles`). Turning a policy gate into a user setting weakens it, and that is not a decision to take
  while matching a mock-up.
- **The ONNX Runtime panel and the Performance choice** (board D10). There is no ONNX runtime in the app and no
  catalogue that could offer those packs, so the panel would be false, the latencies would measure nothing, and a
  Performance setting no engine consulted would be a control that quietly does nothing.

## 1.11.0 — 2026-10-12

**Added**

- the brief task — a ticket's summary, key facts, next step and urgency under fixed headings, for Support's details drawer (#334)

## 1.10.0 — 2026-10-12

**Added**

- the subject task — a short helpdesk subject from a support conversation, used by Support's Suggest (#333)

## 1.9.1 — 2026-10-10

**Changed**

- the help catalogue describes the new Share dialog (#329)

## 1.9.0 — 2026-10-06

**Added**

- Help & Guide › Contact Support finished (WS-SUPPORT-SRS-001 D-11, FR-DSK-09): a real ticket at the help desk with its reference shown (Copy reference, Open the ticket); Question, Problem or Feature request; diagnostics the person sees and can untick — app version, operating system, current screen, and the last day's redacted log (help:logs, the newest 8 KB) — with View exact payload; Capture this window (help:capture) sent as files[]; offline the request waits in the outbox; My requests in Help & Guide and after sending (kept on this computer, with the desk's status for somebody who reads it)

## 1.8.7 — 2026-10-05

- Local AI downloads use the safe main-process fetch (#253)

## 1.8.6 — 2026-10-04

- AiMenuButton takes the composer's label (Writing assistant on website chats)

## 1.8.5 — 2026-10-03

- Keep the AI launcher and answer notice accessible beside the native Office editor without hiding the document indefinitely (#184).

## 1.8.4 — 2026-10-03

- More drafting tools for Mail: draft from notes, tone and length, coaching comments (ENH-MAIL-03).

## 1.8.3 — 2026-10-03

- Hide the floating launcher while a shared chat composer is visible (#156).

## 1.8.2 — 2026-10-03

- AI replies render their formatting — bold, italic, lists, headings, code, quotes and links (http/https only, never raw HTML); a long reply is shown from its first line instead of its end, with no blank gap above it; the assistant no longer reopens after every sign-in or unlock when 'Open at start-up' is on — only once per app run (#150).

## 1.8.1 — 2026-10-03

- An 'action items' task for Mail's AI chips.

## 1.8.0 — 2026-10-03

- The assistant tucks itself away while you keep working (#126): sending shows Thinking… at once; switching tabs, opening another module or clicking in the workspace while it works minimizes it to the floating button (never while you are typing in it, and never moving your focus); the button's tooltip reads Thinking…; when the answer is ready a compact preview shows its first lines with View Result and Dismiss, Needs your input names what is waiting, a failure offers Try again, and Stop processing sits beside the button; View Result or the button restores the conversation; a drawer can be minimized too; no answer text while locked.

## 1.7.1 — 2026-10-03

- Use the minimized floating Ask AI widget when no display preference is saved; preserve explicit display choices (#127).

## 1.7.0 — 2026-10-03

- Images in the AI Assistant (#59): upload, drag-and-drop and paste; thumbnails with preview and remove; PNG/JPEG/WebP/GIF/BMP checked by content, 10 MB each, 5 per message; Extract Text reads English, Sinhala and Tamil on this computer (language data ~5.5 MB downloaded once from cdn.jsdelivr.net, size and SHA-256 pinned) with Copy Text and uncertain/[unreadable] marking; image questions go online only to a server model verified to read images and only when online fallback is on, otherwise a card offers Extract Text, answering from the image's text locally, settings or Local AI setup; text in images is quoted as reference, never followed; Reading image → Extracting text → Preparing reply; Stop and failures put the question and images back, Try again resends.

## 1.6.0 — 2026-10-02

- Send optional interface reply language to the server and apply the selected default to local AI while preserving explicit language requests and user text (#60).

## 1.5.0 — 2026-10-02

**Added**

- the AI Assistant keeps working while minimised or while you use other apps (worksuite-desktop#110). The status says what it is doing (Thinking, Working, Needs your input, Complete, Failed) and where (on this computer or online AI). The launcher animates while it works, with the status as its tooltip. When the answer is ready it shows a badge and a small "Your answer is ready" notice with View reply. When it needs a confirmation or more details it shows "Needs your input" with Open Assistant. Neither notice takes the keyboard or opens the assistant. Stop processing and Try again are always there; with online AI, Stop stops waiting for the answer but does not cancel the request on the server. Minimize while working, and an optional Auto-minimize after sending. Notices respect notification settings and Do not disturb, and the animation respects reduced motion.

## 1.4.1 — 2026-10-02

- Keep ordinary first-turn questions unchanged while applying intent context to guidance, reporting, actions and topic changes after a guide (merge verification for #96).

## 1.4.0 — 2026-10-02

- Fix #96: separate reporting, how-to guidance and action requests; carry guide instructions only into relevant follow-ups and prioritize the latest topic.
- Both local AI and online fallback retrieve today’s authorized gross invoiced sales through the same server query, with separate currency totals, company, timezone, reporting basis and supporting invoice links. Denied/offline/unsupported data is an explicit limitation; no guide or invented total is substituted.

## 1.3.1 — 2026-10-01

- Drafted minutes (worksuite-desktop#80) list the agenda too, and their actions as what | who | when; the instruction forbids inventing decisions, people or dates, and parseAction keeps who and when only as the draft gives them.

## 1.3.0 — 2026-10-01

**Added**

- Help & Guide (#54): "How do I…?" questions are answered with step-by-step guides that ship with this version, with the menus and buttons named as they are on screen, instead of a refusal. Each answer has Open the screen and Show me, a walkthrough that highlights each control and changes nothing. The panel suggests guides for the app you are in, offers a search under Help & Guide, and says which permission an action needs when you lack it. Follow-up questions are answered from the guide, by the model on this computer first, in your app language (Show in … translates a guide). When no guide covers a question, it says so and offers Ask the assistant anyway, Contact Support or Report an Issue; a support request is shown in full and can be edited before it is sent. Each guide asks Was this helpful?
- One assistant (#52): the model on this computer answers when one is installed, and WorkSuite AI answers when it cannot (no model, a failure, or files and the tab, which only WorkSuite AI reads) and online fallback is allowed. The WorkSuite AI / On this computer switch is gone. A quiet "Processing locally" or "Using online AI" says which, and each answer is marked. What was said on this computer goes along when online AI takes over. A local run that already ran a WorkSuite function is never repeated online, and a module that is off or a missing permission is an answer, not a reason to go online. With neither available, it says why and offers Local AI's setup or Try again
- Local AI can use WorkSuite module functions (#51) — read data such as today's sales and prepare changes such as an invoice, which WorkSuite runs as you and you confirm on a card; it asks for missing details, links the records, and explains a module that is off, a missing permission or a function that is not there

**Changed**

- checkboxes use the shared WorkSuite checkbox — one size, the brand colour with a clear tick, a partly-chosen state on Select all, and ticking a row no longer opens it (#58)

## 1.2.0 — 2026-10-01

**Added**

- A readiness check for models on this computer (#55): once a download matches its checksum, the model is loaded and asked for a word, and shows "Ready to use" only once it answered; a file this llama.cpp cannot run says why (with Test again) and is never used to answer. What the check found is remembered per model version
- "Set up your AI Assistant" (#49): shown the first time the assistant opens with no model on this computer that can answer; the model's name, download size and the free space it needs; the computer checked first (not enough space blocks it and says how much is needed; too little memory is a warning); Download and Set Up and Not Now (a week); the stages Downloading → Verifying → Preparing AI → Ready with percentage, size and time left; pause, cancel, resume and try again; errors that say what to do (connection, space, a file that did not match, a model that would not run); the setup carries on with the panel closed and is there on reopening; "Your AI Assistant is ready to use" with Start Chatting, which switches to On this computer; nothing offered once a model can answer. When no model fits the computer, the smallest is still offered, with the warning
- First-use Local AI setup in the assistant: while nothing is set up on this computer, the model that suits it (Gemma 3 4B when the server offers it) with its version, download size, memory it needs and licence notice, and one Download and set up button, with progress, pause, cancel, resume and try again
- The licence notice a model's terms require (the catalog's `notice`) is shown before and after download

**Fixed**

- The AI Assistant's conversation follows new messages and streaming answers while you are at the end, in both WorkSuite AI and On this computer; it stays where you scrolled up to, with a Jump to latest button when something new arrives below, and follows again when you come back or send a message; loaded images and a resized panel no longer hide the end behind the box, and Quick Ask keeps its box in place (#50)

## 1.1.0 — 2026-09-30

**Added**

- the conversation is kept outside the panel (session.ts): the drawer and the floating widget show the same one, and closing, minimising or switching loses no message, draft, file or answer on its way (#61)
- New conversation, once there is one (#61)
- Try again on a failed answer asks the same question once more in its place (#43)

**Changed**

- Thinking… with the sparkle pulsing (a still icon under reduced motion) replaces Looking into it…, from the question until the answer starts to show; a streaming answer is not read out word by word (#43)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
