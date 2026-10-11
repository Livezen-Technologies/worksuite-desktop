import { describe, expect, it } from 'vitest';
import { barOf, budgetTotal, byCategory, fillName, offsetLabel, planHours, pricedBudget, schedule, searchTemplates, stepDate, workCalendar, type LibraryItem, type TemplateSpec } from '../../../src/modules/projects/templates';
import { dateWords, monthCells, parseDateInput } from '../../../src/components/DateField';
import { setRegional } from '../../../src/core/time';
import { startKey } from '../../../src/modules/projects/screens/NewProject';

/**
 * The template library's rules on the desktop (worksuite-desktop#337). The scheduling cases are the server's
 * (ProjectTemplatePacksTest): the Preview tab must show the dates Create project will build.
 */

const weekdays = (holidays: string[] = []) => workCalendar([1, 2, 3, 4, 5], holidays);

const spec = (over: Partial<TemplateSpec>): TemplateSpec => ({
  schema: 1, key: 'x', version: 1, name: 'X', icon: 'copy', category: '', summary: '', tags: [], anchor: 'start', anchor_label: '', duration_days: 1,
  roles: [], phases: [], tasks: [], folders: [], budget: [], risks: [], custom_fields: [], statuses: [], automations: [], portal: null, links: {},
  defaults: { name_pattern: '', category: '', priority: 'medium', billable: true, status: 'planning', estimated_hours: null, budget: null, currency: null, description: '' },
  ...over,
});
const phase = (key: string, start: number, days: number, from: 'start' | 'end' = 'start') => ({ key, name: key.toUpperCase(), description: '', from, start, days });
const task = (key: string, start: number, days: number, more: Partial<TemplateSpec['tasks'][number]> = {}) => ({
  key, phase: null, title: key, description: '', role: null, hours: 0, priority: 'medium', from: 'start' as const, start, days, depends_on: [], checklist: [], tags: [], subtasks: [], repeat: null, ...more,
});
const span = (p: { start: string; end: string }) => [p.start, p.end];

describe('the plan on real dates (the server’s TemplatePlan)', () => {
  it('starts on the first working day and skips weekends', () => {
    const p = schedule(spec({ duration_days: 8, phases: [phase('a', 0, 3), phase('b', 3, 5)] }), '2026-10-10', null, weekdays(), '2026-10-01');
    expect([p.start, p.end, p.scale, p.days]).toEqual(['2026-10-12', '2026-10-21', 1, 8]);
    expect(p.phases.map(span)).toEqual([['2026-10-12', '2026-10-14'], ['2026-10-15', '2026-10-21']]);
  });

  it('skips holidays when the calendar has them', () => {
    const p = schedule(spec({ duration_days: 3, phases: [phase('a', 0, 3)] }), '2026-10-12', null, weekdays(['2026-10-13']), '2026-10-01');
    expect(span(p.phases[0]!)).toEqual(['2026-10-12', '2026-10-15']);
  });

  it('counts an end-anchored template back from its closing date', () => {
    const tender = spec({ anchor: 'end', duration_days: 15, phases: [phase('compile', -3, 2, 'end'), phase('submit', 0, 1, 'end'), phase('opening', 1, 10, 'end')] });
    const p = schedule(tender, null, '2026-11-20', weekdays(), '2026-10-01');
    expect(p.start).toBe('2026-11-02');
    expect(p.phases.map((x) => x.start)).toEqual(['2026-11-17', '2026-11-20', '2026-11-23']);
  });

  it('stretches or squeezes the start-anchored plan to the dates, never the deadlines', () => {
    const s = spec({ duration_days: 10, phases: [phase('a', 0, 5), phase('b', 5, 5), phase('z', -1, 2, 'end')] });
    const long = schedule(s, '2026-10-12', '2026-11-06', weekdays(), '2026-10-01');
    expect(long.scale).toBe(2);
    expect(long.phases.map(span)).toEqual([['2026-10-12', '2026-10-23'], ['2026-10-26', '2026-11-06'], ['2026-11-05', '2026-11-06']]);
    const short = schedule(s, '2026-10-12', '2026-10-16', weekdays(), '2026-10-01');
    expect(short.phases.map(span)).toEqual([['2026-10-12', '2026-10-14'], ['2026-10-15', '2026-10-16'], ['2026-10-15', '2026-10-16']]);
  });

  it('writes a repeating task out until the end, month by month as the server counts', () => {
    const p = schedule(spec({ duration_days: 60, tasks: [task('v', 0, 1, { title: 'Visit', repeat: { every: 'month' } })] }), '2026-01-30', '2026-04-30', weekdays(), '2026-01-01');
    expect(p.tasks.map((t) => t.start)).toEqual(['2026-01-30', '2026-03-02', '2026-03-30', '2026-04-30']);
    expect(p.tasks[2]!.title).toBe('Visit — Mar 2026');
    expect(stepDate('2026-01-31', 'quarter', 1)).toBe('2026-05-01');
    expect(stepDate('2026-11-02', 'week', 2)).toBe('2026-11-16');
  });

  it('with no dates at all, starts today', () => {
    expect(schedule(spec({ duration_days: 2, phases: [phase('a', 0, 2)] }), null, null, weekdays(), '2026-10-11').phases[0]).toMatchObject({ start: '2026-10-12', end: '2026-10-13' });
  });

  it('places a bar on the timeline', () => {
    expect(barOf('2026-10-01', '2026-10-10', '2026-10-01', '2026-10-20')).toEqual({ left: 0, width: 50 });
  });
});

