import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx, Spinner, Switch } from '../../components/ui';
import { ApiError, apiGet } from '../../core/api';
import { text } from '../../core/i18n';
import { listStamp, parseTs, stampDayLabel, todayInZone, wallToUtc } from '../../core/time';
import { useNow } from '../../core/use-now';
import { toast } from '../../core/toasts';
import { send } from './api';
import { SECTIONS, type QueueAnswer, type QueueCard } from './calls';
import { Caption, ConfirmSheet, dial, dialDigits, dueLabel, outcomesOf } from './calls-parts';
import { btn, btnPrimary, Card, Field, Initials, input, PageHeader, Pill, Planned, type PillTone } from './parts';
import { peopleOf, refusal, type ContactDetail, type Options } from './types';

/**
 * The agent workspace (MKT-CAL-03…11; the W11 / DK11 design): one contact at a time, the script beside them, the ten
 * ways a call can end, and the wrap-up — notes, a callback with its time and who makes it, the hand-over to CRM for
 * somebody interested.
 *
 * `GET calls/queue` takes the next contact: the server hands it to this agent alone (an atomic claim) and keeps it
 * theirs until they save how the call went or let it go — after 20 idle minutes it lets go itself. Asking again gives
 * the same contact, so nothing is lost by coming back; a callback that is due comes first. Each new claim is asked
 * for with a new nonce (the shell's `claim`, the global key's, Next contact's, each visit's own), and never asked again
 * behind the agent's back: a refetch would take another contact. Whoever comes back is asked afresh, and the server
 * says who they hold.
 *
 * Every rule is the server's: whether the contact may be called, what "Do not call" suppresses, whether a hand-over
 * is allowed. A refusal is shown in its words; a contact taken back by the server (409) is said so, and the next one
 * is taken.
 */

/** What an agent typed for a contact, kept while they look at the contact's page and come back. */
const drafts = new Map<number, Wrap>();

interface Wrap {
  outcome: string | null;
  notes: string;
  day: string;
  time: string;
  who: string;
  handover: boolean;
}

const EMPTY_WRAP: Wrap = { outcome: null, notes: '', day: '', time: '10:00', who: '', handover: true };

/** A claim nobody finishes is let go after this long (the server's `Calls::CLAIM_MINUTES`). */
const CLAIM_MINUTES = 20;

/** Everything Marketing shows but the vocabulary and a claim: a claim is taken only when asked for. */
export function refreshAfterCall(qc: QueryClient): Promise<void> {
  return qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'marketing' && q.queryKey[1] !== 'options' && !(q.queryKey[1] === 'calls' && q.queryKey[2] === 'claim') });
}

