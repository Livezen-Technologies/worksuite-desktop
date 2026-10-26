// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => ({ presenter: false })), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: true, platform: 'darwin' }));

const paint = vi.fn(async () => undefined);
const dispose = vi.fn();
const openDeck = vi.fn(async () => ({ count: 8, width: 1280, height: 720, notes: Array(8).fill(''), paint, dispose }));
vi.mock('../../../src/modules/office/slides/render', () => ({ openDeck: () => openDeck(), fetchBytes: vi.fn() }));
const present = vi.fn(async (_o: unknown) => true);
vi.mock('../../../src/modules/office/slides/present', () => ({ present: (o: unknown) => present(o) }));

const { SlidesViewer } = await import('../../../src/modules/office/slides/SlidesViewer');

beforeAll(() => {
  // jsdom lays nothing out: the stage is 1400 × 600.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1400 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  paint.mockClear();
  present.mockClear();
  dispose.mockClear();
});
afterEach(cleanup);

const bytes = new Uint8Array([80, 75, 3, 4]);

async function open(props: Partial<Parameters<typeof SlidesViewer>[0]> = {}) {
  render(<SlidesViewer name="Q3 review.pptx" load={async () => bytes} {...props} />);
  await screen.findByText('Slide 1 of 8');
  // The deck arrives from an async load, outside act: the slide can be on screen before React has run the effect that
  // listens for the keys. Flush what React still has queued, so a key pressed next always reaches the viewer (a CI run
  // under load sent ⌘= before the listener was there, and the zoom stayed at fit).
  await act(async () => undefined);
}

describe('#321 the presentation viewer', () => {
  it('shows the slide fitted and sharp, thumbnails with the current one marked, and the bar', async () => {
    const onDownload = vi.fn();
    const onOpenInOffice = vi.fn();
    await open({ onDownload, onOpenInOffice });
    const options = within(screen.getByRole('listbox', { name: 'Slides' })).getAllByRole('option');
    expect(options).toHaveLength(8);
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    // The main slide is painted at the fitted width: (600 − 48) × 16/9 = 981 px, at the screen's pixel ratio.
    await waitFor(() => expect(paint).toHaveBeenCalledWith(expect.anything(), 0, 981, expect.any(Number)));
    expect((screen.getByRole('combobox', { name: 'Zoom' }) as HTMLSelectElement).value).toBe('fit');
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open in WorkSuite Office' }));
    expect(onDownload).toHaveBeenCalled();
    expect(onOpenInOffice).toHaveBeenCalled();
  });

  it('moves with ‹ ›, the thumbnails and the keys', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(screen.getByText('Slide 2 of 8')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'End' });
    expect(screen.getByText('Slide 8 of 8')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next slide' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'PageUp' });
    expect(screen.getByText('Slide 7 of 8')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Home' });
    expect(screen.getByText('Slide 1 of 8')).toBeTruthy();
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByText('Slide 2 of 8')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Slides' })).getAllByRole('option')[4]!);
    expect(screen.getByText('Slide 5 of 8')).toBeTruthy();
    expect(within(screen.getByRole('listbox', { name: 'Slides' })).getAllByRole('option')[4]!.getAttribute('aria-selected')).toBe('true');
  });

  it('zooms from the menu and with ⌘+ / ⌘− / ⌘0', async () => {
    await open();
    const zoom = screen.getByRole('combobox', { name: 'Zoom' }) as HTMLSelectElement;
    fireEvent.keyDown(window, { key: '=', metaKey: true });
    expect(zoom.value).toBe('1');
    fireEvent.keyDown(window, { key: '=', metaKey: true });
    expect(zoom.value).toBe('1.25');
    fireEvent.keyDown(window, { key: '-', metaKey: true });
    expect(zoom.value).toBe('1');
    fireEvent.keyDown(window, { key: '0', metaKey: true });
    expect(zoom.value).toBe('fit');
    fireEvent.change(zoom, { target: { value: 'width' } });
    // Fit width: 1400 − 48.
    await waitFor(() => expect(paint).toHaveBeenLastCalledWith(expect.anything(), 0, 1352, expect.any(Number)));
  });

  it('collapses the thumbnails', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Hide slide thumbnails' }));
    expect(screen.queryByRole('listbox', { name: 'Slides' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show slide thumbnails' }));
    expect(screen.getByRole('listbox', { name: 'Slides' })).toBeTruthy();
  });

  it('presents from the start with Present ▶ or ⌘⏎, and from this slide with ⇧⌘⏎', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    fireEvent.click(screen.getByRole('button', { name: /Present/ }));
    expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Q3 review.pptx', bytes, start: 0 }));
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true, shiftKey: true });
    expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ start: 1 }));
    fireEvent.keyDown(window, { key: 'F5' });
    expect(present).toHaveBeenLastCalledWith(expect.objectContaining({ start: 0 }));
    // The show ending on a slide brings the viewer there.
    const onEnd = (present.mock.calls.at(-1)![0] as { onEnd: (i: number) => void }).onEnd;
    act(() => onEnd(6));
    expect(screen.getByText('Slide 7 of 8')).toBeTruthy();
  });

  it('leaves the keys alone while it is not the active view', async () => {
    await open({ active: false });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('Slide 1 of 8')).toBeTruthy();
  });

  it('says why a presentation could not be shown, and offers Retry and the editor', async () => {
    const onOpenInOffice = vi.fn();
    openDeck.mockRejectedValueOnce(new Error('This file is not a presentation the Slides engine can read.'));
    render(<SlidesViewer name="broken.pptx" load={async () => bytes} onOpenInOffice={onOpenInOffice} />);
    expect((await screen.findByRole('alert')).textContent).toContain('not a presentation');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Slide 1 of 8')).toBeTruthy();
  });
});
