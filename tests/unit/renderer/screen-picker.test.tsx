// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenSources } from '@shared/types';

/**
 * The share picker (worksuite-desktop#70): one true thing at a time — the list, Screen Recording off (not
 * Accessibility), a listing that failed, or nothing of that kind — with the way out of each, and the quality kept.
 */
let answer: ScreenSources | Error = { permission: 'granted', state: 'ok', sources: [] };
const call = vi.fn(async (channel: string, _input?: unknown) => {
  if (channel === 'media:screenSources') {
    if (answer instanceof Error) throw answer;
    return answer;
  }
  return null;
});
const bridge = { platform: 'darwin' };
vi.mock('../../../src/core/bridge', () => ({
  call: (c: string, i?: unknown) => call(c, i),
  on: () => () => undefined,
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  get platform() {
    return bridge.platform;
  },
  isMac: true,
}));

const { ScreenPicker, pickerView } = await import('../../../src/modules/calls/ScreenPicker');

const S = (id: string, name: string, kind: 'screen' | 'window') => ({ id, name, kind, thumbnail: 'data:image/png;base64,AAAA' });
const ok: ScreenSources = { permission: 'granted', state: 'ok', platform: 'darwin', sources: [S('screen:1:0', 'Screen 1', 'screen'), S('screen:2:0', 'Screen 2', 'screen'), S('window:10:0', 'Report.docx', 'window')] };

function mount(props: Partial<Parameters<typeof ScreenPicker>[0]> = {}) {
  const onPick = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><ScreenPicker onPick={onPick} onClose={() => undefined} {...props} /></QueryClientProvider>);
  return onPick;
}

beforeEach(() => {
  localStorage.clear();
  call.mockClear();
  bridge.platform = 'darwin';
});
afterEach(cleanup);

describe('what the picker says', () => {
  it('tells apart a permission that is off, a failure, nothing to share and a list', () => {
    expect(pickerView({ isLoading: true, error: null }, 'screen')).toEqual({ kind: 'loading' });
    expect(pickerView({ isLoading: false, error: null, data: { permission: 'denied', state: 'denied', sources: [], platform: 'darwin' } }, 'screen').kind).toBe('denied');
    expect(pickerView({ isLoading: false, error: null, data: { permission: 'granted', state: 'failed', problem: 'Failed to get sources.', sources: [], restartMayHelp: true } }, 'screen')).toEqual({ kind: 'failed', detail: 'Failed to get sources.', restart: true });
    expect(pickerView({ isLoading: false, error: new Error('Too many requests'), data: undefined }, 'screen')).toEqual({ kind: 'failed', detail: 'Too many requests', restart: false });
    expect(pickerView({ isLoading: false, error: null, data: ok }, 'screen')).toEqual({ kind: 'list', partial: null });
    expect(pickerView({ isLoading: false, error: null, data: { ...ok, sources: ok.sources.filter((s) => s.kind === 'screen') } }, 'window').kind).toBe('empty');
    // An older main process that sends only the permission.
    expect(pickerView({ isLoading: false, error: null, data: { permission: 'denied', sources: [] } }, 'screen').kind).toBe('denied');
  });
});

