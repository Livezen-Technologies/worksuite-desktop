/**
 * W04 Queue & posting slots (WS-SMM-SRS-001 p.45, design Q-Queue; SMM-SCH-006..008, SMM-SCH-010, WF-07, AC-09): weekly
 * slots per brand or account, the queue in order (drag to reorder, pause, shuffle) and evergreen recycling. Queued
 * posts fill slots; explicitly timed posts never move when the queue changes.
 */
import { useMutation } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Button, cx, Switch } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { errorMessage } from '../../../core/bridge';
import { parseTs } from '../../../core/time';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { dataOf, rowsOf, SK, socialApi, useAccounts, useBrands, useInvalidate, useModuleStatus, useQueue, type Account, type QueueInfo, type QueueItem } from '../api';
import { useSocialAccess } from '../access';
import { ConfirmButton, NetChip, Notice, OptionalView, PageBody, PageHeader, Panel, PanelLink, TargetStatusPill, UnderlineTabs, useBrandScope } from '../parts';
import { networkInfo } from '../lib/networks';
import { excerpt } from '../lib/text';
import { brandClock, currentZone, hhmm, inZone, WEEKDAYS_SHORT } from '../lib/time';
import { SlotGrid } from './plan/SlotGrid';

type Scope = { brand_id: number | null; account_id: number | null };

/** A tab's name: the handle when two accounts share a display name ("@techhubiz.lk"), else the name. */
function tabName(a: Account, all: Account[]): string {
  const twin = all.some((b) => b.id !== a.id && b.display_name === a.display_name);
  if (!twin) return a.display_name;
  return a.handle?.startsWith('@') ? a.handle : `${a.display_name} ${networkInfo(a.network).label}`;
}

