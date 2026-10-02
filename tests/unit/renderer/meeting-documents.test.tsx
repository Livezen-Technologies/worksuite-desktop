// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseOfficeDocRoute, parseOfficeRoute } from '@shared/office';
import type { ChatFile } from '../../../src/modules/chat/types';
import { documentRoute, type SharedDocument } from '../../../src/modules/meet/documents';

const mocks = vi.hoisted(() => ({ get: vi.fn(), call: vi.fn(), open: vi.fn(), allowed: true, toast: vi.fn() }));
vi.mock('../../../src/core/api', () => ({ apiGet: mocks.get }));
vi.mock('../../../src/core/bridge', () => ({ call: mocks.call, errorMessage: (e: Error) => e.message }));
vi.mock('../../../src/core/access', () => ({ useVisibleIds: () => new Set(), canOpenDesktopRoute: () => mocks.allowed }));
vi.mock('../../../src/core/tab-context', () => ({ openRouteInWindow: mocks.open }));
vi.mock('../../../src/core/toasts', () => ({ toast: mocks.toast }));
vi.mock('../../../src/modules/chat/attach', () => ({ DrivePicker: ({ roomId }: { roomId: string }) => <div>Drive chooser for room {roomId}</div> }));

import { MeetingFiles } from '../../../src/modules/meet/MeetingFiles';

const shared = (extra: Partial<SharedDocument> = {}): SharedDocument => ({ message_id: 12, sender_name: 'Asha', created_at: '2026-10-02 10:00:00', ...extra });
const drive = (extra = {}) => shared({ card: { kind: 'drive.file', available: true, id: 42, name: 'Proposal.docx', size: 1024, ...extra } });
const attachment = (filename: string, download_url = '/media/signed-token-123?download=1') => shared({ file: { filename, download_url, size: 123 } as ChatFile });

function show(data = { files: [] as SharedDocument[], media: [] as SharedDocument[], drive: [drive()] }, mayShare = true, present = vi.fn()) {
  mocks.get.mockResolvedValue(data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MeetingFiles roomId={7} mayShare={mayShare} onPresent={present} />
    </QueryClientProvider>,
  );
  return present;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed = true;
  mocks.call.mockResolvedValue(true);
});
afterEach(cleanup);

describe('meeting document routes', () => {
  it.each(['Proposal.docx', 'Budget.xlsx', 'Deck.pptx'])('opens %s through its Drive identity', (name) => {
    expect(parseOfficeRoute(documentRoute(drive({ name }))!)).toMatchObject({ fileId: 42, name });
  });
  it('opens PDFs in PDF Studio and refuses unavailable, insecure-link and invalid file pointers', () => {
    expect(documentRoute(drive({ name: 'Agenda.PDF' }))).toBe('/pdf?file=42');
    expect(documentRoute(drive({ available: false }))).toBeNull();
    expect(documentRoute(drive({ available: undefined }))).toBeNull();
    expect(documentRoute(drive({ kind: 'drive.link' }))).toBeNull();
    expect(documentRoute(drive({ id: -1 }))).toBeNull();
    expect(documentRoute(drive({ id: 1.5 }))).toBeNull();
  });
  it('opens an Office attachment using a signed token on the configured server', () => {
    expect(parseOfficeDocRoute(documentRoute(attachment('Notes.docx'))!)).toEqual({ kind: 'api', path: '/media/signed-token-123?download=1', name: 'Notes.docx' });
    expect(documentRoute(attachment('Notes.docx', 'https://example.com/file.docx'))).toBeNull();
    expect(documentRoute(attachment('Notes.exe'))).toBeNull();
  });
});

describe('meeting Files workflow', () => {
  it('opens a document in its own WorkSuite window without navigating away from the meeting', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Open in WorkSuite' }));
    expect(mocks.open).toHaveBeenCalledWith(documentRoute(drive()), 'Proposal.docx');
  });
  it('opens the document before asking to select its window for presentation', async () => {
    const present = show();
    fireEvent.click(await screen.findByRole('button', { name: 'Present to Meeting…' }));
    await waitFor(() => expect(present).toHaveBeenCalledOnce());
    expect(mocks.call).toHaveBeenCalledWith('windows:open', expect.objectContaining({ kind: 'record', route: documentRoute(drive()) }));
  });
  it('does not start presenting when opening the document fails', async () => {
    mocks.call.mockRejectedValueOnce(new Error('Window unavailable'));
    const present = show();
    fireEvent.click(await screen.findByRole('button', { name: 'Present to Meeting…' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('error', 'Window unavailable'));
    expect(present).not.toHaveBeenCalled();
  });
  it('does not offer an integrated editor when the organization denies its app', async () => {
    mocks.allowed = false;
    show();
    await screen.findByText('Proposal.docx');
    expect(screen.queryByRole('button', { name: 'Open in WorkSuite' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Present to Meeting…' })).toBeNull();
  });
  it('keeps file access unavailable and explains it without offering actions', async () => {
    show({ files: [], media: [], drive: [shared({ card: { kind: 'drive.file', available: false, why: 'Ask the owner to share it.' } })] });
    await screen.findByText('Ask the owner to share it.');
    expect(screen.queryByRole('button', { name: 'Open in WorkSuite' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open in Desktop App' })).toBeNull();
  });
  it('respects presentation restrictions while letting authorized users open documents', async () => {
    show(undefined, false);
    await screen.findByRole('button', { name: 'Open in WorkSuite' });
    expect(screen.getByRole('button', { name: 'Share Document' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Present to Meeting…' })).toBeNull();
  });
  it('shares Drive documents through the existing explicit access workflow', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Share Document' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Choose from Drive' }));
    await screen.findByText('Drive chooser for room 7');
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it('uploads picked device files to the meeting conversation without creating Drive grants', async () => {
    mocks.call.mockResolvedValueOnce([{ handle: 'picked-document-handle', name: 'Budget.xlsx' }]);
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Share Document' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Upload from this device' }));
    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith('transfers:upload', { handles: ['picked-document-handle'], target: { kind: 'chat', roomId: '7' } }));
    expect(mocks.call).toHaveBeenCalledTimes(2);
  });

  it('does not start an upload when the device picker is cancelled', async () => {
    mocks.call.mockResolvedValueOnce([]);
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Share Document' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Upload from this device' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload from this device' }).hasAttribute('disabled')).toBe(false));
    expect(mocks.call).toHaveBeenCalledTimes(1);
  });
});
