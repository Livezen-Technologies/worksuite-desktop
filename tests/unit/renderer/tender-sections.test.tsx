// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Work from '../../../src/modules/tenders/work';

/** Checklist sections: picked from those already there or made new, renamed on every line, or deleted. */
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false, registerDropped: vi.fn() }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<object>()), apiGet: vi.fn(), apiPost: vi.fn(async () => ({ id: 1 })) }));
vi.mock('../../../src/modules/tenders/work', async (orig) => ({ ...(await orig<typeof Work>()), updateLine: vi.fn(async () => ({})), bulkLines: vi.fn(async () => ({})) }));

import { apiGet, apiPost } from '../../../src/core/api';
import { ImportSheet, SectionPicker, SectionSheet } from '../../../src/modules/tenders/Checklist';
import { bulkLines, importPlan, sectionTemplates, updateLine, type Line } from '../../../src/modules/tenders/work';

const line = (id: number, section: string | null, label = `Line ${id}`): Line => ({
  id, section, label, detail: null, mandatory: true, status: 'missing' as Line['status'], owner_id: null, owner_name: null, reviewer_name: null,
  reviewed_at: null, rejection_reason: null, issued_on: null, expires_on: null, note: null, library: false, settled: false, why_not: null, files: [],
});

beforeEach(() => { vi.mocked(updateLine).mockClear(); vi.mocked(bulkLines).mockClear(); });
afterEach(() => cleanup());

function Picker({ start = '', sections }: { start?: string; sections: string[] }) {
  const [v, setV] = useState(start);
  return <><SectionPicker value={v} sections={sections} onChange={setV} /><output>{v}</output></>;
}
const pick = async (text: string) => {
  fireEvent.click(screen.getByRole('combobox', { name: 'Section' }));
  fireEvent.click(await screen.findByRole('option', { name: text }));
};

describe('picking a section', () => {
  it('offers the sections already there, and a new one by name', async () => {
    render(<Picker sections={['A. Bid forms', 'B. Eligibility']} />);
    await pick('B. Eligibility');
    expect(document.querySelector('output')!.textContent).toBe('B. Eligibility');
    await pick('New section…');
    fireEvent.change(screen.getByLabelText('New section name'), { target: { value: 'C. Technical' } });
    expect(document.querySelector('output')!.textContent).toBe('C. Technical');
    fireEvent.click(screen.getByRole('button', { name: 'Pick one' }));
    expect(screen.getByRole('combobox', { name: 'Section' })).toBeTruthy();
  });
});

describe('a section', () => {
  const lines = [line(1, 'A. Bid forms'), line(2, 'A. Bid forms')];

  it('is renamed on every line in it, or merged into one that exists', async () => {
    const done = vi.fn();
    render(<SectionSheet tenderId={40} name="A. Bid forms" mode="rename" lines={lines} taken={['A. Bid forms', 'B. Eligibility']} onClose={done} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Section name'), { target: { value: 'B. Eligibility' } });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(vi.mocked(updateLine).mock.calls).toEqual([[1, { section: 'B. Eligibility' }], [2, { section: 'B. Eligibility' }]]);
  });

  it('is deleted keeping its lines, or with them', async () => {
    const done = vi.fn();
    render(<SectionSheet tenderId={40} name="A. Bid forms" mode="delete" lines={lines} taken={[]} onClose={done} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep the 2 lines, without a section' }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateLine).mock.calls).toEqual([[1, { section: '' }], [2, { section: '' }]]);
    cleanup();
    render(<SectionSheet tenderId={40} name="A. Bid forms" mode="delete" lines={lines} taken={[]} onClose={done} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete the section and its 2 lines' }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(2));
    expect(bulkLines).toHaveBeenCalledWith(40, 'remove', [1, 2]);
  });
});

describe('importing sections from an earlier tender', () => {
  const old = [line(1, 'A. Bid forms', 'Bid form'), line(2, 'B. Eligibility', 'Tax clearance'), line(3, 'A. Bid forms', 'Bid security'), line(4, null, 'Site visit')];

  it('lists its sections once each, and copies the chosen ones in order, skipping lines already here', () => {
    expect(sectionTemplates(old)).toEqual([{ name: 'A. Bid forms', count: 2 }, { name: 'B. Eligibility', count: 1 }, { name: null, count: 1 }]);
    const plan = importPlan(old, ['A. Bid forms', null], [line(9, 'A. Bid forms', ' bid FORM ')]);
    expect(plan.add).toEqual([{ label: 'Bid security', section: 'A. Bid forms', mandatory: true }, { label: 'Site visit', mandatory: true }]);
    expect(plan.skipped).toBe(1);
  });

  it('finds the tender, then adds the lines of the ticked sections', async () => {
    vi.mocked(apiGet).mockImplementation((async (path: string) => {
      if (path === '/api/tenders') return { items: [{ id: 40, title: 'This one' }, { id: 12, title: 'Road works 2025', reference: 'RDA/12' }], total: 2 };
      if (path === '/api/tenders/12/checklist') return { items: old.map((l) => ({ ...l, mandatory: 1 })) };
      throw new Error(path);
    }) as never);
    const saved = vi.fn();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ImportSheet tenderId={40} org="" existing={[]} onClose={vi.fn()} onSaved={saved} /></QueryClientProvider>);
    fireEvent.click(await screen.findByText('Road works 2025'));
    expect(screen.queryByText('This one')).toBeNull();
    fireEvent.click(await screen.findByLabelText('Import B. Eligibility'));
    fireEvent.click(screen.getByRole('button', { name: 'Import 3 lines' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(vi.mocked(apiPost).mock.calls.map((c) => [c[0], (c[1] as { label: string }).label])).toEqual([
      ['/api/tenders/40/checklist', 'Bid form'], ['/api/tenders/40/checklist', 'Bid security'], ['/api/tenders/40/checklist', 'Site visit'],
    ]);
  });
});
