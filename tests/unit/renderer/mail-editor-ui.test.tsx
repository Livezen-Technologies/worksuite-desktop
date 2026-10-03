// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Mail composer's editor (worksuite-desktop#188), on screen: one row of
 * grouped tools with names, shortcuts and what is on; tools that do not fit
 * in More; the table and picture tools; paste options; and the keys —
 * which stop at the editor, so the app's own (Mod+K is Search) do not run
 * as well.
 */

vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/components/DriveFilePicker', () => ({ DriveFilePicker: () => null }));

import { MailEditor } from '../../../src/modules/mail/editor/MailEditor';
import { ToolbarRow } from '../../../src/modules/mail/editor/Toolbar';
import { quickPartsReason } from '../../../src/modules/mail/editor/ComposeActions';
import { cleanComposeHtml } from '../../../src/modules/mail/composeHtml';

let exec: ReturnType<typeof vi.fn>;

beforeEach(() => {
  exec = vi.fn((cmd: string, _ui: boolean, value?: string) => {
    const box = document.querySelector<HTMLElement>('[contenteditable]');
    if (!box) return false;
    if (cmd === 'insertHTML') box.innerHTML += value ?? '';
    return true;
  });
  Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
});
afterEach(cleanup);

function placeCaretIn(node: Node, offset = 0) {
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  const s = window.getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
  document.dispatchEvent(new Event('selectionchange'));
}

const ai = vi.fn();

function Editor({ initial = '', onChange = vi.fn(), onAttachInstead }: { initial?: string; onChange?: (h: string) => void; onAttachInstead?: (f: File) => void }) {
  const [v, setV] = useState(initial);
  return (
    <MailEditor
      value={v}
      clean={cleanComposeHtml}
      label="Message"
      placeholder="Write your message…"
      aiSections={[{ id: 'ai', items: [{ id: 'improve', label: 'Improve writing', onSelect: ai }] }]}
      onAttachInstead={onAttachInstead}
      onChange={(h) => {
        setV(h);
        onChange(h);
      }}
    />
  );
}

const TOOLS = ['Undo', 'Redo', 'Paragraph style', 'Font', 'Size', 'Bold', 'Italic', 'Underline', 'Strikethrough', 'Text colour', 'Highlight', 'Clear formatting', 'Format painter', 'Align', 'Bulleted list', 'Numbered list', 'Checklist', 'Decrease indent', 'Increase indent', 'Line spacing', 'Link', 'Image', 'Table', 'Emoji', 'More to insert', 'Write with AI'];

