/**
 * WorkSuite Sales' IPC channels (approvals from a banner, printing labels and delivery notes on this computer's
 * printers, reports saved as PDF). Plain data, like channels.ts, so the sandboxed preload can import it; spread into
 * INVOKE_CHANNELS there. The schemas and answers are in shared/sales.ts; the handlers in electron/services/sales-desk.ts.
 */
export const SALES_INVOKE_CHANNELS = ['sales:printSettings', 'sales:printSettingsSet', 'sales:printNote', 'sales:printLabel', 'sales:saveReport', 'sales:reveal'] as const;
