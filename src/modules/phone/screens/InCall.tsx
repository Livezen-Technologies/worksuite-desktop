import { useEffect, useMemo, useState } from 'react';
import { apiPost } from '../../../core/api';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { useNow } from '../../../core/use-now';
import { Icon } from '../../../components/Icon';
import { Button, Chip, cx, IconButton } from '../../../components/ui';
import { phoneApi, rowsOf, useExtensions, useWrapupCodes, type ScreenPop } from '../api';
import { clock, isoDay, KEYPAD, money, prettyNumber } from '../lib/format';
import { CallerBadge, Mono, Panel, TEXTAREA } from '../parts';
import { phone, type Line } from '../softphone/engine';
import { runPhone, usePhoneState } from '../softphone/client';
import { AudioDevices } from './AudioDevices';

/**
 * W02 · In call — controls & screen pop (VOIP-CTL-01…06, VOIP-POP-01, VOIP-SP-10). The dark stage carries the
 * caller, the queue they came through, recording and quality, the timer and ten controls; the transfer panel offers
 * "Speak first" (attended) and "Transfer now" (blind) for each colleague with their presence. Beside it: who the
 * caller is to the business, notes saved to the call and the contact's timeline, a follow-up task and the wrap-up
 * outcome.
 */

type Pane = 'none' | 'keypad' | 'transfer' | 'add' | 'audio';

const DEFAULT_OUTCOMES = ['Resolved', 'Quote requested', 'Call back later', 'Sent information', 'Wrong number', 'No action needed'];

export default function InCall() {
  const lines = usePhoneState((s) => s.lines);
  const focusedId = usePhoneState((s) => s.focused);
  const ended = usePhoneState((s) => s.ended);
  const live = useMemo(() => lines.filter((l) => l.state !== 'ended'), [lines]);
  const line = live.find((l) => l.id === focusedId) ?? live.find((l) => l.state === 'connected' && !l.held) ?? live[0] ?? null;

  if (!line) return ended ? <AfterCall line={ended} /> : null;
  const others = live.filter((l) => l.id !== line.id);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-ground p-5 scroll-thin">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(420px,1fr)_minmax(300px,380px)]">
        <div className="flex flex-col gap-3">
          <Stage line={line} />
          {others.length ? <OtherLines lines={others} /> : null}
        </div>
        <div className="flex flex-col gap-3">
          <ScreenPopCard line={line} />
          <NotesCard line={line} />
        </div>
      </div>
    </div>
  );
}

