import { describe, expect, it } from 'vitest';
import { canOpenLink, canOpenRoute, linkApp, routeOwner, visibleAppIds } from '@shared/access';
import { appRoute, findApp, navApps, visibleApps } from '@shared/apps';
import { channelAppOfRoute, redirectRoute, whatsappRoute } from '@shared/channels';
import { parseDeepLink } from '@shared/deeplink';
import { resolveWebLink } from '@shared/links';

/**
 * WhatsApp is a channel of Chat now, not a module of its own (worksuite-desktop#35): no entry of its own in
 * navigation, its old routes and the web's links open Chat › WhatsApp on the same conversation, and who may open it
 * is still decided by WhatsApp's own access.
 */
const boot = (apps: string[]) => ({ apps, permissions: [] });
const withWhatsapp = visibleAppIds(boot(['chat', 'whatsapp']));
const chatOnly = visibleAppIds(boot(['chat']));
const whatsappOnly = visibleAppIds(boot(['whatsapp']));

describe('WhatsApp as a channel of Chat', () => {
  it('is in the catalogue for its access, as a channel of Chat that opens there', () => {
    const wa = findApp('whatsapp')!;
    expect(wa).toMatchObject({ app: 'whatsapp', channelOf: 'chat', surface: 'native' });
    expect(appRoute(wa)).toBe('/chat?channel=whatsapp');
    expect(appRoute(findApp('crm')!)).toBe('/crm');
  });

  it('has no navigation entry of its own beside Chat — only for someone with WhatsApp and not Chat', () => {
    expect(navApps(visibleApps(boot(['chat', 'whatsapp']))).map((a) => a.id)).toContain('chat');
    expect(navApps(visibleApps(boot(['chat', 'whatsapp']))).map((a) => a.id)).not.toContain('whatsapp');
    expect(navApps(visibleApps(boot(['whatsapp']))).map((a) => a.id)).toContain('whatsapp');
    expect(navApps(visibleApps(boot(['chat']))).map((a) => a.id)).not.toContain('whatsapp');
  });

  it('builds the channel’s routes: a conversation, a number to start one with, or the list', () => {
    expect(whatsappRoute({ chat: '42' })).toBe('/chat?channel=whatsapp&wa=42');
    expect(whatsappRoute({ to: '+94 77 123 4567' })).toBe('/chat?channel=whatsapp&to=94771234567');
    expect(whatsappRoute({ chat: 'x1', to: '12' })).toBe('/chat?channel=whatsapp');
    expect(whatsappRoute()).toBe('/chat?channel=whatsapp');
  });

  it('redirects the old routes (saved tabs, pinned entries, windows) with the same conversation', () => {
    expect(redirectRoute('/whatsapp')).toBe('/chat?channel=whatsapp');
    expect(redirectRoute('/whatsapp?chat=5')).toBe('/chat?channel=whatsapp&wa=5');
    expect(redirectRoute('/whatsapp/5')).toBe('/chat?channel=whatsapp&wa=5');
    expect(redirectRoute('/whatsapp?to=94771234567')).toBe('/chat?channel=whatsapp&to=94771234567');
    // Anything else is left as it is.
    expect(redirectRoute('/chat?room=4')).toBe('/chat?room=4');
    expect(redirectRoute('/crm/leads/2')).toBe('/crm/leads/2');
  });

  it('opens the web’s links (notifications, shares) in Chat › WhatsApp, on the same conversation', () => {
    expect(resolveWebLink('/whatsapp?chat=12')).toEqual({ kind: 'tab', route: '/chat?channel=whatsapp&wa=12', app: 'whatsapp' });
    expect(resolveWebLink('/whatsapp')).toEqual({ kind: 'tab', route: '/chat?channel=whatsapp', app: 'whatsapp' });
    expect(resolveWebLink('/whatsapp?to=94771234567')).toEqual({ kind: 'tab', route: '/chat?channel=whatsapp&to=94771234567', app: 'whatsapp' });
    // Pages of the web's WhatsApp module with no desktop screen open the channel, never the browser.
    expect(resolveWebLink('/whatsapp/broadcasts')).toEqual({ kind: 'tab', route: '/chat?channel=whatsapp', app: 'whatsapp' });
    expect(linkApp('/whatsapp?chat=12')).toBe('whatsapp');
  });

  it('keeps WhatsApp’s own access: Chat alone does not open it, WhatsApp alone does', () => {
    expect(channelAppOfRoute('/chat?channel=whatsapp&wa=3')).toBe('whatsapp');
    expect(channelAppOfRoute('/chat?room=3')).toBeNull();
    expect(channelAppOfRoute('/crm?channel=whatsapp')).toBeNull();
    expect(routeOwner('/chat?channel=whatsapp&wa=3')).toBe('whatsapp');
    expect(routeOwner('/whatsapp?chat=3')).toBe('whatsapp');
    expect(routeOwner('/chat?room=3')).toBe('chat');
    for (const r of ['/chat?channel=whatsapp&wa=3', '/whatsapp?chat=3', '/whatsapp']) {
      expect(canOpenRoute(r, withWhatsapp)).toBe(true);
      expect(canOpenRoute(r, chatOnly)).toBe(false);
      expect(canOpenRoute(r, whatsappOnly)).toBe(true);
    }
    expect(canOpenRoute('/chat?room=3', whatsappOnly)).toBe(false);
    expect(canOpenLink('/whatsapp?chat=3', withWhatsapp)).toBe(true);
    expect(canOpenLink('/whatsapp?chat=3', chatOnly)).toBe(false);
  });

  it('takes worksuite:// links to WhatsApp into the channel', () => {
    const one = parseDeepLink('worksuite://whatsapp/77');
    expect(one.ok && one.link).toMatchObject({ module: 'whatsapp', route: '/chat?channel=whatsapp&wa=77' });
    const list = parseDeepLink('worksuite://whatsapp');
    expect(list.ok && list.link.route).toBe('/chat?channel=whatsapp');
    const odd = parseDeepLink('worksuite://whatsapp/abc');
    expect(odd.ok && odd.link.route).toBe('/chat?channel=whatsapp');
  });
});
