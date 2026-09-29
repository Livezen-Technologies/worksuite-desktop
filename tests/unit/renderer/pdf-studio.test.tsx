// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySecurity, parsePageRange, textMatcher, nextZoom, type PdfSessionView } from '../../../shared/pdf';

/**
 * PDF Studio in the renderer: the layout maths for 2,000 pages, the
 * hand-offs from Files and Mail, and the workspace — title bar, ribbon
 * gates with their reasons, the password prompt, search results streaming
 * in, the security banner and the shortcuts registered while it is in front.
 */
const bridge = vi.hoisted(() => ({
  listeners: new Map<string, Set<(p: unknown) => void>>(),
  handlers: new Map<string, (input: unknown) => unknown>(),
}));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(async (channel: string, input: unknown) => {
    const h = bridge.handlers.get(channel);
    if (!h) return undefined;
    return h(input);
  }),
  on: (channel: string, cb: (p: unknown) => void) => {
    if (!bridge.listeners.has(channel)) bridge.listeners.set(channel, new Set());
    bridge.listeners.get(channel)!.add(cb);
    return () => bridge.listeners.get(channel)?.delete(cb);
  },
  errorMessage: (e: unknown) => String((e as Error)?.message ?? e),
  isMac: false,
  DesktopError: class extends Error {},
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const tab = vi.hoisted(() => ({ query: new URLSearchParams(), active: true, go: (_r: string) => undefined as void, navigate: (_r: string) => undefined as void }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: `/pdf?${tab.query}`, active: tab.active, path: ['pdf'], query: tab.query, go: (r: string) => tab.go(r), navigate: (r: string) => tab.navigate(r), openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
}));

const { call } = await import('../../../src/core/bridge');
const { toast } = await import('../../../src/core/toasts');
const { getCommand } = await import('../../../src/core/commands');
const { default: PdfStudio } = await import('../../../src/modules/pdf/PdfStudio');
const layout = await import('../../../src/modules/pdf/layout');
const { sourceFromQuery, routeFor } = await import('../../../src/modules/pdf/client');

const emit = (channel: string, payload: unknown) => act(() => bridge.listeners.get(channel)?.forEach((cb) => cb(payload)));

const SID = '0f8fad5b-d9cb-469f-a165-70867728950e';
function view(over: Partial<PdfSessionView> = {}): PdfSessionView {
  return {
    id: SID,
    state: 'ready',
    name: 'Tender.pdf',
    source: { kind: 'drive', fileId: 12, version: 4, label: 'WorkSuite Drive' },
    mode: 'VIEW',
    saveState: 'read-only',
    readOnly: 'Viewing only: annotation, page tools and saving arrive in a later update.',
    size: 1234,
    pageCount: 3,
    pages: [
      [612, 792],
      [612, 792],
      [612, 792],
    ],
    info: { title: 'Tender', author: 'Hasarinda', subject: '', keywords: '', creator: '', producer: '', created: '', modified: '', version: '1.7' },
    permissions: { print: true, printHighQuality: true, copy: true, modify: true, annotate: true, fillForms: true, assemble: true },
    security: emptySecurity(),
    capabilities: null,
    gates: { print: null, download: null, copy: null, externalLinks: null },
    lock: null,
    password: null,
    error: null,
    ...over,
  };
}

// jsdom has no canvas; the pages draw into nothing here.
HTMLCanvasElement.prototype.getContext = (() => null) as never;

beforeEach(() => {
  bridge.listeners.clear();
  bridge.handlers.clear();
  vi.mocked(call).mockClear();
  vi.mocked(toast).mockClear();
  tab.query = new URLSearchParams();
  tab.active = true;
  tab.go = vi.fn();
  tab.navigate = vi.fn();
  bridge.handlers.set('pdf:render', () => new Promise(() => undefined));
  bridge.handlers.set('pdf:thumbnail', () => new Promise(() => undefined));
  bridge.handlers.set('pdf:links', async () => []);
  bridge.handlers.set('pdf:close', async () => undefined);
});
afterEach(cleanup);

