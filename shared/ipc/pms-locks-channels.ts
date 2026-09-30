/**
 * Hotel PMS door locks' IPC channels (the on-site lock server this front desk talks to). Plain data, like
 * channels.ts, so the sandboxed preload can import it; spread into INVOKE_CHANNELS there. The schemas and answers
 * are in shared/pms-locks.ts; the handlers in electron/services/pms-locks/index.ts.
 */
export const PMS_LOCKS_INVOKE_CHANNELS = ['pmsLocks:config', 'pmsLocks:configSet', 'pmsLocks:forget', 'pmsLocks:test', 'pmsLocks:run', 'pmsLocks:status'] as const;
