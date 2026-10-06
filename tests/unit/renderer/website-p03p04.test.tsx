// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * P-03 "Admin Center › Chat › Ringing" (RING-UI-09; RING-01…08, RING-60, ESC-07) and P-04 "One chat kit: composer,
 * pickers, messages" (CHAT-UI-02; RDC-02…05, RDC-12): the organisation's ringing rules in the desktop's Admin Center
 * tab, with the design's words; and one composer for Team Chat and website chats, its buttons decided by the channel
 * profile, its picker, tray, "/" picker and reply bar as the kit draws them, and the website message actions.
 */

const tab = vi.hoisted(() => ({ go: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn(),
  on: () => () => undefined,
  errorMessage: (e: unknown) => String(e),
  isMac: false,
  registerDropped: vi.fn(async (files: File[]) => files.map((f, i) => ({ handle: `h${i}`, name: f.name, size: f.size }))),
}));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(async () => ({})), apiPost: vi.fn(async () => ({})), apiPut: vi.fn(async () => ({})), request: vi.fn(async () => ({ data: {} })) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => ({ query: new URLSearchParams(), path: ['settings', 'admin', 'chat', 'ringing'], go: tab.go, active: true, openLink: vi.fn() }),
  useTabTitle: () => undefined,
}));
vi.mock('../../../src/components/DriveFilePicker', () => ({
  DriveFilePicker: ({ title }: { title: string }) => <div role="dialog" aria-label={title} />,
}));
vi.mock('../../../src/core/app-state', async () => {
  const { createStore } = await import('../../../src/core/store');
  return { app: createStore({ apps: [{ id: 'files' }], transfers: [], bootstrap: { permissions: ['*'], user: { id: 1, name: 'Nuwan' } }, auth: { user: { id: '1' }, server: { origin: 'https://app.worksuite.lk' } } }) };
});

import { apiGet, apiPost, apiPut } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { toast } from '../../../src/core/toasts';
import { AdminRinging, secondsProblem, settledNotes } from '../../../src/modules/settings/AdminRinging';
import { Composer } from '../../../src/modules/chat/Composer';
import { RefusedNotes, Tray, type Staged } from '../../../src/modules/chat/attach';
import { TEAM_CAPS, TEAM_COMPOSER, WEBSITE_CAPS, WEBSITE_COMPOSER } from '../../../src/modules/chat/kit/caps';
import { messageActionItems } from '../../../src/modules/chat/kit/MessageActions';
import { fromWebsiteMessage } from '../../../src/modules/chat/kit/model';

const calls = vi.mocked(call);
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

afterEach(() => cleanup());

// ---- P-03 ----------------------------------------------------------------------------------------------------------

const RING = {
  spec: {
    general: [
      { key: 'chat_widget_priority_after_seconds', default: '30' },
      { key: 'chat_widget_everyone_after_seconds', default: '60' },
      { key: 'chat_widget_at_risk_after_seconds', default: '180' },
      { key: 'chat_widget_accept_within_seconds', default: '60' },
      { key: 'chat_widget_ring_visitor_gone_seconds', default: '120' },
      { key: 'chat_widget_offline_ring', default: 'once' },
    ],
  },
  general: { chat_widget_everyone_after_seconds: { value: 90, stored: true, inherited: false }, chat_widget_offline_ring: { value: 'until_joined', stored: true, inherited: false } },
  advanced: {},
  can_edit: true,
};

function ringing(data: unknown = RING) {
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/module-settings/communication') return data;
    throw new Error(`unexpected ${path}`);
  }) as never);
  render(
    <QueryClientProvider client={client()}>
      <AdminRinging />
    </QueryClientProvider>,
  );
}

