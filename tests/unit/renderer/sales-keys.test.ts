import { describe, expect, it } from 'vitest';
import { isControl, isTyping, moveFocus, salesKeyAction } from '../../../src/modules/sales/keys';

/** WS-OMS-SRS-001 FR-DSK-03: ↑/↓ move, Enter open, Space select, ⌘/Ctrl+N new order, ⌘/Ctrl+F search, A/R approve/reject. */
describe('the Sales keyboard map', () => {
  const pc = { mac: false, canCreate: true };
  const mac = { mac: true, canCreate: true };

  it('moves, opens and selects in a list', () => {
    expect(salesKeyAction({ key: 'ArrowDown' }, pc)).toEqual({ kind: 'move', delta: 1 });
    expect(salesKeyAction({ key: 'ArrowUp' }, pc)).toEqual({ kind: 'move', delta: -1 });
    expect(salesKeyAction({ key: 'Enter' }, pc)).toEqual({ kind: 'open' });
    expect(salesKeyAction({ key: ' ' }, pc)).toEqual({ kind: 'select' });
    expect(salesKeyAction({ key: 'Escape' }, pc)).toEqual({ kind: 'escape' });
  });

  it('takes Ctrl on Windows and Linux, ⌘ on a Mac, for New order and Search', () => {
    expect(salesKeyAction({ key: 'n', ctrlKey: true }, pc)).toEqual({ kind: 'new' });
    expect(salesKeyAction({ key: 'f', ctrlKey: true }, pc)).toEqual({ kind: 'search' });
    expect(salesKeyAction({ key: 'n', metaKey: true }, mac)).toEqual({ kind: 'new' });
    expect(salesKeyAction({ key: 'F', metaKey: true }, mac)).toEqual({ kind: 'search' });
    // The other platform's modifier is not it.
    expect(salesKeyAction({ key: 'n', metaKey: true }, pc)).toBeNull();
    expect(salesKeyAction({ key: 'n', ctrlKey: true }, mac)).toBeNull();
    // ⌘⇧N is the shell's (move tab to a window), not a new order.
    expect(salesKeyAction({ key: 'N', ctrlKey: true, shiftKey: true }, pc)).toBeNull();
  });

  it('offers New order only to whoever may create one', () => {
    expect(salesKeyAction({ key: 'n', ctrlKey: true }, { mac: false, canCreate: false })).toBeNull();
  });

  it('approves and rejects with A and R in the approvals queue only, for whoever may decide', () => {
    const queue = { mac: false, queue: true, canDecide: true };
    expect(salesKeyAction({ key: 'a' }, queue)).toEqual({ kind: 'approve' });
    expect(salesKeyAction({ key: 'R' }, queue)).toEqual({ kind: 'reject' });
    expect(salesKeyAction({ key: 'a' }, { ...queue, canDecide: false })).toBeNull();
    expect(salesKeyAction({ key: 'a' }, pc)).toBeNull();
    expect(salesKeyAction({ key: 'A', shiftKey: true }, queue)).toBeNull();
  });

  it('is never a shortcut while typing, except Esc and the ⌘ / Ctrl keys', () => {
    const typing = { mac: false, typing: true, queue: true, canDecide: true, canCreate: true };
    expect(salesKeyAction({ key: 'a' }, typing)).toBeNull();
    expect(salesKeyAction({ key: 'ArrowDown' }, typing)).toBeNull();
    expect(salesKeyAction({ key: ' ' }, typing)).toBeNull();
    expect(salesKeyAction({ key: 'Escape' }, typing)).toEqual({ kind: 'escape' });
    expect(salesKeyAction({ key: 'f', ctrlKey: true }, typing)).toEqual({ kind: 'search' });
  });

  it('keeps the focus inside the list', () => {
    expect(moveFocus(-1, 1, 5)).toBe(0);
    expect(moveFocus(-1, -1, 5)).toBe(4);
    expect(moveFocus(4, 1, 5)).toBe(4);
    expect(moveFocus(0, -1, 5)).toBe(0);
    expect(moveFocus(2, 1, 5)).toBe(3);
    expect(moveFocus(0, 1, 0)).toBe(-1);
  });

  it('knows a field and a button when it sees one', () => {
    const el = (tag: string, extra: Record<string, unknown> = {}) => ({ tagName: tag.toUpperCase(), isContentEditable: false, closest: () => null, getAttribute: () => null, ...extra }) as unknown as EventTarget;
    expect(isTyping(el('input'))).toBe(true);
    expect(isTyping(el('textarea'))).toBe(true);
    expect(isTyping(el('div', { isContentEditable: true }))).toBe(true);
    expect(isTyping(el('div', { closest: () => ({}) }))).toBe(true);
    expect(isTyping(el('div'))).toBe(false);
    expect(isControl(el('button'))).toBe(true);
    expect(isControl(el('div'))).toBe(false);
  });
});
