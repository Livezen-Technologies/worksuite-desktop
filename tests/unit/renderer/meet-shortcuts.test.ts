import { describe, expect, it } from 'vitest';
import { DEFAULT_SHORTCUTS, conflicts, effectiveShortcuts, shortcutMeta } from '../../../src/core/commands';
import { meetShortcutDefaults } from '@shared/shortcuts';

/**
 * Meet's rows in the shell's one shortcut registry (WS-MEET-ENH-01 D06).
 *
 * The guard that matters is the last one: four of the design's eleven keys
 * were already WorkSuite's own, and the whole point of putting Meet's keys in
 * this registry rather than beside the call is that a clash is visible
 * instead of silent.
 */

describe('Meet in the shell registry', () => {
  it('registers all ten of the design\u2019s keys that are Meet\u2019s own', () => {
    for (const id of Object.keys(meetShortcutDefaults(true))) {
      expect(DEFAULT_SHORTCUTS[id], id).toBeTruthy();
    }
    // Ten here; the artboard's eleventh row is the remote-control emergency
    // stop, which that service owns and this page only lists.
    expect(Object.keys(meetShortcutDefaults(true))).toHaveLength(10);
  });

  it('files each key under the area the design names, with the right scope', () => {
    expect(shortcutMeta('meet-mute')).toEqual({ area: 'Meet', scope: 'global' });
    expect(shortcutMeta('meet-raise-hand')).toEqual({ area: 'Meet', scope: 'app' });
    expect(shortcutMeta('meet-action-item')).toEqual({ area: 'Notes', scope: 'app' });
    expect(shortcutMeta('rc-emergency-stop')).toEqual({ area: 'Remote control', scope: 'global' });
    expect(shortcutMeta('palette')).toEqual({ area: 'WorkSuite', scope: 'app' });
    expect(shortcutMeta('next-tab').area).toBe('Tabs');
  });

  it('takes no key the rest of WorkSuite already uses', () => {
    // \u2318\u21e7N is Move tab to new window, \u2318\u21e7P the palette, \u2318\u21e7A the assistant,
    // \u2318\u21e7D Dock tab beside. If an edit gives one of those to Meet, this fails.
    expect(conflicts(effectiveShortcuts({}))).toEqual([]);
  });

  it('leaves the design\u2019s four taken keys where they were', () => {
    expect(DEFAULT_SHORTCUTS['move-tab-to-window']).toBe('Mod+Shift+N');
    expect(DEFAULT_SHORTCUTS['palette']).toBe('Mod+Shift+P');
    expect(DEFAULT_SHORTCUTS['ai']).toBe('Mod+Shift+A');
    expect(DEFAULT_SHORTCUTS['dock-tab-beside']).toBe('Mod+Shift+D');
  });

  it('keeps the design\u2019s letter for each one it had to move', () => {
    // \u2318\u2325 instead of \u2318\u21e7, so the mnemonic survives.
    expect(DEFAULT_SHORTCUTS['meet-pop-out']).toBe('Mod+Alt+P');
    expect(DEFAULT_SHORTCUTS['meet-action-item']).toBe('Mod+Alt+A');
    expect(DEFAULT_SHORTCUTS['meet-decision']).toBe('Mod+Alt+D');
  });

  it('keeps push to talk a bare key, and the registry quiet about it', () => {
    // It is listed and changeable, but `Shell.tsx` only calls preventDefault
    // for an accelerator with a *registered command* behind it \u2014 so a bare
    // Space here is safe exactly as long as nothing registers one.
    expect(DEFAULT_SHORTCUTS['meet-push-to-talk']).toBe('Space');
    expect(shortcutMeta('meet-push-to-talk').scope).toBe('app');
  });

  it('keeps the design\u2019s key where it was free', () => {
    expect(DEFAULT_SHORTCUTS['meet-mute']).toBe('Mod+Shift+M');
    expect(DEFAULT_SHORTCUTS['meet-camera']).toBe('Mod+Shift+V');
    expect(DEFAULT_SHORTCUTS['meet-join-next']).toBe('Mod+Shift+J');
    expect(DEFAULT_SHORTCUTS['meet-share-screen']).toBe('Mod+Shift+E');
    expect(DEFAULT_SHORTCUTS['meet-raise-hand']).toBe('Mod+Shift+H');
  });
});
