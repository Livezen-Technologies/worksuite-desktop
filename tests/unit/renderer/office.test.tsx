// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfficeBootstrap, OfficeHeartbeat } from '../../../shared/office';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn(), toasts: { get: () => ({ items: [] }), set: () => undefined, subscribe: () => () => undefined } }));

const { ApiError, apiDelete, apiGet, apiPost } = await import('../../../src/core/api');
const { call } = await import('../../../src/core/bridge');
const { OfficeSession, CLOSE_WAIT_MS, editorEvents } = await import('../../../src/modules/office/session');
const { saveLine, versionFileName } = await import('../../../src/modules/office/OfficePage');
const tabs = await import('../../../src/core/tabs');
const { app } = await import('../../../src/core/app-state');

const SID = '0e9c3a2e-5b1f-4c7e-9a41-2f1d7c9b8e10';
const SID2 = '1f9c3a2e-5b1f-4c7e-9a41-2f1d7c9b8e10';
const all = { edit: true, review: true, comment: true, download: true, print: true, copy: true, export: true, convert: true, share: true, rename: true, move: true, version_history: true, restore_version: true, mention: true, coedit: true, chat: true };
const saved = { state: 'saved' as const, message: 'Saved', error_code: null, retry_available: false, actions: [], pending_since: null, last_version: { version: 7, at: '2026-09-29T08:59:12Z', by: { id: 3, name: 'Ben' } }, last_commit: null };

function boot(over: Partial<OfficeBootstrap> = {}): OfficeBootstrap {
  return {
    session_id: SID,
    provider: 'ONLYOFFICE',
    document_server_url: 'https://docs.example.com',
    api_url: 'https://docs.example.com/web-apps/apps/api/documents/api.js',
    document_type: 'word',
    document_key: 'f42v7-a',
    config: { document: { key: 'f42v7-a' }, token: 'eyJ' },
    permissions: { ...all },
    mode: 'EDIT',
    available_modes: ['VIEW', 'EDIT', 'REVIEW', 'COMMENT'],
    default_mode: 'EDIT',
    read_only_reason: null,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    heartbeat_interval_s: 60,
    session_idle_timeout_s: 1800,
    file: { id: 42, name: 'Proposal.docx', extension: 'docx', type: 'DOCUMENT', version: 7, size: 1000 },
    format: { declared: 'docx', mismatch: false, legacy: false, macro: false, upgrade_to: null, content_checked: true },
    lock: null,
    collaborators: [],
    new_version_available: false,
    save: saved,
    ...over,
  };
}

const beat = (over: Partial<OfficeHeartbeat> = {}): OfficeHeartbeat => ({
  session_id: SID,
  status: 'ACTIVE',
  mode: 'EDIT',
  available_modes: ['VIEW', 'EDIT', 'REVIEW', 'COMMENT'],
  read_only_reason: null,
  reload: false,
  can_switch_to_edit: false,
  new_version_available: false,
  head_version: 7,
  lock: null,
  collaborators: [],
  save: saved,
  next_heartbeat_s: 60,
  session_expires_at: '2026-09-29T09:40:00Z',
  ...over,
});

const refused = (status: number, message: string, errors: Record<string, unknown>) => new ApiError(status, message, null, errors);

/** A fake API: answers by method and path; records every call. */
function fakeApi() {
  const calls: Array<[string, ...unknown[]]> = [];
  const api = {
    openSession: vi.fn(async (...a: unknown[]) => (calls.push(['open', ...a]), boot())),
    renewSession: vi.fn(async (...a: unknown[]) => (calls.push(['renew', ...a]), boot())),
    switchMode: vi.fn(async (...a: unknown[]) => (calls.push(['mode', ...a]), boot({ mode: a[2] as never }))),
    heartbeat: vi.fn(async (...a: unknown[]) => (calls.push(['beat', ...a]), beat())),
    endSession: vi.fn(async (...a: unknown[]) => (calls.push(['end', ...a]), {})),
    forceSave: vi.fn(async (...a: unknown[]) => (calls.push(['force', ...a]), { state: 'requested' as const })),
    retrySave: vi.fn(async () => ({ ...saved, tried: 1 })),
    mentionable: vi.fn(async (...a: unknown[]) => (calls.push(['mentionable', ...a]), { allowed: true, users: [{ id: '3', name: 'Samali', email: null, mention_key: 'u3@worksuite.mention', can_open: true }] })),
    mention: vi.fn(async (...a: unknown[]) => (calls.push(['mention', ...a]), { notified: [{ id: 3, name: 'Samali' }], needs_share: [{ id: 6, name: 'Sahan' }], can_share: true, unmatched: [] })),
    renameFile: vi.fn(async (...a: unknown[]) => (calls.push(['rename', ...a]), {})),
    refreshTitle: vi.fn(async (...a: unknown[]) => (calls.push(['meta', ...a]), {})),
    takeLock: vi.fn(async () => ({ lock: null })),
    releaseLock: vi.fn(async () => ({ lock: null })),
  };
  return { api, calls };
}

