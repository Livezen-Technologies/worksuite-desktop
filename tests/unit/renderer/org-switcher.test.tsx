// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreApi from '../../../src/core/api';

vi.mock('../../../src/core/api', async (orig) => ({ ...(await orig<typeof CoreApi>()), apiGet: vi.fn(), apiPut: vi.fn() }));
vi.mock('../../../src/core/bridge', () => ({ call: vi.fn(async () => null), on: () => () => undefined, errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)), isMac: false }));
vi.mock('../../../src/core/toasts', () => ({ toast: vi.fn() }));

import { apiGet, apiPut } from '../../../src/core/api';
import { app } from '../../../src/core/app-state';
import { call } from '../../../src/core/bridge';
import {
  ORG_PREFS_SCOPE,
  decodeSelection,
  defaultOrganisation,
  encodeSelection,
  flushOrgPrefs,
  orgPrefs,
  recallOrgChoice,
  recallOrgSelection,
  rememberOrgChoice,
  rememberOrgSelection,
  resetOrgPrefsForTests,
  setDefaultOrganisation,
  setOrgSelectionShared,
  syncOrgPrefs,
} from '../../../src/core/org-prefs';
import { OrgSwitcher, orgSummary, SEARCH_ABOVE, type OrgOption } from '../../../src/components/OrgSwitcher';
import { TenderRail } from '../../../src/modules/tenders/Rail';
import { OrgSwitcher as ExpensesOrgSwitcher } from '../../../src/modules/expenses/Rail';
import { HrRail } from '../../../src/modules/hr/Rail';

/**
 * The organisation switcher (worksuite-desktop#214): a compact pill on Home's date line and in every module that
 * filters by organisation, with the shared menu under it — search, multi-select with Apply, Default, Manage — and a
 * memory per person, shared between apps or kept per app.
 */
const ROOT = join(__dirname, '../../..');
const ORGS: OrgOption[] = [
  { id: '1', name: 'CreativeFX', count: 2 },
  { id: '2', name: 'TechHubiz', count: 0 },
  { id: '3', name: 'Asterix', count: 1 },
];
const many = (n: number): OrgOption[] => Array.from({ length: n }, (_, i) => ({ id: String(i + 1), name: `Company ${i + 1}` }));

function Harness({ orgs = ORGS, initial = [] as string[], multiple = true, onChange = vi.fn(), ...rest }: { orgs?: OrgOption[]; initial?: string[]; multiple?: boolean; onChange?: (ids: string[]) => void } & Partial<Parameters<typeof OrgSwitcher>[0]>) {
  const [value, setValue] = useState(initial);
  return (
    <OrgSwitcher
      orgs={orgs}
      value={value}
      multiple={multiple}
      countLabel="due today"
      onChange={(ids) => {
        onChange(ids);
        setValue(ids);
      }}
      {...rest}
    />
  );
}

const trigger = () => screen.getByRole('button', { name: /^Organisations:/ });
const menu = () => screen.getByRole('menu', { name: 'Organisations' });

beforeEach(() => {
  localStorage.clear();
  resetOrgPrefsForTests();
  vi.mocked(call).mockReset().mockResolvedValue(null as never);
  vi.mocked(apiPut).mockReset().mockResolvedValue({} as never);
  vi.mocked(apiGet).mockReset().mockResolvedValue({ prefs: null } as never);
  app.set({
    auth: { stage: 'ready', user: { id: '5', name: 'Ada' } } as never,
    session: { mode: 'account', signingIn: false, moveOffer: false },
    organizationId: '1',
    bootstrap: { organizations: ORGS.map((o) => ({ id: o.id, name: o.name })), defaultOrganizationId: '1', permissions: ['*'], user: {} } as never,
  });
});
afterEach(cleanup);

