import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useEffectEvent, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { NEXT_CONTACT_KEYS } from '@shared/marketing';
import { useCanOpen } from '../../../core/access';
import { ApiError } from '../../../core/api';
import { app } from '../../../core/app-state';
import { call } from '../../../core/bridge';
import { prettyAccelerator } from '../../../core/commands';
import { useStore } from '../../../core/store';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { useNow } from '../../../core/use-now';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Avatar, Button, cx, Empty, Modal, Switch } from '../../../components/ui';
import { CallButton } from '../../phone/CallButton';
import { claimNext, fetchCallbacks, MK, pageOf, releaseClaim, saveOutcome, skipClaim, useQueue, useTemplates, type Callback, type Claim, type MyQueue, type Outcome, type OutcomeInput, type OutcomeResult, type Script } from '../api';
import { useMarketingAccess } from '../access';
import { emailConsent, mailable, phoneConsent } from '../lib/consent';
import { ago, count, due, isoDay, localToUtc, minutesUntil, parseStamp } from '../lib/format';
import { OUTCOMES, outcomeInfo, outcomeLabel, outcomeReady } from '../lib/outcomes';
import { useMarketingOrg } from '../org';
import { Field, Input, Loaded, Mono, Notice, OptionalView, PageBody, PageHeader, Panel, Status, TD, TH, Table, TextArea, useAction } from '../parts';
import { SECTIONS } from './Scripts';

/**
 * DK11 · My call queue, the agent's workspace (W11, PDF p45) and D01's call-queue tab (PDF p49; WF-13; MKT-CAL-03..11,
 * MKT-CRM-01; AC-08..11). Next contact asks the server for one claim, made atomically (CAS), so two agents never get
 * the same person (AC-08, NFR-08); an idle claim goes back to the queue after 20 minutes (MKT-CAL-03, AC-09). The
 * claim shows the contact with their consent, click-to-call through WorkSuite Phone (MKT-CAL-11) and the script with
 * its tags filled in; the wrap-up records one of ten outcomes (MKT-CAL-04): a retry for no answer and busy
 * (MKT-CAL-05), a Task for a callback (MKT-CAL-06), a company-wide phone suppression for do not call (MKT-CAL-09,
 * AC-10), and the hand-over to CRM through LeadWriter, offered for interested (MKT-CAL-10, MKT-CRM-01, AC-11).
 *
 * Without marketing.call.make (B-5) the screen says why instead of offering a claim the server can only refuse.
 * `?next=1` — the global next-contact shortcut and a callback reminder's Call now — claims once on arrival.
 */
const IDLE_MINUTES = 20;

export default function Queue() {
  const access = useMarketingAccess();
  return access.call ? <Workspace /> : <NoPermission />;
}

/* ------------------------------------------------------------------------ *
 * Helpers (pure; tested on their own)
 * ------------------------------------------------------------------------ */

export type ScriptPart = { text: string } | { tag: string; value: string | null };

const TAG = /\{\{\s*([A-Za-z_]+)\s*\}\}/g;

