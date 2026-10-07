import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { PK, syncNow, useSales } from './api';
import { clockOf } from './syncstate';
import { useT, type PosKey } from './i18n';
import { PosButton, PosDialog, type Till } from './parts';
import { formatMoney } from './pricing';

/**
 * Where the till stands with WorkSuite, from the till bar's pill: online or selling offline, when WorkSuite last
 * answered, Try now, what keeps working and what waits for the connection, and the sales waiting to be sent (or
 * refused) in the order they go — each kept sealed on this computer under its till number, so sending it twice
 * records it once.
 */
const clock = (iso: string | null) => clockOf(iso);

export default function SyncDrawer({ till, onClose }: { till: Till; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const s = till.status;
  const online = !till.offline && s.reachable;
  const sales = useSales({});
  const queue = (sales.data ?? []).filter((x) => x.state !== 'sent').sort((a, b) => a.created_at.localeCompare(b.created_at));
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      // Sync now: the sales waiting and the catalogue both (worksuite-desktop#296).
      await syncNow({ catalogue: true });
      void qc.invalidateQueries({ queryKey: PK.till });
      void qc.invalidateQueries({ queryKey: PK.catalogue });
      void qc.invalidateQueries({ queryKey: ['pos', 'sales'] });
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'The sales could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  const last = clock(s.last_contact);
  return (
    <PosDialog label={t('pos.sync.label')} onClose={onClose} width={560} place="right" className="gap-3.5 p-6">
      <div className="flex items-center gap-3">
        <span className={cx('flex h-touch w-touch shrink-0 items-center justify-center rounded-[12px]', online ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning')}>
          <Icon name={online ? 'cloud' : 'cloud-off'} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[19px] font-extrabold">{online ? t('pos.sync.online') : t('pos.sync.offline')}</h2>
          <p className="text-[13px] text-ink-3">{[last ? t('pos.sync.last', { at: last }) : t('pos.sync.never'), t('pos.sync.retry')].join(' · ')}</p>
        </div>
        <PosButton tone="primary" className="h-touch text-[14px]" disabled={busy || !!s.syncing} onClick={() => void send()}>
          {busy || s.syncing ? <Icon name="spinner" size={16} className="animate-spin" /> : null}
          {t(online ? 'pos.sync.now' : 'pos.sync.try')}
        </PosButton>
      </div>
      <CatalogueState till={till} />
      {!online ? (
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-pos bg-pos-key px-3.5 py-3">
            <div className="text-[12px] text-ink-3">{t('pos.sync.works')}</div>
            <div className="text-[13px] font-semibold">{t('pos.sync.worksList', { at: clock(s.catalogue?.fetched_at ?? null) ?? '—' })}</div>
          </div>
          <div className="rounded-pos bg-danger-bg px-3.5 py-3">
            <div className="text-[12px] text-danger">{t('pos.sync.waits')}</div>
            <div className="text-[13px] font-semibold">{t('pos.sync.waitsList')}</div>
          </div>
        </div>
      ) : null}
      {s.problem ? <div className="rounded-pos bg-danger-bg px-3.5 py-3 text-[13px] font-semibold text-danger">{s.problem}</div> : null}
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-bold">{t('pos.sync.waiting', { n: queue.length })}</div>
        <div className="text-[12px] text-ink-3">{t(s.can_keep ? 'pos.sync.sealed' : 'pos.sync.memory')}</div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-thin">
        {queue.length === 0 ? <p className="py-6 text-center text-[13px] text-ink-3">{t('pos.sync.none')}</p> : null}
        {queue.map((x) => (
          <button
            key={x.ref}
            type="button"
            onClick={() => {
              onClose();
              till.go('sales', { sale: x.ref });
            }}
            className="flex items-center gap-3 border-b border-pos-line/60 py-2.5 text-left hover:bg-pos-key"
          >
            <span className="w-[150px] shrink-0 truncate font-mono text-[13px] font-bold text-primary">{x.ref}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{[clock(x.created_at), [...new Set(x.tenders.map((m) => t(`pos.${m.method}` as PosKey)))].join(' + ')].filter(Boolean).join(' · ')}</span>
            <span className="w-[90px] text-right font-mono text-[14px] font-bold">{formatMoney(x.totals.total)}</span>
            <span className={cx('rounded-full px-2.5 py-0.5 text-[11px] font-bold', x.state === 'refused' ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning-ink')}>{t(x.state === 'refused' ? 'pos.refusedOne' : 'pos.sync.queued')}</span>
          </button>
        ))}
      </div>
      <div className="rounded-[12px] bg-pos-key px-3.5 py-3 text-[12px] text-ink-2">{t('pos.sync.foot')}</div>
    </PosDialog>
  );
}

/** The catalogue copy: how many products, when it was last brought up to date, a sync under way, why one failed. */
function CatalogueState({ till }: { till: Till }) {
  const t = useT();
  const s = till.status;
  const c = s.catalogue;
  const sync = s.syncing;
  return (
    <div className="flex flex-col gap-1.5 rounded-pos bg-pos-key px-3.5 py-3 text-[13px]" aria-live="polite">
      <div className="font-semibold">{c ? t('pos.sync.catalogue', { n: c.products.toLocaleString(), at: clockOf(c.fetched_at) ?? '—' }) : t('pos.sync.catalogueNever')}</div>
      <div className="text-[12px] text-ink-3">{t('pos.sync.salesLast', { at: clockOf(s.last_sync) ?? t('pos.bar.never') })}</div>
      {sync ? (
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-primary">{sync.total ? t('pos.sync.progress', { done: sync.done.toLocaleString(), total: sync.total.toLocaleString() }) : t('pos.sync.progressSome', { done: sync.done.toLocaleString() })}</span>
          {sync.total ? (
            <span className="h-1.5 overflow-hidden rounded-full bg-white" role="progressbar" aria-valuemin={0} aria-valuemax={sync.total} aria-valuenow={sync.done}>
              <span className="block h-full bg-primary" style={{ width: `${Math.min(100, Math.round((sync.done / Math.max(1, sync.total)) * 100))}%` }} />
            </span>
          ) : null}
        </div>
      ) : null}
      {!sync && c?.stale ? <div className="text-[12px] font-semibold text-warning-ink">{t('pos.sync.catalogueStale')}</div> : null}
      {c?.error ? <div className="text-[12px] text-danger">{t('pos.sync.catalogueError', { why: c.error })}</div> : null}
    </div>
  );
}
