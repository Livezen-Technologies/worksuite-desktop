import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { relative, timeLabel, dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, Kpi, Panel, Seg, Sheet, SidePanel } from '../hr/parts';
import {
  addChannel,
  cancelSync,
  channelAct,
  channelTone,
  fetchChannel,
  fetchChannelLogs,
  fetchChannels,
  fetchSyncs,
  KM,
  removeChannel,
  shopDay,
  span,
  startSync,
  statusWords,
  stepSync,
  TONE_CHIP,
  updateChannel,
  type Abilities,
  type ChannelKind,
  type SyncRun,
} from './manage';
import { Checkbox } from '../../components/Checkbox';
import { SyncButton } from '../../components/SyncButton';
import { StatGrid } from '../../components/StatCard';

/**
 * Sales channels (OmsChannelSheet): where orders come from. Every kind the
 * server can speak to is listed, set up or not, so a fresh installation
 * shows what could be added. A kind with several channels shows the worst
 * of their statuses. A channel points at a record kept elsewhere (a shop,
 * a CRM connection, an API key) instead of holding its own credentials, so
 * removing one here leaves that record alone. The status is the driver's
 * answer now, not what was stored the last time somebody pressed Test.
 */
export default function Channels({ org }: { org: string }) {
  const q = useQuery({ queryKey: KM.channels(org), queryFn: ({ signal }) => fetchChannels(org, signal) });
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState<ChannelKind | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const { catalogue, orgs, can } = q.data!;

  return (
    <div className="flex flex-col gap-3.5">
      <Panel title="Sales Channels" bodyClassName="flex flex-col">
        {catalogue.map((k) => {
          const tone = channelTone(k.status);
          const one = k.count === 1 ? k.channels[0]! : null;
          return (
            <div key={k.kind} data-channel-kind={k.kind} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-3 last:border-b-0">
              <span className="flex w-[240px] shrink-0 flex-col gap-1">
                <span className="flex items-center gap-2">
                  <b className="text-ink">{k.label}</b>
                  <span className={cx('rounded-[10px] px-2 py-0.5 text-[11.5px] font-bold whitespace-nowrap', TONE_CHIP[tone])}>{statusWords(k.status)}</span>
                </span>
                {k.count > 1 ? <span className="text-[11.5px] text-ink-3">{k.count} set up</span> : null}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-[12.5px] text-ink-2">
                {k.count === 0 ? (
                  <span>{k.blurb}</span>
                ) : (
                  k.channels.map((c) => (
                    <button key={c.id} type="button" className="flex min-w-0 items-center gap-1.5 text-left hover:text-primary" onClick={() => setOpenId(c.id)}>
                      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', { ok: 'bg-success', bad: 'bg-danger', warn: 'bg-warning', busy: 'bg-primary', idle: 'bg-ink-3' }[channelTone(c.tone)])} />
                      <b className="truncate text-ink">{c.name}</b>
                      <span className="truncate">· {c.detail}</span>
                    </button>
                  ))
                )}
              </span>
              <span className="flex shrink-0 gap-2">
                {k.count === 0 ? (
                  <button type="button" className={btnPrimary + ' !h-[30px]'} disabled={!can.create} onClick={() => setAdding(k)}>
                    Set up
                  </button>
                ) : (
                  <button type="button" className={btnSmall} onClick={() => setOpenId(one?.id ?? k.channels[0]!.id)}>
                    Open
                  </button>
                )}
                {k.count > 0 && can.create ? (
                  <button type="button" className={btnSmall} onClick={() => setAdding(k)}>
                    Add another
                  </button>
                ) : null}
              </span>
            </div>
          );
        })}
      </Panel>
      <Panel title="How these fit together" bodyClassName="px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-2">
        Every channel turns what it receives into a sales order in Inventory → Selling; Orders then takes it through approval, fulfilment and completion. A channel points at a record that already exists — a shop, a CRM connection, an API key — so a key is still rotated where it is kept, and removing a channel here leaves that record untouched.
      </Panel>
      {openId !== null ? <ChannelPanel id={openId} org={org} can={can} onClose={() => setOpenId(null)} /> : null}
      {adding ? <AddChannel k={adding} orgs={orgs} onClose={() => setAdding(null)} onAdded={(id) => (setAdding(null), setOpenId(id))} /> : null}
    </div>
  );
}

