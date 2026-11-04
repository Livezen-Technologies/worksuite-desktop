// @vitest-environment jsdom
// worksuite-desktop#454: a saved draft that answers after the person started typing must not replace what they typed.
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

let answer: (v: unknown) => void = () => undefined;
vi.mock('../../../src/core/bridge', () => ({
  call: vi.fn((channel: string) => (channel === 'offline:getDraft' ? new Promise((r) => { answer = r; }) : Promise.resolve(null))),
}));

import { useDraft } from '../../../src/core/drafts';

describe('useDraft', () => {
  it('keeps what was typed when the saved copy arrives late', async () => {
    const { result } = renderHook(() => useDraft<string>('chat', 'room:1', ''));
    act(() => result.current.setValue('hello'));
    await act(async () => { answer({ content: 'hel' }); });
    expect(result.current.value).toBe('hello');
    expect(result.current.loaded).toBe(true);
  });

  it('still restores a saved draft when nothing was typed', async () => {
    const { result } = renderHook(() => useDraft<string>('chat', 'room:2', ''));
    await act(async () => { answer({ content: 'kept from before' }); });
    expect(result.current.value).toBe('kept from before');
    expect(result.current.restored).toBe(true);
  });
});
