import type { ReactNode } from 'react';
import { app } from '../../../../core/app-state';
import { text } from '../../../../core/i18n';
import { useStore } from '../../../../core/store';
import { useTab } from '../../../../core/tab-context';
import { cx } from '../../../../components/ui';

/**
 * The pieces every Admin Center › Protection screen shares (D21–D25): the heading with its actions, the tab strip
 * (DskProtTabs), the cards, and what this admin may do — the server checks each permission again.
 */

export const PROTECTION_BASE = '/settings/admin/mail/protection';

export const TABS = [
  ['overview', 'Overview'],
  ['policies', 'Policies'],
  ['quarantine', 'Quarantine'],
  ['lists', 'Allow & block lists'],
  ['attachments', 'Attachments'],
  ['engines', 'Engines'],
  ['reports', 'Reports'],
] as const;

export type ProtTab = (typeof TABS)[number][0];

export function protTabOf(v: string | undefined): ProtTab {
  return (TABS.find(([id]) => id === v)?.[0] ?? 'overview') as ProtTab;
}

export interface AdminPerms {
  view: boolean;
  manage: boolean;
  release: boolean;
  content: boolean;
  purge: boolean;
}

export function useAdminPerms(): AdminPerms {
  const perms = useStore(app, (s) => s.bootstrap?.permissions ?? null);
  const has = (p: string) => !!perms?.some((x) => x === '*' || x === p);
  return { view: has('mail.security.view'), manage: has('mail.security.manage'), release: has('mail.quarantine.release'), content: has('mail.quarantine.view_content'), purge: has('mail.quarantine.purge') };
}

export const NO_MANAGE = 'Needs the Manage mail security permission.';

/** "Admin Center / Mail & Communication", Protection, the screen's actions, and the tabs (DskProtTabs). */
export function ProtTop({ tab, actions, held }: { tab: ProtTab; actions?: ReactNode; held?: number | null }) {
  const { go } = useTab();
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-[12px] text-ink-3">{text('Admin Center / Mail & Communication')}</span>
          <h1 className="text-[21px] font-bold text-ink">{text('Protection')}</h1>
        </div>
        {actions}
      </div>
      <div role="tablist" aria-label={text('Protection')} className="flex gap-1 overflow-x-auto border-b border-line scroll-thin">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => go(`${PROTECTION_BASE}/${id}`)}
            className={cx('-mb-px flex h-[39px] shrink-0 items-center gap-[7px] border-b-2 px-3 text-[13px]', tab === id ? 'border-primary font-bold text-primary' : 'border-transparent font-semibold text-ink-2 hover:text-ink')}
          >
            {text(label)}
            {id === 'quarantine' && held ? <span className="flex h-[18px] items-center rounded-full bg-[#FDF0E1] px-[7px] text-[11px] font-bold text-[#9A4A06] dark:bg-[#3A2610] dark:text-[#F5B26B]">{held}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Card({ title, extra, children, className }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface px-4 py-3.5', className)}>
      {title || extra ? (
        <div className="flex items-baseline gap-2">
          {title ? <h2 className="flex-1 text-[14px] font-bold text-ink">{title}</h2> : <span className="flex-1" />}
          {extra}
        </div>
      ) : null}
      {children}
    </section>
  );
}

const DOT = { ok: 'bg-[#2E9E6A]', warn: 'bg-[#E0A030]', down: 'bg-[#D25B4B]', off: 'bg-[#8A91A6]', danger: 'bg-[#D25B4B]', neutral: 'bg-[#8A91A6]' } as const;

/** A coloured dot that always comes with words beside it (never colour alone). */
export function Dot({ tone }: { tone: keyof typeof DOT }) {
  return <span aria-hidden className={cx('h-[9px] w-[9px] shrink-0 rounded-full', DOT[tone])} />;
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <span role="radiogroup" aria-label={label} className="inline-flex rounded-[9px] bg-subtle p-[3px]">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={cx('flex h-[26px] items-center rounded-[7px] px-[11px] text-[12px] font-semibold', value === v ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(15,27,61,.14)]' : 'text-ink-2')}>
          {l}
        </button>
      ))}
    </span>
  );
}

/** "2 h ago", "3 days ago" for an age in seconds. */
export function ageWords(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return text('age unknown');
  if (seconds < 3600) return text('{n} min ago', { n: Math.max(1, Math.round(seconds / 60)) });
  if (seconds < 86_400) return text('{n} h ago', { n: Math.round(seconds / 3600) });
  return text('{n} days ago', { n: Math.round(seconds / 86_400) });
}

export const num = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '—');
