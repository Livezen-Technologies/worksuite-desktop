# chat — changelog

This desktop module's own versions, newest first (docs/MODULES.md). MAJOR: another module, the server contract or
a saved offline shape has to change with it. MINOR: something new. PATCH: a fix. The app's release notes stay in
the root CHANGELOG.md.

## 1.1.0 — 2026-09-30

**Added**

- A channel toolbar down the far left of Chat (#33): Chat, Web Chat and WhatsApp, each with its unread (or waiting) count, a warning when a number is not connected, and "Add a channel". Picking a channel shows its conversations in the list; ↑ ↓ Home End move along it, and it stays when the list is hidden
- WhatsApp conversations in Chat: the numbers shared with you, the list (All, Unread, Waiting, Mine, a number picker, search), the thread, and a reply box whose draft is kept per conversation. It says why a reply cannot be sent (a viewer's access, the 24-hour window, a number that is not connected)
- "Add a channel": where WhatsApp and Web Chat stand for you; connect a WhatsApp number by QR code, or link a disconnected one again; set up the website widget or a Business Platform number on the web
- Profile pictures in Chat (#37): people's current pictures in the conversation list, the conversation's header, beside their messages, in the details, the member lists, the new-conversation picker and @-mentions; the initials (on the colour that name always has) when there is none, it fails to load, or its owner does not show it to you. A changed picture shows without signing out. Groups keep their rounded-square initials. A WhatsApp contact's picture shows when the server sends one
- The conversation list can be made wider or narrower by dragging its edge, or with the arrow keys once the edge is focused; it stays between 240 px and 560 px, is remembered on this computer, and a double-click (or Enter) puts it back to 300 px (#34)

## 1.0.0 — 2026-09-30

- The baseline: the module as it stood when each module began to carry its own version. Its history before this is in the app's CHANGELOG.md.