describe('words and figures', () => {
  it('fills the name pattern and says where a part sits', () => {
    expect(fillName('{client} website', { client: 'Ceylon Tea Board' })).toBe('Ceylon Tea Board website');
    expect(fillName('{client} — bid', { client: '' })).toBe('bid');
    expect(offsetLabel({ from: 'start', start: 0, days: 1 })).toBe('Day 0');
    expect(offsetLabel({ from: 'start', start: 10, days: 1 })).toBe('+2 weeks');
    expect(offsetLabel({ from: 'end', start: -5, days: 1 }, 'closing date')).toBe('5 days before the closing date');
  });

  it('prices the budget lines at the roles’ rates and counts the hours', () => {
    const s = spec({
      roles: [{ key: 'dev', name: 'Developer', member_role: 'member', rate: 4000, hours_per_week: 30 }],
      budget: [
        { label: 'Build', kind: 'labour', role: 'dev', hours: 10, rate: null, amount: null, note: '' },
        { label: 'Domain', kind: 'expense', role: null, hours: 0, rate: null, amount: 3500, note: '' },
      ],
      tasks: [task('a', 0, 1, { hours: 5 }), task('b', 0, 1, { hours: 99, subtasks: [{ title: 's', description: '', role: null, hours: 3, checklist: [] }] })],
    });
    expect(pricedBudget(s).map((b) => b.amountDue)).toEqual([40000, 3500]);
    expect(budgetTotal(s)).toBe(43500);
    expect(planHours(s)).toBe(8);
  });

  it('searches and groups the library', () => {
    const it = (key: string, name: string, category: string, tags: string[]) => ({ key, name, category, tags, summary: '' }) as unknown as LibraryItem;
    const list = [it('pack.a', 'Tender bid submission', 'Tenders', ['Government']), it('pack.b', 'Website development', 'Web development', ['WordPress']), it('pack.c', 'E-commerce store', 'Web development', [])];
    expect(searchTemplates(list, 'wordpress').map((i) => i.key)).toEqual(['pack.b']);
    expect(searchTemplates(list, 'web').map((i) => i.key)).toEqual(['pack.b', 'pack.c']);
    expect(byCategory(list).map((g) => [g.category, g.items.length])).toEqual([['Tenders', 1], ['Web development', 2]]);
  });

  it('reads ?new= as a template key', () => {
    expect(startKey('blank')).toBeNull();
    expect(startKey('12')).toBe('project.12');
    expect(startKey('pack.event')).toBe('pack.event');
  });
});

describe('the date field’s reading of what is typed', () => {
  it('reads day first, and in words', () => {
    const today = '2026-10-11';
    expect(parseDateInput('11/10/2026', today)).toBe('2026-10-11');
    expect(parseDateInput('7/12/26', today)).toBe('2026-12-07');
    expect(parseDateInput('2026-12-07', today)).toBe('2026-12-07');
    expect(parseDateInput('7 Dec', today)).toBe('2026-12-07');
    expect(parseDateInput('Dec 7, 2027', today)).toBe('2027-12-07');
    expect(parseDateInput('tomorrow', today)).toBe('2026-10-12');
    expect(parseDateInput('', today)).toBe('');
    expect(parseDateInput('31/2/2026', today)).toBeNull();
    expect(parseDateInput('soon', today)).toBeNull();
  });

  it('shows a date in the reader’s format and draws whole weeks', () => {
    setRegional({ locale: 'en-GB' });
    expect(dateWords('2026-10-11')).toBe('11 Oct 2026');
    setRegional({ locale: null });
    const cells = monthCells('2026-10');
    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({ day: '2026-09-28', inMonth: false });
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
  });
});
