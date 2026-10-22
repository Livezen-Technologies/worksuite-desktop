// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options, SegmentField } from '../../../src/modules/marketing/types';
import type { Definition, JourneyDetail } from '../../../src/modules/marketing/automation-parts';

/**
 * Marketing › WS-C on the desktop (SRS v2.0): the journey builder, forms,
 * lead scoring and nested segment groups — on the same endpoints as the web.
 * What a journey does and who it reaches is the server's
 * (`marketing:automation-probe`).
 */
const net = vi.hoisted(() => ({ apiGet: vi.fn(), request: vi.fn(), call: vi.fn(), go: vi.fn(), navigate: vi.fn(), toast: vi.fn() }));

vi.mock('../../../src/core/bridge', () => ({ call: net.call, on: () => () => undefined, hasDesktop: () => true, errorMessage: (e: unknown) => String(e), isMac: false, platform: 'linux', registerDropped: vi.fn() }));
vi.mock('../../../src/core/api', () => ({
  apiGet: net.apiGet,
  request: net.request,
  ApiError: class extends Error {
    status = 422;
    data = null;
  },
}));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ go: net.go, navigate: net.navigate, query: new URLSearchParams(), path: ['marketing'] }), useTabTitle: () => undefined }));
vi.mock('../../../src/core/toasts', () => ({ toast: net.toast }));
vi.mock('../../../src/modules/marketing/email-BlockEditor', () => ({ BlockEditor: () => <div>blocks</div> }));

const { default: Automation } = await import('../../../src/modules/marketing/Automation');
const { default: Forms } = await import('../../../src/modules/marketing/Forms');
const { default: Scoring } = await import('../../../src/modules/marketing/Scoring');
const parts = await import('../../../src/modules/marketing/automation-parts');
const rules = await import('../../../src/modules/marketing/audience-rules');

const def: Definition = {
  trigger: { type: 'list_joined', config: { list_id: 4 } },
  start: 's1',
  steps: {
    s1: { type: 'send_email', config: { campaign_id: 9 }, next: 's2', label: null },
    s2: { type: 'branch', config: { match: 'all', rules: [] }, yes: 's3', no: null, label: 'Opened?' },
    s3: { type: 'tag_add', config: { tag: 'engaged' }, next: null, label: null },
  },
  goal: null, exit: null, reentry: { policy: 'never', days: null }, exit_sales_ready: true,
};
const voc = { triggers: [{ value: 'list_joined', label: 'Joins a list' }], steps: [{ value: 'wait', label: 'Wait' }, { value: 'tag_add', label: 'Add tag' }], reentry: [], call_outcomes: [], crm_stages: [], statuses: [] };
const journey: JourneyDetail = {
  id: 3, org_id: 1, name: 'Welcome', description: null, status: 'active', version: 2, trigger: def.trigger, updated_at: null,
  stats: { entered: 40, active: 12, completed: 20, goal: 5, exited: 3, parked: 0, conversion: 12.5 },
  definition: def, problems: {}, dirty: false, may_manage: true, vocabulary: voc, step_stats: { s1: { entered: 40, waiting: 2, completed: 38, exited: 0, failed: 1 } },
};
const options = { companies: [{ id: 1, name: 'Acme', can: { journeys: true, forms: true, scores: true }, people: [] }], segment_fields: [], import_targets: [] } as unknown as Options;

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const shown = (ui: ReactNode) => render(<QueryClientProvider client={client()}>{ui}</QueryClientProvider>);

beforeEach(() => {
  net.apiGet.mockReset();
  net.request.mockReset();
  net.request.mockResolvedValue({ data: null, message: 'Done.' });
  net.toast.mockReset();
  net.apiGet.mockImplementation(async (path: string) => {
    if (path === '/api/marketing/journeys/3') return journey;
    if (path.startsWith('/api/marketing/journeys/3/enrollments')) return { items: [] };
    if (path === '/api/marketing/journeys') return { items: [journey], vocabulary: voc };
    if (path === '/api/marketing/lists') return { items: [{ id: 4, org_id: 1, name: 'Newsletter' }] };
    if (path === '/api/marketing/campaigns') return { items: [{ id: 9, org_id: 1, name: 'Welcome email' }] };
    if (path === '/api/marketing/forms') return { items: [{ id: 5, org_id: 1, name: 'Sign-up', status: 'published', list_name: null, stats: { views: 200, submissions: 9, conversion: 4.5 } }] };
    if (path === '/api/marketing/scores') {
      return { items: [{ id: 1, org_id: 1, kind: 'fit', subject: 'country', subject_label: 'Country', op: 'is', value: 'LK', points: 5, active: true }],
        settings: [{ org_id: 1, mql_threshold: 50, decay_percent: 25 }], vocabulary: { subjects: [], call_outcomes: [] } };
    }
    return { items: [] };
  });
});
afterEach(cleanup);

describe('journeys', () => {
  it('lists them with their figures', async () => {
    const onOpen = vi.fn();
    shown(<Automation org="1" options={options} journeyId={null} onOpen={onOpen} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText('Welcome'));
    expect(onOpen).toHaveBeenCalledWith(3);
    expect(screen.getByText('12.5%')).toBeTruthy();
  });

  it('draws the flow with both paths, adds a step and saves the draft', async () => {
    shown(<Automation org="1" options={options} journeyId={3} onOpen={vi.fn()} onBack={vi.fn()} />);
    expect(await screen.findByText('Welcome email')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'If yes' })).getByText('engaged')).toBeTruthy();
    expect(screen.getByText(/40 in · 2 here · 38 on · 0 out · 1 failed/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add a step after s3' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Wait' }));
    fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
    await waitFor(() => expect(net.request).toHaveBeenCalled());
    const [method, path, opts] = net.request.mock.calls[0] as [string, string, { body: { definition: Definition } }];
    expect([method, path]).toEqual(['PUT', '/api/marketing/journeys/3']);
    expect(opts.body.definition.steps.s3?.next).toBe('s4');
    expect(opts.body.definition.steps.s4?.type).toBe('wait');
  });

  it('takes a branch out with its second path', () => {
    const gone = parts.removeStep(def, 's2');
    expect(gone.steps.s1?.next).toBe('s3');
    expect(gone.steps.s2).toBeUndefined();
  });
});

describe('forms and scoring', () => {
  it('lists forms with their conversion', async () => {
    shown(<Forms org="1" options={options} />);
    expect(await screen.findByText('4.5%')).toBeTruthy();
  });

  it('shows the rules and saves the threshold', async () => {
    shown(<Scoring org="1" options={options} />);
    expect(await screen.findByText('Country is LK')).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('50'), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(net.request).toHaveBeenCalledWith('PUT', '/api/marketing/scores/settings', { body: { org_id: 1, mql_threshold: 70, decay_percent: 25 } }));
  });
});

describe('segment groups (MKT-SEG-07)', () => {
  it('sends a group as the server reads it, and counts only rules', () => {
    const fields = [{ key: 'crm', label: 'In CRM', type: 'none', ops: [{ key: 'yes', label: 'yes', bare: true }], choices: null }] as SegmentField[];
    const drafts = [{ field: 'crm', op: 'yes', value: '' }, { field: '', op: '', value: '', group: 'any' as const, rules: [{ field: 'crm', op: 'yes', value: '' }] }];
    expect(rules.leaves(drafts)).toBe(2);
    expect(rules.rulesOf(drafts, fields)[1]).toEqual({ field: '', op: '', value: null, group: 'any', rules: [{ field: 'crm', op: 'yes', value: null }] });
  });
});
