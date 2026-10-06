import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet } from '../../../core/api';
import { call, hasDesktop } from '../../../core/bridge';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, Chip, cx, Empty, IconButton, Spinner } from '../../../components/ui';
import { PK, phoneApi, useExtensions, useHistory, useMe, useRecordings, useScreenPop, useSpeedDials, useStatus, type CallRow, type SpeedDial } from '../api';
import { placeCall } from '../dial';
import { clock, dialable, isDialable, isMissed, isoDay, KEYPAD, otherParty, prettyNumber, talkTime, when } from '../lib/format';
import { DirectionGlyph, Kpi, Mono, PageBody, PageHeader, Panel, PbxBanner, Pills } from '../parts';
import { liveLines } from '../softphone/engine';
import { runPhone, usePhaseLabel, usePhoneState } from '../softphone/client';
import InCall from './InCall';

/**
 * W01 · Phone — dial pad & recents (VOIP-SP-04/05/09, VOIP-HIS-01). The number field matches people as it is typed
 * (the server's screen-pop lookup on the last nine digits), the caller-ID line is chosen under it, and Call turns
 * grey with a plain banner when no PBX is reachable. A call in progress takes this screen over (W02): one place to
 * answer, one in-call screen.
 */
export default function Dialer() {
  const live = usePhoneState((s) => liveLines(s).length > 0);
  const focused = usePhoneState((s) => s.focused);
  const ended = usePhoneState((s) => s.ended);
  const { path } = useTab();
  if (live || (path[1] === 'call' && ended) || (ended && ended.id === focused)) return <InCall />;
  return <DialPad />;
}

function DialPad() {
  const status = useStatus();
  const phase = usePhoneState((s) => s.phase);
  const message = usePhoneState((s) => s.message);
  const dnd = usePhoneState((s) => s.dnd);
  const chip = usePhaseLabel();
  const pbxDown = status.data ? !status.data.pbx.ok : false;
  const [number, setNumber] = useState('');
  const [search, setSearch] = useState('');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Phone"
        actions={
          <>
            <PeopleSearch value={search} onChange={setSearch} onPick={(n) => setNumber(n)} />
            {hasDesktop() ? (
              <Button icon="app-window" onClick={() => void call('windows:open', { kind: 'phone', route: '/phone/compact', title: 'WorkSuite Phone', alwaysOnTop: true }).catch((e: Error) => toast('error', e.message))} title="A small phone that stays on top of other apps">
                Compact phone
              </Button>
            ) : null}
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
              Status
              <select
                aria-label="Phone status"
                value={dnd ? 'dnd' : 'available'}
                onChange={(e) => void setDnd(e.target.value === 'dnd')}
                className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12.5px] text-ink"
              >
                <option value="available">Available</option>
                <option value="dnd">Do not disturb</option>
              </select>
            </label>
          </>
        }
      />
      <PageBody>
        <div className="flex flex-col gap-4">
          {pbxDown ? <PbxBanner message={status.data?.message} /> : null}
          <PhoneProblem phase={phase} message={message} chip={chip.text} />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(300px,340px)_minmax(320px,1fr)_minmax(260px,300px)]">
            <Keypad number={number} setNumber={setNumber} disabled={pbxDown && phase !== 'registered'} />
            <Recents onCall={(n, name) => void placeCall(n, { name })} />
            <div className="flex flex-col gap-4">
              <MyDay />
              <SpeedDials onCall={(n, name) => void placeCall(n, { name })} />
            </div>
          </div>
        </div>
      </PageBody>
    </div>
  );
}

/** DND on the switch when the server offers it (VOIP-FWD-05), and on this computer always. */
async function setDnd(on: boolean) {
  await runPhone({ cmd: 'dnd', on });
  try {
    await phoneApi.setDnd(on);
    toast('success', on ? 'Do not disturb is on. Callers go to voicemail.' : 'Do not disturb is off.');
  } catch {
    toast('info', on ? 'Calls won’t ring on this computer. This server can’t set Do not disturb on the switch yet, so your other phones still ring.' : 'Calls ring on this computer again.');
  }
}