describe('the formatting row', () => {
  it('is one row of grouped tools, in order, with dividers, names and shortcuts', () => {
    render(<Editor />);
    const bar = screen.getByRole('toolbar', { name: 'Message formatting' });
    const names = within(bar)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(TOOLS);
    // History | Text | Format | Paragraph | Insert | AI
    expect(bar.querySelectorAll('[data-ov^="sep-"]')).toHaveLength(5);
    const tip = (n: string) => within(bar).getByRole('button', { name: n }).getAttribute('title');
    expect(tip('Bold')).toBe('Bold (Ctrl+B)');
    expect(tip('Link')).toBe('Link (Ctrl+K)');
    expect(tip('Strikethrough')).toBe('Strikethrough (Ctrl+Shift+X)');
    expect(tip('Image')).toBe('Image (Ctrl+Shift+I)');
    expect(tip('Table')).toBe('Table (Ctrl+Alt+T)');
    expect(tip('Write with AI')).toBe('Write with AI (Ctrl+J)');
    // 32px buttons, 18px icons; indent, outdent and line spacing look different.
    const bold = within(bar).getByRole('button', { name: 'Bold' });
    expect(bold.className).toContain('h-8');
    expect(bold.querySelector('svg')!.getAttribute('width')).toBe('18');
    const icon = (n: string) => within(bar).getByRole('button', { name: n }).querySelector('svg')!.getAttribute('class');
    expect(new Set([icon('Increase indent'), icon('Decrease indent'), icon('Line spacing')]).size).toBe(3);
    // The ones that open a menu say so.
    for (const n of ['Paragraph style', 'Font', 'Size', 'Align', 'Line spacing', 'Image', 'More to insert', 'Write with AI']) expect(within(bar).getByRole('button', { name: n }).getAttribute('aria-haspopup')).toBe('menu');
  });

  it('marks what is on at the caret with the accent', () => {
    render(<Editor />);
    const box = screen.getByRole('textbox', { name: 'Message' });
    act(() => {
      box.innerHTML = '<div>plain <b>bold</b></div><ol><li>one</li></ol><ul style="list-style-type: none"><li>☐ task</li></ul>';
      fireEvent.input(box);
    });
    const bar = screen.getByRole('toolbar', { name: 'Message formatting' });
    const bold = within(bar).getByRole('button', { name: 'Bold' });
    act(() => placeCaretIn(box.querySelector('b')!.firstChild!, 1));
    expect(bold.getAttribute('aria-pressed')).toBe('true');
    expect(bold.className).toContain('bg-selection');
    act(() => placeCaretIn(box.querySelector('ol li')!.firstChild!, 1));
    expect(bold.getAttribute('aria-pressed')).toBe('false');
    expect(within(bar).getByRole('button', { name: 'Numbered list' }).getAttribute('aria-pressed')).toBe('true');
    act(() => placeCaretIn(box.querySelector('ul li')!.firstChild!, 2));
    expect(within(bar).getByRole('button', { name: 'Checklist' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(bar).getByRole('button', { name: 'Bulleted list' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('puts what does not fit into More, by the row’s width', () => {
    const width = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!;
    const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!;
    let observed: (() => void) | null = null;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          observed = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    let room = 1000;
    Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get() { return (this as HTMLElement).hasAttribute('data-ov-row') ? room : 0; } });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { const k = (this as HTMLElement).dataset?.ov; return k ? (k.startsWith('sep') ? 9 : 32) : 0; } });
    try {
      const run = vi.fn();
      render(<ToolbarRow label="Tools" groups={[{ id: 'a', label: 'First', items: [1, 2, 3].map((i) => ({ id: `a${i}`, label: `A${i}`, icon: 'bold', run })) }, { id: 'b', label: 'Second', items: [1, 2, 3].map((i) => ({ id: `b${i}`, label: `B${i}`, icon: 'italic', run })) }]} />);
      expect(screen.queryByRole('button', { name: 'More tools' })).toBeNull();
      room = 150;
      act(() => observed!());
      const shown = within(screen.getByRole('toolbar', { name: 'Tools' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
      expect(shown).toEqual(['A1', 'A2', 'A3', 'More tools']);
      fireEvent.click(screen.getByRole('button', { name: 'More tools' }));
      const menu = screen.getByRole('menu', { name: 'More tools' });
      expect(within(menu).getByText('Second')).toBeTruthy();
      fireEvent.click(within(menu).getByRole('menuitem', { name: /B2/ }));
      expect(run).toHaveBeenCalled();
      room = 1000;
      act(() => observed!());
      expect(screen.queryByRole('button', { name: 'More tools' })).toBeNull();
    } finally {
      Object.defineProperty(Element.prototype, 'clientWidth', width);
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offset);
      vi.unstubAllGlobals();
    }
  });
});

describe('keys', () => {
  it('formats with the usual shortcuts, and stops them at the editor', () => {
    const app = vi.fn();
    window.addEventListener('keydown', app);
    try {
      render(<Editor initial="<div>One</div>" />);
      const box = screen.getByRole('textbox', { name: 'Message' });
      placeCaretIn(box.firstChild!.firstChild!, 1);
      const press = (key: string, more: Partial<KeyboardEventInit> & { code?: string } = {}) => fireEvent.keyDown(box, { key, ctrlKey: true, ...more });
      press('b');
      expect(exec).toHaveBeenLastCalledWith('bold', false, undefined);
      press('i');
      expect(exec).toHaveBeenLastCalledWith('italic', false, undefined);
      press('u');
      expect(exec).toHaveBeenLastCalledWith('underline', false, undefined);
      press('X', { shiftKey: true });
      expect(exec).toHaveBeenLastCalledWith('strikeThrough', false, undefined);
      press('&', { shiftKey: true, code: 'Digit7' });
      expect(exec).toHaveBeenLastCalledWith('insertOrderedList', false, undefined);
      press('*', { shiftKey: true, code: 'Digit8' });
      expect(exec).toHaveBeenLastCalledWith('insertUnorderedList', false, undefined);
      press('\\');
      expect(exec.mock.calls.some((c) => c[0] === 'removeFormat')).toBe(true);
      // Mod+K is the app's Search too: here it is the link, and the app never hears it.
      press('k');
      expect(screen.getByRole('textbox', { name: 'Link address' })).toBeTruthy();
      expect(app).not.toHaveBeenCalled();
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Link address' }), { key: 'Escape' });
      press('I', { shiftKey: true, code: 'KeyI' });
      expect(screen.getByRole('menu', { name: 'Image' })).toBeTruthy();
      expect(within(screen.getByRole('menu', { name: 'Image' })).getByRole('menuitem', { name: /Upload from computer/ })).toBeTruthy();
      fireEvent.keyDown(screen.getByRole('menu', { name: 'Image' }), { key: 'Escape' });
      press('†', { altKey: true, code: 'KeyT' });
      expect(screen.getByRole('grid', { name: 'Table size' })).toBeTruthy();
      press('j');
      fireEvent.click(within(screen.getByRole('menu', { name: 'Write with AI' })).getByRole('menuitem', { name: /Improve writing/ }));
      expect(ai).toHaveBeenCalled();
      expect(app).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', app);
    }
  });
});

describe('tables in the editor', () => {
  it('inserts from the grid, shows the table tools in a table, and adds a row on Tab in the last cell', () => {
    const change = vi.fn();
    render(<Editor onChange={change} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    fireEvent.click(screen.getByRole('gridcell', { name: '2 by 3 table' }));
    expect(change.mock.calls.at(-1)![0]).toMatch(/^<table border="1" cellpadding="6" cellspacing="0" width="100%"/);
    const box = screen.getByRole('textbox', { name: 'Message' });
    expect(box.querySelectorAll('tr')).toHaveLength(2);
    expect(box.querySelectorAll('tr:first-child td')).toHaveLength(3);

    act(() => placeCaretIn(box.querySelector('td')!, 0));
    const tools = screen.getByRole('toolbar', { name: 'Table tools' });
    fireEvent.click(within(tools).getByRole('button', { name: 'Insert row below' }));
    expect(box.querySelectorAll('tr')).toHaveLength(3);
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Table tools' })).getByRole('button', { name: 'Insert column right' }));
    expect(box.querySelectorAll('tr:first-child td')).toHaveLength(4);
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Table tools' })).getByRole('button', { name: 'Header row' }));
    expect(box.querySelectorAll('tr:first-child th')).toHaveLength(4);
    expect(change.mock.calls.at(-1)![0]).toContain('<th bgcolor="#f1f3f4"');

    const cells = box.querySelectorAll('td, th');
    act(() => placeCaretIn(cells[cells.length - 1]!, 0));
    fireEvent.keyDown(box, { key: 'Tab' });
    expect(box.querySelectorAll('tr')).toHaveLength(4);
    act(() => placeCaretIn(box.querySelector('td')!, 0));
    fireEvent.keyDown(box, { key: 'Tab' });
    const all = [...box.querySelectorAll('td, th')];
    expect(all.indexOf(window.getSelection()!.anchorNode as Element)).toBe(all.indexOf(box.querySelectorAll('td')[1]!));
  });
});

describe('pictures in the editor', () => {
  const SRC = 'data:image/png;base64,iVBORw0KGgo=';

  it('shows the picture tools for a selected picture: size, place, attach instead, remove', () => {
    const change = vi.fn();
    const attach = vi.fn();
    render(<Editor initial={`<div>Logo <img src="${SRC}" alt="logo"></div>`} onChange={change} onAttachInstead={attach} />);
    const box = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.click(box.querySelector('img')!);
    const tools = screen.getByRole('toolbar', { name: 'Picture tools' });
    fireEvent.click(within(tools).getByRole('button', { name: 'Small' }));
    expect(change.mock.calls.at(-1)![0]).toContain(`<img src="${SRC}" alt="logo" width="200" style="width: 200px; max-width: 100%; height: auto">`);
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Picture tools' })).getByRole('button', { name: 'Right, text wraps' }));
    expect(change.mock.calls.at(-1)![0]).toContain('align="right"');
    expect(screen.getByRole('slider', { name: 'Picture width' })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Picture tools' })).getByRole('button', { name: 'Send as attachment instead' }));
    expect(attach).toHaveBeenCalledWith(expect.any(File));
    expect((attach.mock.calls[0]![0] as File).name).toBe('logo.png');
    expect(box.querySelector('img')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Picture tools' })).toBeNull();
  });
});

describe('paste options', () => {
  it('pastes cleaned, then offers plain text and the message’s style instead', () => {
    const change = vi.fn();
    render(<Editor onChange={change} />);
    const box = screen.getByRole('textbox', { name: 'Message' });
    const html = '<p class="MsoNormal" style="color:red;mso-bidi-font-family:Arial"><b>Hi</b><o:p></o:p></p><script>x()</script>';
    fireEvent.paste(box, { clipboardData: { files: [], getData: (t: string) => (t === 'text/html' ? html : 'Hi') } });
    expect(change).toHaveBeenLastCalledWith('<p style="color: red"><b>Hi</b></p>');
    const opts = screen.getByRole('group', { name: 'Paste options' });
    expect(within(opts).getByRole('button', { name: 'Keep formatting' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(opts).getByRole('button', { name: 'Match style' }));
    expect(change).toHaveBeenLastCalledWith('<p><b>Hi</b></p>');
    fireEvent.click(within(screen.getByRole('group', { name: 'Paste options' })).getByRole('button', { name: 'Plain text' }));
    expect(change).toHaveBeenLastCalledWith('Hi');
    // Typing again puts the options away.
    fireEvent.input(box);
    expect(screen.queryByRole('group', { name: 'Paste options' })).toBeNull();
  });
});

describe('Quick Parts', () => {
  it('says why they cannot be used, and where to make them', () => {
    expect(quickPartsReason([], false, false)).toMatch(/Settings › Mail › Quick Steps/);
    expect(quickPartsReason(undefined, true, false)).toMatch(/Loading/);
    expect(quickPartsReason(undefined, false, true)).toMatch(/could not be loaded/);
    expect(quickPartsReason([{ id: 1, name: 'x', html: '', org: false }], false, false)).toBeNull();
  });
});

describe('the format painter', () => {
  it('arms, says so, and Escape puts it down', async () => {
    render(<Editor initial="<div><b>Bold</b> plain</div>" />);
    const box = screen.getByRole('textbox', { name: 'Message' });
    act(() => placeCaretIn(box.querySelector('b')!.firstChild!, 1));
    fireEvent.click(screen.getByRole('button', { name: 'Format painter' }));
    expect(screen.getByRole('button', { name: 'Format painter' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/select the text to format/)).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Format painter' }).getAttribute('aria-pressed')).toBe('false'));
  });
});
