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

  // worksuite-desktop#155: the handle never sits over the content — it shows on hover over the panel, or keyboard focus.
  it('shows its hide handle only while the panel is hovered or the handle is focused', () => {
    render(
      <SidePanel id="chat" label="the conversations">
        <aside aria-label="List">list</aside>
      </SidePanel>,
    );
    const handle = screen.getByRole('button', { name: 'Hide the conversations' });
    const classes = handle.className.split(/\s+/);
    expect(classes).toContain('opacity-0');
    expect(classes).toContain('group-hover/panel:opacity-100');
    expect(classes).toContain('focus-visible:opacity-100');
    expect(classes.some((c) => /^opacity-(?!0$)\d+$/.test(c))).toBe(false);
    expect(handle.closest('[data-side-panel]')?.className).toContain('group/panel');
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