describe('the share picker', () => {
  it('shows screens and windows with pictures, and shares the one picked, with the quality kept for next time', async () => {
    answer = ok;
    const onPick = mount({ control: { allowRequests: false, unavailable: null } });
    const shareBtn = screen.getByRole('button', { name: 'Share' }) as HTMLButtonElement;
    expect(shareBtn.disabled).toBe(true);
    fireEvent.click(await screen.findByRole('option', { name: /Screen 2/ }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Sharing quality' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Sharp text' }));
    fireEvent.click(shareBtn);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'screen:2:0', name: 'Screen 2', quality: 'quality', allowRequests: false }));
    expect(localStorage.getItem('ws.share.quality')).toBe('quality');
    fireEvent.click(screen.getByRole('tab', { name: 'A window' }));
    expect(screen.getByRole('option', { name: /Report\.docx/ })).toBeTruthy();
  });

  it('Screen Recording off: says so (not Accessibility), with Open System Settings, Restart and Check again', async () => {
    answer = { permission: 'denied', state: 'denied', sources: [], platform: 'darwin', restartMayHelp: false };
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/isn’t allowed to record the screen/);
    expect(alert.textContent).toMatch(/Screen Recording/);
    expect(alert.textContent).toMatch(/separate from Accessibility/);
    expect(screen.queryByRole('button', { name: 'Restart WorkSuite' })).toBeNull();
    expect(screen.queryByText(/Nothing to share|No screen could be found/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open System Settings' }));
    expect(call).toHaveBeenCalledWith('media:privacySettings', { pane: 'screen' });
    answer = ok;
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByRole('option', { name: /Screen 1/ })).toBeTruthy();
  });

  it('a listing that failed says what the system said, with Try again — and no "nothing to share"', async () => {
    answer = { permission: 'granted', state: 'failed', problem: 'Failed to get sources.', sources: [], platform: 'linux' };
    bridge.platform = 'linux';
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not be listed/);
    expect(alert.textContent).toMatch(/The system said: Failed to get sources\./);
    expect(screen.queryByText(/No screen could be found|No other windows/)).toBeNull();
    answer = ok;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('option', { name: /Screen 1/ })).toBeTruthy();
  });

  it('coming back to the window looks again', async () => {
    answer = { permission: 'denied', state: 'denied', sources: [], platform: 'darwin' };
    mount();
    await screen.findByRole('alert');
    answer = ok;
    window.dispatchEvent(new Event('focus'));
    expect(await screen.findByRole('option', { name: /Screen 1/ })).toBeTruthy();
  });

  it('windows that could not be listed leave the screens usable, and say so', async () => {
    answer = { permission: 'granted', state: 'partial', problem: 'Failed to get sources.', sources: [S('screen:1:0', 'Screen 1', 'screen')], platform: 'darwin' };
    mount();
    expect(await screen.findByText(/Windows could not be listed this time; screens can still be shared/)).toBeTruthy();
    expect(screen.getByRole('option', { name: /Screen 1/ })).toBeTruthy();
  });

  it('no windows open is said as that, not as an error', async () => {
    answer = { ...ok, sources: ok.sources.filter((s) => s.kind === 'screen') };
    mount();
    await screen.findByRole('option', { name: /Screen 1/ });
    fireEvent.click(screen.getByRole('tab', { name: 'A window' }));
    expect(screen.getByText(/No other windows are open to share/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('remote control that cannot be offered never blocks sharing', async () => {
    answer = ok;
    const onPick = mount({ inMeeting: true, control: { allowRequests: true, unavailable: 'Remote control needs Accessibility permission.' } });
    expect(screen.getByText(/Remote control needs Accessibility permission\. You can still share\./)).toBeTruthy();
    fireEvent.doubleClick(await screen.findByRole('option', { name: /Screen 1/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'screen:1:0', allowRequests: false }));
  });

  it('in a meeting, opens before remote control has been checked, and keeps the quality', async () => {
    answer = ok;
    localStorage.setItem('ws.share.quality', 'performance');
    const onPick = mount({ inMeeting: true });
    expect(screen.getByText(/Checking whether others can ask to control this computer/)).toBeTruthy();
    fireEvent.doubleClick(await screen.findByRole('option', { name: /Screen 1/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ quality: 'performance', allowRequests: false }));
  });
});


it('keeps Screen Recording unknown separate from denial and allows discovered sources without Accessibility', async () => {
  answer = { ...ok, permission: 'unknown', permissionStatus: 'unknown' };
  const pick = mount({ control: { allowRequests: false, unavailable: 'Accessibility is denied.' } });
  fireEvent.click(await screen.findByRole('option', { name: /Screen 1/ }));
  expect(screen.getByText(/Screen Recording.*Unable to Verify/)).toBeTruthy();
  expect(screen.queryByText(/isn’t allowed to record the screen/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  expect(pick).toHaveBeenCalledWith(expect.objectContaining({ id: 'screen:1:0', allowRequests: false }));
});