function make(opts: { offline?: boolean; mode?: 'EDIT' | 'VIEW' | null } = {}) {
  const { api, calls } = fakeApi();
  const notices: Array<[string, string]> = [];
  const hooks = { share: vi.fn(), renamed: vi.fn(), notice: (k: string, t: string) => void notices.push([k, t]), isOffline: () => !!opts.offline, focus: vi.fn() };
  const s = new OfficeSession(42, opts.mode ?? null, hooks as never, { api: api as never });
  const port = { start: vi.fn(), command: vi.fn() };
  s.attach(port);
  return { s, api, calls, port, hooks, notices };
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('opening a document (web-api §1)', () => {
  it('opens with the server’s default action and loads the signed configuration untouched', async () => {
    const { s, api, port } = make();
    await s.open();
    expect(api.openSession).toHaveBeenCalledWith(42, null);
    expect(s.state.phase).toBe('open');
    expect(port.start).toHaveBeenCalledTimes(1);
    expect(port.start.mock.calls[0]![0].config).toEqual({ document: { key: 'f42v7-a' }, token: 'eyJ' });
    s.close('CLOSED');
  });

  it('wires each editor feature only with the permission behind it', () => {
    const e = editorEvents(boot());
    expect(e).toEqual(expect.arrayContaining(['onDocumentStateChange', 'onRequestRefreshFile', 'onRequestSharingSettings', 'onRequestRename', 'onRequestUsers', 'onRequestSendNotify']));
    expect(e).not.toContain('onRequestEditRights');
    const viewer = editorEvents(boot({ mode: 'VIEW', available_modes: ['VIEW'], permissions: { ...all, edit: false, share: false, rename: false, mention: false } }));
    expect(viewer).not.toContain('onRequestSharingSettings');
    expect(viewer).not.toContain('onRequestRename');
    expect(viewer).not.toContain('onRequestUsers');
    expect(editorEvents(boot({ mode: 'VIEW' }))).toContain('onRequestEditRights');
  });

  it('asks for the mode the person chose, and shows a refusal with its fallback', async () => {
    const { s, api } = make({ mode: 'EDIT' });
    api.openSession.mockRejectedValueOnce(refused(409, 'Samali is editing — you can view until the lock is released.', { code: 'OFFICE_FILE_LOCKED', holder: { id: 5, name: 'Samali' }, fallback_mode: 'VIEW', actions: ['view_only'] }));
    await s.open();
    expect(api.openSession).toHaveBeenCalledWith(42, 'EDIT');
    expect(s.state.phase).toBe('refused');
    expect(s.state.refusal).toMatchObject({ code: 'OFFICE_FILE_LOCKED', message: 'Samali is editing — you can view until the lock is released.' });
    await s.open('VIEW');
    expect(api.openSession).toHaveBeenLastCalledWith(42, 'VIEW');
    expect(s.state.phase).toBe('open');
    s.close('CLOSED');
  });

  it('asks before converting a legacy file (OO-CNV-030)', async () => {
    const { s, api } = make({ mode: 'EDIT' });
    api.openSession.mockRejectedValueOnce(refused(422, 'This legacy file will be converted to DOCX for editing.', { code: 'OFFICE_LEGACY_CONVERSION_REQUIRED', convert_to: 'docx', actions: ['convert_and_edit', 'view_only', 'cancel'] }));
    await s.open();
    expect(s.state.convertAsk?.message).toBe('This legacy file will be converted to DOCX for editing.');
  });

  it('offline, never promises editing (OO-OFF-001/020)', async () => {
    const { s, api } = make({ offline: true });
    await s.open();
    expect(api.openSession).not.toHaveBeenCalled();
    expect(s.state.phase).toBe('offline');
    const b = make();
    b.api.openSession.mockRejectedValueOnce(new ApiError(503, 'Cannot reach WorkSuite server.', 'NETWORK_UNREACHABLE'));
    await b.s.open();
    expect(b.s.state.phase).toBe('offline');
  });

  it('an open answered after the tab closed ends the session it made', async () => {
    const { s, api, calls } = make();
    let release!: (b: OfficeBootstrap) => void;
    api.openSession.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const opening = s.open();
    s.close('CLOSED');
    release(boot());
    await opening;
    expect(calls.filter((c) => c[0] === 'end')).toEqual([['end', 42, SID, 'CLOSED']]);
  });
});

describe('heartbeats, renewal and reloads (web-api §1, §12)', () => {
  it('reports the time to ready on the first heartbeat after the editor is ready', async () => {
    const { s, api } = make();
    await s.open();
    await s.onEditorEvent('onDocumentReady', null);
    expect(api.heartbeat).toHaveBeenCalledWith(42, SID, expect.any(Number));
    expect(s.state.ready).toBe(true);
    s.close('CLOSED');
  });

  it('reloads read-only when editing was taken away (reload: true)', async () => {
    const { s, api, port, notices } = make();
    await s.open();
    api.heartbeat.mockResolvedValueOnce(beat({ reload: true, mode: 'VIEW', status: 'READ_ONLY_DOWNGRADED', read_only_reason: { code: 'no_edit_permission', message: "You can view this document, but you don't have permission to edit it." } }));
    api.renewSession.mockResolvedValueOnce(boot({ mode: 'VIEW', read_only_reason: { code: 'no_edit_permission', message: "You can view this document, but you don't have permission to edit it." } }));
    await s.beat();
    expect(port.start).toHaveBeenCalledTimes(2);
    expect(s.state.mode).toBe('VIEW');
    expect(s.state.readOnlyReason?.message).toBe("You can view this document, but you don't have permission to edit it.");
    expect(notices[0]![1]).toMatch(/permission to edit/);
    s.close('CLOSED');
  });

  it('renews the signed configuration before it lapses, and keeps the editor running', async () => {
    const { s, api, port } = make();
    api.openSession.mockResolvedValueOnce(boot({ expires_at: new Date(Date.now() + 60_000).toISOString() }));
    await s.open();
    await s.beat();
    expect(api.renewSession).toHaveBeenCalledWith(42, SID);
    expect(port.start).toHaveBeenCalledTimes(1);
    s.close('CLOSED');
  });

  it('does not renew onto a newer version by itself: the person chooses (OO-SES-012)', async () => {
    const { s, api, port } = make();
    api.openSession.mockResolvedValueOnce(boot({ expires_at: new Date(Date.now() + 60_000).toISOString() }));
    await s.open();
    api.heartbeat.mockResolvedValueOnce(beat({ new_version_available: true, head_version: 8 }));
    await s.beat();
    expect(s.state.newVersion).toBe(true);
    expect(api.renewSession).not.toHaveBeenCalled();
    api.renewSession.mockResolvedValueOnce(boot({ session_id: SID2, document_key: 'f42v8-b', replaced_session_id: SID }));
    await s.renew('newer');
    expect(port.start).toHaveBeenCalledTimes(2);
    expect(s.state.boot?.session_id).toBe(SID2);
    s.close('CLOSED');
  });

  it('gives the editor fresh tokens in place when it asks (onRequestRefreshFile)', async () => {
    const { s, port } = make();
    await s.open();
    await s.onEditorEvent('onRequestRefreshFile', null);
    expect(port.command).toHaveBeenCalledWith({ type: 'refresh', config: { document: { key: 'f42v7-a' }, token: 'eyJ' } });
    s.close('CLOSED');
  });

  it('reopens after a 410, and ends for good when the file went to the bin or access went', async () => {
    const a = make();
    await a.s.open();
    a.api.heartbeat.mockRejectedValueOnce(refused(410, 'This editing session has ended.', { code: 'OFFICE_SESSION_EXPIRED', session_ended: true, status: 'EXPIRED' }));
    await a.s.beat();
    expect(a.api.openSession).toHaveBeenCalledTimes(2);
    expect(a.s.state.phase).toBe('open');
    a.s.close('CLOSED');

    const b = make();
    await b.s.open();
    b.api.heartbeat.mockRejectedValueOnce(refused(410, 'Document has been moved to Trash.', { code: 'OFFICE_SESSION_EXPIRED', session_ended: true, reason: 'trashed' }));
    await b.s.beat();
    expect(b.s.state.phase).toBe('ended');
    expect(b.s.state.refusal?.message).toBe('Document has been moved to Trash.');

    const c = make();
    await c.s.open();
    c.api.heartbeat.mockRejectedValueOnce(refused(403, 'You no longer have access to this document.', { code: 'OFFICE_PERMISSION_DENIED', session_ended: true, reason: 'access_removed' }));
    await c.s.beat();
    expect(c.s.state.phase).toBe('ended');
    expect(c.api.openSession).toHaveBeenCalledTimes(1);
  });

  it('carries on while WorkSuite cannot be reached', async () => {
    const { s, api } = make();
    await s.open();
    api.heartbeat.mockRejectedValueOnce(new ApiError(503, 'Cannot reach WorkSuite server.', 'NETWORK_UNREACHABLE'));
    await s.beat();
    expect(s.state.reconnecting).toBe(true);
    expect(s.state.phase).toBe('open');
    await s.beat();
    expect(s.state.reconnecting).toBe(false);
    s.close('CLOSED');
  });
});

describe('modes, rename, mentions (web-api §1, §4)', () => {
  it("switches mode in the same session, and says the server's no in the editor", async () => {
    const { s, api, port, notices } = make();
    await s.open();
    expect(await s.setMode('REVIEW')).toBe(true);
    expect(api.switchMode).toHaveBeenCalledWith(42, SID, 'REVIEW');
    expect(port.start).toHaveBeenCalledTimes(2);
    api.switchMode.mockResolvedValueOnce(boot({ mode: 'VIEW' }));
    await s.setMode('VIEW');
    api.switchMode.mockRejectedValueOnce(refused(403, 'You cannot edit this document.', { code: 'OFFICE_PERMISSION_DENIED', fallback_mode: 'VIEW' }));
    expect(await s.setMode('EDIT')).toBe(false);
    expect(notices.at(-1)).toEqual(['error', 'You cannot edit this document.']);
    expect(port.command).toHaveBeenCalledWith({ type: 'denyEditingRights', message: 'You cannot edit this document.' });
    s.close('CLOSED');
  });

  it('renames through Drive, keeping the extension, then updates every open title (OO-COL-060)', async () => {
    const { s, calls, hooks } = make();
    await s.open();
    await s.onEditorEvent('onRequestRename', 'Final proposal');
    expect(calls.filter((c) => c[0] === 'rename' || c[0] === 'meta')).toEqual([
      ['rename', 42, 'Final proposal.docx'],
      ['meta', 42],
    ]);
    expect(s.state.boot?.file.name).toBe('Final proposal.docx');
    expect(hooks.renamed).toHaveBeenCalledWith('Final proposal.docx');
    s.close('CLOSED');
  });

  it("fills the mention list from the server's search, as mention keys", async () => {
    const { s, api, port } = make();
    await s.open();
    await s.onEditorEvent('onRequestUsers', { c: 'mention', search: 'Sa' });
    expect(api.mentionable).toHaveBeenCalledWith(42, 'Sa');
    expect(port.command).toHaveBeenLastCalledWith({ type: 'setUsers', c: 'mention', users: [{ id: '3', name: 'Samali', email: 'u3@worksuite.mention' }] });
    await s.onEditorEvent('onRequestUsers', { c: 'mention' });
    expect(port.command).toHaveBeenLastCalledWith({ type: 'setUsers', c: 'mention', users: [] });
    s.close('CLOSED');
  });

  it('tells the server who was mentioned and where — and offers sharing, never granting it (OO-COL-021)', async () => {
    const { s, api, notices, hooks } = make();
    await s.open();
    await s.onEditorEvent('onRequestSendNotify', { emails: ['u3@worksuite.mention', 'u6@worksuite.mention'], actionLink: '{"action":1}' });
    expect(api.mention).toHaveBeenCalledWith(42, ['u3@worksuite.mention', 'u6@worksuite.mention'], '{"action":1}');
    expect(notices.map((n) => n[1]).join(' ')).toMatch(/Samali was told/);
    expect(notices.map((n) => n[1]).join(' ')).toMatch(/Sahan can't open this document/);
    await s.onEditorEvent('onRequestSharingSettings', null);
    expect(hooks.share).toHaveBeenCalled();
    s.close('CLOSED');
  });
});

describe('closing (OO-DSK-006, OO-DSK-060)', () => {
  it('closes at once with nothing to save, and ends the session', async () => {
    const { s, calls } = make();
    await s.open();
    expect(s.closeGuard()).toBeNull();
    s.close('CLOSED');
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.filter((c) => c[0] === 'end')).toEqual([['end', 42, SID, 'CLOSED']]);
    expect(calls.some((c) => c[0] === 'force')).toBe(false);
  });

  it('waits for changes to reach the Document Server, asks it to save, then lets the tab go', async () => {
    const { s, calls } = make();
    await s.open();
    await s.onEditorEvent('onDocumentStateChange', true);
    const wait = s.closeGuard();
    expect(wait).not.toBeNull();
    expect(s.state.closing).toBe(true);
    let done = false;
    void wait!.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    await s.onEditorEvent('onDocumentStateChange', false);
    await wait;
    expect(calls.filter((c) => c[0] === 'force')).toEqual([['force', 42, SID]]);
    s.close('CLOSED');
    await new Promise((r) => setTimeout(r, 0));
    // Saved already: the close does not ask again.
    expect(calls.filter((c) => c[0] === 'force')).toHaveLength(1);
    expect(calls.at(-1)).toEqual(['end', 42, SID, 'CLOSED']);
  });

  it('waits no longer than ten seconds', async () => {
    vi.useFakeTimers();
    const { s, notices } = make();
    await s.open();
    await s.onEditorEvent('onDocumentStateChange', true);
    const wait = s.closeGuard()!;
    let done = false;
    void wait.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(CLOSE_WAIT_MS + 50);
    expect(done).toBe(true);
    expect(notices.at(-1)![1]).toMatch(/had not reached/);
    s.close('CLOSED');
  });

  it('an organisation switch closes as such, asking for a save first', async () => {
    const { s, calls } = make();
    await s.open();
    await s.onEditorEvent('onDocumentStateChange', true);
    await s.onEditorEvent('onDocumentStateChange', false);
    s.close('ORG_SWITCH');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.slice(-2)).toEqual([
      ['force', 42, SID],
      ['end', 42, SID, 'ORG_SWITCH'],
    ]);
  });
});