/** A script's text with its tags filled in; a tag without a value for this contact stays as written. */
export function scriptParts(text: string, vars: Readonly<Record<string, string | null | undefined>>): ScriptPart[] {
  const out: ScriptPart[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    const v = vars[(m[1] ?? '').toLowerCase()];
    out.push({ tag: m[0], value: typeof v === 'string' && v.trim() ? v.trim() : null });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function fillScript(text: string, vars: Readonly<Record<string, string | null | undefined>>): string {
  return scriptParts(text, vars)
    .map((p) => ('text' in p ? p.text : (p.value ?? p.tag)))
    .join('');
}

/** "Nimal" from "Nimal Perera": what an agent says on the phone. */
export function firstName(name: string | null | undefined): string | null {
  return (name ?? '').trim().split(/\s+/)[0] || null;
}

/** The agreed callback time as the UTC stamp the server takes, or why it can't be saved yet. */
export function callbackStamp(date: string, time: string, now: Date): { at: string | null; problem: string | null } {
  if (!date || !time) return { at: null, problem: 'Pick the day and time agreed with the contact.' };
  const at = localToUtc(date, time);
  const d = parseStamp(at);
  if (!at || !d) return { at: null, problem: 'That day and time can’t be read.' };
  if (d.getTime() <= now.getTime()) return { at: null, problem: 'Pick a time later than now.' };
  return { at, problem: null };
}

/** The wrap-up as the agent fills it in. */
export interface Wrap {
  outcome: Outcome | null;
  notes: string;
  date: string;
  time: string;
  handover: boolean;
  handoverNotes: string;
  followUp: boolean;
  templateId: number | null;
}

export const FRESH_WRAP: Wrap = { outcome: null, notes: '', date: '', time: '', handover: false, handoverNotes: '', followUp: false, templateId: null };

/** What Save outcome sends, or null while something is missing (an outcome, a callback's time, the template). */
export function outcomeInputOf(w: Wrap, now: Date): OutcomeInput | null {
  if (!w.outcome) return null;
  const at = w.outcome === 'callback' ? callbackStamp(w.date, w.time, now).at : null;
  if (!outcomeReady(w.outcome, at)) return null;
  if (w.followUp && w.templateId === null) return null;
  return {
    outcome: w.outcome,
    notes: w.notes.trim(),
    callback_at: at,
    handover: w.handover,
    handover_notes: w.handover ? w.handoverNotes.trim() || null : null,
    follow_up_template_id: w.followUp ? w.templateId : null,
  };
}

/** What saving did, in one toast: the suppression, the Task, the retry, the CRM lead. */
export function outcomeMessage(o: Outcome, r: OutcomeResult | null | undefined, now: Date, callbackAt?: string | null): string {
  const parts: string[] = [];
  if (o === 'do_not_call') parts.push('Do not call — the number is suppressed for the whole company.');
  else if (o === 'callback') parts.push(callbackAt ? `Callback booked as a Task for ${due(callbackAt, now)}.` : 'Callback booked as a Task.');
  else if ((o === 'no_answer' || o === 'busy') && r?.next_attempt_at) parts.push(`${outcomeLabel(o)}. The queue tries again ${due(r.next_attempt_at, now)}.`);
  else parts.push(`Saved: ${outcomeLabel(o).toLowerCase()}.`);
  if (r?.lead) parts.push(r.lead.created ? `Handed to CRM as lead ${r.lead.number}.` : `Already lead ${r.lead.number} in CRM; the call was added to it.`);
  return parts.join(' ');
}

/** Callbacks due by the end of today (overdue ones too), soonest first. */
export function dueToday(rows: readonly Callback[], now: Date): Callback[] {
  const today = isoDay(now);
  const at = (c: Callback) => parseStamp(c.due_at)?.getTime() ?? Number.POSITIVE_INFINITY;
  const day = (c: Callback) => {
    const d = parseStamp(c.due_at);
    return d ? isoDay(d) : '9999-12-31';
  };
  return rows.filter((c) => day(c) <= today).sort((a, b) => at(a) - at(b));
}

/** The time where the contact is ("14:05"), when their time zone is known. */
export function timeIn(zone: string | null | undefined, now: Date): string | null {
  if (!zone) return null;
  try {
    return now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: zone });
  } catch {
    return null;
  }
}

/** Another agent took it first, or it is locked: the claim was refused, not failed. */
const refusedClaim = (e: unknown) => e instanceof ApiError && (e.status === 409 || e.status === 423);

/** The desktop looks again now (callback reminders, tray counts); in a browser, or on failure, nothing changes here. */
function refreshDesktop(): void {
  void (async () => {
    await call('marketing:refresh');
  })().catch(() => undefined);
}

const clearClaim = (q: MyQueue | undefined) => (q ? { ...q, claim: null } : q);

