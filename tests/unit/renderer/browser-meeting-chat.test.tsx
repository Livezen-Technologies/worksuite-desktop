// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BrowserMeetingChat from '../../../src/modules/meet/BrowserMeetingChat';
const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/api', () => api);
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });
const data = { enabled: true, can_send: true, messages: [{ id: 1, name: 'Visitor', guest: true, text: '<script>Hi</script>' }] };
it('lets a desktop host read and reply to browser guests using the meeting endpoint', async () => {
  api.apiGet.mockResolvedValue(data); api.apiPost.mockResolvedValue(data);
  render(<BrowserMeetingChat uuid="room-one" />);
  expect(await screen.findByText('<script>Hi</script>')).toBeTruthy();
  expect(screen.getByText('Visitor · Guest')).toBeTruthy();
  expect(api.apiGet).toHaveBeenCalledWith('/meet/room-one/browser-chat');
  expect(document.querySelector('script')).toBeNull();
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Welcome' } });
  fireEvent.click(screen.getByText('Send'));
  await waitFor(() => expect(api.apiPost).toHaveBeenCalledWith('/meet/room-one/browser-chat', { text: 'Welcome' }));
});
it('follows host policy and handles an unavailable server without breaking the meeting', async () => {
  api.apiGet.mockResolvedValue({ ...data, can_send: false });
  const view = render(<BrowserMeetingChat uuid="room-one" />);
  expect(await screen.findByText('Only hosts can send messages.')).toBeTruthy();
  expect(screen.queryByLabelText('Message')).toBeNull();
  view.unmount();
  api.apiGet.mockRejectedValue(new Error('server migration required'));
  render(<BrowserMeetingChat uuid="room-two" />);
  expect(await screen.findByRole('alert')).toBeTruthy();
});
