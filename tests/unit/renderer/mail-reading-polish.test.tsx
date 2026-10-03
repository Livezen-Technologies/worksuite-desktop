// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiGetMeta: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => ({ delivered: true })), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, hasDesktop: () => true }));

import { apiDelete, apiPost } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { rowMatches, ruleTakes } from '../../../src/modules/mail/clientRules';
import { comparable, conversationKeyOf, ignoreConversation, ignoredKeys, redundantInThread, stopIgnoring } from '../../../src/modules/mail/Conversations';
import { ImmersiveReader, paragraphsOf } from '../../../src/modules/mail/ImmersiveReader';
import { filterWords, type MailFilter } from '../../../src/modules/mail/MailRules';
import { cleanFormatRules, rowFormat } from '../../../src/modules/mail/ReadingSettings';
import type { MessageDetail, MessageRow } from '../../../src/modules/mail/types';

/**
 * ENH-MAIL-03 P5 reading and list polish: Ignore conversation (DMO-INB-10),
 * conditional formatting (DMO-INB-18) and the immersive reader (DMO-RD-04).
 */

const row = (over: Partial<MessageRow> = {}): MessageRow => ({ id: 7, from_name: 'Pat', from_email: 'pat@client.example', subject: 'Site visit', preview: '', is_read: true, is_starred: false, has_attachment: false, created_at: '2026-10-05 09:00:00', folder_slug: 'inbox', ...over });

beforeEach(() => {
  vi.mocked(apiPost).mockReset().mockResolvedValue({ where: 'server' } as never);
  vi.mocked(apiDelete).mockReset().mockResolvedValue({} as never);
  vi.mocked(call).mockReset().mockResolvedValue({ delivered: true } as never);
});
afterEach(() => cleanup());

describe('Ignore conversation (DMO-INB-10)', () => {
  it('knows a conversation only by a stable root Message-ID', () => {
    expect(conversationKeyOf({ conversation_key: '<Root.1@Mail.Example>' })).toBe('root.1@mail.example');
    expect(conversationKeyOf({ conversation_key: 'u:inbox:7' })).toBeNull();
    expect(conversationKeyOf({})).toBeNull();
  });

  it('keeps a rule and moves the messages here to Deleted Items; stopping brings one back', async () => {
    const here = [{ row: row({ id: 7 }), mailbox: '4', folder: 'inbox' }, { row: row({ id: 9 }), mailbox: '4', folder: 'inbox' }];
    const r = await ignoreConversation('root.1@mail.example', 'Site visit', '4', here);
    expect(r).toEqual({ where: 'server', moved: 2 });
    expect(apiPost).toHaveBeenCalledWith('/api/mail/rules/ignore', expect.objectContaining({ key: 'root.1@mail.example', subject: 'Site visit', mailbox: '4', device_id: expect.any(String) }), { mailbox: '4' });
    expect(vi.mocked(call).mock.calls.map(([, a]) => [(a as { path: string }).path, (a as { body: { action: string } }).body.action])).toEqual([['/api/mail/messages/7/action', 'trash'], ['/api/mail/messages/9/action', 'trash']]);

    vi.mocked(call).mockClear();
    await stopIgnoring('root.1@mail.example', { row: row({ id: 7 }), mailbox: '4', folder: 'trash' });
    expect(apiDelete).toHaveBeenCalledWith('/api/mail/rules/ignore?mailbox=4', { key: 'root.1@mail.example' });
    expect((vi.mocked(call).mock.calls[0]![1] as { body: { action: string; folder: string } }).body).toMatchObject({ action: 'inbox', folder: 'trash' });
  });

  it('is a rule this computer can run for a mailbox whose server keeps none, and the rules list says what it does', () => {
    const rule: MailFilter = { name: 'Ignored conversation: Site visit', field: 'thread', op: 'contains', value: 'root.1@mail.example', action: 'fileinto', action_arg: 'Trash', stop: true, enabled: true, run_location: 'client' };
    expect(ruleTakes(rule, { ...row(), conversation_key: '<ROOT.1@mail.example>' })).toBe(true);
    expect(ruleTakes(rule, { ...row(), conversation_key: 'other@mail.example' })).toBe(false);
    expect(rowMatches({ field: 'from', op: 'contains', value: 'root.1' }, { ...row(), conversation_key: 'root.1@mail.example' })).toBe(false);
    expect(ignoredKeys([rule, { ...rule, field: 'from', value: 'x' }])).toEqual(new Set(['root.1@mail.example']));
    expect(filterWords(rule)).toBe('A later message in this conversation → move to Deleted Items');
  });
});

