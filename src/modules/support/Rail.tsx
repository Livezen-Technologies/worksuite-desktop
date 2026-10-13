import type { ReactNode } from 'react';
import { VIEW_LABEL, type SavedView, type SupportView, type ViewCount } from '@shared/support';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { OrgSwitcher } from '../../components/OrgSwitcher';
import { CountBadge, cx } from '../../components/ui';

/**
 * The inbox's rail (D-01, FR-WSP-02/03): the system views with their live counts — the server counts them all in
 * one query, and a desk hint asks again — then the saved views, then my availability.
 *
 * Overdue's count is red and Unassigned's amber (the web's rule): the two numbers somebody should act on. History
 * views (Resolved, Closed, All) carry no count; nobody works down them.
 */
const NO_COUNT = new Set(['resolved', 'closed', 'all', 'trash']);
const VIEW_ICON: Record<string, string> = {
  mine: 'user',
  unassigned: 'inbox',
  assigned: 'users',
  mentioned: 'at',
  watching: 'eye',
  overdue: 'clock',
  escalated: 'arrow-up',
  pending: 'hourglass',
  live: 'life-buoy',
  resolved: 'check-circle',
  closed: 'archive',
  all: 'list',
  needs_organization: 'building',
  trash: 'trash',
  snoozed: 'snooze',
};

export interface OrgChoice {
  options: Array<{ id: string; name: string }>;
  value: string[];
  onChange: (ids: string[]) => void;
}

export function Rail({
  views,
  saved,
  view,
  savedId,
  onView,
  onSaved,
  orgs,
  footer,
}: {
  views: ViewCount[];
  saved: SavedView[];
  view: string | null;
  savedId: number | null;
  onView: (key: SupportView | string) => void;
  onSaved: (v: SavedView) => void;
  orgs: OrgChoice | null;
  footer?: ReactNode;
}) {
  // The server's views, then All (every ticket not in the trash), which it lists but does not count.
  const list = views.some((v) => v.key === 'all') ? views : [...views, { key: 'all', label: VIEW_LABEL.all, count: null }];
  return (
    <nav aria-label={text('Support views')} className="flex h-full w-[232px] shrink-0 flex-col border-r border-line bg-rail">
      <div className="flex shrink-0 flex-col gap-2 px-3 pt-3 pb-2">
        <h1 className="flex items-center gap-2 text-[15px] font-extrabold text-ink">
          <Icon name="life-buoy" size={17} className="text-primary" />
          {text('Support')}
        </h1>
        {orgs && orgs.options.length > 1 ? <OrgSwitcher variant="field" multiple allowAll orgs={orgs.options} value={orgs.value} onChange={orgs.onChange} label={text('Organizations')} /> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 scroll-thin">
        <h2 className="px-2 pt-1 pb-1 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{text('Views')}</h2>
        <ul role="list" className="flex flex-col gap-px">
          {list.map((v) => {
            const on = savedId === null && v.key === view;
            const count = NO_COUNT.has(v.key) ? 0 : (v.count ?? 0);
            return (
              <li key={v.key}>
                <button
                  type="button"
                  aria-current={on ? 'page' : undefined}
                  onClick={() => onView(v.key)}
                  className={cx('flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[13px]', on ? 'bg-selection font-semibold text-primary' : 'text-ink-2 hover:bg-subtle hover:text-ink')}
                >
                  <Icon name={VIEW_ICON[v.key] ?? 'list'} size={15} className={on ? 'text-primary' : 'text-ink-3'} />
                  <span className="min-w-0 flex-1 truncate">{text(v.label)}</span>
                  {count ? <CountBadge n={count} tone={v.key === 'overdue' ? 'badge' : v.key === 'unassigned' ? 'amber' : 'muted'} /> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {saved.length ? (
          <>
            <h2 className="px-2 pt-4 pb-1 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{text('Saved views')}</h2>
            <ul role="list" className="flex flex-col gap-px">
              {saved.map((s) => {
                const on = savedId === s.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-current={on ? 'page' : undefined}
                      onClick={() => onSaved(s)}
                      title={s.scope === 'shared' ? text('Shared with the desk') : text('Only you')}
                      className={cx('flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[13px]', on ? 'bg-selection font-semibold text-primary' : 'text-ink-2 hover:bg-subtle hover:text-ink')}
                    >
                      <Icon name={s.scope === 'shared' ? 'users' : 'bookmark'} size={15} className={on ? 'text-primary' : 'text-ink-3'} />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      {s.count ? <CountBadge n={s.count} tone="muted" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </div>
      {footer ? <div className="shrink-0 pb-2">{footer}</div> : null}
    </nav>
  );
}
