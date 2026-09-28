import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, Card, Chip, Empty, Modal, Spinner, TextField } from '../../components/ui';
import { toast } from '../../core/toasts';
import type { SalonOutboxAction, SalonOutboxItem } from '@shared/types';
import { clockAt, longDay, shortDay, STATEMENT, todayAt } from './api';
import { CHOICE_LABEL, resolveChange, SK, syncNow, useOutbox } from './offline';
import { Failed, Note, Person, useDesk } from './parts';

/**
 * Changes to send (OFF-06…08): what the counter did while WorkSuite was out of
 * reach, waiting in the order it was done — and what WorkSuite would not do as
 * it was, with the choices it offered. Nothing refused is dropped by itself:
 * a person decides, and what depended on it waits for them.
 */
export default function Outbox() {
  const desk = useDesk();
  const qc = useQueryClient();
  const q = useOutbox();
  const [sending, setSending] = useState(false);
  const s = desk.sync;
  const tz = desk.location.timezone;
  const items = q.data ?? [];
  const refused = items.filter((i) => i.state === 'refused');
  const waiting = items.filter((i) => i.state === 'waiting');
  const blocked = new Set(refused.map((i) => i.local_id).filter(Boolean));

  async function sendNow() {
    setSending(true);
    try {
      const r = await syncNow();
      void qc.invalidateQueries({ queryKey: SK.all });
      if (!r.reachable) toast('warning', 'WorkSuite still cannot be reached. The changes stay here.');
      else if (r.problem) toast('error', r.problem);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex max-w-[900px] flex-col gap-4 p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-extrabold text-ink">Changes to send</h1>
          <p className="mt-0.5 text-[13px] text-ink-2">{statusLine(desk.offline, s, tz)}</p>
        </div>
        <Button icon="refresh" loading={sending} disabled={items.length === 0 && !desk.offline} onClick={() => void sendNow()}>
          Send now
        </Button>
      </div>

      {s?.others ? (
        <Note tone="muted">
          {s.others} change{s.others === 1 ? '' : 's'} made at this desk by somebody else {s.others === 1 ? 'waits' : 'wait'} for them to sign in here: WorkSuite takes each person’s changes as theirs.
        </Note>
      ) : null}
      {s?.problem && !desk.offline ? <Note tone="danger">{s.problem}</Note> : null}

      {q.isError ? (
        <Failed text="The changes kept on this computer could not be read." onRetry={() => void q.refetch()} />
      ) : q.isLoading ? (
        <Spinner label="Reading the changes kept here…" />
      ) : items.length === 0 ? (
        <Empty icon="check-circle" title="Nothing waiting." hint="What the desk does while WorkSuite is out of reach waits here until it is sent." />
      ) : (
        <>
          {refused.length > 0 ? (
            <Card title={`Needs you · ${refused.length}`}>
              <ul>
                {refused.map((i) => (
                  <Refused key={i.id} item={i} dependents={items.filter((x) => i.local_id && x.needs.includes(i.local_id)).length} />
                ))}
              </ul>
            </Card>
          ) : null}
          {waiting.length > 0 ? (
            <Card title={`Waiting to send · ${waiting.length}`}>
              <ul>
                {waiting.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
                    <Icon name={i.kind === 'client.create' ? 'user-plus' : i.kind === 'visit.check_in' ? 'check-circle' : 'calendar-check'} size={16} className="shrink-0 text-ink-3" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-bold text-ink">{i.label}</div>
                      <div className="truncate text-[12.5px] text-ink-2">{[i.detail, `made ${madeAt(i.created_at, tz)}`].filter(Boolean).join(' · ')}</div>
                    </div>
                    {i.needs.some((n) => blocked.has(n)) ? <Chip tone="warning">Waits for the change above</Chip> : i.attempts > 0 ? <Chip tone="muted">Tried {i.attempts}×</Chip> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

function statusLine(offline: boolean, s: ReturnType<typeof useDesk>['sync'], tz: string): string {
  if (!s) return '';
  const parts: string[] = [];
  if (offline) parts.push('WorkSuite cannot be reached — these go when it answers');
  else if (s.last_contact) parts.push(`Last in touch with WorkSuite at ${clockAt(s.last_contact, tz)}`);
  if (s.last_sync) parts.push(`last sent at ${clockAt(s.last_sync.at, tz)}: ${s.last_sync.accepted} done${s.last_sync.refused ? `, ${s.last_sync.refused} not` : ''}`);
  if (s.copy) parts.push(`the day’s copy taken at ${clockAt(s.copy.pulled_at, tz)}`);
  return parts.join(' · ');
}

function madeAt(iso: string, tz: string): string {
  const day = todayAt(tz, new Date(iso));
  return day === todayAt(tz) ? `at ${clockAt(iso, tz)}` : `${shortDay(day)} ${clockAt(iso, tz)}`;
}

/** A refusal, with what WorkSuite said and the choices it offered. */
function Refused({ item, dependents }: { item: SalonOutboxItem; dependents: number }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<'time' | 'edit' | 'drop' | null>(null);
  const next = item.next && 'starts_at' in item.next ? item.next : null;
  const candidates = item.next && 'candidates' in item.next ? item.next.candidates : [];

  async function act(a: SalonOutboxAction, label: string) {
    setBusy(label);
    try {
      await resolveChange(a);
      setOpen(null);
      void qc.invalidateQueries({ queryKey: SK.all });
      toast('success', a.action === 'drop' ? 'Dropped.' : desk.offline ? 'Kept — it goes when WorkSuite answers.' : 'Sent again.');
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'That could not be done.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="flex flex-col gap-2.5 border-t border-line py-3 first:border-t-0">
      <div className="flex items-start gap-3">
        <Icon name="warning" size={16} className="mt-0.5 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold text-ink">{item.label}</div>
          {item.detail ? <div className="text-[12.5px] text-ink-2">{item.detail}</div> : null}
          <div className="mt-1 text-[13px] text-danger">{item.message}</div>
          {dependents > 0 ? <div className="mt-0.5 text-[12.5px] text-ink-3">{dependents} more {dependents === 1 ? 'change waits' : 'changes wait'} for this one.</div> : null}
        </div>
      </div>

      {candidates.length > 0 ? (
        <div className="ml-7 flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-ink-2">WorkSuite already knows somebody with these details. Is it one of them?</span>
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={busy !== null}
              onClick={() => void act({ id: item.id, action: 'client', client_id: c.id }, 'client')}
              className="rounded-[8px] border border-line bg-surface px-3 py-2 text-left hover:bg-subtle disabled:opacity-50"
            >
              <Person name={c.name} sub={c.phone ?? c.email ?? undefined} size={26} />
            </button>
          ))}
        </div>
      ) : null}

      <div className="ml-7 flex flex-wrap gap-2">
        {item.choices.map((c) =>
          c === 'client' ? null : c === 'take_next' && next ? (
            <Button key={c} size="sm" variant="primary" loading={busy === c} onClick={() => void act({ id: item.id, action: 'take_next' }, c)}>
              Take {next.date ? `${shortDay(next.date)} ` : ''}
              {next.label ?? clockAt(next.starts_at, desk.location.timezone)}
            </Button>
          ) : c === 'time' ? (
            <Button key={c} size="sm" onClick={() => setOpen('time')}>
              {CHOICE_LABEL.time}
            </Button>
          ) : c === 'edit' ? (
            <Button key={c} size="sm" onClick={() => setOpen('edit')}>
              {CHOICE_LABEL.edit}
            </Button>
          ) : c === 'drop' ? (
            <Button key={c} size="sm" variant="danger" onClick={() => setOpen('drop')}>
              {CHOICE_LABEL.drop}
            </Button>
          ) : c === 'retry' ? (
            <Button key={c} size="sm" loading={busy === c} onClick={() => void act({ id: item.id, action: 'retry' }, c)}>
              {CHOICE_LABEL.retry}
            </Button>
          ) : null,
        )}
      </div>

      {open === 'time' ? <ChooseTime item={item} busy={busy !== null} onClose={() => setOpen(null)} onChosen={(at) => void act({ id: item.id, action: 'time', starts_at: at }, 'time')} /> : null}
      {open === 'edit' ? <Edit item={item} busy={busy !== null} onClose={() => setOpen(null)} onSave={(changes) => void act({ id: item.id, action: 'edit', changes }, 'edit')} /> : null}
      {open === 'drop' ? (
        <Modal
          title="Drop this change?"
          onClose={() => setOpen(null)}
          footer={
            <>
              <Button onClick={() => setOpen(null)}>Keep it</Button>
              <Button variant="danger" loading={busy === 'drop'} onClick={() => void act({ id: item.id, action: 'drop' }, 'drop')}>
                Drop {dependents > 0 ? `it and ${dependents} more` : 'it'}
              </Button>
            </>
          }
        >
          <p className="text-[13.5px] text-ink">
            “{item.label}” is not sent to WorkSuite.
            {dependents > 0 ? ` ${dependents} ${dependents === 1 ? 'change that needs' : 'changes that need'} it ${dependents === 1 ? 'goes' : 'go'} with it.` : ''}
          </p>
        </Modal>
      ) : null}
    </li>
  );
}

/** Another time for a booking, on the salon's clock. */
function ChooseTime({ item, busy, onClose, onChosen }: { item: SalonOutboxItem; busy: boolean; onClose: () => void; onChosen: (at: string) => void }) {
  const desk = useDesk();
  const tz = desk.location.timezone;
  const was = typeof item.payload.starts_at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(item.payload.starts_at) ? item.payload.starts_at : null;
  const [date, setDate] = useState(was ? (was.includes('T') ? todayAt(tz, new Date(was)) : was.slice(0, 10)) : todayAt(tz));
  const [time, setTime] = useState(was && !was.includes('T') ? was.slice(11, 16) : '');
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time);
  return (
    <Modal
      title="Choose a time"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!ok} onClick={() => onChosen(`${date} ${time}`)}>
            {ok ? `Send for ${time}` : 'Send'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField label="Day" type="date" value={date} min={todayAt(tz)} onChange={(e) => setDate(e.target.value)} />
        <TextField label="Time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
        <p className="text-[12.5px] text-ink-3">{ok ? `${longDay(date)}, on the salon’s clock.` : 'On the salon’s clock.'}</p>
      </div>
    </Modal>
  );
}

/** Change what was kept: a new client's details, a booking's time, or the check-in's reading-out. */
function Edit({ item, busy, onClose, onSave }: { item: SalonOutboxItem; busy: boolean; onClose: () => void; onSave: (changes: Record<string, string | boolean | null>) => void }) {
  const p = item.payload as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '');
  const [name, setName] = useState(str('name'));
  const [mobile, setMobile] = useState(str('mobile'));
  const [email, setEmail] = useState(str('email'));
  const [ticked, setTicked] = useState(p.ack === true);
  const [reason, setReason] = useState(str('patch_override'));

  let body;
  let changes: Record<string, string | boolean | null>;
  let ok = true;
  if (item.kind === 'client.create') {
    changes = { name: name.trim(), mobile: mobile.trim() || null, email: email.trim() || null };
    ok = name.trim() !== '';
    body = (
      <>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <TextField label="Mobile" inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} />
        <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </>
    );
  } else if (item.kind === 'visit.check_in') {
    changes = { ack: ticked, statement: ticked ? STATEMENT : null, patch_override: reason.trim() || null };
    body = (
      <>
        <label className="flex cursor-pointer items-start gap-3 rounded-[10px] bg-selection px-3.5 py-3">
          <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-primary)]" />
          <span className="text-[14px] font-bold text-ink">{STATEMENT}</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-ink">If a patch test is missing: why are you going ahead?</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} className="rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-primary" />
        </label>
      </>
    );
  } else {
    changes = {};
    ok = false;
    body = <p className="text-[13.5px] text-ink-2">A booking is changed by choosing another time.</p>;
  }

  return (
    <Modal
      title={`Change: ${item.label}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!ok} onClick={() => onSave(changes)}>
            Send again
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">{body}</div>
    </Modal>
  );
}
