// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The composer's layout and behaviour (worksuite-desktop#213): the message
 * fills the height and scrolls inside, the side panel (width kept between
 * 260 and 380 px and remembered, hidden, not docked below 900 px with a
 * popover instead), Send later only in Send ▾ and the panel, recipient chips
 * (invalid, outside the organisation, suggestions), the subject and
 * missing-attachment checks, the toolbar giving up captions before tools,
 * the draft's calm status, Discard with a question, attachment chips, and
 * the keys.
 */

const net = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), request: vi.fn(), call: vi.fn(), toast: vi.fn(), send: vi.fn(), action: vi.fn(), templates: [] as Array<{ id: number; name: string; body_html: string; mine: boolean; shared: boolean }> }));
vi.mock('../../../src/core/api', () => ({ apiGet: net.get, apiPost: net.post, apiDelete: vi.fn(async () => ({})), request: net.request, apiUrl: (s: string) => s }));
vi.mock('../../../src/core/bridge', () => ({ call: net.call, errorMessage: (e: Error) => e.message }));
vi.mock('../../../src/core/toasts', () => ({ toast: net.toast }));
vi.mock('../../../src/modules/mail/api', () => ({
  sendMessage: net.send,
  messageAction: net.action,
  useTemplates: () => ({ data: { templates: net.templates }, isLoading: false }),
  useSignatures: () => ({ data: { signatures: [] } }),
  useQuickParts: () => ({ data: [] }),
}));
vi.mock('../../../src/modules/ai/AiTextDialog', () => ({ AiTextDialog: () => null }));

import { Compose, draftStatus, popOutRoute } from '../../../src/modules/mail/Compose';
import { PANEL_MAX, PANEL_MIN, panelLayout } from '../../../src/modules/mail/ComposePanel';
import { mentionsAttachment, sendChecks, withoutQuoted } from '../../../src/modules/mail/composeHtml';
import { ToolbarRow, type ToolGroup } from '../../../src/modules/mail/editor/Toolbar';
import { isExternal } from '../../../src/modules/mail/Recipients';
import type { ComposeSeed, Mailbox } from '../../../src/modules/mail/types';

const BOX = [{ id: 1, email: 'me@livezen.test', display_name: 'Me Myself', is_default: true, colour: 'blue', account_type: 'imap', provider_label: 'Custom IMAP' }] as unknown as Mailbox[];
const TWO = [...BOX, { id: 2, email: 'sales@livezen.test', display_name: 'Sales', colour: 'green', account_type: 'imap', provider_label: 'Custom IMAP' }] as unknown as Mailbox[];

/** Widths for elements jsdom does not lay out: the composer area, the form and toolbar rows. */
const size = { area: 0, form: 0, row: 0 };
const proto = HTMLElement.prototype;
const realClient = Object.getOwnPropertyDescriptor(proto, 'clientWidth');
const realOffset = Object.getOwnPropertyDescriptor(proto, 'offsetWidth');

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // Not every environment has it.
  }
  size.area = 0;
  size.form = 0;
  size.row = 0;
  Object.defineProperty(proto, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute('data-compose')) return size.area;
      if (this.tagName === 'FORM') return size.form;
      if (this.hasAttribute('data-ov-row')) return size.row;
      return 0;
    },
  });
  Object.defineProperty(proto, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      const k = this.dataset?.ov;
      if (!k) return 0;
      if (k.startsWith('sep')) return 9;
      // A tool with its caption showing is wider than its icon alone.
      return this.textContent ? 90 : 32;
    },
  });
  net.get.mockReset().mockResolvedValue({});
  net.post.mockReset().mockResolvedValue({});
  net.request.mockReset();
  net.call.mockReset().mockResolvedValue(null);
  net.toast.mockReset();
  net.send.mockReset().mockResolvedValue('sent');
  net.action.mockReset().mockResolvedValue('done');
  net.templates = [];
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => true) });
});
afterEach(() => {
  cleanup();
  if (realClient) Object.defineProperty(proto, 'clientWidth', realClient);
  if (realOffset) Object.defineProperty(proto, 'offsetWidth', realOffset);
  vi.useRealTimers();
});

