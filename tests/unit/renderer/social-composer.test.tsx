// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => []), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => String(e), isMac: false, registerDropped: vi.fn(async () => []) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const tab = { route: '/social-media/compose' };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { route: tab.route, query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: vi.fn(), navigate: vi.fn(), openInNewTab: vi.fn(), openInWindow: vi.fn(), active: true, openLink: vi.fn(), setTitle: vi.fn(), tabId: 't1' };
  },
  useTabTitle: () => undefined,
}));

import { ApiError, apiGet, apiPost, apiPut } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import Composer from '../../../src/modules/social-media/composer/Composer';
import { countText } from '../../../src/modules/social-media/lib/text';
import { brands, posts, socialAnswer } from './social-fixtures';

/**
 * W02 / D02 Create post: the live checks and their fixes (AC-04, AC-18), the Contributor's actions (AC-05), AI only
 * on a click (AC-13) and network variants (CMP-002).
 */

/** A server with the module whose brands have no approval policy, so a publisher's primary action is Schedule. */
function answer() {
  const base = socialAnswer(true);
  return async (path: string, query?: Record<string, unknown>) => {
    if (path === '/api/social-media/brands') return { brands: brands.map((b) => ({ ...b, approval_policy_id: null, approval_policy: null })) };
    return base(path, query);
  };
}

function mount(route: string, postId: number | null = null) {
  tab.route = route;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Composer postId={postId} />
    </QueryClientProvider>,
  );
}

/** Sentences of plain ASCII, cut to exactly `n` characters (each weighs 1 on X). */
function caption(n: number): string {
  const s = 'WorkSuite 3.2 is here with offline mode for Desktop. PDF Studio has new tools for every team. Mail is faster than ever before. Join the live launch webinar on Thursday at three in the afternoon. ';
  let out = '';
  while (out.length < n) out += s;
  return `${out.slice(0, n - 1).trimEnd().padEnd(n - 1, 'x')}.`;
}

async function captionBox(): Promise<HTMLTextAreaElement> {
  return (await screen.findByRole('textbox', { name: /^Caption/ })) as HTMLTextAreaElement;
}

function button(name: string | RegExp): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}