/**
 * The claim this agent is working on, kept apart from the queue's answer: when the server gives an idle claim back
 * (MKT-CAL-03), the queue says nobody is claimed, but the call and its wrap-up may still be on this screen.
 */
const HELD = (org: string) => ['marketing', 'held-claim', org] as const;

/* ------------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------------ */

function NoPermission() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader crumb="Marketing / Calls" title="My call queue" />
      <PageBody>
        <Empty
          icon="lock"
          title="You can’t work a call queue yet"
          hint={
            <>
              You don’t hold <Mono>marketing.call.make</Mono>, so you can’t claim contacts. Ask an administrator to grant it to the call-agent role.
            </>
          }
        />
      </PageBody>
    </div>
  );
}

function Workspace() {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const { query, go } = useTab();
  const queue = useQueue();
  const held = useQuery({ queryKey: HELD(org), queryFn: () => null as Claim | null, enabled: false, staleTime: Infinity, gcTime: Infinity }).data ?? null;
  const now = useNow(30_000);
  const [pick, setPick] = useState('all');
  const [busy, run] = useAction();
  const data = queue.data;
  const chosen = pick === 'all' ? null : (data?.campaigns.find((x) => String(x.id) === pick) ?? null);
  const scope = chosen?.id ?? null;

  /** The atomic claim (CAS): one contact for this agent, nobody when the queue is empty, or refused when taken. */
  const claim = (campaignId: number | null, queueItemId: number | null = null) =>
    run('next', async () => {
      try {
        const got = await claimNext(org, campaignId, queueItemId);
        qc.setQueryData<MyQueue>(MK.queue(org), (q) => (q ? { ...q, claim: got ?? null } : q));
        qc.setQueryData(HELD(org), got ?? null);
        if (!got) toast('info', 'Nobody is waiting in this queue right now.');
      } catch (e) {
        if (!refusedClaim(e)) throw e;
        qc.setQueryData<MyQueue>(MK.queue(org), clearClaim);
        toast('info', 'Another agent claimed that contact first. Press Next contact again for the next one.');
      } finally {
        void qc.invalidateQueries({ queryKey: MK.queue(org) });
      }
    });

  // `?next=1`: claim once when the queue is known (unless a claim is already held), then drop the parameter. The
  // guard resets when the parameter goes, so the shortcut pressed again on this tab claims again.
  const wantNext = query.get('next') === '1';
  const settled = !queue.isPending;
  const asked = useRef(false);
  const arrive = useEffectEvent(() => {
    // A callback reminder's Call now names its queue item (`&item=`): that contact, not whoever is next.
    const item = Number(query.get('item'));
    if (queue.data && !queue.data.claim) void claim(scope, Number.isInteger(item) && item > 0 ? item : null);
    go('/marketing/queue');
  });
  useEffect(() => {
    if (!wantNext) {
      asked.current = false;
      return;
    }
    if (asked.current || !settled) return;
    asked.current = true;
    arrive();
  }, [wantNext, settled]);

  if (!data) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader crumb="Marketing / Calls" title="My call queue" />
        <PageBody>
          <Loaded q={queue} what="My call queue">
            {() => null}
          </Loaded>
        </PageBody>
      </div>
    );
  }
  const shown = data.claim ?? held;
  if (shown) {
    return (
      <ClaimView
        key={shown.id}
        claim={shown}
        released={!data.claim}
        queue={data}
        now={now}
        onNext={() => claim(scope)}
        onDone={() => qc.setQueryData(HELD(org), null)}
      />
    );
  }
  return <Waiting queue={data} now={now} pick={chosen ? pick : 'all'} onPick={setPick} chosen={chosen} busy={busy === 'next'} onNext={() => void claim(scope)} />;
}

/* ------------------------------------------------------------------------ *
 * Nothing claimed: who is waiting (D01), callbacks today
 * ------------------------------------------------------------------------ */