describe('P-03 · Admin Center › Chat › Ringing', () => {
  beforeEach(() => {
    vi.mocked(apiPut).mockClear();
    vi.mocked(toast).mockClear();
    calls.mockReset().mockResolvedValue(undefined as never);
  });

  it('draws the design copy, in its order', async () => {
    ringing();
    await screen.findByLabelText('Ring the rest of the priority agents after');
    const nav = screen.getByRole('navigation', { name: 'Admin sections' });
    expect(nav.textContent).toBe('Admin CenterOrganizationsUsers & rolesMailChatGeneralRingingDriveSecurity');
    expect(within(nav).getByRole('button', { name: 'Ringing' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { name: 'Website chat ringing' })).toBeTruthy();
    expect(screen.getByText('Who is rung, and when. Each person picks their own tone and device.')).toBeTruthy();
    expect(screen.getByText('Rings until someone joins')).toBeTruthy();
    expect(screen.getByText('Joining is accepting the chat, opening it, or replying. The ring then stops for everyone.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'WHO IS RUNG, AND WHEN' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'WHEN IT STOPS WITHOUT A JOIN' })).toBeTruthy();
    const labels = Array.from(document.querySelectorAll('label')).map((l) => l.textContent);
    expect(labels).toEqual([
      'Ring the rest of the priority agents after',
      'Ring everybody covering the widget after',
      'Mark at risk — louder, supervisors told — after',
      "Pass an assigned chat on if its agent hasn't joined within",
    ]);
    expect(screen.getAllByText('seconds')).toHaveLength(4);
    expect(screen.getByText('Stop when the visitor has left the site for')).toBeTruthy();
    expect(screen.getByText('The chat moves to Missed chats.')).toBeTruthy();
    expect(screen.getByText('Offline enquiries')).toBeTruthy();
    expect(screen.getByText('A visitor still on the site always rings until joined.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('shows what is saved, the defaults where nothing is, and the options as the design names them', async () => {
    ringing();
    const priority = (await screen.findByLabelText('Ring the rest of the priority agents after')) as HTMLInputElement;
    expect(priority.value).toBe('30');
    expect((screen.getByLabelText('Ring everybody covering the widget after') as HTMLInputElement).value).toBe('90');
    expect((screen.getByLabelText('Mark at risk — louder, supervisors told — after') as HTMLInputElement).value).toBe('180');
    expect(screen.getByRole('combobox', { name: 'Stop when the visitor has left the site for' }).textContent).toContain('2 minutes');
    expect(screen.getByRole('combobox', { name: 'Offline enquiries' }).textContent).toContain('Ring until someone joins');
    fireEvent.click(screen.getByRole('combobox', { name: 'Offline enquiries' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Alert once when someone comes online', 'Ring until someone joins']);
  });

  it('saves only what changed, to the Chat module’s settings; Cancel puts it back', async () => {
    ringing();
    const accept = (await screen.findByLabelText("Pass an assigned chat on if its agent hasn't joined within")) as HTMLInputElement;
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(accept, { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(accept.value).toBe('60');
    fireEvent.change(accept, { target: { value: '45' } });
    await act(async () => {
      fireEvent.click(save);
    });
    expect(vi.mocked(apiPut)).toHaveBeenCalledWith('/api/module-settings/communication/general', { chat_widget_accept_within_seconds: '45' });
    expect(vi.mocked(toast)).toHaveBeenCalledWith('success', 'Ringing saved.');
  });

  it('refuses what is not whole seconds, and says when a timing will apply in order (ESC-07)', async () => {
    ringing();
    const priority = await screen.findByLabelText('Ring the rest of the priority agents after');
    fireEvent.change(priority, { target: { value: '4000' } });
    expect(screen.getByText('Enter whole seconds from 0 to 3600.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(priority, { target: { value: '120' } });
    expect(screen.getByText('Applies as 90 seconds — the priority agents are never rung after everybody.')).toBeTruthy();
    expect(secondsProblem('0')).toBeNull();
    expect(secondsProblem('1.5')).not.toBeNull();
    expect(settledNotes({ chat_widget_everyone_after_seconds: '60', chat_widget_at_risk_after_seconds: '30', chat_widget_priority_after_seconds: '0' })).toEqual({
      chat_widget_at_risk_after_seconds: 'Applies as 60 seconds — a chat is never at risk before everybody is rung.',
    });
    // 0 switches at risk off: nothing to say.
    expect(settledNotes({ chat_widget_everyone_after_seconds: '60', chat_widget_at_risk_after_seconds: '0' })).toEqual({});
  });

  it('opens the Admin Center’s other sections on the web; somebody who may only read is told so', async () => {
    ringing({ ...RING, can_edit: false });
    await screen.findByLabelText('Ring the rest of the priority agents after');
    expect((screen.getByLabelText('Ring the rest of the priority agents after') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByText('Only somebody who manages website chats can change these.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'General' }));
    expect(calls).toHaveBeenCalledWith('app:openInBrowser', { path: '/module-settings?module=communication&section=general' });
    fireEvent.click(screen.getByRole('button', { name: 'Users & roles' }));
    expect(calls).toHaveBeenCalledWith('app:openInBrowser', { path: '/users' });
  });
});

// ---- P-04 ----------------------------------------------------------------------------------------------------------

const replies = [
  { id: 1, shortcut: 'education', title: 'Education discount', body: 'Students and schools get a discount on Creative Cloud.' },
  { id: 2, shortcut: 'edu-proof', title: 'Proof of enrolment', body: 'Please send a photo of your student ID.' },
];

/** The box row's controls, left to right: each button's name, and "box" for the text. */
function row(): string[] {
  const box = screen.getByRole('textbox', { name: 'Message' });
  return Array.from(box.parentElement!.children).map((el) => (el.tagName === 'TEXTAREA' ? 'box' : (el.getAttribute('aria-label') ?? el.querySelector('button')?.getAttribute('aria-label') ?? '?')));
}

function team() {
  render(
    <QueryClientProvider client={client()}>
      <Composer roomId="5" roomName="Design team" group reply={null} onClearReply={() => undefined} />
    </QueryClientProvider>,
  );
}

function website(reply: { id: number; sender_name: string; snippet: string } | null = null) {
  render(
    <QueryClientProvider client={client()}>
      <Composer roomId="website-41" roomName="Visitor 4F2A" group={false} reply={reply} onClearReply={() => undefined} website={{ conversationId: 41, replies }} />
    </QueryClientProvider>,
  );
}

describe('P-04 · one composer, two channel profiles (RDC-02)', () => {
  beforeEach(() => {
    calls.mockReset().mockImplementation(async (channel: string) => (channel === 'offline:getDraft' ? null : undefined) as never);
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/chat/rooms/5/mentionable') return { people: [{ type: 'user', id: 3, name: 'Samali Perera', detail: null }], teams: [], departments: [], everyone: [] };
      return {};
    }) as never);
    vi.mocked(toast).mockClear();
  });

  it('the profiles say what each channel has; the website hides what a visitor can’t receive', () => {
    const hidden = (Object.keys(TEAM_COMPOSER) as Array<keyof typeof TEAM_COMPOSER>).filter((k) => TEAM_COMPOSER[k] === true && WEBSITE_COMPOSER[k] === false);
    expect(hidden).toEqual(['mentions', 'voice', 'urgent', 'shareRecords']);
    expect([WEBSITE_COMPOSER.savedReplies, WEBSITE_COMPOSER.assistant, WEBSITE_COMPOSER.driveCopy, TEAM_COMPOSER.driveCopy]).toEqual([true, true, true, false]);
    // And the messages' (RDC-12): reactions, forward and pin hidden.
    expect([WEBSITE_CAPS.reactions, WEBSITE_CAPS.forward, WEBSITE_CAPS.pin, WEBSITE_CAPS.saveToDrive]).toEqual([false, false, false, true]);
    expect([TEAM_CAPS.reactions, TEAM_CAPS.forward, TEAM_CAPS.pin]).toEqual([true, true, true]);
  });

  it('Team Chat: attach, emoji, the box, @, a voice message, urgent, send — sharing and the assistant kept', () => {
    team();
    expect(row()).toEqual(['Share from WorkSuite', 'Attach', 'Emoji', 'box', 'Mention someone', 'Record a voice message', 'Urgent', 'AI tools', 'Send']);
    expect(screen.getByRole('textbox', { name: 'Message' }).getAttribute('placeholder')).toBe('Type a message…');
  });

  it('the @ button opens the list of who can be mentioned, as typing @ does', async () => {
    team();
    fireEvent.click(screen.getByRole('button', { name: 'Mention someone' }));
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('@');
    expect(await screen.findByRole('option', { name: /Samali Perera/ })).toBeTruthy();
  });

  it('website: attach, emoji, the box, saved replies, the writing assistant, send — and nothing else', () => {
    website();
    expect(row()).toEqual(['Attach', 'Emoji', 'box', 'Saved replies', 'Writing assistant', 'Send']);
    expect(screen.getByRole('textbox', { name: 'Message' }).getAttribute('placeholder')).toBe('Type a message… / for saved replies');
  });

  it('AttachmentPicker · website: upload, paste a screenshot, take a photo, and From Drive as a copy', () => {
    website();
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((b) => b.querySelector('b')?.textContent)).toEqual(['Upload a file', 'Paste a screenshot', 'Take a photo', 'From Drive']);
    expect(items[3]!.textContent).toContain("Sends a copy — visitors can't open Drive links");
    fireEvent.click(items[3]!);
    expect(screen.getByRole('dialog', { name: 'Send a copy to the visitor' })).toBeTruthy();
  });

  it('Paste a screenshot puts the clipboard’s picture in the tray, ready to send', async () => {
    const png = new Blob(['png'], { type: 'image/png' });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: vi.fn(async () => [{ types: ['image/png'], getType: async () => png }]) } });
    website();
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Paste a screenshot/ }));
    });
    const tray = screen.getByRole('list', { name: 'Files ready to send' });
    expect(within(tray).getByText(/^Screenshot .*\.png$/)).toBeTruthy();
  });

  it('Upload a file picks any file; one a visitor can’t receive is refused under the tray with why', async () => {
    calls.mockImplementation(async (channel: string) => {
      if (channel === 'offline:getDraft') return null as never;
      if (channel === 'files:pickFiles') return [{ handle: 'h1', name: 'logo.svg', size: 900 }, { handle: 'h2', name: 'Quote.pdf', size: 188_416 }] as never;
      return undefined as never;
    });
    website();
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Upload a file' }));
    });
    expect(calls).toHaveBeenCalledWith('files:pickFiles', { multiple: true, title: 'Send to Visitor 4F2A' });
    expect(screen.getByRole('alert').textContent).toBe("logo.svg can't be sent to a visitor — use PNG or PDF");
    expect(screen.getByText('Quote.pdf')).toBeTruthy();
    expect(vi.mocked(toast)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Saved replies · "/" picker: what was typed over "/shortcut · title" and the start of the words', () => {
    website();
    const box = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(box, { target: { value: '/edu', selectionStart: 4 } });
    const picker = screen.getByRole('listbox', { name: 'Quick actions' }).parentElement!;
    expect(picker.querySelector('[data-slash-query]')?.textContent).toBe('/edu');
    const rows = within(picker).getAllByRole('option').map((o) => o.textContent);
    expect(rows).toEqual(['/education · Education discountStudents and schools get a discount on Creative Cloud.', '/edu-proof · Proof of enrolmentPlease send a photo of your student ID.']);
  });

  it('ReplyBar: "Replying to Visitor 4F2A · Can you send a quote…", on one line', () => {
    website({ id: 7, sender_name: 'Visitor 4F2A', snippet: 'Can you send a quote…' });
    const bar = document.querySelector('[data-reply-bar]')!;
    expect(bar.textContent).toBe('Replying to Visitor 4F2A · Can you send a quote…');
    expect(bar.querySelector('b')?.textContent).toBe('Visitor 4F2A');
  });
});

describe('P-04 · the tray and the refusal notes', () => {
  it('AttachmentTray: "screenshot.png · uploading 60%"', () => {
    const item: Staged = { key: 'k', kind: 'blob', blob: new Blob(['x'.repeat(2048)]), name: 'screenshot.png', state: 'sending', progress: 0.6, error: null, extra: null };
    render(<Tray items={[item]} transfers={[]} onRemove={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText('screenshot.png')).toBeTruthy();
    expect(screen.getByText(/uploading 60%/)).toBeTruthy();
  });

  it('a refusal note goes when dismissed', () => {
    const dismiss = vi.fn();
    render(<RefusedNotes notes={[{ key: 'a', text: "logo.svg can't be sent to a visitor — use PNG or PDF" }]} onDismiss={dismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(dismiss).toHaveBeenCalledWith('a');
  });
});

describe('P-04 · website message actions (RDC-12)', () => {
  const file = { url: '/chat/widget-admin/files/0123456789abcdef0123456789abcdef', filename: 'Quote.pdf', mime: 'application/pdf', size: 188_416, is_image: false };
  const mine = (at: string) => fromWebsiteMessage({ id: 9, body: 'Here is the quote', from: 'agent', agent: 'Nuwan', agent_id: 1, at, file } as never, { me: 1, visitor: 'Visitor 4F2A', canReply: true, deleteMinutes: 15 });
  const h = { onReply: vi.fn(), onDelete: vi.fn(), onSaveToDrive: vi.fn(), onForward: vi.fn(), onPin: vi.fn(), onStar: vi.fn(), onReact: vi.fn() };

  it('Reply, Copy, Save to Drive and Delete for the visitor; never forward, pin or star', () => {
    const caps = { ...WEBSITE_CAPS, deleteForVisitorMinutes: 15 };
    expect(messageActionItems(mine(new Date().toISOString()), caps, h, 'page', vi.fn()).map((i) => i.label)).toEqual(['Reply', 'Copy text', 'Save to Drive', 'Delete…']);
    // Without a Drive to save into, Save to Drive is not offered.
    expect(messageActionItems(mine(new Date().toISOString()), { ...caps, saveToDrive: false }, h, 'page', vi.fn()).map((i) => i.label)).toEqual(['Reply', 'Copy text', 'Delete…']);
  });

  it('Delete for the visitor keeps to the server’s window, and 0 is no limit', () => {
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    expect(mine(old).can?.delete_everyone).toBe(false);
    const unlimited = fromWebsiteMessage({ id: 9, body: 'x', from: 'agent', agent: 'Nuwan', agent_id: 1, at: old, file: null } as never, { me: 1, visitor: 'V', canReply: true, deleteMinutes: 0 });
    expect(unlimited.can?.delete_everyone).toBe(true);
  });

  it('Save to Drive asks the server for a copy of that file', async () => {
    const { WebsiteThread } = await import('../../../src/modules/chat/website/WebsiteThread');
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    Element.prototype.scrollTo = vi.fn();
    calls.mockReset().mockResolvedValue([] as never);
    vi.mocked(apiPost).mockClear();
    vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
      if (path === '/api/chat/widget-admin/conversations/41') {
        return {
          conversation: { id: 41, widget: 'TechHub', website: 'techubiz.com', status: 'open', is_offline: false, inactive: false, assigned_to: 1, visitor_typing: false, started_at: ago(600_000), closed_at: null, rating: null, rating_comment: null, tags: null, is_starred: false },
          visitor: { id: 9, label: 'Visitor 4F2A', name: null, last_seen: ago(10_000) },
          messages: [{ id: 3, body: null, from: 'visitor', agent: null, at: ago(100_000), file }],
          journey: [],
          history: [],
          can: { view: true, reply: true, manage: false },
          delete_window_minutes: 30,
          can_save_to_drive: true,
        };
      }
      if (path === '/api/chat/widget-admin/canned') return { responses: [] };
      return { agents: [] };
    }) as never);
    render(
      <QueryClientProvider client={client()}>
        <WebsiteThread id="41" mini />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'More actions' }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[0]!);
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Save to Drive' }));
    });
    expect(vi.mocked(apiPost)).toHaveBeenCalledWith('/api/chat/widget-admin/files/0123456789abcdef0123456789abcdef/save', {});
    await waitFor(() => expect(vi.mocked(toast)).toHaveBeenCalledWith('success', 'Saved Quote.pdf to your Drive.'));
  });
});
