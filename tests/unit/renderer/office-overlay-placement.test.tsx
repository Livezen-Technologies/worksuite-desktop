// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => 'data:image/jpeg;base64,SHOT') }));
import { call } from '../../../src/core/bridge';
import { useEditorPlacement } from '../../../src/modules/office/EditorSurface';
function Surface({ active = true }: { active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const shot = useEditorPlacement(ref, 'view', active);
  return <div ref={ref}>{shot ? <img alt="snapshot" src={shot} /> : null}</div>;
}
afterEach(() => {
  cleanup();
  document.querySelectorAll('[data-test-overlay]').forEach((el) => el.remove());
  vi.restoreAllMocks();
  vi.mocked(call).mockClear();
});
function overlay(role: string) {
  const el = document.createElement('div');
  el.setAttribute('role', role);
  el.setAttribute('data-test-overlay', '');
  act(() => document.body.append(el));
  return el;
}
it('keeps one native view hidden across overlapping menus and dialogs, then restores its bounds', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 80, left: 0, top: 80, right: 800, bottom: 680, width: 800, height: 600, toJSON: () => ({}) });
  const ui = render(<Surface />);
  const menu = overlay('menu');
  await waitFor(() => expect(ui.getByAltText('snapshot')).toBeTruthy());
  await waitFor(() => expect(call).toHaveBeenLastCalledWith('office:place', expect.objectContaining({ visible: false })));
  const dialog = overlay('dialog');
  act(() => menu.remove());
  await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  expect(call).toHaveBeenLastCalledWith('office:place', expect.objectContaining({ visible: false }));
  act(() => dialog.remove());
  await waitFor(() => expect(call).toHaveBeenLastCalledWith('office:place', expect.objectContaining({ visible: true, bounds: { x: 0, y: 80, width: 800, height: 600 } })));
  expect(ui.queryByAltText('snapshot')).toBeNull();
  expect(vi.mocked(call).mock.calls.some(([name]) => name === 'office:open' || name === 'office:command')).toBe(false);
});
it('discards a slow snapshot when the menu has already closed', async () => {
  let finish!: (shot: string) => void;
  vi.mocked(call).mockImplementation((name) =>
    name === 'office:snapshot'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : (Promise.resolve(undefined) as never),
  );
  const ui = render(<Surface />);
  const menu = overlay('menu');
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  act(() => menu.remove());
  await act(async () => {
    await Promise.resolve();
    finish('late');
  });
  expect(ui.queryByAltText('snapshot')).toBeNull();
});
it('does not capture or reveal an inactive editor', async () => {
  render(<Surface active={false} />);
  overlay('menu');
  await act(async () => {
    await Promise.resolve();
  });
  expect(vi.mocked(call).mock.calls.some(([name]) => name === 'office:snapshot')).toBe(false);
  expect(call).toHaveBeenLastCalledWith('office:place', expect.objectContaining({ visible: false }));
});
it('shows a menu even if snapshot capture never completes', async () => {
  vi.mocked(call).mockImplementation((name) => (name === 'office:snapshot' ? new Promise(() => undefined) : (Promise.resolve(undefined) as never)));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 80, left: 0, top: 80, right: 800, bottom: 680, width: 800, height: 600, toJSON: () => ({}) });
  render(<Surface />);
  overlay('menu');
  await waitFor(() => expect(call).toHaveBeenLastCalledWith('office:place', expect.objectContaining({ visible: false })));
});
it('hides for a toast marker and ignores an already hidden menu', async () => {
  vi.mocked(call).mockResolvedValue('data:image/jpeg;base64,SHOT' as never);
  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  menu.setAttribute('data-test-overlay', '');
  document.body.append(menu);
  const ui = render(<Surface />);
  expect(vi.mocked(call).mock.calls.some(([name]) => name === 'office:snapshot')).toBe(false);
  const toast = document.createElement('div');
  toast.setAttribute('data-native-overlay', '');
  toast.setAttribute('data-test-overlay', '');
  act(() => document.body.append(toast));
  await waitFor(() => expect(ui.getByAltText('snapshot')).toBeTruthy());
  act(() => toast.remove());
  await waitFor(() => expect(ui.queryByAltText('snapshot')).toBeNull());
});
it('reserves space for the persistent AI launcher instead of hiding the editor indefinitely', async () => {
  const rect = (top: number, height: number) => ({ x: 0, y: top, left: 0, top, right: 800, bottom: top + height, width: 800, height, toJSON: () => ({}) });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-native-reserve-space') ? rect(600, 64) : rect(80, 600);
  });
  render(<Surface />);
  const launcher = document.createElement('div');
  launcher.setAttribute('data-ai-assistant', '');
  launcher.setAttribute('data-native-reserve-space', '');
  launcher.setAttribute('data-test-overlay', '');
  act(() => document.body.append(launcher));
  await waitFor(() => expect(call).toHaveBeenLastCalledWith('office:place', expect.objectContaining({ visible: true, bounds: { x: 0, y: 80, width: 800, height: 512 } })));
  expect(vi.mocked(call).mock.calls.some(([name]) => name === 'office:snapshot')).toBe(false);
  act(() => launcher.remove());
  await waitFor(() => expect(call).toHaveBeenLastCalledWith('office:place', expect.objectContaining({ bounds: { x: 0, y: 80, width: 800, height: 600 } })));
});
