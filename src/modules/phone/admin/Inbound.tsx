import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../../core/api';
import { toast } from '../../../core/toasts';
import { Button, Chip, cx, Empty, Modal, Spinner } from '../../../components/ui';
import { isNotOffered, NOT_OFFERED, phoneApi, PK, rowsOf, useInbound, useIvrs, useTrunks, type Destination, type InboundRoute, type IvrFlow } from '../api';
import { isoDay, prettyNumber } from '../lib/format';
import { checkTimeSpec, describeTimeSpec } from '../lib/timespec';
import { ConfirmButton, Field, INPUT, Mono, Notice, NotOffered, PageBody, PageHeader, Panel, TEXTAREA } from '../parts';
import { runPhone } from '../softphone/client';
import { DestinationPicker, describeDest, resolves, useTargets } from './Destination';
import { Checkbox } from '../../../components/Checkbox';

/**
 * A07 · Inbound & IVR builder (VOIP-IVR-01/02, VOIP-FWD-06, G-05). Each number (DID) with where it goes while open
 * and while closed; the menu it opens, built visually — greeting (text or a Drive file), behaviour, a destination
 * for each key with a warning when one points at something deleted — and after-hours and holiday handling, which
 * reads the HR holiday calendar.
 */
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '*', '#'];

export default function Inbound() {
  const qc = useQueryClient();
  const inbound = useInbound();
  const ivrs = useIvrs();
  const [did, setDid] = useState<number | null>(null);
  const [ivr, setIvr] = useState<number | 'new' | null>(null);
  const [addDid, setAddDid] = useState<InboundRoute | 'new' | null>(null);
  const dids = rowsOf(inbound.data);
  const flows = rowsOf(ivrs.data);
  const current = dids.find((d) => d.id === did) ?? dids[0] ?? null;
  const ivrFor = (d: Destination | null) => (d?.kind === 'ivr' ? (flows.find((f) => String(f.number) === d.value || String(f.id) === d.value) ?? null) : null);
  const shown = ivr === 'new' ? null : ivr !== null ? (flows.find((f) => f.id === ivr) ?? null) : ivrFor(current?.open_dest ?? null) ?? flows[0] ?? null;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: PK.inbound });
    void qc.invalidateQueries({ queryKey: PK.ivrs });
  };
  if (inbound.isLoading || ivrs.isLoading) return <Spinner />;
  if (inbound.data?.offered === false && ivrs.data?.offered === false) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Inbound & IVR" />
        <NotOffered what="Inbound numbers and the IVR builder" detail="Today the switch sends every inbound call straight to the dialled extension (G-05)." />
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Inbound & IVR"
        actions={
          <>
            <Button icon="phone" disabled={!shown?.number} onClick={() => void runPhone({ cmd: 'dial', number: String(shown?.number ?? ''), name: shown?.name ?? 'Menu' }).then((r) => !r.ok && toast('error', r.message))} title="Call the menu from your phone to hear it">
              Preview call
            </Button>
            <Button icon="plus" disabled={ivrs.data?.offered === false} onClick={() => setIvr('new')}>
              New menu
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <Panel title="Numbers (DIDs)" action={inbound.data?.offered ? <Button size="sm" icon="plus" onClick={() => setAddDid('new')}>Add</Button> : null} bodyClassName="px-0 pb-2">
            {inbound.data?.offered === false ? (
              <p className="px-4 text-[12px] text-ink-3">{NOT_OFFERED} Inbound routing by number needs it (G-05).</p>
            ) : dids.length ? (
              <ul>
                {dids.map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => (setDid(d.id), setIvr(null))} className={cx('flex w-full flex-col gap-0.5 px-4 py-2.5 text-left hover:bg-subtle', current?.id === d.id && 'bg-selection')}>
                      <span className="flex items-center justify-between gap-2">
                        <Mono className="text-[13px] font-bold">{prettyNumber(d.did)}</Mono>
                        <span className="text-[11px] text-ink-3">{d.trunk ?? ''}</span>
                      </span>
                      <span className="text-[11.5px] text-ink-2">Open: {describeDest(d.open_dest)}</span>
                      <span className="text-[11.5px] text-ink-3">Closed: {describeDest(d.closed_dest)}</span>
                    </button>
                    {current?.id === d.id ? (
                      <div className="px-4 pb-2">
                        <Button size="sm" onClick={() => setAddDid(d)}>
                          Edit routing
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon="phone-incoming" title="No numbers yet" hint="Add each DID your trunks deliver, and where it goes when open, closed and on holidays." />
            )}
          </Panel>
          {ivr === 'new' || shown ? (
            <IvrBuilder key={ivr === 'new' ? 'new' : shown!.id} flow={ivr === 'new' ? null : shown} did={current} onSaved={refresh} />
          ) : (
            <Panel title="Menus">
              <Empty icon="git-branch" title="No menus" hint="Create a menu (IVR) to greet callers and let them press a key." />
            </Panel>
          )}
        </div>
      </PageBody>
      {addDid ? <DidEditor route={addDid === 'new' ? null : addDid} onClose={() => setAddDid(null)} onSaved={() => (setAddDid(null), refresh())} /> : null}
    </div>
  );
}

function useNextHoliday() {
  return useQuery({
    queryKey: ['phone', 'next-holiday'],
    queryFn: async ({ signal }) => {
      const year = new Date().getFullYear();
      const r = await apiGet<{ holidays: Array<{ on_date: string; name: string }> }>('/api/hr/holidays', { year }, signal);
      const today = isoDay(new Date());
      return (r.holidays ?? []).filter((h) => h.on_date >= today).sort((a, b) => a.on_date.localeCompare(b.on_date))[0] ?? null;
    },
    retry: false,
    staleTime: 60 * 60_000,
  });
}

function IvrBuilder({ flow, did, onSaved }: { flow: IvrFlow | null; did: InboundRoute | null; onSaved: () => void }) {
  const t = useTargets();
  const holiday = useNextHoliday();
  const [f, setF] = useState<IvrFlow>(
    () =>
      flow ?? { id: 0, name: 'Main menu', number: '', greeting: 'Thank you for calling. For sales press 1, support 2, accounts 3, or 0 for reception.', greeting_file_id: null, nodes: {}, timeout: 5, repeat: 2, direct_dial: true, invalid_to: null, timeout_to: null, hours: '08:30-18:00,mon-fri,*,*', enabled: true },
  );
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<IvrFlow>) => setF((x) => ({ ...x, ...p }));
  const broken = Object.entries(f.nodes).filter(([, d]) => !resolves(d, t));
  const hoursOk = !f.hours || checkTimeSpec(f.hours).ok;
  const save = async () => {
    setSaving(true);
    try {
      await phoneApi.saveIvr(flow?.id || null, f);
      toast('success', 'Menu saved. Apply the configuration to make it live.');
      onSaved();
    } catch (e) {
      toast(isNotOffered(e) ? 'info' : 'error', isNotOffered(e) ? NOT_OFFERED : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Panel
      title={`${f.name}${did ? ` · ${prettyNumber(did.did)}` : f.number ? ` · ${f.number}` : ''}`}
      action={
        <span className="flex items-center gap-2">
          {did?.open_now !== undefined && did?.open_now !== null ? <Chip tone={did.open_now ? 'success' : 'muted'}>{did.open_now ? 'Open now' : 'Closed now'}{f.hours ? ` · ${describeTimeSpec(f.hours)}` : ''}</Chip> : null}
          {flow ? <ConfirmButton size="sm" label="Delete" confirm="Delete menu" variant="secondary" onConfirm={() => void phoneApi.deleteIvr(flow.id).then(onSaved, (e: Error) => toast('error', e.message))} /> : null}
          <Button variant="primary" loading={saving} disabled={!f.name.trim() || !hoursOk} onClick={() => void save()}>
            Save menu
          </Button>
        </span>
      }
      bodyClassName="flex flex-col gap-4"
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex flex-col gap-2 rounded-[10px] border border-primary/20 bg-selection p-3">
          <span className="text-[11px] font-bold tracking-[.3px] text-primary uppercase">Greeting</span>
          <textarea value={f.greeting ?? ''} onChange={(e) => set({ greeting: e.target.value })} rows={3} aria-label="Greeting" className={TEXTAREA} />
          <span className="text-[11.5px] text-ink-3">{f.greeting_file ? `Recorded: ${f.greeting_file} · from Drive` : 'Read out with text-to-speech, or record it and choose the file from Drive › Telephony.'}</span>
        </div>
        <div className="flex flex-col gap-2 rounded-[10px] border border-line p-3 text-[12.5px]">
          <span className="text-[11px] font-bold tracking-[.3px] text-ink-3 uppercase">Behaviour</span>
          <label className="flex items-center justify-between gap-2">
            Wait for a key
            <input value={String(f.timeout)} onChange={(e) => set({ timeout: Number(e.target.value.replace(/\D/g, '')) || 5 })} aria-label="Wait seconds" className={cx(INPUT, 'h-8 w-16')} />
          </label>
          <label className="flex items-center justify-between gap-2">
            Repeat
            <input value={String(f.repeat ?? 2)} onChange={(e) => set({ repeat: Number(e.target.value.replace(/\D/g, '')) || 0 })} aria-label="Repeat times" className={cx(INPUT, 'h-8 w-16')} />
          </label>
          <label className="flex items-center gap-1.5">
            <Checkbox checked={!!f.direct_dial} onChange={(e) => set({ direct_dial: e.target.checked })} /> Callers may dial extensions directly
          </label>
          <Field label="Name">
            <input value={f.name} onChange={(e) => set({ name: e.target.value })} aria-label="Menu name" className={cx(INPUT, 'h-8')} />
          </Field>
          <Field label="Internal number">
            <input value={f.number ?? ''} onChange={(e) => set({ number: e.target.value.replace(/\D/g, '') })} aria-label="Menu number" className={cx(INPUT, 'h-8 font-mono')} />
          </Field>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
        {KEYS.map((k) => {
          const d = f.nodes[k] ?? null;
          const ok = resolves(d, t);
          return (
            <div key={k} className={cx('flex items-center gap-2 rounded-[10px] border p-2', d ? (ok ? 'border-line' : 'border-danger/40 bg-danger-bg') : 'border-dashed border-line')}>
              <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] font-mono text-[15px] font-bold', d ? 'bg-ink text-surface' : 'bg-subtle text-ink-3')}>{k}</span>
              <div className="min-w-0 flex-1">
                <DestinationPicker
                  label={`Key ${k}`}
                  value={d}
                  onChange={(nd) => set({ nodes: { ...f.nodes, [k]: nd } })}
                />
              </div>
              {d ? (
                <button type="button" aria-label={`Clear key ${k}`} onClick={() => set({ nodes: Object.fromEntries(Object.entries(f.nodes).filter(([x]) => x !== k)) })} className="text-[11px] font-semibold text-ink-3 hover:text-danger">
                  Clear
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div className="rounded-[10px] border border-line p-3 text-[12.5px]">
          <b>After hours</b> → {describeDest(did?.closed_dest ?? null)}
          <Field label="Open hours (Asterisk time spec)" hint={hoursOk ? (f.hours ? describeTimeSpec(f.hours) : 'Always open') : checkTimeSpec(f.hours ?? '').message}>
            <input value={f.hours ?? ''} onChange={(e) => set({ hours: e.target.value })} aria-label="Open hours" className={cx(INPUT, 'h-8 font-mono', !hoursOk && 'border-danger')} />
          </Field>
        </div>
        <div className="rounded-[10px] border border-line p-3 text-[12.5px]">
          <b>Holidays</b> → {describeDest(did?.holiday_dest ?? did?.closed_dest ?? null)}
          <p className="mt-1 text-ink-3">Uses the HR holiday calendar{holiday.data ? ` · next: ${holiday.data.name}, ${new Date(`${holiday.data.on_date}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : holiday.isError ? ' (you can’t read it, but the switch does)' : ''}.</p>
        </div>
      </div>
      {broken.length ? (
        <Notice tone="warning" icon="warning">
          {broken.map(([k, d]) => `Key ${k} points at ${describeDest(d)}`).join('; ')}. Callers who press {broken.length === 1 ? 'it' : 'them'} will hear “invalid option”. Choose a new destination before applying.
        </Notice>
      ) : null}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 text-[12.5px]">
        <Field label="No key pressed">
          <input value={f.timeout_to ?? ''} onChange={(e) => set({ timeout_to: e.target.value || null })} placeholder="Repeat, then reception 1000" aria-label="Timeout destination" className={cx(INPUT, 'h-8 font-mono')} />
        </Field>
        <Field label="Invalid key">
          <input value={f.invalid_to ?? ''} onChange={(e) => set({ invalid_to: e.target.value || null })} placeholder="Repeat the menu" aria-label="Invalid destination" className={cx(INPUT, 'h-8 font-mono')} />
        </Field>
      </div>
    </Panel>
  );
}

function DidEditor({ route, onClose, onSaved }: { route: InboundRoute | null; onClose: () => void; onSaved: () => void }) {
  const trunks = useTrunks();
  const [f, setF] = useState<Partial<InboundRoute>>(() => route ?? { did: '', open_dest: { kind: 'ivr', value: null }, closed_dest: { kind: 'voicemail', value: null }, holiday_dest: null, hours: '08:30-18:00,mon-fri,*,*', enabled: true });
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<InboundRoute>) => setF((x) => ({ ...x, ...p }));
  const hoursOk = !f.hours || checkTimeSpec(f.hours).ok;
  const save = async () => {
    setSaving(true);
    try {
      await phoneApi.saveInbound(route?.id ?? null, f);
      toast('success', 'Saved. Apply the configuration to make it live.');
      onSaved();
    } catch (e) {
      toast(isNotOffered(e) ? 'info' : 'error', isNotOffered(e) ? NOT_OFFERED : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={route ? `Routing for ${prettyNumber(route.did)}` : 'Add a number'} width={620} onClose={onClose} footer={<>{route ? <ConfirmButton label="Delete" confirm="Delete number" onConfirm={() => void phoneApi.deleteInbound(route.id).then(onSaved, (e: Error) => toast('error', e.message))} /> : null}<span className="flex-1" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} disabled={!f.did?.trim() || !hoursOk} onClick={() => void save()}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Number (DID)">
            <input value={f.did ?? ''} onChange={(e) => set({ did: e.target.value.replace(/[^0-9+]/g, '') })} placeholder="0112447000" aria-label="DID" className={cx(INPUT, 'font-mono')} />
          </Field>
          <Field label="Arrives on">
            <select aria-label="Trunk" value={String(f.trunk ?? '')} onChange={(e) => set({ trunk: e.target.value || null })} className={INPUT}>
              <option value="">Any trunk</option>
              {rowsOf(trunks.data).map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="While open">
          <DestinationPicker label="While open" value={f.open_dest ?? null} onChange={(d) => set({ open_dest: d })} />
        </Field>
        <Field label="Open hours" hint={hoursOk ? (f.hours ? describeTimeSpec(f.hours) : 'Always open') : checkTimeSpec(f.hours ?? '').message}>
          <input value={f.hours ?? ''} onChange={(e) => set({ hours: e.target.value })} placeholder="08:30-18:00,mon-fri,*,*" aria-label="Open hours" className={cx(INPUT, 'font-mono', !hoursOk && 'border-danger')} />
        </Field>
        <Field label="While closed">
          <DestinationPicker label="While closed" value={f.closed_dest ?? null} onChange={(d) => set({ closed_dest: d })} />
        </Field>
        <Field label="On HR holidays" hint="Leave as closed to treat holidays like out of hours.">
          <DestinationPicker label="On holidays" value={f.holiday_dest ?? null} onChange={(d) => set({ holiday_dest: d })} />
        </Field>
      </div>
    </Modal>
  );
}
