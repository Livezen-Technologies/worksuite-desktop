import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type RefObject } from 'react';
import { apiPost } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { orgTone, switchOrganization } from '../../core/orgs';
import { useStore } from '../../core/store';
import { currentZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { closeOverlay } from '../../core/ui';
import type { MenuItem } from '../../components/Menu';
import { OrgMenu, useAppOrgOptions } from '../../components/OrgSwitcher';
import { initials } from '../../components/ui';

/**
 * The organisation switcher (sidebar designs 1–3; the Company Selection menu): it opens under the organisation card
 * at the top of the sidebar, or beside it when the sidebar is collapsed. Since worksuite-desktop#214 it is the shared
 * organisation filter's menu (`OrgMenu`), placed by the shared `Menu` like every other menu: find an organisation,
 * All organizations, each company with your role in it and its shortcut, Default, and — for whoever manages the
 * directory — Manage organisations and Create an organisation.
 */
export function OrgTile({ id, name, size = 32, all }: { id: string; name: string; size?: number; all?: boolean }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[9px] font-bold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), background: all ? 'var(--ws-navy-3)' : orgTone(id) }}
      aria-hidden
    >
      {all ? 'AO' : initials(name)}
    </span>
  );
}

export function OrgSwitcher() {
  const b = useStore(app, (s) => s.bootstrap);
  const current = useStore(app, (s) => s.organizationId);
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const options = useAppOrgOptions();
  const fallback = useRef<HTMLSpanElement>(null);
  // The card it belongs to, read once as it opens; a fixed point near the top of the sidebar when the card is not
  // there (opened from the command palette with the sidebar hidden).
  const [card] = useState<HTMLElement | null>(() => (typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('[data-org-card]')));
  const [at] = useState(() => createAt(card));
  const beside = at.beside;
  const anchor = useMemo<RefObject<HTMLElement | null>>(() => (card ? { current: card } : fallback), [card]);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const canManage = !!perms && (perms.includes('*') || perms.includes('directory.manage'));
  if (!b) return null;
  const orgs = b.organizations;
  const value = current ? [current] : orgs.length === 1 ? [orgs[0]!.id] : [];
  const create: MenuItem = {
    id: 'org-create',
    label: 'Create an organisation',
    icon: 'plus',
    onSelect: () => {
      creatingRef.current = true;
      setCreating(true);
    },
  };
  return (
    <>
      <span ref={fallback} aria-hidden="true" className="pointer-events-none fixed" style={{ top: 60, left: 12, width: 1, height: 1 }} />
      {creating ? (
        <div role="dialog" aria-label="Create an organization" onKeyDown={(e) => e.key === 'Escape' && closeOverlay()} className="no-drag animate-in fixed z-[60] w-[330px] overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_24px_60px_rgb(var(--ws-shadow-rgb)/.28)]" style={{ top: at.top, left: at.left }}>
          <CreateOrganization onClose={() => closeOverlay()} />
        </div>
      ) : (
        <OrgMenu
          label="Organizations"
          orgs={options}
          value={value}
          onChange={(ids) => {
            const id = ids[0] ?? null;
            if (id !== current && !(orgs.length === 1 && id === orgs[0]!.id)) void switchOrganization(id);
          }}
          allowAll={orgs.length > 1}
          more={canManage ? [create] : []}
          anchor={anchor}
          prefer={beside ? 'end' : 'bottom'}
          onClose={() =>
            // The menu closes before Create's own action runs: let it say whether the form takes over.
            queueMicrotask(() => {
              if (!creatingRef.current) closeOverlay();
            })
          }
        />
      )}
    </>
  );
}

/** Where the Create form goes: under the card, or beside it collapsed — where the switcher used to open. */
function createAt(card: HTMLElement | null): { top: number; left: number; beside: boolean } {
  const r = card?.getBoundingClientRect();
  if (!r) return { top: 124, left: 10, beside: false };
  return r.width < 100 ? { top: r.top, left: r.right + 8, beside: true } : { top: r.bottom + 6, left: r.left, beside: false };
}

/** A new company: a name, and optionally its legal name, country and time zone. The rest is set in the Directory. */
function CreateOrganization({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [legal, setLegal] = useState('');
  const [country, setCountry] = useState('');
  const [busy, setBusy] = useState(false);
  const zone = currentZone();
  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await apiPost('/api/directory/organizations', { name: name.trim(), legal_name: legal.trim() || null, country: country.trim() || null, timezone: zone });
      const fresh = await call('session:refresh').catch(() => null);
      void qc.invalidateQueries();
      const made = fresh?.organizations.find((o) => o.name === name.trim());
      toast('success', made ? `${made.name} created.` : `${name.trim()} created. It shows here once you are a member of it.`);
      if (made) await switchOrganization(made.id);
      closeOverlay();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const field = 'h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary';
  return (
    <form className="flex flex-col gap-2.5 border-t border-line bg-well p-3" onSubmit={(e) => (e.preventDefault(), void create())} aria-label="Create an organization">
      <b className="text-[13px] text-ink">Create an organization</b>
      <input autoFocus aria-label="Name" placeholder="Name, as people will see it" value={name} maxLength={150} onChange={(e) => setName(e.target.value)} className={field} />
      <input aria-label="Legal name" placeholder="Legal name (optional)" value={legal} maxLength={200} onChange={(e) => setLegal(e.target.value)} className={field} />
      <input aria-label="Country" placeholder="Country (optional)" value={country} maxLength={80} onChange={(e) => setCountry(e.target.value)} className={field} />
      <span className="text-[11.5px] text-ink-3">Its time zone starts as yours ({zone.replace(/_/g, ' ')}). Everything else is set in the Directory.</span>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-8 rounded-[8px] border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">
          Cancel
        </button>
        <button type="submit" disabled={!name.trim() || busy} className="h-8 rounded-[8px] bg-primary px-3 text-[12.5px] font-bold text-white disabled:opacity-50">
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
    </form>
  );
}