describe('layout (PDF-VIEW-001/010/012)', () => {
  const a4: Array<[number, number]> = Array.from({ length: 2000 }, () => [595, 842]);

  it('places 2,000 pages and finds the few on screen by search, not by drawing them all', () => {
    const l = layout.layoutPages(a4, 1, 'continuous', 1200);
    expect(l.pages).toHaveLength(2000);
    const pageH = 842 * (96 / 72);
    expect(l.height).toBeGreaterThan(2000 * pageH);
    const top = l.pages[1500]!.y + 10;
    const vis = layout.visiblePages(l, top, 900);
    expect(vis[0]).toBe(1500);
    expect(vis.length).toBeLessThanOrEqual(2);
    expect(layout.currentPage(l, top, 900)).toBe(1500);
    expect(layout.visiblePages(l, top, 900, 900).length).toBeLessThanOrEqual(4);
  });

  it('lays out spreads, and single-page modes show one row', () => {
    const two = layout.layoutPages(a4.slice(0, 5), 1, 'two-page-continuous', 1600);
    expect(two.rows.map((r) => r.pages)).toEqual([[0, 1], [2, 3], [4]]);
    expect(two.pages[1]!.x).toBeGreaterThan(two.pages[0]!.x);
    expect(layout.layoutPages(a4, 1, 'single', 900, 41).shown).toEqual([41]);
    expect(layout.layoutPages(a4, 1, 'two-page', 900, 41).shown).toEqual([40, 41]);
  });

  it('fits width and page, within 25 %–6400 %', () => {
    const w = layout.fitZoom(a4, 0, 'continuous', 1000, 700, 'width');
    const p = layout.fitZoom(a4, 0, 'continuous', 1000, 700, 'page');
    expect(w).toBeGreaterThan(p);
    expect(Math.round(595 * (96 / 72) * w)).toBeLessThanOrEqual(1000 - 48);
    expect(layout.fitZoom(a4, 0, 'continuous', 10, 10, 'page')).toBe(0.25);
    expect(nextZoom(1, 1)).toBe(1.1);
    expect(nextZoom(64, 1)).toBe(64);
    expect(nextZoom(0.25, -1)).toBe(0.25);
  });

  it('tiles only the part of a large page on screen', () => {
    const tiles = layout.tilesFor([2384, 1684], 8, 2, { x: 5000, y: 3000, w: 800, h: 600 });
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(9);
    for (const t of tiles) {
      expect(t.w).toBeLessThanOrEqual(1024);
      expect(t.x).toBeGreaterThanOrEqual(8192);
    }
  });
});

describe('page ranges, matching and routes', () => {
  it('reads page ranges as people type them', () => {
    expect(parsePageRange('1-3, 5, 9-', 10)).toEqual([0, 1, 2, 4, 8, 9]);
    expect(parsePageRange('2,2,1', 3)).toEqual([1, 0]);
    expect(parsePageRange('0', 3)).toBeNull();
    expect(parsePageRange('4', 3)).toBeNull();
    expect(parsePageRange('a-b', 3)).toBeNull();
  });

  it('matches whole words and case as asked, and refuses a broken expression', () => {
    expect('Needle needles'.match(textMatcher('needle', { matchCase: false, wholeWord: true, regex: false })!)).toEqual(['Needle']);
    expect('a.b axb'.match(textMatcher('a.b', { matchCase: true, wholeWord: false, regex: false })!)).toEqual(['a.b']);
    expect(textMatcher('(', { matchCase: false, wholeWord: false, regex: true })).toBeNull();
  });

  it('turns a tab’s address into a source and back, never carrying a path', () => {
    expect(sourceFromQuery(new URLSearchParams('file=12'))).toEqual({ kind: 'drive', fileId: 12 });
    expect(sourceFromQuery(new URLSearchParams('local=0f8fad5b-d9cb-469f-a165-70867728950e'))).toEqual({ kind: 'local', handle: '0f8fad5b-d9cb-469f-a165-70867728950e' });
    expect(sourceFromQuery(new URLSearchParams('local=/etc/passwd'))).toBeNull();
    expect(sourceFromQuery(new URLSearchParams('file=../1'))).toBeNull();
    const mail = { kind: 'mail' as const, uid: '41', ref: '2', folder: 'INBOX', mailbox: '3', name: 'Offer.pdf' };
    expect(sourceFromQuery(new URLSearchParams(routeFor(mail).split('?')[1]))).toEqual(mail);
  });
});

describe('the hand-off: every PDF in a tab of its own (PDF-UI-004)', () => {
  it('opens a Drive PDF in a new PDF Studio tab, and brings an open one to the front', async () => {
    const { app } = await import('../../../src/core/app-state');
    const { visibleApps } = await import('../../../shared/apps');
    const { resetTabs, tabsStore } = await import('../../../src/core/tabs');
    const { openPdf } = await import('../../../src/modules/pdf/open');
    app.set({ apps: visibleApps({ apps: ['mail'], permissions: [] }) });
    resetTabs();
    openPdf({ kind: 'drive', fileId: 12 }, 'Tender.pdf');
    openPdf({ kind: 'drive', fileId: 13 }, 'Other.pdf');
    const pdfTabs = () => tabsStore.get().tabs.filter((t) => t.app === 'pdf');
    expect(pdfTabs().map((t) => t.route)).toEqual(['/pdf?file=12', '/pdf?file=13']);
    openPdf({ kind: 'drive', fileId: 12 }, 'Tender.pdf');
    expect(pdfTabs()).toHaveLength(2);
    expect(tabsStore.get().activeId).toBe(pdfTabs()[0]!.id);
  });
});

