/**
 * Sinhala Tools' IPC channels (WorkSuite Desktop Sinhala Tools blueprint §6.2). Plain data, like channels.ts, so the
 * sandboxed preload can import it; spread into INVOKE_CHANNELS / EVENT_CHANNELS there. The schemas and answers are in
 * shared/sinhala.ts; the handlers in electron/services/sinhala.ts.
 */
export const SINHALA_INVOKE_CHANNELS = [
  'sinhala:status',
  'sinhala:detect',
  'sinhala:convert',
  'sinhala:convertFile',
  'sinhala:job',
  'sinhala:jobAccept',
  'sinhala:jobReject',
  'sinhala:profiles',
  'sinhala:fontsStatus',
  'sinhala:fontsInstall',
  'sinhala:clipboard',
  'sinhala:settings',
  'sinhala:settingsSet',
  'sinhala:convertDocx',
  'sinhala:registerDropped',
  'sinhala:pickFile',
  'sinhala:reveal',
] as const;

/** `sinhala:changed`: availability, profiles, settings or a job moved on — the window asks again. */
export const SINHALA_EVENT_CHANNELS = ['sinhala:changed'] as const;
