// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

/**
 * worksuite-desktop#244: Website chats › Widget settings' sections drew on top of each other, their bodies showing
 * through. The cards sat straight in a scrolling flex column and Card is `min-h-0`, so each was squeezed to its header
 * while its body spilled over the next. Now each is a CollapsibleSection: an ordinary block that never shrinks, whose
 * closed body is `hidden` and `inert` (not seen, clicked or read), with a summary in its header, open state remembered
 * per person, and no animation under reduced motion.
 */
vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPut: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => undefined), on: () => () => undefined, errorMessage: (e: unknown) => String(e), isMac: false, hasDesktop: () => false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));
vi.mock('../../../src/core/tab-context', () => ({ useTab: () => ({ query: new URLSearchParams(), path: ['chat'], go: vi.fn(), active: true }), useTabTitle: () => undefined }));

import { apiGet } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { CollapsibleSection, recallSection, rememberSection } from '../../../src/components/Collapsible';
import type { DesignPayload, WidgetDesign, WidgetRow } from '../../../src/modules/chat/website/widget/design';
import { appearanceSummaries, WidgetSettings } from '../../../src/modules/chat/website/widget/WidgetSettings';

const ROW: WidgetRow = { id: 1, name: 'Techubiz support', website_name: 'Techubiz', status: 'active', allowed_domains: 'techubiz.com', brand_color: '#273498' } as WidgetRow;

const design = (extra: Partial<WidgetDesign> = {}): WidgetDesign => ({
  name: 'Techubiz support', header_title: 'Techubiz support', welcome_message: 'Hi! How can we help?', accent_color: '#2F9E67', border_radius: 16, auto_open_delay: 0,
  website_name: 'Techubiz', brand_color: '#273498', logo_url: null, greeting: null, header_subtitle: null, quick_links: [],
  staff_display: 'name_role', show_agents: true, offline_message: null, whatsapp_number: null,
  launcher_style: 'bubble', position: 'bottom_right', greeting_delay: 0, greeting_text: null, theme: 'light',
  launcher_offset_bottom: 20, launcher_offset_right: 20, launcher_offset_left: 20, ...extra,
});

let payload: DesignPayload;

