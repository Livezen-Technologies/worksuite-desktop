/**
 * WorkSuite Label Studio's IPC channels (WS-LABEL-SRS-001 FR-DSK-03, §16): the four printing calls — the printers,
 * send, status, cancel — plus D04's discovery and settings, D05's reconciliation and the Print Gateway (D06, D07).
 * Plain data, like channels.ts, so the sandboxed preload can import it. The schemas and answers are in
 * shared/label.ts; the handlers in electron/services/label/.
 */
export const LABEL_INVOKE_CHANNELS = [
  'label:listPrinters',
  'label:send',
  'label:status',
  'label:cancel',
  'label:discover',
  'label:settings',
  'label:settingsSet',
  'label:register',
  'label:resolve',
  'labelGateway:status',
  'labelGateway:pair',
  'labelGateway:unpair',
  'labelGateway:headless',
] as const;

export const LABEL_EVENT_CHANNELS = ['label:changed', 'labelGateway:changed'] as const;
