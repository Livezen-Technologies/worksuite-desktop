// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Mail composer's formatted-text editor (the shared RichTextEditor):
 * toolbar marks, link checks, the composer's allow-list, HTML + text on the
 * way out, drafts (including plain-text ones from before), AI on the
 * person's own words only, the quoted email left alone, recipient chips,
 * pasted pictures inside the message (worksuite-desktop#188; before, they
 * became attachments), and the Send split control.
 */

const net = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), request: vi.fn(), call: vi.fn(), toast: vi.fn(), send: vi.fn(), ai: null as null | { input: () => string; actions: Array<{ run: (t: string) => void }> }, sigs: [] as Array<{ id: number; name: string; html: string; is_default: boolean; mailbox?: number | null; default_new?: boolean; default_reply?: boolean }>, parts: [] as Array<{ id: number; name: string; html: string; org: boolean }> }));
vi.mock('../../../src/core/api', () => ({ apiGet: net.get, apiPost: net.post, request: net.request, apiUrl: (s: string) => s }));
vi.mock('../../../src/core/bridge', () => ({ call: net.call, errorMessage: (e: Error) => e.message }));
vi.mock('../../../src/core/toasts', () => ({ toast: net.toast }));
vi.mock('../../../src/modules/mail/api', () => ({
  sendMessage: net.send,
  useTemplates: () => ({ data: { templates: [] }, isLoading: false }),
  useSignatures: () => ({ data: { signatures: net.sigs } }),
  useQuickParts: () => ({ data: net.parts }),
}));
// Pictures are decoded and made smaller with the browser's canvas, which jsdom does not have.
vi.mock('../../../src/modules/mail/editor/images', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  prepareImage: vi.fn(async () => ({ src: 'data:image/png;base64,iVBORw0KGgo=', width: 120, height: 80, bytes: 8, shrunk: false })),
}));
vi.mock('../../../src/components/DriveFilePicker', () => ({
  DriveFilePicker: ({ onChoose }: { onChoose: (f: Array<{ id: number; name: string; size: number; extension: string }>) => void }) => (
    <button type="button" onClick={() => onChoose([{ id: 41, name: 'Training_plan.pdf', size: 4096, extension: 'pdf' }])}>
      Pick Training_plan.pdf
    </button>
  ),
}));
vi.mock('../../../src/modules/ai/AiTextDialog', () => ({
  AiTextDialog: (p: { input: () => string; actions: Array<{ run: (t: string) => void }> }) => {
    net.ai = p;
    return <button type="button" onClick={() => p.actions[0]!.run('Rewritten by AI\nSecond line')}>Apply AI text</button>;
  },
}));

import { RichTextEditor, normalizeLink } from '../../../src/components/RichTextEditor';
import { Compose } from '../../../src/modules/mail/Compose';
import { cleanComposeHtml, composeBody, composeText, migrateDraft, splitSignature } from '../../../src/modules/mail/composeHtml';
import type { ComposeSeed, Mailbox } from '../../../src/modules/mail/types';

const BOX = [{ id: 1, email: 'me@example.test', display_name: 'Me', is_default: true, colour: 'blue', account_type: 'local_mailbox' }] as unknown as Mailbox[];
const QUOTE = '\n\nOn Thu 1 Oct Pat Lee wrote:\n> Could you confirm the BOQ?\n> Thanks';
let exec: ReturnType<typeof vi.fn>;

