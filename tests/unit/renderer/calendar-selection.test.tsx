// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setRegional } from '../../../src/core/time';
import { WeekGrid } from '../../../src/modules/calendar/WeekGrid';
import { MonthGrid } from '../../../src/modules/calendar/MonthGrid';

const date = '2026-10-01';
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
let frames: Map<number, FrameRequestCallback>;

beforeEach(() => {
  setRegional({ timezone: 'Asia/Colombo', timeFormat: '24' });
  vi.stubGlobal('PointerEvent', MouseEvent);
  frames = new Map();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setRegional({}); });

function week(days = [date], readOnly = false) {
  const onCreate = vi.fn();
  const onOpen = vi.fn();
  const result = render(<WeekGrid days={days} events={[]} today={date} readOnly={readOnly} onCreate={onCreate} onOpen={onOpen} onMove={vi.fn()} onResize={vi.fn()} />);
  const columns = Array.from(result.container.querySelectorAll<HTMLElement>('[data-select-date]')).slice(days.length);
  columns.forEach((column, i) => vi.spyOn(column, 'getBoundingClientRect').mockImplementation(() => rect(56 + i * 100, 0, 100, 1248)));
  return { ...result, columns, onCreate, onOpen };
}

describe('Calendar empty-space selection (#63)', () => {
  it.each([[['2026-10-01']], [['2026-09-28', '2026-09-29', '2026-09-30', date, '2026-10-02', '2026-10-03', '2026-10-04']]])('selects snapped wall-clock times in Day and Week: %j', (days) => {
    const { columns, onCreate } = week(days);
    const i = days.indexOf(date);
    fireEvent.pointerDown(columns[i]!, { button: 0, clientX: 60 + i * 100, clientY: 9 * 52 + 4 });
    fireEvent.pointerMove(window, { clientX: 60 + i * 100, clientY: 10.5 * 52 + 2 });
    expect(screen.getByRole('status').textContent).toContain('09:00 – 10:30 · 1 h 30 min · Asia/Colombo');
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { clientX: 60 + i * 100, clientY: 10.5 * 52 + 2 });
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({ start: `${date}T09:00`, end: `${date}T10:30`, allDay: false });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('normalizes a backwards drag and ends at next-day midnight at the bottom', () => {
    const { columns, onCreate } = week();
    fireEvent.pointerDown(columns[0]!, { button: 0, clientY: 11.25 * 52 });
    fireEvent.pointerMove(window, { clientY: 10.5 * 52 });
    fireEvent.pointerUp(window, { clientY: 10.5 * 52 });
    expect(onCreate).toHaveBeenLastCalledWith({ start: `${date}T10:30`, end: `${date}T11:15`, allDay: false });
    fireEvent.pointerDown(columns[0]!, { button: 0, clientY: 1247 });
    fireEvent.pointerUp(window, { clientY: 1300 });
    expect(onCreate).toHaveBeenLastCalledWith({ start: `${date}T23:45`, end: '2026-10-02T00:00', allDay: false });
  });

  it('Escape, pointer cancellation, and losing focus discard selection', () => {
    const { columns, onCreate } = week();
    for (const cancel of [() => fireEvent.keyDown(window, { key: 'Escape' }), () => fireEvent.pointerCancel(window), () => fireEvent.blur(window)]) {
      fireEvent.pointerDown(columns[0]!, { button: 0, clientY: 9 * 52 });
      cancel();
      fireEvent.pointerUp(window, { clientY: 10 * 52 });
      fireEvent.click(columns[0]!);
    }
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not start selection offline/read-only or with the secondary mouse button', () => {
    const { columns, onCreate } = week([date], true);
    fireEvent.pointerDown(columns[0]!, { button: 0, clientY: 9 * 52 });
    fireEvent.pointerUp(window, { clientY: 10 * 52 });
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();
    const enabled = week();
    fireEvent.pointerDown(enabled.columns[0]!, { button: 2, clientY: 9 * 52 });
    fireEvent.pointerUp(window, { button: 2, clientY: 10 * 52 });
    expect(enabled.onCreate).not.toHaveBeenCalled();
  });

  it('cancels when creation access is revoked and can start a fresh selection once restored', () => {
    const { columns, rerender, onCreate, onOpen } = week();
    const props = { days: [date], events: [], today: date, onCreate, onOpen, onMove: vi.fn(), onResize: vi.fn() };
    fireEvent.pointerDown(columns[0]!, { button: 0, clientY: 9 * 52 });
    rerender(<WeekGrid {...props} readOnly />);
    fireEvent.pointerUp(window, { clientY: 10 * 52 });
    expect(onCreate).not.toHaveBeenCalled();
    rerender(<WeekGrid {...props} readOnly={false} />);
    fireEvent.pointerDown(columns[0]!, { button: 0, clientY: 9 * 52 });
    fireEvent.pointerUp(window, { clientY: 10 * 52 });
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({ start: `${date}T09:00`, end: `${date}T10:00`, allDay: false });
  });

  it('leaves existing event clicks alone', () => {
    const onCreate = vi.fn();
    const onOpen = vi.fn();
    const event = { source: 'event', id: 1, title: 'Already booked', start_at: `${date} 09:00:00`, end_at: `${date} 10:00:00`, all_day: false, color: null, editable: false };
    render(<WeekGrid days={[date]} events={[event]} today={date} onCreate={onCreate} onOpen={onOpen} onMove={vi.fn()} onResize={vi.fn()} />);
    const button = screen.getByRole('button', { name: /Already booked/ });
    fireEvent.pointerDown(button, { button: 0, clientY: 9 * 52 });
    fireEvent.pointerUp(window, { clientY: 10 * 52 });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(event);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('uses the displayed timezone, and abandons a selection if that timezone changes', () => {
    setRegional({ timezone: 'America/New_York', timeFormat: '24' });
    const { columns, onCreate } = week();
    fireEvent.pointerDown(columns[0]!, { button: 0, clientY: 9 * 52 });
    expect(screen.getByRole('status').textContent).toContain('America/New_York');
    fireEvent.pointerUp(window, { clientY: 10 * 52 });
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({ start: `${date}T09:00`, end: `${date}T10:00`, allDay: false });
    fireEvent.pointerDown(columns[0]!, { button: 0, clientY: 9 * 52 });
    setRegional({ timezone: 'Asia/Colombo' });
    fireEvent.pointerUp(window, { clientY: 10 * 52 });
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('selects inclusive dates backwards across the All Day row', () => {
    const { container, onCreate } = week(['2026-09-30', date, '2026-10-02']);
    const cells = Array.from(container.querySelectorAll<HTMLElement>('[data-select-date]')).slice(0, 3);
    cells.forEach((cell, i) => vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(rect(i * 100, 0, 100, 40)));
    fireEvent.pointerDown(cells[2]!, { button: 0, clientX: 250, clientY: 20 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 20 });
    expect(screen.getByRole('status').textContent).toContain('2026-09-30 – 2026-10-02 · 3 days · All day');
    fireEvent.pointerUp(window, { clientX: 50, clientY: 20 });
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({ start: '2026-09-30', end: '2026-10-02', allDay: true });
  });

  it('selects across weeks and the month boundary without changing date-button navigation', () => {
    const onCreate = vi.fn();
    const onDay = vi.fn();
    const { container } = render(<MonthGrid anchor={date} events={[]} today={date} onCreate={onCreate} onOpen={vi.fn()} onMove={vi.fn()} onDay={onDay} />);
    const cells = Array.from(container.querySelectorAll<HTMLElement>('[data-select-date]'));
    cells.forEach((cell, i) => vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(rect(i % 7 * 100, Math.floor(i / 7) * 100, 100, 100)));
    fireEvent.pointerDown(cells[2]!, { button: 0, clientX: 250, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 150 });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 150 });
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({ start: '2026-09-30', end: '2026-10-06', allDay: true });
    fireEvent.click(cells[3]!.querySelector('button')!);
    expect(onDay).toHaveBeenCalledWith(date);
  });

  it('keeps scrolling while the pointer stays near the edge, updating the selected time', () => {
    const { container, columns, onCreate } = week();
    const scroller = container.querySelector<HTMLElement>('.overflow-y-auto')!;
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 200, 400));
    vi.spyOn(columns[0]!, 'getBoundingClientRect').mockImplementation(() => rect(56, -scroller.scrollTop, 100, 1248));
    fireEvent.pointerDown(columns[0]!, { button: 0, clientX: 100, clientY: 300 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 395 });
    act(() => {
      for (let i = 0; i < 6; i++) {
        const current = Array.from(frames.values()); frames.clear(); current.forEach((cb) => cb(i * 16));
      }
    });
    expect(scroller.scrollTop).toBe(72);
    fireEvent.pointerUp(window, { clientX: 100, clientY: 395 });
    expect(onCreate).toHaveBeenCalledExactlyOnceWith({ start: `${date}T05:45`, end: `${date}T09:00`, allDay: false });
  });
});
