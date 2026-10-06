// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), request: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, hasDesktop: () => false, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
const tab = { route: '/marketing/segments/new', go: vi.fn() };
vi.mock('../../../src/core/tab-context', () => ({
  useTab: () => {
    const [path, qs = ''] = tab.route.split('?');
    return { query: new URLSearchParams(qs), path: path!.split('/').filter(Boolean), go: tab.go, navigate: vi.fn(), openInNewTab: vi.fn(), active: true, openLink: vi.fn() };
  },
  useTabTitle: () => undefined,
}));

import { ApiError, apiGet, apiPost, request } from '../../../src/core/api';
import Import from '../../../src/modules/marketing/audience/Import';
import SegmentBuilder from '../../../src/modules/marketing/audience/SegmentBuilder';
import Segments from '../../../src/modules/marketing/audience/Segments';
import { maskPhone } from '../../../src/modules/marketing/lib/format';

/**
 * Marketing · DK04 segment builder, the segment list and DK05 import (WS-MKT-SRS-001 WF-03, WF-04): the editor refuses a
 * 21st rule, counts the complete rules live, and an import refuses a file over 10 MB before anything is sent.
 */
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const answer = <T,>(data: T) => ({ data, offline: false, cachedAt: null });

beforeEach(() => {
  tab.route = '/marketing/segments/new';
  tab.go = vi.fn();
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiPost).mockReset();
  vi.mocked(request).mockReset();
  vi.mocked(apiGet).mockImplementation((async (path: string) => (path.endsWith('/tags') ? ['vendor', 'supplier'] : [])) as never);
  vi.mocked(request).mockResolvedValue(answer({ count: 0, total: 0, sample: [] }) as never);
});

afterEach(() => cleanup());

const removeButtons = () => screen.getAllByRole('button', { name: /^Remove rule \d+$/ });