describe('the header’s save status (OO-SAV-020/021)', () => {
  const now = Date.parse('2026-09-29T09:00:00Z');
  it('shows Saving… while the editor has unsent changes, Saved · time after, and the last version beside', () => {
    expect(saveLine({ dirty: true, savedAt: null, save: saved, mode: 'EDIT' }, now)).toMatchObject({ tone: 'busy', text: 'Saving…' });
    const ok = saveLine({ dirty: false, savedAt: now - 60_000, save: saved, mode: 'EDIT' }, now);
    expect(ok.tone).toBe('ok');
    expect(ok.text).toMatch(/^Saved · /);
    expect(ok.secondary).toMatch(/^Version 7 · .* · Ben$/);
  });

  it("shows the server's failure with Retry, and its delay", () => {
    const failed = { ...saved, state: 'save_failed' as const, message: 'Save failed.', retry_available: true, actions: ['retry', 'save_as_copy', 'download_working_copy'] };
    expect(saveLine({ dirty: false, savedAt: null, save: failed, mode: 'EDIT' }, now)).toMatchObject({ tone: 'error', text: 'Save failed.', retry: true });
    const pending = { ...saved, state: 'save_pending' as const, message: 'Saving is delayed. Your changes are safe and will be saved automatically.', retry_available: true, actions: ['retry', 'keep_editing'] };
    expect(saveLine({ dirty: false, savedAt: null, save: pending, mode: 'EDIT' }, now)).toMatchObject({ tone: 'warn', retry: true });
    expect(saveLine({ dirty: false, savedAt: null, save: saved, mode: 'VIEW' }, now).text).toBe('Read-only');
  });

  it('names a version download after the file', () => {
    expect(versionFileName('Proposal.docx', 6)).toBe('Proposal (version 6).docx');
  });
});

