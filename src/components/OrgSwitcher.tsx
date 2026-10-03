import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { app } from '../core/app-state';
import { call, errorMessage } from '../core/bridge';
import { prettyAccelerator } from '../core/commands';
import { orgShortcut, orgTone, roleLabel, switchOrganization } from '../core/orgs';
import { setDefaultOrganisation, useOrgPrefs } from '../core/org-prefs';
import { useStore } from '../core/store';
import { toast } from '../core/toasts';
import { Icon } from './Icon';
import { Menu, type MenuItem, type MenuSection } from './Menu';
import { cx, initials } from './ui';

/**
 * The organisation filter (worksuite-desktop#214): one control for every screen that is filtered by organisation —
 * Home's date line, the module rails (Expenses, Finance, Tenders, Sales, Billing, Inventory, Garage, eLearning,
 * People), the filters on a page, and the app's own organisation switch.
 *
 * The trigger is a compact pill: 28px, 12px text in the surrounding font, a 1px soft border, 8px corners, a lighter
 * background on hover. Its picture says what is chosen: the first few organisations stacked for All, the one
 * organisation's logo or initials, or the chosen ones stacked with "2 organisations". It is a button, so a click
 * leaves no ring — the ring is the app's `:focus-visible` one, for the keyboard only — and focus put back on it after
 * a choice made with the pointer draws none either (`data-pointer-focus`, see styles.css).
 *
 * The menu is the shared `Menu`, attached under the trigger with every other menu's placement (6px off, flipped
 * when there is no room, 8px inside the window, scrolling past its room). A search box when there are more than
 * five organisations; All organisations with how many there are; each organisation with its logo or initials, its
 * name, a small count where the screen has one (what is due today on Home) and, where several can be chosen, a
 * checkbox. The default organisation says "Default", and Default organisation › sets it. The foot has Manage
 * organisations, where the person may manage them, and Apply once the ticks differ from what is shown.
 *
 * Keyboard: Up and Down move, Space ticks, Enter applies the ticks (or picks the organisation under focus), Escape
 * closes and puts focus back on the trigger.
 */
export interface OrgOption {
  id: string;
  name: string;
  /** A logo, when the server has one; initials on the organisation's colour otherwise. */
  logo?: string | null;
  /** A second line ("LKR · read only", "No books yet"). */
  hint?: string | null;
  /** A small count beside the name (what is due today); none when the screen has no count to give. */
  count?: number | null;
  /** Its keyboard shortcut, shown on the right (the app's own switch). */
  shortcut?: string;
}

export interface OrgSwitcherProps {
  orgs: OrgOption[];
  /** The organisations shown; [] is All organisations. */
  value: string[];
  onChange: (ids: string[]) => void;
  /** Several may be ticked and applied together. */
  multiple?: boolean;
  /** All organisations is a choice (else one must be chosen). */
  allowAll?: boolean;
  /** The menu's and the trigger's name. */
  label?: string;
  allLabel?: string;
  /** What the count beside each organisation is ("due today"). */
  countLabel?: string;
  /** The organisation marked Default. */
  defaultId?: string | null;
  /** Sets the default from the menu; absent, there is no Default organisation item. */
  onSetDefault?: ((id: string) => void) | null;
  /** Manage organisations; absent for somebody who may not. */
  onManage?: (() => void) | null;
  /** More items, in their own section above the foot (a module's own: Pin to the top). */
  more?: MenuItem[];
  /** `pill`: inline, as wide as its label (Home's date line, a page's filters). `field`: the full width of a rail. */
  variant?: 'pill' | 'field';
  /** A label used in place of the first chosen organisation's name (a module that says "Choose a company"). */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/** Above this many, the menu has a search box. */
export const SEARCH_ABOVE = 5;
const MENU_WIDTH = 300;

/** An organisation's logo, or its initials on its own colour. */
export function OrgLogo({ org, size = 18, ring }: { org: Pick<OrgOption, 'id' | 'name' | 'logo'>; size?: number; ring?: boolean }) {
  const style = { width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.42)) };
  const edge = ring ? 'ring-2 ring-surface' : '';
  if (org.logo) return <img src={org.logo} alt="" aria-hidden="true" data-org-logo={org.id} className={cx('shrink-0 rounded-[5px] bg-surface object-cover', edge)} style={style} />;
  return (
    <span aria-hidden="true" data-org-logo={org.id} className={cx('flex shrink-0 items-center justify-center rounded-[5px] leading-none font-bold text-white', edge)} style={{ ...style, background: orgTone(org.id) }}>
      {initials(org.name).slice(0, 2)}
    </span>
  );
}

/** Up to three logos, overlapping: All organisations, or several chosen. */
export function OrgStack({ orgs, size = 16 }: { orgs: Array<Pick<OrgOption, 'id' | 'name' | 'logo'>>; size?: number }) {
  const shown = orgs.slice(0, 3);
  if (!shown.length) return <Icon name="building" size={size - 2} className="shrink-0" />;
  return (
    <span aria-hidden="true" data-org-stack={shown.length} className="flex shrink-0 items-center">
      {shown.map((o, i) => (
        <span key={o.id} className={cx('flex', i > 0 && '-ms-[5px]')}>
          <OrgLogo org={o} size={size} ring />
        </span>
      ))}
    </span>
  );
}