function AddChannel({ k, orgs, onClose, onAdded }: { k: ChannelKind; orgs: Array<{ id: number; name: string }>; onClose: () => void; onAdded: (id: number) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [ref, setRef] = useState('');
  const [orgId, setOrgId] = useState('0');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      const r = await addChannel({ kind: k.kind, name: name.trim(), ref_id: ref === '' ? null : Number(ref), org_id: Number(orgId) });
      toast('success', `${name.trim()} added.`);
      void qc.invalidateQueries({ queryKey: ['sales', 'channels'] });
      if (r?.id) onAdded(r.id);
      else onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Add a ${k.label} channel`}
      width={480}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !name.trim() || (k.needs_ref && ref === '')} onClick={() => void add()}>
            {busy ? 'Adding…' : 'Add channel'}
          </button>
        </>
      }
    >
      <p className="m-0 rounded-[10px] bg-subtle px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">{k.note}</p>
      <Field label="Name">
        <input aria-label="Name" value={name} placeholder={`${k.label} channel`} onChange={(e) => setName(e.target.value)} className={input} autoFocus />
      </Field>
      <Field
        label="Points at"
        hint={k.needs_ref && !k.available.length ? <span className="text-warning-ink dark:text-warning">Nothing is set up yet. Set one up {k.made_in ?? 'in Billing'} first, then it appears here.</span> : undefined}
      >
        <Select<string>
          aria-label="Points at"
          searchable
          value={ref}
          onValueChange={setRef}
          options={[{ value: '', label: k.needs_ref ? 'Choose…' : 'Nothing — no record needed' }, ...k.available.map((a) => ({ value: String(a.id), label: a.name, hint: a.detail ?? undefined }))]}
          className={input}
        />
      </Field>
      <Field label="Company" hint="Decides which company the channel's orders belong to.">
        <Select<string> aria-label="Company" searchable value={orgId} onValueChange={setOrgId} options={[{ value: '0', label: 'Not tied to one company' }, ...orgs.map((o) => ({ value: String(o.id), label: o.name }))]} className={input} />
      </Field>
    </Sheet>
  );
}

type Tab = 'connection' | 'mapping' | 'sync' | 'logs';

function ChannelPanel({ id, org, can, onClose }: { id: number; org: string; can: Abilities; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KM.channel(id), queryFn: ({ signal }) => fetchChannel(id, org, signal) });
  const [tab, setTab] = useState<Tab>('connection');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const sync = useSyncDriver(id);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KM.channel(id) });
    void qc.invalidateQueries({ queryKey: ['sales', 'channels'] });
    void qc.invalidateQueries({ queryKey: KM.channelLogs(id) });
  };
  const act = async (what: 'test' | 'sync') => {
    setBusy(true);
    try {
      const r = await channelAct(id, what);
      toast(r.data?.ok === false ? 'error' : 'success', r.message ?? (what === 'test' ? 'Tested.' : 'Synced.'));
      refresh();
      return r.data?.ok !== false;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const save = async (body: Record<string, unknown>) => {
    try {
      await updateChannel(id, body);
      toast('success', 'Saved.');
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await removeChannel(id, org);
      toast('success', 'Channel removed.');
      void qc.invalidateQueries({ queryKey: ['sales', 'channels'] });
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const d = q.data;
  const c = d?.channel;

  return (
    <SidePanel
      label={c ? `Channel ${c.name}` : 'Channel'}
      width={560}
      onClose={onClose}
      head={
        c && d ? (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-[15px] text-ink">{c.name}</b>
              <span className="truncate text-[12px] text-ink-3">
                {d.describe.label} · {c.status_label}
              </span>
            </span>
            {can.connect ? (
              <button type="button" className={btnSmall} disabled={busy} onClick={() => void act('test')}>
                Test
              </button>
            ) : null}
            {can.sync ? (
              <SyncButton
                size="sm"
                running={sync.driving}
                disabled={busy && !sync.driving}
                onSync={async () => {
                  if (d.pull) {
                    setTab('sync');
                    await sync.start();
                  } else if (!(await act('sync'))) throw new Error('sync failed');
                }}
              />
            ) : null}
          </>
        ) : (
          <b className="text-ink">Channel</b>
        )
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : c && d ? (
        <>
          <Seg<Tab>
            label="Channel"
            value={tab}
            onChange={setTab}
            options={[
              { id: 'connection', label: 'Connection' },
              { id: 'mapping', label: 'Mapping' },
              { id: 'sync', label: 'Sync' },
              ...(can.view_logs !== false ? [{ id: 'logs' as const, label: 'Logs' }] : []),
            ]}
          />
          {c.last_error ? <p className="m-0 rounded-[10px] border border-danger-line bg-danger-bg px-3 py-2 text-[12.5px] text-danger">Last failure: {c.last_error}</p> : null}
          {tab === 'connection' ? (
            <div className="flex flex-col gap-2.5 text-[12.5px]">
              <p className="m-0 rounded-[10px] bg-subtle px-3 py-2 leading-relaxed text-ink-2">{d.describe.note}</p>
              {d.webhook ? (
                <div className="rounded-[10px] border border-line px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">Deliver orders to</span>
                    <button type="button" className="ml-auto font-semibold text-primary hover:underline" onClick={() => void navigator.clipboard.writeText(d.webhook!).then(() => toast('success', 'Address copied.'))}>
                      Copy
                    </button>
                  </div>
                  <code className="mt-1 block font-mono text-[11.5px] break-all text-ink">{d.webhook}</code>
                  <p className="mt-1.5 mb-0 text-[11.5px] leading-relaxed text-ink-3">
                    {c.kind === 'woocommerce'
                      ? 'In WooCommerce: Settings → Advanced → Webhooks. Topic "Order created" (and "Order updated"), this address, and the store\'s secret. Orders are made from them only while "Make orders from the shop\'s webhook" is on, in Sync.'
                      : `Have the other system POST its orders here as JSON, with the ${d.auth_method?.method === 'bearer' ? 'Authorization: Bearer' : d.auth_method?.method === 'hmac' ? 'X-Api-Key and an X-Signature HMAC' : 'X-Api-Key'} header${d.auth_method?.prefix ? `, carrying the key that starts ${d.auth_method.prefix}` : ''}.`}
                  </p>
                </div>
              ) : null}
              {[
                ['Points at', c.ref_table ? `${c.ref_table} #${c.ref_id ?? '—'}` : 'Nothing — no record needed'],
                ['Company', c.org ?? 'Not tied to one company'],
                ['Last recorded outcome', c.stored_status],
                ['Added', c.created_at ? dateLabel(c.created_at) : '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <span className="w-[160px] shrink-0 text-ink-3">{k}</span>
                  <span className="min-w-0 flex-1 font-semibold text-ink">{v}</span>
                </div>
              ))}
              {can.edit ? (
                <label className="flex items-center gap-2 pt-1 font-semibold text-ink">
                  <Checkbox checked={c.enabled} onChange={(e) => void save({ enabled: e.target.checked })} />
                  Use this channel
                </label>
              ) : null}
              {can.delete ? (
                <button type="button" className="self-start pt-1 font-semibold text-danger hover:underline" onClick={() => setRemoving(true)}>
                  Remove this channel
                </button>
              ) : null}
            </div>
          ) : null}
          {tab === 'mapping' ? (
            d.mappings.length ? (
              <div className="flex flex-col gap-2.5">
                {d.mappings.map((m) => (
                  <Field key={m.key} label={m.label} hint={m.help}>
                    <Select<string> aria-label={m.label} disabled={!can.edit} value={c.mappings[m.key] ?? ''} onValueChange={(v) => void save({ mappings: { ...c.mappings, [m.key]: v } })} options={[{ value: '', label: 'Not set' }, ...m.options]} className={input} />
                  </Field>
                ))}
              </div>
            ) : (
              <Empty text="This channel has nothing to map. Its values are used as they arrive." />
            )
          ) : null}
          {tab === 'sync' ? (
            <div className="flex flex-col gap-3">
              {d.pull ? (
                <SyncPanel id={id} name={c.name} canSync={!!can.sync} sync={sync} />
              ) : (
                <>
                  <StatGrid min={150}>
                    <Kpi icon="download" tone="blue" label="Imported" value={c.imported.toLocaleString()} />
                    <Kpi icon="x-circle" label="Failed" value={c.failed.toLocaleString()} tone={c.failed ? 'red' : undefined} />
                    <Kpi icon="clock" label="Last delivery" value={c.last_sync_at ? relative(c.last_sync_at) : 'Never'} />
                  </StatGrid>
                  <span className="text-[11.5px] text-ink-3">From the last delivery, not a lifetime total — so a count that starts failing shows.</span>
                </>
              )}
              {can.edit && c.kind === 'woocommerce' ? (
                <label className="flex items-start gap-2 border-t border-line/60 pt-3 text-[13px] font-semibold text-ink">
                  <Checkbox checked={c.auto_sync} onChange={(e) => void save({ auto_sync: e.target.checked })} className="mt-0.5" />
                  <span>
                    Make orders from the shop's webhook as they arrive
                    <span className="block text-[11.5px] font-medium text-ink-3">Off, deliveries are still logged but no order is made from them. Sync now works either way.</span>
                  </span>
                </label>
              ) : null}
            </div>
          ) : null}
          {tab === 'logs' ? <Logs id={id} /> : null}
          {removing ? (
            <Sheet
              title={`Remove ${c.name}?`}
              width={420}
              onClose={() => setRemoving(false)}
              footer={
                <>
                  <button type="button" className={btn} onClick={() => setRemoving(false)}>
                    Cancel
                  </button>
                  <button type="button" className={btnPrimary + ' !bg-danger hover:!opacity-90'} disabled={busy} onClick={() => void remove()}>
                    {busy ? 'Removing…' : 'Remove'}
                  </button>
                </>
              }
            >
              <p className="m-0 text-[13px] text-ink-2">Orders stops using it. The shop, connection or key it points at is untouched — its credentials and history stay where they are.</p>
            </Sheet>
          ) : null}
        </>
      ) : null}
    </SidePanel>
  );
}