function compose(seed: ComposeSeed, extra: Partial<Parameters<typeof Compose>[0]> = {}) {
  const close = vi.fn();
  render(<Compose seed={seed} boxes={BOX} defaultBox="1" offline={false} onClose={close} onReopen={vi.fn()} {...extra} />);
  return { close, box: () => screen.getByRole('textbox', { name: 'Message' }) };
}

describe('layout', () => {
  it('lets the message take the height between the toolbar and the footer, scrolling inside', () => {
    compose({ mode: 'reply', to: 'pat@example.org', subject: 'Re: BOQ', quote: '\n\nOn Thu Pat wrote:\n> Hi', inReplyTo: '<m@x>' });
    const form = screen.getByRole('form', { name: 'Reply' });
    expect(form.className).toMatch(/\bflex-col\b/);
    expect(form.className).toMatch(/\bmin-h-0\b/);
    const fill = form.querySelector('[data-editor-fill]')!;
    expect(fill.className).toMatch(/\bflex-1\b/);
    expect(fill.className).toMatch(/\bmin-h-0\b/);
    // No card around it any more, and it is not limited to a height of its own.
    expect(fill.className).not.toMatch(/\brounded-\[10px\]/);
    const scroll = form.querySelector('[data-editor-scroll]')!;
    expect(scroll.className).toMatch(/\bflex-1\b/);
    expect(scroll.className).toMatch(/\boverflow-y-auto\b/);
    expect(scroll.contains(screen.getByRole('textbox', { name: 'Message' }))).toBe(true);
    // The quoted email scrolls with the message.
    expect(scroll.contains(screen.getByRole('region', { name: 'Quoted email' }))).toBe(true);
    // Header, toolbars and footer keep their size.
    expect(form.querySelector('[data-compose-header]')!.className).toMatch(/\bshrink-0\b/);
    expect(form.querySelector('[data-compose-footer]')!.className).toMatch(/\bshrink-0\b/);
    // The only scrolling area is the message's: the form itself does not scroll.
    expect(form.className).not.toMatch(/overflow-y-auto/);
  });

  it('puts every header row on the same 64 px label column with a focus line', () => {
    compose({ mode: 'new', cc: 'c@livezen.test' });
    const rows = [...document.querySelectorAll('[data-field-row]')];
    expect(rows.map((r) => r.firstElementChild!.textContent)).toEqual(['From', 'To', 'Cc', 'Subject']);
    for (const r of rows) {
      expect(r.firstElementChild!.className).toContain('w-16');
      expect(r.className).toContain('border-b');
      expect(r.className).toContain('focus-within:border-primary');
    }
    expect(screen.getByLabelText('Subject').getAttribute('placeholder')).toBe('Add a subject');
  });

  it('shows From as name and address, with the account type only in the list', () => {
    compose({ mode: 'new' });
    const from = document.querySelector('[data-field-row]')!;
    expect(from.textContent).toContain('Me Myself');
    expect(from.textContent).toContain('<me@livezen.test>');
    expect(from.textContent).not.toContain('Custom IMAP');
    cleanup();
    render(<Compose seed={{ mode: 'new' }} boxes={TWO} defaultBox="1" offline={false} onClose={vi.fn()} onReopen={vi.fn()} />);
    const picker = screen.getByRole('combobox', { name: 'From' });
    expect(picker.textContent).toContain('Me Myself <me@livezen.test>');
    expect(picker.textContent).not.toContain('Custom IMAP');
    fireEvent.click(picker);
    expect(screen.getAllByText('Custom IMAP').length).toBe(2);
  });
});

