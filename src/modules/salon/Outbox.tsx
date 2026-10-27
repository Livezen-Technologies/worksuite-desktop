import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Avatar, Modal, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import type { SalonOutboxAction, SalonOutboxItem } from '@shared/types';
import { clockAt, fetchAvailability, K, longDay, minutesOf, shortDay, STATEMENT, todayAt } from './api';
import { CHOICE_LABEL, resolveChange, SK, syncNow, useOutbox } from './offline';
import { Failed, firstName, Label, Note, Page, Panel, Tag, TouchButton, useDesk, useNow } from './parts';
import { Checkbox } from '../../components/Checkbox';

/**
 * Sync (D09, OFF-05…08): what the counter did while WorkSuite was out of
 * reach, waiting in the order it was done — and what WorkSuite would not do
 * as it was, with the choices it offered. Nothing refused is dropped by
 * itself: a person decides, and what depended on it waits for them.
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
    <Page
      title="Sync"
      sub={desk.offline ? 'WorkSuite cannot be reached — what is kept here goes when it answers.' : 'What this desk kept while WorkSuite was out of reach, and how the last send went.'}
      actions={
        <TouchButton icon="refresh" loading={sending} disabled={items.length === 0 && !desk.offline} onClick={() => void sendNow()}>
          Send now
        </TouchButton>
      }
    >
      {s?.others ? (
        <Note tone="muted">
          {s.others} change{s.others === 1 ? '' : 's'} made at this desk by somebody else {s.others === 1 ? 'waits' : 'wait'} for them to sign in here: WorkSuite takes each person’s changes as theirs.
        </Note>
      ) : null}
      {s?.problem && !desk.offline ? <Note tone="danger">{s.problem}</Note> : null}

      <div className="flex flex-col gap-3.5 xl:flex-row xl:items-start">
        <Panel title={`Waiting to sync · ${waiting.length}`} action={<span className="text-[13px] text-ink-2">Kept on this computer, encrypted · survives a restart</span>} className="min-w-0 xl:flex-1">
          {q.isError ? (
            <Failed text="The changes kept on this computer could not be read." onRetry={() => void q.refetch()} />
          ) : q.isLoading ? (
            <Spinner label="Reading the changes kept here…" />
          ) : waiting.length === 0 ? (
            <p className="py-3 text-[14px] text-ink-2">Nothing waiting. What the desk does while WorkSuite is out of reach waits here until it is sent.</p>
          ) : (
            <ol>
              {waiting.map((i, n) => {
                const needs = i.needs.find((x) => blocked.has(x)) ?? i.needs[0];
                return (
                  <li key={i.id} className="flex items-center gap-3.5 border-t border-line py-3 first:border-t-0">
                    <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-ground text-[14px] font-bold text-ink tabular-nums">{n + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[16px] font-bold text-ink">{i.label.replace(/:.*$/, '') || i.label}</div>
                      <div className="truncate text-[13px] text-ink-2">{[i.label.includes(':') ? i.label.split(':').slice(1).join(':').trim() : null, i.detail, `made ${madeAt(i.created_at, tz)}`].filter(Boolean).join(' · ')}</div>
                    </div>
                    <Tag tone="warning">
                      {needs ? `Waiting · needs the ${needs.startsWith('C-') ? 'new client' : 'booking'} ${blocked.has(needs) ? 'that needs you' : 'above'}` : 'Waiting'}
                      {i.attempts > 0 ? ` · tried ${i.attempts}×` : ''}
                    </Tag>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>

        <div className="flex w-full flex-col gap-3.5 xl:w-[480px] xl:shrink-0">
          {refused.map((i) => (
            <Refused key={i.id} item={i} dependents={items.filter((x) => i.local_id && x.needs.includes(i.local_id)).length} />
          ))}
          <Panel title="Last sync">
            <dl className="text-[15px]">
              <Row label="Finished" value={s?.last_sync ? `${clockAt(s.last_sync.at, tz)} · ${s.last_sync.accepted + s.last_sync.refused} sent, ${s.last_sync.accepted} accepted${s.last_sync.refused ? `, ${s.last_sync.refused} need${s.last_sync.refused === 1 ? 's' : ''} you` : ''}` : 'Nothing sent yet'} />
              <Row label="Duplicates skipped" value={`${s?.last_sync?.duplicates ?? 0} · each item carries its own key`} />
              <Row label="Reference data" value={s?.copy ? `Refreshed ${clockAt(s.copy.refreshed_at, tz)}` : 'No copy on this computer yet'} />
              {s?.last_contact ? <Row label="In touch with WorkSuite" value={clockAt(s.last_contact, tz)} /> : null}
            </dl>
          </Panel>
        </div>
      </div>
    </Page>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <dt className="text-ink-2">{label}</dt>
      <dd className="m-0 text-right font-semibold text-ink">{value}</dd>
    </div>
  );
}

function madeAt(iso: string, tz: string): string {
  const day = todayAt(tz, new Date(iso));
  return day === todayAt(tz) ? `at ${clockAt(iso, tz)}` : `${shortDay(day)} ${clockAt(iso, tz)}`;
}

/** A booking's wanted day and time on the salon's clock, as it was kept: "YYYY-MM-DD HH:MM", or an instant. */
function wanted(item: SalonOutboxItem, tz: string): { date: string; time: string } | null {
  const at = typeof item.payload.starts_at === 'string' ? item.payload.starts_at : null;
  if (!at || at === 'now') return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(at)) return { date: at.slice(0, 10), time: at.slice(11, 16) };
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : { date: todayAt(tz, d), time: clockAt(at, tz) };
}