describe('tabs for documents (OO-DSK-004/006)', () => {
  beforeEach(() => {
    app.set({ apps: [{ id: 'files' } as never, { id: 'home' } as never] });
    tabs.resetTabs();
  });

  it('opens one tab per document and brings it forward when asked again', () => {
    tabs.navigate('/office/42?name=Proposal.docx');
    tabs.navigate('/office/43?name=Budget.xlsx');
    tabs.navigate('/office/42');
    const s = tabs.tabsStore.get();
    expect(s.tabs.filter((t) => t.app === 'office').map((t) => t.route)).toEqual(['/office/42?name=Proposal.docx', '/office/43?name=Budget.xlsx']);
    expect(s.tabs.find((t) => t.id === s.activeId)?.route).toBe('/office/42?name=Proposal.docx');
  });

  it('a guarded tab closes when its guard lets it, and is never suspended', async () => {
    tabs.navigate('/office/42');
    const id = tabs.tabsStore.get().activeId!;
    let release!: () => void;
    tabs.setCloseGuard(id, () => new Promise<void>((r) => (release = r)));
    tabs.openTab('/home');
    tabs.suspendIdle(-1);
    expect(tabs.tabsStore.get().tabs.find((t) => t.id === id)?.suspended).toBe(false);
    tabs.closeTab(id);
    expect(tabs.tabsStore.get().tabs.some((t) => t.id === id)).toBe(true);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(tabs.tabsStore.get().tabs.some((t) => t.id === id)).toBe(false);
  });

  it("an organisation switch closes that organisation's documents as ORG_SWITCH", () => {
    const id = tabs.openTab('/office/42', { organizationId: '3' })!;
    tabs.setCloseGuard(id, () => null);
    expect(tabs.closeTabsOutside('4')).toBe(1);
    expect(tabs.takeCloseReason(id)).toBe('ORG_SWITCH');
    expect(tabs.takeCloseReason(id)).toBeNull();
    tabs.setCloseGuard(id, null);
  });
});