function Waiting({ queue, now, pick, onPick, chosen, busy, onNext }: { queue: MyQueue; now: Date; pick: string; onPick: (v: string) => void; chosen: (MyQueue['campaigns'][number]) | null; busy: boolean; onNext: () => void }) {
  const items = chosen ? queue.items.filter((i) => i.campaign.id === chosen.id) : queue.items;
  const waiting = chosen ? chosen.waiting : queue.waiting;
  const several = queue.campaigns.length > 1 && !chosen;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing / Calls"
        title="My call queue"
        sub={`${chosen?.name ?? 'All campaigns'} · ${count(waiting)} waiting for you · ${prettyAccelerator(NEXT_CONTACT_KEYS)} claims the next contact from anywhere`}
        actions={
          <>
            {queue.campaigns.length > 0 ? (
              <Select
                value={pick}
                onValueChange={onPick}
                aria-label="Campaign"
                className="w-[220px]"
                options={[{ value: 'all', label: 'All campaigns', hint: `${count(queue.waiting)} waiting` }, ...queue.campaigns.map((x) => ({ value: String(x.id), label: x.name, hint: `${count(x.waiting)} waiting` }))]}
              />
            ) : null}
            <Button variant="primary" icon="chevron-right" loading={busy} onClick={onNext}>
              Next contact
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-2">
            {items.length > 0 ? (
              <>
                <Table
                  label="Waiting for you"
                  head={
                    <tr>
                      <th className={TH}>Contact</th>
                      <th className={TH}>Organisation</th>
                      <th className={TH}>Attempt</th>
                      <th className={TH}>Reason</th>
                      <th className={TH}>Due</th>
                    </tr>
                  }
                >
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td className={TD}>
                        <span className="block font-semibold">{i.contact.name}</span>
                        {several ? <span className="block text-[11.5px] text-ink-3">{i.campaign.name}</span> : null}
                      </td>
                      <td className={TD}>{i.contact.organisation ?? '—'}</td>
                      <td className={TD}>
                        <Mono>{`${i.attempt} / ${i.max_attempts}`}</Mono>
                      </td>
                      <td className={TD}>{i.reason}</td>
                      <td className={TD}>
                        <Mono>{i.due_at ? due(i.due_at, now) : 'now'}</Mono>
                      </td>
                    </tr>
                  ))}
                </Table>
                {items.length < waiting ? (
                  <p className="text-[12px] text-ink-3">{`The first ${count(items.length)} of ${count(waiting)} waiting. Next contact takes whoever the queue holds next.`}</p>
                ) : null}
              </>
            ) : (
              <Panel>
                <Empty
                  icon="list-todo"
                  title="Nobody is waiting for you"
                  hint={
                    queue.campaigns.length > 0
                      ? 'Contacts appear here when they are due: new ones, retries after their delay, and callbacks at their time.'
                      : 'You aren’t an agent on a running call campaign yet. A supervisor assigns agents on the campaign.'
                  }
                />
              </Panel>
            )}
          </div>
          <Callbacks now={now} />
        </div>
      </PageBody>
    </div>
  );
}

