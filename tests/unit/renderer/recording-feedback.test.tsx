// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RecordingFeedback } from '../../../src/modules/meet/RecordingFeedback';
afterEach(cleanup);
it('shows animated startup without claiming that capture is active', () => {
  render(<RecordingFeedback active={false} since={null} now={0} phase="starting" />);
  expect(screen.getByText('Starting Recording…')).toBeTruthy();
  expect(screen.queryByText(/Recording On/)).toBeNull();
});
it('keeps the persistent capture warning and clock while stopping', () => {
  render(<RecordingFeedback active since={1000} now={62000} phase="stopping" />);
  expect(screen.getByText(/Recording On · 1:01/)).toBeTruthy();
  expect(screen.getByText('This meeting is being recorded')).toBeTruthy();
  expect(screen.getByText('Stopping Recording…')).toBeTruthy();
});
it('offers explicit retry and stop-pending actions after a startup failure', () => {
  const retry = vi.fn(), stop = vi.fn();
  render(<RecordingFeedback active={false} since={null} now={0} error="Check the recording service." retry={retry} stopPending={stop} />);
  expect(screen.getByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry recording' }));
  fireEvent.click(screen.getByRole('button', { name: 'Stop pending recording' }));
  expect(retry).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce();
  expect(screen.queryByText(/Recording On/)).toBeNull();
});
it('shows finished capture separately from processing and upload', () => {
  render(<RecordingFeedback active={false} since={null} now={0} stopped />);
  expect(screen.getByText(/Recording has stopped. Processing and upload/)).toBeTruthy();
});
