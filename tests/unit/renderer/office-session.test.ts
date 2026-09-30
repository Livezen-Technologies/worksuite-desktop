import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { OfficeEditorCommand, OfficeEditorEvent } from '@shared/office';
import { ApiError } from '../../../src/core/api';
import { clientType, editorLang, officeRefusal, type OfficeApi, type OfficeBootstrap, type OfficePermissions } from '../../../src/modules/files/office/api';
import { OfficeSession } from '../../../src/modules/files/office/OfficeSession';
import { saveLine } from '../../../src/modules/files/office/status';

const allowed: OfficePermissions = {
  edit: true, review: true, comment: true, download: true, print: true, copy: true, export: true, convert: true, share: true,
  rename: true, move: true, version_history: true, restore_version: true, mention: true, coedit: true, chat: true,
};

function boot(over: Partial<OfficeBootstrap> = {}): OfficeBootstrap {
  return {
    session_id: 'sess-1', provider: 'onlyoffice', document_server_url: 'https://docs.example.com',
    api_url: 'https://docs.example.com/web-apps/apps/api/documents/api.js', document_type: 'word', document_key: 'f1v1-abc',
    config: { document: { key: 'f1v1-abc' }, token: 'signed.jwt' }, permissions: allowed, mode: 'EDIT', available_modes: ['VIEW', 'EDIT'],
    default_mode: 'EDIT', read_only_reason: null, expires_at: new Date(Date.now() + 600_000).toISOString(), heartbeat_interval_s: 60,
    session_idle_timeout_s: 1800, file: { id: 1, name: 'Proposal.docx', extension: 'docx', type: 'word', version: 1, size: 10 },
    lock: null, collaborators: [], new_version_available: false,
    save: { state: 'saved', message: '', error_code: null, retry_available: false, actions: [], pending_since: null, last_version: null },
    ...over,
  };
}

const hb = (over: Record<string, unknown> = {}) => ({
  session_id: 'sess-1', status: 'ACTIVE', mode: 'EDIT' as const, available_modes: ['VIEW', 'EDIT'] as Array<'VIEW' | 'EDIT'>, read_only_reason: null,
  reload: false, can_switch_to_edit: false, new_version_available: false, head_version: 1, lock: null, collaborators: [],
  save: boot().save, next_heartbeat_s: 60, session_expires_at: '', ...over,
});

type FakeApi = { [K in keyof OfficeApi]: Mock<OfficeApi[K]> };

function fakeApi(): FakeApi {
  return {
    openSession: vi.fn(async () => boot()),
    reloadSession: vi.fn(async () => boot()),
    switchMode: vi.fn(async (_f: number, _s: string, mode: 'VIEW' | 'EDIT') => boot({ mode })),
    heartbeat: vi.fn(async () => hb()),
    endSession: vi.fn(async () => undefined),
    forceSave: vi.fn(async () => ({ state: 'requested' as const, message: 'Saving a version.' })),
    retrySave: vi.fn(async () => boot().save),
    mentionable: vi.fn(async () => ({ allowed: true, users: [{ id: '7', name: 'Nimal', email: null, mention_key: 'k7@mention', can_open: true }] })),
    mention: vi.fn(async () => ({ notified: [], needs_share: [], can_share: true, unmatched: [] })),
  } as unknown as FakeApi;
}