function Callbacks({ now }: { now: Date }) {
  const org = useMarketingOrg();
  const q = useQuery({
    queryKey: MK.callbacks(org),
    queryFn: ({ signal }) => fetchCallbacks(org, signal),
    refetchInterval: (query) => (query.state.data?.offered === false ? false : 60_000),
  });
  return (
    <Panel title="Callbacks today" sub="Booked as Tasks; each comes back to this queue when it is due">
      <OptionalView
        q={q}
        what="Callbacks"
        notOffered={<p className="text-[12px] text-ink-3">This WorkSuite server can’t list your callbacks here yet. They are still Tasks, and come back to this queue when due.</p>}
      >
        {(rows) => {
          const today = dueToday(pageOf<Callback>(rows).rows, now);
          return today.length === 0 ? (
            <p className="text-[12px] text-ink-3">No callbacks due today.</p>
          ) : (
            <ul className="flex flex-col">
              {today.map((c) => (
                <li key={c.id} className="flex items-start gap-2.5 border-b border-line py-2 last:border-b-0">
                  <Mono className="w-[58px] shrink-0 text-[12px] font-semibold text-ink">{due(c.due_at, now)}</Mono>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold text-ink">{c.contact.name}</span>
                    <span className="block truncate text-[11.5px] text-ink-3">{[c.contact.organisation, c.note ? `“${c.note}”` : null, c.campaign.name].filter(Boolean).join(' · ')}</span>
                  </span>
                </li>
              ))}
            </ul>
          );
        }}
      </OptionalView>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ *
 * A claim: contact, script, outcome, wrap-up (DK11)
 * ------------------------------------------------------------------------ */

function ClaimView({ claim, released: givenBack, queue, now, onNext, onDone }: { claim: Claim; released: boolean; queue: MyQueue; now: Date; onNext: () => Promise<boolean>; onDone: () => void }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const me = useStore(app, (s) => s.bootstrap?.user?.name ?? null);
  const [w, setW] = useState<Wrap>(FRESH_WRAP);
  const [asking, setAsking] = useState(false);
  const [busy, run] = useAction();
  const titleId = useId();
  const set = (p: Partial<Wrap>) => setW((x) => ({ ...x, ...p }));
  const c = claim.contact;
  const left = minutesUntil(claim.release_at, now);
  // Released by the clock here, or already by the server (the queue no longer lists it as claimed).
  const gone = left === 0 || givenBack;

  // Held while it is live, so a release by the server leaves the call and its wrap-up on screen.
  useEffect(() => {
    if (!givenBack) qc.setQueryData(HELD(org), claim);
  }, [claim, givenBack, org, qc]);
  const input = outcomeInputOf(w, now);
  const info = outcomeInfo(w.outcome);

  // MKT-CAL-03, AC-09: the server gives an idle claim back; say so where it will be seen, and read the queue again.
  const released = useEffectEvent(() => {
    toast('info', `Your claim was released after ${IDLE_MINUTES} minutes idle: ${c.name} is back in the queue.`, undefined, undefined, { sticky: true });
    void qc.invalidateQueries({ queryKey: MK.queue(org) });
  });
  useEffect(() => {
    if (gone) released();
  }, [gone]);

  const pick = (o: Outcome) => setW((x) => ({ ...x, outcome: o, handover: o === 'interested', date: o === 'callback' && !x.date ? isoDay(new Date()) : x.date }));

  const drop = (kind: 'skip' | 'release') =>
    run(
      kind,
      async () => {
        if (kind === 'skip') await skipClaim(claim.id);
        else await releaseClaim(claim.id);
        qc.setQueryData<MyQueue>(MK.queue(org), clearClaim);
        onDone();
        void qc.invalidateQueries({ queryKey: MK.queue(org) });
      },
      kind === 'skip' ? `Skipped ${c.name}.` : `${c.name} is back in the queue for anyone to claim.`,
    );

  // The claim may already be gone (released while idle): going on to the next contact is still what was asked.
  const releaseAndNext = () =>
    run('next', async () => {
      try {
        await releaseClaim(claim.id);
      } catch (e) {
        if (!(e instanceof ApiError && [404, 409, 410, 423].includes(e.status))) throw e;
      }
      await onNext();
    });

  const save = (andNext: boolean) => {
    if (!input) return;
    const sent = input;
    return run(andNext ? 'save-next' : 'save', async () => {
      const r = await saveOutcome(claim.id, sent);
      toast('success', outcomeMessage(sent.outcome, r, new Date(), sent.callback_at));
      refreshDesktop();
      setAsking(false);
      if (andNext) await onNext();
      else {
        qc.setQueryData<MyQueue>(MK.queue(org), clearClaim);
        onDone();
      }
      // The contact, its campaign, suppression and the dashboard all move with an outcome.
      void qc.invalidateQueries({ queryKey: MK.all });
    });
  };

  const campaign = queue.campaigns.find((x) => x.id === claim.campaign.id);
  const claimed = ago(claim.claimed_at, now);
  const sub = [
    claim.campaign.name,
    `${count(campaign?.waiting ?? queue.waiting)} waiting for you`,
    claimed ? `claimed ${claimed}${left === null ? '' : gone ? ' (released)' : ` (auto-release in ${left} min)`}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const vars = { first_name: c.first_name?.trim() || firstName(c.name), organisation: c.organisation, agent_name: firstName(me) };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing / Calls"
        title="My call queue"
        sub={sub}
        actions={
          <>
            <Button loading={busy === 'skip'} disabled={busy !== null} onClick={() => void drop('skip')}>
              Skip
            </Button>
            <Button loading={busy === 'release'} disabled={busy !== null} onClick={() => void drop('release')}>
              Release
            </Button>
            <Button variant="primary" icon="chevron-right" disabled={busy !== null} onClick={() => setAsking(true)}>
              Next contact
            </Button>
          </>
        }
      />
      <PageBody>
        {gone ? (
          <Notice
            tone="warning"
            className="mb-4"
            action={
              <Button size="sm" disabled={busy !== null} onClick={onDone}>
                Discard
              </Button>
            }
          >
            {`Your claim was released after ${IDLE_MINUTES} minutes idle. ${c.name} is back in the queue, so an outcome saved now may be refused — your notes stay here until you save or discard them.`}
          </Notice>
        ) : null}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            <ContactCard claim={claim} now={now} />
            <ScriptPanel script={claim.script} vars={vars} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <Panel title="Outcome">
              <OutcomePicker value={w.outcome} onChange={pick} />
              <p className={cx('mt-2.5 text-[12px]', w.outcome === 'do_not_call' ? 'font-semibold text-danger' : 'text-ink-3')}>{info ? info.effect : 'Pick what happened on the call.'}</p>
            </Panel>
            <WrapUp
              w={w}
              set={set}
              now={now}
              canMail={mailable(c)}
              footer={
                <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                  <Button variant="primary" icon="check" disabled={!input || busy !== null} loading={busy === 'save'} onClick={() => void save(false)}>
                    Save outcome
                  </Button>
                  <Button disabled={!input || busy !== null} loading={busy === 'save-next'} onClick={() => void save(true)}>
                    Save and next
                  </Button>
                </div>
              }
            />
          </div>
        </div>
      </PageBody>
      {asking ? (
        <Modal
          title="Move on without an outcome?"
          labelledBy={titleId}
          width={460}
          onClose={() => setAsking(false)}
          footer={
            <>
              <Button onClick={() => setAsking(false)}>Cancel</Button>
              {input ? (
                <Button loading={busy === 'save-next'} disabled={busy !== null} onClick={() => void save(true)}>
                  Save outcome and next
                </Button>
              ) : null}
              <Button variant="primary" loading={busy === 'next'} disabled={busy !== null} onClick={() => void releaseAndNext()}>
                Release and next
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">
            {input
              ? `The outcome you picked isn’t saved yet. Release ${c.name} without it, or save it and go on.`
              : `Nothing is recorded for this call: ${c.name} goes back to the queue for anyone to claim, and you get the next contact.`}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

function ContactCard({ claim, now }: { claim: Claim; now: Date }) {
  const { openInNewTab } = useTab();
  const phoneApp = useCanOpen('phone');
  const c = claim.contact;
  const pc = phoneConsent(c.phone_consent);
  const ec = emailConsent(c.email_consent);
  const local = timeIn(c.time_zone, now);
  const line = [c.organisation, `attempt ${claim.attempt} of ${claim.max_attempts}`, claim.last_outcome ? `last: ${outcomeLabel(claim.last_outcome).toLowerCase()}` : null].filter(Boolean).join(' · ');
  return (
    <section aria-label={`Contact: ${c.name}`} className="rounded-[12px] border border-line bg-surface px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={c.name} size={40} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-bold text-ink">{c.name}</h2>
          <p className="truncate text-[12px] text-ink-3">{line}</p>
        </div>
        <div className="flex items-center gap-2">
          {c.phone ? <Mono className="text-[13px] text-ink-2">{c.phone}</Mono> : <span className="text-[12px] text-ink-3">No phone number</span>}
          <CallButton variant="button" number={c.phone} contactId={c.id} name={c.name} />
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Status tone={pc.tone}>{`Phone consent: ${pc.label.toLowerCase()}`}</Status>
        {c.do_not_call ? <Status tone="danger">Do not call</Status> : null}
        <Status tone={ec.tone}>{`Email: ${ec.label.toLowerCase()}`}</Status>
        {phoneApp ? <Status tone="indigo">Calling via WorkSuite Phone</Status> : null}
      </div>
      {!phoneApp && c.phone ? <p className="mt-2 text-[11.5px] text-ink-3">WorkSuite Phone isn’t available to you: dial the number on your own phone, then record the outcome here.</p> : null}
      {claim.callback_note ? <p className="mt-2.5 rounded-[8px] bg-subtle px-3 py-2 text-[12.5px] text-ink-2">{`Callback note: “${claim.callback_note}”`}</p> : null}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        {local ? <span className="text-ink-3">{`Their time ${local} · ${c.time_zone ?? ''}`}</span> : null}
        <button type="button" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline" onClick={() => openInNewTab(`/marketing/contacts/${c.id}`, c.name)}>
          <Icon name="external" size={13} />
          Open contact
        </button>
      </div>
    </section>
  );
}

function ScriptPanel({ script, vars }: { script: Script | null; vars: Readonly<Record<string, string | null | undefined>> }) {
  if (!script) {
    return (
      <Panel title="Script">
        <p className="text-[12.5px] text-ink-3">This campaign has no script. A supervisor can attach one on the campaign.</p>
      </Panel>
    );
  }
  return (
    <Panel title={`Script · ${script.name} (v${script.version})`}>
      <ol className="flex flex-col">
        {SECTIONS.map((s, i) => {
          const text = script.sections?.[s.id] ?? '';
          return (
            <li key={s.id} className="border-b border-line py-2.5 first:pt-0.5 last:border-b-0 last:pb-0">
              <div className="text-[11px] font-bold tracking-[.4px] text-primary uppercase">{`${i + 1}. ${s.label}`}</div>
              {text.trim() ? <Filled text={text} vars={vars} /> : <p className="text-[12.5px] text-ink-3">—</p>}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function Filled({ text, vars }: { text: string; vars: Readonly<Record<string, string | null | undefined>> }) {
  return (
    <p className="mt-0.5 text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
      {scriptParts(text, vars).map((p, i) =>
        'text' in p ? (
          <Fragment key={i}>{p.text}</Fragment>
        ) : p.value !== null ? (
          <Fragment key={i}>{p.value}</Fragment>
        ) : (
          <span key={i} title="No value for this contact" className="rounded-[4px] bg-warning-bg px-1 font-mono text-[12px] text-warning">
            {p.tag}
          </span>
        ),
      )}
    </p>
  );
}

/** Ten outcomes as one choice (radio group: arrows move and choose, Tab leaves). */
function OutcomePicker({ value, onChange }: { value: Outcome | null; onChange: (o: Outcome) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const at = OUTCOMES.findIndex((o) => o.id === value);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const j = (i + step + OUTCOMES.length) % OUTCOMES.length;
    const o = OUTCOMES[j];
    if (!o) return;
    onChange(o.id);
    refs.current[j]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Outcome" className="grid grid-cols-2 gap-2">
      {OUTCOMES.map((o, i) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (at < 0 && i === 0) ? 0 : -1}
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              'flex min-h-[36px] items-center rounded-[8px] border px-2.5 py-1.5 text-left text-[12.5px] leading-tight font-semibold transition-colors',
              on ? (o.tone === 'danger' ? 'border-danger bg-danger-bg text-danger' : 'border-primary bg-selection text-primary') : 'border-line bg-surface text-ink hover:bg-subtle',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function WrapUp({ w, set, now, canMail, footer }: { w: Wrap; set: (p: Partial<Wrap>) => void; now: Date; canMail: boolean; footer: ReactNode }) {
  const ids = useId();
  const cb = w.outcome === 'callback' ? callbackStamp(w.date, w.time, now) : null;
  return (
    <Panel title="Wrap-up" bodyClassName="flex flex-col gap-3">
      <Field label="Call notes">
        <TextArea value={w.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} placeholder="What was said, and what they need" />
      </Field>
      {cb ? (
        <fieldset className="flex min-w-0 flex-col gap-1">
          <legend className="mb-1 text-[12px] font-semibold text-ink-2">Call back on</legend>
          <div className="flex flex-wrap gap-2">
            <Input type="date" aria-label="Callback day" value={w.date} min={isoDay(now)} onChange={(e) => set({ date: e.target.value })} className="w-auto min-w-[150px] flex-1" />
            <Input type="time" aria-label="Callback time" value={w.time} onChange={(e) => set({ time: e.target.value })} className="w-[120px]" />
          </div>
          <span className={cx('text-[11.5px]', cb.problem && w.time ? 'text-danger' : 'text-ink-3')}>{cb.problem && w.time ? cb.problem : 'Your local time. It becomes a Task for you, and the contact comes back to your queue then.'}</span>
        </fieldset>
      ) : null}
      <div className="flex items-start justify-between gap-3 border-t border-line pt-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink">Hand over to CRM as lead</div>
          <div id={`${ids}-handover`} className="text-[11.5px] text-ink-3">
            Uses LeadWriter · channel “marketing”
          </div>
        </div>
        <Switch checked={w.handover} onChange={(v) => set({ handover: v })} label="Hand over to CRM as lead" describedBy={`${ids}-handover`} />
      </div>
      {w.handover ? (
        <Field label="Notes for sales (optional)">
          <TextArea value={w.handoverNotes} onChange={(e) => set({ handoverNotes: e.target.value })} rows={2} className="min-h-[56px]" />
        </Field>
      ) : null}
      <FollowUp w={w} set={set} canMail={canMail} />
      {footer}
    </Panel>
  );
}

function FollowUp({ w, set, canMail }: { w: Wrap; set: (p: Partial<Wrap>) => void; canMail: boolean }) {
  const ids = useId();
  const templates = useTemplates();
  const rows = templates.data ?? [];
  const chosen = rows.find((t) => t.id === w.templateId);
  const note = !canMail
    ? 'No email consent, so a follow-up can’t be sent.'
    : templates.error
      ? 'Templates can’t be read right now.'
      : chosen
        ? `Template: ${chosen.name}`
        : templates.isPending
          ? 'Reading templates…'
          : rows.length === 0
            ? 'No saved templates yet.'
            : 'Choose a template.';
  return (
    <>
      <div className="flex items-start justify-between gap-3 border-t border-line pt-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink">Send follow-up email</div>
          <div id={`${ids}-follow`} className="truncate text-[11.5px] text-ink-3">
            {note}
          </div>
        </div>
        <Switch checked={w.followUp} disabled={!w.followUp && (!canMail || rows.length === 0)} onChange={(v) => set({ followUp: v })} label="Send follow-up email" describedBy={`${ids}-follow`} />
      </div>
      {w.followUp ? (
        <Select<number>
          value={w.templateId}
          onValueChange={(v) => set({ templateId: v })}
          options={rows.map((t) => ({ value: t.id, label: t.name }))}
          aria-label="Follow-up template"
          placeholder="Choose a template…"
        />
      ) : null}
    </>
  );
}
