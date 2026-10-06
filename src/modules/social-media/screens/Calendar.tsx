/**
 * W03 Calendar and the D01 week view (WS-SMM-SRS-001 pp.44, 54; designs K-Calendar, D01-Desktop): everything planned
 * across brands and networks by month, week or list (SMM-SCH-002/003), coloured by status, filtered by brand, account,
 * network, campaign, label, status and owner. Dragging a post reschedules it (SMM-SCH-004, WF-08: never one that is
 * out or going out; the server re-checks approvals); dragging an unscheduled draft onto a day queues it at that
 * account's next free slot (SMM-SCH-005). Times are on the viewer's clock, the brand's on hover (SMM-SCH-011). View
 * and day live in the route (`?view=month|week|list&date=YYYY-MM-DD`, also `&campaign=`). Posts are bucketed by day
 * once per data change (NFR-08).
 */
import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button, cx } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { errorMessage } from '../../../core/bridge';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import {
  accountById,
  brandById,
  dataOf,
  postNetworks,
  rowsOf,
  SK,
  socialApi,
  useAccounts,
  useBrands,
  useCampaigns,
  useInvalidate,
  useModuleStatus,
  usePosts,
  type Account,
  type Post,
  type ScheduleMode,
} from '../api';
import { canPublishOn, useSocialAccess, type SocialAccess } from '../access';
import { Check, Field, NativeSelect, NetChips, NotOffered, Notice, PageBody, PageHeader, Panel, Refused, Segmented, useBrandScope } from '../parts';
import { NETWORKS, networkInfo } from '../lib/networks';
import { CALENDAR_BUCKETS, calendarBucket, canReschedule, POST_STATUS, TONE_SOLID, type CalendarBucket, type PostStatus } from '../lib/status';
import { excerpt } from '../lib/text';
import { addDays, brandClock, currentZone, todayInZone, zonedToUtc } from '../lib/time';
import { bucketByDay, rangeLabel, step, viewDays, writeDrag, type CalendarView, type DragPayload, type Placed } from './plan/calendar-model';
import { ListView, MonthGrid, WeekGrid } from './plan/calendar-views';

const VIEWS: Array<{ id: CalendarView; label: string }> = [
  { id: 'month', label: 'Month' },
  { id: 'week', label: 'Week' },
  { id: 'list', label: 'List' },
];

const isView = (v: string | null): v is CalendarView => v === 'month' || v === 'week' || v === 'list';
const isYmd = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

interface Filters {
  account: number | null;
  network: string | null;
  label: string | null;
  status: PostStatus | null;
  owner: number | null;
}

const NO_FILTERS: Filters = { account: null, network: null, label: null, status: null, owner: null };

const REFUSED_MOVE = 'Already publishing or published — it can’t be moved';

/** May move this post: social.post.publish and Publish on each of its accounts (SMM-ACC-011). */
function mayMove(access: SocialAccess, post: Post, accounts: Account[]): boolean {
  if (!accounts.length) return access.publish;
  return canPublishOn(
    access,
    post.targets.map((t) => accountById(accounts, t.account_id) ?? { my_level: null }),
  );
}

