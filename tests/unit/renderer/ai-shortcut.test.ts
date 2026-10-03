// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DEFAULT_SHORTCUTS } from '../../../src/core/commands';

describe('the AI Assistant shortcut (#153)', () => {
  it('opens with ⌘J / Ctrl+J as well as ⌘⇧A, and nothing else in the shell takes ⌘J', () => {
    expect(DEFAULT_SHORTCUTS.ai).toBe('Mod+Shift+A');
    expect(DEFAULT_SHORTCUTS['ai-alt']).toBe('Mod+J');
    expect(Object.entries(DEFAULT_SHORTCUTS).filter(([, keys]) => keys === 'Mod+J').map(([id]) => id)).toEqual(['ai-alt']);
  });
});