describe('conditional formatting (DMO-INB-18)', () => {
  const rules = cleanFormatRules([
    { id: 'a', when: 'from', value: 'client.example', colour: 'red', bold: false, enabled: true },
    { id: 'b', when: 'unread', value: '', colour: null, bold: true, enabled: true },
    { id: 'c', when: 'category', value: 'Urgent', colour: 'orange', bold: true, enabled: false },
    { id: 'd', when: 'subject', value: '', colour: 'blue', bold: false, enabled: true },
    { id: 'e', when: 'evil', value: 'x', colour: 'red', bold: true, enabled: true },
    { id: 'f', when: 'flagged', value: '', colour: 'pink', bold: false, enabled: true },
  ]);

  it('keeps only rules with something to match and something to show', () => {
    expect(rules.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('formats a row by the first rule that matches, and skips rules turned off', () => {
    expect(rowFormat(row(), rules)).toEqual({ cls: 'text-danger', bold: false });
    expect(rowFormat(row({ from_email: 'kim@x.org', is_read: false }), rules)).toEqual({ cls: null, bold: true });
    expect(rowFormat(row({ from_email: 'kim@x.org', categories: [{ id: 1, name: 'urgent', colour: 'red' }] }), rules)).toBeNull();
    expect(rowFormat(row({ categories: [{ id: 1, name: 'Urgent', colour: 'red' }] }), [{ id: 'z', when: 'category', value: 'urgent', colour: 'teal', bold: false, enabled: true }])).toEqual({ cls: 'text-teal', bold: false });
  });
});

describe('immersive reader (DMO-RD-04)', () => {
  it('splits the text into paragraphs', () => {
    expect(paragraphsOf('Hi Asha,\n\nThe BOQ is attached.\nSee page 2.\n\n\n\nThanks')).toEqual(['Hi Asha,', 'The BOQ is attached.\nSee page 2.', 'Thanks']);
  });

  it('shows the words alone, remembers larger text and spacing, focuses a line and reads aloud on this computer', () => {
    const speak = vi.fn((u: { onend?: () => void }) => u.onend?.());
    const cancel = vi.fn();
    Object.assign(window, { speechSynthesis: { speak, cancel } });
    (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance = class {
      text: string;
      onend?: () => void;
      constructor(t: string) {
        this.text = t;
      }
    };
    const onPrefs = vi.fn();
    const onClose = vi.fn();
    render(<ImmersiveReader subject="Site visit" from="Pat <pat@client.example>" plain={'Hello <b>there</b>\n\nSecond'} prefs={{ focusLine: true }} onPrefs={onPrefs} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Immersive reader' });
    expect(dialog.textContent).toContain('Hello <b>there</b>');
    expect(dialog.querySelector('b')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Larger' }));
    expect(onPrefs).toHaveBeenLastCalledWith({ focusLine: true, size: 24 });
    fireEvent.click(screen.getByRole('button', { name: 'Wide spacing' }));
    expect(onPrefs).toHaveBeenLastCalledWith({ focusLine: true, spacing: 'wide' });
    const [first, second] = [dialog.querySelector('[data-para="0"]')!, dialog.querySelector('[data-para="1"]')!];
    expect(second.className).toContain('opacity-30');
    fireEvent.keyDown(first.parentElement!.parentElement!, { key: 'ArrowDown' });
    expect(first.className).toContain('opacity-30');
    fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }));
    expect(speak.mock.calls.map(([u]) => (u as { text: string }).text)).toEqual(['Second']);
    fireEvent.keyDown(first.parentElement!.parentElement!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Clean up conversation (DMO-INB-11)', () => {
  const msg = (id: number, at: string, html: string, over: Partial<MessageDetail> = {}): MessageDetail => ({ id, message_id: `<${id}@x>`, from_name: 'Pat', from_email: 'pat@x.org', subject: 'Plan', to: [], cc: [], body_html: html, is_starred: false, attachments: [], created_at: at, ...over });

  it('takes out only messages a later one quotes in full, never the newest, one with a file, a star or a flag, or a short one', () => {
    const first = msg(1, '2026-10-01 09:00:00', '<p>Please send the revised BOQ by Friday.</p>');
    const second = msg(2, '2026-10-01 10:00:00', '<p>Will do.</p><blockquote>&gt; Please send the revised BOQ<br>&gt; by Friday.</blockquote>');
    const withFile = msg(3, '2026-10-01 11:00:00', '<p>Here is the first draft of it attached.</p>', { attachments: [{ ref: '2', name: 'BOQ.xlsx', mime: 'x', size: 1 }] as never });
    const starred = msg(4, '2026-10-01 12:00:00', '<p>And one more thing to note on the plan.</p>', { is_starred: true });
    const flagged = msg(5, '2026-10-01 12:30:00', '<p>Flagged note that is quoted below too.</p>');
    const last = msg(6, '2026-10-01 13:00:00', '<p>Thanks</p><blockquote>Here is the first draft of it attached. And one more thing to note on the plan. Flagged note that is quoted below too.</blockquote>');
    const out = redundantInThread([last, flagged, starred, withFile, second, first], (m) => m.id === 5);
    expect(out.map((m) => m.id)).toEqual([1]);
    expect(comparable('<p>A&nbsp; b</p><blockquote>&gt; C</blockquote>')).toBe('a b c');
    expect(redundantInThread([msg(1, '2026-10-01 09:00:00', '<p>Ok</p>'), msg(2, '2026-10-01 10:00:00', '<p>Ok</p><p>Ok</p>')], () => false)).toEqual([]);
  });
});
