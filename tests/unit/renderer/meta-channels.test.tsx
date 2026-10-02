// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * Messenger and Instagram as channels of Chat (worksuite-desktop#36): in the toolbar with their unread counts once an
 * account is shared, their conversations each saying which channel and account they are on, answering within the
 * platform's rules (and saying why not), attachments, connecting through Facebook Login with a Page picker, and the
 * channel settings with status, errors, reconnect and disconnect.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const tab = { route: '/chat?channel=messenger', go: vi.fn() };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go };
  },
  useTabTitle: () => undefined,
}));

import { apiGet, apiPost } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import { closePreview } from '../../../src/modules/chat/AttachmentViewer';
import { AddChannel } from '../../../src/modules/chat/channels/AddChannel';
import { buildChannels, channelOf, channelRoute, rememberMeta } from '../../../src/modules/chat/channels/channels';
import { MetaChannel } from '../../../src/modules/chat/channels/MetaChannel';
import { MetaConnect } from '../../../src/modules/chat/channels/MetaConnect';
import { MetaSettings } from '../../../src/modules/chat/channels/MetaSettings';
import { metaAttachment, metaFileRefusal, metaMessageText, metaPreview, metaState, refusalText, type MetaAccount, type MetaConversation, type MetaMessage, type MetaThread } from '../../../src/modules/chat/channels/meta';
import { appRoute, findApp, navApps, visibleApps } from '@shared/apps';
import { canOpenRoute, routeOwner, visibleAppIds } from '@shared/access';
import { metaRoute, redirectRoute } from '@shared/channels';
import { resolveWebLink } from '@shared/links';

const account = (o: Partial<MetaAccount> = {}): MetaAccount => ({
  id: 1, platform: 'messenger', name: 'Ceylon Teas', page_id: '1001', page_name: 'Ceylon Teas', username: null, picture_url: null, status: 'connected', status_note: null,
  webhook_subscribed: true, is_shared: true, human_agent: false, role: 'owner', can_reply: true, can_connect: true, unread: 0, conversations: 1, connected_at: null, last_checked_at: null, ...o,
});
const conversation = (o: Partial<MetaConversation> = {}): MetaConversation => ({
  id: 7, account_id: 1, platform: 'messenger', participant_id: '9001', name: 'Nadeesha Fernando', username: null, avatar_url: null, last_message: 'Do you ship to Kandy?',
  last_message_at: '2026-10-02 09:00:00', last_direction: 'in', last_inbound_at: '2026-10-02 09:00:00', unread: 0, account_name: 'Ceylon Teas', account_status: 'connected', ...o,
});
const message = (o: Partial<MetaMessage> = {}): MetaMessage => ({
  id: 1, direction: 'in', kind: 'text', body: 'Hello', filename: null, mime_type: null, size: null, media_url: null, media_status: null, media_note: null, status: 'received',
  error_code: null, error_text: null, tag: null, sender_name: null, created_at: '2026-10-02 09:00:00', sent_at: null, ...o,
});
const thread = (o: { window?: Partial<MetaThread['conversation']['window']>; unread?: number; account?: Partial<MetaAccount>; platform?: 'messenger' | 'instagram' } = {}): MetaThread => {
  const window = { allowed: true, code: 'open', reason: null, tag: null, closes_at: null, ...o.window };
  return {
    conversation: { ...conversation({ unread: o.unread ?? 0, platform: o.platform ?? 'messenger', username: o.platform === 'instagram' ? 'nadee.f' : null }), account: account({ platform: o.platform ?? 'messenger', ...o.account }), window },
    messages: [
      message({ id: 1, body: 'Do you ship to Kandy?' }),
      message({ id: 2, kind: 'image', body: null, filename: 'photo.jpg', mime_type: 'image/jpeg', size: 2048, media_url: '/media/tok-2', media_status: 'stored' }),
      message({ id: 3, direction: 'out', body: 'Yes, we do!', status: 'read', sender_name: 'Amaya' }),
    ],
    has_more: false,
    can_reply: window.allowed,
  };
};

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function serve(t: MetaThread = thread(), rows: MetaConversation[] = [conversation({ unread: 2 }), conversation({ id: 8, name: 'Kasun', last_direction: 'out', last_message: 'Thanks', account_name: 'Tea Shop' })]) {
  vi.mocked(apiGet).mockImplementation((async (path: string) => {
    if (path === '/api/meta/conversations') return { conversations: rows, total: rows.length };
    if (path === '/api/meta/conversations/7') return t;
    throw new Error(`unexpected ${path}`);
  }) as never);
}