describe('segment builder (DK04)', () => {
  it('refuses a 21st rule, and takes one again once a rule is removed', () => {
    wrap(<SegmentBuilder id={null} />);
    const add = screen.getByRole('button', { name: 'Add rule' });
    for (let i = 0; i < 19; i++) fireEvent.click(add);
    expect(removeButtons()).toHaveLength(20);
    expect(screen.getByText('20 of 20 rules · 19 fields available')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(add);
    expect(removeButtons()).toHaveLength(20);
    expect(screen.getByRole('alert').textContent).toBe('A segment can have at most 20 rules. Remove one to add another.');

    fireEvent.click(screen.getByRole('button', { name: 'Remove rule 20' }));
    expect(removeButtons()).toHaveLength(19);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(add);
    expect(removeButtons()).toHaveLength(20);
  });

  it('counts only the complete rules, once the editing pauses', async () => {
    vi.mocked(request).mockResolvedValue(
      answer({
        count: 612,
        total: 4812,
        excluded: 9,
        sample: [
          { id: 1, name: 'Nimal Perera', organisation: 'Ceylon Agri Exports', last_open_at: '2026-10-02 08:00:00' },
          { id: 2, name: 'සමන් කුමාර', organisation: 'Lanka Pack' },
        ],
      }) as never,
    );
    wrap(<SegmentBuilder id={null} />);
    expect(screen.getByText('Complete a rule to count who matches.')).toBeTruthy();
    expect(request).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Rule 1 value'), { target: { value: 'vendor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(await screen.findByText('612')).toBeTruthy();
    expect(screen.getByText('12.7% of 4,812 · suppressed contacts are always excluded at send time')).toBeTruthy();
    expect(screen.getByText('9 of them are suppressed or unsubscribed and will not be sent to.')).toBeTruthy();
    expect(screen.getByText('Preview · first 2 of 612')).toBeTruthy();
    expect(screen.getByText('සමන් කුමාර')).toBeTruthy();
    expect(screen.getByText('One rule is not complete yet; it is left out of the count.')).toBeTruthy();

    // One question, with the complete rule only — the empty second rule is left out.
    expect(request).toHaveBeenCalledTimes(1);
    const [method, path, opts] = vi.mocked(request).mock.calls[0]!;
    expect(method).toBe('POST');
    expect(path).toBe('/api/marketing/segments/preview');
    expect((opts as { body: unknown }).body).toEqual({ match: 'all', rules: [{ field: 'tag', op: 'includes', value: 'vendor' }] });
  });

  it('will not save until every rule is complete', () => {
    wrap(<SegmentBuilder id={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save segment' }));
    expect(screen.getByText('Complete or remove the rules marked in red.')).toBeTruthy();
    expect(screen.getByText('Type a value.')).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Save as list' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves a new segment, all or any, and opens it', async () => {
    vi.mocked(apiPost).mockResolvedValue({ id: 15, name: 'Vendors', match: 'any', rules: [{ field: 'tag', op: 'includes', value: 'vendor' }], updated_at: null } as never);
    wrap(<SegmentBuilder id={null} />);
    fireEvent.change(screen.getByLabelText('Segment name'), { target: { value: '  Vendors ' } });
    fireEvent.change(screen.getByLabelText('Rule 1 value'), { target: { value: ' vendor ' } });
    fireEvent.click(screen.getByRole('combobox', { name: 'Match all or any of the rules' }));
    fireEvent.click(screen.getByRole('option', { name: 'any' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save segment' }));
    await waitFor(() => expect(tab.go).toHaveBeenCalledWith('/marketing/segments/15'));
    expect(apiPost).toHaveBeenCalledWith('/api/marketing/segments', { name: 'Vendors', match: 'any', rules: [{ field: 'tag', op: 'includes', value: 'vendor' }] }, {});
  });

  it('opens a saved segment, keeps it once as a list, and says snapshots are planned on this server', async () => {
    const rules = [
      { field: 'tag', op: 'includes', value: 'vendor' },
      { field: 'email_consent', op: 'is', value: 'subscribed' },
      { field: 'last_open_at', op: 'within_last', value: '90' },
      { field: 'country', op: 'is', value: 'Sri Lanka' },
    ];
    vi.mocked(apiGet).mockImplementation((async (path: string) => {
      if (path === '/api/marketing/segments/4') return { id: 4, name: 'Engaged vendors', match: 'all', rules, count: 612, updated_at: '2026-10-01 09:00:00' };
      if (path === '/api/marketing/segments/4/snapshots') throw new ApiError(404, 'The server answered 404.', null);
      return [];
    }) as never);
    vi.mocked(request).mockResolvedValue(answer({ count: 612, total: 4812, sample: [] }) as never);
    wrap(<SegmentBuilder id={4} />);

    expect(((await screen.findByLabelText('Segment name')) as HTMLInputElement).value).toBe('Engaged vendors');
    expect(screen.getByText('4 of 20 rules · 19 fields available')).toBeTruthy();
    expect(await screen.findByText('Planned · scheduled segment → list')).toBeTruthy();
    expect(await screen.findByText('612')).toBeTruthy();
    expect((request as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![2]).toMatchObject({ body: { match: 'all', rules } });

    const asList = screen.getByRole('button', { name: 'Save as list' }) as HTMLButtonElement;
    expect(asList.disabled).toBe(false);
    fireEvent.click(asList);
    const dialog = await screen.findByRole('dialog');
    const listName = within(dialog).getByLabelText('List name') as HTMLInputElement;
    expect(listName.value).toMatch(/^Engaged vendors · /);
    fireEvent.change(listName, { target: { value: 'Engaged vendors Oct' } });
    vi.mocked(apiPost).mockResolvedValue({ id: 12, name: 'Engaged vendors Oct', description: null, members_count: 612, created_at: null } as never);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as list' }));
    expect(await screen.findByText(/Saved 612 contacts as the list/)).toBeTruthy();
    expect(apiPost).toHaveBeenCalledWith('/api/marketing/segments/4/to-list', { name: 'Engaged vendors Oct' });
    fireEvent.click(screen.getByRole('button', { name: 'Open list' }));
    expect(tab.go).toHaveBeenCalledWith('/marketing/lists/12');

    // Edited and not saved, the list would not be what is on screen.
    fireEvent.change(screen.getByLabelText('Segment name'), { target: { value: 'Engaged vendors 2026' } });
    expect((screen.getByRole('button', { name: 'Save as list' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says plainly when a segment is not there', async () => {
    vi.mocked(apiGet).mockRejectedValue(new ApiError(404, 'No query results for model [Segment] 99.', null));
    wrap(<SegmentBuilder id={99} />);
    expect(await screen.findByText('This segment isn’t here')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All segments' }));
    expect(tab.go).toHaveBeenCalledWith('/marketing/segments');
  });
});

describe('segments list', () => {
  it('lists each segment with its rules and opens it', async () => {
    vi.mocked(apiGet).mockImplementation((async (path: string) =>
      path === '/api/marketing/segments'
        ? [
            {
              id: 4,
              name: 'Engaged vendors',
              match: 'all',
              rules: [
                { field: 'tag', op: 'includes', value: 'vendor' },
                { field: 'email_consent', op: 'is', value: 'subscribed' },
                { field: 'last_open_at', op: 'within_last', value: '90' },
              ],
              count: 612,
              last_used_at: null,
              updated_at: '2026-10-01 09:00:00',
            },
          ]
        : []) as never);
    wrap(<Segments />);
    expect(await screen.findByRole('button', { name: 'Engaged vendors' })).toBeTruthy();
    expect(screen.getByText('Saved rule sets, re-evaluated every time they are used')).toBeTruthy();
    expect(screen.getByText('3 · all')).toBeTruthy();
    expect(screen.getByText('612')).toBeTruthy();
    expect(screen.getByText('Tag includes vendor · Email consent is subscribed · +1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Engaged vendors' }));
    expect(tab.go).toHaveBeenCalledWith('/marketing/segments/4');
  });
});

describe('import (DK05)', () => {
  it('refuses an 11 MB file before anything is sent', async () => {
    tab.route = '/marketing/import';
    wrap(<Import />);
    const file = new File(['email\nnimal@ceylonagri.lk\n'], 'vendors-oct.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [file] } });

    expect(await screen.findByText(/“vendors-oct\.csv” is 11\.0 MB; the limit is 10 MB\..*Nothing was sent\./)).toBeTruthy();
    expect(screen.getByText('vendors-oct.csv · 11.0 MB (limit 10 MB / 10,000 rows)')).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('walks a file from upload to the report, and asks for consent when the file has no consent column', async () => {
    tab.route = '/marketing/import';
    const upload = {
      id: 7,
      file: 'vendors-oct.csv',
      size: 120,
      rows: 2,
      headers: ['Name', 'E-mail', 'Mobile'],
      sample: [
        ['Nimal Perera', 'nimal@ceylonagri.lk', '0771234521'],
        ['සමන් කුමාර', '', '0719876543'],
      ],
      mapping: {},
      has_consent_column: false,
    };
    vi.mocked(request).mockResolvedValue(answer(upload) as never);
    vi.mocked(apiGet).mockImplementation((async (path: string) => (path === '/api/marketing/lists' ? [{ id: 3, name: 'Vendors 2026', description: null, members_count: 120, created_at: null }] : [])) as never);
    vi.mocked(apiPost).mockImplementation((async (path: string) => {
      if (path === '/api/marketing/imports/7/preview')
        return {
          new: 1,
          updated: 1,
          duplicates_in_file: 0,
          rejected: 0,
          has_consent_column: false,
          rows: [
            { row: 2, name: 'Nimal Perera', email: 'nimal@ceylonagri.lk', phone: '0771234521', match: 'email_key', result: 'update' },
            { row: 3, name: 'සමන් කුමාර', email: null, phone: '0719876543', match: null, result: 'new' },
          ],
        };
      if (path === '/api/marketing/imports/7/commit') return { id: 7, status: 'done', progress: 100, created: 1, updated: 1, merged: 0, rejected: 0 };
      throw new Error(`Unexpected ${path}`);
    }) as never);

    wrap(<Import />);
    const csv = 'Name,E-mail,Mobile\r\nNimal Perera,nimal@ceylonagri.lk,0771234521\r\nසමන් කුමාර,,0719876543\r\n';
    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [new File([csv], 'vendors-oct.csv', { type: 'text/csv' })] } });

    // 2 · Map columns, suggested from the headers; the file went up once.
    expect(await screen.findByRole('table', { name: 'Column mapping' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Maps to · E-mail' }).textContent).toBe('Email');
    expect(screen.getByRole('combobox', { name: 'Maps to · Mobile' }).textContent).toBe('Phone');
    expect(screen.getByText(`vendors-oct.csv · 2 rows · ${new TextEncoder().encode(csv).length} B (limit 10 MB / 10,000 rows)`)).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
    const [method, path, opts] = vi.mocked(request).mock.calls[0]!;
    expect([method, path]).toEqual(['POST', '/api/marketing/imports']);
    expect(((opts as { body: FormData }).body.get('file') as File).name).toBe('vendors-oct.csv');

    // 3 · Preview: nothing written yet, and the missing consent column said plainly.
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Will be created')).toBeTruthy();
    expect(apiPost).toHaveBeenCalledWith('/api/marketing/imports/7/preview', { mapping: { Name: 'name', 'E-mail': 'email', Mobile: 'phone' } });
    expect(screen.getByText(/excluded from sends and call queues until consent is recorded/)).toBeTruthy();
    expect(screen.getByText('email_key')).toBeTruthy();
    expect(screen.getByText(maskPhone('0719876543'))).toBeTruthy();
    expect(screen.queryByText('0719876543')).toBeNull();

    // 4 · Consent & lists: no import until each channel is decided.
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const importButton = (await screen.findByRole('button', { name: 'Import' })) as HTMLButtonElement;
    expect(importButton.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Leave email consent unknown/));
    expect(importButton.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Leave phone consent unknown/));
    expect(importButton.disabled).toBe(false);
    fireEvent.click(await screen.findByLabelText(/Vendors 2026/));
    fireEvent.change(screen.getByLabelText(/^Tags/), { target: { value: 'vendor, oct-2026' } });
    fireEvent.click(importButton);

    // 5 · Import: the report.
    expect(await screen.findByText('Suppressed people stay suppressed even if they appear in a new file.')).toBeTruthy();
    expect(apiPost).toHaveBeenCalledWith('/api/marketing/imports/7/commit', {
      mapping: { Name: 'name', 'E-mail': 'email', Mobile: 'phone' },
      consent: { email: { state: 'unknown', basis: 'unknown' }, phone: { state: 'unknown', basis: 'unknown' } },
      list_ids: [3],
      new_list: null,
      tags: ['vendor', 'oct-2026'],
    });
    expect(screen.getByRole('button', { name: 'Open contacts' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import another file' })).toBeTruthy();
  });
});
