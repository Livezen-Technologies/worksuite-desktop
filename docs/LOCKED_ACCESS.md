# Calls and chat during app lock (#112)

Security → Access While Locked controls answering calls (on by default), showing caller details (off), and plain text chat (off). Incoming calls use separate windows; answering while locked starts with the camera off. Mute, sound, devices, explicit camera enablement, and ending the call remain available. Sound follows notification sound and Do Not Disturb settings.

Existing calls stay mounted when WorkSuite locks. Local screen sharing stops. Chat opens in a separate restricted window, hides history until explicitly requested, and displays text without clickable links or attachments. Unlock is required for files, linked records, screen sharing, remote control, and other modules. Unlock refreshes cached queries to restore normal workspace state.

The main process checks the owned window kind, original route, call UUID, room, HTTP method, and text-send fields. It refuses unrelated API requests and privileged IPC while locked. Pending display capture is checked again after sources resolve. Locked realtime delivery is limited to the current call's stopped event.

Organization desktop policy can disable `locked_answer_calls`, `locked_show_caller_details`, or `locked_allow_chat`. Normalization preserves these restrictions, effective preferences clamp user choices, and Security shows managed controls. Generic notification privacy also hides caller details.

These options apply to the WorkSuite app lock. They do not provide interaction through the operating system lock screen; OS authentication is still required.

Verification includes scoped API/IPC security, preferences and policy, restricted chat UI, existing call and lock behavior, display capture races, and a real offscreen Electron custom-protocol check. Live multi-device calls, camera/device switching, and OS lock transitions still require physical-device testing.
