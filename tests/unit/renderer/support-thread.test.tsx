// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import { msg, serveWith } from './support-fixtures';

/**
 * A website chat made a ticket, as the thread shows it (worksuite-desktop#332): the chat's own lines small and grey,
 * its bot the Assistant's, amber for the desk's notes alone, one name and time for a run of lines, the visitor by
 * name; a file-only line's "[names]" not said twice, pictures drawn in the thread and opened in the viewer.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ openWebLink: vi.fn(), useTab: () => ({}), useTabTitle: () => undefined }));

const { request } = await import('../../../src/core/api');
const { app } = await import('../../../src/core/app-state');
const { Thread, authorName, isNote, messageChannel, speaker } = await import('../../../src/modules/support/Thread');
const { isPicture, onlyFileNames } = await import('../../../src/modules/support/MessageFiles');
const { forgetMediaPaths } = await import('../../../src/modules/support/files');
const { closePreview } = await import('../../../src/modules/chat/AttachmentViewer');

const file = (id: number, name: string, mime: string | null, over: Record<string, unknown> = {}) => ({ id, ticket_id: 1, message_id: 1, name, mime, size: 2048, public: true, scan_status: 'clean', created_by: null, created_at: null, ...over });
const at = (min: number) => `2026-10-04T09:${String(min).padStart(2, '0')}:00+05:30`;
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-message]'));
const row = (id: number) => document.querySelector<HTMLElement>(`[data-message="${id}"]`)!;

let log: ReturnType<typeof serveWith>;
beforeEach(() => {
  forgetMediaPaths();
  app.set({ auth: { server: { origin: 'https://ws.example.com' } } } as never);
  log = serveWith(request, {
    'GET /api/support/v1/attachments/11': { attachment: file(11, 'one.png', 'image/png'), url: '/media/tokenone1234' },
    'GET /api/support/v1/attachments/12': { attachment: file(12, 'two.jpg', 'image/jpeg'), url: '/media/tokentwo1234' },
    'GET /api/support/v1/attachments/13': { attachment: file(13, 'three.webp', 'image/webp'), url: '/media/tokenthree123' },
  });
});
afterEach(() => {
  act(() => closePreview());
  cleanup();
});

/** A website chat, as the server copies it onto a ticket. */
const chat = [
  msg(1, { from: 'system', channel: 'event', internal: true, author_name: 'Website chat', body: 'Website chat #123 — visitor details\nWebsite: Acme\nLocation: Colombo, Sri Lanka', created_at: at(0) }),
  msg(2, { from: 'requester', channel: 'chat', author_name: 'Visitor', body: 'Hi, my printer jams', created_at: at(1) }),
  msg(3, { from: 'assistant', channel: 'chat_bot', author_name: 'Ava', body: 'Have you tried turning it off and on?', created_at: at(2) }),
  msg(4, { from: 'system', channel: 'event', internal: false, author_name: 'Acme', body: 'Ayesha joined the chat', created_at: at(3) }),
  msg(5, { from: 'staff', channel: 'chat', author: { id: 1, name: 'Ayesha Fernando' }, author_name: 'Ayesha Fernando', delivery_channel: 'chat', delivery_status: 'delivered', body: 'Let me look', created_at: at(4) }),
  msg(6, { from: 'staff', internal: true, channel: 'note', author: { id: 1, name: 'Ayesha Fernando' }, author_name: 'Ayesha Fernando', body: 'Probably the fuser', created_at: at(5) }),
];

