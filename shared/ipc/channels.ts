/**
 * The IPC allow-list (§3.4). Only these channels are registered in the main
 * process and only these can be reached from the preload. This file is plain
 * data so the sandboxed preload can import it without pulling in zod.
 */
export const INVOKE_CHANNELS = [
  'app:info',
  'app:quit',
  'app:relaunch',
  'app:openExternal',
  'app:openInBrowser',
  'app:setDockIcon',

  'auth:state',
  'auth:setServer',
  'auth:signIn',
  'auth:verifyMfa',
  'auth:cancelMfa',
  'auth:passkeyStart',
  'auth:passkeyCancel',
  'auth:signOut',
  'auth:completeSetup',

  'session:bootstrap',
  'session:refresh',
  'session:switchOrganization',

  'windows:open',
  'windows:setAlwaysOnTop',
  'windows:setCompact',
  'windows:minimize',
  'windows:toggleMaximize',
  'windows:close',
  'windows:state',

  'tabs:save',
  'tabs:restore',

  'files:pickFiles',
  'files:pickFolder',
  'files:registerDropped',
  'files:chooseDownloadFolder',

  'hr:clock',
  'hr:break',
  'media:access',
  'media:screenSources',
  'media:screenPick',
  'media:privacySettings',
  'calls:active',
  'transfers:list',
  'transfers:download',
  'transfers:upload',
  'transfers:pause',
  'transfers:resume',
  'transfers:cancel',
  'transfers:retry',
  'transfers:open',
  'transfers:reveal',
  'transfers:clearFinished',

  'notifications:list',
  'notifications:markRead',
  'notifications:markAllRead',
  'notifications:pause',
  'notifications:test',

  'clipboard:readForPaste',

  'print:print',
  'print:printers',
  'print:toPdf',

  'offline:status',
  'offline:pending',
  'offline:submit',
  'offline:retry',
  'offline:discard',
  'offline:saveDraft',
  'offline:getDraft',
  'offline:listDrafts',
  'offline:deleteDraft',
  'offline:search',
  'offline:clearCache',

  'security:lock',
  'security:unlockPassword',
  'security:unlockBiometric',
  'security:state',
  'security:deviceInfo',
  'security:activity',

  'updates:status',
  'updates:check',
  'updates:installNow',
  'updates:restartLater',
  'updates:setChannel',
  'updates:setActiveCall',
  'updates:busy',

  'settings:get',
  'settings:set',

  'status:snapshot',

  'diagnostics:run',
  'diagnostics:previewBundle',
  'diagnostics:saveBundle',
  'diagnostics:restartSafeMode',
  'diagnostics:services',
] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

/** Events the main process pushes to renderers. */
export const EVENT_CHANNELS = [
  'auth:changed',
  'session:changed',
  'status:changed',
  'navigate',
  'toast',
  'command',
  'notifications:changed',
  'notification:clicked',
  'realtime:event',
  'realtime:resync',
  'transfers:changed',
  'offline:changed',
  'lock:changed',
  'update:changed',
  'settings:changed',
  'organization:changed',
  'windows:changed',
] as const;

export type EventChannel = (typeof EVENT_CHANNELS)[number];