function Stage({ line }: { line: Line }) {
  const now = useNow(1000);
  const [pane, setPane] = useState<Pane>('none');
  const consult = usePhoneState((s) => s.lines.find((l) => l.consultFor === line.id && l.state !== 'ended') ?? null);
  const consultOf = usePhoneState((s) => (line.consultFor ? (s.lines.find((l) => l.id === line.consultFor) ?? null) : null));
  const started = line.answeredAt ?? line.createdAt;
  const elapsed = Math.floor((now.getTime() - started) / 1000);
  const name = line.remoteName ?? line.context?.contact?.name ?? line.context?.account?.name ?? null;
  const company = line.context?.contact?.company ?? line.context?.account?.name ?? null;
  const connected = line.state === 'connected';
  const ringing = line.state === 'ringing';
  const run = async (c: Parameters<typeof runPhone>[0]) => {
    const r = await runPhone(c);
    if (!r.ok) toast('error', r.message);
    else if (r.message) toast('success', r.message);
    return r;
  };

  const CONTROLS: Array<{ id: string; label: string; icon: string; on?: boolean; onClick: () => void; disabled?: boolean }> = [
    { id: 'mute', label: line.muted ? 'Unmute' : 'Mute', icon: line.muted ? 'mic-off' : 'mic', on: line.muted, onClick: () => void run({ cmd: 'mute', id: line.id }), disabled: !connected },
    { id: 'hold', label: line.held ? 'Resume' : 'Hold', icon: line.held ? 'play' : 'pause', on: line.held, onClick: () => void run({ cmd: 'hold', id: line.id }), disabled: !connected },
    { id: 'keypad', label: 'Keypad', icon: 'keypad', on: pane === 'keypad', onClick: () => setPane(pane === 'keypad' ? 'none' : 'keypad'), disabled: !connected },
    { id: 'transfer', label: 'Transfer', icon: 'phone-forwarded', on: pane === 'transfer', onClick: () => setPane(pane === 'transfer' ? 'none' : 'transfer'), disabled: !connected || !!line.consultFor },
    { id: 'conference', label: 'Conference', icon: 'merge', onClick: () => void run({ cmd: 'conference' }), disabled: !connected },
    { id: 'park', label: 'Park', icon: 'parking', onClick: () => void run({ cmd: 'park', id: line.id }), disabled: !connected },
    {
      id: 'rec',
      label: line.recording === 'paused' ? 'Resume rec.' : line.recording === 'on' ? 'Pause rec.' : line.recording === 'off' ? 'Record' : 'Pause rec.',
      icon: line.recording === 'paused' || line.recording === 'off' ? 'circle-dot' : 'pause',
      on: line.recording === 'paused',
      onClick: () => void run({ cmd: 'record', id: line.id, action: line.recording === 'paused' ? 'resume' : line.recording === 'off' ? 'start' : 'pause' }),
      disabled: !connected,
    },
    { id: 'add', label: 'Add call', icon: 'plus', on: pane === 'add', onClick: () => setPane(pane === 'add' ? 'none' : 'add'), disabled: !connected },
    { id: 'audio', label: 'Audio', icon: 'volume', on: pane === 'audio', onClick: () => setPane(pane === 'audio' ? 'none' : 'audio') },
    { id: 'note', label: 'Note', icon: 'pen', onClick: () => document.getElementById(`phone-note-${line.id}`)?.focus() },
  ];

  return (
    <section aria-label="Call in progress" className="flex flex-col gap-4 rounded-[16px] bg-[#0b1220] p-5 text-white shadow-lg">
      <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
        <span className="rounded-full bg-[#10343A] px-2.5 py-1 font-semibold text-[#7FD8DF]">
          {line.direction === 'inbound' ? 'Inbound' : 'Outbound'}
          {line.via ? ` · ${line.via}` : ''}
          {line.consultFor ? ' · speaking first' : ''}
          {line.conference ? ' · conference' : ''}
        </span>
        {connected && (line.recording === 'on' || line.recording === 'policy') ? (
          <span className="flex items-center gap-1.5 rounded-full bg-[#3A1614] px-2.5 py-1 font-semibold text-[#F7A39B]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#F04438]" />
            {line.recording === 'on' ? 'Recording' : 'Recording follows your extension’s policy'}
          </span>
        ) : null}
        {line.recording === 'paused' ? <span className="rounded-full bg-[#3A2810] px-2.5 py-1 font-semibold text-[#F5C27A]">Recording paused</span> : null}
        {line.direct ? <span className="rounded-full bg-white/10 px-2.5 py-1 text-white/80" title="Placed directly: not in the history until the phone system reports it.">Direct</span> : null}
        <span className="ml-auto text-white/60">
          {connected ? [line.codec ? `HD · ${line.codec}` : null, line.mos !== null ? `MOS ${line.mos.toFixed(1)}` : 'MOS not measured yet'].filter(Boolean).join(' · ') : ''}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <CallerBadge name={name ?? line.remote} size={64} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[22px] font-bold">{name ?? prettyNumber(line.remote)}</div>
          <div className="truncate text-[13px] text-white/70">
            <Mono>{prettyNumber(line.remote)}</Mono>
            {company && company !== name ? ` · ${company}` : ''}
          </div>
        </div>
        <div className="text-right">
          <Mono className="block text-[34px] leading-none font-medium">{connected ? clock(elapsed) : ringing ? 'Ringing' : line.state === 'early' ? 'Ringing…' : 'Calling…'}</Mono>
          {line.held ? <span className="text-[12px] text-[#F5C27A]">On hold</span> : null}
        </div>
      </div>
      {ringing ? (
        <div className="flex gap-2">
          <Button variant="success" size="lg" icon="phone" className="flex-1 rounded-full" onClick={() => void run({ cmd: 'answer', id: line.id })}>
            Answer
          </Button>
          <Button size="lg" className="flex-1 rounded-full" onClick={() => void run({ cmd: 'decline', id: line.id, voicemail: true })}>
            To voicemail
          </Button>
          <Button variant="danger" size="lg" className="flex-1 rounded-full" onClick={() => void run({ cmd: 'decline', id: line.id })}>
            Decline
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-2">
          {CONTROLS.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={c.on}
              disabled={c.disabled}
              onClick={c.onClick}
              className={cx('flex h-[64px] flex-col items-center justify-center gap-1 rounded-[12px] border text-[11.5px] font-semibold transition-colors disabled:opacity-35', c.on ? 'border-[#2563eb] bg-[#1d3a8a] text-white' : 'border-white/10 bg-white/5 text-white/85 hover:bg-white/10')}
            >
              <Icon name={c.icon} size={18} />
              {c.label}
            </button>
          ))}
        </div>
      )}
      {consult ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-white/10 bg-white/5 p-3 text-[12.5px]">
          <span className="min-w-0 flex-1">
            Speaking first to <b>{consult.remoteName ?? prettyNumber(consult.remote)}</b> ({consult.state === 'connected' ? 'connected' : 'ringing'}). {name ?? prettyNumber(line.remote)} is on hold.
          </span>
          <Button size="sm" variant="primary" disabled={consult.state !== 'connected'} onClick={() => void run({ cmd: 'complete', id: consult.id })}>
            Complete transfer
          </Button>
          <Button size="sm" onClick={() => void run({ cmd: 'cancelConsult', id: consult.id })}>
            Cancel
          </Button>
        </div>
      ) : null}
      {consultOf ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-white/10 bg-white/5 p-3 text-[12.5px]">
          <span className="min-w-0 flex-1">
            {consultOf.remoteName ?? prettyNumber(consultOf.remote)} is on hold while you speak first.
          </span>
          <Button size="sm" variant="primary" disabled={!connected} onClick={() => void run({ cmd: 'complete', id: line.id })}>
            Complete transfer
          </Button>
          <Button size="sm" onClick={() => void run({ cmd: 'cancelConsult', id: line.id })}>
            Cancel
          </Button>
        </div>
      ) : null}
      {pane === 'keypad' ? <DtmfPad id={line.id} /> : null}
      {pane === 'transfer' ? <TransferPanel line={line} onDone={() => setPane('none')} callerName={name ?? prettyNumber(line.remote)} /> : null}
      {pane === 'add' ? <AddCall onDone={() => setPane('none')} /> : null}
      {pane === 'audio' ? (
        <div className="rounded-[12px] border border-white/10 bg-white/5 p-3">
          <AudioDevices dark />
        </div>
      ) : null}
      <Button variant="danger" size="lg" icon="phone-off" className="w-full rounded-full" onClick={() => void run({ cmd: ringing ? 'decline' : 'hangup', id: line.id })}>
        {ringing ? 'Decline' : 'End call'}
      </Button>
    </section>
  );
}

