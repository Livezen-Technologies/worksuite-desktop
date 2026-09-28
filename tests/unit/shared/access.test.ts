import { describe, expect, it } from 'vitest';
import {
  canOpenApp,
  canOpenLink,
  canOpenRoute,
  canOpenWebPath,
  categoryVisible,
  linkApp,
  notificationAllowed,
  visibleAppIds,
} from '@shared/access';
import { appForWebPath } from '@shared/links';

/**
 * "If a person is not granted an app, don't show it anywhere." One decision
 * (visibleApps over the bootstrap), asked the same way for a tab, a window,
 * a web path, a link and a notification.
 */
const boot = (apps: string[] | '*' | null, permissions: string[] = [], serverApps: string[] | null = null) => ({ apps, permissions, serverApps });
// Somebody not set up: the everyday apps, and HR (no app slug).
const everyday = visibleAppIds(boot(['mail', 'chat', 'calendar', 'tasks', 'notes', 'drive']));

describe('what a bootstrap allows', () => {
  it('is the everyday apps, HR and Home for somebody not set up — nothing else', () => {
    expect([...everyday].sort()).toEqual(['calendar', 'chat', 'files', 'home', 'hr', 'mail', 'notes', 'tasks']);
    expect(visibleAppIds(null).size).toBe(0);
  });

  it('keeps an installation without the catalogue fully open (apps: null)', () => {
    const all = visibleAppIds(boot(null, ['*']));
    expect(all.has('crm')).toBe(true);
    expect(all.has('ai')).toBe(true);
  });

  it('opens shell screens to everyone, the parts of an app with it, and nothing it was not given', () => {
    expect(canOpenApp('settings', new Set())).toBe(true);
    expect(canOpenApp('account', new Set())).toBe(true);
    expect(canOpenApp('calls', everyday)).toBe(true);
    expect(canOpenApp('calls', visibleAppIds(boot(['mail'])))).toBe(false);
    expect(canOpenApp('crm', everyday)).toBe(false);
    expect(canOpenApp('ai', everyday)).toBe(false);
  });
});

describe('a web path belongs to an app', () => {
  it('maps the path to the catalogue app with the longest web path', () => {
    expect(appForWebPath('/tickets?ticket=4')?.id).toBe('support');
    expect(appForWebPath('/oms?order=9')?.id).toBe('sales');
    expect(appForWebPath('/purchase/orders')?.id).toBe('purchasing');
    expect(appForWebPath('/users/12')).toBeUndefined();
    expect(appForWebPath('/')).toBeUndefined();
  });

  it('refuses a page of an app the person was not given, and leaves pages of no app alone', () => {
    expect(canOpenWebPath('/crm?account=3', everyday)).toBe(false);
    expect(canOpenWebPath('/whatsapp?chat=5', everyday)).toBe(false);
    expect(canOpenWebPath('/ai', everyday)).toBe(false);
    expect(canOpenWebPath('/notes?note=2', everyday)).toBe(true);
    for (const free of ['/users/7', '/directory', '/editor/9', '/account/settings', '/forgot-password']) expect(canOpenWebPath(free, everyday)).toBe(true);
  });

  it('refuses a desktop route (a window, a deep link) of an app the person was not given', () => {
    expect(canOpenRoute('/crm/leads/4', everyday)).toBe(false);
    expect(canOpenRoute('/tenders?open=3', everyday)).toBe(false);
    expect(canOpenRoute('/calls/ring?uuid=x', everyday)).toBe(true);
    expect(canOpenRoute('/chat?room=4', everyday)).toBe(true);
    expect(canOpenRoute('/diagnostics', everyday)).toBe(true);
    expect(canOpenRoute('/garage/jobs/1', everyday)).toBe(true);
  });

  it('refuses a link whichever way it would open — a tab, or the browser', () => {
    expect(linkApp('/crm/leads/4')).toBe('crm');
    expect(linkApp('/finance/journal')).toBe('finance');
    expect(canOpenLink('/crm/leads/4', everyday)).toBe(false);
    expect(canOpenLink('/finance/journal', everyday)).toBe(false);
    expect(canOpenLink('/tasks?task=3', everyday)).toBe(true);
    expect(canOpenLink('/account/security', everyday)).toBe(true);
    expect(canOpenLink(null, everyday)).toBe(true);
    expect(canOpenLink('https://evil.example/crm', everyday)).toBe(true); // not a link the desktop opens at all
  });
});

describe('notifications', () => {
  it('shows a category while any of its apps is the person’s, and categories of no app always', () => {
    expect(categoryVisible('crm', everyday)).toBe(false);
    expect(categoryVisible('oms', everyday)).toBe(false);
    expect(categoryVisible('projects', everyday)).toBe(true); // tasks
    expect(categoryVisible('calendar', everyday)).toBe(true);
    expect(categoryVisible('system', everyday)).toBe(true);
    expect(categoryVisible('security', everyday)).toBe(true);
    expect(categoryVisible(null, everyday)).toBe(true);
  });

  it('suppresses one whose link or category is an app the person may not open', () => {
    expect(notificationAllowed({ module: 'crm', category: 'crm', link: '/crm/leads/4' }, everyday)).toBe(false);
    expect(notificationAllowed({ module: 'expenses', category: 'expenses', link: null }, everyday)).toBe(false);
    expect(notificationAllowed({ module: 'mail', link: '/mail' }, visibleAppIds(boot(['chat'])))).toBe(false);
    expect(notificationAllowed({ module: 'chat', link: '/chat?room=4' }, everyday)).toBe(true);
    expect(notificationAllowed({ module: 'system', link: null }, new Set())).toBe(true);
  });
});
