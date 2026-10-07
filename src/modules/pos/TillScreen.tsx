import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card } from '../../components/ui';
import { toast } from '../../core/toasts';
import { PK, refreshCatalogue, renameDevice, setTillSettings, syncNow, useTillSettings } from './api';
import { Checkbox } from '../../components/Checkbox';
import { useT } from './i18n';
import { Note, timeOf, useTillContext } from './parts';

/** This computer as a till: which till, its receipt numbering, its catalogue copy and what it has still to send. */
export default function TillScreen() {
  const t = useT();
  const till = useTillContext();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState('');
  const s = till.status;
  const p = s.till!;

  async function run(what: string, fn: () => Promise<unknown>, done: string) {
    setBusy(what);
    try {
      await fn();
      toast('success', done);
      void qc.invalidateQueries({ queryKey: PK.all });
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  const row = (label: string, value: string | number | null | undefined) => (
    <div className="flex justify-between gap-4 py-1 text-[13px]">
      <span className="text-ink-2">{label}</span>
      <span className="text-right font-semibold text-ink tabular-nums">{value ?? '—'}</span>
    </div>
  );

  return (
    <div className="flex max-w-[760px] flex-col gap-4 p-6">
      <h1 className="text-[22px] font-extrabold text-ink">{p.terminal.name}</h1>
      <Card title="The till">
        {row('Code', p.terminal.code)}
        {row('Company', p.terminal.org_name)}
        {row('Branch', p.terminal.branch_name)}
        {row('Warehouse', p.terminal.warehouse_name)}
        {row('Paired', timeOf(p.paired_at))}
        {row('Receipt numbers', `${p.prefix}-000001 …`)}
        {row('State', p.state === 'paired' ? 'Paired' : p.state === 'pos_off' ? (s.problem ?? 'POS is switched off on WorkSuite. An administrator turns it on in Admin Centre → Apps → POS.') : 'Not accepted — pair again')}
      </Card>
      {till.caps.device_rename ? (
        <Card title={t('pos.dev.title')}>
          <p className="mb-2 text-[13px] text-ink-2">{t('pos.dev.hint')}</p>
          <div className="flex gap-2">
            <input
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value.slice(0, 120))}
              aria-label={t('pos.dev.name')}
              placeholder={t('pos.dev.name')}
              className="h-9 min-w-0 flex-1 rounded-[8px] border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-primary"
            />
            <Button size="sm" loading={busy === 'name'} disabled={till.offline || !name.trim()} onClick={() => void run('name', async () => setName((await renameDevice(name.trim())).device_name), t('pos.dev.done'))}>
              {t('pos.dev.save')}
            </Button>
          </div>
        </Card>
      ) : null}
      <Card
        title="Catalogue"
        action={
          <Button size="sm" icon="refresh" loading={busy === 'cat'} disabled={till.offline} onClick={() => void run('cat', () => refreshCatalogue(till.options ? !!till.caps.catalogue : undefined), 'The catalogue is up to date.')}>
            {t('pos.refreshCatalogue')}
          </Button>
        }
      >
        {s.catalogue ? (
          <>
            {row('Products', s.catalogue.products)}
            {row('Brought up to date', timeOf(s.catalogue.fetched_at))}
            {row('Version', s.catalogue.version)}
            {s.catalogue.thumbs ? row('Pictures kept for offline', `${s.catalogue.thumbs.count} · ${(s.catalogue.thumbs.bytes / 1048576).toFixed(1)} MB`) : null}
            {s.syncing ? <Note tone="indigo">{s.syncing.total ? t('pos.sync.progress', { done: s.syncing.done, total: s.syncing.total }) : t('pos.sync.progressSome', { done: s.syncing.done })}</Note> : null}
            {s.catalogue.error ? <Note tone="warning">{t('pos.sync.catalogueError', { why: s.catalogue.error })}</Note> : null}
            {row('From', s.catalogue.source === 'pos' ? 'WorkSuite’s till catalogue' : 'Inventory’s product list')}
            {s.catalogue.truncated ? <Note tone="warning">More products than a copy keeps: the rest are found by scanning while WorkSuite answers.</Note> : null}
          </>
        ) : (
          <Note>{t('pos.noCatalogue')}</Note>
        )}
        {!s.can_keep ? <p className="mt-2 text-[12px] text-ink-3">Your organization does not let this computer keep data offline: the copy is kept in memory until the app closes.</p> : null}
      </Card>
      <OfflineSettings />
      <Card
        title="Sending"
        action={
          <Button size="sm" icon="upload" loading={busy === 'sync'} onClick={() => void run('sync', () => syncNow({ catalogue: true }), 'Sent what was waiting.')}>
            {t('pos.sendNow')}
          </Button>
        }
      >
        {row('Waiting', s.waiting)}
        {row('Refused', s.refused)}
        {row('WorkSuite', s.reachable ? 'Answering' : 'Out of reach')}
        {row('Last heard from', timeOf(s.last_contact))}
        {!s.can_queue ? <p className="mt-2 text-[12px] text-ink-3">Your organization does not let this computer keep changes to send later: while WorkSuite is known to be out of reach, the till does not sell.</p> : null}
      </Card>
    </div>
  );
}

/**
 * The till's own settings on this computer (worksuite-desktop#296): a card taken while WorkSuite is out of reach (off:
 * cash only — nothing verifies a card offline), how often the catalogue is brought up to date, and how much room its
 * pictures may take offline.
 */
function OfflineSettings() {
  const t = useT();
  const qc = useQueryClient();
  const settings = useTillSettings();
  const [minutes, setMinutes] = useState<string | null>(null);
  const [mb, setMb] = useState<string | null>(null);
  const s = settings.data;
  if (!s) return null;
  async function save(patch: Parameters<typeof setTillSettings>[0]) {
    try {
      qc.setQueryData(PK.tillSettings, await setTillSettings(patch));
      toast('success', t('pos.set.saved'));
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'That did not work.');
    }
  }
  const field = 'h-9 w-24 rounded-[8px] border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-primary';
  return (
    <Card title={t('pos.set.title')}>
      <label className="flex items-start gap-3 py-1 text-[13px]">
        <Checkbox className="mt-1" checked={s.card_offline} onChange={(e) => void save({ card_offline: e.target.checked })} />
        <span>
          <span className="block font-semibold text-ink">{t('pos.set.cardOffline')}</span>
          <span className="block text-ink-3">{t('pos.set.cardOfflineHint')}</span>
        </span>
      </label>
      <label className="flex items-center justify-between gap-3 py-1 text-[13px]">
        <span className="text-ink-2">{t('pos.set.minutes')}</span>
        <input
          className={field}
          inputMode="numeric"
          value={minutes ?? String(s.catalogue_minutes)}
          onChange={(e) => setMinutes(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onBlur={() => {
            const n = Number(minutes);
            if (minutes !== null && Number.isInteger(n) && n >= 5 && n <= 1440 && n !== s.catalogue_minutes) void save({ catalogue_minutes: n });
            setMinutes(null);
          }}
        />
      </label>
      <label className="flex items-center justify-between gap-3 py-1 text-[13px]">
        <span className="text-ink-2">{t('pos.set.thumbs')}</span>
        <input
          className={field}
          inputMode="numeric"
          value={mb ?? String(s.thumbs_mb)}
          onChange={(e) => setMb(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onBlur={() => {
            const n = Number(mb);
            if (mb !== null && mb !== '' && Number.isInteger(n) && n >= 0 && n <= 4096 && n !== s.thumbs_mb) void save({ thumbs_mb: n });
            setMb(null);
          }}
        />
      </label>
    </Card>
  );
}
