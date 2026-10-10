import { describe, expect, it } from 'vitest';
import { contract } from '@shared/ipc/contract';
import { resolveWebLink } from '@shared/links';
import { projectsReportPath } from '@shared/projects';
import { viewOf } from '../../../src/modules/projects/routes';
import { governanceTitle } from '../../../src/modules/projects/screens/gov-routes';

const at = (url: string) => {
  const [p, q] = url.split('?');
  return viewOf((p ?? '').split('/').filter(Boolean), new URLSearchParams(q ?? ''));
};

describe('Projects governance addresses (W12–W15) land natively', () => {
  it('reads the web’s budget, risks, changes and reports addresses', () => {
    expect(at('/projects/budget').view).toEqual({ kind: 'budget', projectId: null });
    expect(at('/projects/18/budget').view).toEqual({ kind: 'budget', projectId: 18 });
    expect(at('/projects/risks').view).toEqual({ kind: 'risks', projectId: null });
    expect(at('/projects/risks?project_id=3').view).toEqual({ kind: 'risks', projectId: 3 });
    expect(at('/projects/18/risks').view).toEqual({ kind: 'risks', projectId: 18 });
    expect(at('/projects/changes').view).toEqual({ kind: 'changes', id: null });
    expect(at('/projects/changes/7').view).toEqual({ kind: 'changes', id: 7 });
    expect(at('/projects/18/changes').view).toEqual({ kind: 'changes', id: null, projectId: 18 });
    expect(at('/projects/reports').view).toEqual({ kind: 'reports', report: null });
    expect(at('/projects/reports/time_by_person').view).toEqual({ kind: 'reports', report: 'time_by_person' });
    // Not governance, or deeper than a screen: still the web's.
    expect(at('/projects/18/budget/x').view).toEqual({ kind: 'web', path: '/projects/18/budget/x' });
    expect(at('/projects/18/files').view).toEqual({ kind: 'web', path: '/projects/18/files' });
  });

  it('names the tab', () => {
    expect(governanceTitle({ kind: 'budget', projectId: null })).toBe('Projects · Budget & cost');
    expect(governanceTitle({ kind: 'reports', report: null })).toBe('Projects · Reports');
    expect(governanceTitle({ kind: 'dashboard' })).toBeNull();
  });

  it('web links to them open in the tab', () => {
    expect(resolveWebLink('/projects/reports/budget')).toEqual({ kind: 'tab', route: '/projects/reports/budget', app: 'projects' });
    expect(resolveWebLink('/projects/18/budget')).toEqual({ kind: 'tab', route: '/projects/18/budget', app: 'projects' });
    expect(resolveWebLink('/projects/18/risks')).toEqual({ kind: 'tab', route: '/projects/18/risks', app: 'projects' });
    expect(resolveWebLink('/projects/18/changes')).toEqual({ kind: 'tab', route: '/projects/18/changes', app: 'projects' });
    expect(resolveWebLink('/projects/18/team')).toEqual({ kind: 'browser', path: '/projects/18/team', app: 'projects' });
    expect(resolveWebLink('/projects/18/budgets')).toEqual({ kind: 'browser', path: '/projects/18/budgets', app: 'projects' });
  });
});

describe('a report export goes through the download manager by what it is', () => {
  const input = contract['transfers:download'].input;

  it('builds the server’s address from the kind, format and filters', () => {
    expect(projectsReportPath({ kind: 'time_by_person', format: 'xlsx', query: { from: '2026-10-01', to: '2026-10-31', org: '1', client_id: '3' } })).toBe('/api/projects/reports?kind=time_by_person&from=2026-10-01&to=2026-10-31&org=1&client_id=3&format=xlsx');
    expect(projectsReportPath({ kind: 'budget', format: 'csv' })).toBe('/api/projects/reports?kind=budget&format=csv');
  });

  it('takes only known reports, formats and filters', () => {
    const ok = { projectsReport: { kind: 'budget', format: 'pdf', query: { project_id: '18' } }, name: 'projects-budget.pdf', open: false };
    expect(input.safeParse(ok).success).toBe(true);
    expect(input.safeParse({ ...ok, projectsReport: { ...ok.projectsReport, kind: 'payroll' } }).success).toBe(false);
    expect(input.safeParse({ ...ok, projectsReport: { ...ok.projectsReport, format: 'exe' } }).success).toBe(false);
    expect(input.safeParse({ ...ok, projectsReport: { ...ok.projectsReport, query: { path: '/etc' } } }).success).toBe(false);
    expect(input.safeParse({ ...ok, projectsReport: { ...ok.projectsReport, query: { org: '1&x=2' } } }).success).toBe(false);
    // One file at a time.
    expect(input.safeParse({ ...ok, fileId: '9' }).success).toBe(false);
  });
});
