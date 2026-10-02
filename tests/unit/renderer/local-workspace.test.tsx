// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalStatus, LocalView } from '@shared/local-workspace';
const bridge = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: bridge.call, errorMessage: (e: Error) => e.message }));
import LocalWorkspacePage from '../../../src/modules/guest/LocalWorkspacePage';
import { LocalImportOffer } from '../../../src/modules/guest/LocalImportOffer';
import { app } from '../../../src/core/app-state';
let view: LocalView;
let status: LocalStatus;
beforeEach(() => {
  view = { items: [], meetingInput: '', meetingServer: '' };
  status = { profile: { name: 'Nimal', picture: null, hasPin: false, createdAt: '2026-10-02T09:00:00Z' }, locked: false, language: 'en' };
  bridge.call.mockReset();
  bridge.call.mockImplementation(async (ch: string, input?: Record<string, unknown>) => {
    if (ch === 'local:status') return structuredClone(status);
    if (ch === 'local:profile') { status.profile = { name: String(input?.name).trim(), picture: (input?.picture as string | null) ?? null, hasPin: typeof input?.pin === 'string', createdAt: '2026-10-02T09:00:00Z' }; return structuredClone(status.profile); }
    if (ch === 'local:unlock') return input?.pin === '4826' ? { unlocked: true, retryAfter: 0 } : { unlocked: false, retryAfter: 0 };
    if (ch === 'local:restorePreview') return { token: '4f29a1c0-7b3d-4e8a-9c21-5d6e7f809a1c', notes: 2, tasks: 1, events: 0, duplicates: 3, profileName: 'Old phone' };
    if (ch === 'local:restore') return { added: 3, skipped: 3 };
    if (ch === 'local:deleteAll') { status = { profile: null, locked: false, language: 'en' }; view.items = []; }
    if (ch === 'local:read') return structuredClone(view);
    if (ch === 'local:save') { const item = { ...input, id: '4f29a1c0-7b3d-4e8a-9c21-5d6e7f809a1b', revision: 1, updatedAt: '2026-10-02T09:00:00Z', firedAt: null }; view.items.push(item as never); return item; }
    if (ch === 'local:remove') view.items = view.items.filter((item) => item.id !== input?.id);
    if (ch === 'local:meeting') { view.meetingInput = input?.input as string; view.meetingServer = input?.server as string; }
    if (ch === 'local:importOffer') return { count: 1, pinRequired: false, profileName: 'Nimal' };
    return undefined;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('isolated offline workspace UI', () => {
  it('creates and deletes a note offline without workspace API/auth/AI calls', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<LocalWorkspacePage />);
    expect((await screen.findByTestId('local-profile-chip')).textContent).toBe('Nimal · Local Profile · Saved on This Device');
    expect(screen.getByText('Offline · local tools work')).toBeTruthy();
    await screen.findByText('No local items yet.');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Offline note' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Local text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save on this device' }));
    expect(await screen.findByRole('button', { name: 'Offline note' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Offline note' })).toBeNull());
    expect(bridge.call.mock.calls.every(([ch]) => ch.startsWith('local:'))).toBe(true);
  });
  it('preserves the entered meeting destination offline and joins only after connectivity returns', async () => {
    let online = false;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    render(<LocalWorkspacePage />); await screen.findByText('No local items yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Join Meeting' }));
    fireEvent.change(screen.getByLabelText('Meeting link or code'), { target: { value: '4F2 9A1 C07' } });
    fireEvent.change(screen.getByLabelText('WorkSuite server (for codes)'), { target: { value: 'https://example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save meeting destination' }));
    expect(await screen.findByText(/Your link or code is saved on this device/)).toBeTruthy();
    expect(bridge.call.mock.calls.some(([ch]) => ch === 'guest:open' || ch === 'local:joinMeeting')).toBe(false);
    expect(screen.getByText('Needs internet')).toBeTruthy();
    expect(screen.getByText(/You join as a guest named “Nimal”/)).toBeTruthy();
    expect(view.meetingInput).toBe('4F2 9A1 C07');
    online = true; act(() => window.dispatchEvent(new Event('online')));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to meeting' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('local:joinMeeting', { input: '4F2 9A1 C07', server: 'https://example.test' }));
  });
  it('shows calendar creation and reminder limits and requires typed confirmation for deleting all data', async () => {
    render(<LocalWorkspacePage />); await screen.findByText('No local items yet.');
    fireEvent.click(screen.getByRole('button', { name: /^Calendar$/ }));
    expect(screen.getByLabelText('Calendar month')).toBeTruthy();
    expect(screen.getByLabelText('Start date and time')).toBeTruthy();
    expect(screen.getByText(/if you quit the app, missed reminders appear after reopening/i)).toBeTruthy();
    expect(screen.getByText(/They do not fire while WorkSuite is fully closed/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Backup & Data' }));
    expect((screen.getByRole('button', { name: 'Delete all local guest data' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Type DELETE LOCAL DATA to delete everything'), { target: { value: 'DELETE LOCAL DATA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete all local guest data' }));
    await waitFor(() => expect(bridge.call).toHaveBeenCalledWith('local:deleteAll', { confirmation: 'DELETE LOCAL DATA' }));
    // The profile went with the data: the window is back at first-use setup.
    expect(await screen.findByText('Set up your Local Profile')).toBeTruthy();
  });
  it('offers an import after sign-in without uploading or reviewing automatically', async () => {
    app.set({ organizationId: '7' });
    render(<LocalImportOffer />);
    expect(await screen.findByText(/Nothing uploads automatically/)).toBeTruthy();
    expect(bridge.call.mock.calls.map(([ch]) => ch)).toEqual(['local:importOffer']);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText(/Nothing uploads automatically/)).toBeNull();
  });
});
