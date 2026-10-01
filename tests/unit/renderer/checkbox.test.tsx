// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRef, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Checkbox } from '../../../src/components/Checkbox';

afterEach(() => cleanup());

describe('Checkbox (issue #58)', () => {
  it('is a native, labelled checkbox that toggles', () => {
    const onChange = vi.fn();
    render(
      <label>
        <Checkbox checked={false} onChange={(e) => onChange(e.target.checked)} /> Overdue only
      </label>,
    );
    const box = screen.getByRole('checkbox', { name: 'Overdue only' }) as HTMLInputElement;
    expect(box.type).toBe('checkbox');
    expect(box.className).toContain('ws-checkbox');
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('shows "some chosen" as indeterminate, and keeps it after a click', () => {
    function SelectAll() {
      const [picked, setPicked] = useState(1);
      return <Checkbox aria-label="Select all" checked={picked === 3} indeterminate={picked > 0 && picked < 3} onChange={(e) => setPicked(e.target.checked ? 3 : 0)} />;
    }
    render(<SelectAll />);
    const box = screen.getByRole('checkbox', { name: 'Select all' }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    fireEvent.click(box);
    expect(box.checked).toBe(true);
    expect(box.indeterminate).toBe(false);
    fireEvent.click(box);
    expect(box.checked).toBe(false);
    expect(box.indeterminate).toBe(false);
  });

  it('marks a validation error and passes refs through', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Checkbox ref={ref} aria-label="I accept" invalid checked={false} onChange={() => undefined} />);
    expect(screen.getByRole('checkbox', { name: 'I accept' }).getAttribute('aria-invalid')).toBe('true');
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('does not let a click or Space reach the row, so the row does not open', () => {
    const openRow = vi.fn();
    const onCheck = vi.fn();
    render(
      <div role="row" onClick={openRow} onDoubleClick={openRow} onKeyDown={openRow}>
        <Checkbox aria-label="Select report.pdf" checked={false} onChange={onCheck} />
      </div>,
    );
    const box = screen.getByRole('checkbox', { name: 'Select report.pdf' });
    fireEvent.click(box);
    fireEvent.doubleClick(box);
    fireEvent.keyDown(box, { key: ' ' });
    expect(onCheck).toHaveBeenCalled();
    expect(openRow).not.toHaveBeenCalled();
  });

  it('stays disabled when asked', () => {
    render(<Checkbox aria-label="TLS" disabled checked onChange={() => undefined} />);
    expect((screen.getByRole('checkbox', { name: 'TLS' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('is the only checkbox in the app: no screen draws a bare one', () => {
    const src = join(__dirname, '../../../src');
    const bare: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.tsx') && !p.endsWith('Checkbox.tsx') && /type=(?:"checkbox"|\{[^}]*'checkbox')/.test(readFileSync(p, 'utf8'))) bare.push(p);
      }
    };
    walk(src);
    expect(bare).toEqual([]);
  });
});
