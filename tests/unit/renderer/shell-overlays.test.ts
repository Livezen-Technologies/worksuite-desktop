// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/app-state', () => ({ app: { get: () => ({ apps: [], auth: null }), set: () => undefined, subscribe: () => () => undefined }, updatePrefs: () => undefined }));
import { gridStep } from '@shared/launcher';
import { nextScope, readRecentSearches, splitMatch } from '../../../src/app/overlays/SearchOverlay';
import { appColour, groupLook } from '../../../src/core/app-look';
import { agoLabel, noteRecentApp, readRecentApps, withRecent } from '../../../src/core/recent-apps';

describe('the app launcher (AppLauncher)', () => {
  it('moves over a six-wide grid with the arrow keys, and stops at the edges', () => {
    expect(gridStep(0, 'ArrowRight', 20, 6)).toBe(1);
    expect(gridStep(0, 'ArrowLeft', 20, 6)).toBe(0);
    expect(gridStep(2, 'ArrowDown', 20, 6)).toBe(8);
    expect(gridStep(8, 'ArrowUp', 20, 6)).toBe(2);
    expect(gridStep(17, 'ArrowDown', 20, 6)).toBe(17);
    expect(gridStep(3, 'Enter', 20, 6)).toBe(3);
  });

  it('remembers the apps opened lately, newest first, once each', () => {
    let list = withRecent([], 'mail', 1);
    list = withRecent(list, 'chat', 2);
    list = withRecent(list, 'mail', 3);
    expect(list.map((r) => r.id)).toEqual(['mail', 'chat']);
    expect(withRecent(Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, at: i })), 'x', 99)).toHaveLength(8);
  });

  it('keeps them per person, and only on this computer', () => {
    localStorage.clear();
    noteRecentApp(7, 'tasks', 1_000);
    noteRecentApp(8, 'crm', 1_000);
    expect(readRecentApps(7).map((r) => r.id)).toEqual(['tasks']);
    expect(readRecentApps(null)).toEqual([]);
    localStorage.setItem('ws.recentApps.9', '{broken');
    expect(readRecentApps(9)).toEqual([]);
  });

  it('says how long ago', () => {
    const now = new Date(2026, 8, 26, 16, 0).getTime();
    expect(agoLabel(now - 20_000, now)).toBe('Just now');
    expect(agoLabel(now - 2 * 60_000, now)).toBe('2 min ago');
    expect(agoLabel(now - 60 * 60_000, now)).toBe('1 h ago');
    expect(agoLabel(new Date(2026, 8, 25, 18, 0).getTime(), now)).toBe('Yesterday');
  });
});

describe('global search (GlobalSearch)', () => {
  beforeEach(() => localStorage.clear());

  it('marks the first match in a title, whatever its case', () => {
    expect(splitMatch('Garage module — design', 'module')).toEqual({ a: 'Garage ', m: 'module', b: ' — design' });
    expect(splitMatch('Garage', 'GAR')).toEqual({ a: '', m: 'Gar', b: 'age' });
    expect(splitMatch('Garage', 'x')).toEqual({ a: 'Garage', m: '', b: '' });
    expect(splitMatch('Garage', '')).toEqual({ a: 'Garage', m: '', b: '' });
  });

  it('steps the filter with Tab, and back with Shift+Tab', () => {
    const scopes = ['All', 'Mail', 'Chat', 'Files'];
    expect(nextScope(scopes, 'All')).toBe('Mail');
    expect(nextScope(scopes, 'Files')).toBe('All');
    expect(nextScope(scopes, 'All', true)).toBe('Files');
    expect(nextScope([], 'Mail')).toBe('All');
  });

  it('reads recent searches safely', () => {
    expect(readRecentSearches(1)).toEqual([]);
    localStorage.setItem('ws.search.recent.1', JSON.stringify(['garage', 3, 'invoice 0418']));
    expect(readRecentSearches(1)).toEqual(['garage', 'invoice 0418']);
    localStorage.setItem('ws.search.recent.1', 'nope');
    expect(readRecentSearches(1)).toEqual([]);
  });

  it('colours a result by the app it belongs to, and falls back for groups it does not know', () => {
    expect(groupLook('Mail')).toEqual({ colour: appColour('mail'), icon: 'mail' });
    expect(groupLook('Website chats').icon).toBe('globe');
    expect(groupLook('Something new')).toEqual({ colour: '#23349E', icon: 'search' });
    expect(appColour('nope')).toBe('#23349E');
  });
});