const mount = (o: { accounts?: MetaAccount[]; platform?: 'messenger' | 'instagram'; onReconnect?: (a: MetaAccount) => void; onConnect?: (() => void) | null } = {}) =>
  wrap(<MetaChannel platform={o.platform ?? 'messenger'} accounts={o.accounts ?? [account()]} loading={false} error={null} retry={() => undefined} onConnect={o.onConnect ?? null} onReconnect={o.onReconnect ?? (() => undefined)} onSettings={() => undefined} />);

beforeEach(() => {
  localStorage.clear();
  tab.route = '/chat?channel=messenger';
  tab.go.mockReset();
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiPost).mockReset();
  vi.mocked(call).mockReset().mockResolvedValue(null as never);
  vi.mocked(toast).mockReset();
});
afterEach(() => {
  closePreview();
  cleanup();
});

describe('Messenger and Instagram as channels of Chat', () => {
  const boot = (apps: string[]) => ({ apps, permissions: [] });

  it('are in the catalogue for the server’s meta application, as channels of Chat that open there', () => {
    expect(findApp('messenger')).toMatchObject({ app: 'meta', channelOf: 'chat', surface: 'native' });
    expect(findApp('instagram')).toMatchObject({ app: 'meta', channelOf: 'chat' });
    expect(appRoute(findApp('instagram')!)).toBe('/chat?channel=instagram');
    // No entry of their own beside Chat; only for someone with them and not Chat.
    expect(navApps(visibleApps(boot(['chat', 'meta']))).map((a) => a.id)).not.toContain('messenger');
    expect(navApps(visibleApps(boot(['meta']))).map((a) => a.id)).toEqual(expect.arrayContaining(['messenger', 'instagram']));
  });

  it('keep their own access, and their links open the same conversation in Chat', () => {
    expect(routeOwner('/chat?channel=messenger&mc=4')).toBe('messenger');
    expect(canOpenRoute('/chat?channel=instagram&mc=4', visibleAppIds(boot(['chat'])))).toBe(false);
    expect(canOpenRoute('/chat?channel=instagram&mc=4', visibleAppIds(boot(['chat', 'meta'])))).toBe(true);
    expect(metaRoute('messenger', { conversation: '12' })).toBe('/chat?channel=messenger&mc=12');
    expect(metaRoute('instagram', { conversation: 'x' })).toBe('/chat?channel=instagram');
    expect(redirectRoute('/messenger?conversation=5')).toBe('/chat?channel=messenger&mc=5');
    expect(redirectRoute('/instagram/9')).toBe('/chat?channel=instagram&mc=9');
    expect(resolveWebLink('/messenger')).toEqual({ kind: 'tab', route: '/chat?channel=messenger', app: 'messenger' });
  });

  it('read the channel from the route and go back to the conversation you had open', () => {
    expect(channelOf(new URLSearchParams('channel=messenger&mc=3'))).toBe('messenger');
    expect(channelOf(new URLSearchParams('channel=instagram'))).toBe('instagram');
    expect(channelRoute('instagram')).toBe('/chat?channel=instagram');
    rememberMeta('instagram', '42');
    expect(channelRoute('instagram')).toBe('/chat?channel=instagram&mc=42');
    expect(channelRoute('messenger')).toBe('/chat?channel=messenger');
  });

  it('show in the toolbar once an account is shared, with unread badges and what is wrong', () => {
    const accounts = [account({ unread: 3 }), account({ id: 2, name: 'Tea Shop', unread: 1, status: 'token_invalid' }), account({ id: 3, platform: 'instagram', name: 'ceylonteas', unread: 5 })];
    const channels = buildChannels({ active: 'chat', rooms: [], website: { access: false, rows: [] }, whatsapp: { access: false, accounts: [] }, meta: { access: true, accounts } });
    expect(channels.map((c) => c.id)).toEqual(['chat', 'messenger', 'instagram']);
    expect(channels[1]).toMatchObject({ label: 'Messenger', badge: 4, problem: 'Tea Shop is not connected' });
    expect(channels[2]).toMatchObject({ label: 'Instagram', badge: 5, problem: null });
    // Nothing shared yet: not in the toolbar (it is under Add a channel), unless it is the one open.
    expect(buildChannels({ active: 'chat', rooms: [], website: { access: false, rows: [] }, whatsapp: { access: false, accounts: [] }, meta: { access: true, accounts: [] } }).map((c) => c.id)).toEqual(['chat']);
    expect(buildChannels({ active: 'instagram', rooms: [], website: { access: false, rows: [] }, whatsapp: { access: false, accounts: [] }, meta: { access: true, accounts: [] } }).map((c) => c.id)).toEqual(['chat', 'instagram']);
    // Never without access.
    expect(buildChannels({ active: 'chat', rooms: [], website: { access: false, rows: [] }, whatsapp: { access: false, accounts: [] }, meta: { access: false, accounts } }).map((c) => c.id)).toEqual(['chat']);
    expect(metaState('instagram', [account({ platform: 'instagram', status: 'disconnected' }), account({ id: 2, platform: 'instagram', status: 'permission_missing' })]).problem).toBe('2 accounts are not connected');
  });

  it('read messages, attachments and refusals as a person would', () => {
    expect(metaPreview({ last_message: 'Thanks', last_direction: 'out' })).toBe('You: Thanks');
    expect(metaMessageText({ kind: 'story_mention', body: null, filename: null })).toBe('Mentioned you in their story');
    expect(metaMessageText({ kind: 'file', body: null, filename: 'list.pdf' })).toBe('File · list.pdf');
    expect(metaAttachment(message({ media_url: '/media/abc', filename: 'a.jpg', mime_type: 'image/jpeg', size: 4 }))).toMatchObject({ url: '/media/abc', download_url: '/media/abc', filename: 'a.jpg' });
    expect(metaAttachment(message({}))).toBeNull();
    expect(refusalText({ code: 'no_permission', reason: null }, 'messenger', 'Ceylon Teas')).toMatch(/read this account’s conversations but not reply/);
    expect(refusalText({ code: 'not_connected', reason: null }, 'instagram', 'ceylonteas')).toBe('ceylonteas is not connected, so nothing can be sent until it is reconnected.');
    expect(refusalText({ code: 'no_inbound', reason: null }, 'instagram', 'x')).toMatch(/On Instagram a business can only answer/);
    expect(refusalText({ code: 'window_closed', reason: 'It is more than 24 hours since this person last wrote.' }, 'messenger', 'x')).toBe('It is more than 24 hours since this person last wrote.');
    const f = (name: string, type: string, size = 1000) => ({ name, type, size });
    expect(metaFileRefusal('instagram', f('list.pdf', 'application/pdf'))).toMatch(/Instagram only carries pictures, video and sound/);
    expect(metaFileRefusal('instagram', f('big.png', 'image/png', 9 * 1024 * 1024))).toMatch(/larger than 8 MB/);
    expect(metaFileRefusal('messenger', f('list.pdf', 'application/pdf'))).toBeNull();
    expect(metaFileRefusal('messenger', f('film.mp4', 'video/mp4', 26 * 1024 * 1024))).toMatch(/larger than 25 MB/);
  });
});

