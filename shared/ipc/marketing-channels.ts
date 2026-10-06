/**
 * Marketing's IPC channels (the next-contact shortcut and callback reminders, D01). Plain data, like channels.ts, so
 * the sandboxed preload can import it; spread into INVOKE_CHANNELS there. The schemas and answers are in
 * shared/marketing.ts; the handlers in electron/services/marketing.ts. The shortcut and a reminder's Call now open
 * `/marketing/queue?next=1` through the app's own navigation, so no event comes back to a page.
 */
export const MARKETING_INVOKE_CHANNELS = ['marketing:configure', 'marketing:refresh'] as const;
