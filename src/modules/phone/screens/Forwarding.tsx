import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from '../../../core/toasts';
import { Button, Chip, cx, Empty, IconButton, Modal, Spinner, Switch } from '../../../components/ui';
import { isNotOffered, NOT_OFFERED, phoneApi, PK, rowsOf, useExtensions, useForwards, useMe, useRegistrations, type ForwardCondition, type ForwardKind, type ForwardRule } from '../api';
import { dialable, isDialable, prettyNumber, stamp } from '../lib/format';
import { checkTimeSpec, describeTimeSpec } from '../lib/timespec';
import { Field, INPUT, Mono, Notice, PageBody, PageHeader, Panel, Refused } from '../parts';
import { runPhone, usePhaseLabel, usePhoneState } from '../softphone/client';
import { Checkbox } from '../../../components/Checkbox';

/**
 * W07 · Forwarding, DND, hot desk (VOIP-FWD-01…05, VOIP-EXT-06). Rules are listed in the order the switch tries them,
 * yours before your department's defaults; a change says it is waiting for the switch until an administrator applies
 * the configuration, after which the PBX enforces it even when WorkSuite is down (NFR-02). Beside them: Do not
 * disturb, the devices registered on your extension, and logging in at a shared (hot-desk) phone.
 */
const CONDITION: Record<ForwardCondition, { label: string; tone: 'success' | 'indigo' | 'warning' | 'danger' | 'muted' | 'teal' }> = {
  holiday: { label: 'Holiday', tone: 'success' },
  time: { label: 'Out of hours', tone: 'indigo' },
  busy: { label: 'When busy', tone: 'warning' },
  no_answer: { label: 'No answer', tone: 'teal' },
  unavailable: { label: 'Unavailable', tone: 'muted' },
  always: { label: 'Always', tone: 'danger' },
};

const ORDER: ForwardCondition[] = ['holiday', 'time', 'busy', 'no_answer', 'unavailable', 'always'];

