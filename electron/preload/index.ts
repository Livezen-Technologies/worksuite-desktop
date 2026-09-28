import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { EVENT_CHANNELS, INVOKE_CHANNELS, type EventChannel, type InvokeChannel } from '@shared/ipc/channels';

/**
 * The only bridge between the sandboxed renderer and the desktop (§3.3, §8.4).
 *
 * It exposes typed, namespaced functions — never ipcRenderer itself, never a
 * generic "send anything" — and every call lands on an allow-listed channel
 * that the main process validates again. There is no fs, no child_process,
 * no shell, no paths from web content: files are referred to by handles the
 * main process issued, or by File objects from a real drop.
 */

const invokable = new Set<string>(INVOKE_CHANNELS);
const listenable = new Set<string>(EVENT_CHANNELS);

function invoke(channel: InvokeChannel, payload?: unknown): Promise<unknown> {
  if (!invokable.has(channel)) return Promise.reject(new Error('unknown channel'));
  return ipcRenderer.invoke(channel, payload);
}

const call =
  (channel: InvokeChannel) =>
  (payload?: unknown): Promise<unknown> =>
    invoke(channel, payload);

function on(channel: EventChannel, cb: (payload: unknown) => void): () => void {
  if (!listenable.has(channel)) throw new Error('unknown event');
  const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// Presence only — the time of the last interaction, for the app-lock timer.
// No key, character or position is read or sent (FR-MON-11 applies to the
// shell as much as to the monitoring agent).
let lastActivitySent = 0;
function activity(): void {
  const now = Date.now();
  if (now - lastActivitySent < 20_000) return;
  lastActivitySent = now;
  void invoke('security:activity');
}
for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
  window.addEventListener(type, activity, { capture: true, passive: true });
}

