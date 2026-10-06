/**
 * The Phone's IPC channels (the softphone's page policy, global shortcuts and notifications). Plain data, like
 * channels.ts, so the sandboxed preload can import it; spread into INVOKE_CHANNELS / EVENT_CHANNELS there. The
 * schemas and answers are in shared/phone.ts; the handlers in electron/services/phone.ts.
 */
export const PHONE_INVOKE_CHANNELS = ['phone:prepare', 'phone:shortcuts', 'phone:notify'] as const;

export const PHONE_EVENT_CHANNELS = ['phone:shortcut'] as const;
