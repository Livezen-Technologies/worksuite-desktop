// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { lookOf, matches, optionsFromChildren, Select } from '../../../src/components/Select';

afterEach(() => cleanup());

describe('the one dropdown: reading options', () => {
  it('reads <option> and <optgroup> children, as a native select would', () => {
    const who = [
      { id: 1, name: 'Nuwan' },
      { id: 2, name: 'Gayani' },
    ];
    const opts = optionsFromChildren(
      <>
        <option value="">Choose someone…</option>
        {who.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.id}
          </option>
        ))}
        <optgroup label="Archived">
          <option value="9" disabled>
            Old
          </option>
        </optgroup>
        {false}
      </>,
    );
    expect(opts.map((o) => [o.value, o.label, o.group ?? null, !!o.disabled])).toEqual([
      ['', 'Choose someone…', null, false],
      ['1', 'Nuwan · 1', null, false],
      ['2', 'Gayani · 2', null, false],
      ['9', 'Old', 'Archived', true],
    ]);
  });

  it('searches without caring about case or accents', () => {
    expect(matches({ value: 1, label: 'Ranasinghé' }, 'ranasinghe')).toBe(true);
    expect(matches({ value: 1, label: 'Casual', hint: 'CA · 7 days' }, '7 days')).toBe(true);
    expect(matches({ value: 1, label: 'Casual' }, 'annual')).toBe(false);
  });

  it('keeps a caller\'s layout but not its colours', () => {
    expect(lookOf('h-7 rounded-[6px] border border-line bg-surface px-1 text-[12.5px] mr-1')).toEqual({ size: 'sm', dark: false, active: false, layout: 'mr-1' });
    expect(lookOf('h-[34px] w-full rounded-[8px] border px-2 !w-auto')).toMatchObject({ size: 'md', layout: 'w-full !w-auto' });
    expect(lookOf('h-8 bg-[#16254F] text-white max-w-[260px]')).toMatchObject({ size: 'sm', dark: true, layout: 'max-w-[260px]' });
    expect(lookOf('border-primary bg-selection text-primary')).toMatchObject({ active: true });
  });
});

function Harness({ n = 3 }: { n?: number }) {
  const [v, setV] = useState('');
  return (
    <>
      <Select aria-label="Person" value={v} onChange={(e) => setV(e.target.value)}>
        <option value="">Choose someone…</option>
        {Array.from({ length: n }, (_, i) => (
          <option key={i} value={`p${i}`}>
            {['Nuwan Silva', 'Gayani Fonseka', 'Kasun Dias', 'Sahan Jayasuriya', 'Malith Gunasekara', 'Imesha Abeysekara', 'Dilshan Ranasinghe', 'Chamari Wijesinghe'][i]}
          </option>
        ))}
      </Select>
      <output>{v}</output>
    </>
  );
}

describe('the one dropdown: using it', () => {
  it('opens a list, marks the chosen option, and hands back the value like a native select', () => {
    render(<Harness />);
    const box = screen.getByRole('combobox', { name: 'Person' });
    expect(box.textContent).toContain('Choose someone…');
    fireEvent.click(box);
    expect(screen.getByRole('listbox', { name: 'Person' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull(); // short lists have no search box
    fireEvent.click(screen.getByRole('option', { name: 'Gayani Fonseka' }));
    expect(document.querySelector('output')!.textContent).toBe('p1');
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(box);
    expect(screen.getByRole('option', { name: 'Gayani Fonseka' }).getAttribute('aria-selected')).toBe('true');
  });

  it('is driven by the keyboard: arrows, Enter, Escape', () => {
    render(<Harness />);
    const box = screen.getByRole('combobox', { name: 'Person' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(document.querySelector('output')!.textContent).toBe('p1');
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('output')!.textContent).toBe('p1');
  });

  it('type-ahead picks an option in a short list without opening it', () => {
    render(<Harness />);
    const box = screen.getByRole('combobox', { name: 'Person' });
    fireEvent.keyDown(box, { key: 'k' });
    expect(document.querySelector('output')!.textContent).toBe('p2');
  });

  it('long lists get a search box that filters as you type', async () => {
    render(<Harness n={8} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Person' }));
    const search = screen.getByRole('textbox', { name: 'Search Person' });
    await act(async () => {
      fireEvent.change(search, { target: { value: 'singhe' } });
    });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Dilshan Ranasinghe', 'Chamari Wijesinghe']);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(document.querySelector('output')!.textContent).toBe('p6');
    fireEvent.click(screen.getByRole('combobox', { name: 'Person' }));
    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: 'Search Person' }), { target: { value: 'zzz' } });
    });
    expect(screen.getByText('Nothing matches “zzz”.')).toBeTruthy();
  });

  it('typed options hand back the typed value', () => {
    let got: number | null = null;
    render(<Select aria-label="Days" value={7} options={[{ value: 7, label: 'Last 7 days' }, { value: 30, label: 'Last 30 days' }]} onValueChange={(v) => (got = v)} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Days' }));
    fireEvent.click(screen.getByRole('option', { name: 'Last 30 days' }));
    expect(got).toBe(30);
  });
});