describe('the trigger', () => {
  it('says All organisations with the logos stacked', () => {
    render(<Harness />);
    expect(trigger().getAttribute('aria-label')).toBe('Organisations: All organisations');
    expect(trigger().textContent).toContain('All organisations');
    expect(trigger().querySelector('[data-org-stack="3"]')).toBeTruthy();
  });

  it('says one organisation by name with its initials', () => {
    render(<Harness initial={['2']} />);
    expect(trigger().getAttribute('aria-label')).toBe('Organisations: TechHubiz');
    expect(trigger().querySelector('[data-org-logo="2"]')!.textContent).toBe('T');
    expect(trigger().querySelector('[data-org-stack]')).toBeNull();
  });

  it('says "2 organisations" with both logos stacked, and names them on hover', () => {
    render(<Harness initial={['1', '3']} />);
    expect(trigger().getAttribute('aria-label')).toBe('Organisations: 2 organisations');
    expect(trigger().querySelector('[data-org-stack="2"]')).toBeTruthy();
    expect(trigger().title).toBe('CreativeFX, Asterix');
    expect(orgSummary(ORGS, ['1', '3']).label).toBe('2 organisations');
  });

  it('a logo when there is one', () => {
    render(<Harness orgs={[{ id: '9', name: 'Logo Co', logo: 'https://example.test/logo.png' }, ...ORGS]} initial={['9']} />);
    expect(trigger().querySelector('img[data-org-logo="9"]')).toBeTruthy();
  });

  it('is a compact pill: 28px, 12px text in the surrounding font, a soft border, 8px corners, a lighter hover', () => {
    render(<Harness />);
    const c = trigger().className;
    for (const k of ['h-7', 'text-[12px]', 'font-[inherit]', 'border', 'border-line/80', 'rounded-[8px]', 'bg-transparent', 'hover:bg-subtle']) expect(c.split(' ')).toContain(k);
    expect(trigger().tagName).toBe('BUTTON');
  });
});

