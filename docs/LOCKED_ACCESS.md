# Calls and chat during app lock (#112)

Security → Access While Locked controls answering calls (on by default), showing caller details (off), and plain text chat (off). Incoming calls use separate windows; answering while locked starts with the camera off. Mute, sound, devices, explicit camera enablement, and ending the call remain available. Sound follows notification sound and Do Not Disturb settings.

Existing calls stay mounted when WorkSuite locks. Local screen sharing stops. Chat opens in a separate restricted window, hides history until explicitly requested, and displays text without clickable links or attachments. Unlock is required for files, linked records, screen sharing, remote control, and other modules. Unlock refreshes cached queries to restore normal workspace state.

The main process checks the owned window kind, original route, call UUID, room, HTTP method, and text-send fields. It refuses unrelated API requests and privileged IPC while locked. Pending display capture is checked again after sources resolve. Locked realtime delivery is limited to the current call's stopped event.

Organization desktop policy can disable `locked_answer_calls`, `locked_show_caller_details`, or `locked_allow_chat`. Normalization preserves these restrictions, effective preferences clamp user choices, and Security shows managed controls. Generic notification privacy also hides caller details.

These options apply to the WorkSuite app lock. They do not provide interaction through the operating system lock screen; OS authentication is still required.

Verification includes scoped API/IPC security, preferences and policy, restricted chat UI, existing call and lock behavior, display capture races, and a real offscreen Electron custom-protocol check. Live multi-device calls, camera/device switching, and OS lock transitions still require physical-device testing.

## Notifications during app lock (#114)

The lock never stops notifications: realtime, the missed-notification poll, the tray/taskbar badge and the macOS Dock badge (a `whileLocked` IPC) all keep running in the main process. While locked, a message banner says only “New message in WorkSuite.” unless Security › Access While Locked allows the sender's name and/or a preview, never more than Notifications › What banners show and the organization's `notification_min_privacy` allow; other banners stay generic. Muted conversations, the Chat switch, pause and Do Not Disturb apply as usual (urgent messages pass DND, without content).

Clicking a conversation's banner opens the restricted chat window when Allow Chat is on. Otherwise WorkSuite shows the lock screen and opens the banner's destination after a successful unlock; a link that would open in the browser just shows the lock screen.

After sleep or a dropped socket, a connection that went silent is replaced on resume, and the resync announces what was missed: server notifications from the last 15 minutes and unread chat messages since the gap (unmuted conversations, at most 3 per conversation), deduplicated by notification id or `chat:<message id>` against what was already shown, across lock and unlock.

Electron cannot read the operating system's per-app notification permission on macOS or Windows. Notifications › This computer says so and names the settings to check; when the system refused the last banner (macOS, Windows report this), it shows that error, and an unsupported system says it cannot show notifications.
