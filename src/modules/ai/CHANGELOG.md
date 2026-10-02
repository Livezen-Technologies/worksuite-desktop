# ai — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.5.0 — 2026-10-02

- Send optional interface reply language to the server and apply the selected default to local AI while preserving explicit language requests and user text (#60).

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
