import { describe, expect, it } from 'vitest';
import { GUEST_VISIBLE, canOpenApp, canOpenLink, canOpenRoute, guestLockedApp } from '@shared/access';
import { APP_CATALOGUE, GUEST_APPS, GUEST_LOCKED_APPS } from '@shared/apps';

/** Guest mode's module access (#149): one flag on each catalogue app, read by the sidebar, the router and ⌘K. */
describe('guest mode module access', () => {
  it('opens Notes, Tasks, Contacts, Calendar and Meet, and Settings and Help — nothing else', () => {
    expect(GUEST_APPS.map((a) => a.id).sort()).toEqual(['calendar', 'contacts', 'meet', 'notes', 'tasks']);
    for (const id of ['notes', 'tasks', 'contacts', 'calendar', 'meet', 'settings', 'diagnostics']) expect(canOpenApp(id, GUEST_VISIBLE)).toBe(true);
    for (const id of ['home', 'account', 'notifications', 'mail', 'chat', 'files', 'office', 'calls', 'crm', 'hr', 'ai', 'pdf', 'pos']) expect(canOpenApp(id, GUEST_VISIBLE)).toBe(false);
    // An account's own set is unchanged.
    expect(canOpenApp('home', new Set())).toBe(true);
  });

  it('refuses locked modules by route and link, deep links included', () => {
    expect(canOpenRoute('/notes?note=4', GUEST_VISIBLE)).toBe(true);
    expect(canOpenRoute('/settings/local-data', GUEST_VISIBLE)).toBe(true);
    for (const route of ['/mail?compose=1', '/chat?room=4', '/files', '/whatsapp?chat=5', '/people/4', '/hr']) expect(canOpenRoute(route, GUEST_VISIBLE)).toBe(false);
    expect(canOpenLink('/tasks?task=2', GUEST_VISIBLE)).toBe(true);
    expect(canOpenLink('/mail', GUEST_VISIBLE)).toBe(false);
  });

  it('names the locked app a guest asked for, for the sign-in panel', () => {
    expect(GUEST_LOCKED_APPS.map((a) => a.guestLabel ?? a.label)).toEqual(expect.arrayContaining(['Chat', 'Mail', 'Drive & Files', 'Company records', 'Shared workspaces', 'HR & People', 'CRM & Sales', 'AI Assistant']));
    expect(guestLockedApp('/mail?compose=1')).toBe('mail');
    expect(guestLockedApp('/office/12')).toBe('files');
    expect(guestLockedApp('chat')).toBe('chat');
    expect(guestLockedApp('/notes')).toBeNull();
    for (const a of APP_CATALOGUE) if (a.guest === 'local') expect(a.surface).toBe('native');
  });
});