describe('the workspace (§4)', () => {
  it('shows the file, its save state and only this version’s commands, with reasons for what is off', async () => {
    tab.query = new URLSearchParams('file=12');
    bridge.handlers.set('pdf:open', async () => view({ state: 'opening' }));
    bridge.handlers.set('pdf:state', async () => view({ gates: { print: 'Your organization does not allow printing PDFs.', download: null, copy: null, externalLinks: null } }));
    render(<PdfStudio tabId="t1" route="/pdf?file=12" active />);
    expect(await screen.findByText('Read only')).toBeTruthy();
    expect(vi.mocked(call)).toHaveBeenCalledWith('pdf:open', { source: { kind: 'drive', fileId: 12 } });
    expect(screen.getByText('Tender.pdf')).toBeTruthy();
    const ribbon = screen.getByRole('tablist', { name: 'Ribbon' });
    expect(within(ribbon).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Home', 'View', 'Review']);
    const save = screen.getByRole('button', { name: /Save/ });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(save.getAttribute('title')).toMatch(/saving arrive in a later update/);
    const print = screen.getAllByRole('button', { name: /Print/ }).find((b) => b.getAttribute('aria-disabled') === 'true')!;
    expect(print.getAttribute('title')).toBe('Your organization does not allow printing PDFs.');
    expect(screen.getByRole('document', { name: 'PDF pages' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Page number' }) as HTMLInputElement).value).toBe('1');
    expect(screen.getByText('/ 3')).toBeTruthy();
    // The §4.3 shortcuts are registered while the tab is in front.
    expect(getCommand('pdf-find')).toBeTruthy();
    expect(getCommand('pdf-print')).toBeTruthy();
    expect(getCommand('pdf-open')).toBeTruthy();
    act(() => getCommand('pdf-save')!.run());
    expect(toast).toHaveBeenCalledWith('info', expect.stringMatching(/Viewing only/));
  });

  it('shows the password prompt and sends the password with "remember for this session"', async () => {
    tab.query = new URLSearchParams('file=12');
    bridge.handlers.set('pdf:open', async () => view({ state: 'password', password: { attempts: 0, wrong: false } }));
    bridge.handlers.set('pdf:state', async () => view({ state: 'password', password: { attempts: 1, wrong: true } }));
    let sent: unknown = null;
    bridge.handlers.set('pdf:unlock', async (input) => {
      sent = input;
      return view();
    });
    render(<PdfStudio tabId="t1" route="/pdf?file=12" active />);
    expect(await screen.findByText('Enter PDF password')).toBeTruthy();
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('PDF password'), { target: { value: 'open sesame' } });
    fireEvent.click(screen.getByLabelText('Remember for this session'));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(sent).toEqual({ session: SID, password: 'open sesame', remember: true }));
    expect(await screen.findByText('Read only')).toBeTruthy();
  });

  it('streams search results into the panel and says when it is done (PDF-SRCH-003/004)', async () => {
    tab.query = new URLSearchParams('file=12');
    bridge.handlers.set('pdf:open', async () => view());
    bridge.handlers.set('pdf:state', async () => view());
    bridge.handlers.set('pdf:search', async () => ({ searchId: 's1' }));
    render(<PdfStudio tabId="t1" route="/pdf?file=12" active />);
    await screen.findByText('Read only');
    act(() => getCommand('pdf-find')!.run());
    const input = await screen.findByLabelText('Find in this PDF');
    fireEvent.change(input, { target: { value: 'penalty' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('pdf:search', { session: SID, query: 'penalty', options: { matchCase: false, wholeWord: false, regex: false, comments: false, bookmarks: false } }));
    await waitFor(() => expect(screen.getByText(/Searching… page 0 of 3/)).toBeTruthy());
    emit('pdf:search', { session: SID, searchId: 's1', pageCount: 3, pagesDone: 2, done: false, truncated: false, error: null, hits: [{ source: 'text', page: 1, index: 5, before: 'the ', match: 'penalty', after: ' clause', rects: [[10, 20, 30, 10]] }] });
    emit('pdf:search', { session: SID, searchId: 'old', pageCount: 3, pagesDone: 3, done: true, truncated: false, error: null, hits: [{ source: 'text', page: 2, index: 1, before: '', match: 'stale', after: '', rects: [] }] });
    emit('pdf:search', { session: SID, searchId: 's1', pageCount: 3, pagesDone: 3, done: true, truncated: false, error: null, hits: [] });
    const results = screen.getByRole('list', { name: 'Search results' });
    expect(within(results).getAllByRole('button')).toHaveLength(1);
    expect(results.textContent).toContain('Page 2');
    expect(results.textContent).toContain('the penalty clause');
    expect(screen.getByText('1 result')).toBeTruthy();
  });

  it('warns about blocked active content and a colleague’s edit lock', async () => {
    tab.query = new URLSearchParams('file=12');
    bridge.handlers.set('pdf:open', async () => view({ security: { ...emptySecurity(), javascript: 2, launchActions: 1 }, lock: { holder: 'Samali', mine: false } }));
    bridge.handlers.set('pdf:state', async () => view({ security: { ...emptySecurity(), javascript: 2, launchActions: 1 }, lock: { holder: 'Samali', mine: false } }));
    render(<PdfStudio tabId="t1" route="/pdf?file=12" active />);
    expect(await screen.findByText(/Active content in this PDF was blocked: 2 scripts, 1 launch action/)).toBeTruthy();
    expect(screen.getByText(/Samali is editing this PDF/)).toBeTruthy();
  });

  it('offers Retry and the problem report when the engine stopped (PDF-NFR-010)', async () => {
    tab.query = new URLSearchParams('file=12');
    bridge.handlers.set('pdf:open', async () => view({ state: 'failed', error: { code: 'crashed', message: 'The PDF engine stopped unexpectedly.', retry: true } }));
    bridge.handlers.set('pdf:state', async () => view({ state: 'failed', error: { code: 'crashed', message: 'The PDF engine stopped unexpectedly.', retry: true } }));
    bridge.handlers.set('pdf:retry', async () => view({ state: 'opening' }));
    render(<PdfStudio tabId="t1" route="/pdf?file=12" active />);
    expect(await screen.findByText('The PDF engine stopped unexpectedly.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }));
    expect(tab.navigate).toHaveBeenCalledWith('/pdf?view=diagnostics');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('pdf:retry', { session: SID }));
    expect(await screen.findByText(/Opening Tender.pdf/)).toBeTruthy();
  });

  it('closes its session when the tab closes, and registers no shortcuts while in the background', async () => {
    tab.query = new URLSearchParams('file=12');
    tab.active = false;
    bridge.handlers.set('pdf:open', async () => view());
    bridge.handlers.set('pdf:state', async () => view());
    const r = render(<PdfStudio tabId="t1" route="/pdf?file=12" active={false} />);
    await screen.findByText('Read only');
    expect(getCommand('pdf-find')).toBeUndefined();
    r.unmount();
    expect(vi.mocked(call)).toHaveBeenCalledWith('pdf:close', { session: SID });
  });
});

describe('PDF Studio home and diagnostics', () => {
  it('opens the PDFs chosen in the main process’s dialog: the first here, the rest in tabs of their own', async () => {
    bridge.handlers.set('pdf:pickLocal', async () => [{ handle: 'aaaaaaaa-1111', name: 'A.pdf', size: 1 }]);
    render(<PdfStudio tabId="t1" route="/pdf" active />);
    fireEvent.click(screen.getByRole('button', { name: 'Open a PDF…' }));
    await waitFor(() => expect(tab.go).toHaveBeenCalledWith('/pdf?local=aaaaaaaa-1111'));
  });

  it('lists every PDF Diagnostics check, with this window’s own drawing check', async () => {
    tab.query = new URLSearchParams('view=diagnostics');
    bridge.handlers.set('pdf:diagnostics', async () => ({
      checks: [
        { id: 'engine', label: 'PDF engine', status: 'pass', detail: 'PDFium (WebAssembly)' },
        { id: 'worker', label: 'PDF worker', status: 'pass', detail: 'started' },
        { id: 'fonts', label: 'Fonts', status: 'pass', detail: 'built in' },
        { id: 'ocr', label: 'OCR engine', status: 'skip', detail: 'Not part of this version of PDF Studio.' },
      ],
      failures: [{ at: '2026-09-29T10:00:00Z', stage: 'worker', code: 'crashed', format: 'PDF 1.7', size: 2048, pages: 3, engine: 'x', appVersion: '0.2.56' }],
    }));
    render(<PdfStudio tabId="t1" route="/pdf?view=diagnostics" active />);
    expect(await screen.findByText('PDF engine')).toBeTruthy();
    expect(screen.getByText('Page drawing')).toBeTruthy();
    expect(screen.getByText(/worker · crashed · PDF 1.7, 2 KB, 3 pages/)).toBeTruthy();
  });
});
