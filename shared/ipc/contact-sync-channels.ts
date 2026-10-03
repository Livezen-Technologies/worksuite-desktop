/**
 * Contact sync's IPC channels (iCloud, CardDAV and Mac Contacts on this computer, worksuite-desktop#175). Plain data,
 * like channels.ts, so the sandboxed preload can import it; spread into INVOKE_CHANNELS there. The schemas are in
 * shared/contact-sync.ts; the handlers in electron/services/contact-sync/index.ts.
 */
export const CONTACT_SYNC_INVOKE_CHANNELS = ['contactSync:status', 'contactSync:connect', 'contactSync:run', 'contactSync:setPassword', 'contactSync:forget', 'contactSync:macAccess'] as const;