const api = {
  platform: process.platform,
  // Set only for unpackaged test runs (the window manager passes it).
  e2e: process.argv.includes('--ws-e2e'),
  app: {
    info: call('app:info'),
    quit: call('app:quit'),
    relaunch: call('app:relaunch'),
    openExternal: call('app:openExternal'),
    openInBrowser: call('app:openInBrowser'),
    setDockIcon: call('app:setDockIcon'),
  },
  auth: {
    state: call('auth:state'),
    setServer: call('auth:setServer'),
    signIn: call('auth:signIn'),
    verifyMfa: call('auth:verifyMfa'),
    cancelMfa: call('auth:cancelMfa'),
    passkeyStart: call('auth:passkeyStart'),
    passkeyCancel: call('auth:passkeyCancel'),
    signOut: call('auth:signOut'),
    completeSetup: call('auth:completeSetup'),
    sessionId: call('auth:sessionId'),
    changePassword: call('auth:changePassword'),
    renewMfa: call('auth:renewMfa'),
    renewCancel: call('auth:renewCancel'),
  },
  session: {
    bootstrap: call('session:bootstrap'),
    refresh: call('session:refresh'),
    switchOrganization: call('session:switchOrganization'),
  },
  windows: {
    open: call('windows:open'),
    setAlwaysOnTop: call('windows:setAlwaysOnTop'),
    setCompact: call('windows:setCompact'),
    fitVideo: call('windows:fitVideo'),
    minimize: call('windows:minimize'),
    toggleMaximize: call('windows:toggleMaximize'),
    close: call('windows:close'),
    state: call('windows:state'),
    detach: call('windows:detach'),
    dock: call('windows:dock'),
    adopt: call('windows:adopt'),
    describe: call('windows:describe'),
    restoreDetached: call('windows:restoreDetached'),
  },
  tabs: {
    save: call('tabs:save'),
    restore: call('tabs:restore'),
  },
  files: {
    pickFiles: call('files:pickFiles'),
    pickFolder: call('files:pickFolder'),
    chooseDownloadFolder: call('files:chooseDownloadFolder'),
    saveText: call('files:saveText'),
    /** Files from a real drag & drop or <input type=file>: converted to handles in main. */
    registerDropped: (files: File[]): Promise<unknown> => {
      const paths = Array.from(files)
        .map((f) => webUtils.getPathForFile(f))
        .filter((p) => typeof p === 'string' && p.length > 0);
      if (paths.length === 0) return Promise.resolve([]);
      return invoke('files:registerDropped', { paths });
    },
  },
  hr: {
    clock: call('hr:clock'),
    break: call('hr:break'),
  },
  media: {
    access: call('media:access'),
    screenSources: call('media:screenSources'),
    screenPick: call('media:screenPick'),
    privacySettings: call('media:privacySettings'),
  },
  calls: {
    active: call('calls:active'),
    list: call('calls:list'),
    focus: call('calls:focus'),
  },
  rc: {
    state: call('rc:state'),
    setAllowRequests: call('rc:setAllowRequests'),
    shareStarted: call('rc:shareStarted'),
    shareChanged: call('rc:shareChanged'),
    shareStopped: call('rc:shareStopped'),
    sharePaused: call('rc:sharePaused'),
    packet: call('rc:packet'),
    consent: call('rc:consent'),
    answer: call('rc:answer'),
    pause: call('rc:pause'),
    resume: call('rc:resume'),
    stop: call('rc:stop'),
    fileAnswer: call('rc:fileAnswer'),
    sendFile: call('rc:sendFile'),
    takeFile: call('rc:takeFile'),
  },
  transfers: {
    list: call('transfers:list'),
    download: call('transfers:download'),
    upload: call('transfers:upload'),
    pause: call('transfers:pause'),
    resume: call('transfers:resume'),
    cancel: call('transfers:cancel'),
    retry: call('transfers:retry'),
    open: call('transfers:open'),
    reveal: call('transfers:reveal'),
    clearFinished: call('transfers:clearFinished'),
  },
  sync: {
    status: call('sync:status'),
    devices: call('sync:devices'),
    deviceAction: call('sync:deviceAction'),
    add: call('sync:add'),
    remove: call('sync:remove'),
    setMode: call('sync:setMode'),
    pause: call('sync:pause'),
    now: call('sync:now'),
    resolve: call('sync:resolve'),
    reveal: call('sync:reveal'),
    lookup: call('sync:lookup'),
    reconnect: call('sync:reconnect'),
  },
  notifications: {
    list: call('notifications:list'),
    markRead: call('notifications:markRead'),
    markAllRead: call('notifications:markAllRead'),
    pause: call('notifications:pause'),
    test: call('notifications:test'),
    refresh: call('notifications:refresh'),
  },
  clipboard: {
    readForPaste: call('clipboard:readForPaste'),
  },
  print: {
    print: call('print:print'),
    printers: call('print:printers'),
    toPdf: call('print:toPdf'),
  },
  salon: {
    deskPairing: call('salon:deskPairing'),
    deskPair: call('salon:deskPair'),
    deskForget: call('salon:deskForget'),
    printSettings: call('salon:printSettings'),
    printSettingsSet: call('salon:printSettingsSet'),
    printReceipt: call('salon:printReceipt'),
    printTest: call('salon:printTest'),
    printPage: call('salon:printPage'),
    openDrawer: call('salon:openDrawer'),
  },
  offline: {
    status: call('offline:status'),
    pending: call('offline:pending'),
    submit: call('offline:submit'),
    retry: call('offline:retry'),
    discard: call('offline:discard'),
    saveDraft: call('offline:saveDraft'),
    getDraft: call('offline:getDraft'),
    listDrafts: call('offline:listDrafts'),
    deleteDraft: call('offline:deleteDraft'),
    search: call('offline:search'),
    clearCache: call('offline:clearCache'),
  },
  security: {
    lock: call('security:lock'),
    unlockPassword: call('security:unlockPassword'),
    unlockBiometric: call('security:unlockBiometric'),
    state: call('security:state'),
    deviceInfo: call('security:deviceInfo'),
  },
  updates: {
    status: call('updates:status'),
    check: call('updates:check'),
    installNow: call('updates:installNow'),
    restartLater: call('updates:restartLater'),
    setChannel: call('updates:setChannel'),
    setActiveCall: call('updates:setActiveCall'),
    busy: call('updates:busy'),
  },
  settings: {
    get: call('settings:get'),
    set: call('settings:set'),
  },
  status: {
    snapshot: call('status:snapshot'),
  },
  diagnostics: {
    run: call('diagnostics:run'),
    previewBundle: call('diagnostics:previewBundle'),
    saveBundle: call('diagnostics:saveBundle'),
    restartSafeMode: call('diagnostics:restartSafeMode'),
    services: call('diagnostics:services'),
  },
  events: { on },
};

contextBridge.exposeInMainWorld('worksuite', api);

export type WorksuiteBridge = typeof api;
