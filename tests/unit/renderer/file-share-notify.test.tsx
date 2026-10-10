// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({})), apiPut: vi.fn(async () => ({})), apiDelete: vi.fn(async () => ({})) }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: Error) => e.message, isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/access', () => ({ useCanOpen: () => true, useVisibleIds: () => new Set(['chat', 'drive', 'files']) }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
import { apiPost } from '../../../src/core/api';
import { call } from '../../../src/core/bridge';
import { FileShareCard, shareHeadline, type FileShareCardData } from '../../../src/modules/chat/cards/FileShareCard';
import { FILE_ROWS, FilesNotifications, choice, withChoice } from '../../../src/modules/notifications/FilesPrefs';

afterEach(() => {
  cleanup();
  vi.mocked(apiPost).mockClear();
  vi.mocked(call).mockClear();
});

const file = (id: number, extra: object = {}) => ({ type: 'file' as const, id, available: true, name: `Budget ${id}.xlsx`, extension: 'xlsx', size: 1572864, level: 'view' as const, can_download: true, link: `/files?view=shared&file=${id}&play=1`, show: `/files?view=shared&file=${id}`, ...extra });
const card = (over: Partial<FileShareCardData> = {}): FileShareCardData => ({ kind: 'drive.share', available: true, mine: false, sharer: 'Nimal Silva', to: 'person', level: 'view', level_now: 'view', state: 'shared', items: [file(1)], can_request_edit: true, ...over });

describe('the share card in Chat (worksuite-desktop#164)', () => {
  it('shows one file like the chat file card, with Open, Download, Show in Files and Request edit access', async () => {
    const opened: string[] = [];
    render(<FileShareCard card={card()} onOpen={(l) => opened.push(l)} />);

    expect(screen.getByText('Nimal Silva shared a file with you')).toBeTruthy();
    expect(screen.getByText(/· Can view/)).toBeTruthy();
    expect(screen.getByText('Budget 1.xlsx')).toBeTruthy();
    expect(screen.getByText('XLSX · 1.5 MB')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show in Files' }));
    expect(opened).toEqual(['/files?view=shared&file=1&play=1', '/files?view=shared&file=1']);

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(call).toHaveBeenCalledWith('transfers:download', { fileId: '1', name: 'Budget 1.xlsx' });

    fireEvent.click(screen.getByRole('button', { name: 'Request edit access' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/drive/access/file/1/request-edit', {}));
    await screen.findByRole('button', { name: 'Edit access requested' });
  });

  it('leaves out Download when it is not allowed, and Request edit access when they can already edit', () => {
    render(<FileShareCard card={card({ level: 'edit', level_now: 'edit', can_request_edit: false, items: [file(2, { can_download: false, level: 'edit' })] })} onOpen={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Request edit access' })).toBeNull();
  });

  it('shows a folder with its item count and Open folder', () => {
    render(<FileShareCard card={card({ items: [{ type: 'folder', id: 4, available: true, name: 'Q3', count: 12, level: 'view', link: '/files?folder=4', show: '/files?view=shared&folder=4' }] })} onOpen={() => undefined} />);
    expect(screen.getByText('Nimal Silva shared a folder with you')).toBeTruthy();
    expect(screen.getByText('Folder · 12 items')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeTruthy();
  });

  it('groups several files on one card', () => {
    render(<FileShareCard card={card({ items: [file(1), file(2), file(3), file(4), file(5)] })} onOpen={() => undefined} />);
    expect(screen.getByText('Nimal Silva shared 5 files with you')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Show in Files' })).toBeTruthy();
  });

  it('says when access changed, and turns its buttons off when it is no longer shared', () => {
    const { unmount } = render(<FileShareCard card={card({ state: 'changed', level_now: 'full', can_request_edit: false })} onOpen={() => undefined} />);
    expect(screen.getByText('Access changed to Full access')).toBeTruthy();
    unmount();

    render(<FileShareCard card={card({ state: 'removed', level_now: null, items: [{ type: 'file', available: false }] })} onOpen={() => undefined} />);
    expect(screen.getByText('No longer shared')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reads as sent to the sharer, and names a team', () => {
    expect(shareHeadline(card({ mine: true }))).toBe('You shared a file with them');
    expect(shareHeadline(card({ to: 'team', team: 'Design', items: [file(1), file(2)] }))).toBe('Nimal Silva shared 2 files with Design');
  });
});

// Share's own notify options (Chat, Email, a message) are tested with the dialog in files-share-dialog.test.tsx (#329).

describe('Notification settings › Files (worksuite-desktop#164)', () => {
  it('shows the server defaults until something is chosen, and sets every event of a row', () => {
    const [shared, access, comments] = FILE_ROWS;
    expect([choice({}, shared!, 'chat'), choice({}, shared!, 'in_app'), choice({}, shared!, 'email')]).toEqual([true, true, true]);
    expect(choice({}, access!, 'email')).toBe(false);
    expect(choice({}, comments!, 'chat')).toBe(false);

    const next = withChoice({}, access!, { email: true });
    expect(next).toEqual({ 'event:files.access_changed': { email: true }, 'event:files.access_revoked': { email: true } });
  });

  it('saves the email choice as instant, daily or off', () => {
    const commit = vi.fn();
    render(<FilesNotifications categories={{}} commit={commit} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Shared with me: Chat' }));
    expect(commit).toHaveBeenLastCalledWith({ categories: { 'event:files.shared': { chat: false } } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Access changed or removed: Email' }));
    expect(commit).toHaveBeenLastCalledWith({ categories: { 'event:files.access_changed': { email: true }, 'event:files.access_revoked': { email: true } } });
  });
});