/** A refusal, with what WorkSuite said and the choices it offered (D09 "Needs you"). */
function Refused({ item, dependents }: { item: SalonOutboxItem; dependents: number }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const tz = desk.location.timezone;
  const clock = useNow(60_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<'time' | 'edit' | 'drop' | null>(null);
  const next = item.next && 'starts_at' in item.next ? item.next : null;
  const candidates = item.next && 'candidates' in item.next ? item.next.candidates : [];
  const want = wanted(item, tz);
  const lines = Array.isArray(item.payload.items) ? (item.payload.items as Array<{ service_id: number; provider_id: number | string }>) : [];
  const canPick = item.choices.includes('time') && !!want && lines.length > 0 && !desk.offline;
  const asked = JSON.stringify(lines);
  /* The stylist's free times that day, nearest the time asked for: what WorkSuite would take now. */
  const day = useQuery({ queryKey: K.availability(desk.location.id, want?.date ?? '', asked), queryFn: ({ signal }) => fetchAvailability(desk.location.id, want!.date, asked, signal), enabled: canPick, staleTime: 15_000 });
  const near = (day.data?.starts ?? [])
    .filter((x) => x.free && Date.parse(x.starts_at) > clock)
    .sort((a, b) => Math.abs(minutesOf(a.label) - minutesOf(want?.time ?? '')) - Math.abs(minutesOf(b.label) - minutesOf(want?.time ?? '')))
    .slice(0, 4)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const offered = near.length ? near : next ? [{ starts_at: next.starts_at, label: next.label ?? clockAt(next.starts_at, tz), free: true, chain: [] }] : [];
  const [pick, setPick] = useState<string | null>(null);
  const chosen = offered.find((x) => x.starts_at === (pick ?? next?.starts_at)) ?? offered[0] ?? null;
  const who = lines[0] && typeof lines[0].provider_id === 'number' ? desk.options.stylists.find((x) => x.id === lines[0]!.provider_id) : null;

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

  const book = () => {
    if (!chosen) return;
    if (next && chosen.starts_at === next.starts_at && item.choices.includes('take_next')) void act({ id: item.id, action: 'take_next' }, 'book');
    else if (want) void act({ id: item.id, action: 'time', starts_at: `${want.date} ${chosen.label}` }, 'book');
  };

  return (
    <Panel className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <Tag tone="danger">Needs you</Tag>
        <span className="text-[17px] font-extrabold text-ink">From the last sync · {clockAt(item.updated_at, tz)}</span>
      </div>
      <p className="text-[15px] text-ink">
        <b>{item.label}</b>
        {item.detail ? <span className="text-ink-2"> · {item.detail}</span> : null}
      </p>
      {item.message ? <p className="text-[14px] text-ink">{item.message}</p> : null}
      {dependents > 0 ? <p className="text-[12.5px] text-ink-2">{dependents} more {dependents === 1 ? 'change waits' : 'changes wait'} for this one.</p> : null}

      {candidates.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Label>Is it one of them?</Label>
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={busy !== null}
              onClick={() => void act({ id: item.id, action: 'client', client_id: c.id }, 'client')}
              className="flex items-center gap-3 rounded-[12px] border border-line bg-surface px-3 py-2 text-left hover:bg-subtle disabled:opacity-50"
            >
              <Avatar name={c.name} size={30} />
              <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-ink">{c.name}</span>
              <span className="truncate text-[12.5px] text-ink-2">{c.phone ?? c.email ?? ''}</span>
            </button>
          ))}
        </div>
      ) : null}

      {offered.length > 0 && (item.choices.includes('take_next') || canPick) ? (
        <>
          <Label>
            {who ? `${firstName(who.name)} is free at` : 'Free at'}
            {want && want.date !== todayAt(tz) ? ` · ${longDay(want.date).replace(/ \d{4}$/, '')}` : ''}
          </Label>
          <div role="radiogroup" aria-label="Free times" className="grid grid-cols-4 gap-1.5">
            {offered.map((x) => (
              <button
                key={x.starts_at}
                type="button"
                role="radio"
                aria-checked={chosen?.starts_at === x.starts_at}
                onClick={() => setPick(x.starts_at)}
                className={cx('min-h-11 rounded-[8px] text-[16px] tabular-nums', chosen?.starts_at === x.starts_at ? 'bg-primary font-bold text-white' : 'border border-slate-line bg-surface text-ink hover:bg-subtle dark:border-line')}
              >
                {x.label}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <div className="flex flex-wrap gap-2.5">
        {item.choices.includes('drop') ? <TouchButton onClick={() => setOpen('drop')}>{CHOICE_LABEL.drop}</TouchButton> : null}
        {item.choices.includes('edit') ? <TouchButton onClick={() => setOpen('edit')}>{CHOICE_LABEL.edit}</TouchButton> : null}
        {item.choices.includes('retry') ? (
          <TouchButton loading={busy === 'retry'} onClick={() => void act({ id: item.id, action: 'retry' }, 'retry')}>
            {CHOICE_LABEL.retry}
          </TouchButton>
        ) : null}
        {item.choices.includes('time') && !offered.length ? <TouchButton onClick={() => setOpen('time')}>{CHOICE_LABEL.time}</TouchButton> : null}
        {chosen && (item.choices.includes('take_next') || canPick) ? (
          <TouchButton variant="primary" icon="check" className="flex-1" loading={busy === 'book'} onClick={book}>
            Book {chosen.label} instead
          </TouchButton>
        ) : null}
      </div>
      <p className="text-[12.5px] text-ink-2">Nothing that fails is thrown away — it stays here until someone decides.</p>

      {open === 'time' ? <ChooseTime item={item} busy={busy !== null} onClose={() => setOpen(null)} onChosen={(at) => void act({ id: item.id, action: 'time', starts_at: at }, 'time')} /> : null}
      {open === 'edit' ? <Edit item={item} busy={busy !== null} onClose={() => setOpen(null)} onSave={(changes) => void act({ id: item.id, action: 'edit', changes }, 'edit')} /> : null}
      {open === 'drop' ? (
        <Modal
          title="Drop this change?"
          onClose={() => setOpen(null)}
          footer={
            <>
              <TouchButton onClick={() => setOpen(null)}>Keep it</TouchButton>
              <TouchButton variant="danger" loading={busy === 'drop'} onClick={() => void act({ id: item.id, action: 'drop' }, 'drop')}>
                Drop {dependents > 0 ? `it and ${dependents} more` : 'it'}
              </TouchButton>
            </>
          }
        >
          <p className="text-[14px] text-ink">
            “{item.label}” is not sent to WorkSuite.
            {dependents > 0 ? ` ${dependents} ${dependents === 1 ? 'change that needs' : 'changes that need'} it ${dependents === 1 ? 'goes' : 'go'} with it.` : ''}
          </p>
          {item.kind === 'visit.checkout' ? (
            <p className="mt-2 text-[14px] font-semibold text-danger">
              The client paid this at the desk{typeof item.payload.receipt === 'string' ? ` on till receipt ${item.payload.receipt}` : ''}. Dropping it refunds nobody and leaves the money out of WorkSuite — settle it with the client, or take the payment again online, first.
            </p>
          ) : null}
        </Modal>
      ) : null}
    </Panel>
  );
}

const FIELD = 'h-12 rounded-[12px] border border-line bg-surface px-3.5 text-[15px] text-ink outline-none focus:border-primary';

/** Another time for a booking, on the salon's clock. */
function ChooseTime({ item, busy, onClose, onChosen }: { item: SalonOutboxItem; busy: boolean; onClose: () => void; onChosen: (at: string) => void }) {
  const desk = useDesk();
  const tz = desk.location.timezone;
  const was = wanted(item, tz);
  const [date, setDate] = useState(was?.date ?? todayAt(tz));
  const [time, setTime] = useState(was?.time ?? '');
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time);
  return (
    <Modal
      title="Choose a time"
      onClose={onClose}
      footer={
        <>
          <TouchButton onClick={onClose}>Cancel</TouchButton>
          <TouchButton variant="primary" loading={busy} disabled={!ok} onClick={() => onChosen(`${date} ${time}`)}>
            {ok ? `Send for ${time}` : 'Send'}
          </TouchButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-semibold text-ink-2">Day</span>
          <input type="date" className={FIELD} value={date} min={todayAt(tz)} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-semibold text-ink-2">Time</span>
          <input type="time" step={300} className={FIELD} value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <p className="text-[12.5px] text-ink-2">{ok ? `${longDay(date)}, on the salon’s clock.` : 'On the salon’s clock.'}</p>
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
        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-semibold text-ink-2">Name</span>
          <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-semibold text-ink-2">Mobile</span>
          <input className={FIELD} inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-semibold text-ink-2">Email</span>
          <input className={FIELD} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </>
    );
  } else if (item.kind === 'visit.check_in') {
    changes = { ack: ticked, statement: ticked ? STATEMENT : null, patch_override: reason.trim() || null };
    body = (
      <>
        <label className={cx('flex cursor-pointer items-center gap-3 rounded-[12px] border-2 px-3.5 py-3', ticked ? 'border-primary bg-selection' : 'border-line')}>
          <Checkbox size="lg" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
          <span className="text-[14px] font-bold text-ink">{STATEMENT}</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-ink">If a patch test is missing: why are you going ahead?</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} className="rounded-[10px] border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-primary" />
        </label>
      </>
    );
  } else {
    changes = {};
    ok = false;
    body = <p className="text-[14px] text-ink-2">{item.kind === 'visit.checkout' ? 'Money already taken is not changed here. Send it again, or settle it with the client before dropping it.' : 'A booking is changed by choosing another time.'}</p>;
  }

  return (
    <Modal
      title={`Change: ${item.label}`}
      onClose={onClose}
      footer={
        <>
          <TouchButton onClick={onClose}>Cancel</TouchButton>
          <TouchButton variant="primary" loading={busy} disabled={!ok} onClick={() => onSave(changes)}>
            Send again
          </TouchButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">{body}</div>
    </Modal>
  );
}
