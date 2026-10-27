import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => ({ ok: true })), on: vi.fn(() => () => undefined), errorMessage: (e: unknown) => String(e), isMac: false }));
vi.mock('../../../src/core/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn(), request: vi.fn() }));

import { apiGet, apiPost, request } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import {
  createAndSend,
  createJob,
  fetchJobs,
  fetchServerPrinters,
  fetchTemplates,
  fetchTemplatesFor,
  findRecords,
  newKey,
  pausePrinter,
  preview,
  recordId,
  reprint,
  resolveJob,
  resumePrinter,
  saveDraft,
  sendJob,
  STATE_TEXT,
  type LabelModel,
  type ServerJob,
} from '../../../src/modules/label/api';

const get = vi.mocked(apiGet);
const post = vi.mocked(apiPost);
const req = vi.mocked(request);
const bridge = vi.mocked(call);
const job = { id: 41, status: 'QUEUED' } as unknown as ServerJob;
const model = { elements: [] } as unknown as LabelModel;

/** Label Studio's client (WS-LABEL-SRS-001 §4.27): the server renders, allocates and decides; this only asks (audit D-G07). */
describe('Label Studio api', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    req.mockReset();
    bridge.mockClear();
  });

  it('lists templates from either answer shape, the recent ones as the server sorts them', async () => {
    get.mockResolvedValueOnce({ items: [{ id: 1 }] }).mockResolvedValueOnce([{ id: 2 }]).mockResolvedValueOnce(null);
    expect(await fetchTemplates('', true)).toEqual([{ id: 1 }]);
    expect(get).toHaveBeenLastCalledWith('/api/labels/templates', { status: 'PUBLISHED', sort: 'last_printed_at', dir: 'desc', per_page: 8 }, undefined);
    expect(await fetchTemplates('box', false)).toEqual([{ id: 2 }]);
    expect(get).toHaveBeenLastCalledWith('/api/labels/templates', { q: 'box', per_page: 50 }, undefined);
    expect(await fetchTemplatesFor('inventory.product')).toEqual([]);
    expect(get).toHaveBeenLastCalledWith('/api/labels/templates', { context: 'inventory.product', status: 'PUBLISHED', per_page: 50 }, undefined);
  });

  it('an empty search asks for every template, not for an empty name', async () => {
    get.mockResolvedValueOnce([]);
    await fetchTemplates('', false);
    expect(get).toHaveBeenLastCalledWith('/api/labels/templates', { q: undefined, per_page: 50 }, undefined);
  });

  it('saves a draft against the version it was read at', async () => {
    req.mockResolvedValueOnce({ data: { id: 7 }, offline: false, cachedAt: null, message: null } as never);
    expect(await saveDraft(7, 3, model)).toEqual({ id: 7 });
    expect(req).toHaveBeenCalledWith('PATCH', '/api/labels/templates/7', { body: { model }, headers: { 'If-Match': '3' } });
  });

  it("shows the server's own rendering as a picture", async () => {
    post.mockResolvedValueOnce({ mime: 'image/png', base64: 'AAA' }).mockResolvedValueOnce({ mime: '', base64: 'BBB' });
    expect(await preview(5, model)).toBe('data:image/png;base64,AAA');
    expect(post).toHaveBeenLastCalledWith('/api/labels/preview', { template_id: 5, model, provider: 'png', mode: 'normal' });
    expect(await preview(5, model)).toBe('data:image/png;base64,BBB');
  });

  it('creates a job once per key, prints to a printer by default, and the caller may not override the key', async () => {
    req.mockResolvedValueOnce({ data: { job }, offline: false, cachedAt: null, message: null } as never);
    expect(await createJob({ template_id: 1, printer_id: 2, mode: 'copies', copies: 3 }, 'k-1')).toBe(job);
    expect(req).toHaveBeenCalledWith('POST', '/api/labels/print', { body: { output: 'printer', quantity: 1, template_id: 1, printer_id: 2, mode: 'copies', copies: 3 }, headers: { 'Idempotency-Key': 'k-1' } });
  });

  it('a reprint is an exact copy with a reason, under its own key', async () => {
    req.mockResolvedValueOnce({ data: { job }, offline: false, cachedAt: null, message: null } as never);
    expect(await reprint(41, 'Smudged', 'k-2')).toBe(job);
    expect(req).toHaveBeenCalledWith('POST', '/api/labels/jobs/41/reprint', { body: { type: 'exact', reason: 'Smudged' }, headers: { 'Idempotency-Key': 'k-2' } });
  });

  it('prints on this computer by handing the main process the job id, never printer bytes', async () => {
    req.mockResolvedValueOnce({ data: { job }, offline: false, cachedAt: null, message: null } as never);
    await createAndSend({ template_id: 1, printer_id: 2, mode: 'single' }, 'k-3');
    expect(bridge).toHaveBeenCalledWith('label:send', { job_id: '41' });
    await sendJob(9);
    expect(bridge).toHaveBeenLastCalledWith('label:send', { job_id: '9' });
  });

  it('resolves an interrupted job with the last printed value only when there is one', async () => {
    await resolveJob('j', 'void' as never, 'jammed');
    expect(bridge).toHaveBeenLastCalledWith('label:resolve', { job_id: 'j', decision: 'void', reason: 'jammed' });
    await resolveJob('j', 'printed' as never, 'ok', 0);
    expect(bridge).toHaveBeenLastCalledWith('label:resolve', { job_id: 'j', decision: 'printed', reason: 'ok', last_printed: 0 });
  });

  it("reads printers' pause state from either field, and treats a server without it as none", async () => {
    get.mockResolvedValueOnce({ items: [{ id: '3', paused: false, paused_at: '2026-10-01', paused_reason: 'Ribbon' }, { id: 4 }] });
    expect(await fetchServerPrinters()).toEqual([
      { id: 3, paused: true, paused_reason: 'Ribbon' },
      { id: 4, paused: false, paused_reason: null },
    ]);
    get.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 404 }));
    expect(await fetchServerPrinters()).toBeNull();
    get.mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }));
    await expect(fetchServerPrinters()).rejects.toThrow('down');
  });

  it('pauses with a reason only when one is given, and resumes', async () => {
    post.mockResolvedValue({});
    await pausePrinter(3);
    expect(post).toHaveBeenLastCalledWith('/api/labels/printers/3/pause', {});
    await pausePrinter(3, 'Out of labels');
    expect(post).toHaveBeenLastCalledWith('/api/labels/printers/3/pause', { reason: 'Out of labels' });
    await resumePrinter(3);
    expect(post).toHaveBeenLastCalledWith('/api/labels/printers/3/resume', {});
  });

  it('finds records in a data source by its path name, and reads their ids', async () => {
    get.mockResolvedValueOnce([]);
    await findRecords('inventory.product', 'SKU-1');
    expect(get).toHaveBeenLastCalledWith('/api/labels/data-sources/inventory_product/records', { q: 'SKU-1', limit: 5 });
    expect(recordId('product:12')).toBe('12');
    expect(recordId('12')).toBe('12');
  });

  it('lists the recent jobs, by status when asked', async () => {
    get.mockResolvedValueOnce({ items: [job] });
    expect(await fetchJobs(undefined, 'PARTIAL')).toEqual([job]);
    expect(get).toHaveBeenLastCalledWith('/api/labels/jobs', { per_page: 20, status: 'PARTIAL' }, undefined);
  });

  it('makes a fresh idempotency key each time, and words every state', () => {
    expect(newKey()).not.toBe(newKey());
    for (const s of ['ready', 'paper_out', 'interrupted', 'PARTIAL', 'PENDING_APPROVAL']) expect(STATE_TEXT[s]).toBeTruthy();
    expect(STATE_TEXT.PARTIAL).toBe('Needs reconciling');
  });
});
