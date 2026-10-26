import { describe, expect, it } from 'vitest';
import { findApp, visibleApps } from '../../../shared/apps';
import { resolveWebLink } from '../../../shared/links';

/**
 * Documents, Forms, Rental and Diagrams (audit D-G04): the server's own apps with no desktop module yet, listed in the
 * catalogue as "opens in your browser" with the server's `applications` slug, its web route and the permission its API
 * demands — so they appear exactly where the web would show them, and open there.
 */
describe('browser apps from the server catalogue', () => {
  const cases = [
    { id: 'docs', app: 'docs', webPath: '/documents', perm: 'docs.view' },
    { id: 'forms', app: 'forms', webPath: '/forms', perm: 'forms.view' },
    { id: 'rental', app: 'rental', webPath: '/rental', perm: 'rental.access' },
    { id: 'diagram', app: 'diagram', webPath: '/diagrams', perm: undefined },
  ] as const;

  it.each(cases)('$id opens $webPath in the browser, gated on the app $app', ({ id, app, webPath, perm }) => {
    const def = findApp(id)!;
    expect(def).toMatchObject({ app, webPath, surface: 'browser' });
    expect(def.perm).toBe(perm);
  });

  it.each(cases)('$id shows only with its app and permission', ({ id, app, perm }) => {
    const ids = (apps: string[] | '*', permissions: string[]) => visibleApps({ apps, permissions }).map((a) => a.id);
    expect(ids([app], perm ? [perm] : [])).toContain(id);
    expect(ids(['mail'], perm ? [perm] : [])).not.toContain(id);
    if (perm) expect(ids([app], [])).not.toContain(id);
    expect(ids('*', ['*'])).toContain(id);
    // A server that resolves the gates itself and leaves it out wins.
    expect(visibleApps({ apps: '*', permissions: ['*'], serverApps: ['mail'] }).map((a) => a.id)).not.toContain(id);
  });

  it.each(cases)('links into $id open in the browser', ({ id, webPath }) => {
    expect(resolveWebLink(`${webPath}/12`)).toEqual({ kind: 'browser', path: `${webPath}/12`, app: id });
  });
});