/** What the trigger says, for All, one, or several. */
export function orgSummary(orgs: OrgOption[], value: string[], allLabel = 'All organisations'): { label: string; chosen: OrgOption[] } {
  const chosen = value.map((id) => orgs.find((o) => o.id === id)).filter((o): o is OrgOption => !!o);
  if (!chosen.length) return { label: allLabel, chosen };
  if (chosen.length === 1) return { label: chosen[0]!.name, chosen };
  return { label: `${chosen.length} organisations`, chosen };
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Manage organisations, for whoever manages the directory: it opens the Directory in the browser. */
export function useManageOrganisations(): (() => void) | null {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const may = !!perms && (perms.includes('*') || perms.includes('directory.manage'));
  return useMemo(() => (may ? () => void call('app:openInBrowser', { path: '/directory' }).catch((e: unknown) => toast('error', errorMessage(e))) : null), [may]);
}

export function OrgSwitcher(props: OrgSwitcherProps) {
  const { orgs, value, allowAll = true, label = 'Organisations', allLabel = 'All organisations', variant = 'pill', placeholder, disabled, className } = props;
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // A choice made with the pointer puts focus back on the trigger without a ring (#214); a key brings it back.
  const [quiet, setQuiet] = useState(false);
  useEffect(() => {
    if (!quiet) return;
    const loud = () => setQuiet(false);
    document.addEventListener('keydown', loud, true);
    return () => document.removeEventListener('keydown', loud, true);
  }, [quiet]);
  const { label: text, chosen } = orgSummary(orgs, value, allLabel);
  const shown = !chosen.length && !allowAll && placeholder ? placeholder : text;
  const picture = chosen.length === 1 ? <OrgLogo org={chosen[0]!} size={16} /> : <OrgStack orgs={chosen.length ? chosen : orgs} size={16} />;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${shown}`}
        title={chosen.length > 1 ? chosen.map((o) => o.name).join(', ') : undefined}
        data-org-switcher=""
        data-pointer-focus={quiet ? '' : undefined}
        onPointerDown={() => setQuiet(true)}
        onBlur={() => !open && setQuiet(false)}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'no-drag inline-flex h-7 min-w-0 items-center gap-1.5 rounded-[8px] border border-line/80 bg-transparent px-2 font-[inherit] text-[12px] leading-none font-medium text-ink-2 transition-colors hover:bg-subtle hover:text-ink disabled:opacity-60',
          open && 'bg-subtle text-ink',
          variant === 'field' ? 'h-8 w-full bg-surface' : 'max-w-[280px] align-middle',
          className,
        )}
      >
        {picture}
        <span className={cx('min-w-0 truncate text-start', variant === 'field' && 'flex-1')}>{shown}</span>
        <Icon name="chevron-down" size={13} className={cx('shrink-0 text-ink-3 transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
      </button>
      {open ? <OrgMenu {...props} anchor={anchor} onClose={(how) => (setOpen(false), setQuiet(how === 'pointer'))} /> : null}
    </>
  );
}

/**
 * The menu on its own, for a trigger that is not the pill: the sidebar's organisation card opens it for the app's
 * own organisation switch (the Company Selection menu).
 */
export function OrgMenu({
  orgs,
  value,
  onChange,
  multiple = false,
  allowAll = true,
  label = 'Organisations',
  allLabel = 'All organisations',
  countLabel,
  defaultId: givenDefault,
  onSetDefault: givenSetDefault,
  onManage: givenManage,
  more,
  anchor,
  onClose,
  prefer = 'bottom',
  align = 'start',
}: OrgSwitcherProps & { anchor: RefObject<HTMLElement | null>; onClose: (how: 'pointer' | 'keyboard') => void; prefer?: 'bottom' | 'end'; align?: 'start' | 'center' }) {
  // Unless the screen says otherwise: the person's default (theirs, else the server's), set here, and Manage for whoever may.
  const prefs = useOrgPrefs();
  const serverDefault = useStore(app, (s) => s.bootstrap?.defaultOrganizationId ?? null);
  const manageHere = useManageOrganisations();
  const defaultId = givenDefault === undefined ? (prefs.defaultOrg ?? serverDefault) : givenDefault;
  const onSetDefault = givenSetDefault === undefined ? setDefaultOrganisation : givenSetDefault;
  const onManage = givenManage === undefined ? manageHere : givenManage;
  const [draft, setDraft] = useState<string[]>(value);
  const [q, setQ] = useState('');
  // Whether the last thing done in the menu was with a key: focus goes back to the trigger with a ring then.
  const keyed = useRef(false);
  useEffect(() => {
    const k = () => (keyed.current = true);
    const p = () => (keyed.current = false);
    document.addEventListener('keydown', k, true);
    document.addEventListener('pointerdown', p, true);
    return () => {
      document.removeEventListener('keydown', k, true);
      document.removeEventListener('pointerdown', p, true);
    };
  }, []);

  const needle = q.trim().toLocaleLowerCase();
  const searching = orgs.length > SEARCH_ABOVE;
  const matches = (name: string) => !needle || name.toLocaleLowerCase().includes(needle);
  const changed = multiple && !same(draft, value);
  const total = orgs.reduce<number | null>((n, o) => (typeof o.count === 'number' ? (n ?? 0) + o.count : n), null);
  const countText = (n: number) => (n > 99 ? '99+' : String(n));

  const pick = (ids: string[]) => onChange(ids);
  const toggle = (id: string) => setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  const allItem: MenuItem | null =
    allowAll && matches(allLabel)
      ? {
          id: 'org-all',
          label: allLabel,
          description: `${orgs.length} ${orgs.length === 1 ? 'organisation' : 'organisations'}`,
          leading: <OrgStack orgs={orgs} size={18} />,
          checked: multiple ? draft.length === 0 : value.length === 0,
          radio: !multiple,
          meta: total !== null ? countText(total) : undefined,
          metaLabel: total !== null && countLabel ? `${total} ${countLabel}` : undefined,
          onToggle: multiple ? () => setDraft([]) : undefined,
          onSelect: () => pick([]),
        }
      : null;

  const orgItems: MenuItem[] = orgs
    .filter((o) => matches(o.name))
    .map((o) => ({
      id: `org-${o.id}`,
      label: o.name,
      description: o.hint ?? undefined,
      leading: <OrgLogo org={o} size={20} />,
      badge: defaultId === o.id ? 'Default' : undefined,
      meta: typeof o.count === 'number' && o.count > 0 ? countText(o.count) : undefined,
      metaLabel: typeof o.count === 'number' && countLabel ? `${o.count} ${countLabel}` : undefined,
      shortcut: o.shortcut,
      checked: multiple ? draft.includes(o.id) : value.length === 1 && value[0] === o.id,
      radio: !multiple,
      onToggle: multiple ? () => toggle(o.id) : undefined,
      onSelect: () => pick([o.id]),
    }));

  const defaultItem: MenuItem | null =
    onSetDefault && !needle && orgs.length > 1
      ? {
          id: 'org-default',
          label: 'Default organisation',
          description: orgs.find((o) => o.id === defaultId)?.name ?? 'None chosen',
          icon: 'star',
          submenu: [
            {
              id: 'defaults',
              items: orgs.map((o) => ({
                id: `default-${o.id}`,
                label: o.name,
                leading: <OrgLogo org={o} size={18} />,
                checked: defaultId === o.id,
                radio: true,
                onSelect: () => onSetDefault(o.id),
              })),
            },
          ],
        }
      : null;

  const sections: MenuSection[] = [
    { id: 'all', items: allItem ? [allItem] : [] },
    { id: 'orgs', items: orgItems },
    { id: 'more', items: [...(defaultItem ? [defaultItem] : []), ...(needle ? [] : (more ?? []))] },
  ];

  const footer: MenuItem[] = [
    ...(onManage ? [{ id: 'org-manage', label: 'Manage organisations', icon: 'external', onSelect: onManage }] : []),
    ...(changed ? [{ id: 'org-apply', label: draft.length > 1 ? `Apply (${draft.length})` : 'Apply', primary: true, onSelect: () => pick(draft) }] : []),
  ];

  return (
    <Menu
      label={label}
      anchor={anchor}
      prefer={prefer}
      align={align}
      width={MENU_WIDTH}
      sections={sections}
      search={searching ? { value: q, onChange: setQ, label: 'Find an organisation' } : undefined}
      empty={`No organisation matches “${q.trim()}”.`}
      onEnter={() => {
        if (!changed) return false;
        pick(draft);
        return true;
      }}
      footer={footer}
      onClose={() => onClose(keyed.current ? 'keyboard' : 'pointer')}
    />
  );
}

/** The organisations the app works in, as its switcher lists them: the role underneath, the shortcut beside. */
export function useAppOrgOptions(): OrgOption[] {
  const orgs = useStore(app, (s) => s.bootstrap?.organizations);
  return useMemo(() => (orgs ?? []).map((o, i) => ({ id: o.id, name: o.name, hint: roleLabel(o.role) ?? 'Member', shortcut: (orgs ?? []).length > 1 && i < 9 ? prettyAccelerator(orgShortcut(i + 1)) : undefined })), [orgs]);
}

/**
 * The app's own organisation, as the filter in a module's rail (People): choosing one switches the app, as the
 * sidebar's switcher does.
 */
export function AppOrgSwitcher({ variant = 'field', label = 'Company scope' }: { variant?: 'pill' | 'field'; label?: string }) {
  const current = useStore(app, (s) => s.organizationId);
  const options = useAppOrgOptions();
  if (options.length === 0) return null;
  const value = current ? [current] : options.length === 1 ? [options[0]!.id] : [];
  return <OrgSwitcher variant={variant} label={label} orgs={options} allowAll={options.length > 1} value={value} onChange={(ids) => (ids[0] ?? null) !== current && void switchOrganization(ids[0] ?? null)} />;
}