describe('focus ring for the keyboard only', () => {
  it('the global ring is 2px with a 2px offset on :focus-visible, and a pointer choice leaves none on the trigger', () => {
    const css = readFileSync(join(ROOT, 'src/styles.css'), 'utf8');
    expect(css).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--ws-focus\);\s*outline-offset: 2px;/);
    expect(css).toMatch(/\[data-pointer-focus\]:focus-visible \{\s*outline: none;/);
    render(<Harness />);
    // No ring of its own that would outlast a click.
    expect(trigger().className).not.toMatch(/(^|\s)(focus:|ring-|shadow-\[0_0_0)/);
    fireEvent.pointerDown(trigger());
    fireEvent.click(trigger());
    fireEvent.pointerDown(within(menu()).getByRole('menuitemcheckbox', { name: 'TechHubiz' }));
    fireEvent.click(within(menu()).getByRole('menuitemcheckbox', { name: 'TechHubiz' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(trigger().hasAttribute('data-pointer-focus')).toBe(true);
    // The next key brings the ring back.
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(trigger().hasAttribute('data-pointer-focus')).toBe(false);
  });

  it('a choice made with the keyboard gives focus back with its ring', () => {
    render(<Harness />);
    trigger().focus();
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    fireEvent.click(trigger());
    const item = within(menu()).getByRole('menuitemcheckbox', { name: 'Asterix' });
    item.focus();
    fireEvent.keyDown(item, { key: 'Enter' });
    expect(document.activeElement).toBe(trigger());
    expect(trigger().hasAttribute('data-pointer-focus')).toBe(false);
  });
});

describe('the menu', () => {
  it('is the shared menu, attached under the trigger, 300px wide and scrolling past its room', () => {
    render(<Harness />);
    fireEvent.click(trigger());
    const panel = menu().closest('[data-menu-root]') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.getAttribute('data-side')).toBe('bottom');
    expect(panel.style.width).toBe('300px');
    expect(panel.className).toContain('overflow-y-auto');
    expect(panel.style.maxHeight).not.toBe('');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('All organisations with the total; each organisation with its initials, its count and a checkbox', () => {
    render(<Harness />);
    fireEvent.click(trigger());
    const all = within(menu()).getByRole('menuitemcheckbox', { name: 'All organisations' });
    expect(all.textContent).toContain('3 organisations');
    expect(all.textContent).toContain('3'); // 2 + 0 + 1 due today
    const fx = within(menu()).getByRole('menuitemcheckbox', { name: 'CreativeFX' });
    expect(fx.querySelector('[data-org-logo="1"]')).toBeTruthy();
    expect(within(fx).getByLabelText('2 due today')).toBeTruthy();
    expect(fx.querySelector('[data-menu-check]')).toBeTruthy();
    // No count is made up: a zero shows nothing.
    expect(within(menu()).getByRole('menuitemcheckbox', { name: 'TechHubiz' }).textContent).not.toMatch(/\d/);
  });

  it(`has a search box only above ${SEARCH_ABOVE} organisations`, () => {
    const { unmount } = render(<Harness orgs={many(SEARCH_ABOVE)} />);
    fireEvent.click(trigger());
    expect(screen.queryByRole('textbox', { name: 'Find an organisation' })).toBeNull();
    unmount();
    render(<Harness orgs={many(SEARCH_ABOVE + 3)} />);
    fireEvent.click(trigger());
    const box = screen.getByRole('textbox', { name: 'Find an organisation' });
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: 'pany 7' } });
    expect(within(menu()).getAllByRole('menuitemcheckbox').map((e) => e.getAttribute('aria-labelledby') && document.getElementById(e.getAttribute('aria-labelledby')!)!.textContent)).toEqual(['Company 7']);
    fireEvent.change(box, { target: { value: 'nothing like it' } });
    expect(within(menu()).getByText('No organisation matches “nothing like it”.')).toBeTruthy();
  });

  it('ticks several and applies them together; a click on a name shows only that one', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(trigger());
    expect(within(menu()).queryByRole('menuitem', { name: /^Apply/ })).toBeNull();
    fireEvent.click(within(menu()).getByRole('menuitemcheckbox', { name: 'CreativeFX' }).querySelector('[data-menu-check]')!);
    fireEvent.click(within(menu()).getByRole('menuitemcheckbox', { name: 'Asterix' }).querySelector('[data-menu-check]')!);
    expect(onChange).not.toHaveBeenCalled();
    expect(within(menu()).getByRole('menuitemcheckbox', { name: 'CreativeFX' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Apply (2)' }));
    expect(onChange).toHaveBeenLastCalledWith(['1', '3']);
    expect(trigger().getAttribute('aria-label')).toBe('Organisations: 2 organisations');

    fireEvent.click(trigger());
    fireEvent.click(within(menu()).getByRole('menuitemcheckbox', { name: 'TechHubiz' }));
    expect(onChange).toHaveBeenLastCalledWith(['2']);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('marks the default organisation and sets another from the menu', () => {
    render(<Harness />);
    fireEvent.click(trigger());
    expect(within(menu()).getByRole('menuitemcheckbox', { name: 'CreativeFX' }).querySelector('[data-menu-badge]')!.textContent).toBe('Default');
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Default organisation' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Asterix' }));
    expect(defaultOrganisation()).toBe('3');
    fireEvent.click(trigger());
    expect(within(menu()).getByRole('menuitemcheckbox', { name: 'Asterix' }).querySelector('[data-menu-badge]')!.textContent).toBe('Default');
    expect(within(menu()).getByRole('menuitemcheckbox', { name: 'CreativeFX' }).querySelector('[data-menu-badge]')).toBeNull();
  });

  it('Manage organisations opens the Directory, for whoever may manage it', () => {
    const { unmount } = render(<Harness />);
    fireEvent.click(trigger());
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Manage organisations' }));
    expect(call).toHaveBeenCalledWith('app:openInBrowser', { path: '/directory' });
    unmount();
    app.set({ bootstrap: { ...app.get().bootstrap!, permissions: ['tasks.view'] } });
    render(<Harness />);
    fireEvent.click(trigger());
    expect(within(menu()).queryByRole('menuitem', { name: 'Manage organisations' })).toBeNull();
  });

  it('keyboard: arrows move, Space ticks, Enter applies, Escape closes and gives focus back', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    trigger().focus();
    fireEvent.keyDown(trigger(), { key: 'Enter' });
    fireEvent.click(trigger());
    const items = within(menu()).getAllByRole('menuitemcheckbox');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document.activeElement!, { key: ' ' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[3]);
    fireEvent.keyDown(document.activeElement!, { key: ' ' });
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['1', '3']);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());

    fireEvent.click(trigger());
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('one organisation at a time where a screen shows one: no checkboxes, no Apply', () => {
    const onChange = vi.fn();
    render(<Harness multiple={false} allowAll={false} onChange={onChange} initial={['1']} />);
    fireEvent.click(trigger());
    expect(within(menu()).queryByRole('menuitemradio', { name: 'All organisations' })).toBeNull();
    expect(menu().querySelector('[data-menu-check]')).toBeNull();
    fireEvent.click(within(menu()).getByRole('menuitemradio', { name: 'Asterix' }));
    expect(onChange).toHaveBeenCalledWith(['3']);
  });
});

describe('the memory', () => {
  it('is per person, synced through the preferences every screen uses', async () => {
    rememberOrgSelection('home', ['1', '3']);
    expect(recallOrgSelection('home')).toEqual(['1', '3']);
    expect(JSON.parse(localStorage.getItem('ws.orgs.5')!).dirty).toBe(true);
    await act(() => flushOrgPrefs());
    expect(apiPut).toHaveBeenCalledWith(`/api/prefs/${ORG_PREFS_SCOPE}`, { prefs: expect.objectContaining({ selections: { '*': '1,3' }, shared: true }) });
    expect(orgPrefs.get().dirty).toBe(false);

    // Another person on this computer has their own.
    app.set({ auth: { stage: 'ready', user: { id: '6', name: 'Bo' } } as never });
    expect(recallOrgSelection('home')).toBeNull();
    // A newer copy from the server wins.
    vi.mocked(apiGet).mockResolvedValue({ prefs: { updatedAt: Date.now() + 1000, shared: true, selections: { '*': 'all' }, defaultOrg: '2' } } as never);
    await act(() => syncOrgPrefs());
    expect(recallOrgSelection('home')).toEqual([]);
    expect(defaultOrganisation()).toBe('2');
  });

  it('one selection for every app, or one per app (the setting)', () => {
    rememberOrgSelection('home', ['2']);
    expect(recallOrgChoice('tenders')).toBe('2');
    setOrgSelectionShared(false);
    rememberOrgChoice('tenders', '3');
    expect(recallOrgChoice('tenders')).toBe('3');
    expect(recallOrgSelection('home')).toBeNull();
    setOrgSelectionShared(true);
    expect(recallOrgChoice('tenders')).toBe('2');
    // Several chosen mean nothing to a screen that shows one; an organisation no longer held is forgotten.
    rememberOrgSelection('home', ['1', '2']);
    expect(recallOrgChoice('finance')).toBeNull();
    rememberOrgSelection('home', ['99']);
    expect(recallOrgChoice('finance')).toBeNull();
    expect(encodeSelection([])).toBe('all');
    expect(decodeSelection('all')).toEqual([]);
    expect(decodeSelection('')).toBeNull();
  });

  it('Settings › Preferences says whether the apps share one selection', async () => {
    const { OrgFilterSetting } = await import('../../../src/modules/settings/SettingsPage');
    render(<OrgFilterSetting />);
    const box = screen.getByRole('combobox', { name: 'Organisation filter' });
    expect(box.textContent).toContain('Same in every app');
    fireEvent.click(box);
    fireEvent.click(await screen.findByRole('option', { name: 'Separate in each app' }));
    expect(orgPrefs.get().stored?.shared).toBe(false);
    expect(screen.getByRole('combobox', { name: 'Organisation filter' }).textContent).toContain('Separate in each app');
  });

  it('the default is the person’s own, else the server’s', () => {
    expect(defaultOrganisation()).toBe('1');
    setDefaultOrganisation('2');
    expect(defaultOrganisation()).toBe('2');
  });
});

describe('every module filters with the same component', () => {
  it('Tenders, Expenses and People draw the shared switcher', () => {
    render(<TenderRail view="dash" onPick={vi.fn()} onNew={null} counts={{}} expired={0} org="2" companies={[{ id: 1, name: 'CreativeFX' }, { id: 2, name: 'TechHubiz' }] as never} onOrg={vi.fn()} canSettings={false} />);
    expect(screen.getByRole('button', { name: 'Organisations: TechHubiz' }).hasAttribute('data-org-switcher')).toBe(true);
    cleanup();

    const onSelect = vi.fn();
    render(<ExpensesOrgSwitcher orgs={[{ id: 1, name: 'CreativeFX', currency: 'LKR', role: 'Admin', favourite: false, can_act: true }, { id: 2, name: 'TechHubiz', currency: 'USD', role: null, favourite: true, can_act: true }] as never} selected={[]} onSelect={onSelect} onFavourite={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Organisations: All organisations' }));
    fireEvent.click(within(menu()).getByRole('menuitemcheckbox', { name: 'CreativeFX' }));
    expect(onSelect).toHaveBeenCalledWith([1]);
    cleanup();

    render(<HrRail view="overview" onPick={vi.fn()} counts={{ requests: 0, waiting: 0, reviewsTimesheets: false }} />);
    expect(screen.getByRole('button', { name: 'Company scope: CreativeFX' }).hasAttribute('data-org-switcher')).toBe(true);
  });

  it('the Company Selection menu (the sidebar card) is the same menu, under the card, switching the app', async () => {
    const { OrgSwitcher: CompanySelection } = await import('../../../src/app/overlays/OrgSwitcher');
    const { ui } = await import('../../../src/core/ui');
    vi.mocked(call).mockImplementation((async (ch: string, arg: { organizationId: string | null }) => (ch === 'session:switchOrganization' ? { organizationId: arg.organizationId } : null)) as never);
    ui.set({ overlay: 'org' });
    render(
      <>
        <button
          type="button"
          data-org-card
          ref={(el) => {
            if (el) el.getBoundingClientRect = () => ({ left: 10, top: 10, width: 200, height: 54, right: 210, bottom: 64, x: 10, y: 10, toJSON: () => null });
          }}
        >
          Organization card
        </button>
        <CompanySelection />
      </>,
    );
    const list = screen.getByRole('menu', { name: 'Organizations' });
    expect(list.closest('[data-menu-root]')!.getAttribute('data-side')).toBe('bottom');
    expect(within(list).getByRole('menuitemradio', { name: 'CreativeFX' }).getAttribute('aria-checked')).toBe('true');
    expect(within(list).getByRole('menuitemradio', { name: 'CreativeFX' }).querySelector('[data-menu-badge]')!.textContent).toBe('Default');
    expect(within(list).getByRole('menuitem', { name: 'Create an organisation' })).toBeTruthy();
    expect(within(list).getByRole('menuitem', { name: 'Manage organisations' })).toBeTruthy();
    await act(async () => fireEvent.click(within(list).getByRole('menuitemradio', { name: 'Asterix' })));
    expect(call).toHaveBeenCalledWith('session:switchOrganization', { organizationId: '3' });
    expect(app.get().organizationId).toBe('3');
    expect(ui.get().overlay).toBeNull();
  });

  it('no module keeps a select of its own for its organisation filter', () => {
    const files: Array<[string, RegExp]> = [
      ['src/modules/home/HomePage.tsx', /<OrgSwitcher\b/],
      ['src/modules/tenders/Rail.tsx', /<OrgSwitcher\b/],
      ['src/modules/sales/Rail.tsx', /<OrgSwitcher\b/],
      ['src/modules/billing/Rail.tsx', /<OrgSwitcher\b/],
      ['src/modules/inventory/Rail.tsx', /<OrgSwitcher\b/],
      ['src/modules/finance/Rail.tsx', /<OrgSwitcher\b/],
      ['src/modules/expenses/Rail.tsx', /<SharedOrgSwitcher\b/],
      ['src/modules/garage/GarageShell.tsx', /<OrgSwitcher\b/],
      ['src/modules/elearning/ElearningShell.tsx', /<OrgSwitcher\b/],
      ['src/modules/hr/Rail.tsx', /<AppOrgSwitcher\b/],
      ['src/modules/hr/Announcements.tsx', /<OrgSwitcher\b/],
      ['src/modules/files/Shared.tsx', /<OrgSwitcher\b/],
      ['src/app/overlays/OrgSwitcher.tsx', /<OrgMenu\b/],
    ];
    for (const [file, uses] of files) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      expect(src, file).toMatch(uses);
      expect(src, file).toMatch(/from '\.\.\/\.\.\/components\/OrgSwitcher'/);
      expect(src, file).not.toMatch(/<[Ss]elect[^>]*aria-label="(Organization|Companies|Filter by company)"/);
      expect(src, file).not.toMatch(/<option value="">(All organizations|Every company|All companies|Any company)<\/option>/);
    }
  });
});