describe('Create post', () => {
  beforeEach(() => {
    localStorage.clear();
    app.set({ bootstrap: { permissions: ['*'] } as never });
    vi.mocked(apiGet).mockImplementation(answer() as never);
    vi.mocked(apiPost).mockReset();
    vi.mocked(apiPut).mockReset();
  });
  afterEach(() => cleanup());

  it('shows the X error for a 312-character caption and disables Schedule; Split into thread fixes it', async () => {
    mount('/social-media/compose?account=4&date=2026-10-09');
    expect(await screen.findByRole('heading', { level: 1, name: 'Create post' })).toBeTruthy();
    await screen.findByText('@techhubiz');
    const text = caption(312);
    expect(countText(text, 'x_weighted')).toBe(312);
    fireEvent.change(await captionBox(), { target: { value: text } });

    expect(await screen.findByText('X: 312 / 280 characters.')).toBeTruthy();
    await waitFor(() => expect(button('Schedule').disabled).toBe(true));
    expect(button('Schedule').title).toMatch(/blocking issue/);

    fireEvent.click(button('Split into thread'));
    await waitFor(() => expect(screen.queryByText('X: 312 / 280 characters.')).toBeNull());
    const parts = [screen.getByRole('textbox', { name: 'Part 1' }), screen.getByRole('textbox', { name: 'Part 2' })] as HTMLTextAreaElement[];
    expect(screen.queryByRole('textbox', { name: 'Part 3' })).toBeNull();
    for (const p of parts) expect(countText(p.value, 'x_weighted')).toBeLessThanOrEqual(280);
    expect(parts.map((p) => p.value).join(' ')).toContain('WorkSuite 3.2 is here');
    await waitFor(() => expect(button('Schedule').disabled).toBe(false));
  });

  it('gives a user without social.post.publish Send for approval and no Schedule', async () => {
    app.set({ bootstrap: { permissions: ['social.view', 'social.post.create'] } as never });
    mount('/social-media/compose?account=1');
    await screen.findAllByText('TechHubiz Sri Lanka');
    expect(await screen.findByRole('button', { name: 'Send for approval' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Schedule' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add to queue' })).toBeNull();
  });

  it('keeps an AI suggestion out of the caption until Insert is clicked', async () => {
    vi.mocked(apiPost).mockResolvedValue({ suggestion: 'Big news from TechHubiz today.' } as never);
    mount('/social-media/compose?account=1');
    const box = await captionBox();
    fireEvent.change(box, { target: { value: 'Launch day' } });
    fireEvent.click(button(/AI assist/));
    fireEvent.click(button('Rewrite'));

    const card = await screen.findByRole('region', { name: 'AI suggestion' });
    expect(within(card).getByText('Big news from TechHubiz today.')).toBeTruthy();
    expect(vi.mocked(apiPost).mock.calls[0]?.[0]).toBe('/api/social-media/ai/compose');
    expect((await captionBox()).value).toBe('Launch day');

    fireEvent.click(within(card).getByRole('button', { name: 'Insert' }));
    await waitFor(async () => expect((await captionBox()).value).toContain('Big news from TechHubiz today.'));
    expect(screen.queryByRole('region', { name: 'AI suggestion' })).toBeNull();
  });

  it('marks an edited network tab Customised, and Reset to Original restores the Original', async () => {
    mount('/social-media/compose?account=1');
    fireEvent.change(await captionBox(), { target: { value: 'Hello from the Original' } });
    fireEvent.click(await screen.findByRole('tab', { name: /Facebook/ }));
    const box = await captionBox();
    expect(box.value).toBe('Hello from the Original');
    expect(screen.queryByText('Customised')).toBeNull();

    fireEvent.change(box, { target: { value: 'Hello Facebook' } });
    expect(await screen.findByText('Customised')).toBeTruthy();
    fireEvent.click(button('Reset to Original'));
    await waitFor(() => expect(screen.queryByText('Customised')).toBeNull());
    expect((await captionBox()).value).toBe('Hello from the Original');

    fireEvent.click(screen.getByRole('tab', { name: 'Original' }));
    expect((await captionBox()).value).toBe('Hello from the Original');
  });

  it('counts a Sinhala caption by code points', async () => {
    mount('/social-media/compose?account=1');
    const text = 'ආයුබෝවන් ශ්‍රී ලංකා 🙂';
    fireEvent.change(await captionBox(), { target: { value: text } });
    const points = [...text.normalize('NFC')].length;
    expect(points).not.toBe(text.length); // the emoji is two UTF-16 units but one code point
    expect((await screen.findByTestId('count-facebook')).textContent).toBe(`${points} / 63206`);
  });

  it('still draws on a server without the module, with a hint to connect an account', async () => {
    vi.mocked(apiGet).mockImplementation(socialAnswer(false) as never);
    mount('/social-media/compose');
    expect(await screen.findByRole('heading', { level: 1, name: 'Create post' })).toBeTruthy();
    expect(await screen.findByText(/Connect an account first/)).toBeTruthy();
    fireEvent.change(await captionBox(), { target: { value: 'Written offline' } });
    expect(await screen.findByText('Choose at least one account to post to.')).toBeTruthy();
  });

  it('asks Reload theirs / Keep mine when someone saved a newer version, and Keep mine saves over it', async () => {
    const draft = posts.find((p) => p.id === 109)!;
    vi.mocked(apiPut)
      .mockRejectedValueOnce(new ApiError(409, 'Version conflict', 'version_conflict', { current: { ...draft, version: 4, base_text: 'Their text' }, by: { id: 2, name: 'Kasun R.' } }))
      .mockResolvedValueOnce({ post: { ...draft, version: 5 } } as never);
    mount('/social-media/posts/109', 109);
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit post' })).toBeTruthy();
    fireEvent.change(await captionBox(), { target: { value: 'My text' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save draft' })[0]!);

    expect(await screen.findByText('Kasun R. saved a newer version')).toBeTruthy();
    expect((vi.mocked(apiPut).mock.calls[0]?.[1] as { version?: number }).version).toBe(3);
    fireEvent.click(button('Keep mine'));
    await waitFor(() => expect(vi.mocked(apiPut)).toHaveBeenCalledTimes(2));
    const second = vi.mocked(apiPut).mock.calls[1]?.[1] as { version?: number; base_text: string };
    expect(second.version).toBe(4);
    expect(second.base_text).toBe('My text');
  });

  it('shows a published post read-only, with its result and permalink', async () => {
    mount('/social-media/posts/107', 107);
    expect(await screen.findByRole('heading', { level: 1, name: 'Post' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Open post' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Schedule' })).toBeNull();
    expect(((await captionBox()) as HTMLTextAreaElement).readOnly).toBe(true);
  });
});