describe('Messenger in Chat', () => {
  it('lists the conversations, each with its channel and account, and opens one', async () => {
    serve();
    mount({ accounts: [account(), account({ id: 2, name: 'Tea Shop' })] });
    const list = await screen.findByRole('complementary', { name: 'Messenger conversations' });
    await within(list).findByText('Nadeesha Fernando');
    expect(within(list).getByText('Messenger · Ceylon Teas')).toBeTruthy();
    expect(within(list).getByText('Messenger · Tea Shop')).toBeTruthy();
    expect(within(list).getByText('You: Thanks')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/api/meta/conversations', expect.objectContaining({ platform: 'messenger' }), expect.anything());
    fireEvent.click(within(list).getByText('Nadeesha Fernando'));
    expect(tab.go).toHaveBeenCalledWith('/chat?channel=messenger&mc=7');
  });

  it('marks a conversation read, shows its attachments, sends a reply and clears the draft', async () => {
    tab.route = '/chat?channel=messenger&mc=7';
    serve(thread({ unread: 2 }));
    vi.mocked(apiPost).mockImplementation((async (path: string) => (path.endsWith('/read') ? { ok: true } : { ok: true, code: null, error: null, message: null })) as never);
    mount();
    const box = await screen.findByRole('textbox', { name: 'Message Nadeesha Fernando on Messenger' });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/meta/conversations/7/read'));
    const conv = screen.getByRole('region', { name: 'Messenger with Nadeesha Fernando' });
    expect(within(conv).getByText('Messenger · on Ceylon Teas')).toBeTruthy();
    expect(within(conv).getByRole('img', { name: 'photo.jpg' })).toBeTruthy();
    expect(within(conv).getByText(/Amaya · .* · Seen/)).toBeTruthy();
    expect(call).toHaveBeenCalledWith('offline:getDraft', { module: 'meta', context: 'conversation:7' });
    fireEvent.change(box, { target: { value: 'Yes — 2 days' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/meta/conversations/7/messages', { text: 'Yes — 2 days' }));
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(''));
  });

  it('keeps the words, and says why, when Meta refuses the reply', async () => {
    tab.route = '/chat?channel=messenger&mc=7';
    serve();
    vi.mocked(apiPost).mockResolvedValue({ ok: false, code: 'token_invalid', error: null, message: null } as never);
    mount();
    const box = await screen.findByRole('textbox', { name: 'Message Nadeesha Fernando on Messenger' });
    fireEvent.change(box, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', 'The connection to Meta has expired or was revoked. Reconnect the account. Your message is kept.'));
    expect((box as HTMLTextAreaElement).value).toBe('Hello');
  });

  it('closes the composer with the reason once the window has closed', async () => {
    tab.route = '/chat?channel=messenger&mc=7';
    serve(thread({ window: { allowed: false, code: 'window_closed', reason: 'It is more than 24 hours since this person last wrote, so Messenger will not deliver a reply until they write again.' } }));
    mount();
    expect(await screen.findByText(/more than 24 hours since this person last wrote/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Attach files' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('textbox', { name: 'Message Nadeesha Fernando on Messenger' }) as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('tells a viewer they may read but not reply, and offers reconnecting a broken account to whoever may', async () => {
    tab.route = '/chat?channel=messenger&mc=7';
    serve(thread({ window: { allowed: false, code: 'no_permission' } }));
    const view = mount();
    expect(await screen.findByText(/can read this account’s conversations but not reply on it/)).toBeTruthy();
    view.unmount();

    const onReconnect = vi.fn();
    serve(thread({ window: { allowed: false, code: 'not_connected' }, account: { status: 'token_invalid', status_note: 'The connection to Meta has expired.' } }));
    mount({ onReconnect, accounts: [account({ status: 'token_invalid', status_note: 'The connection to Meta has expired.' })] });
    expect(await screen.findByText('Ceylon Teas is not connected, so nothing can be sent until it is reconnected.')).toBeTruthy();
    expect(screen.getByText('Ceylon Teas is not connected.')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('region', { name: 'Messenger with Nadeesha Fernando' })).getByRole('button', { name: 'Reconnect' }));
    expect(onReconnect).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('says when a reply goes out as a Human Agent, past 24 hours', async () => {
    tab.route = '/chat?channel=messenger&mc=7';
    serve(thread({ window: { allowed: true, code: 'human_agent', tag: 'HUMAN_AGENT', reason: 'More than 24 hours have passed: replies are sent as a person answering (Human Agent), up to 7 days after their last message.' } }));
    mount();
    expect(await screen.findByText(/sent as a person answering \(Human Agent\)/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Attach files' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends files, refusing what the platform does not carry', async () => {
    tab.route = '/chat?channel=instagram&mc=7';
    serve(thread({ platform: 'instagram' }));
    vi.mocked(apiPost).mockResolvedValue({ sent: 1, failed: 0, results: [{ name: 'tea.jpg', ok: true }] } as never);
    const { container } = mount({ platform: 'instagram', accounts: [account({ platform: 'instagram', name: 'ceylonteas' })] });
    await screen.findByRole('textbox', { name: 'Message Nadeesha Fernando on Instagram' });
    expect(screen.getByText('@nadee.f · Instagram · on Ceylon Teas')).toBeTruthy();
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    expect(input.accept).toContain('image/jpeg');
    fireEvent.change(input, { target: { files: [new File(['%PDF'], 'list.pdf', { type: 'application/pdf' }), new File(['x'], 'tea.jpg', { type: 'image/jpeg' })] } });
    expect(toast).toHaveBeenCalledWith('error', 'list.pdf: Instagram only carries pictures, video and sound.');
    expect(screen.getByRole('list', { name: 'Files to send' }).textContent).toContain('tea.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/meta/conversations/7/attachments', expect.any(FormData)));
  });

  it('offers no call of any kind', async () => {
    tab.route = '/chat?channel=messenger&mc=7';
    serve();
    mount();
    await screen.findByRole('textbox', { name: 'Message Nadeesha Fernando on Messenger' });
    expect(screen.queryByRole('button', { name: /call/i })).toBeNull();
  });

  it('with nothing connected yet, offers to connect a Page, or says who can', () => {
    const onConnect = vi.fn();
    const view = mount({ accounts: [], onConnect });
    fireEvent.click(screen.getByRole('button', { name: 'Connect a Page' }));
    expect(onConnect).toHaveBeenCalled();
    view.unmount();
    mount({ accounts: [], onConnect: null });
    expect(screen.getByText('Ask whoever manages your Pages to share one with you.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect a Page' })).toBeNull();
  });
});

describe('connecting through Facebook', () => {
  it('opens Facebook Login in the browser, waits, then connects the Pages chosen', async () => {
    vi.mocked(apiPost).mockImplementation((async (path: string) => {
      if (path === '/api/meta/connect') return { state: 'a'.repeat(40), url: 'https://www.facebook.com/v21.0/dialog/oauth?client_id=1', expires_at: '2026-10-02 10:00:00' };
      if (path.endsWith('/select')) return { ok: true, accounts: [account()] };
      throw new Error(path);
    }) as never);
    let ready = false;
    vi.mocked(apiGet).mockImplementation((async () =>
      ready
        ? {
            status: 'ready', platform: 'messenger', error: null, candidates: [
              { id: '1001', page_id: '1001', name: 'Ceylon Teas', page_name: 'Ceylon Teas', username: null, picture: null, usable: true, note: null, connected: false, account_id: null },
              { id: '1002', page_id: '1002', name: 'Analyst Only', page_name: 'Analyst Only', username: null, picture: null, usable: false, note: 'Your role on this Page does not include messaging.', connected: false, account_id: null },
            ],
          }
        : { status: 'pending', platform: 'messenger', error: null, candidates: [] }) as never);
    const onConnected = vi.fn();
    wrap(<MetaConnect platform="messenger" onClose={() => undefined} onConnected={onConnected} />);
    expect(screen.getByRole('heading', { name: 'Connect a Facebook Page' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Facebook' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/meta/connect', { platform: 'messenger' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('app:openExternal', { url: 'https://www.facebook.com/v21.0/dialog/oauth?client_id=1' }));
    expect(await screen.findByText(/Finish signing in to Facebook in your browser/)).toBeTruthy();
    ready = true;
    const page = await screen.findByRole('checkbox', { name: /Ceylon Teas/ }, { timeout: 4000 });
    expect((page as HTMLInputElement).checked).toBe(true);
    const other = screen.getByRole('checkbox', { name: /Analyst Only/ }) as HTMLInputElement;
    expect(other.disabled).toBe(true);
    expect(screen.getByText('Your role on this Page does not include messaging.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(`/api/meta/connect/${'a'.repeat(40)}/select`, { ids: ['1001'] }));
    expect(onConnected).toHaveBeenCalledWith([expect.objectContaining({ id: 1 })]);
  });

  it('says what went wrong when Facebook was not given access, and starts again', async () => {
    vi.mocked(apiPost).mockResolvedValue({ state: 'b'.repeat(40), url: 'https://www.facebook.com/x', expires_at: '' } as never);
    vi.mocked(apiGet).mockResolvedValue({ status: 'failed', platform: 'instagram', error: 'Facebook was not given access, so nothing was connected.', candidates: [] } as never);
    wrap(<MetaConnect platform="instagram" reconnect={account({ platform: 'instagram', name: 'ceylonteas', id: 3 })} onClose={() => undefined} onConnected={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Reconnect ceylonteas' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Facebook' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/meta/connect', { platform: 'instagram', account_id: 3 }));
    expect(await screen.findByText('Facebook was not given access, so nothing was connected.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('Messenger and Instagram channel settings', () => {
  it('show where each account stands, and offer check, reconnect and disconnect to whoever may', async () => {
    const onReconnect = vi.fn();
    vi.mocked(apiPost).mockImplementation((async (path: string) => ({ ok: true, account: account({ status: path.endsWith('disconnect') ? 'disconnected' : 'connected' }) })) as never);
    wrap(
      <MetaSettings
        platform="messenger"
        accounts={[account(), account({ id: 2, name: 'Tea Shop', status: 'permission_missing', status_note: 'A permission messaging needs was removed in Facebook. Missing: pages_messaging.' }), account({ id: 3, name: 'Shared to me', role: 'viewer', can_connect: false, status: 'token_invalid' })]}
        loading={false}
        onConnect={() => undefined}
        onReconnect={onReconnect}
        onClose={() => undefined}
      />,
    );
    const teas = screen.getByRole('listitem', { name: 'Ceylon Teas' });
    expect(within(teas).getByText('Connected')).toBeTruthy();
    const shop = screen.getByRole('listitem', { name: 'Tea Shop' });
    expect(within(shop).getByText('Permission removed')).toBeTruthy();
    expect(within(shop).getByText(/Missing: pages_messaging/)).toBeTruthy();
    fireEvent.click(within(shop).getByRole('button', { name: 'Reconnect' }));
    expect(onReconnect).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));

    const viewer = screen.getByRole('listitem', { name: 'Shared to me' });
    expect(within(viewer).getByText('Sign-in expired')).toBeTruthy();
    expect(within(viewer).queryByRole('button')).toBeNull();
    expect(within(viewer).getByText('Whoever manages this account can reconnect it.')).toBeTruthy();

    fireEvent.click(within(teas).getByRole('button', { name: 'Check connection' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/meta/accounts/1/check'));
    fireEvent.click(within(teas).getByRole('button', { name: 'Disconnect' }));
    expect(within(teas).getByRole('alert').textContent).toContain('Its messages stop arriving here; its conversations stay.');
    fireEvent.click(within(within(teas).getByRole('alert')).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/meta/accounts/1/disconnect'));
  });
});

describe('Add a channel', () => {
  it('lists Messenger and Instagram, with Connect only for whoever may connect', () => {
    const onMeta = vi.fn();
    const view = wrap(
      <AddChannel
        website={{ access: false, canSetUp: false }}
        whatsapp={{ access: false, canConnect: false, accounts: [] }}
        meta={{ access: true, canConnect: true, ready: true, accounts: [account({ id: 2, name: 'Tea Shop', status: 'token_invalid' })] }}
        onMeta={onMeta}
        onClose={() => undefined}
        onConnected={() => undefined}
      />,
    );
    const messenger = screen.getByRole('region', { name: 'Messenger' });
    expect(within(messenger).getByText('Not connected')).toBeTruthy();
    expect(within(messenger).getByText('Tea Shop: reconnect to keep receiving messages.')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('region', { name: 'Instagram' })).getByRole('button', { name: 'Connect Instagram' }));
    expect(onMeta).toHaveBeenCalledWith('instagram');
    view.unmount();

    wrap(
      <AddChannel
        website={{ access: false, canSetUp: false }}
        whatsapp={{ access: false, canConnect: false, accounts: [] }}
        meta={{ access: true, canConnect: false, ready: true, accounts: [] }}
        onMeta={onMeta}
        onClose={() => undefined}
        onConnected={() => undefined}
      />,
    );
    expect(within(screen.getByRole('region', { name: 'Messenger' })).queryByRole('button', { name: 'Connect a Page' })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Messenger' })).getByText('Ask whoever manages your Pages to share one with you.')).toBeTruthy();
  });

  it('says so when Messenger and Instagram are not available, or the server has no Meta app yet', () => {
    const view = wrap(<AddChannel website={{ access: false, canSetUp: false }} whatsapp={{ access: false, canConnect: false, accounts: [] }} meta={{ access: false, canConnect: false, ready: false, accounts: [] }} onClose={() => undefined} onConnected={() => undefined} />);
    expect(within(screen.getByRole('region', { name: 'Instagram' })).getByText('Not available to you')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Instagram' })).queryByRole('button')).toBeNull();
    view.unmount();
    wrap(<AddChannel website={{ access: false, canSetUp: false }} whatsapp={{ access: false, canConnect: false, accounts: [] }} meta={{ access: true, canConnect: true, ready: false, accounts: [] }} onClose={() => undefined} onConnected={() => undefined} />);
    expect(within(screen.getByRole('region', { name: 'Messenger' })).getByText(/not set up on this server yet/)).toBeTruthy();
  });
});