describe('the side panel', () => {
  it('keeps its width between 260 and 380 px and never wider than the room the message leaves', () => {
    expect(panelLayout(1400, 300, false)).toEqual({ docked: true, narrow: false, width: 300 });
    expect(panelLayout(1400, 900, false).width).toBe(PANEL_MAX);
    expect(panelLayout(1400, 100, false).width).toBe(PANEL_MIN);
    // 940 px wide: the message keeps 520, so the panel takes at most 420 — 380 here, and 300 asked stays 300.
    expect(panelLayout(940, 380, false).width).toBe(380);
    expect(panelLayout(920, 380, false)).toEqual({ docked: true, narrow: false, width: 380 });
    // Not laid out yet: as asked.
    expect(panelLayout(0, 320, false)).toEqual({ docked: true, narrow: false, width: 320 });
  });

  it('is not docked below 900 px, or when hidden', () => {
    expect(panelLayout(899, 300, false)).toMatchObject({ docked: false, narrow: true });
    expect(panelLayout(1200, 300, true)).toMatchObject({ docked: false, narrow: false });
  });

  it('remembers the width it is given, within its limits', () => {
    size.area = 1400;
    compose({ mode: 'new' });
    const panel = screen.getByRole('complementary', { name: 'Templates and send later' });
    expect(panel.style.width).toBe('300px');
    const divider = within(panel).getByRole('separator', { name: 'Resize the side panel' });
    fireEvent.keyDown(divider, { key: 'End' });
    expect(panel.style.width).toBe('380px');
    expect(localStorage.getItem('ws.width.mail.composePanel')).toBe('380');
    // The divider is on the panel's left edge: ← widens it, and it stops at the most.
    fireEvent.keyDown(divider, { key: 'Home' });
    expect(panel.style.width).toBe('260px');
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(panel.style.width).toBe('276px');
    cleanup();
    compose({ mode: 'new' });
    expect(screen.getByRole('complementary', { name: 'Templates and send later' }).style.width).toBe('276px');
  });

  it('hides with its button, stays hidden next time, and comes back', () => {
    size.area = 1400;
    compose({ mode: 'new' });
    fireEvent.click(screen.getByRole('button', { name: 'Hide side panel' }));
    expect(screen.queryByRole('complementary', { name: 'Templates and send later' })).toBeNull();
    cleanup();
    compose({ mode: 'new' });
    expect(screen.queryByRole('complementary', { name: 'Templates and send later' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show side panel' }));
    expect(screen.getByRole('complementary', { name: 'Templates and send later' })).toBeTruthy();
  });

  it('is a popover from Template ▾ and Send ▾ when the composer is narrow', async () => {
    size.area = 820;
    net.templates = [{ id: 3, name: 'Weekly update', body_html: '<div>Update</div>', mine: true, shared: false }];
    compose({ mode: 'new', to: 'ann@livezen.test' });
    expect(screen.queryByRole('complementary', { name: 'Templates and send later' })).toBeNull();
    // No "Show side panel" while it cannot dock.
    expect(screen.queryByRole('button', { name: 'Show side panel' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Template' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Browse templates/ }));
    const templates = screen.getByRole('dialog', { name: 'Templates' });
    expect(within(templates).getByRole('button', { name: /Weekly update/ })).toBeTruthy();
    fireEvent.keyDown(templates, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Templates' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'More send options' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Pick a date and time/ }));
    const later = screen.getByRole('dialog', { name: 'Send later' });
    expect(within(later).getByRole('radio', { name: /Pick a date and time/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.change(within(later).getByLabelText('Date and time to send'), { target: { value: '2030-01-02T09:30' } });
    fireEvent.click(within(later).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(net.post).toHaveBeenCalledWith('/api/mail/send', expect.objectContaining({ schedule_at: new Date('2030-01-02T09:30').toISOString() })));
  });

  it('offers Send later only in Send ▾ and the panel', () => {
    size.area = 1400;
    compose({ mode: 'new', to: 'a@b.co' });
    expect(screen.queryAllByRole('button', { name: /send later/i })).toHaveLength(0);
    const panel = screen.getByRole('complementary', { name: 'Templates and send later' });
    expect(within(panel).getAllByRole('radiogroup', { name: 'Send later' })).toHaveLength(1);
    // Nothing chosen yet: the panel's Schedule waits.
    expect((within(panel).getByRole('button', { name: 'Schedule' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'More send options' }));
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Tomorrow morning/ })).toBeTruthy();
  });
});

describe('recipients', () => {
  it('adds and removes chips, marks an address that is not one, and warns about other organisations', () => {
    compose({ mode: 'new' });
    const to = screen.getByRole('combobox', { name: 'To' });
    fireEvent.change(to, { target: { value: 'ann@livezen.test, bob@elsewhere.org, not-an-address, ' } });
    const chip = (a: string) => document.querySelector<HTMLElement>(`[data-recipient="${a}"]`)!;
    expect(chip('ann@livezen.test').dataset.external).toBeUndefined();
    expect(chip('ann@livezen.test').dataset.invalid).toBeUndefined();
    expect(chip('bob@elsewhere.org').dataset.external).toBe('true');
    expect(chip('bob@elsewhere.org').className).toContain('border-warning');
    expect(chip('bob@elsewhere.org').title).toMatch(/outside your organisation/);
    expect(chip('not-an-address').dataset.invalid).toBe('true');
    expect(chip('not-an-address').className).toContain('border-danger');
    expect(to.getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Remove not-an-address' }));
    expect(document.querySelector('[data-recipient="not-an-address"]')).toBeNull();
    expect(to.getAttribute('aria-invalid')).toBeNull();
    // The person's initials stand in for a photo.
    expect(chip('ann@livezen.test').textContent).toMatch(/^Aann@livezen.test/);
  });

  it('suggests people from Mail autocomplete and Contacts as you type', async () => {
    net.get.mockImplementation(async (path: string) =>
      path === '/api/mail/autocomplete' ? { suggestions: [{ email: 'rita@livezen.test', name: 'Rita Silva' }] } : path === '/api/contacts/lookup' ? { results: [{ kind: 'contact', id: 9, name: 'Ravi Kumar', email: 'ravi@partner.org', subtitle: 'Partner' }] } : {},
    );
    compose({ mode: 'new' });
    fireEvent.change(screen.getByRole('combobox', { name: 'To' }), { target: { value: 'ra' } });
    expect(await screen.findByRole('option', { name: /Rita Silva/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Ravi Kumar/ })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('option', { name: /Ravi Kumar/ })).getAllByRole('button').at(-1)!);
    expect(document.querySelector<HTMLElement>('[data-recipient="ravi@partner.org"]')!.dataset.external).toBe('true');
    expect(screen.getByText('Ravi Kumar')).toBeTruthy();
  });

  it('opens Cc and Bcc on rows of their own', () => {
    compose({ mode: 'new' });
    fireEvent.click(screen.getByRole('button', { name: 'Cc' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bcc' }));
    expect([...document.querySelectorAll('[data-field-row]')].map((r) => r.firstElementChild!.textContent)).toEqual(['From', 'To', 'Cc', 'Bcc', 'Subject']);
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Bcc' }));
  });

  it('tells external from internal by the sender’s own domains', () => {
    expect(isExternal('a@livezen.test', ['livezen.test'])).toBe(false);
    expect(isExternal('a@LiveZen.TEST', ['livezen.test'])).toBe(false);
    expect(isExternal('a@other.test', ['livezen.test'])).toBe(true);
    expect(isExternal('not-an-address', ['livezen.test'])).toBe(false);
    expect(isExternal('a@other.test', [])).toBe(false);
  });
});

describe('checks before sending', () => {
  it('asks "Send without a subject?" and sends on Send anyway', async () => {
    const { close } = compose({ mode: 'new', to: 'ann@livezen.test', body: 'Hello' });
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' }).textContent).toContain('Hello'));
    fireEvent.click(within(screen.getByRole('group', { name: 'Send options' })).getByRole('button', { name: 'Send' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send without a subject?' });
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add a subject' }));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('group', { name: 'Send options' })).getByRole('button', { name: 'Send' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Send without a subject?' })).getByRole('button', { name: 'Send anyway' }));
    expect(close).toHaveBeenCalled();
  });

  it('finds a promised attachment in what was written, never in quoted text', () => {
    expect(mentionsAttachment('Please find the plan below')).toBe(true);
    expect(mentionsAttachment('The contract is enclosed.')).toBe(true);
    expect(mentionsAttachment('See the attachment')).toBe(true);
    expect(mentionsAttachment('I have attached it')).toBe(true);
    expect(mentionsAttachment('Thanks, see you Monday')).toBe(false);
    expect(mentionsAttachment('Thanks\n> see attached report')).toBe(false);
    expect(mentionsAttachment('Thanks\nOn Mon 2 Oct Pat wrote:\nI attached the plan')).toBe(false);
    expect(mentionsAttachment('Noted.\n-----Original Message-----\nPlease find attached')).toBe(false);
    expect(mentionsAttachment('Noted.\nFrom: Pat <pat@x.org>\nSent: Monday\nattachment here')).toBe(false);
    expect(withoutQuoted('Mine\n> theirs\nMine too')).toBe('Mine\nMine too');
    expect(sendChecks({ subject: 'Plan', attachments: [] }, 'ok\n> enclosed')).toEqual([]);
  });

  it('sends a reply whose only mention of an attachment is quoted inside the message without asking', async () => {
    net.call.mockImplementation(async (ch: string) => (ch === 'offline:getDraft' ? { content: { to: 'pat@example.org', cc: '', bcc: '', subject: 'Re: Plan', html: '<div>Thanks, got it</div><blockquote>Please find the plan attached</blockquote>', quote: '', from: '1', v: 2 } } : null));
    const { close, box } = compose({ mode: 'reply', to: 'pat@example.org', subject: 'Re: Plan', inReplyTo: '<p@x>' });
    await waitFor(() => expect(box().textContent).toContain('Thanks, got it'));
    fireEvent.click(within(screen.getByRole('group', { name: 'Send options' })).getByRole('button', { name: 'Send' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(close).toHaveBeenCalled();
  });

  it('asks when the message says "please find" and nothing is attached', async () => {
    const { close, box } = compose({ mode: 'new', to: 'ann@livezen.test', subject: 'Plan', body: 'Please find the plan' });
    await waitFor(() => expect(box().textContent).toContain('Please find'));
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Did you mean to attach a file?' })).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });
});

describe('toolbar overflow', () => {
  const groups: ToolGroup[] = [
    { id: 'a', label: 'Add', items: ['Attach', 'Template', 'Signature'].map((n) => ({ id: n.toLowerCase(), label: n, icon: 'file', caption: n, run: vi.fn() })) },
    { id: 'b', label: 'More', items: ['Suggest times', 'Mail merge', 'Options'].map((n) => ({ id: n.toLowerCase().replace(' ', '-'), label: n, icon: 'file', caption: n, run: vi.fn() })) },
  ];
  const shown = () => screen.getAllByRole('button').filter((b) => !b.hidden && b.getAttribute('aria-label') !== 'More tools');

  it('shows captions when there is room', () => {
    size.row = 1000;
    render(<ToolbarRow groups={groups} label="Message actions" collapse />);
    expect(shown()).toHaveLength(6);
    expect(shown().every((b) => b.textContent)).toBe(true);
    expect(screen.queryByRole('button', { name: 'More tools' })).toBeNull();
    expect(screen.getByRole('toolbar').hasAttribute('data-compact')).toBe(false);
  });

  it('drops the captions first, keeping the names in tooltips', () => {
    size.row = 300;
    render(<ToolbarRow groups={groups} label="Message actions" collapse />);
    expect(screen.getByRole('toolbar').getAttribute('data-compact')).toBe('true');
    expect(shown()).toHaveLength(6);
    expect(shown().every((b) => !b.textContent && b.title)).toBe(true);
    expect(screen.queryByRole('button', { name: 'More tools' })).toBeNull();
  });

  it('then moves what still does not fit into ⋯ More, never wrapping', () => {
    size.row = 120;
    render(<ToolbarRow groups={groups} label="Message actions" collapse />);
    const more = screen.getByRole('button', { name: 'More tools' });
    expect(shown().length).toBeLessThan(6);
    expect(shown().length).toBeGreaterThan(0);
    fireEvent.click(more);
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Options/ })).toBeTruthy();
    // The row itself never wraps.
    expect(document.querySelector('[data-ov-row]')!.className).toContain('overflow-hidden');
    expect(document.querySelector('[data-ov-row]')!.className).not.toContain('flex-wrap');
  });

  it('can join the formatting row on a wide screen when asked', () => {
    localStorage.setItem('ws.mail.composeOneRow', '1');
    size.form = 1400;
    compose({ mode: 'new' });
    expect(screen.queryByRole('toolbar', { name: 'Message actions' })).toBeNull();
    const formatting = screen.getByRole('toolbar', { name: 'Message formatting' });
    expect(within(formatting).getByRole('button', { name: 'Attach' })).toBeTruthy();
    cleanup();
    size.form = 1000;
    compose({ mode: 'new' });
    expect(screen.getByRole('toolbar', { name: 'Message actions' })).toBeTruthy();
  });
});

describe('the footer', () => {
  it('says how the draft stands, calmly', () => {
    expect(draftStatus({ saving: true, savedAt: null, restored: false, edited: true })).toBe('Saving…');
    expect(draftStatus({ saving: false, savedAt: '2026-10-03T00:41:00Z', restored: false, edited: true })).toMatch(/^Draft saved /);
    expect(draftStatus({ saving: false, savedAt: null, restored: true, edited: false })).toBe('Restored from this computer');
    expect(draftStatus({ saving: false, savedAt: null, restored: false, edited: false })).toBe('');
  });

  it('shows Saving… while typing and Draft saved once written', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    compose({ mode: 'new', to: 'ann@livezen.test' });
    const status = document.querySelector<HTMLElement>('[data-draft-status]')!;
    expect(status.className).toContain('text-ink-3');
    expect(status.className).not.toMatch(/danger|warning/);
    act(() => {
      fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Plan' } });
    });
    expect(status.textContent).toBe('Saving…');
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(status.textContent).toMatch(/^Draft saved /);
    expect(net.call).toHaveBeenCalledWith('offline:saveDraft', expect.objectContaining({ context: 'compose:new' }));
  });

  it('writes the draft straight away when a field loses focus', () => {
    compose({ mode: 'new' });
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Plan' } });
    expect(net.call).not.toHaveBeenCalledWith('offline:saveDraft', expect.anything());
    fireEvent.blur(screen.getByLabelText('Subject'));
    expect(net.call).toHaveBeenCalledWith('offline:saveDraft', expect.objectContaining({ content: expect.objectContaining({ subject: 'Plan' }) }));
  });

  it('asks before Discard, and keeps the draft on Keep writing', async () => {
    const { close } = compose({ mode: 'new', to: 'ann@livezen.test' });
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    const dialog = screen.getByRole('dialog', { name: 'Discard this draft?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep writing' }));
    expect(close).not.toHaveBeenCalled();
    expect(net.call).not.toHaveBeenCalledWith('offline:deleteDraft', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard this draft?' })).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(net.call).toHaveBeenCalledWith('offline:deleteDraft', { module: 'mail', context: 'compose:new' });
  });

  it('shows attachments as chips above the footer: name, size, ×, and progress while uploading', async () => {
    let finish: (v: unknown) => void = () => undefined;
    net.request.mockImplementation(() => new Promise((r) => (finish = r)));
    net.call.mockImplementation(async (ch: string) => (ch === 'offline:getDraft' ? { content: { to: 'a@b.co', cc: '', bcc: '', subject: 'S', html: '<div>Files</div>', attachments: [{ token: 't1', name: 'budget.xlsx', size: 2048 }], quote: '', from: '1', v: 2 } } : null));
    compose({ mode: 'new' });
    const list = await screen.findByRole('list', { name: 'Attachments' });
    const footer = document.querySelector('[data-compose-footer]')!;
    expect(list.nextElementSibling).toBe(footer);
    const chip = within(list).getByText('budget.xlsx').closest('li')!;
    expect(chip.textContent).toContain('2.0 KB');
    const pdf = new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' });
    fireEvent.paste(screen.getByRole('textbox', { name: 'Message' }), { clipboardData: { files: [pdf], getData: () => '' } });
    expect(await within(list).findByRole('progressbar', { name: 'Uploading notes.pdf' })).toBeTruthy();
    // Send waits for the upload.
    expect((within(screen.getByRole('group', { name: 'Send options' })).getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish({ data: { token: 't2', name: 'notes.pdf', size: 4 } }));
    expect(within(list).queryByRole('progressbar')).toBeNull();
    expect(within(list).getByText('notes.pdf')).toBeTruthy();
    fireEvent.click(within(chip).getByRole('button', { name: 'Remove budget.xlsx' }));
    expect(within(list).queryByText('budget.xlsx')).toBeNull();
  });

  it('offers Send and archive on a reply, archiving the message once the reply has gone', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const source = { uid: '77', folder: 'inbox', mailbox: '1' };
    const { close } = compose({ mode: 'reply', to: 'pat@example.org', subject: 'Re: Plan', inReplyTo: '<p@x>', source });
    fireEvent.click(screen.getByRole('button', { name: 'More send options' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Send and archive/ }));
    expect(close).toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(8_100);
    });
    await act(async () => undefined);
    expect(net.send).toHaveBeenCalled();
    expect(net.action).toHaveBeenCalledWith(source, 'archive', 'Re: Plan');
  });

  it('has no Send and archive on a new message, and Send as… only with more than one account', () => {
    compose({ mode: 'new', to: 'a@b.co' });
    fireEvent.click(screen.getByRole('button', { name: 'More send options' }));
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: /Send and archive|Send as/ })).toBeNull();
    cleanup();
    render(<Compose seed={{ mode: 'new', to: 'a@b.co', subject: 'S' }} boxes={TWO} defaultBox="1" offline={false} onClose={vi.fn()} onReopen={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More send options' }));
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Send as/ }));
    expect(screen.getByRole('menuitemradio', { name: /Sales/ })).toBeTruthy();
  });

  it('pops out into a window that finds the same draft', async () => {
    const onPopOut = vi.fn();
    const { close } = compose({ mode: 'reply', to: 'pat@example.org', subject: 'Re: Plan', inReplyTo: '<p@x>' }, { onPopOut });
    fireEvent.click(screen.getByRole('button', { name: 'Pop out' }));
    await waitFor(() => expect(onPopOut).toHaveBeenCalled());
    const route = onPopOut.mock.calls[0]![0] as string;
    expect(route).toBe(popOutRoute({ mode: 'reply', to: 'pat@example.org', subject: 'Re: Plan', inReplyTo: '<p@x>' }));
    const q = new URLSearchParams(route.split('?')[1]);
    expect([q.get('compose'), q.get('mode'), q.get('irt'), q.get('subject')]).toEqual(['1', 'reply', '<p@x>', 'Re: Plan']);
    expect(close).toHaveBeenCalled();
    cleanup();
    compose({ mode: 'new' });
    expect(screen.queryByRole('button', { name: 'Pop out' })).toBeNull();
  });
});

describe('keys', () => {
  it('sends with Ctrl+Enter', () => {
    const { close } = compose({ mode: 'new', to: 'ann@livezen.test', subject: 'Hi' });
    fireEvent.keyDown(screen.getByLabelText('Subject'), { key: 'Enter', ctrlKey: true });
    expect(close).toHaveBeenCalled();
  });

  it('sends with ⌘Enter too', () => {
    const { close } = compose({ mode: 'new', to: 'ann@livezen.test', subject: 'Hi' });
    fireEvent.keyDown(screen.getByLabelText('Subject'), { key: 'Enter', metaKey: true });
    expect(close).toHaveBeenCalled();
  });

  it('asks before discarding with Ctrl+Shift+D', async () => {
    const { close } = compose({ mode: 'new', to: 'ann@livezen.test' });
    fireEvent.keyDown(screen.getByLabelText('Subject'), { key: 'D', ctrlKey: true, shiftKey: true });
    const dialog = screen.getByRole('dialog', { name: 'Discard this draft?' });
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it('puts the message aside with Esc, its draft written', () => {
    const onMinimise = vi.fn();
    const { close } = compose({ mode: 'new', to: 'ann@livezen.test' }, { onMinimise });
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Draft' } });
    fireEvent.keyDown(screen.getByLabelText('Subject'), { key: 'Escape' });
    expect(onMinimise).toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(net.call).toHaveBeenCalledWith('offline:saveDraft', expect.objectContaining({ content: expect.objectContaining({ subject: 'Draft' }) }));
    cleanup();
    // Without a tab to minimise to, it closes; the draft stays on this computer.
    const second = compose({ mode: 'new' });
    fireEvent.keyDown(screen.getByLabelText('Subject'), { key: 'Escape' });
    expect(second.close).toHaveBeenCalled();
    expect(net.call).not.toHaveBeenCalledWith('offline:deleteDraft', expect.anything());
  });

  it('leaves Esc to an open menu', () => {
    const onMinimise = vi.fn();
    compose({ mode: 'new' }, { onMinimise });
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(onMinimise).not.toHaveBeenCalled();
  });
});
