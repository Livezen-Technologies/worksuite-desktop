// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isEmptyStat, STAT_TONES, StatCard, StatGrid } from '../../../src/components/StatCard';

afterEach(cleanup);

const css = readFileSync(join(__dirname, '../../../src/styles.css'), 'utf8');

describe('StatCard, the one stat card every module draws its figures with', () => {
  it('is a group named by its label, the figure and the line under it inside, with the icon in a tinted chip', () => {
    render(<StatCard label="Open deals" value={86} sub="LKR 155M" icon="handshake" tone="blue" />);
    const card = screen.getByRole('group', { name: 'Open deals' });
    expect(card.getAttribute('data-tone')).toBe('blue');
    expect(card.getAttribute('data-stat')).toBe('');
    const value = card.querySelector('[data-stat-value]')!;
    expect(value.textContent).toBe('86');
    expect(value.classList.contains('stat-number')).toBe(true);
    // The figure stays in the text colour: the tone is the chip's, never the number's.
    expect(value.className).toContain('text-ink');
    expect(value.className).not.toMatch(/text-(primary|danger|success|warning)/);
    expect(card.getAttribute('aria-describedby')).toBe(card.querySelector('[data-stat-sub]')!.id);
    expect(within(card).getByText('LKR 155M')).toBeTruthy();
    const chip = card.querySelector('[data-stat-chip]')!;
    expect(chip.getAttribute('aria-hidden')).toBe('true');
    expect(chip.querySelector('svg')).toBeTruthy();
  });

  it('is compact: 16px padding, a 96px floor, 12px round, a 1px border on the surface, no thick bar', () => {
    render(<StatCard label="Win rate" value="75%" />);
    const cls = screen.getByRole('group', { name: 'Win rate' }).className.split(' ');
    expect(cls).toEqual(expect.arrayContaining(['p-4', 'min-h-[96px]', 'rounded-[12px]', 'border', 'border-line', 'bg-surface']));
    expect(cls.some((c) => /^border-[lst]-\[?\d/.test(c) || c === 'border-l-4')).toBe(false);
  });

  it('draws a zero, a dash or nothing muted', () => {
    const { rerender } = render(<StatCard label="Tasks due today" value={0} sub="from the Tasks module" />);
    const card = () => screen.getByRole('group', { name: 'Tasks due today' });
    expect(card().hasAttribute('data-empty')).toBe(true);
    expect(card().querySelector('[data-stat-value]')!.className).toContain('text-ink-3');
    rerender(<StatCard label="Tasks due today" value={3} />);
    expect(card().hasAttribute('data-empty')).toBe(false);
    rerender(<StatCard label="Tasks due today" value={5} empty />);
    expect(card().hasAttribute('data-empty')).toBe(true);
    expect([0, '0', 'LKR 0', 'LKR 0.00', '0%', '—', '-', '', null, undefined].every(isEmptyStat)).toBe(true);
    expect([1, '86', 'LKR 54M', '0.5%', '10 / 0', 'Later'].some(isEmptyStat)).toBe(false);
  });

  it('a card that leads somewhere is a button named by its label and figure, with the focus ring', () => {
    const onClick = vi.fn();
    render(<StatCard label="Stalled deals" value={8} sub="no stage change in 14 days" tone="red" icon="hourglass" onClick={onClick} />);
    const btn = screen.getByRole('button', { name: 'Stalled deals 8' });
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.className).toContain('ws-stat-action');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
    expect(css).toMatch(/\.ws-stat-action:focus-visible \{\s*outline: 2px solid var\(--ws-focus\);/);
    // The lift is a pixel, and none at all when reduced motion is asked for.
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.ws-stat-action:hover:not\(:disabled\) \{\s*transform: translateY\(-1px\);/);
  });

  it('a card with href is a link; ariaLabel names it in place of label and figure', () => {
    render(<StatCard label="Unread" value="99+" href="#/mail" ariaLabel="Unread messages: 123" />);
    const link = screen.getByRole('link', { name: 'Unread messages: 123' });
    expect(link.getAttribute('href')).toBe('#/mail');
  });

  it('a trend pill says which way and whether it is good news, in words and an arrow as well as colour', () => {
    const { rerender } = render(<StatCard label="Revenue" value="LKR 5.4M" trend={{ direction: 'up', text: '+12.5%', label: 'vs last month' }} />);
    let pill = screen.getByText('+12.5%').closest('[data-stat-trend]')!;
    expect(pill.getAttribute('data-stat-trend')).toBe('up');
    expect(pill.className).toContain('is-good');
    expect(pill.textContent).toContain('Up');
    expect(pill.textContent).toContain('vs last month');
    expect(pill.querySelector('svg')).toBeTruthy();
    // A cost going up is bad news: the same arrow, said to be bad.
    rerender(<StatCard label="Expenses" value="LKR 3.6M" trend={{ direction: 'up', text: '+20.0%', good: false }} />);
    pill = screen.getByText('+20.0%').closest('[data-stat-trend]')!;
    expect(pill.className).toContain('is-bad');
    rerender(<StatCard label="Expenses" value="LKR 3.6M" trend={{ direction: 'down', text: '-4.0%' }} />);
    pill = screen.getByText('-4.0%').closest('[data-stat-trend]')!;
    expect(pill.className).toContain('is-bad');
    expect(pill.textContent).toContain('Down');
    rerender(<StatCard label="Expenses" value="LKR 3.6M" trend={{ direction: 'flat', text: '0.0%' }} />);
    pill = screen.getByText('0.0%').closest('[data-stat-trend]')!;
    expect(pill.className).toContain('is-flat');
    expect(pill.textContent).toContain('No change');
  });

  it('has a slot for a sparkline, hidden from screen readers', () => {
    render(<StatCard label="Reach" value="12k" sparkline={<svg data-testid="spark" />} />);
    const slot = screen.getByTestId('spark').closest('[data-stat-sparkline]')!;
    expect(slot.getAttribute('aria-hidden')).toBe('true');
  });

  it('while loading, keeps its label and shows a skeleton in place of the figure', () => {
    render(<StatCard label="Open deals" value={86} sub="LKR 155M" loading />);
    const card = screen.getByRole('group', { name: 'Open deals' });
    expect(card.getAttribute('aria-busy')).toBe('true');
    expect(card.querySelector('[data-stat-value]')).toBeNull();
    expect(card.querySelectorAll('.ws-skeleton')).toHaveLength(2);
    expect(card.textContent).not.toContain('86');
    expect(css).toMatch(/\.ws-skeleton \{\s*background: var\(--ws-subtle\);/);
  });

  it('passes data attributes, a title and a role through', () => {
    render(
      <ul>
        <StatCard role="listitem" label="Waiting" value={2} title="Chats waiting on us" data-kpi="Waiting" />
      </ul>,
    );
    const item = screen.getByRole('listitem', { name: 'Waiting' });
    expect(item.getAttribute('data-kpi')).toBe('Waiting');
    expect(item.getAttribute('title')).toBe('Chats waiting on us');
  });

  it('has a light and a dark colour for every tone', () => {
    const light = css.slice(css.indexOf(':root {'), css.indexOf("[data-theme='dark'] {"));
    const dark = css.slice(css.indexOf("[data-theme='dark'] {"));
    for (const tone of STAT_TONES) {
      expect(light).toContain(`--ws-tone-${tone}:`);
      expect(dark.slice(0, dark.indexOf('}'))).toContain(`--ws-tone-${tone}:`);
      if (tone !== 'neutral') expect(css).toContain(`.ws-stat[data-tone='${tone}']`);
    }
  });
});

describe('StatGrid', () => {
  it('lays cards out auto-fill at 220px or wider, 12px apart, as a named region, and takes a narrower floor', () => {
    const { rerender } = render(
      <StatGrid label="Pipeline figures">
        <StatCard label="A" value={1} />
      </StatGrid>,
    );
    const grid = screen.getByRole('region', { name: 'Pipeline figures' });
    expect(grid.tagName).toBe('SECTION');
    expect(grid.className.split(' ')).toEqual(expect.arrayContaining(['ws-stat-grid', 'grid', 'gap-3']));
    expect(grid.style.getPropertyValue('--stat-min')).toBe('');
    expect(css).toMatch(/\.ws-stat-grid \{\s*grid-template-columns: repeat\(auto-fill, minmax\(min\(var\(--stat-min, 220px\), 100%\), 1fr\)\);/);
    rerender(
      <StatGrid label="Pipeline figures" min={160} role="list">
        <StatCard label="A" value={1} role="listitem" />
      </StatGrid>,
    );
    const list = screen.getByRole('list', { name: 'Pipeline figures' });
    expect(list.style.getPropertyValue('--stat-min')).toBe('160px');
  });
});