describe('a website chat on a ticket (#332)', () => {
  it('shows the chat’s own lines as small grey lines, the visitor details opening under the first, for the desk alone', () => {
    render(<Thread messages={chat as never} requester="Saman Kumara" />);
    const details = row(1);
    expect(details.dataset.from).toBe('system');
    expect(details.className).not.toMatch(/border/);
    expect(within(details).getByLabelText('Staff only')).toBeTruthy();
    expect(within(details).queryByText(/Colombo/)).toBeNull();
    fireEvent.click(within(details).getByRole('button', { name: /Website chat #123 — visitor details/ }));
    expect(within(details).getByText(/Location: Colombo, Sri Lanka/)).toBeTruthy();
    // A line the visitor saw has no lock and nothing to open.
    expect(within(row(4)).getByText('Ayesha joined the chat')).toBeTruthy();
    expect(within(row(4)).queryByLabelText('Staff only')).toBeNull();
    expect(within(row(4)).queryByRole('button')).toBeNull();
  });

  it('is amber for the desk’s notes alone, never the requester’s, the chat’s or its bot’s words', () => {
    render(<Thread messages={[...chat, msg(7, { from: 'requester', internal: true, channel: 'chat', author_name: 'Saman', created_at: at(30) })] as never} />);
    expect(rows().filter((r) => r.dataset.internal).map((r) => r.dataset.message)).toEqual(['6']);
    expect(within(row(6)).getByText('Internal note')).toBeTruthy();
    expect(screen.getAllByText('Internal note')).toHaveLength(1);
    expect(row(6).className).toMatch(/\bbg-warning-bg\b/);
    for (const id of [1, 2, 3, 4, 7]) expect(row(id).className).not.toMatch(/\bbg-warning-bg\b/);
    expect(isNote(chat[0] as never)).toBe(false);
    expect(isNote(chat[5] as never)).toBe(true);
  });

  it('gives the bot its own look, says how the visitor wrote and that replies were said in the chat, and names the visitor', () => {
    render(<Thread messages={chat as never} requester="Saman Kumara" />);
    expect(row(3).dataset.from).toBe('assistant');
    expect(within(row(3)).getByText('Ava')).toBeTruthy();
    expect(within(row(3)).getByText('Assistant')).toBeTruthy();
    expect(within(row(3)).queryByText('Replied to requester')).toBeNull();
    expect(within(row(2)).getByText('via Website chat')).toBeTruthy();
    expect(within(row(2)).getByText('Saman Kumara')).toBeTruthy();
    expect(within(row(2)).queryByText('Visitor')).toBeNull();
    expect(within(row(5)).getByText(/Sent in chat/)).toBeTruthy();
    expect(within(row(5)).queryByText(/Delivered|Emailed/)).toBeNull();
    // The words for each, and a server that marks the chat's lines by channel alone.
    expect(speaker({ from: 'staff', channel: 'event' } as never)).toBe('system');
    expect(speaker({ from: 'requester', channel: 'chat_bot' } as never)).toBe('assistant');
    expect(messageChannel(chat[2] as never, false)).toBeNull();
    expect(authorName(msg(9, { author_name: 'Nadeesha' }) as never, 'Saman Kumara')).toBe('Nadeesha');
    expect(authorName(msg(9, { author_name: 'Visitor #4521' }) as never, 'Saman Kumara')).toBe('Saman Kumara');
    expect(authorName(msg(9, { author_name: null }) as never, null)).toBe('Requester');
  });

  it('shows a name and time once for lines one person wrote within five minutes', () => {
    const run = [
      msg(1, { channel: 'chat', author_name: 'Saman', body: 'Hi', created_at: at(0) }),
      msg(2, { channel: 'chat', author_name: 'Saman', body: 'Are you there?', created_at: at(2) }),
      msg(3, { channel: 'chat', author_name: 'Saman', body: 'Hello?', created_at: at(6) }),
      msg(4, { channel: 'chat', author_name: 'Saman', body: 'Much later', created_at: at(20) }),
      msg(5, { from: 'staff', channel: 'chat', author: { id: 1, name: 'Ayesha' }, author_name: 'Ayesha', delivery_channel: 'chat', body: 'Yes', created_at: at(21) }),
      msg(6, { from: 'staff', internal: true, channel: 'note', author: { id: 1, name: 'Ayesha' }, author_name: 'Ayesha', body: 'Note', created_at: at(22) }),
    ];
    render(<Thread messages={run as never} />);
    expect(rows().map((r) => !!r.dataset.grouped)).toEqual([false, true, true, false, false, false]);
    expect(within(row(2)).queryByText('Saman')).toBeNull();
    expect(within(row(2)).getByText('Are you there?')).toBeTruthy();
    expect(screen.getAllByText('Saman')).toHaveLength(2);
  });
});

describe('a message’s files (#332)', () => {
  it('does not say a file-only line’s names twice', () => {
    const files = [file(11, 'one.png', 'image/png', { message_id: 1 }), file(20, 'report.pdf', 'application/pdf', { message_id: 1 })];
    render(<Thread messages={[msg(1, { channel: 'chat', body: '[one.png, report.pdf]' }), msg(2, { channel: 'chat', body: '[nothing.png]', created_at: at(30) })] as never} attachments={files as never} />);
    expect(screen.queryByText('[one.png, report.pdf]')).toBeNull();
    expect(within(row(1)).getByText('report.pdf')).toBeTruthy();
    // No file came with it (refused, say): the names are all there is.
    expect(screen.getByText('[nothing.png]')).toBeTruthy();
    expect(onlyFileNames('[b.pdf, a.png]', [{ name: 'a.png' }, { name: 'b.pdf' }])).toBe(true);
    expect(onlyFileNames('', [])).toBe(true);
    expect(onlyFileNames('See [a.png]', [{ name: 'a.png' }])).toBe(false);
    expect(onlyFileNames('…', [{ name: 'a.png' }])).toBe(true);
  });

  it('draws pictures in the thread, several as a grid, and opens them in the viewer; other files stay chips', async () => {
    const open = vi.fn();
    const files = [file(11, 'one.png', 'image/png'), file(12, 'two.jpg', 'image/jpeg'), file(13, 'three.webp', 'image/webp'), file(14, 'scan.pdf', 'application/pdf'), file(15, 'photo.heic', 'image/heic')];
    render(<Thread messages={[msg(1, { channel: 'chat', body: '[one.png, two.jpg, three.webp, scan.pdf, photo.heic]' })] as never} attachments={files as never} onOpenAttachment={open} />);
    const grid = screen.getByRole('list', { name: 'Pictures' });
    expect(grid.className).toMatch(/grid-cols-3/);
    await waitFor(() => expect(within(grid).getAllByRole('img')).toHaveLength(3));
    expect(within(grid).getByAltText('one.png').getAttribute('src')).toBe('https://ws.example.com/media/tokenone1234');
    const chips = screen.getByRole('list', { name: 'Files' });
    expect(within(chips).getByText('scan.pdf')).toBeTruthy();
    expect(within(chips).getByText('photo.heic')).toBeTruthy();
    fireEvent.click(within(chips).getByRole('button', { name: /scan\.pdf/ }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 14 }));
    // One link a picture, asked once.
    expect(log.filter((c) => c.path === '/api/support/v1/attachments/11')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'View two.jpg' }));
    const viewer = await screen.findByRole('dialog', { name: 'Preview two.jpg' });
    expect(within(viewer).getByText(/2 of 3/)).toBeTruthy();
    fireEvent.click(within(viewer).getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('dialog', { name: 'Preview three.webp' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('draws one picture alone, up to 240px; a picture too large or unknown stays a chip', async () => {
    render(<Thread messages={[msg(1, { channel: 'chat', body: 'Here it is' })] as never} attachments={[file(11, 'one.png', 'image/png')] as never} />);
    const grid = screen.getByRole('list', { name: 'Pictures' });
    expect(grid.className).not.toMatch(/grid/);
    expect(screen.getByText('Here it is')).toBeTruthy();
    const img = await within(grid).findByRole('img');
    expect(img.className).toMatch(/max-h-\[240px\]/);
    expect(isPicture(file(1, 'big.png', 'image/png', { size: 40 * 1024 * 1024 }) as never)).toBe(false);
    expect(isPicture(file(1, 'a.png', null) as never)).toBe(true);
    expect(isPicture(file(1, 'a.svg', 'image/svg+xml') as never)).toBe(false);
  });
});
