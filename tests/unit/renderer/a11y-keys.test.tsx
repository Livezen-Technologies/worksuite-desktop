// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clickOnKey } from '../../../src/components/press';

/** What the mouse does, the keyboard does (audit D-G21). The lint rule that keeps it so: tests/unit/build/a11y-lint.test.ts. */
afterEach(cleanup);

describe('clickOnKey', () => {
  it('clicks the row on Enter or Space, once, and leaves a key pressed in a control inside it alone', () => {
    const open = vi.fn();
    const tick = vi.fn();
    render(
      <table>
        <tbody>
          <tr data-testid="row" tabIndex={0} onKeyDown={clickOnKey} onClick={open}>
            <td>
              <input aria-label="Tick" type="checkbox" onChange={tick} />
            </td>
          </tr>
        </tbody>
      </table>,
    );
    const row = screen.getByTestId('row');
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    fireEvent.keyDown(row, { key: 'Enter', repeat: true });
    fireEvent.keyDown(row, { key: 'a' });
    expect(open).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByLabelText('Tick'), { key: 'Enter' });
    expect(open).toHaveBeenCalledTimes(2);
  });
});
