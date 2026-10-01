# ai — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.1.0 — 2026-09-30

**Added**

- the conversation is kept outside the panel (session.ts): the drawer and the floating widget show the same one, and closing, minimising or switching loses no message, draft, file or answer on its way (#61)
- New conversation, once there is one (#61)
- Try again on a failed answer asks the same question once more in its place (#43)

**Changed**

- Thinking… with the sparkle pulsing (a still icon under reduced motion) replaces Looking into it…, from the question until the answer starts to show; a streaming answer is not read out word by word (#43)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
