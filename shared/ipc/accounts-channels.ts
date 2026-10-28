/**
 * Accounts, connect, browser sign-in and WorkSuite Cloud IPC channels (Connection & Startup). Plain data, like
 * channels.ts, so the sandboxed preload can import it; spread into INVOKE_CHANNELS / EVENT_CHANNELS there. The
 * schemas and answers are in shared/accounts.ts; the handlers are registered by electron/main/accounts-wiring.ts
 * (accounts), electron/services/discovery/handlers.ts (connect) and electron/services/cloud/handlers.ts (signin, cloud).
 */
export const ACCOUNTS_INVOKE_CHANNELS = [
  'accounts:state',
  'accounts:switch',
  'accounts:startupChoice',
  'accounts:setChooser',
  'accounts:unsynced',
  'accounts:syncNow',
  'accounts:exportUnsynced',
  'accounts:discardUnsynced',
  'accounts:signOut',
  'accounts:remove',
  'accounts:health',
  'accounts:rediscover',
  'accounts:addStart',
  'accounts:addCancel',
  'connect:start',
  'connect:get',
  'connect:cancel',
  'connect:confirm',
  'connect:parseSetup',
  'connect:copyDetails',
  'signin:start',
  'signin:reopen',
  'signin:copyLink',
  'signin:cancel',
  'signup:start',
  'signup:resend',
  'signup:verify',
  'signup:cancel',
  'cloud:status',
  'cloud:refresh',
  'cloud:resendVerification',
  'cloud:retryProvisioning',
  'cloud:storage',
  'cloud:plans',
  'cloud:openWeb',
] as const;

export const ACCOUNTS_EVENT_CHANNELS = ['accounts:changed', 'accounts:unknownLink', 'connect:progress', 'signin:changed', 'cloud:changed'] as const;

export type AccountsInvokeChannel = (typeof ACCOUNTS_INVOKE_CHANNELS)[number];
export type AccountsEventChannel = (typeof ACCOUNTS_EVENT_CHANNELS)[number];
