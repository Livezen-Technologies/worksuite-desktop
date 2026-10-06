// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => []), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn(async () => []) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const tab = { route: '/social-media/approvals', go: vi.fn() };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { route: tab.route, query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, navigate: vi.fn(), openInNewTab: vi.fn(), openInWindow: vi.fn(), active: true, openLink: vi.fn(), setTitle: vi.fn(), tabId: 't1' };
  },
  useTabTitle: () => undefined,
}));

import { apiGet, apiPost } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import Approvals from '../../../src/modules/social-media/screens/Approvals';
import Inbox from '../../../src/modules/social-media/screens/Inbox';
import { NOW, socialAnswer } from './social-fixtures';

/** W05 Approvals and W06 Inbox: the decisions, the comment rule, J/K, the AI suggestion and permission gating. */
function mount(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const SUGGESTION = 'Yes — WorkSuite Business includes WorkSuite Desktop for every user on the plan.';

function signIn(permissions: string[]) {
  app.set({ bootstrap: { permissions, user: { id: '1', name: 'Nadeesha P.' } } as never });
}

describe('Social Media engage screens', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    signIn(['*']);
    vi.mocked(apiGet).mockImplementation(socialAnswer(true) as never);
    vi.mocked(apiPost).mockReset();
    vi.mocked(apiPost).mockImplementation((async (path: string) => (path.endsWith('/suggest') ? { reply: SUGGESTION } : {})) as never);
    tab.go.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe('Approvals', () => {
    it('lists the post waiting for me with its step', async () => {
      tab.route = '/social-media/approvals';
      mount(<Approvals postId={null} />);
      expect(await screen.findByText('Step 2 of 3')).toBeTruthy();
      expect(screen.getByRole('tab', { name: /Waiting for me/ }).textContent).toContain('(2)');
      expect(screen.getAllByText(/Behind the scenes at the CreativeFX studio shoot/).length).toBeGreaterThan(0);
      expect(screen.getByText(/Waiting · reply target/)).toBeTruthy();
      expect(screen.getByText(/Opens after step 2 · no WorkSuite login needed/)).toBeTruthy();
      expect(await screen.findByText(/Slide 3 is the new lighting rig/)).toBeTruthy();
    });

    it('needs a comment to request changes, then sends the decision', async () => {
      mount(<Approvals postId={103} />);
      const button = (await screen.findByRole('button', { name: 'Request changes' })) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(screen.getByText('Write a comment to request changes.')).toBeTruthy();
      fireEvent.change(screen.getByRole('textbox', { name: /Add a comment/ }), { target: { value: 'Move the price to the first comment' } });
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/social-media/posts/103/decision', { decision: 'changes', comment: 'Move the price to the first comment' }));
      await waitFor(() => expect(tab.go).toHaveBeenCalledWith('/social-media/approvals/105'));
    });

    it('approves', async () => {
      mount(<Approvals postId={103} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
      await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/social-media/posts/103/decision', expect.objectContaining({ decision: 'approve' })));
    });

    it('sends the ids of the people mentioned with a comment', async () => {
      mount(<Approvals postId={103} />);
      const box = await screen.findByRole('textbox', { name: /Add a comment/ });
      fireEvent.change(box, { target: { value: 'Thanks @Kas', selectionStart: 11 } });
      fireEvent.click(await screen.findByRole('button', { name: /Kasun R\./ }));
      fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
      await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/social-media/posts/103/comments', { body: 'Thanks @Kasun R.', mentions: [2] }));
    });

    it('draws its chrome on a server without the module', async () => {
      vi.mocked(apiGet).mockImplementation(socialAnswer(false) as never);
      mount(<Approvals postId={null} />);
      expect(await screen.findByText(/Approvals isn’t offered by this WorkSuite server yet/)).toBeTruthy();
      expect(screen.getByRole('heading', { level: 1, name: 'Approvals' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: /Changes requested/ })).toBeTruthy();
    });
  });

  describe('Inbox', () => {
    it('moves through the conversations with J and K', async () => {
      tab.route = '/social-media/inbox/202';
      mount(<Inbox threadId={202} />);
      await screen.findByText('dilini.designs');
      fireEvent.keyDown(window, { key: 'j' });
      expect(tab.go).toHaveBeenLastCalledWith('/social-media/inbox/203');
      fireEvent.keyDown(window, { key: 'k' });
      expect(tab.go).toHaveBeenLastCalledWith('/social-media/inbox/201');
      // Not while typing in a field.
      tab.go.mockReset();
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search conversations' }), { key: 'j' });
      expect(tab.go).not.toHaveBeenCalled();
    });

    it('never sends the AI suggestion until Use and Send are clicked, and says AI was used', async () => {
      tab.route = '/social-media/inbox/201';
      mount(<Inbox threadId={201} />);
      expect(await screen.findByText(/Kasun R\. is replying/)).toBeTruthy();
      expect(screen.getByText('Reply window closes in 23 h')).toBeTruthy();
      fireEvent.click(await screen.findByRole('button', { name: 'Suggest a reply' }));
      expect(await screen.findByText(SUGGESTION)).toBeTruthy();
      const replied = () => vi.mocked(apiPost).mock.calls.some(([p]) => String(p).endsWith('/reply'));
      expect(replied()).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Use' }));
      const box = screen.getByRole('textbox', { name: /Reply to Ruwan Jayasinghe/ }) as HTMLTextAreaElement;
      expect(box.value).toBe(SUGGESTION);
      expect(replied()).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/social-media/inbox/threads/201/reply', expect.objectContaining({ body: SUGGESTION, ai_used: true, close: false })));
    });

    it('expands a saved reply shortcut with the customer’s first name', async () => {
      mount(<Inbox threadId={201} />);
      const box = (await screen.findByRole('textbox', { name: /Reply to Ruwan Jayasinghe/ })) as HTMLTextAreaElement;
      await waitFor(() => {
        fireEvent.change(box, { target: { value: '' } });
        fireEvent.change(box, { target: { value: '/price ' } });
        expect(box.value).toContain('Hi Ruwan, thanks for asking!');
      });
    });

    it('shows Create CRM lead only with CRM permission', async () => {
      mount(<Inbox threadId={201} />);
      expect(await screen.findByRole('button', { name: 'Create CRM lead' })).toBeTruthy();
      cleanup();
      signIn(['social.inbox.view', 'social.inbox.reply', 'social.inbox.convert']);
      mount(<Inbox threadId={201} />);
      expect(await screen.findByText(/Kasun R\. is replying/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Create CRM lead' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Rules' })).toBeNull();
    });

    it('draws its chrome on a server without the module', async () => {
      vi.mocked(apiGet).mockImplementation(socialAnswer(false) as never);
      tab.route = '/social-media/inbox?view=mine';
      mount(<Inbox threadId={null} />);
      expect(await screen.findByText(/The unified inbox isn’t offered by this WorkSuite server yet/)).toBeTruthy();
      expect(screen.getByRole('heading', { level: 1, name: 'Inbox' })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Assigned to me/ }).getAttribute('aria-current')).toBe('page');
      expect(screen.getByText(/Replies, notes and assignment isn’t offered/)).toBeTruthy();
    });
  });
});
