import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { EVENT_CHANNELS, INVOKE_CHANNELS, type EventChannel, type InvokeChannel } from '@shared/ipc/channels';
import { applyAppearance, type AppearancePrefs } from '@shared/theme-profiles';

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

/**
 * The colour profile before the first paint (worksuite-desktop#234): asked for once, synchronously, and written onto
 * the page as soon as it has a root element — before its stylesheet, its scripts or anything is drawn — so no window
 * flashes the default colours on its way to the person's. Changes after this arrive as `appearance:changed`.
 */
function appearanceFirst(): void {
  let look: AppearancePrefs | null = null;
  try {
    look = ipcRenderer.sendSync('appearance:initial') as AppearancePrefs | null;
  } catch {
    return;
  }
  if (!look || typeof look !== 'object') return;
  const apply = () => {
    try {
      applyAppearance(document, look, typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch {
      // The page's own start applies it a moment later.
    }
  };
  if (document.documentElement) return apply();
  const watch = new MutationObserver(() => {
    if (!document.documentElement) return;
    watch.disconnect();
    apply();
  });
  watch.observe(document, { childList: true });
}
appearanceFirst();

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
  local: { enter: call('local:enter'), leave: call('local:leave'), status: call('local:status'), profile: call('local:profile'), unlock: call('local:unlock'), api: call('local:api'), overview: call('local:overview'), export: call('local:export'), restorePreview: call('local:restorePreview'), restore: call('local:restore'), deleteAll: call('local:deleteAll'), meeting: call('local:meeting'), joinMeeting: call('local:joinMeeting'), moveOffer: call('local:moveOffer'), move: call('local:move'), keep: call('local:keep') },
  // Item links opened in the app go on the audit trail (#170).
  links: { audit: call('links:audit') },
  guest: { pending: call('guest:pending'), open: call('guest:open'), info: call('guest:info'), join: call('guest:join'), signIn: call('guest:signIn') },
  auth: {
    state: call('auth:state'),
    setServer: call('auth:setServer'),
    signIn: call('auth:signIn'),
    verifyMfa: call('auth:verifyMfa'),
    cancelMfa: call('auth:cancelMfa'),
    passkeyStart: call('auth:passkeyStart'),
    passkeyCancel: call('auth:passkeyCancel'),
    openPage: call('auth:openPage'),
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
    toMain: call('windows:toMain'),
    adopt: call('windows:adopt'),
    describe: call('windows:describe'),
    restoreDetached: call('windows:restoreDetached'),
  },
  quickask: {
    context: call('quickask:context'),
    open: call('quickask:open'),
    insert: call('quickask:insert'),
    close: call('quickask:close'),
    handoff: call('quickask:handoff'),
  },
  ai: {
    rules: call('ai:rules'),
    confirm: call('ai:confirm'),
    upload: call('ai:upload'),
    answerReady: call('ai:answerReady'),
    // Local AI (WS-SRS-LAI): the models on this computer, the runtime, and asking the default model.
    localStatus: call('ai:localStatus'),
    localModels: call('ai:localModels'),
    localRefresh: call('ai:localRefresh'),
    localInstall: call('ai:localInstall'),
    localCancelInstall: call('ai:localCancelInstall'),
    localRemove: call('ai:localRemove'),
    localSetDefault: call('ai:localSetDefault'),
    localCheck: call('ai:localCheck'),
    localTest: call('ai:localTest'),
    localAsk: call('ai:localAsk'),
    localCancel: call('ai:localCancel'),
    localRestart: call('ai:localRestart'),
    ocr: call('ai:ocr'),
    ocrCancel: call('ai:ocrCancel'),
    ocrStatus: call('ai:ocrStatus'),
  },
  ring: {
    state: call('ring:state'),
    join: call('ring:join'),
    silence: call('ring:silence'),
    pass: call('ring:pass'),
    test: call('ring:test'),
    joinSend: call('ring:joinSend'),
    reply: call('ring:reply'),
    closeJoined: call('ring:closeJoined'),
    minimise: call('ring:minimise'),
    fit: call('ring:fit'),
    openInbox: call('ring:openInbox'),
    outcome: call('ring:outcome'),
    draft: call('ring:draft'),
    trayFit: call('ring:trayFit'),
    tray: call('ring:tray'),
    followUp: call('ring:followUp'),
    viewing: call('ring:viewing'),
    handoff: call('ring:handoff'),
    call: call('ring:call'),
    mic: call('ring:mic'),
    onCall: call('ring:onCall'),
  },
  realtime: {
    watch: call('realtime:watch'),
    receipt: call('realtime:receipt'),
  },
  live: {
    open: call('live:open'),
    info: call('live:info'),
    wall: call('live:wall'),
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
    screenIndicator: call('media:screenIndicator'),
    screenSources: call('media:screenSources'),
    screenPick: call('media:screenPick'),
    privacySettings: call('media:privacySettings'),
    // Settings › Meet › System permissions, and what the camera sends on battery (D05).
    permissions: call('media:permissions'),
    power: call('media:power'),
  },
  calls: {
    active: call('calls:active'),
    list: call('calls:list'),
    focus: call('calls:focus'),
  },
  meetrec: {
    preflight: call('meetrec:preflight'),
    start: call('meetrec:start'),
    active: call('meetrec:active'),
    abort: call('meetrec:abort'),
    chunk: call('meetrec:chunk'),
    stop: call('meetrec:stop'),
    list: call('meetrec:list'),
    retry: call('meetrec:retry'),
    discard: call('meetrec:discard'),
    reveal: call('meetrec:reveal'),
    chooseFolder: call('meetrec:chooseFolder'),
    open: call('meetrec:open'),
    downloads: call('meetrec:downloads'),
  },
  stt: {
    status: call('stt:status'),
    chooseModel: call('stt:chooseModel'),
    removeModel: call('stt:removeModel'),
    transcribe: call('stt:transcribe'),
  },
  speech: {
    ready: call('speech:ready'),
    result: call('speech:result'),
  },
  rc: {
    state: call('rc:state'),
    recheck: call('rc:recheck'),
    restart: call('rc:restart'),
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
    prepareMedia: call('transfers:prepareMedia'),
    pause: call('transfers:pause'),
    resume: call('transfers:resume'),
    cancel: call('transfers:cancel'),
    retry: call('transfers:retry'),
    open: call('transfers:open'),
    reveal: call('transfers:reveal'),
    clearFinished: call('transfers:clearFinished'),
    pauseAll: call('transfers:pauseAll'),
    resumeAll: call('transfers:resumeAll'),
    resetSettings: call('transfers:resetSettings'),
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
    conflicts: call('sync:conflicts'),
    resolveConflict: call('sync:resolveConflict'),
  },
  image: {
    localInfo: call('image:localInfo'),
    localRead: call('image:localRead'),
    localSave: call('image:localSave'),
    openSystem: call('image:openSystem'),
    prepareDrag: call('image:prepareDrag'),
    startDrag: call('image:startDrag'),
    cacheGet: call('image:cacheGet'),
    cachePut: call('image:cachePut'),
    saveAs: call('image:saveAs'),
  },
  notifications: {
    list: call('notifications:list'),
    markRead: call('notifications:markRead'),
    markAllRead: call('notifications:markAllRead'),
    pause: call('notifications:pause'),
    test: call('notifications:test'),
    permission: call('notifications:permission'),
    openSettings: call('notifications:openSettings'),
    refresh: call('notifications:refresh'),
    reminder: call('notifications:reminder'),
  },
  clipboard: {
    readForPaste: call('clipboard:readForPaste'),
  },
  print: {
    print: call('print:print'),
    printers: call('print:printers'),
    toPdf: call('print:toPdf'),
  },
  pdf: {
    open: call('pdf:open'),
    state: call('pdf:state'),
    unlock: call('pdf:unlock'),
    retry: call('pdf:retry'),
    close: call('pdf:close'),
    render: call('pdf:render'),
    thumbnail: call('pdf:thumbnail'),
    cancel: call('pdf:cancel'),
    search: call('pdf:search'),
    searchCancel: call('pdf:searchCancel'),
    outline: call('pdf:outline'),
    links: call('pdf:links'),
    followLink: call('pdf:followLink'),
    attachments: call('pdf:attachments'),
    // Drive's first-page covers, sealed and cached on this computer.
    coverGet: call('pdf:coverGet'),
    coverPut: call('pdf:coverPut'),
    details: call('pdf:details'),
    print: call('pdf:print'),
    pickLocal: call('pdf:pickLocal'),
    diagnostics: call('pdf:diagnostics'),
    mode: call('pdf:mode'),
    edit: call('pdf:edit'),
    undo: call('pdf:undo'),
    redo: call('pdf:redo'),
    annotations: call('pdf:annotations'),
    textSpan: call('pdf:textSpan'),
    save: call('pdf:save'),
    resolve: call('pdf:resolve'),
    discard: call('pdf:discard'),
    extract: call('pdf:extract'),
    /** PDFs from a real drop: turned into paths here, into handles in main — as files.registerDropped. */
    registerDropped: (files: File[]): Promise<unknown> => {
      const paths = Array.from(files)
        .map((f) => webUtils.getPathForFile(f))
        .filter((p) => typeof p === 'string' && p.length > 0)
        .slice(0, 20);
      if (paths.length === 0) return Promise.resolve({ files: [], rejected: [] });
      return invoke('pdf:registerDropped', { paths });
    },
  },
  elearning: {
    offlineList: call('elearning:offlineList'),
    offlineDownload: call('elearning:offlineDownload'),
    offlineRemove: call('elearning:offlineRemove'),
    offlineValidate: call('elearning:offlineValidate'),
  },
  eventdesk: {
    list: call('eventdesk:list'),
    status: call('eventdesk:status'),
    register: call('eventdesk:register'),
    rotateKey: call('eventdesk:rotateKey'),
    forget: call('eventdesk:forget'),
    sync: call('eventdesk:sync'),
    scan: call('eventdesk:scan'),
    search: call('eventdesk:search'),
    queue: call('eventdesk:queue'),
    queueResolve: call('eventdesk:queueResolve'),
    walkIn: call('eventdesk:walkIn'),
    printSettings: call('eventdesk:printSettings'),
    printSettingsSet: call('eventdesk:printSettingsSet'),
    printJobs: call('eventdesk:printJobs'),
  },
  restaurant: {
    pairing: call('restaurant:pairing'),
    pair: call('restaurant:pair'),
    unpair: call('restaurant:unpair'),
    status: call('restaurant:status'),
    syncNow: call('restaurant:syncNow'),
    copy: call('restaurant:copy'),
    outbox: call('restaurant:outbox'),
    outboxAdd: call('restaurant:outboxAdd'),
    outboxResolve: call('restaurant:outboxResolve'),
    printSettings: call('restaurant:printSettings'),
    printSettingsSet: call('restaurant:printSettingsSet'),
    printJobs: call('restaurant:printJobs'),
    printNow: call('restaurant:printNow'),
    printTest: call('restaurant:printTest'),
    printText: call('restaurant:printText'),
    openDrawer: call('restaurant:openDrawer'),
  },
  office: {
    open: call('office:open'),
    place: call('office:place'),
    snapshot: call('office:snapshot'),
    command: call('office:command'),
    close: call('office:close'),
    focusFile: call('office:focusFile'),
    externalApps: call('office:externalApps'),
    openExternal: call('office:openExternal'),
    localCopies: call('office:localCopies'),
    uploadLocal: call('office:uploadLocal'),
    forgetLocal: call('office:forgetLocal'),
    revealLocal: call('office:revealLocal'),
    localAvailable: call('office:localAvailable'),
    openLocal: call('office:openLocal'),
    // The built-in editor's files: one picked on this computer, and the offline copies.
    pickFile: call('office:pickFile'),
    readFile: call('office:readFile'),
    writeFile: call('office:writeFile'),
    saveCopy: call('office:saveCopy'),
    readOffline: call('office:readOffline'),
    writeOffline: call('office:writeOffline'),
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
    syncStatus: call('salon:syncStatus'),
    syncNow: call('salon:syncNow'),
    copy: call('salon:copy'),
    copyClients: call('salon:copyClients'),
    outbox: call('salon:outbox'),
    outboxAdd: call('salon:outboxAdd'),
    outboxResolve: call('salon:outboxResolve'),
  },
  // POS (pos-channels.ts): each channel under its own name, so the bridge test sees it.
  // Hotel PMS files saved through the download manager; the main process checks the download policy.
  pms: {
    download: call('pms:download'),
  },
  // Hotel PMS door locks (pms-locks-channels.ts): the on-site lock server; its secret never comes back.
  pmsLocks: {
    config: call('pmsLocks:config'),
    configSet: call('pmsLocks:configSet'),
    forget: call('pmsLocks:forget'),
    test: call('pmsLocks:test'),
    run: call('pmsLocks:run'),
    status: call('pmsLocks:status'),
  },
  // WorkSuite Projects (projects-channels.ts): the tray timer, the mini timer window and the offline outbox.
  projects: {
    timer: call('projects:timer'),
    timerRefresh: call('projects:timerRefresh'),
    timerStart: call('projects:timerStart'),
    timerStop: call('projects:timerStop'),
    timerSwitch: call('projects:timerSwitch'),
    timerPause: call('projects:timerPause'),
    timerResume: call('projects:timerResume'),
    timerNote: call('projects:timerNote'),
    timerWindow: call('projects:timerWindow'),
    outbox: call('projects:outbox'),
    submit: call('projects:submit'),
    resolve: call('projects:resolve'),
    discard: call('projects:discard'),
    replay: call('projects:replay'),
  },
  // Contact sync (contact-sync-channels.ts): iCloud, CardDAV and Mac Contacts on this computer; passwords never come back.
  contactSync: {
    status: call('contactSync:status'),
    connect: call('contactSync:connect'),
    run: call('contactSync:run'),
    setPassword: call('contactSync:setPassword'),
    forget: call('contactSync:forget'),
    macAccess: call('contactSync:macAccess'),
  },
  pos: {
    till: call('pos:till'),
    pair: call('pos:pair'),
    forget: call('pos:forget'),
    catalogue: call('pos:catalogue'),
    catalogueRefresh: call('pos:catalogueRefresh'),
    tillSettings: call('pos:tillSettings'),
    tillSettingsSet: call('pos:tillSettingsSet'),
    sell: call('pos:sell'),
    sales: call('pos:sales'),
    sale: call('pos:sale'),
    syncNow: call('pos:syncNow'),
    resolve: call('pos:resolve'),
    printSettings: call('pos:printSettings'),
    printSettingsSet: call('pos:printSettingsSet'),
    printReceipt: call('pos:printReceipt'),
    receipt: call('pos:receipt'),
    giveBack: call('pos:giveBack'),
    email: call('pos:email'),
    printReport: call('pos:printReport'),
    printTest: call('pos:printTest'),
    openDrawer: call('pos:openDrawer'),
    displayOpen: call('pos:displayOpen'),
    displayClose: call('pos:displayClose'),
    carts: call('pos:carts'),
    cartsSave: call('pos:cartsSave'),
    desk: call('pos:desk'),
    approve: call('pos:approve'),
    rename: call('pos:rename'),
    displayMedia: call('pos:displayMedia'),
  },
  // The Phone (phone-channels.ts): its switch in the page policy, global shortcuts, call notifications.
  phone: {
    prepare: call('phone:prepare'),
    shortcuts: call('phone:shortcuts'),
    notify: call('phone:notify'),
  },
  // Mail data files, export, safe links and S/MIME (ENH-MAIL-03 P4).
  mailfile: {
    pick: call('mailfile:pick'),
    scan: call('mailfile:scan'),
    import: call('mailfile:import'),
    progress: call('mailfile:progress'),
    cancel: call('mailfile:cancel'),
    view: call('mailfile:view'),
    saveAttachment: call('mailfile:saveAttachment'),
    close: call('mailfile:close'),
  },
  mail: {
    export: call('mail:export'),
    exportCancel: call('mail:exportCancel'),
    openLink: call('mail:openLink'),
    spellLanguages: call('mail:spellLanguages'),
    setSpellLanguages: call('mail:setSpellLanguages'),
    images: call('mail:images'),
    keptAttachments: call('mail:keptAttachments'),
  },
  smime: {
    verify: call('smime:verify'),
  },
  support: {
    displays: call('support:displays'),
    wall: call('support:wall'),
    wallClose: call('support:wallClose'),
  },
  help: {
    capture: call('help:capture'),
    logs: call('help:logs'),
  },
  offline: {
    status: call('offline:status'),
    pending: call('offline:pending'),
    moduleBytes: call('offline:moduleBytes'),
    clearModule: call('offline:clearModule'),
    mailStats: call('offline:mailStats'),
    peek: call('offline:peek'),
    clearMailbox: call('offline:clearMailbox'),
    mailSearch: call('offline:mailSearch'),
    mailList: call('offline:mailList'),
    submit: call('offline:submit'),
    retry: call('offline:retry'),
    discard: call('offline:discard'),
    detail: call('offline:detail'),
    edit: call('offline:edit'),
    replay: call('offline:replay'),
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
    // The app lock's PIN.
    unlockPin: call('security:unlockPin'),
    setPin: call('security:setPin'),
    clearPin: call('security:clearPin'),
    state: call('security:state'),
    deviceInfo: call('security:deviceInfo'),
  },
  updates: {
    status: call('updates:status'),
    check: call('updates:check'),
    installNow: call('updates:installNow'),
    download: call('updates:download'),
    restartLater: call('updates:restartLater'),
    setChannel: call('updates:setChannel'),
    setActiveCall: call('updates:setActiveCall'),
    busy: call('updates:busy'),
    later: call('updates:later'),
    reinstall: call('updates:reinstall'),
    dismissNotice: call('updates:dismissNotice'),
    prepared: call('updates:prepared'),
    pauseDownload: call('updates:pauseDownload'),
    resumeDownload: call('updates:resumeDownload'),
    cancelDownload: call('updates:cancelDownload'),
    installWhenFree: call('updates:installWhenFree'),
    diagnostics: call('updates:diagnostics'),
    exportDiagnostics: call('updates:exportDiagnostics'),
  },
  settings: {
    get: call('settings:get'),
    set: call('settings:set'),
    launcherDefaults: call('settings:launcherDefaults'),
    appearanceDefaults: call('settings:appearanceDefaults'),
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
    timings: call('diagnostics:timings'),
  },
  connection: {
    details: call('connection:details'),
    speedTest: call('connection:speedTest'),
    reconnect: call('connection:reconnect'),
  },
  events: { on },
};

contextBridge.exposeInMainWorld('worksuite', api);

export type WorksuiteBridge = typeof api;
