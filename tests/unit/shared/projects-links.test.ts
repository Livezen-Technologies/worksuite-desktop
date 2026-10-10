import { describe, expect, it } from 'vitest';
import { findApp } from '@shared/apps';
import { parseDeepLink } from '@shared/deeplink';
import { resolveWebLink } from '@shared/links';

/** G-12, G-13 and acceptance #9: every link to a project or a task opens that record in the native Projects app. */
describe('Projects links land in the native app', () => {
  it('is a native app now', () => {
    expect(findApp('projects')).toMatchObject({ surface: 'native', app: 'projects', webPath: '/projects' });
  });

  it('worksuite://projects/{id} opens the project (its overview)', () => {
    const r = parseDeepLink('worksuite://projects/18');
    expect(r).toMatchObject({ ok: true, link: { module: 'projects', pattern: 'projects/:id', route: '/projects/18', params: { id: '18' } } });
  });

  it('worksuite://projects/{id}/tasks/{task} opens the task on its board', () => {
    const r = parseDeepLink('worksuite://projects/18/tasks/412');
    expect(r).toMatchObject({ ok: true, link: { module: 'projects', pattern: 'projects/:id/tasks/:task', route: '/projects/18/tasks/412', params: { id: '18', task: '412' } } });
    expect(parseDeepLink('worksuite:///projects/18/tasks/412?window=1')).toMatchObject({ ok: true, link: { route: '/projects/18/tasks/412', newWindow: true } });
    expect(parseDeepLink('worksuite://projects')).toMatchObject({ ok: true, link: { route: '/projects' } });
  });

  it('refuses what is not a record', () => {
    expect(parseDeepLink('worksuite://projects/18/tasks/4%2F12')).toMatchObject({ ok: false, reason: 'forbidden_characters' });
    expect(parseDeepLink('worksuite://projects/18/tasks/412?task=1')).toMatchObject({ ok: false, reason: 'malformed' });
    expect(parseDeepLink('worksuite://projects/18/tasks')).toMatchObject({ ok: false, reason: 'unknown_route' });
    expect(parseDeepLink('worksuite://projects/18/tasks/412/extra')).toMatchObject({ ok: false, reason: 'unknown_route' });
  });

  it('web links from Mail, Calendar, notifications and search open in the tab; screens not built here go to the browser', () => {
    expect(resolveWebLink('/projects/18')).toEqual({ kind: 'tab', route: '/projects/18', app: 'projects' });
    expect(resolveWebLink('/projects/18/tasks/412')).toEqual({ kind: 'tab', route: '/projects/18/tasks/412', app: 'projects' });
    expect(resolveWebLink('/projects?project=18')).toEqual({ kind: 'tab', route: '/projects?project=18', app: 'projects' });
    expect(resolveWebLink('/projects?id=18')).toEqual({ kind: 'tab', route: '/projects?id=18', app: 'projects' });
    expect(resolveWebLink('/projects/my-work')).toEqual({ kind: 'tab', route: '/projects/my-work', app: 'projects' });
    expect(resolveWebLink('/projects/changes/7')).toEqual({ kind: 'tab', route: '/projects/changes/7', app: 'projects' });
    // The portfolio is native (PORTFOLIO): the register, templates, clients, a project's own pages, activity, settings.
    for (const path of ['/projects/all?status=active', '/projects/templates', '/projects/clients/5', '/projects/activity', '/projects/settings', '/projects/18/team', '/projects/18/settings', '/projects/18/activity', '/projects/18/files', '/projects/18/board', '/projects/board'])
      expect(resolveWebLink(path)).toEqual({ kind: 'tab', route: path, app: 'projects' });
    // DELIVERY: the timeline, milestones, sprints and workload are drawn here.
    expect(resolveWebLink('/projects/18/timeline')).toEqual({ kind: 'tab', route: '/projects/18/timeline', app: 'projects' });
    expect(resolveWebLink('/projects/timeline')).toEqual({ kind: 'tab', route: '/projects/timeline', app: 'projects' });
    expect(resolveWebLink('/projects/milestones')).toEqual({ kind: 'tab', route: '/projects/milestones', app: 'projects' });
    expect(resolveWebLink('/projects/18/milestones')).toEqual({ kind: 'tab', route: '/projects/18/milestones', app: 'projects' });
    expect(resolveWebLink('/projects/sprints/7')).toEqual({ kind: 'tab', route: '/projects/sprints/7', app: 'projects' });
    expect(resolveWebLink('/projects/18/sprints')).toEqual({ kind: 'tab', route: '/projects/18/sprints', app: 'projects' });
    expect(resolveWebLink('/projects/workload')).toEqual({ kind: 'tab', route: '/projects/workload', app: 'projects' });
    expect(resolveWebLink('/projects/time?tab=queue')).toEqual({ kind: 'tab', route: '/projects/time?tab=queue', app: 'projects' });
    expect(resolveWebLink('/projects/18/timelines')).toEqual({ kind: 'browser', path: '/projects/18/timelines', app: 'projects' });
    expect(resolveWebLink('/projects/budget')).toEqual({ kind: 'browser', path: '/projects/budget', app: 'projects' });
    expect(resolveWebLink('/projects/risks?project_id=3')).toEqual({ kind: 'browser', path: '/projects/risks?project_id=3', app: 'projects' });
  });
});