const { default: OfficePage } = await import('../../../src/modules/office/OfficePage');
const { EditorSurface } = await import('../../../src/modules/office/EditorSurface');

describe('the editor surface', () => {
  it('opens one view, and a reload asked for while it opens reaches it afterwards, in order', async () => {
    let answer!: (v: { viewId: string }) => void;
    const calls: Array<[string, unknown]> = [];
    vi.mocked(call).mockReset().mockImplementation(((ch: string, input: unknown) => {
      calls.push([ch, input]);
      return ch === 'office:open' ? new Promise((r) => (answer = r)) : Promise.resolve(true);
    }) as never);
    const { s } = make();
    const view = render(<EditorSurface session={s} tabKey="t1" organizationId="3" visible />);
    await s.open();
    await s.renew('reload');
    await waitFor(() => expect(calls.filter(([c]) => c === 'office:open')).toHaveLength(1));
    answer({ viewId: '5f9c3a2e-5b1f-4c7e-9a41-2f1d7c9b8e10' });
    await waitFor(() => expect(calls.some(([c]) => c === 'office:command')).toBe(true));
    const cmd = calls.find(([c]) => c === 'office:command')![1] as { command: { type: string }; sessionId: string };
    expect(cmd.command.type).toBe('start');
    expect(cmd.sessionId).toBe(SID);
    view.unmount();
    await waitFor(() => expect(calls.some(([c]) => c === 'office:close')).toBe(true));
    s.close('CLOSED');
  });
});
const { TabProvider } = await import('../../../src/core/tab-context');