export function Workspace({ options, campaignId, claim, onClaimed, onTab, onContact, tabs, waiting }: {
  options: Options;
  campaignId: number | null;
  claim: string | null;
  onClaimed: () => void;
  onTab: (t: 'queue' | 'callbacks' | 'work') => void;
  onContact: (id: number) => void;
  tabs: ReactNode;
  waiting: number | null;
}) {
  const qc = useQueryClient();
  // Each visit asks afresh (the server answers with the contact this agent holds, or the next one); so does each claim.
  const [nonce, setNonce] = useState(() => claim ?? `open-${Date.now()}`);
  const seen = useRef(claim);
  const handed = useRef<string | null>(null);
  const [busy, setBusy] = useState<'skip' | 'release' | null>(null);
  const now = useNow(30_000).getTime();

  // A new claim from the shell (the global key, the tray, a callback's Call now): take the next contact again.
  useEffect(() => {
    if (claim && claim !== seen.current) {
      seen.current = claim;
      setNonce(claim);
    }
  }, [claim]);

  const q = useQuery({
    queryKey: ['marketing', 'calls', 'claim', campaignId ?? 'all', nonce],
    queryFn: ({ signal }) => apiGet<QueueAnswer>('/api/marketing/calls/queue', campaignId ? { campaign: campaignId } : undefined, signal),
    retry: false,
    // Asked once per nonce: a refetch would take somebody else's next contact.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // The shell's claim is spent once answered: it drops it from the address, so a reload does not take another.
  useEffect(() => {
    if (claim && claim === nonce && handed.current !== claim && q.isFetched && !q.isFetching) {
      handed.current = claim;
      onClaimed();
    }
  }, [claim, nonce, q.isFetched, q.isFetching, onClaimed]);

  const card = q.data?.card ?? null;
  const next = () => setNonce(String(Date.now()));

  async function handBack(then: 'next' | 'queue') {
    if (!card) return;
    setBusy(then === 'next' ? 'skip' : 'release');
    try {
      // Skip: to the back of the queue for a while, so Next contact gives somebody else. Release: anybody may take them now.
      await send('POST', `/api/marketing/calls/queue/${card.queue_id}/skip`, then === 'next' ? { later: true } : {});
    } catch {
      /* Already let go (the 20 minutes passed): what comes next is what matters. */
    } finally {
      setBusy(null);
    }
    drafts.delete(card.queue_id);
    if (then === 'next') next();
    else onTab('queue');
    void refreshAfterCall(qc);
  }

  const claimedAt = card?.claimed_at ? parseTs(card.claimed_at).getTime() : Number.NaN;
  const held = Number.isNaN(claimedAt) ? null : Math.max(0, Math.floor((now - claimedAt) / 60_000));
  const sub = card
    ? [
      card.campaign.name,
      waiting !== null ? text('{n} waiting for you', { n: waiting.toLocaleString() }) : null,
      held === null
        ? text('yours until you save an outcome or release it (released after {n} min idle)', { n: CLAIM_MINUTES })
        : text('claimed {ago} (auto-release in {left} min)', { ago: held === 0 ? text('just now') : text('{n} min ago', { n: held }), left: Math.max(0, CLAIM_MINUTES - held) }),
    ].filter(Boolean).join(' · ')
    : 'One contact at a time. A callback that is due comes first.';

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <PageHeader
        crumbs={['Calls']}
        title="My call queue"
        sub={sub}
        actions={
          <>
            {card ? (
              <>
                <button type="button" className={btn} onClick={() => void handBack('next')} disabled={busy !== null} title="Hand this contact back and take the next one">
                  <Icon name="forward" size={15} /> Skip
                </button>
                <button type="button" className={btn} onClick={() => void handBack('queue')} disabled={busy !== null} title="Hand this contact back and stop calling for now">
                  Release
                </button>
              </>
            ) : null}
            <button type="button" className={btnPrimary} onClick={next} disabled={!!card || q.isFetching} title={card ? 'Save an outcome, skip or release this contact first.' : undefined}>
              <Icon name="chevron-right" size={15} /> Next contact
            </button>
          </>
        }
      />
      {tabs}
      {q.isFetching && !card ? (
        <Spinner label="Taking the next contact…" />
      ) : q.isError ? (
        <Card>
          <p className="m-0 text-[13px] text-ink-2">{refusal(q.error, 'The call queue could not be loaded.')}</p>
          <button type="button" className={cx(btn, 'mt-3')} onClick={next}>
            <Icon name="refresh" size={15} /> Try again
          </button>
        </Card>
      ) : card ? (
        <CardWork
          key={card.queue_id}
          card={card}
          options={options}
          onContact={onContact}
          onDone={() => {
            next();
            void refreshAfterCall(qc);
          }}
        />
      ) : (
        <Card title="Nobody to call right now">
          <p className="m-0 text-[13px] text-ink-2">{q.data?.why ?? 'Nobody is waiting.'}</p>
          {q.data?.next_at ? <p className="m-0 mt-1 text-[12.5px] text-ink-3">{text('The next retry or callback is due {when}.', { when: dueLabel(q.data.next_at) })}</p> : null}
          {(q.data?.closed ?? []).length ? (
            <ul className="m-0 mt-2 flex list-none flex-col gap-1 border-t border-line/70 p-0 pt-2 text-[12.5px] text-ink-3">
              {q.data!.closed.map((x) => (
                <li key={x.campaign}>
                  <b className="font-semibold text-ink-2">{x.campaign}:</b> {x.why}
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className={cx(btn, 'mt-3')} onClick={next}>
            <Icon name="refresh" size={15} /> Look again
          </button>
        </Card>
      )}
    </div>
  );
}

/** Minutes and seconds with this contact — since the claim, or since Call was pressed: "03:12". */
function CallTimer({ since }: { since: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  const s = since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
  const pad = (v: number) => String(v).padStart(2, '0');
  const label = s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  return (
    <span role="timer" aria-label={since === null ? 'Call not started' : text('With this contact for {t}', { t: label })} className={cx('font-mono text-[22px] font-semibold tabular-nums', since === null ? 'text-ink-3' : 'text-ink')}>
      {label}
    </span>
  );
}

/** The contact's consent as the server holds it: phone first (who may be called), then email. */
function consentPills(d: ContactDetail | undefined): Array<{ tone: PillTone; label: string }> {
  if (!d) return [];
  const pills: Array<{ tone: PillTone; label: string }> = [];
  const phone = d.consent?.phone ?? null;
  if (phone === 'granted') {
    const last = [...(d.consent_history ?? [])].filter((h) => h.channel === 'phone' && h.status === 'granted').sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))[0];
    pills.push({ tone: 'green', label: ['Phone consent', last ? [last.source_label?.toLowerCase(), last.at ? stampDayLabel(last.at, 'short') : null].filter(Boolean).join(' ') : null].filter(Boolean).join(' · ') });
  } else if (phone === 'withdrawn') pills.push({ tone: 'red', label: 'Phone consent withdrawn' });
  else pills.push({ tone: 'slate', label: 'No phone consent recorded' });
  if ((d.suppressed ?? []).some((s) => s.channel === 'email')) pills.push({ tone: 'red', label: 'Email: suppressed' });
  else if (d.consent?.email === 'granted') pills.push({ tone: 'green', label: 'Email: subscribed' });
  else if (d.consent?.email === 'withdrawn') pills.push({ tone: 'amber', label: 'Email: unsubscribed' });
  else if (d.email) pills.push({ tone: 'slate', label: 'Email: no consent' });
  return pills;
}

/** One contact in hand: who they are, the script, the outcome and the wrap-up. Keyed by the queue row, so each starts clean. */
function CardWork({ card, options, onContact, onDone }: { card: QueueCard; options: Options; onContact: (id: number) => void; onDone: () => void }) {
  const c = card.contact;
  const [w, setW] = useState<Wrap>(() => drafts.get(card.queue_id) ?? EMPTY_WRAP);
  // The call timer counts from the claim when the server says when that was, else from pressing Call.
  const [calledAt, setCalledAt] = useState<number | null>(() => {
    const t = card.claimed_at ? parseTs(card.claimed_at).getTime() : Number.NaN;
    return Number.isNaN(t) ? null : t;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askDnc, setAskDnc] = useState(false);
  const set = <K extends keyof Wrap>(k: K, v: Wrap[K]) =>
    setW((was) => {
      const now = { ...was, [k]: v };
      drafts.set(card.queue_id, now);
      return now;
    });

  // The contact's consent, as their record holds it; somebody who may only call does without it.
  const detail = useQuery({
    queryKey: ['marketing', 'calls', 'contact', c.id],
    queryFn: ({ signal }) => apiGet<ContactDetail>(`/api/marketing/contacts/${c.id}`, undefined, signal),
    retry: false,
    staleTime: 60_000,
  });
  // Whether this office's phone system answers at all: then the call goes through the WorkSuite phone.
  const pbx = useQuery({
    queryKey: ['marketing', 'calls', 'voip-status'],
    queryFn: ({ signal }) => apiGet<{ pbx?: { ok?: boolean } }>('/api/voip/status', undefined, signal),
    retry: false,
    staleTime: 5 * 60_000,
  });

  const company = options.companies.find((co) => co.id === card.campaign.org_id);
  const mayConvert = !!company?.can.convert;
  const outcomes = outcomesOf(options);
  const callback = w.outcome === 'call_back';
  const handoverAllowed = w.outcome === 'interested' && mayConvert && !c.crm_lead_id;
  const last = card.calls[0];
  const pills = consentPills(detail.data);
  const handoverWhy = c.crm_lead_id ? 'Already a CRM lead' : !mayConvert ? 'Handing over to CRM needs the convert-to-CRM permission' : w.outcome !== 'interested' ? 'For somebody interested' : 'Uses LeadWriter · channel “marketing”';

  async function call() {
    if (calledAt === null) setCalledAt(Date.now());
    await dial(c.phone);
  }

  async function save() {
    if (!w.outcome) return;
    const m = /^(\d{2}):(\d{2})$/.exec(w.time);
    const at = callback && w.day && m ? wallToUtc(w.day, Number(m[1]) * 60 + Number(m[2])) : null;
    if (callback && !at) {
      setError('Say when to call back.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await send('POST', `/api/marketing/calls/queue/${card.queue_id}/outcome`, {
        outcome: w.outcome,
        notes: w.notes,
        ...(at ? { follow_up_at: at, follow_up_user_id: w.who ? Number(w.who) : undefined } : {}),
        ...(handoverAllowed && w.handover ? { handover: true } : {}),
      });
      drafts.delete(card.queue_id);
      toast('success', r.message ?? 'Call recorded');
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Let go after 20 idle minutes, or finished elsewhere: said so, and the next contact taken.
        drafts.delete(card.queue_id);
        toast('error', e.message || 'That contact is no longer yours to call.');
        onDone();
        return;
      }
      setError(refusal(e, 'The call could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  const sub = [
    c.company ?? c.job_title,
    text('attempt {n} of {max}', { n: card.attempts + 1, max: card.campaign.max_attempts }),
    last ? text('last: {outcome}', { outcome: last.outcome_label.toLowerCase() }) : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="flex min-w-0 flex-wrap items-start gap-4">
      <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-4">
        <section aria-label="Who to call" className="rounded-[12px] border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Initials name={c.name} size={44} />
            <div className="min-w-0 flex-1">
              <button type="button" onClick={() => onContact(c.id)} className="max-w-full truncate text-left text-[17px] font-bold text-ink hover:underline">
                {c.name}
              </button>
              <div className="truncate text-[12.5px] text-ink-3">{sub}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <CallTimer since={calledAt} />
              <button type="button" className={btnPrimary} onClick={() => void call()} disabled={!dialDigits(c.phone)}>
                <Icon name="phone" size={15} /> Call via WorkSuite Phone
              </button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px]">
            <span className="text-[16px] font-semibold text-ink tabular-nums">{c.phone ?? 'No number'}</span>
            {c.email ? <span className="text-ink-3">{c.email}</span> : null}
            {[c.industry, c.city].filter(Boolean).length ? <span className="text-ink-3">{[c.industry, c.city].filter(Boolean).join(' · ')}</span> : null}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {pills.map((p) => (
              <Pill key={p.label} tone={p.tone}>
                {p.label}
              </Pill>
            ))}
            {pbx.data?.pbx?.ok ? <Pill tone="blue">Calling via WorkSuite Phone</Pill> : null}
            {card.callback ? <Pill tone="violet">{text('Callback due {when}', { when: dueLabel(card.callback.at) })}</Pill> : null}
            {c.crm_lead_id ? <Pill tone="green">Already a CRM lead</Pill> : null}
          </div>
          {card.campaign.objective ? (
            <p className="m-0 mt-2.5 text-[13px] text-ink-2">
              <b className="font-semibold text-ink">Objective:</b> {card.campaign.objective}
            </p>
          ) : null}
        </section>

        <Card title={card.script ? text('Script · {name}', { name: card.script.name }) : 'Script'}>
          {card.script ? (
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {SECTIONS.map(([k, label], i) => (
                <li key={k} className="border-b border-line/70 pb-2.5 last:border-b-0 last:pb-0">
                  <Caption>{`${i + 1}. ${label}`}</Caption>
                  <p className={cx('m-0 text-[13.5px] leading-snug whitespace-pre-line', card.script!.sections[k]?.trim() ? 'text-ink' : 'text-ink-3')}>{card.script!.sections[k]?.trim() || '—'}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="m-0 text-[13px] text-ink-3">This campaign has no script.</p>
          )}
        </Card>

        {card.calls.length || card.timeline.length ? (
          <Card title="Earlier calls and history">
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[12.5px]">
              {card.calls.map((p) => (
                <li key={`call-${p.id}`}>
                  <b className="font-semibold text-ink">{p.outcome_label}</b>
                  <span className="text-ink-3"> · {[p.by, listStamp(p.at), p.campaign].filter(Boolean).join(' · ')}</span>
                  {p.notes ? <span className="block text-ink-2">{p.notes}</span> : null}
                </li>
              ))}
              {card.timeline.map((t) => (
                <li key={`t-${t.id}`} className="text-ink-2">
                  {t.title}
                  {t.at ? <span className="text-ink-3"> · {listStamp(t.at)}</span> : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
        <Card title="Outcome">
          <div role="radiogroup" aria-label="Outcome" className="grid grid-cols-2 gap-2">
            {outcomes.map((o) => {
              const on = w.outcome === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set('outcome', o.value)}
                  className={cx('min-h-11 rounded-[10px] border px-3 py-2 text-left text-[13px] font-semibold', on ? (o.value === 'do_not_call' ? 'border-danger bg-danger-bg text-danger' : 'border-primary bg-selection text-primary') : 'border-line bg-surface text-ink-2 hover:bg-subtle')}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </Card>

        <Card title="Wrap-up">
          <div className="flex flex-col gap-3">
            <Field label="Call notes">
              <textarea className={`${input} h-auto py-2 leading-snug`} rows={4} value={w.notes} onChange={(e) => set('notes', e.target.value)} placeholder="What they said, what was agreed" />
            </Field>
            {callback ? (
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Call back on">
                  <input type="date" className={input} value={w.day} min={todayInZone()} onChange={(e) => set('day', e.target.value)} required />
                </Field>
                <Field label="At">
                  <input type="time" className={input} value={w.time} onChange={(e) => set('time', e.target.value)} />
                </Field>
                <Field label="By" hint="A task for them, at that time." className="col-span-2">
                  <Select value={w.who} onValueChange={(v) => set('who', v)} aria-label="Callback by" options={[{ value: '', label: 'Me' }, ...peopleOf(options, card.campaign.org_id)]} />
                </Field>
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div id="mkt-handover" className="text-[13px] font-semibold text-ink">
                  Hand over to CRM as lead
                </div>
                <div className="text-[11.5px] text-ink-3">{handoverWhy}</div>
              </div>
              <Switch label="Hand over to CRM as lead" checked={handoverAllowed && w.handover} disabled={!handoverAllowed} onChange={(v) => set('handover', v)} describedBy="mkt-handover" />
            </div>
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                  Send follow-up email <Planned />
                </div>
                <div className="text-[11.5px] text-ink-3">A template sent after the call — not available yet.</div>
              </div>
              <Switch label="Send follow-up email" checked={false} disabled onChange={() => undefined} />
            </div>
            {error ? (
              <p role="alert" className="m-0 text-[12.5px] font-medium text-danger">
                {error}
              </p>
            ) : null}
            <div>
              <button type="button" className={btnPrimary} onClick={() => (w.outcome === 'do_not_call' ? setAskDnc(true) : void save())} disabled={!w.outcome || busy}>
                <Icon name="check" size={15} /> Save outcome
              </button>
            </div>
          </div>
        </Card>
      </div>

      {askDnc ? (
        <ConfirmSheet
          title={text('Never call {name} again?', { name: c.name })}
          body="Their phone consent is withdrawn and the number goes on the do-not-call list, for every campaign of this company."
          action="Do not call"
          danger
          busy={busy}
          onClose={() => setAskDnc(false)}
          onYes={() => {
            setAskDnc(false);
            void save();
          }}
        />
      ) : null}
    </div>
  );
}
