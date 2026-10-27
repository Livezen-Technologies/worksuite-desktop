// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyEditState, emptySecurity, type PdfSessionView } from '../../../shared/pdf';

/**
 * PDF Studio's tools (WS-PDF-ENH-01 T01–T26): the registry, the home rail
 * and its pages, the All tools panel in a document, the panels that already
 * act (signing as a mark, finding redaction patterns, Bates numbers) and the
 * ones that say why they cannot run yet.
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
const { default: PdfStudio } = await import('../../../src/modules/pdf/PdfStudio');
const tools = await import('../../../src/modules/pdf/tools');
const parts = await import('../../../src/modules/pdf/parts');
const recent = await import('../../../src/modules/pdf/recent');
const { maskMatch } = await import('../../../src/modules/pdf/ToolPanels');

const SID = '0f8fad5b-d9cb-469f-a165-70867728950e';
function view(over: Partial<PdfSessionView> = {}): PdfSessionView {
  return {
    id: SID,
    state: 'ready',
    name: 'Tender.pdf',
    source: { kind: 'drive', fileId: 12, version: 4, label: 'WorkSuite Drive' },
    mode: 'VIEW',
    saveState: 'read-only',
    edit: emptyEditState(),
    readOnly: '',
    size: 1234,
    pageCount: 3,
    pages: [
      [612, 792],
      [612, 792],
      [612, 792],
    ],
    info: null,
    permissions: null,
    security: emptySecurity(),
    capabilities: null,
    gates: { print: null, download: null, copy: null, externalLinks: null },
    lock: null,
    password: null,
    error: null,
    ...over,
  };
}

HTMLCanvasElement.prototype.getContext = (() => null) as never;

beforeEach(() => {
  bridge.listeners.clear();
  bridge.handlers.clear();
  vi.mocked(call).mockClear();
  vi.mocked(toast).mockClear();
  localStorage.clear();
  recent.resetRecentCache();
  tab.query = new URLSearchParams();
  tab.go = vi.fn();
  tab.navigate = vi.fn();
  bridge.handlers.set('pdf:render', () => new Promise(() => undefined));
  bridge.handlers.set('pdf:thumbnail', () => new Promise(() => undefined));
  bridge.handlers.set('pdf:links', async () => []);
  bridge.handlers.set('pdf:close', async () => undefined);
  bridge.handlers.set('pdf:annotations', async () => []);
});
afterEach(cleanup);

describe('the tool registry (ENH-01 §4.1)', () => {
  it('has every Acrobat-class tool once, each with screens, a permission and — unless ready — what is missing', () => {
    const ids = tools.ALL_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(22);
    // Nothing of these works anywhere yet, so they are not listed (D-G12).
    expect(tools.ALL_TOOLS.filter((t) => t.hidden).map((t) => t.id)).toEqual(['standards', 'print-production', 'measure']);
    expect(tools.TOOLS).toHaveLength(19);
    for (const t of tools.ALL_TOOLS) {
      expect(t.screens.length).toBeGreaterThan(0);
      expect(t.permission).toMatch(/^files\.pdf\./);
      if (t.status !== 'ready') expect(t.missing.length).toBeGreaterThan(0);
      if (t.status === 'partial') expect(t.works).toBeTruthy();
      expect(tools.toolGate(t) === null).toBe(t.status !== 'ui');
      // What does not run here says what it needs, never a bare "not yet".
      if (t.status === 'ui' && !t.hidden) expect(t.needs).toBeTruthy();
    }
  });

  it('searches by name, group and tool number', () => {
    expect(tools.searchTools('redact').map((t) => t.id)).toEqual(['redact']);
    expect(tools.searchTools('T23').map((t) => t.id)).toEqual(['bates']);
    expect(tools.searchTools('protect').map((t) => t.id)).toEqual(expect.arrayContaining(['protect', 'redact', 'certificates']));
    expect(tools.searchTools('')).toHaveLength(tools.TOOLS.length);
  });

  it('finds Sri Lankan NIC numbers (old and new), phone numbers and emails', () => {
    expect(tools.matchesPattern('nic', 'NIC 881234567V')).toBe(true);
    expect(tools.matchesPattern('nic', 'NIC 198812345678')).toBe(true);
    expect(tools.matchesPattern('nic', 'Ref 12345')).toBe(false);
    expect(tools.matchesPattern('phone', '+94 77 123 4567')).toBe(true);
    expect(tools.matchesPattern('phone', '0711234567')).toBe(true);
    expect(tools.matchesPattern('email', 'kamala.w@example.lk')).toBe(true);
    expect(maskMatch('198812345678')).toBe('19••••••••78');
  });

  it('numbers pages for Bates and rates passwords', () => {
    expect(parts.batesNumber('LZT-', 1, 6, '-CFX', 0)).toBe('LZT-000001-CFX');
    expect(parts.batesNumber('LZT-', 1, 6, '', 145)).toBe('LZT-000146');
    expect(parts.strength('').score).toBe(0);
    expect(parts.strength('abc').label).toBe('Too short');
    expect(parts.strength('Correct-Horse-9').label).toBe('Strong');
  });
});

describe('home (DK01)', () => {
  it('shows the rail, the tool grid and an empty Recent', () => {
    render(<PdfStudio tabId="t1" route="/pdf" active />);
    const rail = screen.getByRole('navigation', { name: 'PDF Studio' });
    for (const s of ['Home', 'Recent', 'Starred', 'Shared with me', 'Agreements', 'Scans', 'Offline copies', 'All tools', 'Jobs', 'Action wizard', 'Settings', 'Organization policy', 'Diagnostics']) {
      expect(within(rail).getByRole('button', { name: s })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: /Request e-signatures/ })).toBeTruthy();
    expect(screen.getByText('PDFs you open in PDF Studio are listed here.')).toBeTruthy();
    fireEvent.click(within(rail).getByRole('button', { name: 'Jobs' }));
    expect(tab.navigate).toHaveBeenCalledWith('/pdf?view=jobs');
  });

  it('opens a tool that needs a PDF by asking for one, and a document-less tool as a page', async () => {
    bridge.handlers.set('pdf:pickLocal', async () => [{ handle: 'aaaaaaaa-1111', name: 'A.pdf', size: 1 }]);
    render(<PdfStudio tabId="t1" route="/pdf" active />);
    fireEvent.click(screen.getByRole('button', { name: /Redact a PDF/ }));
    await waitFor(() => expect(tab.go).toHaveBeenCalledWith('/pdf?local=aaaaaaaa-1111&tool=redact'));
    fireEvent.click(screen.getByRole('button', { name: /Create a PDF/ }));
    expect(tab.navigate).toHaveBeenCalledWith('/pdf?view=tool&tool=create');
  });

  it('lists recent PDFs with star and remove', () => {
    recent.recordOpened('/pdf?file=12', view());
    tab.query = new URLSearchParams('view=recent');
    render(<PdfStudio tabId="t1" route="/pdf?view=recent" active />);
    expect(screen.getByRole('button', { name: 'Tender.pdf' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Star Tender.pdf' }));
    expect(JSON.parse(localStorage.getItem('pdf.recent')!)[0].starred).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Tender.pdf from Recent' }));
    expect(screen.getByText('PDFs you open in PDF Studio are listed here.')).toBeTruthy();
  });

  it('shows each page: tools with their gaps, jobs, settings, the policy and a document-less tool', () => {
    for (const [v, text] of [
      ['tools', /tools, grouped as in Acrobat Pro/],
      ['jobs', 'Server jobs are not connected in this version'],
      ['settings', 'Settings › PDF Studio'],
      ['admin', 'PDF Studio policy'],
      ['agreements', 'E-signature agreements need the server'],
      ['recovery', 'Unsaved changes are kept on this computer'],
    ] as const) {
      tab.query = new URLSearchParams(`view=${v}`);
      render(<PdfStudio tabId="t1" route={`/pdf?view=${v}`} active />);
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
      cleanup();
    }
    tab.query = new URLSearchParams('view=tool&tool=bates');
    render(<PdfStudio tabId="t1" route="/pdf?view=tool&tool=bates" active />);
    expect(screen.getByLabelText('Bates preview').textContent).toBe('LZT-000001 … LZT-000001');
    const run = screen.getByRole('button', { name: 'Add Bates numbers' }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(screen.getByText('Open a PDF first.')).toBeTruthy();
  });
});

describe('All tools in a document (DK02)', () => {
  it('opens the panel, a tool, and back', async () => {
    tab.query = new URLSearchParams('file=12');
    bridge.handlers.set('pdf:open', async () => view());
    bridge.handlers.set('pdf:state', async () => view());
    render(<PdfStudio tabId="t1" route="/pdf?file=12" active />);
    fireEvent.click(await screen.findByRole('button', { name: 'All tools' }));
    const panel = screen.getByRole('complementary', { name: 'Tools panel' });
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Search tools' }), { target: { value: 'export' } });
    fireEvent.click(within(panel).getByRole('button', { name: /Export a PDF/ }));
    expect(within(panel).getByRole('heading', { name: 'Export a PDF' })).toBeTruthy();
    expect(within(panel).getByText(/Tender\.pdf · 1\.2 KB|Tender\.pdf · 1 KB|Tender\.pdf ·/)).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: '‹ All tools' }));
    expect(within(panel).getByRole('textbox', { name: 'Search tools' })).toBeTruthy();
    // Opening a PDF puts it in Recent.
    expect(JSON.parse(localStorage.getItem('pdf.recent')!)[0]).toMatchObject({ route: '/pdf?file=12', name: 'Tender.pdf', version: 4 });
  });

  it('signs with a typed name as a mark on the current page, only in Annotate', async () => {
    tab.query = new URLSearchParams('file=12&tool=fill-sign');
    const annotating = view({ mode: 'ANNOTATE', saveState: 'saved', edit: { ...emptyEditState(), modes: ['VIEW', 'ANNOTATE'], canAnnotate: true } });
    bridge.handlers.set('pdf:open', async () => annotating);
    bridge.handlers.set('pdf:state', async () => annotating);
    bridge.handlers.set('pdf:edit', async () => annotating);
    render(<PdfStudio tabId="t1" route="/pdf?file=12&tool=fill-sign" active />);
    const panel = await screen.findByRole('complementary', { name: 'Tools panel' });
    fireEvent.click(within(panel).getByRole('radio', { name: /Type/ }));
    const place = within(panel).getByRole('button', { name: 'Place signature' }) as HTMLButtonElement;
    expect(place.disabled).toBe(true);
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Type your name' }), { target: { value: 'R. Jayawardena' } });
    fireEvent.click(place);
    await waitFor(() =>
      expect(vi.mocked(call)).toHaveBeenCalledWith('pdf:edit', {
        session: SID,
        op: { op: 'annot.add', page: 0, annot: expect.objectContaining({ kind: 'text', text: 'R. Jayawardena', fontSize: 22 }) },
      }),
    );
  });

  it('finds redaction patterns with the engine’s search and lists them masked', async () => {
    tab.query = new URLSearchParams('file=12&tool=redact');
    bridge.handlers.set('pdf:open', async () => view());
    bridge.handlers.set('pdf:state', async () => view());
    let n = 0;
    bridge.handlers.set('pdf:search', async () => ({ searchId: `s${++n}` }));
    render(<PdfStudio tabId="t1" route="/pdf?file=12&tool=redact" active />);
    const panel = await screen.findByRole('complementary', { name: 'Tools panel' });
    // Only NIC.
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Sri Lankan phone numbers' }));
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Email addresses' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Find' }));
    await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('pdf:search', expect.objectContaining({ session: SID, options: expect.objectContaining({ regex: true }) })));
    await act(async () => {
      bridge.listeners.get('pdf:search')?.forEach((cb) => cb({ session: SID, searchId: 's1', hits: [{ source: 'text', page: 1, index: 4, before: '', match: '198812345678', after: '', rects: [[10, 20, 50, 10]] }], pagesDone: 3, pageCount: 3, done: true, truncated: false, error: null }));
    });
    expect(await within(panel).findByText('1 found to review')).toBeTruthy();
    expect(within(panel).getByText('19••••••••78')).toBeTruthy();
    expect(within(panel).queryByText('198812345678')).toBeNull();
  });
});

describe('tools on this computer (D-G12)', () => {
  const editing = () => view({ mode: 'EDIT', saveState: 'saved', source: { kind: 'local', handle: 'aaaaaaaa-1111', label: 'This computer' } as never, edit: { ...emptyEditState(), modes: ['VIEW', 'ANNOTATE', 'EDIT'], canAnnotate: true, canOrganize: true } });
  const openTool = async (tool: string, v: PdfSessionView) => {
    tab.query = new URLSearchParams(`file=12&tool=${tool}`);
    bridge.handlers.set('pdf:open', async () => v);
    bridge.handlers.set('pdf:state', async () => v);
    bridge.handlers.set('pdf:edit', async () => v);
    render(<PdfStudio tabId="t1" route={`/pdf?file=12&tool=${tool}`} active />);
    return screen.findByRole('complementary', { name: 'Tools panel' });
  };

  it('stamps Bates numbers on the pages chosen, as an edit', async () => {
    const panel = await openTool('bates', editing());
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Pages' }), { target: { value: '2-3' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Add Bates numbers' }));
    await waitFor(() =>
      expect(vi.mocked(call)).toHaveBeenCalledWith('pdf:edit', { session: SID, op: { op: 'page.stamp', pages: [1, 2], stamp: expect.objectContaining({ text: '{bates}', place: 'bottom-right', bates: { prefix: 'LZT-', start: 1, digits: 6, suffix: '' } }) } }),
    );
  });

  it('draws a header and a diagonal watermark', async () => {
    const panel = await openTool('bates', editing());
    fireEvent.click(within(panel).getByRole('radio', { name: /Watermark/ }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Add watermark' }));
    await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('pdf:edit', { session: SID, op: { op: 'page.stamp', pages: [0, 1, 2], stamp: expect.objectContaining({ text: 'CONFIDENTIAL', diagonal: true }) } }));
  });

  it('redacts what was found, page by page, after review', async () => {
    let n = 0;
    bridge.handlers.set('pdf:search', async () => ({ searchId: `s${++n}` }));
    const panel = await openTool('redact', editing());
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Sri Lankan phone numbers' }));
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Email addresses' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Find' }));
    await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('pdf:search', expect.anything()));
    await act(async () => {
      bridge.listeners.get('pdf:search')?.forEach((cb) => cb({ session: SID, searchId: 's1', hits: [{ source: 'text', page: 1, index: 4, before: '', match: '198812345678', after: '', rects: [[10, 20, 50, 10]] }], pagesDone: 3, pageCount: 3, done: true, truncated: false, error: null }));
    });
    fireEvent.click(await within(panel).findByRole('button', { name: 'Redact 1 found' }));
    await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('pdf:edit', { session: SID, op: { op: 'page.redact', page: 1, rects: [[9, 19, 52, 12]] } }));
    expect(await within(panel).findByText(/Redacted 1 found/)).toBeTruthy();
  });

  it('protects a copy with the permissions chosen, and needs a permissions password', async () => {
    bridge.handlers.set('pdf:derive', async () => ({ saved: true, files: 1, name: 'Tender (protected).pdf', open: { handle: 'bbbbbbbb-2222', name: 'Tender (protected).pdf', size: 10 } }));
    const panel = await openTool('protect', editing());
    const run = within(panel).getByRole('button', { name: 'Protect as copy…' }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    const [openPw, permPw] = within(panel).getAllByLabelText(/password/i).filter((e) => e.tagName === 'INPUT') as HTMLInputElement[];
    fireEvent.change(openPw!, { target: { value: 'open-me' } });
    fireEvent.change(permPw!, { target: { value: 'owner-pw' } });
    fireEvent.click(within(panel).getByRole('checkbox', { name: /Copying text/ }));
    fireEvent.click(run);
    await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('pdf:derive', { session: SID, req: { kind: 'protect', userPassword: 'open-me', ownerPassword: 'owner-pw', allow: { print: true, copy: true, modify: false, annotate: true } } }));
    fireEvent.click(await within(panel).findByRole('button', { name: 'Open it' }));
    expect(tab.navigate).toHaveBeenCalledWith('/pdf?local=bbbbbbbb-2222');
  });

  it('exports page images and text, and says Office formats need WorkSuite Office', async () => {
    bridge.handlers.set('pdf:derive', async () => ({ saved: true, files: 3, name: 'Exports', open: null }));
    const panel = await openTool('export', view());
    fireEvent.click(within(panel).getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('pdf:derive', { session: SID, req: { kind: 'images', pages: [0, 1, 2], dpi: 150 } }));
    fireEvent.click(within(panel).getByRole('radio', { name: /Word, Excel/ }));
    expect(within(panel).getByText('Needs WorkSuite Office')).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Export' })).toBeNull();
  });

  it('duplicates pages and splits into files from Organize', async () => {
    bridge.handlers.set('pdf:derive', async () => ({ saved: true, files: 2, name: 'Parts', open: null }));
    const panel = await openTool('organize', editing());
    fireEvent.change(within(panel).getByRole('textbox', { name: /Pages to duplicate/ }), { target: { value: '1' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('pdf:edit', { session: SID, op: { op: 'page.duplicate', pages: [0], at: 1 } }));
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Pages in each file' }), { target: { value: '2' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Split…' }));
    await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('pdf:derive', { session: SID, req: { kind: 'split', groups: [[0, 1], [2]] } }));
  });

  it('combines PDFs from this computer, and makes blank pages, with no document open', async () => {
    bridge.handlers.set('pdf:pickLocal', async () => [{ handle: 'aaaaaaaa-1111', name: 'A.pdf', size: 1 }, { handle: 'cccccccc-3333', name: 'B.pdf', size: 1 }]);
    bridge.handlers.set('pdf:compose', async () => ({ saved: true, files: 1, name: 'Combined.pdf', open: null }));
    tab.query = new URLSearchParams('view=tool&tool=combine');
    render(<PdfStudio tabId="t1" route="/pdf?view=tool&tool=combine" active />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add from this computer' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Pages of B.pdf' }), { target: { value: '2-3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Combine' }));
    await waitFor(() =>
      expect(vi.mocked(call)).toHaveBeenCalledWith('pdf:compose', { req: { kind: 'combine', parts: [{ file: 'aaaaaaaa-1111', title: 'A' }, { file: 'cccccccc-3333', pages: [1, 2], title: 'B' }], bookmarks: true, name: 'Combined.pdf' } }),
    );
    cleanup();
    tab.query = new URLSearchParams('view=tool&tool=create');
    render(<PdfStudio tabId="t1" route="/pdf?view=tool&tool=create" active />);
    fireEvent.click(screen.getByRole('radio', { name: /Blank pages/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(vi.mocked(call)).toHaveBeenCalledWith('pdf:compose', { req: { kind: 'blank', pages: 1, size: 'a4', landscape: false, name: 'New PDF.pdf' } }));
  });

  it('shows a server tool as needing the WorkSuite server, with the Pro panel for a Drive PDF — no button that is always off', async () => {
    const panel = await openTool('compare', view());
    expect(within(panel).getByText('Needs the WorkSuite server')).toBeTruthy();
    const pro = within(panel).getByRole('button', { name: 'Open the Pro panel' }) as HTMLButtonElement;
    expect(pro.disabled).toBe(false);
    expect(within(panel).queryByRole('button', { name: 'Compare' })).toBeNull();
    for (const b of within(panel).queryAllByRole('button') as HTMLButtonElement[]) expect(b.disabled, b.textContent ?? '').toBe(false);
  });
});