describe('the Office tab', () => {
  const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mount = (route: string) =>
    render(
      <QueryClientProvider client={qc()}>
        <TabProvider tabId="t9" route={route} active>
          <OfficePage tabId="t9" route={route} active />
        </TabProvider>
      </QueryClientProvider>,
    );

  beforeEach(() => {
    vi.mocked(apiPost).mockReset();
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiDelete).mockReset().mockResolvedValue({});
    vi.mocked(call).mockReset().mockResolvedValue(null as never);
    app.set({ status: { network: 'ONLINE' } as never, organizationId: null });
  });

  it('shows the header: name, save status, mode, Share and presence', async () => {
    vi.mocked(apiPost).mockImplementation(async (path: string) => {
      if (path.endsWith('/office/session')) return boot({ collaborators: [{ user: { id: 3, name: 'Samali', avatar: null }, editing: true, modes: ['EDIT'], clients: ['WEB'], since: null, last_active_at: null }] });
      return beat();
    });
    vi.mocked(call).mockImplementation((async (ch: string) => (ch === 'office:open' ? { viewId: '5f9c3a2e-5b1f-4c7e-9a41-2f1d7c9b8e10' } : ch === 'office:externalApps' ? [{ id: 'default', label: 'the default app' }] : ch === 'office:localCopies' ? [] : null)) as never);
    mount('/office/42?name=Proposal.docx');
    expect(await screen.findByRole('heading', { name: 'Proposal.docx' })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Saved/));
    expect(screen.getByRole('button', { name: /Editing/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Share/ })).toBeTruthy();
    expect(screen.getByLabelText(/Editing: Samali/)).toBeTruthy();
    await waitFor(() => expect(vi.mocked(call).mock.calls.some(([ch]) => ch === 'office:open')).toBe(true));
    const open = vi.mocked(call).mock.calls.find(([ch]) => ch === 'office:open')![1] as { apiUrl: string; config: unknown; organizationId: string | null };
    expect(open.apiUrl).toBe('https://docs.example.com/web-apps/apps/api/documents/api.js');
    expect(open.config).toEqual({ document: { key: 'f42v7-a' }, token: 'eyJ' });
    expect(apiPost).toHaveBeenCalledWith('/api/files/42/office/session', expect.objectContaining({ client_type: 'DESKTOP_LINUX', layout: 'desktop' }));
  });

  describe('menus over the editor, and Open in new window (worksuite-desktop#39)', () => {
    const VIEW = '5f9c3a2e-5b1f-4c7e-9a41-2f1d7c9b8e10';
    const SHOT = 'data:image/jpeg;base64,c3RpbGw=';
    const serve = (over: Partial<OfficeBootstrap> = {}) => {
      vi.mocked(apiPost).mockImplementation(async (path: string) => (path.endsWith('/office/session') ? boot(over) : beat(over.save ? { save: over.save } : {})));
      vi.mocked(call).mockImplementation((async (ch: string) =>
        ch === 'office:open' ? { viewId: VIEW } : ch === 'office:snapshot' ? SHOT : ch === 'office:externalApps' ? [{ id: 'default', label: 'the default app' }] : ch === 'office:localCopies' ? [] : ch === 'windows:detach' ? { id: 5 } : null) as never);
    };
    const still = () => document.querySelector(`[data-office-editor] img[src="${SHOT}"]`);

    afterEach(() => tabs.tabsStore.set({ tabs: [], activeId: null }));

    it('the Editing menu opens over the editor: a picture of it stands in, and Escape brings the editor back', async () => {
      serve();
      mount('/office/42?name=Proposal.docx');
      await waitFor(() => expect(vi.mocked(call).mock.calls.some(([ch]) => ch === 'office:open')).toBe(true));
      const mode = await screen.findByRole('button', { name: /Editing/ });
      expect(mode.getAttribute('aria-haspopup')).toBe('menu');
      fireEvent.click(mode);
      const menu = await screen.findByRole('menu', { name: 'Mode' });
      expect(vi.mocked(call)).toHaveBeenCalledWith('office:snapshot', { viewId: VIEW });
      expect(mode.getAttribute('aria-expanded')).toBe('true');
      expect(still()).not.toBeNull();
      // Only the modes this person may use.
      expect([...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual(['Editing', 'Reviewing (changes tracked)', 'Commenting', 'Viewing']);
      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      await waitFor(() => expect(still()).toBeNull());
    });

    it('Share opens over the document, which stays in view behind it; Escape brings the editor back (worksuite-desktop#42)', async () => {
      serve();
      mount('/office/42?name=Proposal.docx');
      await waitFor(() => expect(vi.mocked(call).mock.calls.some(([ch]) => ch === 'office:open')).toBe(true));
      fireEvent.click(await screen.findByRole('button', { name: 'Share' }));
      expect(await screen.findByRole('dialog', { name: /Share “Proposal\.docx”/ })).toBeTruthy();
      expect(vi.mocked(call)).toHaveBeenCalledWith('office:snapshot', { viewId: VIEW });
      expect(still()).not.toBeNull();
      expect(screen.queryByText('The document is behind this window.')).toBeNull();
      // Escape closes it from anywhere, the keyboard having been in the editor until a moment ago.
      expect(document.activeElement?.getAttribute('role')).toBe('dialog');
      fireEvent.keyDown(document.body, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(still()).toBeNull());
      // The same session: nothing was opened again.
      expect(vi.mocked(call).mock.calls.filter(([ch]) => ch === 'office:open')).toHaveLength(1);
    });

    it('picking a mode in the Editing menu switches to it and the button says so (worksuite-desktop#40)', async () => {
      serve();
      const post = vi.mocked(apiPost).getMockImplementation()!;
      vi.mocked(apiPost).mockImplementation(async (path: string, body?: unknown) => (path.endsWith('/mode') ? boot({ mode: (body as { mode: OfficeBootstrap['mode'] }).mode }) : post(path, body)) as never);
      mount('/office/42?name=Proposal.docx');
      await waitFor(() => expect(vi.mocked(call).mock.calls.some(([ch]) => ch === 'office:open')).toBe(true));
      fireEvent.click(await screen.findByRole('button', { name: /Editing/ }));
      const menu = await screen.findByRole('menu', { name: 'Mode' });
      fireEvent.click([...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === 'Reviewing (changes tracked)')!);
      await waitFor(() => expect(vi.mocked(apiPost)).toHaveBeenCalledWith(expect.stringMatching(/\/mode$/), { mode: 'REVIEW' }));
      expect(await screen.findByRole('button', { name: /Reviewing/ })).toBeTruthy();
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('the Editing menu offers only the modes the document permissions allow (worksuite-desktop#40)', async () => {
      serve({ mode: 'COMMENT', available_modes: ['COMMENT', 'VIEW'], permissions: { ...all, edit: false } });
      mount('/office/42?name=Proposal.docx');
      await waitFor(() => expect(vi.mocked(call).mock.calls.some(([ch]) => ch === 'office:open')).toBe(true));
      fireEvent.click(await screen.findByRole('button', { name: /Commenting/ }));
      const menu = await screen.findByRole('menu', { name: 'Mode' });
      expect([...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual(['Commenting', 'Viewing']);
    });

    it('More actions opens over the editor, closes on a click outside, and offers only what the permissions allow', async () => {
      serve({ permissions: { ...all, export: false, convert: false, version_history: false } });
      mount('/office/42?name=Proposal.docx');
      await waitFor(() => expect(vi.mocked(call).mock.calls.some(([ch]) => ch === 'office:open')).toBe(true));
      fireEvent.click(await screen.findByRole('button', { name: 'More actions' }));
      const menu = await screen.findByRole('menu', { name: /Actions — Proposal\.docx/ });
      const labels = [...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
      expect(labels).toContain('Download');
      expect(labels).not.toContain('Download as PDF');
      expect(labels).not.toContain('Version history');
      expect(still()).not.toBeNull();
      fireEvent.mouseDown(document.querySelector('.fixed.inset-0')!);
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    });

    it('keeps the picture under a menu opened just after another closed', async () => {
      serve();
      mount('/office/42?name=Proposal.docx');
      await waitFor(() => expect(vi.mocked(call).mock.calls.some(([ch]) => ch === 'office:open')).toBe(true));
      fireEvent.click(await screen.findByRole('button', { name: /Editing/ }));
      await screen.findByRole('menu', { name: 'Mode' });
      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      // Within the closed menu's 250 ms: its clearing of the picture must not take the new menu's away.
      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
      await screen.findByRole('menu', { name: /Actions — Proposal\.docx/ });
      await act(() => new Promise((r) => setTimeout(r, 400)));
      expect(still()).not.toBeNull();
      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(still()).toBeNull());
    });

    it('Open in new window moves the document to a window of its own', async () => {
      tabs.tabsStore.set({ tabs: [{ id: 't9', route: '/office/42?name=Proposal.docx', title: 'Proposal.docx', pinned: false, organizationId: null, app: 'office', lastActive: 0, suspended: false, reloadKey: 0 }], activeId: 't9' });
      serve();
      mount('/office/42?name=Proposal.docx');
      const btn = await screen.findByRole('button', { name: 'Open in new window' });
      expect(btn.getAttribute('title')).toBe('Open in new window');
      fireEvent.click(btn);
      await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('windows:detach', expect.objectContaining({ route: '/office/42?name=Proposal.docx', title: 'Proposal.docx' })));
      await waitFor(() => expect(tabs.tabsStore.get().tabs.some((t) => t.id === 't9')).toBe(false));
    });

    it('a document whose last save failed is not moved until it is saved', async () => {
      tabs.tabsStore.set({ tabs: [{ id: 't9', route: '/office/42', title: 'Proposal.docx', pinned: false, organizationId: null, app: 'office', lastActive: 0, suspended: false, reloadKey: 0 }], activeId: 't9' });
      serve({ save: { ...saved, state: 'save_failed', message: 'Save failed.', retry_available: true, actions: ['retry'] } });
      mount('/office/42');
      fireEvent.click(await screen.findByRole('button', { name: 'Open in new window' }));
      const { toast } = await import('../../../src/core/toasts');
      await waitFor(() => expect(vi.mocked(toast)).toHaveBeenCalledWith('error', expect.stringContaining('The last save failed'), expect.anything()));
      expect(vi.mocked(call).mock.calls.some(([ch]) => ch === 'windows:detach')).toBe(false);
    });

    it('a window that is already its own has no Open in new window', async () => {
      serve();
      mount('/office/42');
      await screen.findByRole('button', { name: 'More actions' });
      expect(screen.queryByRole('button', { name: 'Open in new window' })).toBeNull();
    });
  });

  it("a read-only open shows the server's reason, and no Share without the permission", async () => {
    vi.mocked(apiPost).mockImplementation(async (path: string) =>
      path.endsWith('/office/session') ? boot({ mode: 'VIEW', available_modes: ['VIEW'], permissions: { ...all, edit: false, share: false }, read_only_reason: { code: 'no_edit_permission', message: "You can view this document, but you don't have permission to edit it." } }) : beat({ mode: 'VIEW' }),
    );
    vi.mocked(call).mockImplementation((async (ch: string) => (ch === 'office:open' ? { viewId: '5f9c3a2e-5b1f-4c7e-9a41-2f1d7c9b8e10' } : ch === 'office:externalApps' || ch === 'office:localCopies' ? [] : null)) as never);
    mount('/office/42');
    expect(await screen.findByText("You can view this document, but you don't have permission to edit it.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Share/ })).toBeNull();
    expect(screen.getByText('Viewing')).toBeTruthy();
  });

  it('offline, edits the copy on this computer in the built-in editor, and opens no server session (OO-OFF-020)', async () => {
    app.set({ status: { network: 'OFFLINE' } as never });
    vi.mocked(call).mockImplementation((async (ch: string) => (ch === 'office:localAvailable' ? { available: true, synced: true, preview: false, openInApp: true } : ch === 'office:localCopies' ? [] : ch === 'office:readOffline' ? new Uint8Array([0x50, 0x4b, 3, 4]) : null)) as never);
    mount('/office/42?name=Plan.docx');
    await waitFor(() => expect(call).toHaveBeenCalledWith('office:readOffline', { fileId: 42 }));
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('offline, without a copy on this computer, says so', async () => {
    app.set({ status: { network: 'OFFLINE' } as never });
    vi.mocked(call).mockImplementation((async (ch: string) => (ch === 'office:localAvailable' ? { available: false, synced: false, preview: false, openInApp: false } : ch === 'office:localCopies' ? [] : null)) as never);
    mount('/office/42');
    expect(await screen.findByText("You're offline")).toBeTruthy();
    expect(screen.getByText(/not on this computer/)).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('a Document Server outage never stops Drive: the server’s sentence and what it offers (OO-ERR-001)', async () => {
    vi.mocked(apiPost).mockRejectedValue(refused(503, 'Office Editor is temporarily unavailable.', { code: 'OFFICE_PROVIDER_UNAVAILABLE', actions: ['preview', 'download', 'open_external', 'retry'] }));
    vi.mocked(call).mockImplementation((async (ch: string) => (ch === 'office:localCopies' ? [] : null)) as never);
    mount('/office/42?name=Proposal.docx');
    expect(await screen.findByText('Office Editor is temporarily unavailable.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Download/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open in the browser/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Open read-only/ })).toBeNull();
  });
});
