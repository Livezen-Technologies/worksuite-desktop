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
import { APP_CATALOGUE, isSelfService, visibleApps } from '@shared/apps';
import { appForWebPath, resolveWebLink } from '@shared/links';

/**
 * "If a person is not granted an app, don't show it anywhere." One decision
 * (visibleApps over the bootstrap), asked the same way for a tab, a window,
 * a web path, a link and a notification.
 */
const boot = (apps: string[] | '*' | null, permissions: string[] = [], serverApps: string[] | null = null) => ({ apps, permissions, serverApps });
// Somebody not set up: the everyday apps (the server's AppGate::DEFAULTS, Telephony among them), and HR (no app slug).
const everyday = visibleAppIds(boot(['mail', 'chat', 'calendar', 'tasks', 'notes', 'drive', 'telephony']));

describe('what a bootstrap allows', () => {
  it('is the everyday apps, HR, the Phone and Home for somebody not set up — nothing else', () => {
    // PDF Studio needs no app: a PDF from this computer is anyone's to read (a Drive file is still the server's to allow).
    // Office is a part of Files: its tile shows with the Drive. The Phone is the server's `telephony` application, one
    // of its defaults. Social Media Manager has no app slug until a server has its module and app row (WS-SMM-SRS-001).
    expect([...everyday].sort()).toEqual(['calendar', 'chat', 'files', 'home', 'hr', 'mail', 'notes', 'office', 'pdf', 'phone', 'social-media', 'tasks']);
    expect(visibleAppIds(null).size).toBe(0);
  });

  it('shows the Phone only with the server’s telephony application (G-03; audit D-G24)', () => {
    const noPhone = visibleAppIds(boot(['mail', 'chat', 'calendar', 'tasks', 'notes', 'drive']));
    expect(canOpenApp('phone', noPhone)).toBe(false);
    expect(canOpenRoute('/phone/calls', noPhone)).toBe(false);
    expect(canOpenApp('phone', visibleAppIds(boot(['telephony'], [], ['telephony'])))).toBe(true);
    expect(canOpenApp('phone', visibleAppIds(boot(['mail', 'telephony'], [], ['mail'])))).toBe(false);
    expect(canOpenApp('phone', visibleAppIds(boot('*', ['*'])))).toBe(true);
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
    expect(appForWebPath('/purchase/orders')?.id).toBe('purchase');
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
    expect(canOpenRoute('/garage/jobs/1', everyday)).toBe(false);
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

describe('self-service apps: their own claims, without the app', () => {
  const grant = { apps: ['mail', 'chat'], permissions: [], serverApps: ['mail', 'chat'], selfService: ['expenses'] };

  it('shows the app, marked self-service, so it can be opened — and nothing else it names', () => {
    const exp = visibleApps(grant).find((a) => a.id === 'expenses');
    expect(exp?.selfService).toBe(true);
    expect(visibleApps(grant).find((a) => a.id === 'mail')?.selfService).toBeUndefined();
    const visible = visibleAppIds(grant);
    expect(canOpenApp('expenses', visible)).toBe(true);
    expect(canOpenWebPath('/expenses', visible)).toBe(true);
    expect(canOpenLink('/expenses?claim=7', visible)).toBe(true);
    expect(notificationAllowed({ category: 'expenses', link: '/expenses?claim=7' }, visible)).toBe(true);
    expect(categoryVisible('expenses', visible)).toBe(true);
  });

  it('is not self-service for whoever has the full app, and nothing without the server saying so', () => {
    const def = APP_CATALOGUE.find((a) => a.id === 'expenses')!;
    expect(isSelfService(def, { ...grant, apps: ['mail', 'expenses'], serverApps: ['mail', 'expenses'] })).toBe(false);
    expect(isSelfService(def, { apps: '*', permissions: ['*'], selfService: ['expenses'] })).toBe(false);
    expect(visibleAppIds({ ...grant, selfService: [] }).has('expenses')).toBe(false);
    expect(visibleAppIds({ apps: ['mail'], permissions: [] }).has('expenses')).toBe(false);
  });
});

describe('own payslips are everyone’s (HR’s My pay), Payroll or not', () => {
  it('opens a /payroll/me link in HR’s My pay', () => {
    expect(resolveWebLink('/payroll/me/payslips/PS-1')).toEqual({ kind: 'tab', route: '/hr?tab=mypay', app: 'hr' });
    expect(appForWebPath('/payroll/me')?.id).toBe('hr');
    expect(canOpenLink('/payroll/me/payslips/PS-1', everyday)).toBe(true);
    expect(canOpenLink('/hr?tab=mypay', everyday)).toBe(true);
  });

  it('keeps the Pay and payslips category for everyone, and Payroll itself gated', () => {
    expect(categoryVisible('payroll', everyday)).toBe(true);
    expect(canOpenApp('payroll', everyday)).toBe(false);
    expect(canOpenLink('/payroll?tab=runs', everyday)).toBe(false);
  });
});