export default function Calendar() {
  const { go, query } = useTab();
  const access = useSocialAccess(dataOf(useModuleStatus().data)?.permissions);
  const [brand, setBrand] = useBrandScope();
  const [today] = useState(() => todayInZone());
  const [tz] = useState(() => currentZone());
  const view: CalendarView = isView(query.get('view')) ? (query.get('view') as CalendarView) : 'month';
  const anchor = isYmd(query.get('date')) ? query.get('date')! : today;
  const campaignRaw = query.get('campaign');
  const campaign = campaignRaw && /^\d+$/.test(campaignRaw) ? Number(campaignRaw) : null;

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [hidden, setHidden] = useState<CalendarBucket[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const setQuery = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(query);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    go(`/social-media/calendar?${next.toString()}`);
  };

  const days = useMemo(() => viewDays(view === 'week' ? 'week' : 'month', anchor), [view, anchor]);
  const from = zonedToUtc(days[0]!, 0, tz);
  const to = zonedToUtc(addDays(days[days.length - 1]!, 1), 0, tz);

  const postsQ = usePosts({ from, to, brand_id: brand, account_id: filters.account, network: filters.network, status: filters.status, label: filters.label, campaign_id: campaign, owner_id: filters.owner });
  const unscheduledQ = usePosts({ unscheduled: true, brand_id: brand });
  const accounts = rowsOf(useAccounts().data);
  const brands = rowsOf(useBrands().data);
  const campaigns = rowsOf(useCampaigns().data);

  const all = useMemo(() => rowsOf(postsQ.data), [postsQ.data]);
  const visible = useMemo(
    () =>
      all.filter(
        (p) =>
          (brand === null || p.brand_id === brand) &&
          (campaign === null || p.campaign_id === campaign) &&
          (filters.account === null || p.targets.some((t) => t.account_id === filters.account)) &&
          (filters.network === null || p.targets.some((t) => t.network === filters.network)) &&
          (filters.status === null || p.status === filters.status) &&
          (filters.label === null || p.labels.includes(filters.label)) &&
          (filters.owner === null || p.owner?.id === filters.owner) &&
          !hidden.includes(calendarBucket(p.status)),
      ),
    [all, brand, campaign, filters, hidden],
  );
  const byDay = useMemo(() => bucketByDay(visible, tz), [visible, tz]);
  const drafts = rowsOf(unscheduledQ.data).filter((p) => brand === null || p.brand_id === brand);

  const invalidate = useInvalidate();
  const schedule = useMutation({
    mutationFn: (v: { id: number; mode: ScheduleMode; at: string }) => socialApi.schedule(v.id, { mode: v.mode, at: v.at, timezone: tz }),
    onSuccess: (res, v) => {
      invalidate(SK.postsAll, SK.queueAll);
      if (res?.post?.status === 'in_review') toast('info', 'Moved — it goes back to review because the approval policy asks for it');
      else toast('success', v.mode === 'queue' ? 'Added to the queue at the account’s next free slot that day.' : 'Moved.');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const onDrop = (drag: DragPayload, ymd: string, minutes: number | null) => {
    if (drag.kind === 'draft') {
      const post = drafts.find((p) => p.id === drag.id);
      if (!post) return;
      if (!mayMove(access, post, accounts)) return toast('warning', 'Scheduling needs Publish on every account of the post.');
      schedule.mutate({ id: post.id, mode: 'queue', at: zonedToUtc(ymd, 0, tz) });
      return;
    }
    let placed: Placed | undefined;
    for (const list of byDay.values()) placed ??= list.find((x) => x.post.id === drag.id);
    if (!placed) return;
    if (!canReschedule(placed.post.status)) return toast('warning', REFUSED_MOVE);
    if (!mayMove(access, placed.post, accounts)) return toast('warning', 'Moving a post needs Publish on every account of the post.');
    const m = minutes ?? placed.minutes;
    if (placed.ymd === ymd && placed.minutes === m) return;
    schedule.mutate({ id: placed.post.id, mode: 'at', at: zonedToUtc(ymd, m, tz) });
  };

  const hoverOf = (p: Placed) => brandClock(p.at, brandById(brands, p.post.brand_id)?.timezone, tz);
  const compose = (ymd: string) => go(`/social-media/compose?date=${ymd}`);
  const open = (id: number) => go(`/social-media/posts/${id}`);
  const activeFilters = Object.values(filters).filter((v) => v !== null).length + (campaign !== null ? 1 : 0);
  const viewProps = { days, byDay, today, hoverOf, onOpen: open, onCompose: compose, onDrop, canCompose: access.create };

  return (
    <>
      <PageHeader
        crumb="Calendar"
        title="Calendar"
        actions={
          <>
            <Button size="sm" icon="filter" aria-expanded={filtersOpen} aria-controls="calendar-filters" onClick={() => setFiltersOpen(!filtersOpen)}>
              {activeFilters ? `Filters (${activeFilters})` : 'Filters'}
            </Button>
            {access.create ? (
              <Button size="sm" variant="primary" icon="plus" onClick={() => go('/social-media/compose')}>
                Create post
              </Button>
            ) : null}
          </>
        }
      />
      <PageBody>
        <div className="flex min-w-0 flex-col gap-3">
          {filtersOpen ? (
            <FilterPanel
              filters={filters}
              onChange={setFilters}
              brand={brand}
              onBrand={setBrand}
              campaign={campaign}
              onCampaign={(id) => setQuery({ campaign: id === null ? null : String(id) })}
              brands={brands}
              accounts={accounts.filter((a) => brand === null || a.brand_id === brand)}
              campaigns={campaigns.filter((c) => brand === null || c.brand_id === brand)}
              posts={all}
              onClear={() => {
                setFilters(NO_FILTERS);
                if (campaign !== null) setQuery({ campaign: null });
              }}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-1">
              <button type="button" aria-label={view === 'week' ? 'Previous week' : 'Previous month'} onClick={() => setQuery({ date: step(view, anchor, -1) })} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle">
                <Icon name="chevron-left" size={16} />
              </button>
              <h2 className="min-w-[150px] text-center text-[16px] font-bold text-ink" aria-live="polite">
                {rangeLabel(view, anchor)}
              </h2>
              <button type="button" aria-label={view === 'week' ? 'Next week' : 'Next month'} onClick={() => setQuery({ date: step(view, anchor, 1) })} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle">
                <Icon name="chevron-right" size={16} />
              </button>
            </div>
            <Button size="sm" onClick={() => setQuery({ date: today })}>
              Today
            </Button>
            <Segmented label="View" value={view} options={VIEWS} onChange={(v) => setQuery({ view: v })} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1" role="group" aria-label="Show statuses">
              {CALENDAR_BUCKETS.map((b) => (
                <Check key={b.id} checked={!hidden.includes(b.id)} swatch={TONE_SOLID[b.tone]} onChange={(on) => setHidden(on ? hidden.filter((x) => x !== b.id) : [...hidden, b.id])}>
                  {b.label}
                </Check>
              ))}
            </div>
          </div>
          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="flex min-w-0 flex-col gap-3">
              {postsQ.data?.offered === false ? <NotOffered what="The calendar’s posts" compact /> : null}
              {postsQ.error ? <Refused error={postsQ.error} onRetry={() => void postsQ.refetch()} /> : null}
              {view === 'month' ? <MonthGrid month={anchor} {...viewProps} /> : view === 'week' ? <WeekGrid {...viewProps} /> : <ListView {...viewProps} days={days.filter((d) => d.slice(0, 7) === anchor.slice(0, 7))} />}
            </div>
            <Unscheduled q={unscheduledQ} drafts={drafts} canDrag={access.publish} onOpen={open} tz={tz} />
          </div>
        </div>
      </PageBody>
    </>
  );
}

/* ------------------------------------------------------------------------ */

function Unscheduled({ q, drafts, canDrag, onOpen, tz }: { q: ReturnType<typeof usePosts>; drafts: Post[]; canDrag: boolean; onOpen: (id: number) => void; tz: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Panel title="Unscheduled" sub={canDrag ? 'Drag a draft onto a day to schedule it at that account’s next free slot.' : 'Drafts without a time. Scheduling needs the Publish permission.'}>
        {q.data?.offered === false ? (
          <NotOffered what="Unscheduled drafts" compact />
        ) : q.error ? (
          <Refused error={q.error} onRetry={() => void q.refetch()} />
        ) : drafts.length ? (
          <ul className="flex flex-col gap-2" aria-label="Unscheduled drafts">
            {drafts.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  draggable={canDrag}
                  onDragStart={(e) => writeDrag(e.dataTransfer, { kind: 'draft', id: p.id })}
                  onClick={() => onOpen(p.id)}
                  className={cx('flex w-full flex-col gap-1.5 rounded-[10px] border border-line bg-surface p-2.5 text-left hover:border-primary/50', canDrag && 'cursor-grab')}
                >
                  <span className="flex items-center justify-between gap-2">
                    <NetChips networks={postNetworks(p)} size={18} max={4} />
                    <span className="text-[11px] text-ink-3">{POST_STATUS[p.status]?.label ?? p.status}</span>
                  </span>
                  <span className="line-clamp-2 text-[12.5px] text-ink">{p.internal_title || excerpt(p.base_text, 90)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : q.data ? (
          <p className="text-[12.5px] text-ink-3">No unscheduled drafts.</p>
        ) : null}
      </Panel>
      <Notice tone="info" icon="clock">
        <b>Times shown in {tz}.</b> Posts publish in each account’s own schedule; moving a post re-checks approvals.
      </Notice>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function FilterPanel({
  filters,
  onChange,
  brand,
  onBrand,
  campaign,
  onCampaign,
  brands,
  accounts,
  campaigns,
  posts,
  onClear,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  brand: number | null;
  onBrand: (id: number | null) => void;
  campaign: number | null;
  onCampaign: (id: number | null) => void;
  brands: Array<{ id: number; name: string }>;
  accounts: Account[];
  campaigns: Array<{ id: number; name: string }>;
  posts: Post[];
  onClear: () => void;
}) {
  const labels = useMemo(() => [...new Set(posts.flatMap((p) => p.labels))].sort(), [posts]);
  const owners = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of posts) if (p.owner) m.set(p.owner.id, p.owner.name);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [posts]);
  const num = (v: string) => (v ? Number(v) : null);
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  return (
    <section id="calendar-filters" aria-label="Filters" className="grid gap-3 rounded-[14px] border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      <Field label="Brand">
        <NativeSelect label="Brand" value={brand === null ? '' : String(brand)} onChange={(v) => onBrand(num(v))}>
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Account">
        <NativeSelect label="Account" value={filters.account === null ? '' : String(filters.account)} onChange={(v) => set({ account: num(v) })}>
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.display_name} · {networkInfo(a.network).label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Network">
        <NativeSelect label="Network" value={filters.network ?? ''} onChange={(v) => set({ network: v || null })}>
          <option value="">All networks</option>
          {NETWORKS.map((n) => (
            <option key={n} value={n}>
              {networkInfo(n).label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Campaign">
        <NativeSelect label="Campaign" value={campaign === null ? '' : String(campaign)} onChange={(v) => onCampaign(num(v))}>
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          {campaign !== null && !campaigns.some((c) => c.id === campaign) ? <option value={campaign}>Campaign {campaign}</option> : null}
        </NativeSelect>
      </Field>
      <Field label="Label">
        <NativeSelect label="Label" value={filters.label ?? ''} onChange={(v) => set({ label: v || null })}>
          <option value="">All labels</option>
          {labels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Status">
        <NativeSelect label="Status" value={filters.status ?? ''} onChange={(v) => set({ status: (v || null) as PostStatus | null })}>
          <option value="">All statuses</option>
          {(Object.keys(POST_STATUS) as PostStatus[]).map((s) => (
            <option key={s} value={s}>
              {POST_STATUS[s].label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Owner">
        <div className="flex gap-2">
          <NativeSelect label="Owner" value={filters.owner === null ? '' : String(filters.owner)} onChange={(v) => set({ owner: num(v) })}>
            <option value="">Anyone</option>
            {owners.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </NativeSelect>
          <Button size="sm" variant="ghost" onClick={onClear} className="h-9">
            Clear
          </Button>
        </div>
      </Field>
    </section>
  );
}
