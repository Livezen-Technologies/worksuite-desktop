// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
import type * as AttachmentViewer from '../../../src/modules/chat/AttachmentViewer';

/**
 * The shared chat kit (C-02 "Conversation thread on the shared chat kit"; SRS RDC-11/12/13/17, LIVE-12;
 * worksuite-desktop#229): Team Chat and website chats render their messages with the same components.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({})), apiPost: vi.fn(async () => ({})) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, hasDesktop: () => true }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ openLink: vi.fn() }), openWebLink: vi.fn() }));
vi.mock('../../../src/modules/chat/AttachmentViewer', async (orig) => ({ ...(await orig<typeof AttachmentViewer>()), openChatAttachment: vi.fn() }));

import { app } from '../../../src/core/app-state';
import { TEAM_CAPS, WEBSITE_CAPS } from '../../../src/modules/chat/kit/caps';
import { groupMessages, positionIn, type KitItem } from '../../../src/modules/chat/kit/grouping';
import { shortUrl } from '../../../src/modules/chat/kit/LinkPreview';
import { messageActionItems, type MessageHandlers } from '../../../src/modules/chat/kit/MessageActions';
import { readableName } from '../../../src/modules/chat/kit/MessageAttachment';
import { MessageList } from '../../../src/modules/chat/kit/MessageList';
import { byTime, eventsForThread, fromChatMessage, fromWebsiteMessage, fromWidgetEvent, type KitMessage } from '../../../src/modules/chat/kit/model';
import { SharedFiles, sharedFilesOf } from '../../../src/modules/chat/kit/SharedFiles';
import type { ChatMessage } from '../../../src/modules/chat/types';
import type { WebsiteMessage } from '../../../src/modules/chat/website/api';

const T0 = Date.parse('2026-10-04T05:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

const chat = (o: Partial<ChatMessage> & { id: number }): ChatMessage => ({
  room_id: 1,
  sender_id: 7,
  sender_name: 'Asha',
  type: 'text',
  message: null,
  file: null,
  reactions: [],
  reply_preview: null,
  edited: false,
  deleted: false,
  receipt: null,
  client_message_id: null,
  created_at: at(0),
  ...o,
});

const web = (o: Partial<WebsiteMessage> & { id: number }): WebsiteMessage => ({ body: null, from: 'visitor', agent: null, at: at(0), file: null, ...o });
const ctx = { me: 3, visitor: 'Visitor 4F2A', canReply: true };

const file = (o: Partial<NonNullable<ChatMessage['file']>> = {}): NonNullable<ChatMessage['file']> => ({
  id: 1, kind: 'file', filename: 'a.bin', mime: 'application/octet-stream', size: 2048, is_image: false, duration_ms: null, width: null, height: null, preview: null, status: 'ready',
  url: '/api/chat/files/x', download_url: '/api/chat/files/x', thumb_url: null, poster_url: null, ...o,
});

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const list = (items: KitItem[], caps = TEAM_CAPS, handlers: MessageHandlers = {}) => wrap(<MessageList items={items} caps={caps} look="page" handlers={handlers} />);

beforeEach(() => {
  app.set({ auth: { user: { id: '3' }, server: { origin: 'https://example.test' } } as never });
});
afterEach(() => {
  cleanup();
  app.set({ auth: null });
});

describe('grouping (C-02)', () => {
  it('puts a divider before each day and runs one author within five minutes together', () => {
    const items = [
      fromWebsiteMessage(web({ id: 1, body: 'Hi', at: at(0) }), ctx),
      fromWebsiteMessage(web({ id: 2, body: 'Five seats', at: at(1) }), ctx),
      fromWebsiteMessage(web({ id: 3, body: 'Still there?', at: at(9) }), ctx),
      fromWebsiteMessage(web({ id: 4, body: 'Nuwan joined the chat', from: 'system', at: at(10) }), ctx),
      fromWebsiteMessage(web({ id: 5, body: 'Yes', from: 'agent', agent: 'Nuwan', agent_id: 3, at: at(11) }), ctx),
      fromWebsiteMessage(web({ id: 6, body: 'A note', from: 'agent', agent: 'Nuwan', agent_id: 3, visibility: 'internal', at: at(12) }), ctx),
      fromWebsiteMessage(web({ id: 7, body: 'Next day', at: at(24 * 60) }), ctx),
    ];
    const rows = groupMessages(items);
    expect(rows.map((r) => (r.type === 'group' ? r.messages.map((m) => m.id) : r.type))).toEqual(['day', [1, 2], [3], 'line', [5], [6], 'day', [7]]);
    expect([0, 1, 2].map((i) => positionIn(3, i))).toEqual(['first', 'middle', 'last']);
    expect(positionIn(1, 0)).toBe('single');
  });

  it('draws the avatar on a run\'s first bubble and the time under the last', () => {
    const view = list([
      fromChatMessage(chat({ id: 1, message: 'One', created_at: at(0) }), '3'),
      fromChatMessage(chat({ id: 2, message: 'Two', created_at: at(1) }), '3'),
      fromChatMessage(chat({ id: 3, message: 'Mine', sender_id: 3, sender_name: 'Me', created_at: at(2), receipt: { status: 'read', read: 2, total: 2 } }), '3'),
    ]);
    const bubbles = [...view.container.querySelectorAll('[data-bubble]')];
    expect(bubbles).toHaveLength(3);
    // The first of Asha's two carries her name; the second sits under it, closer.
    expect(within(bubbles[0] as HTMLElement).getByText('Asha')).toBeTruthy();
    expect(within(bubbles[1] as HTMLElement).queryByText('Asha')).toBeNull();
    expect(bubbles[1]!.parentElement!.className).toContain('mt-1');
    expect(bubbles[0]!.parentElement!.querySelector('[aria-hidden="true"].w-\\[30px\\]')).toBeNull();
    expect(bubbles[1]!.parentElement!.querySelector('.w-\\[30px\\]')).toBeTruthy();
    // My message: time and ticks under it.
    expect(within(bubbles[2] as HTMLElement).getByRole('img', { name: 'Read by 2' })).toBeTruthy();
    expect(view.container.querySelectorAll('[data-day]')).toHaveLength(1);
  });
});

describe('adapters', () => {
  it('maps a Team Chat message: own side, ticks, card and the server\'s permissions', () => {
    const m = fromChatMessage(chat({ id: 9, sender_id: 3, message: 'Done', receipt: { status: 'delivered', read: 0, total: 1 }, can: { edit: true } }), '3');
    expect(m).toMatchObject({ kind: 'text', own: true, author: { role: 'self', name: 'Asha' }, receipt: 'delivered', receiptLabel: 'Delivered', can: { edit: true } });
    expect(fromChatMessage(chat({ id: 2, type: 'system', message: 'Asha joined' }), '3').kind).toBe('system');
    expect(fromChatMessage(chat({ id: 3, type: 'call', call_uuid: 'x' }), '3').kind).toBe('call');
    expect(fromChatMessage(chat({ id: 4, message: 'See https://example.test/tasks?task=5' }), '3', 'https://example.test').card).toBe(true);
  });

  it('maps a website message: who wrote it, the file through the staff route, the quote, what may be done', () => {
    const m = fromWebsiteMessage(
      web({ id: 4, body: 'Yearly.', from: 'agent', agent: 'Nuwan', agent_id: 7, at: at(2), reply_to: 1, reply: { id: 1, body: 'Lifetime?', from: 'visitor', agent: null, file: null }, file: { url: '/chat/widget-admin/files/abc', filename: 'q.pdf', mime: 'application/pdf', size: 10, is_image: false } }),
      { ...ctx, status: 'read', footer: 'Read 10:43' },
    );
    expect(m).toMatchObject({ own: true, signed: true, author: { role: 'staff', name: 'Nuwan' }, reply: { author: 'Visitor 4F2A', snippet: 'Lifetime?' }, receipt: 'read', receiptLabel: 'Read by the visitor', footer: 'Read 10:43', can: { reply: true, react: false } });
    expect(m.files![0]).toMatchObject({ url: '/api/chat/widget-admin/files/abc', by: 'Nuwan' });
    expect(fromWebsiteMessage(web({ id: 5, from: 'bot', agent: 'Olema', body: 'Hello' }), ctx)).toMatchObject({ own: false, author: { role: 'bot', name: 'Olema' } });
    expect(fromWebsiteMessage(web({ id: 6, from: 'agent', agent_id: 3, body: 'n', visibility: 'internal' }), ctx)).toMatchObject({ internal: true, author: { role: 'self' }, can: { reply: false } });
    expect(fromWebsiteMessage(web({ id: 7, body: 'x', reply_to: 2 }), ctx).replyRemoved).toBe(true);
  });

  it('lets staff react to what the visitor can see, on a server that sends reactions (Communication 1.60.0)', async () => {
    const rx = [{ emoji: '👍', count: 1, mine: false, names: ['Visitor 4F2A'] }];
    const m = fromWebsiteMessage(web({ id: 8, body: 'Thanks', reactions: rx }), ctx);
    expect(m).toMatchObject({ reactions: rx, can: { react: true } });
    // Not a note, not a deleted message, not without the right to reply.
    expect(fromWebsiteMessage(web({ id: 9, from: 'agent', agent_id: 3, body: 'n', visibility: 'internal', reactions: [] }), ctx).can?.react).toBe(false);
    expect(fromWebsiteMessage(web({ id: 10, body: 'x', deleted: true, reactions: [] }), ctx).can?.react).toBe(false);
    expect(fromWebsiteMessage(web({ id: 11, body: 'x', reactions: [] }), { ...ctx, canReply: false }).can?.react).toBe(false);

    // Drawn under the message, and a chip sends the same emoji back.
    const onReact = vi.fn();
    list([m], WEBSITE_CAPS, { onReact });
    const chip = await screen.findByRole('button', { name: /👍/ });
    fireEvent.click(chip);
    expect(onReact).toHaveBeenCalledWith(expect.objectContaining({ id: 8 }), '👍');
  });

  it('turns a page visit into an activity line, keeps this visit\'s events, and orders everything by time', () => {
    const events = [
      { id: 1, kind: 'page_view', url: 'https://x.lk/old', title: null, at: at(-3000), seconds: null, new_visit: true },
      { id: 2, kind: 'page_view', url: 'https://x.lk/', title: null, at: at(-5), seconds: 30, new_visit: true },
      { id: 3, kind: 'page_view', url: 'https://x.lk/shop/x', title: null, at: at(-4), seconds: 125, new_visit: false },
    ];
    const visit = eventsForThread(events, at(0));
    expect(visit.map((e) => e.id)).toEqual([2, 3]);
    expect(fromWidgetEvent(visit[1]!).body).toBe('→ Opened /shop/x · 2 min');
    expect(fromWidgetEvent(visit[0]!).body).toBe('→ Opened / · 30 s');
    const merged = byTime([fromWebsiteMessage(web({ id: 1, body: 'Hi', at: at(-4) }), ctx), ...visit.map((e, i) => fromWidgetEvent(e, i))]);
    expect(merged.map((m) => m.kind)).toEqual(['activity', 'activity', 'text']);
    const view = list(merged, WEBSITE_CAPS);
    expect(screen.getByText('→ Opened /shop/x · 2 min')).toBeTruthy();
    expect(view.container.querySelectorAll('[data-activity]')).toHaveLength(2);
  });
});

describe('attachments (RDC-13)', () => {
  it('never shows a machine\'s file name: a photo or file named from when it was sent', () => {
    expect(readableName({ filename: '3f2a9c1e-5b7d-4e2a-9c1e-5b7d4e2a9c1e.jpg', mime: 'image/jpeg' }, at(0))).toMatch(/^Photo – .+\.jpg$/);
    expect(readableName({ filename: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', mime: 'application/pdf' }, at(0))).toMatch(/^File – .+\.pdf$/);
    expect(readableName({ filename: 'blob', mime: 'image/png' }, at(0))).toMatch(/^Photo – .+\.png$/);
    expect(readableName({ filename: 'Adobe-CC-Teams-Quote.pdf', mime: 'application/pdf' }, at(0))).toBe('Adobe-CC-Teams-Quote.pdf');
    expect(readableName({ filename: 'IMG_2231.HEIC', mime: 'image/heic' }, at(0))).toBe('IMG_2231.HEIC');
  });

  it('draws a picture by its type, not its extension, at most 280 px wide in its own shape', () => {
    const view = list([
      fromChatMessage(chat({ id: 1, file: file({ filename: 'scan.pdf', mime: 'image/png', width: 1120, height: 800, url: '/api/chat/files/p' }) }), '3'),
      fromChatMessage(chat({ id: 2, file: file({ filename: 'photo.png', mime: 'application/pdf' }), created_at: at(1) }), '3'),
    ]);
    const thumb = view.container.querySelector('[data-thumb] img') as HTMLImageElement;
    expect(thumb.alt).toBe('scan.pdf');
    expect(thumb.style.width).toBe('280px');
    expect(thumb.style.height).toBe('200px');
    const card = view.container.querySelector('[data-file-card]')!;
    expect(card.textContent).toContain('photo.png');
    expect(within(card as HTMLElement).getByRole('button', { name: 'Open' })).toBeTruthy();
  });

  it('collapses a run of pictures into a grid of four with "+N" in a website chat, never in Team Chat', () => {
    const pics = [1, 2, 3, 4, 5, 6].map((i) => web({ id: i, at: at(i / 10), file: { url: `/chat/widget-admin/files/p${i}`, filename: `p${i}.png`, mime: 'image/png', size: 10, is_image: true } }));
    const view = list(pics.map((m) => fromWebsiteMessage(m, ctx)), WEBSITE_CAPS);
    const grid = view.container.querySelector('[data-attachment-grid]')!;
    expect(grid.querySelectorAll('button')).toHaveLength(4);
    expect(within(grid as HTMLElement).getByText('+2')).toBeTruthy();
    cleanup();
    const team = list([1, 2, 3].map((i) => fromChatMessage(chat({ id: i, created_at: at(i / 10), file: file({ filename: `p${i}.png`, mime: 'image/png', url: `/api/chat/files/p${i}` }) }), '3')));
    expect(team.container.querySelector('[data-attachment-grid]')).toBeNull();
    expect(team.container.querySelectorAll('[data-thumb]')).toHaveLength(3);
  });

  it('lists shared files: pictures as thumbnails, other files with a readable name, size and sender', () => {
    const items = [
      fromWebsiteMessage(web({ id: 1, at: at(0), file: { url: '/chat/widget-admin/files/a', filename: 'shot.png', mime: 'image/png', size: 94_208, is_image: true } }), ctx),
      fromWebsiteMessage(web({ id: 2, from: 'agent', agent: 'Nuwan', agent_id: 7, at: at(1), file: { url: '/chat/widget-admin/files/b', filename: 'Quote.pdf', mime: 'application/pdf', size: 188_416, is_image: false } }), ctx),
    ];
    const files = sharedFilesOf(items);
    expect(files.map((f) => f.file.filename)).toEqual(['Quote.pdf', 'shot.png']);
    const view = wrap(<SharedFiles files={files} />);
    expect(view.container.querySelectorAll('[data-shared-grid] img')).toHaveLength(1);
    expect(screen.getByText('Quote.pdf')).toBeTruthy();
    expect(screen.getByText(/· Nuwan$/)).toBeTruthy();
  });
});

describe('message actions by channel (RDC-12)', () => {
  const all: MessageHandlers = { onReply: vi.fn(), onReact: vi.fn(), onStar: vi.fn(), onPin: vi.fn(), onForward: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onCopyLink: vi.fn(), onCreateTask: vi.fn(), onSaveToDrive: vi.fn() };
  const m = (o: Partial<KitMessage> = {}): KitMessage => ({ ...fromChatMessage(chat({ id: 1, message: 'Hello', can: { reply: true, edit: true, forward: true, delete_everyone: true } }), '7'), ...o });

  it('Team Chat offers the full set; a website chat only Reply and Copy', () => {
    expect(messageActionItems(m(), TEAM_CAPS, all, 'page', vi.fn()).map((i) => i.label)).toEqual(['Reply', 'Forward…', 'Copy link', 'Star message', 'Pin message', 'Edit', 'Copy text', 'Delete…']);
    expect(messageActionItems(m(), TEAM_CAPS, all, 'drawer', vi.fn()).map((i) => i.label)).toEqual(['Reply', 'Copy message', 'Copy link', 'Pin message', 'Forward…', 'Create task', 'Edit', 'Delete…']);
    expect(messageActionItems(m(), WEBSITE_CAPS, all, 'page', vi.fn()).map((i) => i.label)).toEqual(['Reply', 'Copy text']);
  });

  it('a website chat draws reactions a message has but offers none to add', () => {
    const k = fromWebsiteMessage(web({ id: 1, body: 'Hi' }), ctx);
    list([{ ...k, reactions: [{ emoji: '👍', count: 1, mine: false }] }], WEBSITE_CAPS, { onReply: vi.fn(), onReact: vi.fn() });
    expect((screen.getByRole('button', { name: '👍 1' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('toolbar', { name: 'React' })).toBeNull();
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Reply', 'Copy text']);
  });
});

describe('who wrote it (RDC-11)', () => {
  it('a bot keeps its teal style and "Name · bot"; a staff-only note is amber and dashed, and says so', () => {
    list([
      fromWebsiteMessage(web({ id: 1, from: 'bot', agent: 'Olema', body: 'Auto answer from a starter', at: at(0) }), ctx),
      fromWebsiteMessage(web({ id: 2, from: 'agent', agent: 'Nuwan', agent_id: 7, visibility: 'internal', body: 'Match last year?', at: at(1) }), ctx),
    ], WEBSITE_CAPS);
    const bot = screen.getByText('Auto answer from a starter').closest('[data-bubble-body]')!;
    expect(bot.className).toContain('bg-teal-bg');
    expect(within(bot as HTMLElement).getByText('Olema · bot')).toBeTruthy();
    const note = screen.getByText('Match last year?').closest('[data-bubble-body]')!;
    expect(note.className).toContain('border-dashed');
    // Named in its label, as several staff see it (C-08): INTERNAL NOTE · NUWAN · ONLY STAFF SEE THIS.
    expect(note.closest('[data-bubble]')!.textContent).toContain('Internal note · Nuwan · only staff see this');
  });
});

describe('links', () => {
  it('shortens a long address to its site and path, keeping the whole address on the link', () => {
    expect(shortUrl('https://techubiz.com/a')).toBe('https://techubiz.com/a');
    expect(shortUrl('https://www.techubiz.com/shop/adobe-creative-cloud?utm_source=google&utm_medium=cpc')).toBe('techubiz.com/shop/adobe-creative-cloud…');
    expect(shortUrl('https://techubiz.com/a/very/long/path/that/goes/on/and/on/and/on/forever/and/ever').length).toBe(48);
    list([fromChatMessage(chat({ id: 1, message: 'See https://www.techubiz.com/shop/adobe-creative-cloud?utm_source=google&utm_medium=cpc' }), '3')]);
    const a = screen.getByRole('link');
    expect(a.textContent).toBe('techubiz.com/shop/adobe-creative-cloud…');
    expect(a.getAttribute('title')).toBe('https://www.techubiz.com/shop/adobe-creative-cloud?utm_source=google&utm_medium=cpc');
  });
});

describe('one conversation, two channels, the same bubbles (C-02 parity)', () => {
  it('draws Team Chat and website items through the same bubble components', () => {
    const said = [
      { who: 'them', text: 'Is the licence yearly?', min: 0 },
      { who: 'them', text: 'For five seats.', min: 1 },
      { who: 'us', text: 'Yearly, renewed each March.', min: 2 },
    ];
    const team = said.map((s, i) => fromChatMessage(chat({ id: i + 1, message: s.text, sender_id: s.who === 'us' ? 3 : 7, sender_name: s.who === 'us' ? 'Nuwan' : 'Visitor 4F2A', created_at: at(s.min) }), '3'));
    const site = said.map((s, i) => fromWebsiteMessage(web({ id: i + 1, body: s.text, from: s.who === 'us' ? 'agent' : 'visitor', agent: s.who === 'us' ? 'Nuwan' : null, agent_id: s.who === 'us' ? 3 : null, at: at(s.min) }), ctx));
    const shape = (root: HTMLElement) =>
      [...root.querySelectorAll('[data-bubble]')].map((b) => ({
        text: b.querySelector('[data-bubble-body]')?.textContent,
        own: b.parentElement!.className.includes('flex-row-reverse'),
        body: b.querySelector('[data-bubble-body]')!.className.replace(/\s+/g, ' '),
      }));
    const a = shape(list(team, TEAM_CAPS).container);
    cleanup();
    const b = shape(list(site, WEBSITE_CAPS).container);
    expect(a.map((x) => [x.text, x.own])).toEqual(said.map((s) => [s.text, s.who === 'us']));
    expect(b.map((x) => [x.text, x.own])).toEqual(a.map((x) => [x.text, x.own]));
    // The same classes: same component, same tones and corners by position.
    expect(b.map((x) => x.body)).toEqual(a.map((x) => x.body));
  });
});

describe('website files and deleting from the server (#229)', () => {
  const base = { id: 9, body: null, from: 'agent' as const, agent: 'Nuwan', agent_id: 3, at: new Date(Date.now() - 60_000).toISOString() };
  it('uses the readable name, the thumbnail and the preview, and keeps the original to download', () => {
    const k = fromWebsiteMessage({ ...base, file: { url: '/chat/widget-admin/files/t', filename: 'IMG_1.heic', name: 'Photo – 4 Oct 2026, 11:31.jpg', mime: 'image/heic', size: 4_600_000, is_image: true, thumb_url: '/chat/widget-admin/files/t/thumb', preview_url: '/chat/widget-admin/files/t/preview', width: 1280, height: 960 } }, { me: 3, visitor: 'Visitor CC1B', canReply: true });
    expect(k.files![0]).toMatchObject({ filename: 'Photo – 4 Oct 2026, 11:31.jpg', thumb_url: '/api/chat/widget-admin/files/t/thumb', url: '/api/chat/widget-admin/files/t/preview', download_url: '/api/chat/widget-admin/files/t', width: 1280 });
    expect(k.can?.delete_everyone).toBe(true);
  });
  it('a deleted message has no file, no reply or copy, and cannot be deleted again; an old one cannot be deleted', () => {
    const gone = fromWebsiteMessage({ ...base, deleted: true, file: null }, { me: 3, visitor: 'V', canReply: true });
    expect([gone.deleted, gone.files, gone.can?.reply, gone.can?.delete_everyone]).toEqual([true, [], false, false]);
    const old = fromWebsiteMessage({ ...base, body: 'Hi', file: null, at: new Date(Date.now() - 20 * 60_000).toISOString() }, { me: 3, visitor: 'V', canReply: true });
    expect(old.can?.delete_everyone).toBe(false);
  });
});

describe('link cards (#229)', () => {
  it('finds the first link in a message', async () => {
    const { firstUrl } = await import('../../../src/modules/chat/kit/LinkPreview');
    expect(firstUrl('See https://techubiz.com/shop/adobe-creative-cloud?x=1, thanks')).toBe('https://techubiz.com/shop/adobe-creative-cloud?x=1');
    expect(firstUrl('no link here')).toBeNull();
    expect(WEBSITE_CAPS.linkPreviewPath).toBe('/api/chat/widget-admin/link-preview');
    expect(TEAM_CAPS.linkPreviewPath).toBeUndefined();
  });
});
