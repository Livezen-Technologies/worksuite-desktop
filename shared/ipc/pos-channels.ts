/**
 * POS's IPC channels (the till: pairing, its catalogue and sales, printing, the customer display). Plain data, like
 * channels.ts, so the sandboxed preload can import it; spread into INVOKE_CHANNELS / EVENT_CHANNELS there. The
 * schemas and answers are in shared/pos.ts; the handlers in electron/services/pos-ipc.ts.
 */
export const POS_INVOKE_CHANNELS = [
  'pos:till',
  'pos:pair',
  'pos:forget',
  'pos:catalogue',
  'pos:catalogueRefresh',
  'pos:tillSettings',
  'pos:tillSettingsSet',
  'pos:sell',
  'pos:sales',
  'pos:sale',
  'pos:syncNow',
  'pos:resolve',
  'pos:printSettings',
  'pos:printSettingsSet',
  'pos:printReceipt',
  'pos:receipt',
  'pos:giveBack',
  'pos:email',
  'pos:printReport',
  'pos:printTest',
  'pos:openDrawer',
  'pos:displayOpen',
  'pos:displayClose',
  'pos:carts',
  'pos:cartsSave',
  'pos:desk',
  'pos:approve',
  'pos:rename',
] as const;

export const POS_EVENT_CHANNELS = ['pos:changed'] as const;