/** Why the phone on this computer is not ready, said plainly with what to do. */
function PhoneProblem({ phase, message, chip }: { phase: string; message: string | null; chip: string }) {
  if (phase === 'registered' || phase === 'idle' || phase === 'starting' || phase === 'connecting') return null;
  if (phase === 'no-extension') {
    return (
      <div className="rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[12.5px] text-ink-2">
        <b className="text-ink">You don’t have an extension yet.</b> {message ?? 'An administrator can create one for you.'} The directory, your history and voicemail still work; Call rings your desk phone if you have one.
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-warning/30 bg-warning-bg px-3.5 py-2.5 text-[12.5px] text-warning-ink dark:text-warning">
      <Icon name="warning" size={16} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <b>{chip}.</b> {message}
      </span>
      {phase === 'needs-reload' ? (
        <Button size="sm" onClick={() => window.location.reload()}>
          Restart window
        </Button>
      ) : (
        <Button size="sm" onClick={() => void runPhone({ cmd: 'retry' })}>
          Try again
        </Button>
      )}
    </div>
  );
}

function Keypad({ number, setNumber, disabled }: { number: string; setNumber: (n: string) => void; disabled: boolean }) {
  const me = useMe();
  const exts = useExtensions();
  const ownExt = usePhoneState((s) => s.extension);
  const pop = useScreenPop(dialable(number).length >= 3 && !/^\d{2,5}$/.test(dialable(number)) ? dialable(number) : null);
  const internal = useMemo(() => exts.data?.find((e) => e.extension === dialable(number)), [exts.data, number]);
  const callerIds = me.data?.offered ? me.data.data.caller_ids : [];
  const [callerId, setCallerId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const ok = isDialable(number);
  const mine = ownExt ? exts.data?.find((e) => e.extension === ownExt) : null;

  const go = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      if (callerId && me.data?.offered) await phoneApi.setCallerId(callerId).catch(() => undefined);
      if (await placeCall(number, { contactId: pop.data?.contact?.id ?? null, name: pop.data?.contact?.name ?? internal?.name ?? null })) setNumber('');
    } finally {
      setBusy(false);
    }
  };

  const match = internal ? `${internal.name} · Ext ${internal.extension}${internal.presence !== 'offline' ? ` · ${internal.presence.replace('_', ' ')}` : ''}` : pop.data?.matched ? [pop.data.contact?.name ?? pop.data.account?.name ?? pop.data.lead?.name, pop.data.contact?.company ?? pop.data.account?.name, pop.data.confidence === 'lead' ? 'Lead' : pop.data.account ? 'Customer' : null].filter(Boolean).join(' · ') : null;

  return (
    <Panel bodyClassName="flex flex-col gap-3 pt-4">
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] font-semibold text-ink-3">Number or extension</span>
        <input
          ref={input}
          value={number}
          onChange={(e) => setNumber(e.target.value.replace(/[^0-9+*#\s()-]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void go();
          }}
          inputMode="tel"
          autoComplete="off"
          placeholder="Type a number"
          aria-label="Number or extension"
          className="h-12 border-b-2 border-primary bg-transparent font-mono text-[24px] text-ink tabular-nums outline-none placeholder:text-ink-3 placeholder:text-[16px]"
        />
      </label>
      <div className="min-h-[22px] text-[12px] text-ink-2" aria-live="polite">
        {match ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-selection px-2 py-0.5 font-semibold text-primary">
            <Icon name="user" size={12} />
            {match}
          </span>
        ) : pop.isFetching ? (
          <span className="text-ink-3">Looking up…</span>
        ) : dialable(number).length >= 6 ? (
          <span className="text-ink-3">No contact match</span>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-2.5" role="group" aria-label="Dial pad">
        {KEYPAD.map((k) => (
          <button
            key={k.d}
            type="button"
            aria-label={k.d === '*' ? 'Star' : k.d === '#' ? 'Hash' : k.d}
            onClick={() => {
              setNumber(number + k.d);
              input.current?.focus();
            }}
            onDoubleClick={() => k.d === '0' && setNumber(`${number.slice(0, -1)}+`)}
            className="flex h-14 flex-col items-center justify-center rounded-[12px] bg-subtle text-ink hover:bg-selection focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="font-mono text-[20px] leading-none">{k.d}</span>
            <span className="mt-0.5 h-3 text-[9px] font-semibold tracking-[1px] text-ink-3">{k.l}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[11.5px] font-semibold text-ink-3">Call from</span>
          <select aria-label="Call from" value={callerId} onChange={(e) => setCallerId(e.target.value)} className="h-9 min-w-0 rounded-[8px] border border-line bg-surface px-2 text-[12.5px] text-ink">
            {callerIds.length ? (
              callerIds.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))
            ) : (
              <option value="">{ownExt ? `Ext ${ownExt}${mine?.caller_id ? ` · ${prettyNumber(mine.caller_id)}` : ''}` : 'My extension'}</option>
            )}
          </select>
        </label>
        {number ? <IconButton icon="back" label="Delete last digit" onClick={() => setNumber(number.slice(0, -1))} className="mt-5" /> : null}
      </div>
      <Button variant={disabled ? 'secondary' : 'success'} size="lg" icon="phone" disabled={!ok || disabled} loading={busy} onClick={() => void go()} className="w-full rounded-full">
        Call
      </Button>
    </Panel>
  );
}

type RecentFilter = 'all' | 'missed' | 'voicemail';

function Recents({ onCall }: { onCall: (n: string, name: string | null) => void }) {
  const [filter, setFilter] = useState<RecentFilter>('all');
  const { go } = useTab();
  const history = useHistory({ per_page: 30, ...(filter === 'missed' ? { direction: 'inbound' } : {}) });
  const vm = useRecordings({ kind: 'voicemail', per_page: 30 });
  const missedHere = usePhoneState((s) => s.missed.length);
  useEffect(() => {
    if (filter === 'missed' && missedHere) void runPhone({ cmd: 'clearMissed' });
  }, [filter, missedHere]);
  const calls = (history.data?.calls ?? []).filter((c) => filter !== 'missed' || isMissed(c.disposition));
  const missedCount = (history.data?.calls ?? []).filter((c) => c.direction === 'inbound' && isMissed(c.disposition)).length;
  const unheard = (vm.data?.recordings ?? []).filter((r) => !r.listened).length;
  return (
    <Panel
      title="Recent"
      action={
        <Pills
          label="Recent calls"
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'all', label: 'All' },
            { id: 'missed', label: `Missed${missedCount ? ` · ${missedCount}` : ''}` },
            { id: 'voicemail', label: `Voicemail${unheard ? ` · ${unheard}` : ''}` },
          ]}
        />
      }
      bodyClassName="px-0 pb-2"
    >
      {filter === 'voicemail' ? (
        vm.isLoading ? (
          <Spinner />
        ) : (vm.data?.recordings ?? []).length === 0 ? (
          <Empty icon="voicemail" title="No voicemail" />
        ) : (
          <ul className="flex flex-col">
            {(vm.data?.recordings ?? []).map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => go('/phone/voicemail')} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-subtle">
                  <span className={cx('h-2 w-2 shrink-0 rounded-full', r.listened ? 'bg-transparent' : 'bg-primary')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{prettyNumber(r.from) || 'Unknown caller'}</span>
                    <span className="block truncate text-[11.5px] text-ink-3">Voicemail{r.extension ? ` · Ext ${r.extension}` : ''}</span>
                  </span>
                  <Mono className="text-[12px] text-ink-2">{clock(r.duration)}</Mono>
                  <span className="w-[68px] text-right text-[11.5px] text-ink-3">{when(r.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : history.isLoading ? (
        <Spinner />
      ) : history.error ? (
        <div className="px-4 py-3 text-[12.5px] text-danger">{(history.error as Error).message}</div>
      ) : calls.length === 0 ? (
        <Empty icon="history" title={filter === 'missed' ? 'No missed calls' : 'No calls yet'} hint="Calls appear here once the phone system reports them." />
      ) : (
        <ul className="flex flex-col">
          {calls.map((c) => (
            <RecentRow key={c.id} call={c} onCall={onCall} onOpen={() => go(`/phone/calls/${c.id}`)} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RecentRow({ call, onCall, onOpen }: { call: CallRow; onCall: (n: string, name: string | null) => void; onOpen: () => void }) {
  const other = otherParty(call);
  const missed = call.direction === 'inbound' && isMissed(call.disposition);
  const name = call.contact?.name ?? null;
  const meta = [call.direction === 'inbound' ? (missed ? 'Missed' : 'Inbound') : call.direction === 'outbound' ? 'Outbound' : 'Internal', call.queue, call.linked?.label].filter(Boolean).join(' · ');
  return (
    <li className="group flex items-center gap-3 px-4 py-2 hover:bg-subtle">
      <DirectionGlyph direction={call.direction} disposition={call.disposition} />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className={cx('block truncate text-[13px] font-semibold', missed && 'text-danger')}>{name ?? (prettyNumber(other) || 'Unknown')}</span>
        <span className="block truncate text-[11.5px] text-ink-3">{meta}</span>
      </button>
      <Mono className="w-10 text-right text-[12px] text-ink-2">{call.talk ? clock(call.talk) : '—'}</Mono>
      <span className="w-[64px] text-right text-[11.5px] text-ink-3">{when(call.started_at)}</span>
      {other ? <IconButton icon="phone" label={`Call back ${prettyNumber(other)}`} onClick={() => onCall(other, name)} className="text-success" /> : null}
    </li>
  );
}

/** My day (W01): today's calls, missed, talk time, new voicemail — my own, never a guess. */
function MyDay() {
  const today = isoDay(new Date());
  const ext = usePhoneState((s) => s.extension);
  const h = useHistory({ from: today, to: today, per_page: 100 });
  const vm = useRecordings({ kind: 'voicemail', per_page: 50 });
  const mine = (h.data?.calls ?? []).filter((c) => !ext || !c.extension || c.extension === ext);
  const missed = mine.filter((c) => c.direction === 'inbound' && isMissed(c.disposition)).length;
  const talk = mine.reduce((s, c) => s + (c.talk || 0), 0);
  const unheard = (vm.data?.recordings ?? []).filter((r) => !r.listened && (!ext || r.extension === ext)).length;
  return (
    <Panel title="My day">
      <div className="grid grid-cols-2 gap-2">
        <Kpi label="Calls" value={h.isLoading ? '…' : mine.length} />
        <Kpi label="Missed" value={h.isLoading ? '…' : missed} tone={missed ? 'danger' : undefined} />
        <Kpi label="Talk time" value={h.isLoading ? '…' : talkTime(talk)} />
        <Kpi label="New voicemail" value={vm.isLoading ? '…' : unheard} tone={unheard ? 'primary' : undefined} />
      </div>
    </Panel>
  );
}

const LOCAL_SPEED = 'ws.phone.speedDials';

function readLocal(): SpeedDial[] {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_SPEED) ?? '[]') as SpeedDial[];
    return Array.isArray(v) ? v.filter((x) => x && typeof x.number === 'string') : [];
  } catch {
    return [];
  }
}

/** Speed dials (W01): the server's when it keeps them (voip_speed_dials), otherwise kept on this computer. */
function SpeedDials({ onCall }: { onCall: (n: string, name: string | null) => void }) {
  const q = useSpeedDials();
  const qc = useQueryClient();
  const exts = useExtensions();
  const [local, setLocal] = useState<SpeedDial[]>(readLocal);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState('');
  const [num, setNum] = useState('');
  const server = q.data?.offered ? q.data.data : null;
  const list = server ?? local;
  const presenceOf = (n: string) => exts.data?.find((e) => e.extension === n)?.presence ?? null;
  const add = async () => {
    if (!label.trim() || !isDialable(num)) return;
    if (server) {
      try {
        await phoneApi.addSpeedDial({ label: label.trim(), number: dialable(num), slot: null, contact_id: null });
        void qc.invalidateQueries({ queryKey: PK.speedDials });
      } catch (e) {
        toast('error', (e as Error).message);
        return;
      }
    } else {
      const next = [...local, { id: Date.now(), label: label.trim(), number: dialable(num), slot: null, contact_id: null }];
      setLocal(next);
      try {
        localStorage.setItem(LOCAL_SPEED, JSON.stringify(next));
      } catch {
        /* this session only */
      }
    }
    setLabel('');
    setNum('');
  };
  const remove = async (d: SpeedDial) => {
    if (server) {
      await phoneApi.deleteSpeedDial(d.id).catch((e: Error) => toast('error', e.message));
      void qc.invalidateQueries({ queryKey: PK.speedDials });
    } else {
      const next = local.filter((x) => x.id !== d.id);
      setLocal(next);
      try {
        localStorage.setItem(LOCAL_SPEED, JSON.stringify(next));
      } catch {
        /* this session only */
      }
    }
  };
  return (
    <Panel
      title="Speed dials"
      sub={q.data && !q.data.offered ? 'Kept on this computer' : undefined}
      action={
        <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => setEditing(!editing)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      }
      bodyClassName="flex flex-col gap-1"
    >
      {list.length === 0 && !editing ? <p className="text-[12px] text-ink-3">No speed dials yet. Choose Edit to add colleagues and numbers you call often.</p> : null}
      {list.map((d) => {
        const p = d.presence ?? presenceOf(d.number);
        return (
          <div key={d.id} className="flex items-center gap-2.5 rounded-[8px] px-1 py-1.5 hover:bg-subtle">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-subtle text-[11px] font-bold text-ink-2">{d.label.slice(0, 2).toUpperCase()}</span>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onCall(d.number, d.label)} disabled={editing}>
              <span className="block truncate text-[12.5px] font-semibold">{d.label}</span>
              <Mono className="block truncate text-[11px] text-ink-3">{prettyNumber(d.number)}</Mono>
            </button>
            {editing ? (
              <IconButton icon="trash" label={`Remove ${d.label}`} onClick={() => void remove(d)} />
            ) : p ? (
              <span title={p} className={cx('h-2.5 w-2.5 shrink-0 rounded-full', p === 'online' ? 'bg-success' : p === 'busy' || p === 'dnd' ? 'bg-danger' : p === 'away' || p === 'in_meeting' ? 'bg-warning' : 'bg-ink-3/40')} />
            ) : null}
          </div>
        );
      })}
      {editing ? (
        <div className="mt-1 flex flex-col gap-1.5 border-t border-line pt-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name" aria-label="Speed dial name" className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12.5px]" />
          <input value={num} onChange={(e) => setNum(e.target.value)} placeholder="Number or extension" aria-label="Speed dial number" inputMode="tel" className="h-8 rounded-[8px] border border-line bg-surface px-2 font-mono text-[12.5px]" />
          <Button size="sm" variant="primary" icon="plus" disabled={!label.trim() || !isDialable(num)} onClick={() => void add()}>
            Add speed dial
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}

/** Search people, contacts or numbers (W01 header): the extension directory and Contacts. */
function PeopleSearch({ value, onChange, onPick }: { value: string; onChange: (v: string) => void; onPick: (n: string) => void }) {
  const exts = useExtensions();
  const term = value.trim().toLowerCase();
  const contacts = useQuery({
    queryKey: ['phone', 'contact-search'],
    queryFn: ({ signal }) => apiGet<Array<{ id: number; display_name: string; company: string | null; mobile: string | null; office_phone: string | null; phone: string | null }>>('/api/contacts', undefined, signal),
    enabled: term.length >= 2,
    staleTime: 5 * 60_000,
  });
  const hits = useMemo(() => {
    if (term.length < 2) return [];
    const people = (exts.data ?? [])
      .filter((e) => e.enabled && (e.name.toLowerCase().includes(term) || e.extension.includes(term) || (e.user_name ?? '').toLowerCase().includes(term)))
      .slice(0, 6)
      .map((e) => ({ key: `e${e.id}`, label: e.user_name ?? e.name, meta: `Ext ${e.extension}`, number: e.extension }));
    const digits = term.replace(/\D/g, '');
    const cs = (Array.isArray(contacts.data) ? contacts.data : [])
      .filter((c) => c.display_name.toLowerCase().includes(term) || (digits.length >= 3 && [c.mobile, c.office_phone, c.phone].some((p) => (p ?? '').replace(/\D/g, '').includes(digits))))
      .slice(0, 8)
      .flatMap((c) => {
        const n = c.mobile ?? c.office_phone ?? c.phone;
        return n ? [{ key: `c${c.id}`, label: c.display_name, meta: [c.company, prettyNumber(n)].filter(Boolean).join(' · '), number: n }] : [];
      });
    return [...people, ...cs];
  }, [term, exts.data, contacts.data]);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-ink-3">
        <Icon name="search" size={14} />
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search people, contacts or numbers"
        aria-label="Search people, contacts or numbers"
        className="h-8 w-[280px] rounded-[8px] border border-line bg-surface pr-2 pl-8 text-[12.5px] text-ink outline-none focus:border-primary"
      />
      {hits.length ? (
        <ul role="listbox" aria-label="Matches" className="absolute top-9 right-0 z-30 max-h-[340px] w-[320px] overflow-y-auto rounded-[10px] border border-line bg-surface p-1 shadow-xl scroll-thin">
          {hits.map((h) => (
            <li key={h.key}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onPick(h.number);
                  onChange('');
                }}
                className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left hover:bg-subtle"
              >
                <Icon name="user" size={14} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold">{h.label}</span>
                  <span className="block truncate text-[11px] text-ink-3">{h.meta}</span>
                </span>
                <Chip tone="success">
                  <Icon name="phone" size={11} />
                </Chip>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