function Logs({ id }: { id: number }) {
  const q = useQuery({ queryKey: KM.channelLogs(id), queryFn: ({ signal }) => fetchChannelLogs(id, signal) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const rows = q.data?.rows ?? [];
  if (!rows.length) return <Empty text="Nothing has been recorded for this channel yet." />;
  return (
    <div className="overflow-hidden rounded-[10px] border border-line">
      <div className="flex gap-2.5 border-b border-line bg-ground px-3 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
        <span className="w-[110px] shrink-0">When</span>
        <span className="min-w-0 flex-1">Action</span>
        <span className="w-[130px] shrink-0">Result</span>
        <span className="w-[100px] shrink-0">Who</span>
      </div>
      {rows.map((l) => (
        <div key={l.id} className="flex gap-2.5 border-b border-line/60 px-3 py-2 text-[12.5px] last:border-b-0">
          <span className="w-[110px] shrink-0 text-ink-3">{l.at ? relative(l.at) : '—'}</span>
          <span className="min-w-0 flex-1 text-ink">
            {l.action}
            {l.error ? <span className="block text-danger">{l.error}</span> : null}
          </span>
          <span className="w-[130px] shrink-0">
            <span className={cx('rounded-[10px] px-2 py-0.5 text-[11.5px] font-bold', TONE_CHIP[l.status === 'ok' ? 'ok' : l.status === 'failed' ? 'bad' : 'idle'])}>{l.status}</span>
            {l.imported || l.updated || l.failed ? (
              <span className="ml-1.5 text-[11.5px] text-ink-3 tabular-nums">
                {l.imported}↓ {l.updated}↻ {l.failed}✗
              </span>
            ) : null}
          </span>
          <span className="w-[100px] shrink-0 truncate text-ink-3">{l.user ?? 'System'}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * A shop sync is driven by the screen: the server does one page (fifty
 * orders) per request, so this asks for the next page until the run says it
 * is done. Cancel stops asking and tells the server; closing the panel
 * mid-run leaves it "interrupted", and opening it again offers to carry on.
 */
function useSyncDriver(id: number) {
  const qc = useQueryClient();
  const [live, setLive] = useState<SyncRun | null>(null);
  const [driving, setDriving] = useState(false);
  const stop = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop.current = true;
    };
  }, []);
  const settle = () => {
    for (const k of [KM.syncs(id), KM.channel(id), KM.channelLogs(id), ['sales', 'channels'], ['sales', 'orders'], ['sales', 'overview']]) void qc.invalidateQueries({ queryKey: k });
  };
  const drive = async (first: SyncRun) => {
    stop.current = false;
    setDriving(true);
    setLive(first);
    let run = first;
    try {
      while (run.status === 'running' && !stop.current && mounted.current) {
        run = await stepSync(id, run.id);
        // Cancelled while this page was in flight: its "still running" is older than the cancel.
        if (stop.current) break;
        if (mounted.current) setLive(run);
      }
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      if (mounted.current) setDriving(false);
      settle();
    }
    if (run.status === 'done' && mounted.current) toast('success', run.created > 0 ? `${run.created} new ${run.created === 1 ? 'order' : 'orders'} brought in.` : 'Up to date — no new orders.');
  };
  const start = async () => {
    try {
      await drive(await startSync(id));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const cancel = async (run: SyncRun) => {
    stop.current = true;
    try {
      const r = await cancelSync(id, run.id);
      if (mounted.current) setLive(r);
    } catch (e) {
      toast('error', errorMessage(e));
    }
    settle();
  };
  return { live, driving, start, drive, cancel };
}

function SyncPanel({ id, name, canSync, sync }: { id: number; name: string; canSync: boolean; sync: ReturnType<typeof useSyncDriver> }) {
  const [details, setDetails] = useState(false);
  // Another screen may be driving a run; follow it rather than take it over.
  const q = useQuery({ queryKey: KM.syncs(id), queryFn: ({ signal }) => fetchSyncs(id, signal), refetchInterval: (query) => (!sync.driving && query.state.data?.current && !query.state.data.current.interrupted ? 2000 : false) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data!;
  const current = sync.driving ? sync.live : d.current;
  const last = !sync.driving && sync.live && sync.live.status !== 'running' ? sync.live : d.last;
  return (
    <>
      {current && current.status === 'running' ? (
        <Running run={current} name={name} driving={sync.driving} canSync={canSync} onCancel={() => void sync.cancel(current)} onResume={() => void sync.drive(current)} />
      ) : canSync ? (
        <div className="flex items-center gap-3 rounded-[10px] border border-line px-3 py-2.5 text-[12.5px] text-ink-2">
          <Icon name="refresh" size={16} className="shrink-0 text-primary" />
          <span className="min-w-0 flex-1">Brings in the shop's orders placed since the newest one already here. Orders already here are left as they are.</span>
          <SyncButton variant="primary" running={sync.driving} onSync={() => sync.start()} />
        </div>
      ) : null}
      {last ? (
        <section aria-label="Last sync" className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <b className="flex-1 text-ink">Last sync</b>
            <span className="text-[11.5px] text-ink-3">{d.last_done_at ? `Last successful sync ${relative(d.last_done_at)}` : 'No successful sync yet'}</span>
          </div>
          <StatGrid min={150}>
            <Kpi icon="cart" tone="blue" label="Orders" value={last.created.toLocaleString()} sub={`new · ${last.duplicate} already here`} />
            <Kpi icon="users" tone="violet" label="Customers" value={last.customers_new.toLocaleString()} sub={`new · ${last.customers_matched} known`} />
            <Kpi icon="list" tone="cyan" label="Order lines" value={last.lines.toLocaleString()} sub="with the new orders" />
            <Kpi icon="warning" label="Needs a look" value={last.refused.toLocaleString()} sub={`refused · ${last.skipped} carts skipped`} tone={last.refused ? 'red' : undefined} />
          </StatGrid>
          <div className={cx('flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12.5px]', last.status === 'done' ? TONE_CHIP.ok : last.status === 'cancelled' ? TONE_CHIP.idle : TONE_CHIP.bad)}>
            <span className="min-w-0 flex-1">
              {last.status === 'done'
                ? last.created > 0
                  ? `Sync complete — ${last.created} new ${last.created === 1 ? 'order' : 'orders'}.`
                  : 'Sync complete — nothing new since the last order here.'
                : last.status === 'cancelled'
                  ? `Cancelled after ${last.page}${last.pages ? ` of ${last.pages}` : ''} ${last.page === 1 ? 'page' : 'pages'}. What it brought in stays.`
                  : `Sync failed: ${last.error ?? 'no reason given'}`}
            </span>
            <span className="tabular-nums opacity-80">Took {span(last.elapsed)}</span>
            <button type="button" className="font-semibold hover:underline" onClick={() => setDetails((v) => !v)}>
              {details ? 'Hide details' : 'Details'}
            </button>
          </div>
          {details ? (
            <div className="flex flex-col gap-1 rounded-[10px] border border-line px-3 py-2 text-[12px] text-ink-2">
              <span>
                Orders placed since {shopDay(last.window_from)} · {last.seen.toLocaleString()} checked across {last.page} {last.page === 1 ? 'page' : 'pages'}
                {last.finished_at ? ` · finished ${dateLabel(last.finished_at)}, ${timeLabel(last.finished_at)}` : ''}
              </span>
              {last.problems.length ? (
                last.problems.map((p, i) => (
                  <span key={`${p.ref}-${i}`}>
                    <b className="text-ink">{p.ref}</b> — {p.why}
                  </span>
                ))
              ) : (
                <span className="text-ink-3">Nothing was refused.</span>
              )}
            </div>
          ) : null}
        </section>
      ) : !current ? (
        <p className="m-0 rounded-[10px] bg-subtle px-3 py-2 text-[12.5px] text-ink-3">No sync has run from here yet.</p>
      ) : null}
    </>
  );
}

function Running({ run, name, driving, canSync, onCancel, onResume }: { run: SyncRun; name: string; driving: boolean; canSync: boolean; onCancel: () => void; onResume: () => void }) {
  const connected = run.connected_at !== null;
  const pct = run.total ? Math.min(100, Math.round((run.seen / run.total) * 100)) : null;
  const steps: Array<{ label: string; right: string; state: 'done' | 'active' | 'waiting'; sub?: string }> = [
    { label: 'Connecting to the shop', right: connected ? timeLabel(run.connected_at) : '', state: connected ? 'done' : 'active' },
    { label: `Finding orders placed since ${shopDay(run.window_from)}`, right: run.total !== null ? `${run.total.toLocaleString()} found` : '', state: run.total !== null ? 'done' : connected ? 'active' : 'waiting' },
    {
      label: 'Bringing orders in',
      right: run.total !== null ? `${run.seen.toLocaleString()} / ${run.total.toLocaleString()}` : '',
      state: connected ? 'active' : 'waiting',
      sub: connected ? `${run.created} new · ${run.duplicate} already here · ${run.skipped} unpaid carts skipped · ${run.refused} refused` : undefined,
    },
    { label: 'Finishing', right: '', state: 'waiting' },
  ];
  return (
    <section aria-label="Sync in progress" className="flex flex-col gap-2.5 rounded-[10px] border border-line p-3">
      <div className="flex items-start gap-2.5">
        <span className="min-w-0 flex-1">
          <b className="block text-ink">Bringing orders in from {name}</b>
          <span className="text-[11.5px] text-ink-3">Orders placed since {shopDay(run.window_from)}</span>
        </span>
        {canSync ? (
          run.interrupted && !driving ? (
            <button type="button" className={btnPrimary + ' !h-[30px]'} onClick={onResume}>
              Carry on
            </button>
          ) : (
            <button type="button" className={btnSmall} onClick={onCancel}>
              Cancel
            </button>
          )
        ) : null}
      </div>
      {run.interrupted && !driving ? (
        <p className="m-0 rounded-[8px] bg-warning-bg px-2.5 py-1.5 text-[12px] text-warning-ink dark:text-warning">
          This sync stopped at page {run.page}
          {run.pages ? ` of ${run.pages}` : ''} when the screen driving it closed. Carry on picks it up from there; nothing is brought in twice.
        </p>
      ) : null}
      {steps.map((s) => (
        <span key={s.label} className={cx('flex items-start gap-2.5 rounded-[8px] px-1.5 py-1 text-[12.5px]', s.state === 'active' && 'bg-selection/50')}>
          <span className={cx('mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold', s.state === 'done' ? 'bg-success text-white' : s.state === 'active' ? 'border-2 border-primary' : 'border-[1.5px] border-line')}>
            {s.state === 'done' ? <Icon name="check" size={11} /> : null}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex gap-2">
              <span className={cx('flex-1', s.state === 'waiting' ? 'text-ink-3' : 'text-ink')}>{s.label}</span>
              <span className="text-[12px] text-ink-3 tabular-nums">{s.right}</span>
            </span>
            {s.sub ? <span className="text-[11.5px] text-ink-3">{s.sub}</span> : null}
          </span>
        </span>
      ))}
      <span className="h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
        <span className={cx('block h-2 rounded-full bg-primary', pct === null && 'w-1/4 animate-pulse')} style={pct === null ? undefined : { width: `${pct}%` }} />
      </span>
      <span className="flex justify-between text-[11.5px] text-ink-3 tabular-nums">
        <span>{pct !== null ? `${pct}%` : 'Connecting…'}</span>
        <span>
          Elapsed {span(run.elapsed)}
          {run.eta !== null && run.eta > 0 ? ` · about ${span(run.eta)} left` : ''}
        </span>
      </span>
    </section>
  );
}