export default function Forwarding() {
  const ext = usePhoneState((s) => s.extension);
  const exts = useExtensions();
  const mine = exts.data?.find((e) => e.extension === ext) ?? null;
  const rules = useForwards(mine?.id ?? null, !!mine);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const qc = useQueryClient();
  const sorted = useMemo(() => [...(rules.data ?? [])].sort((a, b) => (a.extension_id === null ? 1 : 0) - (b.extension_id === null ? 1 : 0) || a.priority - b.priority || ORDER.indexOf(a.condition) - ORDER.indexOf(b.condition)), [rules.data]);
  const pendingCount = sorted.filter((r) => r.pending).length;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['phone', 'forwards'] });

  const toggle = async (r: ForwardRule, on: boolean) => {
    try {
      const res = await phoneApi.updateForward(r.id, { enabled: on });
      setPending(res.message ?? 'Saved. Apply the configuration to make it live on the switch.');
      refresh();
    } catch (e) {
      toast(isNotOffered(e) ? 'info' : 'error', isNotOffered(e) ? `${NOT_OFFERED} Delete the rule and add it again instead.` : (e as Error).message);
    }
  };
  const remove = async (r: ForwardRule) => {
    try {
      await phoneApi.deleteForward(r.id);
      setPending('Removed. Apply the configuration to make it live on the switch.');
      refresh();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Forwarding & do not disturb" />
      <PageBody>
        <div className="flex flex-col gap-4">
          {pending || pendingCount ? (
            <Notice tone="primary" icon="clock" action={<Chip tone="indigo">Pending apply</Chip>}>
              <b>{pendingCount ? `${pendingCount} change${pendingCount === 1 ? '' : 's'} waiting for the switch.` : 'A change is waiting for the switch.'}</b> Rules run on the PBX itself, so they keep working when WorkSuite is offline. {pending ?? 'Your administrator’s next apply makes this live.'}
            </Notice>
          ) : null}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Panel
              title="Where my calls go"
              sub="Checked top to bottom. Your own rules beat your department’s defaults."
              action={
                <Button variant="primary" icon="plus" disabled={!mine} onClick={() => setAdding(true)}>
                  Add rule
                </Button>
              }
            >
              {!ext ? (
                <Empty icon="phone" title="You don’t have an extension" hint="Forwarding is set per extension. An administrator can create one for you." />
              ) : exts.isLoading || rules.isLoading ? (
                <Spinner />
              ) : rules.error ? (
                <Refused error={rules.error} onRetry={() => void rules.refetch()} />
              ) : sorted.length === 0 ? (
                <Empty icon="phone-forwarded" title="No forwarding rules" hint="Calls ring your phones, then go to voicemail if it is on." />
              ) : (
                <ol className="flex flex-col">
                  {sorted.map((r, i) => (
                    <li key={r.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
                      <span className="w-5 text-center font-mono text-[12px] text-ink-3">{i + 1}</span>
                      <span className="w-[110px] shrink-0">
                        <Chip tone={CONDITION[r.condition].tone}>{CONDITION[r.condition].label}</Chip>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-ink">{destination(r)}</span>
                        <span className="block truncate text-[11.5px] text-ink-3">{detail(r)}</span>
                      </span>
                      <span className="shrink-0 text-[11.5px] text-ink-3">{r.extension_id === null ? 'Department default' : r.pending ? 'Mine · pending' : 'Mine'}</span>
                      {r.extension_id !== null ? (
                        <>
                          <Switch checked={r.enabled} onChange={(v) => void toggle(r, v)} label={`Rule ${i + 1} on`} />
                          <IconButton icon="trash" label="Remove rule" onClick={() => void remove(r)} />
                        </>
                      ) : (
                        <Switch checked={r.enabled} onChange={() => undefined} disabled label="Set by your department" />
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
            <div className="flex flex-col gap-4">
              <DndCard />
              <Devices extensionId={mine?.id ?? null} />
              <HotDesk />
            </div>
          </div>
        </div>
      </PageBody>
      {adding && mine ? (
        <AddRule
          extensionId={mine.id}
          onClose={() => setAdding(false)}
          onSaved={(m) => {
            setAdding(false);
            setPending(m);
            void qc.invalidateQueries({ queryKey: PK.forwards(mine.id) });
          }}
        />
      ) : null}
    </div>
  );
}

function destination(r: ForwardRule): string {
  switch (r.destination_kind) {
    case 'voicemail':
      return r.condition === 'holiday' ? 'Voicemail (holiday greeting)' : 'Voicemail';
    case 'mobile':
      return `My mobile ${prettyNumber(r.destination)}`;
    case 'extension':
      return `Extension ${r.destination}`;
    case 'queue':
      return `Queue ${r.destination}`;
    case 'ring_group':
      return `Ring group ${r.destination}`;
    case 'ivr':
      return `Menu on ${r.destination}`;
    default:
      return prettyNumber(r.destination) || r.summary;
  }
}

function detail(r: ForwardRule): string {
  if (r.condition === 'time') return `${describeTimeSpec(r.time_spec)} · Asterisk time rule`;
  if (r.condition === 'holiday') return r.date_from ? `${r.date_from}${r.date_to && r.date_to !== r.date_from ? ` – ${r.date_to}` : ''}` : 'On holidays';
  if (r.condition === 'no_answer') return `After ringing ${r.ring_seconds} s`;
  if (r.condition === 'busy') return 'Only while I am on another call';
  if (r.condition === 'unavailable') return 'When no device is registered';
  return 'Forward every call immediately';
}

/** Do not disturb (VOIP-FWD-05): on the switch when the server offers it, on this computer always. */
function DndCard() {
  const me = useMe();
  const local = usePhoneState((s) => s.dnd);
  const server = me.data?.offered ? me.data.data : null;
  const [sync, setSync] = useState(server?.sync_presence ?? false);
  const on = server ? server.dnd || local : local;
  const set = async (v: boolean) => {
    await runPhone({ cmd: 'dnd', on: v });
    try {
      await phoneApi.setDnd(v, sync);
      void me.refetch();
    } catch {
      toast('info', v ? 'Calls won’t ring on this computer. This server can’t set Do not disturb on the switch yet.' : 'Calls ring on this computer again.');
    }
  };
  return (
    <Panel title="Do not disturb" action={<Switch checked={on} onChange={(v) => void set(v)} label="Do not disturb" />} bodyClassName="flex flex-col gap-2 text-[12.5px] text-ink-2">
      <p>Calls go straight to voicemail. Queue calls skip you.{!server ? ' On this server it applies to this computer only.' : ''}</p>
      <label className="flex items-center gap-2">
        <Checkbox checked={sync} disabled={!server} onChange={(e) => setSync(e.target.checked)} />
        Sync with my WorkSuite presence
      </label>
    </Panel>
  );
}

/** The devices registered on my extension (W07): this computer, the switch's list when the server reports it. */
function Devices({ extensionId }: { extensionId: number | null }) {
  const regs = useRegistrations();
  const me = useMe();
  const phase = usePhaseLabel();
  const ext = usePhoneState((s) => s.extension);
  const list = (me.data?.offered ? me.data.data.devices : rowsOf(regs.data)).filter((r) => extensionId === null || r.extension_id === null || r.extension_id === extensionId);
  return (
    <Panel title={`My devices${ext ? ` on ${ext}` : ''}`} bodyClassName="flex flex-col gap-2 text-[12.5px]">
      <div className="flex items-start gap-2">
        <span className={cx('mt-1 h-2 w-2 shrink-0 rounded-full', phase.tone === 'success' || phase.tone === 'danger' ? 'bg-success' : phase.tone === 'warning' ? 'bg-warning' : 'bg-ink-3/40')} />
        <span>
          <b>WorkSuite Desktop · this computer</b>
          <span className="block text-[11.5px] text-ink-3">WebRTC · {phase.text}</span>
        </span>
      </div>
      {list.map((r, i) => (
        <div key={r.id ?? i} className="flex items-start gap-2">
          <span className={cx('mt-1 h-2 w-2 shrink-0 rounded-full', r.seen_at ? 'bg-success' : 'bg-warning')} />
          <span className="min-w-0">
            <b className="block truncate">{r.user_agent ?? 'A SIP device'}</b>
            <span className="block truncate text-[11.5px] text-ink-3">
              {[r.transport?.toUpperCase(), r.ip, r.rtt_ms !== null ? `${r.rtt_ms} ms` : null, r.seen_at ? `seen ${stamp(r.seen_at)}` : null].filter(Boolean).join(' · ')}
            </span>
          </span>
        </div>
      ))}
      {!me.data?.offered && !(regs.data?.offered ?? false) ? <p className="text-[11.5px] text-ink-3">The phone system’s list of your other registered devices isn’t offered by this server yet.</p> : null}
    </Panel>
  );
}

/** Hot desk (VOIP-EXT-06): log in at a shared phone until you log out; an owned phone cannot be taken. */
function HotDesk() {
  const exts = useExtensions();
  const me = useMe();
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const shared = (me.data?.offered ? me.data.data.shared_phones : (exts.data ?? []).filter((e) => e.enabled && e.user_id === null).map((e) => ({ id: e.id, extension: e.extension, name: e.name, branch: e.branch }))) ?? [];
  const at = me.data?.offered ? me.data.data.hotdesk : null;
  const login = async () => {
    setBusy(true);
    try {
      const r = await phoneApi.hotdesk(Number(pick));
      toast('success', r.message);
      void me.refetch();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    setBusy(true);
    try {
      const r = await phoneApi.hotdeskLogout();
      toast('success', r.message);
      void me.refetch();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Hot desk" bodyClassName="flex flex-col gap-2 text-[12.5px]">
      <p className="text-ink-2">Log in at a shared phone and your calls follow you until you log out.</p>
      {at ? (
        <Notice tone="success" icon="check">
          Logged in at Ext {at.extension}
          {at.since ? ` since ${stamp(at.since)}` : ''}.
        </Notice>
      ) : null}
      <Field label="Shared phone">
        <select aria-label="Shared phone" value={pick} onChange={(e) => setPick(e.target.value)} className={INPUT}>
          <option value="">Choose a shared phone</option>
          {shared.map((s) => (
            <option key={s.id} value={s.id}>
              Ext {s.extension} · {s.name}
              {s.branch ? ` (${s.branch})` : ''}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex gap-2">
        <Button variant="primary" className="flex-1" disabled={!pick} loading={busy} onClick={() => void login()}>
          Log in at this phone
        </Button>
        <Button loading={busy} onClick={() => void logout()}>
          Log out
        </Button>
      </div>
    </Panel>
  );
}

const KINDS: Array<{ id: ForwardKind; label: string }> = [
  { id: 'voicemail', label: 'Voicemail' },
  { id: 'mobile', label: 'My mobile' },
  { id: 'extension', label: 'A colleague’s extension' },
  { id: 'external', label: 'Another number' },
  { id: 'queue', label: 'A queue' },
  { id: 'ring_group', label: 'A ring group' },
  { id: 'ivr', label: 'A menu (IVR)' },
];

/** A new rule, checked here as the server checks it (GotoIfTime specs, dialable destinations). */
function AddRule({ extensionId, onClose, onSaved }: { extensionId: number; onClose: () => void; onSaved: (message: string) => void }) {
  const exts = useExtensions();
  const [condition, setCondition] = useState<ForwardCondition>('no_answer');
  const [kind, setKind] = useState<ForwardKind>('voicemail');
  const [dest, setDest] = useState('');
  const [ring, setRing] = useState('20');
  const [from, setFrom] = useState('18:00');
  const [to, setTo] = useState('08:30');
  const [days, setDays] = useState('mon-fri');
  const [spec, setSpec] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [saving, setSaving] = useState(false);
  // Out of hours: a GotoIfTime window that may run past midnight is two rules on the switch; here one spec per rule.
  const timeSpec = spec.trim() || `${from}-${to < from ? '23:59' : to},${days},*,*`;
  const timeCheck = condition === 'time' ? checkTimeSpec(timeSpec) : { ok: true as const };
  const destOk = kind === 'voicemail' || isDialable(dest);
  const save = async () => {
    setSaving(true);
    try {
      const body = {
        extension_id: extensionId,
        condition,
        destination_kind: kind,
        destination: kind === 'voicemail' ? undefined : dialable(dest),
        ring_seconds: condition === 'no_answer' ? Math.max(5, Math.min(120, Number(ring) || 20)) : undefined,
        time_spec: condition === 'time' ? timeSpec : condition === 'holiday' ? '*,*,*,*' : undefined,
        date_from: condition === 'holiday' ? dateFrom || null : undefined,
        date_to: condition === 'holiday' ? dateTo || dateFrom || null : undefined,
        priority: ORDER.indexOf(condition) * 10 + 10,
      };
      const r = await phoneApi.createForward(body);
      // A window past midnight is its second half: midnight to the end.
      if (condition === 'time' && !spec.trim() && to < from) await phoneApi.createForward({ ...body, time_spec: `00:00-${to},${days},*,*` });
      onSaved(r.message);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title="Add a forwarding rule"
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!destOk || !timeCheck.ok || (condition === 'holiday' && !dateFrom)} onClick={() => void save()}>
            Add rule
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="When">
          <select aria-label="When" value={condition} onChange={(e) => setCondition(e.target.value as ForwardCondition)} className={INPUT}>
            <option value="no_answer">No answer</option>
            <option value="busy">When busy</option>
            <option value="unavailable">Unavailable (no device registered)</option>
            <option value="time">Out of hours</option>
            <option value="holiday">On holiday dates</option>
            <option value="always">Always</option>
          </select>
        </Field>
        <Field label="Send calls to">
          <select aria-label="Send calls to" value={kind} onChange={(e) => setKind(e.target.value as ForwardKind)} className={INPUT}>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        {kind === 'extension' ? (
          <Field label="Colleague" className="col-span-2">
            <select aria-label="Colleague" value={dest} onChange={(e) => setDest(e.target.value)} className={INPUT}>
              <option value="">Choose a colleague</option>
              {(exts.data ?? [])
                .filter((e) => e.enabled && e.id !== extensionId)
                .map((e) => (
                  <option key={e.id} value={e.extension}>
                    {e.extension} · {e.user_name ?? e.name}
                  </option>
                ))}
            </select>
          </Field>
        ) : kind !== 'voicemail' ? (
          <Field label={kind === 'mobile' ? 'Mobile number' : 'Number'} className="col-span-2" hint={dest && !isDialable(dest) ? 'Digits, + * and # only.' : undefined}>
            <input value={dest} onChange={(e) => setDest(e.target.value)} inputMode="tel" placeholder={kind === 'mobile' ? '+94 77 455 1290' : 'Number'} aria-label="Destination number" className={cx(INPUT, 'font-mono')} />
          </Field>
        ) : null}
        {condition === 'no_answer' ? (
          <Field label="After ringing (seconds)">
            <input value={ring} onChange={(e) => setRing(e.target.value.replace(/\D/g, ''))} inputMode="numeric" aria-label="Ring seconds" className={INPUT} />
          </Field>
        ) : null}
        {condition === 'time' ? (
          <>
            <Field label="Days">
              <select aria-label="Days" value={days} onChange={(e) => setDays(e.target.value)} className={INPUT}>
                <option value="mon-fri">Monday to Friday</option>
                <option value="mon-sat">Monday to Saturday</option>
                <option value="sat-sun">Weekend</option>
                <option value="*">Every day</option>
              </select>
            </Field>
            <Field label="From">
              <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" className={INPUT} />
            </Field>
            <Field label="Until">
              <input type="time" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Until" className={INPUT} />
            </Field>
            <Field label="Or an Asterisk time spec" className="col-span-2" hint={timeCheck.ok ? `Reads as: ${describeTimeSpec(timeSpec)}${!spec.trim() && to < from ? ` and 00:00–${to}` : ''}` : timeCheck.message}>
              <input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="09:00-17:00,mon-fri,*,*" aria-label="Time spec" className={cx(INPUT, 'font-mono', !timeCheck.ok && 'border-danger')} />
            </Field>
          </>
        ) : null}
        {condition === 'holiday' ? (
          <>
            <Field label="From date">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" className={INPUT} />
            </Field>
            <Field label="To date">
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date" className={INPUT} />
            </Field>
          </>
        ) : null}
      </div>
      <p className="mt-3 text-[12px] text-ink-3">
        Saved rules wait for your administrator to apply the configuration. After that the switch runs them, even when WorkSuite is down. <Mono>*72</Mono>/<Mono>*73</Mono> on a desk phone stay separate.
      </p>
    </Modal>
  );
}
