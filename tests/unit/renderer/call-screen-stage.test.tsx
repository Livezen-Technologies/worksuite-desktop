// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Track } from 'livekit-client';
vi.mock('../../../src/core/bridge', () => ({ isMac: false, call: vi.fn(async () => ({ alwaysOnTop: false, maximized: false })) }));
vi.mock('../../../src/app/windowChrome', () => ({ hideWindowBar: () => () => undefined }));
vi.mock('../../../src/modules/calls/ui/CallSidePanel', () => ({ CallSidePanel: () => null }));
vi.mock('../../../src/modules/calls/ui/CoreCallControls', () => ({ CoreCallControls: () => null }));
import { CallWorkspace } from '../../../src/modules/calls/ui/CallWorkspace';
import { callUi } from '../../../src/modules/calls/ui/state';
import type { CallPerson } from '../../../src/modules/calls/ui/people';

const track = () => ({ attach: vi.fn(), detach: vi.fn() });
const person = (id: string, self: boolean, camera: ReturnType<typeof track>, share: ReturnType<typeof track> | null): CallPerson => ({
  id,
  name: self ? 'You' : id,
  self,
  camera: camera as unknown as Track,
  screen: share as unknown as Track | null,
  speaking: false,
  micOn: true,
  screenPaused: false,
});
const props = { title: 'Meeting', tabs: [], buttons: [], more: [], end: { label: 'Leave', onClick: vi.fn() } };
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  callUi.set({ floating: false, layoutMode: 'auto', panelOpen: false, selfView: true, pipEnabled: true, boardOnStage: false });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('shared screen stage', () => {
  it('attaches a local share to the main video, retains the camera in PiP, and restores it after sharing ends', () => {
    const camera = track();
    const share = track();
    const stop = vi.fn();
    const me = person('me', true, camera, null);
    const view = render(<CallWorkspace {...props} people={[me]} stopPresenting={stop} />);
    expect(screen.queryByLabelText('Shared screen preview')).toBeNull();
    view.rerender(<CallWorkspace {...props} people={[{ ...me, screen: share as unknown as Track }]} stopPresenting={stop} />);
    const stage = screen.getByLabelText('Shared screen preview');
    expect(share.attach).toHaveBeenLastCalledWith(stage.querySelector('video'));
    expect(stage.className).toContain('border-[3px]');
    const pip = screen.getByRole('group', { name: "You's video — drag to move" });
    expect(camera.attach).toHaveBeenLastCalledWith(pip.querySelector('video'));
    fireEvent.click(screen.getByRole('button', { name: 'Stop presenting' }));
    expect(stop).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Hide this video' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show your video' }));
    view.rerender(<CallWorkspace {...props} people={[me]} stopPresenting={stop} />);
    expect(screen.queryByLabelText('Shared screen preview')).toBeNull();
    expect(share.detach).toHaveBeenCalled();
    expect(camera.attach.mock.lastCall?.[0]).toBe(view.container.querySelector('video'));
  });

  it('renders a remote share and its presenter camera separately', () => {
    const camera = track();
    const share = track();
    render(<CallWorkspace {...props} people={[person('Asha', false, camera, share)]} />);
    expect(share.attach).toHaveBeenCalledWith(screen.getByLabelText('Shared screen preview').querySelector('video'));
    expect(camera.attach).toHaveBeenCalledWith(screen.getByRole('group', { name: "Asha's video — drag to move" }).querySelector('video'));
    expect(screen.queryByRole('button', { name: 'Stop presenting' })).toBeNull();
  });

  it('keeps the local share visible in the floating card and ahead of another share or whiteboard', () => {
    const camera = track();
    const share = track();
    const otherShare = track();
    const people = [person('me', true, camera, share), person('Asha', false, track(), otherShare)];
    const view = render(<CallWorkspace {...props} people={people} board={<div>Board content</div>} />);
    expect(share.attach).toHaveBeenCalledWith(screen.getByLabelText('Shared screen preview').querySelector('video'));
    expect(screen.queryByText('Board content')).toBeNull();
    callUi.set({ floating: true });
    view.rerender(<CallWorkspace {...props} people={people} />);
    expect(share.attach.mock.lastCall?.[0]).toBe(
      screen
        .getAllByTitle('Back to the call')
        .find((el) => el.querySelector('video'))
        ?.querySelector('video'),
    );
    expect(otherShare.attach).not.toHaveBeenCalled();
  });
});
