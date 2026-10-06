import { describe, expect, it } from 'vitest';
import { APP_CATALOGUE, findApp, visibleApps } from '../../../shared/apps';
import { parseDeepLink } from '../../../shared/deeplink';
import { resolveWebLink } from '../../../shared/links';
import { NOTIFICATION_CATEGORY_APPS } from '../../../shared/access';
import { validateManifest } from '../../../shared/manifest';
import { MODULES } from '../../../src/modules/registry';

/**
 * Social Media Manager as an app of the desktop (WS-SMM-SRS-001 SMM-DSK-001, SMM-ADM-007): its own entry beside the
 * internal Social stream (Q-01), shown only where the server's app gate and social.view let it, reached by its deep
 * links and by the web's /social-media links.
 */
describe('Social Media Manager in the catalogue', () => {
  it('is its own native app, not the internal Social stream', () => {
    const sm = findApp('social-media')!;
    expect(sm).toMatchObject({ label: 'Social Media', app: 'social-media', perm: 'social.view', webPath: '/social-media', surface: 'native' });
    expect(findApp('social')).toMatchObject({ webPath: '/social', surface: 'browser' });
    expect(APP_CATALOGUE.filter((a) => a.webPath === '/social-media')).toHaveLength(1);
  });

  it('shows only to someone the server gives the app and social.view', () => {
    const ids = (apps: string[] | '*', permissions: string[], serverApps: string[] | null = null) => visibleApps({ apps, permissions, serverApps }).map((a) => a.id);
    expect(ids(['mail', 'social-media'], ['social.view'])).toContain('social-media');
    expect(ids(['mail'], ['social.view'])).not.toContain('social-media');
    expect(ids(['social-media'], [])).not.toContain('social-media');
    expect(ids('*', ['*'])).toContain('social-media');
    expect(ids('*', ['*'], ['mail'])).not.toContain('social-media');
  });

  it('opens from its deep links, and only those', () => {
    expect(parseDeepLink('worksuite://social-media/posts/103')).toMatchObject({ ok: true, link: { module: 'social-media', route: '/social-media/posts/103' } });
    expect(parseDeepLink('worksuite://social-media/inbox/201')).toMatchObject({ ok: true, link: { route: '/social-media/inbox/201' } });
    expect(parseDeepLink('worksuite://social-media/approvals/7')).toMatchObject({ ok: true, link: { route: '/social-media/approvals/7' } });
    expect(parseDeepLink('worksuite://social-media')).toMatchObject({ ok: true, link: { route: '/social-media' } });
    expect(parseDeepLink('worksuite://social-media/posts/..%2f')).toMatchObject({ ok: false });
    expect(parseDeepLink('worksuite://social-media/settings/x')).toMatchObject({ ok: false, reason: 'unknown_route' });
  });

  it('takes the web’s /social-media links natively and leaves /social to the browser', () => {
    expect(resolveWebLink('/social-media/posts/12')).toEqual({ kind: 'tab', route: '/social-media/posts/12', app: 'social-media' });
    expect(resolveWebLink('/social-media/inbox?view=mine')).toEqual({ kind: 'tab', route: '/social-media/inbox?view=mine', app: 'social-media' });
    expect(resolveWebLink('/social/feed')).toMatchObject({ kind: 'browser', app: 'social' });
  });

  it('owns its notification categories', () => {
    expect(NOTIFICATION_CATEGORY_APPS.social_media).toEqual(['social-media']);
    expect(NOTIFICATION_CATEGORY_APPS.social).toEqual(['social']);
  });

  it('declares a valid manifest the registry keeps', () => {
    const m = MODULES.find((x) => x.id === 'social-media');
    expect(m).toBeTruthy();
    expect(validateManifest(m!.manifest).ok).toBe(true);
    expect(m!.manifest.quickActions[0]).toMatchObject({ route: '/social-media/compose' });
    expect(m!.manifest.native).toEqual(['notifications', 'file-drop']);
  });
});
