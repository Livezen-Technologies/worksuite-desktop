// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyEditState, emptySecurity, type PdfEditState, type PdfSessionView } from '../../../shared/pdf';

/**
 * PDF Studio's editing in the window (stage D2): the mode switch, the save
 * state and Save, the Annotate and Organize ribbons, the conflict's
 * choices, recovered work, and what reaches the main process — operations,
 * never the document.
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
  DesktopError: class DesktopError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ tabId: 't1', route: '/pdf?file=12', active: true, path: ['pdf'], query: new URLSearchParams('file=12'), go: () => undefined, navigate: () => undefined, openInNewTab: () => undefined, openInWindow: () => undefined, setTitle: () => undefined, openLink: () => undefined }),
  useTabTitle: () => undefined,
}));

const { call, DesktopError } = await import('../../../src/core/bridge');
const { toast } = await import('../../../src/core/toasts');
const { getCommand } = await import('../../../src/core/commands');
const { default: PdfStudio } = await import('../../../src/modules/pdf/PdfStudio');
const { moveTarget, saveLabel } = await import('../../../src/modules/pdf/edit');

const SID = '0f8fad5b-d9cb-469f-a165-70867728950e';
function view(over: Partial<PdfSessionView> = {}, edit: Partial<PdfEditState> = {}): PdfSessionView {
  return {
    id: SID,
    state: 'ready',
    name: 'Tender.pdf',
    source: { kind: 'drive', fileId: 12, version: 4, label: 'WorkSuite Drive' },
    mode: 'VIEW',
    saveState: 'saved',
    edit: { ...emptyEditState(), modes: ['VIEW', 'ANNOTATE', 'EDIT'], canAnnotate: true, canOrganize: true, canSaveVersion: true, canSaveCopy: true, ...edit },
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

const calls = (channel: string) => vi.mocked(call).mock.calls.filter((c) => c[0] === channel).map((c) => c[1]);

HTMLCanvasElement.prototype.getContext = (() => null) as never;

async function open(v: PdfSessionView) {
  bridge.handlers.set('pdf:open', async () => v);
  bridge.handlers.set('pdf:state', async () => v);
  render(<PdfStudio tabId="t1" route="/pdf?file=12" active />);
  await screen.findByText('Tender.pdf');
}

beforeEach(() => {
  bridge.listeners.clear();
  bridge.handlers.clear();
  vi.mocked(call).mockClear();
  vi.mocked(toast).mockClear();
  bridge.handlers.set('pdf:render', () => new Promise(() => undefined));
  bridge.handlers.set('pdf:thumbnail', () => new Promise(() => undefined));
  bridge.handlers.set('pdf:links', async () => []);
  bridge.handlers.set('pdf:annotations', async () => []);
  bridge.handlers.set('pdf:close', async () => undefined);
});
afterEach(cleanup);

describe('modes and saving', () => {
  it('offers the modes the server allows, and Annotate brings its ribbon', async () => {
    await open(view());
    const modes = screen.getByRole('radiogroup', { name: 'Mode' });
    expect(within(modes).getAllByRole('radio').map((r) => r.textContent)).toEqual(['View', 'Annotate', 'Edit']);
    bridge.handlers.set('pdf:mode', async () => view({ mode: 'ANNOTATE' }));
    fireEvent.click(within(modes).getByRole('radio', { name: 'Annotate' }));
    await waitFor(() => expect(within(screen.getByRole('tablist', { name: 'Ribbon' })).getAllByRole('tab').map((t) => t.textContent)).toContain('Annotate'));
    expect(calls('pdf:mode')).toEqual([{ session: SID, mode: 'ANNOTATE' }]);
    fireEvent.click(screen.getByRole('tab', { name: 'Annotate' }));
    expect(screen.getByRole('button', { name: /Highlight/ })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Colour' })).toBeTruthy();
  });

  it('offers taking the lock over when the server refuses Edit and says it may', async () => {
    await open(view({}, { mayTakeOver: true }));
    bridge.handlers.set('pdf:mode', async () => {
      throw new DesktopError('FILE_LOCKED', 'Nimal is editing this PDF.');
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Edit' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('warning', 'Nimal is editing this PDF.', expect.objectContaining({ label: 'Take over' })));
    bridge.handlers.set('pdf:mode', async () => view({ mode: 'EDIT' }));
    const action = vi.mocked(toast).mock.calls[0]![2] as { run: () => void };
    await act(async () => action.run());
    expect(calls('pdf:mode').at(-1)).toEqual({ session: SID, mode: 'EDIT', takeover: true });
  });

  it('shows unsaved changes, saves a version with Ctrl/⌘ S, and undoes', async () => {
    await open(view({ mode: 'ANNOTATE', saveState: 'unsaved' }, { undo: 2, summary: { ...emptyEditState().summary, annotations_added: 2 } }));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    bridge.handlers.set('pdf:save', async () => view({ saveState: 'saved' }, { lastSaved: { version: 5, copyFileId: null, at: '' } }));
    await act(async () => getCommand('pdf-save')!.run());
    expect(calls('pdf:save')).toEqual([{ session: SID, target: 'version' }]);
    expect(await screen.findByText('Saved · v5')).toBeTruthy();
  });

  it('undoes from the title bar, and Undo is off with nothing to undo', async () => {
    await open(view({ mode: 'ANNOTATE', saveState: 'unsaved' }, { undo: 1 }));
    bridge.handlers.set('pdf:undo', async () => view({ mode: 'ANNOTATE', saveState: 'saved' }, { undo: 0, redo: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(calls('pdf:undo')).toEqual([{ session: SID }]));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends Ctrl/⌘ Z to a text field that has the keyboard, not to the document', async () => {
    await open(view({ mode: 'ANNOTATE', saveState: 'unsaved' }, { undo: 1 }));
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: typeof exec }).execCommand = exec;
    const input = screen.getByRole('textbox', { name: 'Page number' });
    input.focus();
    await act(async () => getCommand('pdf-undo')!.run());
    expect(exec).toHaveBeenCalledWith('undo');
    expect(calls('pdf:undo')).toEqual([]);
    input.blur();
    bridge.handlers.set('pdf:undo', async () => view({ saveState: 'saved' }));
    await act(async () => getCommand('pdf-undo')!.run());
    expect(calls('pdf:undo')).toEqual([{ session: SID }]);
  });

  it('answers a conflict with the server’s choices', async () => {
    await open(view({ saveState: 'unsaved' }, { conflict: { baseVersion: 4, serverVersion: 5, savedBy: 'Nimal', savedAt: null, offline: false, message: 'This PDF changed in WorkSuite since your copy was opened.' } }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Version 5 was saved by Nimal/)).toBeTruthy();
    bridge.handlers.set('pdf:resolve', async () => view({ saveState: 'unsaved' }, { lastSaved: { version: null, copyFileId: 99, at: '' } }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Keep both/ }));
    await waitFor(() => expect(calls('pdf:resolve')).toEqual([{ session: SID, answer: 'keep_both' }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('says recovered work is back, and discards it on request', async () => {
    await open(view({ saveState: 'unsaved' }, { recovered: true, message: 'Unsaved changes from yesterday were kept on this computer and are back.' }));
    expect(screen.getByText(/kept on this computer and are back/)).toBeTruthy();
    bridge.handlers.set('pdf:discard', async () => view({ saveState: 'saved' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard them' }));
    await waitFor(() => expect(calls('pdf:discard')).toEqual([{ session: SID }]));
  });

  it('is read-only with the server’s reason when it allows only viewing', async () => {
    await open(view({ saveState: 'read-only' }, { modes: ['VIEW'], canAnnotate: false, canOrganize: false, canSaveVersion: false, canSaveCopy: false, reason: 'You can view this PDF, but you don’t have permission to change it.' }));
    expect(screen.queryByRole('radiogroup', { name: 'Mode' })).toBeNull();
    const chip = screen.getByText('Read only').closest('span[title]')!;
    expect(chip.getAttribute('title')).toBe('You can view this PDF, but you don’t have permission to change it.');
  });
});

describe('organising pages', () => {
  it('rotates, deletes and moves the pages chosen in the grid, as operations', async () => {
    await open(view({ mode: 'EDIT', saveState: 'saved' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Organize' }));
    const grid = screen.getByRole('listbox', { name: 'Pages' });
    const pages = within(grid).getAllByRole('option');
    expect(pages).toHaveLength(3);
    fireEvent.click(pages[1]!);
    fireEvent.click(pages[2]!, { shiftKey: true });
    bridge.handlers.set('pdf:edit', async () => view({ mode: 'EDIT', saveState: 'unsaved' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate right' }));
    await waitFor(() => expect(calls('pdf:edit')).toEqual([{ session: SID, op: { op: 'page.rotate', pages: [1, 2], by: 90 } }]));
    fireEvent.click(screen.getByRole('button', { name: 'Move earlier' }));
    await waitFor(() => expect(calls('pdf:edit').at(-1)).toEqual({ session: SID, op: { op: 'page.move', pages: [1, 2], to: 0 } }));
  });

  it('works out where dropped pages go', () => {
    expect(moveTarget([1, 2], 0)).toBe(0);
    expect(moveTarget([0, 1], 3)).toBe(1);
    expect(moveTarget([2], 1)).toBe(1);
  });
});

describe('the save state’s words (PDF-UI-003)', () => {
  it('names each state', () => {
    expect(saveLabel(view({ saveState: 'saved-locally' })).text).toBe('Saved on this computer');
    expect(saveLabel(view({ saveState: 'saving' })).text).toBe('Saving…');
    expect(saveLabel(view({ saveState: 'saved' })).text).toBe('No changes');
    expect(saveLabel(view({ saveState: 'read-only' })).text).toBe('Read only');
  });
});
