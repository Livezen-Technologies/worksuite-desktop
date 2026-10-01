# ai — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

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