beforeEach(() => {
  net.get.mockReset().mockResolvedValue({ results: [] });
  net.post.mockReset().mockResolvedValue({});
  net.request.mockReset();
  net.call.mockReset().mockResolvedValue(null);
  net.toast.mockReset();
  net.send.mockReset().mockResolvedValue('sent');
  net.ai = null;
  net.sigs = [];
  net.parts = [];
  exec = vi.fn((cmd: string, _ui: boolean, value?: string) => {
    const box = document.querySelector<HTMLElement>('[contenteditable]');
    if (!box) return false;
    if (cmd === 'bold') box.innerHTML = `<b>${box.innerHTML}</b>`;
    if (cmd === 'insertHTML') box.innerHTML += value ?? '';
    if (cmd === 'insertUnorderedList') box.innerHTML = `<ul><li>${box.textContent}</li></ul>`;
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

function Editor({ initial = '', onChange = vi.fn() }: { initial?: string; onChange?: (h: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <RichTextEditor
      value={v}
      clean={cleanComposeHtml}
      label="Message"
      placeholder="Write your message…"
      onChange={(h) => {
        setV(h);
        onChange(h);
      }}
    />
  );
}

describe('the shared editor', () => {
  it('shows a placeholder, a labelled toolbar with shortcuts, and which marks are on', () => {
    render(<Editor />);
    expect(screen.getByText('Write your message…')).toBeTruthy();
    const bar = screen.getByRole('toolbar', { name: 'Message formatting' });
    for (const name of ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Text colour', 'Highlight', 'Bulleted list', 'Numbered list', 'Increase indent', 'Decrease indent', 'Quote', 'Link', 'Insert table', 'Clear formatting', 'Undo', 'Redo']) {
      expect(within(bar).getByRole('button', { name })).toBeTruthy();
    }
    expect(within(bar).getByRole('button', { name: 'Bold' }).getAttribute('title')).toMatch(/Bold \((Ctrl\+|⌘)B\)/);
    expect(within(bar).getByRole('combobox', { name: 'Text style' })).toBeTruthy();

    const box = screen.getByRole('textbox', { name: 'Message' });
    act(() => {
      box.innerHTML = '<div>plain <b>bold</b> <ul><li>item</li></ul></div>';
      fireEvent.input(box);
    });
    expect(screen.queryByText('Write your message…')).toBeNull();
    act(() => placeCaretIn(box.querySelector('b')!.firstChild!, 1));
    expect(within(bar).getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(bar).getByRole('button', { name: 'Bulleted list' }).getAttribute('aria-pressed')).toBe('false');
    act(() => placeCaretIn(box.querySelector('li')!.firstChild!, 1));
    expect(within(bar).getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('false');
    expect(within(bar).getByRole('button', { name: 'Bulleted list' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('runs commands from the toolbar and the keyboard, and undoes them', () => {
    const change = vi.fn();
    render(<Editor initial="<div>One</div>" onChange={change} />);
    const box = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(exec).toHaveBeenCalledWith('bold', false, undefined);
    expect(change).toHaveBeenLastCalledWith('<b><div>One</div></b>');
    fireEvent.keyDown(box, { key: 'z', ctrlKey: true });
    expect(box.innerHTML).toBe('<div>One</div>');
    fireEvent.keyDown(box, { key: 'y', ctrlKey: true });
    expect(box.innerHTML).toBe('<b><div>One</div></b>');
    fireEvent.keyDown(box, { key: 'i', metaKey: true });
    expect(exec).toHaveBeenCalledWith('italic', false, undefined);
    fireEvent.keyDown(box, { key: 'u', ctrlKey: true });
    expect(exec).toHaveBeenCalledWith('underline', false, undefined);
    fireEvent.keyDown(box, { key: '8', code: 'Digit8', ctrlKey: true, shiftKey: true });
    expect(exec).toHaveBeenCalledWith('insertUnorderedList', false, undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Clear formatting' }));
    expect(box.innerHTML).toBe('One');
    fireEvent.click(screen.getByRole('button', { name: 'Insert table' }));
    expect(change.mock.calls.at(-1)![0]).toContain('<table style="border-collapse: collapse">');
  });

  it('turns "- " at the start of a line into a list', () => {
    render(<RichTextEditor value="" onChange={vi.fn()} clean={cleanComposeHtml} label="Message" markdownShortcuts />);
    const box = screen.getByRole('textbox', { name: 'Message' });
    box.innerHTML = '<div>-</div>';
    placeCaretIn(box.firstChild!.firstChild!, 1);
    fireEvent.keyDown(box, { key: ' ' });
    expect(exec).toHaveBeenCalledWith('delete');
    expect(exec).toHaveBeenCalledWith('insertUnorderedList');
  });

  it('checks link addresses: http(s) and mailto only, www and bare addresses completed', () => {
    expect(normalizeLink('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(normalizeLink('www.example.com')).toBe('https://www.example.com');
    expect(normalizeLink('ann@example.org')).toBe('mailto:ann@example.org');
    expect(normalizeLink('mailto:ann@example.org?subject=Hi')).toBe('mailto:ann@example.org?subject=Hi');
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', 'ftp://example.com', 'https://', 'http://localhost', 'example', 'https://exa mple.com', 'tel:+94770000000']) {
      expect(normalizeLink(bad)).toBeNull();
    }
    expect(normalizeLink('tel:+94770000000', true)).toBe('tel:+94770000000');
  });

  it('inserts, edits and removes a link from the link bar, refusing unsafe addresses', () => {
    const change = vi.fn();
    render(<Editor initial="<div>See</div>" onChange={change} />);
    const box = screen.getByRole('textbox', { name: 'Message' });
    placeCaretIn(box.firstChild!.firstChild!, 3);
    fireEvent.keyDown(box, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByLabelText('Link address'), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    expect(screen.getByRole('alert').textContent).toMatch(/https, http or mailto/);
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Link address'), { target: { value: 'www.example.com' } });
    fireEvent.keyDown(screen.getByLabelText('Link address'), { key: 'Enter' });
    expect(exec).toHaveBeenCalledWith('insertHTML', false, '<a href="https://www.example.com">https://www.example.com</a>');
    const a = box.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://www.example.com');

    placeCaretIn(a.firstChild!, 2);
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect((screen.getByLabelText('Link address') as HTMLInputElement).value).toBe('https://www.example.com');
    fireEvent.change(screen.getByLabelText('Link address'), { target: { value: 'https://example.org/new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update link' }));
    expect(box.querySelector('a')!.getAttribute('href')).toBe('https://example.org/new');

    placeCaretIn(box.querySelector('a')!.firstChild!, 1);
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    fireEvent.click(screen.getByRole('button', { name: /Remove link/ }));
    expect(box.querySelector('a')).toBeNull();
    expect(change.mock.calls.at(-1)![0]).not.toContain('<a');
  });

  it('cleans pasted markup and hands pasted pictures over instead of inlining them', () => {
    const files = vi.fn();
    const change = vi.fn();
    render(<RichTextEditor value="" onChange={change} clean={cleanComposeHtml} label="Message" onFiles={files} />);
    const box = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.paste(box, { clipboardData: { files: [], getData: (t: string) => (t === 'text/html' ? '<p onclick="x()">Hi<script>alert(1)</script><img src=x onerror=alert(1)></p>' : '') } });
    expect(change).toHaveBeenLastCalledWith('<p>Hi</p>');
    const pic = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.paste(box, { clipboardData: { files: [pic], getData: () => '' } });
    expect(files).toHaveBeenCalledWith([pic]);
    expect(box.querySelector('img')).toBeNull();
  });
});

describe('the composer allow-list and text alternative', () => {
  it('strips scripts, handlers, javascript: links and unsafe styles; keeps formatting', () => {
    const out = cleanComposeHtml(
      '<div onmouseover="x()">Hi <b>B</b><i>I</i><u>U</u><strike>S</strike></div><script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">bad</a><a href="https://ok.example/" onclick="x()" target="_top">ok</a><span style="color: rgb(197, 34, 31); position: fixed; background-image: url(https://t.example/p.gif)">red</span><font color="#188038">green</font><iframe src="https://x"></iframe><style>*{}</style><svg onload="x()"></svg><ul><li>one</li></ul><blockquote>q</blockquote>',
    );
    expect(out).toBe('<div>Hi <b>B</b><i>I</i><u>U</u><s>S</s></div>bad<a href="https://ok.example/">ok</a><span style="color: rgb(197, 34, 31)">red</span><span style="color: #188038">green</span><ul><li>one</li></ul><blockquote>q</blockquote>');
    expect(cleanComposeHtml(out)).toBe(out);
    expect(cleanComposeHtml('<a href="data:text/html,x">d</a><a href="vbscript:x">v</a>')).toBe('dv');
  });

  it('makes a plain-text alternative with lists, quotes and link addresses', () => {
    expect(composeText('<div>Hi <b>Ann</b>,</div><div><br></div><ul><li>One</li><li>Two</li></ul><ol><li>First</li></ol><blockquote>Said</blockquote><div><a href="https://example.com">the site</a> or <a href="mailto:a@b.co">a@b.co</a></div>')).toBe(
      'Hi Ann,\n\n- One\n- Two\n1. First\n> Said\nthe site <https://example.com> or a@b.co',
    );
  });

  it('sends the message and the quoted email together, as HTML and text', () => {
    const body = composeBody('<div>Yes, <b>confirmed</b>.</div>', QUOTE);
    expect(body.html).toBe('<div>Yes, <b>confirmed</b>.</div><div><br></div><div>On Thu 1 Oct Pat Lee wrote:</div><blockquote style="margin: 0 0 0 0.8ex; border-left: 1px solid #cccccc; padding-left: 1ex">Could you confirm the BOQ?<br>Thanks</blockquote>');
    expect(body.text).toBe('Yes, confirmed.\n\nOn Thu 1 Oct Pat Lee wrote:\n> Could you confirm the BOQ?\n> Thanks');
  });

  it('brings plain-text drafts forward and cleans restored rich ones', () => {
    const legacy = migrateDraft({ to: 'a@b.co', cc: '', bcc: '', subject: 'Re: BOQ', body: `Sure <ok> & done\n\nLine 3${QUOTE}`, from: '1', signed: true }, QUOTE);
    expect(legacy.html).toBe('<div>Sure &lt;ok&gt; &amp; done</div><div><br></div><div>Line 3</div>');
    expect(legacy.quote).toBe(QUOTE);
    expect(legacy.v).toBe(2);
    const withoutQuote = migrateDraft({ body: 'Only mine' }, QUOTE);
    expect(withoutQuote.quote).toBe('');
    const rich = migrateDraft({ html: '<b>Hi</b><img src=x onerror=alert(1)>', quote: '', to: 'a@b.co' }, QUOTE);
    expect(rich.html).toBe('<b>Hi</b>');
    expect(rich.quote).toBe('');
  });

  it('finds the signature under its "-- " line', () => {
    expect(splitSignature('<div>Hello</div><div><br></div><div><br></div><div>-- </div><div>Hasarinda</div>')).toEqual(['<div>Hello</div>', '<div><br></div><div><br></div><div>-- </div><div>Hasarinda</div>']);
    expect(splitSignature('<div>No signature</div>')).toEqual(['<div>No signature</div>', '']);
  });
});

function compose(seed: ComposeSeed, extra: Partial<Parameters<typeof Compose>[0]> = {}) {
  const close = vi.fn();
  render(<Compose seed={seed} boxes={BOX} defaultBox="1" offline={false} onClose={close} onReopen={vi.fn()} {...extra} />);
  return { close, box: () => screen.getByRole('textbox', { name: 'Message' }) };
}

describe('composing', () => {
  it("puts a seeded body in the editor as the sender's own words, not a quote, and keeps Bcc", async () => {
    const { box } = compose({ mode: 'new', to: 'ann@example.org', bcc: 'boss@example.org', body: 'Hello Ann\nSee you at 3' });
    await waitFor(() => expect(box().innerHTML).toBe('<div>Hello Ann</div><div>See you at 3</div>'));
    expect(screen.queryByRole('region', { name: 'Quoted email' })).toBeNull();
    expect(screen.getByText('boss@example.org')).toBeTruthy();
  });

  it('restores a rich draft, and a plain-text one from before as rich text with the quote apart', async () => {
    net.call.mockImplementation(async (ch: string) => (ch === 'offline:getDraft' ? { content: { to: 'pat@example.org', cc: '', bcc: '', subject: 'Re: BOQ', body: `Will do\nTomorrow${QUOTE}`, from: '1' } } : null));
    const { box } = compose({ mode: 'reply', to: 'pat@example.org', subject: 'Re: BOQ', quote: QUOTE, inReplyTo: '<m@x>' });
    await waitFor(() => expect(box().innerHTML).toBe('<div>Will do</div><div>Tomorrow</div>'));
    expect(screen.getByText('Draft restored from this computer')).toBeTruthy();
    const quoted = screen.getByRole('region', { name: 'Quoted email' });
    expect(within(quoted).getByRole('button', { name: /On Thu 1 Oct Pat Lee wrote:/ }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(within(quoted).getByRole('button', { name: /On Thu 1 Oct Pat Lee wrote:/ }));
    expect(within(quoted).getByText(/Could you confirm the BOQ\?/).textContent).toBe('Could you confirm the BOQ?\nThanks');
    cleanup();

    net.call.mockImplementation(async (ch: string) => (ch === 'offline:getDraft' ? { content: { to: 'a@b.co', cc: '', bcc: '', subject: 'S', html: '<ul><li>Kept</li></ul>', quote: '', from: '1', v: 2 } } : null));
    const second = compose({ mode: 'new' });
    await waitFor(() => expect(second.box().innerHTML).toBe('<ul><li>Kept</li></ul>'));
    expect(screen.queryByRole('region', { name: 'Quoted email' })).toBeNull();
  });

  it('saves the draft cleaned, and schedules HTML with its text alternative', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      compose({ mode: 'new', to: 'ann@example.org' });
      const box = screen.getByRole('textbox', { name: 'Message' });
      act(() => {
        box.innerHTML = '<div>Hi <b>Ann</b><img src=x onerror="alert(1)"></div><ul><li>One</li></ul>';
        fireEvent.input(box);
      });
      act(() => {
        vi.advanceTimersByTime(900);
      });
      expect(net.call).toHaveBeenCalledWith('offline:saveDraft', expect.objectContaining({ module: 'mail', context: 'compose:new', content: expect.objectContaining({ html: '<div>Hi <b>Ann</b></div><ul><li>One</li></ul>', v: 2 }) }));
    } finally {
      vi.useRealTimers();
    }
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Plan' } });
    fireEvent.click(screen.getByRole('radio', { name: /Tomorrow morning/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send later…' }));
    await waitFor(() => expect(net.post).toHaveBeenCalledWith('/api/mail/send', expect.objectContaining({ to: ['ann@example.org'], subject: 'Plan', body_html: '<div>Hi <b>Ann</b></div><ul><li>One</li></ul>', body_text: 'Hi Ann\n- One', schedule_at: expect.any(String) })));
  });

  it('lets AI work on what was written — not the signature, not the quoted email', async () => {
    net.sigs = [{ id: 4, name: 'Default', html: '<div>Hasarinda</div><div>Livezen</div>', is_default: true }];
    compose({ mode: 'reply', to: 'pat@example.org', subject: 'Re: BOQ', quote: QUOTE, inReplyTo: '<m@x>' });
    const box = screen.getByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(box.innerHTML).toContain('<div>-- </div><div>Hasarinda</div>'));
    act(() => {
      box.innerHTML = `<div>Mine <b>here</b></div>${box.innerHTML}`;
      fireEvent.input(box);
    });
    // The AI tools are behind the toolbar's "Write with AI" (they were buttons of their own before #188).
    fireEvent.click(screen.getByRole('button', { name: 'Write with AI' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Improve writing/ }));
    expect(net.ai!.input()).toBe('Mine here');
    fireEvent.click(screen.getByRole('button', { name: 'Apply AI text' }));
    expect(box.innerHTML).toBe('<div>Rewritten by AI</div><div>Second line</div><div><br></div><div><br></div><div>-- </div><div>Hasarinda</div><div>Livezen</div>');
    // The quote is untouched and still goes out below.
    fireEvent.click(screen.getByRole('radio', { name: /Tomorrow morning/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send later…' }));
    await waitFor(() => expect(net.post).toHaveBeenCalled());
    const sent = net.post.mock.calls.find((c) => c[0] === '/api/mail/send')![1] as { body_html: string; body_text: string };
    expect(sent.body_html).toContain('<blockquote style="margin: 0 0 0 0.8ex; border-left: 1px solid #cccccc; padding-left: 1ex">Could you confirm the BOQ?<br>Thanks</blockquote>');
    expect(sent.body_text.endsWith('On Thu 1 Oct Pat Lee wrote:\n> Could you confirm the BOQ?\n> Thanks')).toBe(true);
  });

  it('can leave the quoted email out', async () => {
    compose({ mode: 'reply', to: 'pat@example.org', subject: 'Re: BOQ', quote: QUOTE, inReplyTo: '<m@x>' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove quoted email' }));
    expect(screen.queryByRole('region', { name: 'Quoted email' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Tomorrow morning/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send later…' }));
    await waitFor(() => expect(net.post).toHaveBeenCalledWith('/api/mail/send', expect.objectContaining({ body_html: '', body_text: '' })));
  });

  it('turns recipients into chips, with suggestions from the contact lookup', async () => {
    net.get.mockImplementation(async (path: string) => (path === '/api/contacts/lookup' ? { results: [{ kind: 'contact', id: 7, name: 'Nimal Perera', email: 'nimal@example.org', subtitle: 'SFCL' }] } : {}));
    compose({ mode: 'new' });
    const to = screen.getByRole('combobox', { name: 'To' });
    fireEvent.change(to, { target: { value: 'ann@example.org, ' } });
    expect(screen.getByText('ann@example.org')).toBeTruthy();
    fireEvent.change(to, { target: { value: 'nim' } });
    const option = await screen.findByRole('option', { name: /Nimal Perera/ });
    expect(net.get).toHaveBeenCalledWith('/api/contacts/lookup', expect.objectContaining({ q: 'nim' }), expect.anything());
    fireEvent.click(within(option).getByRole('button'));
    expect(screen.getByText('Nimal Perera')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove ann@example.org' }));
    expect(screen.queryByText('ann@example.org')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Tomorrow morning/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send later…' }));
    await waitFor(() => expect(net.post).toHaveBeenCalledWith('/api/mail/send', expect.objectContaining({ to: ['nimal@example.org'] })));
  });

  it('attaches a copy of a file from Files', async () => {
    net.post.mockImplementation(async (path: string) => (path === '/api/mail/upload/from-drive' ? { token: 'd1', name: 'Training_plan.pdf', size: 4096 } : {}));
    compose({ mode: 'new', to: 'a@b.co' });
    // Attach ▾ › From WorkSuite Files (a button of its own before #188).
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /From WorkSuite Files/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Pick Training_plan.pdf' }));
    expect(await screen.findByText('Training_plan.pdf')).toBeTruthy();
    expect(net.post).toHaveBeenCalledWith('/api/mail/upload/from-drive', { file_id: 41 });
    expect(screen.getByText(/ · from Files$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Tomorrow morning/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send later…' }));
    await waitFor(() => expect(net.post).toHaveBeenCalledWith('/api/mail/send', expect.objectContaining({ attachments: ['d1'] })));
  });

  it('puts a pasted picture inside the message (sent as an inline part), and other files as attachments', async () => {
    net.request.mockResolvedValue({ data: { token: 't1', name: 'notes.pdf', size: 2048 } });
    compose({ mode: 'new', to: 'a@b.co', subject: 'Plan' });
    const pic = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.paste(screen.getByRole('textbox', { name: 'Message' }), { clipboardData: { files: [pic], getData: () => '' } });
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' }).querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo='));
    expect(net.request).not.toHaveBeenCalled();
    const pdf = new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' });
    fireEvent.paste(screen.getByRole('textbox', { name: 'Message' }), { clipboardData: { files: [pdf], getData: () => '' } });
    expect(await screen.findByText('notes.pdf')).toBeTruthy();
    expect(net.request).toHaveBeenCalledWith('POST', '/api/mail/upload', expect.anything());
    fireEvent.click(screen.getByRole('radio', { name: /Tomorrow morning/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send later…' }));
    await waitFor(() => expect(net.post).toHaveBeenCalledWith('/api/mail/send', expect.objectContaining({ attachments: ['t1'], body_html: expect.stringContaining('<img src="data:image/png;base64,iVBORw0KGgo=" alt="shot" width="120"') })));
  });

  it('shows Send as one split control of equal halves, with later options behind the chevron', () => {
    compose({ mode: 'new', to: 'a@b.co' });
    const group = screen.getByRole('group', { name: 'Send options' });
    const [send, more] = within(group).getAllByRole('button');
    expect(send!.textContent).toBe('Send');
    expect(send!.getAttribute('type')).toBe('submit');
    expect(more!.getAttribute('aria-label')).toBe('Send later options');
    // Both halves take the group's height; neither sets its own.
    expect(group.className).toContain('h-[38px]');
    for (const b of [send!, more!]) {
      expect(b.className).toContain('h-full');
      expect(b.className).not.toMatch(/\bh-(8|9|\[\d+px\])\b/);
    }
    fireEvent.click(more!);
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send later…' }).className).toContain('h-[38px]');
    expect(screen.getByRole('button', { name: 'Discard draft' }).className).toContain('text-danger');
  });
});

describe('message options, Quick Parts and send checks (ENH-MAIL-03 P2)', () => {
  it('sends importance, sensitivity and receipt requests with the message (DMO-CMP-10)', async () => {
    compose({ mode: 'new', to: 'ann@example.org', subject: 'Plan' });
    fireEvent.click(screen.getByRole('button', { name: /Options/ }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: /High/ }));
    fireEvent.click(screen.getByRole('button', { name: /Options/ }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: /Confidential/ }));
    fireEvent.click(screen.getByRole('button', { name: /Options/ }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitemcheckbox', { name: /Request a read receipt/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Tomorrow morning/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send later…' }));
    await waitFor(() => expect(net.post).toHaveBeenCalledWith('/api/mail/send', expect.objectContaining({ options: { importance: 'high', sensitivity: 'confidential', read_receipt: true } })));
  });

  it('puts a Quick Part into the message above the signature (DMO-CMP-07)', async () => {
    net.sigs = [{ id: 4, name: 'Default', html: '<div>Hasarinda</div>', is_default: true }];
    net.parts = [{ id: 5, name: 'Directions', html: '<div>Gate 2</div><script>x()</script>', org: false }];
    const { box } = compose({ mode: 'new', to: 'ann@example.org' });
    await waitFor(() => expect(box().innerHTML).toContain('<div>Hasarinda</div>'));
    // Quick Parts are under Template ▾ now (a button of their own before #188).
    fireEvent.click(screen.getByRole('button', { name: 'Template' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Quick Parts/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Directions/ }));
    await waitFor(() => expect(box().innerHTML.startsWith('<div>Gate 2</div>')).toBe(true));
    expect(box().innerHTML).not.toContain('script');
    expect(box().innerHTML.indexOf('Gate 2')).toBeLessThan(box().innerHTML.indexOf('Hasarinda'));
  });

  it('keeps the actions in one row of their own, and says why Quick Parts and S/MIME cannot be used (#188)', () => {
    net.parts = [];
    compose({ mode: 'new', to: 'ann@example.org' });
    const actions = screen.getByRole('toolbar', { name: 'Message actions' });
    expect(within(actions).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Attach', 'Template', 'Signature', 'Mail merge', 'Options']);
    fireEvent.click(within(actions).getByRole('button', { name: 'Template' }));
    const parts = within(screen.getByRole('menu')).getByRole('menuitem', { name: /Quick Parts/ });
    expect(parts.getAttribute('aria-disabled')).toBe('true');
    expect(parts.textContent).toMatch(/create them in Settings › Mail › Quick Steps/);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.click(within(actions).getByRole('button', { name: 'Options' }));
    const sign = within(screen.getByRole('menu')).getByRole('menuitem', { name: /Sign \(S\/MIME\)/ });
    expect(sign.getAttribute('aria-disabled')).toBe('true');
    expect(sign.textContent).toMatch(/not available yet/);
  });

  it('warns when pictures and attachments come near the 25 MB most servers allow (#188)', async () => {
    // Counted from the attachments here (an embedded picture counts the same way: see embeddedBytes).
    net.call.mockImplementation(async (ch: string) => (ch === 'offline:getDraft' ? { content: { to: 'a@b.co', cc: '', bcc: '', subject: 'S', html: '<div>Files</div>', attachments: [{ token: 't9', name: 'site.zip', size: 21 * 1024 * 1024 }], quote: '', from: '1', v: 2 } } : null));
    compose({ mode: 'new' });
    expect(await screen.findByText(/most mail servers refuse messages over 25 MB/)).toBeTruthy();
  });

  it('asks once when the message mentions an attachment that is not there, and sends on "Send anyway" (DMO-CMP-16)', async () => {
    const { close, box } = compose({ mode: 'new', to: 'ann@example.org', subject: 'Plan', body: 'Please see the attached plan' });
    await waitFor(() => expect(box().textContent).toContain('attached'));
    fireEvent.click(within(screen.getByRole('group', { name: 'Send options' })).getByRole('button', { name: 'Send' }));
    const dialog = await screen.findByRole('dialog', { name: 'Did you mean to attach a file?' });
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send anyway' }));
    expect(close).toHaveBeenCalled();
  });
});

describe('@mentions (DMO-CMP-14)', () => {
  it('offers people after "@", writes the name as a link and adds them to To', async () => {
    net.get.mockImplementation(async (path: string, q: { q: string }) => (path === '/api/contacts/lookup' && q.q === 'Nim' ? { results: [{ kind: 'employee', id: 7, name: 'Nimal Perera', email: 'nimal@example.org' }] } : { results: [] }));
    const { box } = compose({ mode: 'new', to: 'ann@example.org', subject: 'Plan' });
    act(() => {
      box().innerHTML = '<div>Thanks @Nim</div>';
      const t = box().firstChild!.firstChild!;
      placeCaretIn(t, t.textContent!.length);
      fireEvent.input(box());
    });
    const list = await screen.findByRole('listbox', { name: 'Mention someone' });
    fireEvent.mouseDown(within(list).getByRole('option', { name: /Nimal Perera/ }));
    await waitFor(() => expect(box().innerHTML).toContain('<a href="mailto:nimal@example.org">@Nimal Perera</a>'));
    expect(box().textContent).not.toContain('@Nim\u00a0');
    expect(await screen.findByText('Nimal Perera')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Tomorrow morning/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send later…' }));
    await waitFor(() => expect(net.post).toHaveBeenCalledWith('/api/mail/send', expect.objectContaining({ to: ['ann@example.org', 'nimal@example.org'] })));
  });

  it('does not offer anyone for an address being typed or a lone "@"', async () => {
    const { box } = compose({ mode: 'new', to: 'ann@example.org' });
    act(() => {
      box().innerHTML = '<div>mail me at a@b</div>';
      const t = box().firstChild!.firstChild!;
      placeCaretIn(t, t.textContent!.length);
      fireEvent.input(box());
    });
    await new Promise((r) => setTimeout(r, 250));
    expect(net.get).not.toHaveBeenCalledWith('/api/contacts/lookup', expect.anything(), expect.anything());
  });
});