/** What the computer says about motion: 'reduce', 'no-preference', or nothing to ask (no matchMedia). */
function motion(pref: 'reduce' | 'no-preference' | null) {
  if (pref === null) {
    // @ts-expect-error -- jsdom without matchMedia, as most of the suite runs
    delete window.matchMedia;
    return;
  }
  window.matchMedia = ((q: string) => ({ matches: q === `(prefers-reduced-motion: ${pref})`, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as never;
}

beforeEach(() => {
  localStorage.clear();
  motion(null);
  app.set({ auth: { user: { id: 'u-1' } } as never });
  payload = {
    widget: { id: 1, name: 'Techubiz support', widget_key: 'KEY1', status: 'active', domain: 'techubiz.com' },
    design: design(),
    starters: [],
    agents: [], preview_agents: [], away: null, hours: null, reply_time: null, installed: true, can_manage: true,
  } as DesignPayload;
  vi.mocked(apiGet).mockReset().mockImplementation((async (path: string) => {
    if (path === '/api/chat/widget-admin/widgets') return { widgets: [ROW], can: { view: true, reply: true, manage: true } };
    if (/\/widgets\/\d+\/design$/.test(path)) return payload;
    if (/\/widgets\/\d+\/hours$/.test(path)) return { hours: [] };
    throw new Error(`unexpected ${path}`);
  }) as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  app.set({ auth: null });
});

const wrap = (ui: ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

function Sample({ persist, forceOpen, defaultOpen }: { persist?: string; forceOpen?: boolean; defaultOpen?: boolean }) {
  return (
    <CollapsibleSection title="Logo and theme" summary="Indigo · light" persist={persist} forceOpen={forceOpen} defaultOpen={defaultOpen} data-testid="sample">
      <label>
        Logo
        <input />
      </label>
      <button type="button">Inside</button>
    </CollapsibleSection>
  );
}

const header = () => screen.getByRole('button', { name: 'Logo and theme' });
const body = () => document.getElementById(header().getAttribute('aria-controls')!)!;

describe('CollapsibleSection', () => {
  it('is a heading over a button that says whether it is open and which body it controls', () => {
    render(<Sample />);
    const b = header();
    expect(b.tagName).toBe('BUTTON');
    expect(b.getAttribute('type')).toBe('button');
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(body()).toBeTruthy();
    expect(body().getAttribute('role')).toBe('region');
    expect(screen.getByRole('heading', { name: 'Logo and theme' }).contains(b)).toBe(true);
    // Open: the body is in the layout and read; the summary is not needed.
    expect(body().hidden).toBe(false);
    expect(body().hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('button', { name: 'Inside' })).toBeTruthy();
    expect(screen.queryByText('Indigo · light')).toBeNull();
  });

  it('closed, the body is hidden and inert — not shown, clicked or read — and the header sums it up', () => {
    render(<Sample />);
    fireEvent.click(header());
    expect(header().getAttribute('aria-expanded')).toBe('false');
    expect(body().hidden).toBe(true);
    expect(body().hasAttribute('inert')).toBe(true);
    expect(body().style.visibility).toBe('hidden');
    // Out of the accessibility tree.
    expect(screen.queryByRole('button', { name: 'Inside' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Logo' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Logo and theme' })).toBeNull();
    // The summary, tied to the button as its description.
    const summary = screen.getByText('Indigo · light');
    expect(header().getAttribute('aria-describedby')).toBe(summary.id);
    // And back.
    fireEvent.click(header());
    expect(body().hidden).toBe(false);
    expect(screen.getByRole('button', { name: 'Inside' })).toBeTruthy();
  });

  it('is used from the keyboard as any button is: it takes focus, and nothing inside a closed body does', () => {
    render(<Sample defaultOpen={false} />);
    header().focus();
    expect(document.activeElement).toBe(header());
    expect(body().hidden).toBe(true);
    expect(body().hasAttribute('inert')).toBe(true);
  });

  it('remembers which sections a person left open, per person', () => {
    const first = render(<Sample persist="test.logo" />);
    fireEvent.click(header());
    expect(recallSection('u-1', 'test.logo')).toBe(false);
    first.unmount();

    render(<Sample persist="test.logo" />);
    expect(header().getAttribute('aria-expanded')).toBe('false');
    expect(body().hidden).toBe(true);
    cleanup();

    // Somebody else on this computer has their own.
    app.set({ auth: { user: { id: 'u-2' } } as never });
    render(<Sample persist="test.logo" />);
    expect(header().getAttribute('aria-expanded')).toBe('true');
    cleanup();

    // Several can be open at once.
    app.set({ auth: { user: { id: 'u-1' } } as never });
    render(
      <>
        <CollapsibleSection title="One" persist="test.one">a</CollapsibleSection>
        <CollapsibleSection title="Two" persist="test.two">b</CollapsibleSection>
      </>,
    );
    expect(screen.getByRole('button', { name: 'One' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Two' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('opens by itself when something inside needs attention', () => {
    const r = render(<Sample defaultOpen={false} />);
    expect(body().hidden).toBe(true);
    r.rerender(<Sample defaultOpen={false} forceOpen />);
    expect(header().getAttribute('aria-expanded')).toBe('true');
    expect(body().hidden).toBe(false);
  });

  it('animates its grid row 0fr → 1fr, and is inert at once while it closes', () => {
    vi.useFakeTimers();
    motion('no-preference');
    render(<Sample />);
    expect(body().style.gridTemplateRows).toBe('1fr');
    expect(body().firstElementChild!.className).toContain('overflow-hidden');
    fireEvent.click(header());
    // Closing: still drawn, shrinking, but already out of reach.
    expect(body().hidden).toBe(false);
    expect(body().style.gridTemplateRows).toBe('0fr');
    expect(body().hasAttribute('inert')).toBe(true);
    fireEvent.transitionEnd(body());
    expect(body().hidden).toBe(true);

    // Opening: in the layout at 0fr, then 1fr on a later frame.
    fireEvent.click(header());
    expect(body().hidden).toBe(false);
    expect(body().style.gridTemplateRows).toBe('0fr');
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(body().style.gridTemplateRows).toBe('1fr');

    // Without a transitionend, the close still finishes.
    fireEvent.click(header());
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(body().hidden).toBe(true);
  });

  it('does not animate under reduced motion', () => {
    motion('reduce');
    render(<Sample />);
    fireEvent.click(header());
    expect(body().hidden).toBe(true);
    fireEvent.click(header());
    expect(body().hidden).toBe(false);
    expect(body().style.gridTemplateRows).toBe('1fr');
    expect(body().className).toContain('motion-reduce:transition-none');
  });
});

describe('Website chats › Widget settings › Appearance (#244)', () => {
  const mount = async () => {
    wrap(<WidgetSettings onList={vi.fn()} />);
    await screen.findByTestId('widget-preview');
  };
  const SECTIONS = ['Logo and theme', 'Home screen', 'Away screen', 'Launcher', 'Team photos'];

  it('sets the sections out one under another in the flow: a flex column with a gap, nothing positioned or squeezed', async () => {
    await mount();
    const column = screen.getByTestId('appearance-sections');
    expect(column.className).toMatch(/\bflex\b/);
    expect(column.className).toMatch(/\bflex-col\b/);
    expect(column.className).toMatch(/\bgap-3\b/);
    for (const name of SECTIONS) {
      const section = screen.getByRole('button', { name }).closest('section')!;
      expect(section.parentElement).toBe(column);
      expect(section.className).toContain('shrink-0');
      expect(section.className).not.toContain('min-h-0');
    }
    // Nothing in the form column or the preview's bar is laid over anything else.
    expect(column.querySelector('.absolute')).toBeNull();
    expect(column.querySelector('[class*="-mt-"]')).toBeNull();
    const preview = screen.getByTestId('appearance-preview');
    expect(preview.className).not.toContain('absolute');
    expect(preview.firstElementChild!.className).not.toContain('absolute');
    // The design's two cards keep their height too, and go to one column when narrow.
    for (const grid of Array.from(column.children).slice(0, 2)) {
      expect(grid.className).toContain('shrink-0');
      expect(grid.className).toContain('grid-cols-1');
      expect(grid.className).toContain('@lg:grid-cols-2');
    }
    // Narrow, the preview goes under the form; wide, beside it.
    expect(screen.getByTestId('appearance-layout').className).toContain('@4xl:flex-row');
  });

  it('folds a section away entirely, says in its header what it holds, and keeps it folded next time', async () => {
    await mount();
    const launcher = screen.getByRole('button', { name: 'Launcher' });
    expect(screen.getByRole('spinbutton', { name: /Greeting card after \(seconds\)/ })).toBeTruthy();
    fireEvent.click(launcher);
    expect(launcher.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('spinbutton', { name: /Greeting card after \(seconds\)/ })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: /From the bottom \(px\)/ })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Greeting card message' })).toBeNull();
    expect(document.getElementById(launcher.getAttribute('aria-controls')!)!.hidden).toBe(true);
    expect(within(launcher).getByText('20 px up · 20 px from the right · No greeting card')).toBeTruthy();

    for (const name of ['Logo and theme', 'Home screen', 'Away screen', 'Team photos']) fireEvent.click(screen.getByRole('button', { name }));
    expect(within(screen.getByRole('button', { name: 'Logo and theme' })).getByText('No logo · Light')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: 'Home screen' })).getByText('Standard greeting · No links')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: 'Away screen' })).getByText('No WhatsApp number')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: 'Team photos' })).getByText('Photos shown · Name and role')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Greeting' })).toBeNull();
    for (const field of ['https://example.com/logo.png', '+94 77 123 4567']) {
      expect(screen.getByPlaceholderText(field).closest('[hidden]')).toBeTruthy();
      expect(screen.getByPlaceholderText(field).closest('[inert]')).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: 'Add a link' })).toBeNull();
    expect(screen.queryByRole('switch', { name: "Show the team's photos" })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Name staff as' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Manage staff' })).toBeNull();
    // The design's own two cards are not folded.
    expect(screen.getByRole('textbox', { name: 'Widget name' })).toBeTruthy();

    cleanup();
    await mount();
    expect(screen.getByRole('button', { name: 'Launcher' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('spinbutton', { name: /Greeting card after \(seconds\)/ })).toBeNull();
  });

  it('opens a folded section whose field holds Save back, so the highlighted field can be seen', async () => {
    rememberSection('u-1', 'website.widget.logo-theme', false);
    rememberSection('u-1', 'website.widget.away', false);
    payload = { ...payload, design: design({ logo_url: 'javascript:alert(1)' }) };
    await mount();
    expect(screen.getByRole('button', { name: 'Logo and theme' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('The logo must be a web address starting with https://')).toBeTruthy();
    // Nothing wrong in Away screen: it stays as the person left it.
    expect(screen.getByRole('button', { name: 'Away screen' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('lets several sections be open at once, and Install guides open as many steps as wanted', async () => {
    await mount();
    for (const name of SECTIONS) expect(screen.getByRole('button', { name }).getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: 'Embed code' }));
    const wp = await screen.findByRole('button', { name: /^WordPress/ });
    const shopify = screen.getByRole('button', { name: /^Shopify/ });
    expect(wp.getAttribute('aria-expanded')).toBe('false');
    expect(within(wp).getByText('3 steps')).toBeTruthy();
    // In the page, but hidden: neither shown nor read.
    expect(screen.getByText('Paste the embed code into its footer box.').closest('[hidden]')).toBeTruthy();
    fireEvent.click(wp);
    fireEvent.click(shopify);
    expect(wp.getAttribute('aria-expanded')).toBe('true');
    expect(shopify.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Paste the embed code into its footer box.').closest('[hidden]')).toBeNull();
    expect(document.getElementById(wp.getAttribute('aria-controls')!)!.hidden).toBe(false);
  });

  it('sums each section up from what is being edited', () => {
    const s = appearanceSummaries(design({ logo_url: 'https://x/logo.png', theme: 'auto', greeting: 'Hi there,\nhow can we help?', quick_links: [{ label: 'a', url: 'https://a' }, { label: 'b', url: 'https://b' }], whatsapp_number: '+94 77 123 4567', position: 'bottom_left', launcher_offset_left: 32, greeting_delay: 8, show_agents: false }));
    expect(s).toEqual({
      logoTheme: 'Own logo · Matches the visitor',
      home: '“Hi there,” · 2 links',
      away: 'WhatsApp +94 77 123 4567',
      launcher: '20 px up · 32 px from the left · Greeting card after 8 s',
      team: 'Photos hidden',
    });
    expect(appearanceSummaries(design({ quick_links: [{ label: 'a', url: 'https://a' }], staff_display: 'first_name' })).home).toBe('Standard greeting · 1 link');
    expect(appearanceSummaries(design({ staff_display: 'first_name' })).team).toBe('Photos shown · First name only');
  });
});
