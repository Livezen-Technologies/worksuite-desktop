// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SidePanel } from '../../../src/components/SidePanel';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('a module side panel can be hidden and shown again', () => {
  it('hides behind a strip with the panel icon, and remembers it', () => {
    const { unmount } = render(
      <SidePanel id="hr" label="the HR menu">
        <nav aria-label="HR">menu</nav>
      </SidePanel>,
    );
    expect(screen.getByRole('navigation', { name: 'HR' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide the HR menu' }));
    expect(screen.queryByRole('navigation', { name: 'HR' })).toBeNull();
    expect(localStorage.getItem('ws.panel.hr')).toBe('0');
    unmount();
    // Opened again later: still hidden, until shown.
    render(
      <SidePanel id="hr" label="the HR menu">
        <nav aria-label="HR">menu</nav>
      </SidePanel>,
    );
    expect(screen.queryByRole('navigation', { name: 'HR' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the HR menu' }));
    expect(screen.getByRole('navigation', { name: 'HR' })).toBeTruthy();
    expect(localStorage.getItem('ws.panel.hr')).toBe('1');
  });

  it('keeps each panel on its own', () => {
    render(
      <>
        <SidePanel id="a" label="A">
          <nav aria-label="A">a</nav>
        </SidePanel>
        <SidePanel id="b" label="B" side="right">
          <aside aria-label="B">b</aside>
        </SidePanel>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hide B' }));
    expect(screen.getByRole('navigation', { name: 'A' })).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'B' })).toBeNull();
  });
});
