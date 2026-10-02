// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../../src/core/api', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), errorMessage: (e: unknown) => String(e) }));
import { apiGet, apiPost } from '../../../src/core/api';
import { LockedChat } from '../../../src/app/LockedChat';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('hides conversation previews until requested and renders text without links or files', async () => {
  vi.mocked(apiGet).mockResolvedValue({ messages: [{ id: 1, type: 'text', message: '<a href="https://example.com">open</a>' }, { id: 2, type: 'file', message: 'secret.pdf' }] });
  render(<LockedChat room="7" />);
  expect(apiGet).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Show this conversation' }));
  await screen.findByText('<a href="https://example.com">open</a>');
  expect(document.querySelector('a')).toBeNull();
  expect(screen.queryByText('secret.pdf')).toBeNull();
  expect(apiGet).toHaveBeenCalledWith('/api/chat/messages', { room_id: '7' });
});
it('sends only bound-room plain text and prevents duplicate sends while pending', async () => {
  let resolve!: () => void;
  vi.mocked(apiPost).mockImplementation(() => new Promise<void>(r => { resolve = r; }));
  render(<LockedChat room="7" />);
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: ' Hello ' } });
  const send = screen.getByRole('button', { name: 'Send text' });
  fireEvent.click(send); fireEvent.click(send);
  expect(apiPost).toHaveBeenCalledTimes(1);
  expect(apiPost).toHaveBeenCalledWith('/api/chat/messages', { room_id: 7, type: 'text', message: 'Hello' });
  resolve();
  await waitFor(() => expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe(''));
});
