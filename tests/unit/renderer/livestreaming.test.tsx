// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), remove: vi.fn(), toast: vi.fn(), refresh: vi.fn(), meet: { uuid: 'meeting', canManage: true, room: null, present: [], lastSpeaker: null, livestream: null as unknown, subscribe: () => () => {}, snapshot: () => 1 } }));
vi.mock('../../../src/core/api', () => ({ apiGet: mocks.get, apiPost: mocks.post, apiPut: mocks.put, apiDelete: mocks.remove }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), errorMessage: (e: Error) => e.message }));
vi.mock('../../../src/core/toasts', () => ({ toast: mocks.toast }));
vi.mock('../../../src/modules/meet/session', () => ({ meet: { ...mocks.meet, get canManage() { return mocks.meet.canManage; }, refreshLivestream: mocks.refresh } }));
import { LivestreamBadge, LivestreamControls, LivestreamDestinations, useLivestreamNotice } from '../../../src/modules/meet/Livestreaming';
import { meet } from '../../../src/modules/meet/session';
const destination = { id: 1, label: 'Public channel', platform: 'youtube', server_url: 'rtmps://example.com/live', auth_type: 'key', orientation: 'landscape', layout: 'grid', title: 'Meeting', description: '', visibility: 'private', has_key: true, connected: false, tested_at: null };
function show(ui: React.ReactNode) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>); }
beforeEach(() => { vi.clearAllMocks(); mocks.meet.canManage = true; meet.livestream = null; mocks.get.mockResolvedValue({ destinations: [destination], youtube_connect: false }); mocks.post.mockResolvedValue({}); mocks.refresh.mockResolvedValue(undefined); });
afterEach(cleanup);
it('shows private key placeholders and keeps platform eligibility guidance available', async () => {
  show(<LivestreamDestinations />);
  await screen.findByText('Public channel');
  expect(screen.getByText(/Stream key: ••••••••/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add Destination' }));
  expect((screen.getByLabelText('Stream key') as HTMLInputElement).type).toBe('password');
  fireEvent.change(screen.getByLabelText('Platform'), { target: { value: 'tiktok' } });
  expect(screen.getByText(/Some eligible LIVE accounts still cannot obtain a stream key/)).toBeTruthy();
  expect(screen.queryByLabelText('Visibility')).toBeNull();
});
it('allows hosts to start selected destinations in one request', async () => {
  show(<LivestreamControls close={() => {}} />);
  const select = await screen.findByLabelText('Select Public channel'); fireEvent.click(select);
  fireEvent.click(screen.getByRole('button', { name: 'Start Livestream' }));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/api/meet/meeting/livestream/start', { destinations: [1] }));
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
it('disables broadcasting when the host role is lost', async () => {
  mocks.meet.canManage = false;
  show(<LivestreamControls close={() => {}} />);
  const select = await screen.findByLabelText('Select Public channel'); expect((select as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Start Livestream' })); expect(mocks.post).not.toHaveBeenCalled();
});
it('distinguishes connecting from confirmed LIVE and announces newly joined participants once', () => {
  function Notice({ active }: { active: boolean }) { useLivestreamNotice({ active, live: active }); return null; }
  const view = render(<><LivestreamBadge status={{ active: true, live: false, count: 2 }} /><Notice active /></>);
  expect(screen.getByText('Livestream connecting · 2 destinations')).toBeTruthy(); expect(mocks.toast).toHaveBeenCalledOnce();
  view.rerender(<><LivestreamBadge status={{ active: true, live: true, count: 2 }} /><Notice active /></>);
  expect(screen.getByText('LIVE · 2 destinations')).toBeTruthy(); expect(mocks.toast).toHaveBeenCalledOnce();
  view.rerender(<><LivestreamBadge status={null} /><Notice active={false} /></>); expect(mocks.toast).toHaveBeenCalledTimes(2);
});