export default function Queue() {
  const status = dataOf(useModuleStatus().data);
  const access = useSocialAccess(status?.permissions);
  const brands = rowsOf(useBrands().data);
  const accounts = rowsOf(useAccounts().data);
  const [scopeBrand] = useBrandScope();
  const brand = brands.find((b) => b.id === scopeBrand) ?? brands[0] ?? null;
  const brandId = brand?.id ?? scopeBrand;
  const mine = accounts.filter((a) => brandId === null || a.brand_id === brandId);

  const [rawTab, setTab] = useState('all');
  const tab = mine.some((a) => `a${a.id}` === rawTab) ? rawTab : 'all';
  const accountId = tab === 'all' ? null : Number(tab.slice(1));
  const scope: Scope = { brand_id: brandId, account_id: accountId };
  const q = useQueue(scope);
  const info = dataOf(q.data);
  const invalidate = useInvalidate();

  const pause = useMutation({
    mutationFn: (paused: boolean) => socialApi.pauseQueue(scope, paused),
    onSuccess: (_r, paused) => {
      invalidate(SK.queueAll, SK.postsAll);
      toast('success', paused ? 'Queue paused. Queued posts keep their order and wait.' : 'Queue resumed.');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const shuffle = useMutation({
    mutationFn: () => socialApi.reorderQueue(scope, { shuffle: true }),
    onSuccess: () => {
      invalidate(SK.queueAll, SK.postsAll);
      toast('success', 'Queue shuffled. Timed posts stayed where they are.');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const scopeKey = `${brandId ?? 'none'}-${accountId ?? 'all'}`;

  return (
    <>
      <PageHeader
        crumb="Queue"
        title="Queue & posting slots"
        actions={
          access.publish ? (
            <>
              <Button size="sm" icon={info?.paused ? 'play' : 'pause'} disabled={!info} loading={pause.isPending} onClick={() => info && pause.mutate(!info.paused)}>
                {info?.paused ? 'Resume queue' : 'Pause queue'}
              </Button>
              {info ? <ConfirmButton size="sm" variant="secondary" icon="refresh" label="Shuffle queue" confirm="Shuffle now" loading={shuffle.isPending} onConfirm={() => shuffle.mutate()} /> : null}
            </>
          ) : null
        }
      />
      <PageBody>
        <div className="mx-auto flex max-w-[1240px] flex-col gap-4">
          <UnderlineTabs
            label="Queue for"
            value={tab}
            onChange={setTab}
            tabs={[{ id: 'all', label: brand ? `${brand.name} · all accounts` : 'All accounts' }, ...mine.map((a) => ({ id: `a${a.id}`, label: tabName(a, mine) }))]}
          />
          <OptionalView q={q} what="The queue">
            {(data) => (
              <>
                {data.paused ? (
                  <Notice tone="warning" icon="pause">
                    <b>The queue is paused.</b> Queued posts keep their order and wait; explicitly timed posts still go out.
                  </Notice>
                ) : null}
                <SlotGrid key={scopeKey} info={data} scope={scope} canEdit={access.publish} canBlackouts={access.settings} />
                <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                  <NextInQueue key={`${scopeKey}-${q.dataUpdatedAt}`} info={data} scope={scope} canReorder={access.publish} brandTz={brand?.timezone ?? data.timezone} />
                  <Evergreen key={`${scopeKey}-${q.dataUpdatedAt}`} info={data} brandId={brandId} canEdit={access.publish} aiEnabled={status?.ai_enabled ?? true} />
                </div>
              </>
            )}
          </OptionalView>
        </div>
      </PageBody>
    </>
  );
}

/* ------------------------------------------------------------------------ */

/** "Mon 13 · 10:00" on the viewer's clock. */
function slotLabel(stamp: string | null, tz: string): string {
  if (!stamp) return 'Next free slot';
  const p = inZone(stamp, tz);
  return `${WEEKDAYS_SHORT[p.weekday - 1]} ${p.ymd.slice(8)} · ${hhmm(p.minutes)}`;
}

function untilLabel(ymd: string): string {
  return parseTs(ymd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Mounted afresh with each answer from the server, so the local order is only ever a pending move. */
function NextInQueue({ info, scope, canReorder, brandTz }: { info: QueueInfo; scope: Scope; canReorder: boolean; brandTz: string }) {
  const { go } = useTab();
  const [tz] = useState(() => currentZone());
  const [items, setItems] = useState<QueueItem[]>(info.next);
  const [dragging, setDragging] = useState<number | null>(null);
  const invalidate = useInvalidate();

  const reorder = useMutation({
    mutationFn: (v: { next: QueueItem[]; prev: QueueItem[] }) => socialApi.reorderQueue(scope, { target_ids: v.next.map((i) => i.target_id) }),
    onSuccess: () => invalidate(SK.queueAll, SK.postsAll),
    onError: (e, v) => {
      setItems(v.prev);
      toast('error', errorMessage(e));
    },
  });

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= items.length) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it!);
    const prev = items;
    setItems(next);
    reorder.mutate({ next, prev });
  };

  const sub = [canReorder ? 'Drag to reorder' : null, `${info.queued_total} ${info.queued_total === 1 ? 'post' : 'posts'}`, info.fills_until ? `fills slots until ${untilLabel(info.fills_until)}` : null].filter(Boolean).join(' · ');

  return (
    <Panel title="Next in queue" action={<span className="text-[12px] text-ink-3">{sub}</span>}>
      {items.length ? (
        <ol aria-label="Next in queue" className="flex flex-col">
          {items.map((it, i) => (
            <li
              key={it.target_id}
              draggable={canReorder}
              onDragStart={(e) => {
                setDragging(i);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(it.target_id));
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => {
                if (dragging !== null) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging !== null) move(dragging, i);
                setDragging(null);
              }}
              className={cx('group flex min-w-0 items-center gap-3 border-b border-line/70 py-2 last:border-b-0', dragging === i && 'opacity-50')}
            >
              {canReorder ? <Icon name="grip" size={15} className="shrink-0 cursor-grab text-ink-3" /> : null}
              <span className="w-[104px] shrink-0 font-mono text-[12px] text-ink-2 tabular-nums" title={brandClock(it.run_at, brandTz, tz) ?? undefined}>
                {slotLabel(it.run_at, tz)}
              </span>
              <NetChip network={it.network} size={20} />
              <button type="button" onClick={() => go(`/social-media/posts/${it.post_id}`)} className="min-w-0 flex-1 truncate text-left text-[13px] text-ink hover:text-primary">
                {excerpt(it.excerpt, 110)}
              </button>
              {canReorder ? (
                <span className="hidden items-center group-focus-within:flex group-hover:flex">
                  <button type="button" aria-label={`Move “${excerpt(it.excerpt, 40)}” up`} disabled={i === 0} onClick={() => move(i, i - 1)} className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle disabled:opacity-30">
                    <Icon name="arrow-up" size={13} />
                  </button>
                  <button type="button" aria-label={`Move “${excerpt(it.excerpt, 40)}” down`} disabled={i === items.length - 1} onClick={() => move(i, i + 1)} className="flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle disabled:opacity-30">
                    <Icon name="arrow-down" size={13} />
                  </button>
                </span>
              ) : null}
              <TargetStatusPill status={it.status} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-3 text-[13px] text-ink-3">Nothing is in the queue. “Add to queue” in the composer puts a post in the next free slot.</p>
      )}
      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-3">
        <Icon name="info" size={13} /> Explicitly timed posts never move when the queue changes.
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ */

function Evergreen({ info, brandId, canEdit, aiEnabled }: { info: QueueInfo; brandId: number | null; canEdit: boolean; aiEnabled: boolean }) {
  const { go } = useTab();
  const [ev, setEv] = useState(info.evergreen);
  const [days, setDays] = useState(String(info.evergreen.skip_days || 60));
  const invalidate = useInvalidate();
  const save = useMutation({
    mutationFn: (v: { next: QueueInfo['evergreen']; prev: QueueInfo['evergreen'] }) => socialApi.saveEvergreen({ brand_id: brandId }, v.next),
    onSuccess: () => invalidate(SK.queueAll),
    onError: (e, v) => {
      setEv(v.prev);
      toast('error', errorMessage(e));
    },
  });
  const put = (patch: Partial<QueueInfo['evergreen']>) => {
    const next = { ...ev, ...patch };
    const prev = ev;
    setEv(next);
    save.mutate({ next, prev });
  };
  const daysN = Number(days);
  const daysOk = /^\d{1,3}$/.test(days) && daysN > 0;

  return (
    <Panel title="Evergreen recycling">
      <div className="flex flex-col gap-3.5">
        <Row id="ev-reshare" title="Re-share evergreen posts" hint="When the queue has an empty slot">
          <Switch label="Re-share evergreen posts" describedBy="ev-reshare" checked={ev.reshare} disabled={!canEdit} onChange={(v) => put({ reshare: v })} />
        </Row>
        <Row
          id="ev-skip"
          title={
            <span className="inline-flex flex-wrap items-center gap-1">
              Skip posts shared in the last
              {canEdit && ev.skip_days > 0 ? (
                <input
                  aria-label="Days"
                  inputMode="numeric"
                  value={days}
                  onChange={(e) => setDays(e.target.value.trim())}
                  onBlur={() => daysOk && daysN !== ev.skip_days && put({ skip_days: daysN })}
                  className="h-6 w-12 rounded-[6px] border border-line bg-surface px-1 text-center text-[12.5px] font-semibold text-ink outline-none focus:border-primary"
                />
              ) : (
                <b>{ev.skip_days || daysN || 60}</b>
              )}
              days
            </span>
          }
        >
          <Switch label="Skip recently shared posts" describedBy="ev-skip" checked={ev.skip_days > 0} disabled={!canEdit} onChange={(v) => put({ skip_days: v ? (daysOk ? daysN : 60) : 0 })} />
        </Row>
        <Row id="ev-ai" title="Rewrite caption with AI before re-sharing" hint={aiEnabled ? 'Needs approval when on' : 'AI for Social is off for this organisation'}>
          <Switch label="Rewrite caption with AI before re-sharing" describedBy="ev-ai" checked={ev.ai_rewrite} disabled={!canEdit || !aiEnabled} onChange={(v) => put({ ai_rewrite: v })} />
        </Row>
        <p className="flex flex-wrap items-center gap-1 border-t border-line pt-3 text-[12.5px] text-ink-3">
          Evergreen pool: <b className="text-ink">{ev.pool} posts</b> in
          <PanelLink onClick={() => go('/social-media/library')}>Content library</PanelLink>
        </p>
      </div>
    </Panel>
  );
}

function Row({ id, title, hint, children }: { id: string; title: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div id={id} className="min-w-0">
        <div className="text-[13px] font-semibold text-ink">{title}</div>
        {hint ? <div className="text-[11.5px] text-ink-3">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}