function DtmfPad({ id }: { id: string }) {
  const [sent, setSent] = useState('');
  return (
    <div className="rounded-[12px] border border-white/10 bg-white/5 p-3">
      <Mono className="mb-2 block min-h-[22px] text-[18px] tracking-[2px] text-white/90">{sent}</Mono>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Keypad tones">
        {KEYPAD.map((k) => (
          <button
            key={k.d}
            type="button"
            onClick={() => {
              void runPhone({ cmd: 'dtmf', id, digit: k.d });
              setSent((s) => (s + k.d).slice(-24));
            }}
            className="h-11 rounded-[10px] bg-white/10 font-mono text-[18px] text-white hover:bg-white/15"
          >
            {k.d}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Speak first or Transfer now, per colleague with presence (W02), or to a typed number. */
function TransferPanel({ line, onDone, callerName }: { line: Line; onDone: () => void; callerName: string }) {
  const exts = useExtensions();
  const own = usePhoneState((s) => s.extension);
  const [to, setTo] = useState('');
  const term = to.trim().toLowerCase();
  const people = (exts.data ?? [])
    .filter((e) => e.enabled && e.extension !== own && (!term || e.name.toLowerCase().includes(term) || e.extension.includes(term) || (e.user_name ?? '').toLowerCase().includes(term)))
    .slice(0, 6);
  const go = async (target: string, attended: boolean) => {
    const r = await runPhone(attended ? { cmd: 'consult', id: line.id, to: target } : { cmd: 'transfer', id: line.id, to: target });
    if (!r.ok) toast('error', r.message);
    else onDone();
  };
  const typed = /^\+?[0-9*#]{2,32}$/.test(to.trim().replace(/[\s()-]/g, ''));
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between text-[12.5px]">
        <b>Transfer</b>
        <span className="text-white/60">{callerName} stays on hold while you speak first</span>
      </div>
      <input
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="Colleague, extension or number"
        aria-label="Transfer to"
        autoFocus
        className="h-9 rounded-[8px] border border-white/15 bg-white/5 px-3 text-[13px] text-white outline-none placeholder:text-white/40 focus:border-[#2563eb]"
      />
      <ul className="flex flex-col">
        {people.map((p) => (
          <li key={p.id} className="flex items-center gap-2 border-b border-white/5 py-1.5 last:border-b-0">
            <span className={cx('h-2 w-2 shrink-0 rounded-full', p.presence === 'online' ? 'bg-[#22A861]' : p.presence === 'busy' || p.presence === 'dnd' ? 'bg-[#F04438]' : p.presence === 'away' || p.presence === 'in_meeting' ? 'bg-[#F79009]' : 'bg-white/30')} />
            <span className="min-w-0 flex-1 truncate text-[12.5px]">
              <b>{p.user_name ?? p.name}</b> · {p.extension}
              <span className="block text-[11px] text-white/50">{p.presence === 'offline' ? 'Not registered' : p.presence.replace('_', ' ')}</span>
            </span>
            <Button size="sm" variant="primary" onClick={() => void go(p.extension, true)}>
              Speak first
            </Button>
            <Button size="sm" onClick={() => void go(p.extension, false)}>
              Transfer now
            </Button>
          </li>
        ))}
        {typed && !people.length ? (
          <li className="flex items-center gap-2 py-1.5">
            <Mono className="min-w-0 flex-1 text-[13px]">{prettyNumber(to)}</Mono>
            <Button size="sm" variant="primary" onClick={() => void go(to, true)}>
              Speak first
            </Button>
            <Button size="sm" onClick={() => void go(to, false)}>
              Transfer now
            </Button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** Add call: the current call goes on hold and another is placed; Conference merges them. */
function AddCall({ onDone }: { onDone: () => void }) {
  const [n, setN] = useState('');
  return (
    <form
      className="flex items-center gap-2 rounded-[12px] border border-white/10 bg-white/5 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void runPhone({ cmd: 'dial', number: n }).then((r) => {
          if (!r.ok) toast('error', r.message);
          else onDone();
        });
      }}
    >
      <input value={n} onChange={(e) => setN(e.target.value)} placeholder="Number or extension" aria-label="Add a call to" autoFocus inputMode="tel" className="h-9 min-w-0 flex-1 rounded-[8px] border border-white/15 bg-white/5 px-3 font-mono text-[13px] text-white outline-none placeholder:text-white/40" />
      <Button type="submit" variant="success" icon="phone" disabled={!/^\+?[0-9*#]{2,32}$/.test(n.replace(/[\s()-]/g, ''))}>
        Call
      </Button>
    </form>
  );
}

/** Calls on hold and call waiting (VOIP-CTL-05). */
function OtherLines({ lines }: { lines: Line[] }) {
  return (
    <div className="flex flex-col gap-2">
      {lines.map((l) => (
        <div key={l.id} className={cx('flex items-center gap-3 rounded-[12px] border px-3.5 py-2.5', l.state === 'ringing' ? 'border-success/30 bg-success-bg' : 'border-line bg-surface')}>
          <Icon name={l.state === 'ringing' ? 'phone-incoming' : 'pause'} size={16} className={l.state === 'ringing' ? 'text-success' : 'text-ink-3'} />
          <span className="min-w-0 flex-1 text-[12.5px]">
            <b>{l.state === 'ringing' ? 'Call waiting' : l.held ? 'On hold' : l.state === 'connected' ? 'Connected' : 'Calling'}</b> · {l.remoteName ?? prettyNumber(l.remote)}
            {l.via ? <span className="text-ink-3"> · {l.via}</span> : null}
          </span>
          {l.state === 'ringing' ? (
            <>
              <Button size="sm" variant="success" onClick={() => void runPhone({ cmd: 'answer', id: l.id })}>
                Hold & answer
              </Button>
              <Button size="sm" onClick={() => void runPhone({ cmd: 'decline', id: l.id, voicemail: true })}>
                To voicemail
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => void runPhone({ cmd: 'focus', id: l.id }).then(() => (l.held ? runPhone({ cmd: 'hold', id: l.id, on: false }) : undefined))}>
                {l.held ? 'Resume' : 'Show'}
              </Button>
              <IconButton icon="phone-off" label="End this call" onClick={() => void runPhone({ cmd: 'hangup', id: l.id })} className="text-danger" />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** Who the caller is to the business (VOIP-POP-01): match confidence, open records, links into CRM and Billing. */
export function ScreenPopCard({ line }: { line: Pick<Line, 'remote' | 'context' | 'remoteName'> }) {
  const { openInNewTab } = useTab();
  const c: ScreenPop | null = line.context;
  if (!c) {
    return (
      <Panel title={line.remoteName ?? prettyNumber(line.remote)} sub="Looking up who this is…">
        <span className="text-[12px] text-ink-3">WorkSuite is matching the number against contacts, accounts and leads.</span>
      </Panel>
    );
  }
  if (!c.matched) {
    return (
      <Panel title={prettyNumber(line.remote)} sub={c.confidence === 'internal' ? 'An internal number' : c.confidence === 'withheld' ? 'The number is withheld' : 'No contact match'}>
        {c.confidence === 'none' ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon="user-plus" onClick={() => openInNewTab(`/contacts?new=1&mobile=${encodeURIComponent(line.remote.replace(/[^0-9+]/g, ''))}`, 'New contact')}>
              Create contact
            </Button>
            <Button size="sm" icon="plus" onClick={() => openInNewTab('/crm/leads', 'Leads')}>
              Create lead
            </Button>
          </div>
        ) : null}
      </Panel>
    );
  }
  const who = c.contact ?? c.lead ?? null;
  const items: Array<{ kind: string; title: string; value: string; route: string; tone?: string }> = [
    ...c.deals.filter((d) => d.open).map((d) => ({ kind: 'Deal', title: `${d.name} · ${d.stage}`, value: money(d.amount, d.currency), route: `/crm?deal=${d.id}` })),
    ...c.quotes.map((q) => ({ kind: 'Quote', title: `${q.number} · ${q.status}`, value: money(q.total, q.currency), route: `/crm?quote=${q.id}` })),
    ...c.invoices.map((i) => ({ kind: 'Invoice', title: `${i.number}${i.overdue ? ' · overdue' : ''}`, value: money(i.outstanding || i.total, i.currency), route: `/billing?invoice=${i.id}`, tone: i.overdue ? 'text-danger' : undefined })),
    ...c.tasks.map((t) => ({ kind: 'Task', title: t.title, value: t.due ?? '', route: `/tasks?task=${t.id}` })),
  ];
  return (
    <Panel
      title={who?.name ?? c.account?.name ?? prettyNumber(line.remote)}
      sub={[c.contact?.job_title, c.contact?.company ?? c.account?.name].filter(Boolean).join(' · ') || undefined}
      action={<Chip tone={c.confidence === 'contact' ? 'success' : 'indigo'}>{c.confidence === 'contact' ? 'Exact match' : c.confidence === 'account' ? 'Account match' : 'Lead match'}</Chip>}
      bodyClassName="flex flex-col gap-3"
    >
      <div className="flex flex-wrap gap-3 text-[12px] font-semibold">
        {c.contact ? (
          <button type="button" className="text-primary underline" onClick={() => openInNewTab(`/contacts?open=${c.contact!.id}`, c.contact!.name)}>
            Open contact
          </button>
        ) : null}
        {c.account ? (
          <button type="button" className="text-primary underline" onClick={() => openInNewTab(`/crm?account=${c.account!.id}`, c.account!.name)}>
            Open account
          </button>
        ) : null}
        {c.lead ? (
          <button type="button" className="text-primary underline" onClick={() => openInNewTab(`/crm/leads/${c.lead!.id}`, c.lead!.name)}>
            Open lead
          </button>
        ) : null}
      </div>
      {items.length ? (
        <div>
          <div className="mb-1 text-[11px] font-bold tracking-[.3px] text-ink-3 uppercase">Open in CRM & billing</div>
          <ul className="flex flex-col">
            {items.slice(0, 8).map((it, i) => (
              <li key={i}>
                <button type="button" onClick={() => openInNewTab(it.route, it.title)} className="flex w-full items-center gap-2 rounded-[6px] px-1 py-1 text-left text-[12px] hover:bg-subtle">
                  <span className="w-14 shrink-0 text-[10.5px] font-bold text-primary uppercase">{it.kind}</span>
                  <span className={cx('min-w-0 flex-1 truncate', it.tone)}>{it.title}</span>
                  <Mono className={cx('shrink-0 text-ink-2', it.tone)}>{it.value}</Mono>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <span className="text-[12px] text-ink-3">Nothing open in CRM or billing.</span>
      )}
      {c.calls.length ? (
        <span className="text-[11.5px] text-ink-3">
          Last call {c.calls[0]!.at ? new Date(`${c.calls[0]!.at.replace(' ', 'T')}Z`).toLocaleDateString() : ''}
          {c.calls[0]!.agent ? ` with ${c.calls[0]!.agent}` : ''}
        </span>
      ) : null}
      {c.unavailable?.length ? <span className="text-[11px] text-ink-3">{c.unavailable.join(' ')}</span> : null}
    </Panel>
  );
}

/** Notes during the call, saved to the call when it ends; a follow-up task; the outcome (W02, VOIP-CTL-06). */
function NotesCard({ line }: { line: Line }) {
  const { openInNewTab } = useTab();
  const [busy, setBusy] = useState(false);
  const name = line.remoteName ?? prettyNumber(line.remote);
  const followUp = async () => {
    setBusy(true);
    try {
      const due = new Date();
      due.setDate(due.getDate() + 1);
      await apiPost('/api/tasks', { title: `Follow up with ${name}`, description: line.note ? `<p>${line.note.replace(/</g, '&lt;')}</p>` : '', due_date: isoDay(due), priority: 'medium', tags: ['call'] });
      toast('success', 'Follow-up task created for tomorrow.');
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Call notes" sub="Saved to the call and the contact’s timeline when the call ends" bodyClassName="flex flex-col gap-2">
      <textarea
        id={`phone-note-${line.id}`}
        value={line.note}
        onChange={(e) => void runPhone({ cmd: 'note', id: line.id, text: e.target.value })}
        rows={6}
        placeholder="What was said, what was promised…"
        aria-label="Call notes"
        className={TEXTAREA}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon="list-todo" loading={busy} onClick={() => void followUp()}>
          Create follow-up task
        </Button>
        {line.context?.account ? (
          <Button size="sm" icon="file-text" onClick={() => openInNewTab(`/crm?account=${line.context!.account!.id}`, line.context!.account!.name)}>
            New quote
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

/** After the call: save the note, choose the outcome (wrap-up), call again. */
function AfterCall({ line }: { line: Line }) {
  const codes = useWrapupCodes();
  const offered = codes.data?.offered ?? false;
  const list = offered ? rowsOf(codes.data).map((c) => ({ value: c.code, label: c.label })) : DEFAULT_OUTCOMES.map((o) => ({ value: o, label: o }));
  const [outcome, setOutcome] = useState('');
  const [saving, setSaving] = useState(false);
  const [callId, setCallId] = useState<number | null>(line.callId);
  const { remote, createdAt, direction } = line;
  useEffect(() => {
    if (callId !== null) return;
    let gone = false;
    // A call taken or placed directly is in the history only once the switch reports it (G-01): look for it.
    const find = async () => {
      for (const wait of [0, 15_000, 45_000]) {
        await new Promise((r) => setTimeout(r, wait));
        if (gone) return;
        const id = await phone.findCall({ remote, createdAt, direction });
        if (id) {
          if (!gone) setCallId(id);
          return;
        }
      }
    };
    void find();
    return () => {
      gone = true;
    };
  }, [callId, remote, createdAt, direction]);
  const duration = line.answeredAt && line.endedAt ? Math.round((line.endedAt - line.answeredAt) / 1000) : 0;
  const save = async () => {
    if (!callId) return;
    setSaving(true);
    try {
      if (line.note.trim()) await phoneApi.addNote(callId, line.note.trim());
      if (outcome) {
        try {
          await phoneApi.wrapup(callId, outcome);
        } catch {
          // No wrap-up on this server yet: the outcome goes on the call as a note, where people will see it.
          await phoneApi.addNote(callId, `Outcome: ${outcome}`);
        }
      }
      toast('success', 'Saved to the call.');
      void runPhone({ cmd: 'dismissEnded' });
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-ground p-5 scroll-thin">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3">
        <section className="flex items-center gap-4 rounded-[16px] bg-[#0b1220] p-5 text-white">
          <CallerBadge name={line.remoteName ?? line.remote} size={52} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[18px] font-bold">{line.remoteName ?? prettyNumber(line.remote)}</div>
            <div className="text-[12.5px] text-white/70">
              {line.endReason ?? 'Call ended'} · <Mono>{clock(duration)}</Mono>
            </div>
          </div>
          <Button variant="success" icon="phone" onClick={() => void runPhone({ cmd: 'dial', number: line.remote, name: line.remoteName })}>
            Call again
          </Button>
        </section>
        <Panel title="Wrap-up" sub={callId ? 'Saved to the call and the contact’s timeline' : 'Waiting for the phone system to report this call…'} bodyClassName="flex flex-col gap-2">
          <textarea value={line.note} onChange={(e) => void runPhone({ cmd: 'note', id: line.id, text: e.target.value })} rows={5} placeholder="Notes" aria-label="Call notes" className={TEXTAREA} />
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-ink-2">Outcome (wrap-up)</span>
            <select aria-label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px]">
              <option value="">Choose an outcome</option>
              {list.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" loading={saving} disabled={!callId || (!line.note.trim() && !outcome)} onClick={() => void save()}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => void runPhone({ cmd: 'dismissEnded' })}>
              Done
            </Button>
            {!callId ? (
              <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => void navigator.clipboard?.writeText(line.note).then(() => toast('success', 'Notes copied.'), () => undefined)}>
                Copy notes
              </button>
            ) : null}
          </div>
        </Panel>
        <ScreenPopCard line={line} />
      </div>
    </div>
  );
}