function fakeEditor() {
  const sent: OfficeEditorCommand[] = [];
  let cb: ((e: OfficeEditorEvent) => void) | null = null;
  return {
    sent,
    link: {
      send: vi.fn(async (cmd: OfficeEditorCommand) => {
        sent.push(cmd);
      }),
      onEvent: (fn: (e: OfficeEditorEvent) => void) => {
        cb = fn;
        return () => (cb = null);
      },
    },
    emit: (e: OfficeEditorEvent) => cb?.(e),
    lastLoad: () => [...sent].reverse().find((c): c is Extract<OfficeEditorCommand, { op: 'load' }> => c.op === 'load'),
  };
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/**
 * A document's life in a WorkSuite Office window (OO-DSK): the session API's
 * cycle, with the editor in a view of its own reached by commands and events.
 */
describe('opening a document', () => {
  it('hands the editor view the signed configuration exactly as it came, and tells the main process the session', async () => {
    const api = fakeApi();
    const ed = fakeEditor();
    const track = vi.fn();
    const s = new OfficeSession(1, api, ed.link, null, { onTrack: track });
    await s.start();
    const load = ed.lastLoad()!;
    expect(load.apiUrl).toBe(boot().api_url);
    expect(load.config).toEqual(boot().config);
    expect(s.getState().phase).toBe('ready');
    expect(track).toHaveBeenLastCalledWith({ sessionId: 'sess-1', dirty: false, name: 'Proposal.docx' });
  });

  it('offers the editor Share, @-mentions and the working copy only when the person may', async () => {
    const api = fakeApi();
    api.openSession.mockResolvedValueOnce(boot({ permissions: { ...allowed, share: false, mention: false, download: false } }));
    const ed = fakeEditor();
    await new OfficeSession(1, api, ed.link).start();
    const events = ed.lastLoad()!.events;
    expect(events).toContain('onDocumentReady');
    expect(events).not.toContain('onRequestSharingSettings');
    expect(events).not.toContain('onRequestUsers');
    expect(events).not.toContain('onDownloadAs');
  });

  it('shows the server’s refusal and what may be done instead', async () => {
    const api = fakeApi();
    api.openSession.mockRejectedValueOnce(new ApiError(422, 'Old DOC files open read-only or as a new DOCX.', null, { code: 'office_legacy_conversion_required', actions: ['convert_and_edit', 'view_only', 'cancel'] }));
    const s = new OfficeSession(1, api, fakeEditor().link);
    await s.start();
    expect(s.getState().phase).toBe('refused');
    expect(s.getState().refusal).toMatchObject({ status: 422, code: 'OFFICE_LEGACY_CONVERSION_REQUIRED', message: 'Old DOC files open read-only or as a new DOCX.', actions: ['convert_and_edit', 'view_only', 'cancel'] });
  });
});

describe('keeping it alive', () => {
  it('beats once the document is drawn, with how long that took', async () => {
    const api = fakeApi();
    const ed = fakeEditor();
    const s = new OfficeSession(1, api, ed.link);
    await s.start();
    ed.emit({ build: ed.lastLoad()!.build, type: 'onDocumentReady', data: null });
    await flush();
    expect(api.heartbeat).toHaveBeenCalledWith(1, 'sess-1', expect.any(Number));
    expect(s.getState().loaded).toBe(true);
  });

  it('ignores events from an editor it has since rebuilt', async () => {
    const api = fakeApi();
    const ed = fakeEditor();
    const s = new OfficeSession(1, api, ed.link);
    await s.start();
    const old = ed.lastLoad()!.build;
    await s.setMode('VIEW');
    ed.emit({ build: old, type: 'onDocumentStateChange', data: true });
    expect(s.getState().dirty).toBe(false);
    ed.emit({ build: ed.lastLoad()!.build, type: 'onDocumentStateChange', data: true });
    expect(s.getState().dirty).toBe(true);
  });

  it('opens a new session when the old one expired (410), and ends for good when the file went to the bin', async () => {
    const api = fakeApi();
    const ed = fakeEditor();
    const s = new OfficeSession(1, api, ed.link);
    await s.start();
    api.heartbeat.mockRejectedValueOnce(new ApiError(410, 'The session ended.', null, { code: 'office_session_expired' }));
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(api.openSession).toHaveBeenCalledTimes(2);
    expect(s.getState().notice).toMatch(/renewed/);

    api.heartbeat.mockRejectedValueOnce(new ApiError(410, 'This file was moved to the bin.', null, { code: 'office_session_expired', reason: 'trashed' }));
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(s.getState().phase).toBe('ended');
    expect(s.getState().ended).toBe('This file was moved to the bin.');
    expect(ed.sent.at(-1)).toEqual({ op: 'destroy' });
  });

  it('builds the editor again, read-only, when the server takes editing away', async () => {
    const api = fakeApi();
    const ed = fakeEditor();
    const s = new OfficeSession(1, api, ed.link);
    await s.start();
    api.heartbeat.mockResolvedValueOnce(hb({ reload: true, mode: 'VIEW', read_only_reason: { code: 'LOCKED', message: 'Nimal locked this document.' } }));
    api.reloadSession.mockResolvedValueOnce(boot({ mode: 'VIEW', read_only_reason: { code: 'LOCKED', message: 'Nimal locked this document.' } }));
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(ed.sent.filter((c) => c.op === 'load')).toHaveLength(2);
    expect(s.getState().mode).toBe('VIEW');
    expect(s.getState().notice).toBe('Nimal locked this document.');
  });

  it('renews its tokens when the editor says they are out of date, without rebuilding it', async () => {
    const api = fakeApi();
    const ed = fakeEditor();
    const s = new OfficeSession(1, api, ed.link);
    await s.start();
    ed.emit({ build: ed.lastLoad()!.build, type: 'onError', data: { errorCode: -20 } });
    await flush();
    expect(api.reloadSession).toHaveBeenCalledTimes(1);
    expect(ed.sent.at(-1)).toMatchObject({ op: 'refreshFile' });
    expect(ed.sent.filter((c) => c.op === 'load')).toHaveLength(1);
  });

  it('says the Document Server cannot be reached when its script does not load, and lets the session go', async () => {
    const api = fakeApi();
    const ed = fakeEditor();
    const s = new OfficeSession(1, api, ed.link);
    await s.start();
    ed.emit({ build: ed.lastLoad()!.build, type: 'scriptError', data: null });
    expect(s.getState().phase).toBe('refused');
    expect(s.getState().refusal?.actions).toEqual(expect.arrayContaining(['retry', 'open_in_browser']));
    expect(api.endSession).toHaveBeenCalledWith(1, 'sess-1');
  });
});

describe('mentions', () => {
  it('answers the @-list with a mention key, never an address the server did not show', async () => {
    const api = fakeApi();
    const ed = fakeEditor();
    const s = new OfficeSession(1, api, ed.link);
    await s.start();
    ed.emit({ build: ed.lastLoad()!.build, type: 'onRequestUsers', data: { c: 'mention', search: 'Ni' } });
    await flush();
    expect(ed.sent.at(-1)).toEqual({ op: 'setUsers', data: { c: 'mention', users: [{ id: '7', name: 'Nimal', email: 'k7@mention' }], isPaginated: true } });
  });

  it('does not search for fewer than two characters', async () => {
    const api = fakeApi();
    const ed = fakeEditor();
    const s = new OfficeSession(1, api, ed.link);
    await s.start();
    ed.emit({ build: ed.lastLoad()!.build, type: 'onRequestUsers', data: { c: 'mention', search: 'N' } });
    await flush();
    expect(api.mentionable).not.toHaveBeenCalled();
  });
});

describe('the pieces around it', () => {
  it('names this computer to the server as a desktop client', () => {
    expect(clientType('win32')).toBe('DESKTOP_WIN');
    expect(clientType('darwin')).toBe('DESKTOP_MAC');
    expect(clientType('linux')).toBe('DESKTOP_LINUX');
    expect(editorLang('en-gb')).toBe('en-GB');
    expect(editorLang('si')).toBe('si');
  });

  it('reads a refusal it could not get as "not reached"', () => {
    expect(officeRefusal(new TypeError('x')).status).toBe(0);
    expect(officeRefusal(new ApiError(0, 'x', 'NETWORK_UNREACHABLE')).code).toBe('NETWORK');
  });

  it('says where saving has got to in the server’s words', () => {
    const base = { phase: 'ready' as const, loaded: true, dirty: false, savedAt: null, connection: 'ok' as const, mode: 'EDIT' as const, save: boot().save };
    expect(saveLine({ ...base, dirty: true })?.text).toBe('Saving…');
    expect(saveLine({ ...base, save: { ...base.save, state: 'save_failed', message: 'Save failed: the file is locked.', retry_available: true } })).toEqual({ text: 'Save failed: the file is locked.', tone: 'danger', retry: true });
    expect(saveLine({ ...base, connection: 'reconnecting' })?.tone).toBe('warning');
    expect(saveLine({ ...base, mode: 'VIEW' })).toBeNull();
    expect(saveLine({ ...base, loaded: false })).toBeNull();
  });
});
