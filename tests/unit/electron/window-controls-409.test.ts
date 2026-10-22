import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: true }, screen: {}, powerSaveBlocker: {}, BrowserWindow: {}, webContents: {} }));
const { ownControlsFor } = await import('../../../electron/windows/manager');

describe('which windows draw their own buttons (#409)', () => {
  it('every Linux window with a bar of ours; rings and call windows keep what they had', () => {
    expect(ownControlsFor('main', 'linux')).toBe(true);
    expect(ownControlsFor('record', 'linux')).toBe(true);
    expect(ownControlsFor('ring', 'linux')).toBe(false);
    expect(ownControlsFor('support-ring', 'linux')).toBe(false);
    expect(ownControlsFor('call', 'linux')).toBe(false);
  });

  it('leaves Windows and macOS unchanged', () => {
    expect(ownControlsFor('main', 'win32')).toBe(false);
    expect(ownControlsFor('main', 'darwin')).toBe(false);
  });
});
