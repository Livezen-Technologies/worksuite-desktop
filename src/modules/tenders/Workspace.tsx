import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { dateLabel, relative, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Facts, Field, input, Panel, Seg, Sheet } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { addNote, fetchBlockers, fetchTender, K, money, moveStage, recordLoss, recordWin, refusalOf, rescore, setFollowing, type Band, type LoseDraft, type WinDraft, type Workspace as Data } from './api';
import { Left, openWeb, OutcomePill, PriorityPill, Score, StagePill, subline } from './parts';

/**
 * One tender: what it is and how long is left, where it can move next, and
 * the record of what happened to it. A move checks the server's blockers
 * first — unmet mandatory requirements, approvals not given — and moving
 * anyway is allowed but says so in the history. Winning and losing are
 * decisions, not moves: a win records the awarded value and makes the
 * client, deal and project; a loss records why. Either can be recorded out
 * of order when the news arrives before the paperwork, and the history keeps
 * that it was.
 *
 * The working tabs — checklist, documents, bonds, meetings, budget, costs and
 * approvals — open in the browser for now.
 */
type Tab = 'overview' | 'decision' | 'history' | 'activity';
const TABS: Tab[] = ['overview', 'decision', 'history', 'activity'];
const WEB_TABS = ['Checklist', 'Documents', 'Bonds', 'Meetings', 'Budget', 'Costs', 'Approvals'];

type Ask = { kind: 'move'; to: string; label: string; blockers: string[] } | { kind: 'cancel' } | { kind: 'win' } | { kind: 'lose' };

export default function Workspace({ id, bands, canManage, tab, onTab, onBack, onEdit }: { id: number; bands: Band[] | undefined; canManage: boolean; tab: string; onTab: (t: string) => void; onBack: () => void; onEdit: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.tender(id), queryFn: ({ signal }) => fetchTender(id, signal) });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const t: Tab = (TABS as string[]).includes(tab) ? (tab as Tab) : 'overview';
  const refresh = () => void qc.invalidateQueries({ queryKey: K.all });

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data)
    return (
      <div className="flex flex-col gap-3 px-6 py-5">
        <BackLink onBack={onBack} />
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  const d = q.data;
  const r = d.tender;
  const req = d.requirements.summary;
  const decided = r.outcome !== 'open';

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      toast('success', done);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const move = async (to: string, label: string) => {
    if (to === 'won') return setAsk({ kind: 'win' });
    if (to === 'lost') return setAsk({ kind: 'lose' });
    if (to === 'cancelled') return setAsk({ kind: 'cancel' });
    setBusy(`move:${to}`);
    try {
      const check = await fetchBlockers(id, to);
      if (!check.clear) return setAsk({ kind: 'move', to, label, blockers: check.blockers });
      const res = await moveStage(id, to);
      toast('success', `Moved to ${label}.${res?.tasks?.created ? ` ${res.tasks.created} preparation tasks were made.` : ''}`);
      refresh();
    } catch (e) {
      const { blockers } = refusalOf(e);
      if (blockers.length) setAsk({ kind: 'move', to, label, blockers });
      else toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <BackLink onBack={onBack} />
      <section className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface px-4 py-3.5" aria-label="Tender">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {decided && r.stage === r.outcome ? <OutcomePill o={r.outcome} /> : <StagePill label={r.stage_label} outcome={r.outcome} />}
              <Score score={r.score} bands={bands} />
              <PriorityPill p={r.priority} />
              {r.following ? <Pill tone="blue">Following</Pill> : null}
            </div>
            <h1 className="m-0 text-[20px] leading-snug font-bold text-ink">{r.title}</h1>
            <span className="text-[12.5px] text-ink-3">{[subline(r.reference, r.organization), r.client_name && r.client_name !== r.organization ? `client ${r.client_name}` : null].filter(Boolean).join(' · ') || 'No buyer recorded'}</span>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <button type="button" className={btn} disabled={busy === 'follow'} onClick={() => void act('follow', () => setFollowing(id, !r.following), r.following ? 'No longer following.' : 'Following.')}>
              <Icon name="eye" size={15} /> {r.following ? 'Stop following' : 'Follow'}
            </button>
            {canManage ? (
              <button type="button" className={btn} onClick={onEdit}>
                <Icon name="compose" size={15} /> Edit
              </button>
            ) : null}
            <button type="button" className={btn} title="Opens in your browser" onClick={() => openWeb(`/tenders?open=${id}`)}>
              <Icon name="external" size={15} /> In the browser
            </button>
          </div>
        </div>
        <div className="grid grid-cols-5 gap-3 border-t border-line/70 pt-3 text-[12.5px]">
          <Fact label="Closing">
            {r.closing_at ? (
              <>
                <b className="text-ink">
                  {dateLabel(r.closing_at)}, {timeLabel(r.closing_at)}
                </b>
                {decided ? null : <Left r={r.remaining} className="text-[12px]" />}
              </>
            ) : (
              <span className="text-ink-3">No closing date</span>
            )}
          </Fact>
          <Fact label="Published ceiling">
            <b className="text-ink tabular-nums">{money(r.budget_max, r.currency)}</b>
          </Fact>
          <Fact label="Our bid">
            <b className="text-ink tabular-nums">{money(r.bid_value, r.currency)}</b>
          </Fact>
          {r.outcome === 'won' ? (
            <Fact label="Awarded">
              <b className="text-[#145C39] tabular-nums dark:text-success">{money(r.award_value, r.currency)}</b>
            </Fact>
          ) : r.outcome === 'lost' ? (
            <Fact label="Winning price">
              <b className="text-ink tabular-nums">{money(r.winning_price, r.currency)}</b>
            </Fact>
          ) : (
            <Fact label="Industry">
              <b className="truncate text-ink">{r.industry ?? '—'}</b>
            </Fact>
          )}
          <Fact label="Owner">
            <b className="truncate text-ink">{r.owner_name ?? <span className="font-medium text-ink-3">Nobody yet</span>}</b>
          </Fact>
        </div>
        {canManage && d.next.length ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line/70 pt-3" aria-label="Move to">
            <span className="text-[12px] font-semibold text-ink-3">Move to</span>
            {d.next.map((s) => (
              <button
                key={s.key}
                type="button"
                disabled={busy !== null}
                onClick={() => void move(s.key, s.label)}
                className={cx(btnSmall, s.key === 'won' && '!border-[#9BD3B3] !text-[#145C39] dark:!text-success', (s.key === 'lost' || s.key === 'cancelled') && '!text-ink-2')}
              >
                {busy === `move:${s.key}` ? 'Checking…' : s.key === 'won' ? 'Won…' : s.key === 'lost' ? 'Lost…' : s.key === 'cancelled' ? 'Cancelled…' : s.label}
              </button>
            ))}
          </div>
        ) : null}
        {req.mandatory > 0 && !decided ? (
          <div
            className={cx('flex items-start gap-2 rounded-[9px] px-3 py-2 text-[12.5px]', req.missing === 0 ? 'bg-[#E4F4EA] text-[#145C39] dark:bg-success-bg dark:text-success' : 'bg-[#FFF4E0] text-[#7A3B05] dark:bg-warning-bg dark:text-warning')}
          >
            <Icon name={req.missing === 0 ? 'check-circle' : 'warning'} size={15} className="mt-px shrink-0" />
            {req.missing === 0 ? 'Every mandatory requirement is satisfied.' : `Outstanding: ${req.missing} of ${req.mandatory} mandatory ${req.mandatory === 1 ? 'requirement' : 'requirements'}.`}
          </div>
        ) : d.requirements.note && !decided ? (
          <p className="m-0 text-[12px] text-ink-3">{d.requirements.note}</p>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Seg
          label="Tender"
          value={t}
          onChange={(v) => onTab(v)}
          options={[
            { id: 'overview', label: 'Overview' },
            { id: 'decision', label: 'Submission & result' },
            { id: 'history', label: `History · ${d.history.length}` },
            { id: 'activity', label: 'Notes & activity' },
          ]}
        />
        <span className="min-w-0 flex-1" />
        <button type="button" title={`${WEB_TABS.join(', ')} — open in your browser`} onClick={() => openWeb(`/tenders?open=${id}`)} className="inline-flex min-w-0 items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline">
          <span className="truncate">Checklist, documents and the other working tabs</span>
          <Icon name="external" size={12} className="shrink-0" />
        </button>
      </div>

      {t === 'overview' ? <Overview d={d} canManage={canManage} busy={busy === 'score'} onRescore={() => void act('score', () => rescore(id), 'Scored again.')} /> : null}
      {t === 'decision' ? <Decision d={d} /> : null}
      {t === 'history' ? <History d={d} /> : null}
      {t === 'activity' ? <Activity d={d} id={id} onAdded={refresh} /> : null}

      {ask?.kind === 'move' ? <MoveSheet id={id} to={ask.to} label={ask.label} blockers={ask.blockers} onClose={() => setAsk(null)} onDone={refresh} /> : null}
      {ask?.kind === 'cancel' ? <MoveSheet id={id} to="cancelled" label="Cancelled" blockers={[]} onClose={() => setAsk(null)} onDone={refresh} /> : null}
      {ask?.kind === 'win' ? <WinSheet id={id} currency={r.currency} onClose={() => setAsk(null)} onDone={refresh} /> : null}
      {ask?.kind === 'lose' ? <LoseSheet id={id} currency={r.currency} onClose={() => setAsk(null)} onDone={refresh} /> : null}
    </div>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="inline-flex items-center gap-1 self-start text-[12.5px] font-semibold text-primary hover:underline">
      <Icon name="chevron-left" size={14} /> Back
    </button>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11.5px] text-ink-3">{label}</span>
      {children}
    </div>
  );
}

function Overview({ d, canManage, busy, onRescore }: { d: Data; canManage: boolean; busy: boolean; onRescore: () => void }) {
  const r = d.tender;
  const applied = d.score?.reasons.filter((x) => x.applied) ?? [];
  const unjudged = d.score?.reasons.filter((x) => !x.applied) ?? [];
  return (
    <div className="grid grid-cols-[3fr_2fr] gap-3.5">
      <div className="flex min-w-0 flex-col gap-3.5">
        <Panel title="The tender" bodyClassName="px-3.5 py-2.5 text-[12.5px]">
          <Facts
            rows={[
              ['Buyer', r.organization],
              ['Tender number', r.reference],
              ['Category', r.category],
              ['Industry', r.industry],
              ['Sector', r.sector ? r.sector[0]!.toUpperCase() + r.sector.slice(1) : null],
              ['Country', r.country],
              ['Budget', r.budget_min && r.budget_max ? `${money(r.budget_min, r.currency)} to ${money(r.budget_max, r.currency)}` : money(r.budget_max ?? r.budget_min, r.currency)],
              ['Currency', r.currency],
              ['Owner', r.owner_name],
              [
                'Notice',
                r.external_url && /^https?:\/\//i.test(r.external_url) ? (
                  <button type="button" className="text-primary hover:underline" title={r.external_url} onClick={() => void call('app:openExternal', { url: r.external_url! })}>
                    Open the buyer's page
                  </button>
                ) : (
                  r.external_url
                ),
              ],
            ]}
          />
        </Panel>
        <Panel title="Description" bodyClassName="px-3.5 py-3">
          {r.description ? <p className="m-0 text-[13px] leading-relaxed whitespace-pre-wrap text-ink">{r.description}</p> : <p className="m-0 text-[12.5px] text-ink-3">Nothing written yet.</p>}
        </Panel>
      </div>
      <div className="flex min-w-0 flex-col gap-3.5">
        <Panel
          title={d.score?.score !== null && d.score?.score !== undefined ? `Scored ${d.score.score}` : 'Not scored'}
          sub={d.score?.band ?? 'Arithmetic over a few fields — it has not read the tender document'}
          action={
            canManage ? (
              <button type="button" className={btnSmall} disabled={busy} onClick={onRescore}>
                {busy ? 'Scoring…' : 'Score again'}
              </button>
            ) : undefined
          }
          bodyClassName="flex flex-col"
        >
          {applied.length || unjudged.length ? (
            <>
              {applied.map((x, i) => (
                <div key={`a${i}`} className="flex items-start gap-2 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
                  <b className={cx('w-9 shrink-0 text-right tabular-nums', x.points > 0 ? 'text-[#145C39] dark:text-success' : x.points < 0 ? 'text-danger' : 'text-ink-3')}>{x.points > 0 ? `+${x.points}` : x.points}</b>
                  <span className="flex min-w-0 flex-col">
                    <b className="text-ink">{x.rule}</b>
                    <span className="text-[11.5px] text-ink-3">{x.reason}</span>
                  </span>
                </div>
              ))}
              {unjudged.length ? (
                <details className="px-3.5 py-2 text-[12px] text-ink-3">
                  <summary className="cursor-pointer font-semibold">{unjudged.length} rules could not be judged</summary>
                  <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
                    {unjudged.map((x, i) => (
                      <li key={`u${i}`}>
                        <b className="text-ink-2">{x.rule}</b> — {x.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : (
            <Empty text="No scoring rules apply yet." />
          )}
        </Panel>
        {d.approvals.length ? (
          <Panel title="Approvals" sub="Given or refused in the browser for now" bodyClassName="flex flex-col">
            {d.approvals.map((a) => (
              <div key={a.id} className="flex items-center gap-2 border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
                <span className="w-5 shrink-0 text-ink-3 tabular-nums">{a.step}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-ink">{a.role_label ?? 'Approver'}</b>
                  {a.comment ? <span className="truncate text-[11.5px] text-ink-3">{a.comment}</span> : null}
                </span>
                <Pill tone={a.status === 'approved' ? 'green' : a.status === 'rejected' ? 'red' : a.status === 'pending' ? 'amber' : 'grey'}>{a.status[0]!.toUpperCase() + a.status.slice(1)}</Pill>
              </div>
            ))}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

function Decision({ d }: { d: Data }) {
  const r = d.tender;
  return (
    <div className="grid grid-cols-2 gap-3.5">
      {r.outcome === 'lost' ? (
        <Panel title="Why it was lost" bodyClassName="px-3.5 py-2.5 text-[12.5px]">
          <Facts
            rows={[
              ['Reason', r.lost_reason],
              ['Won by', r.competitor],
              ['Their price', r.winning_price ? money(r.winning_price, r.currency) : null],
              ['What we learned', r.lessons],
            ]}
          />
        </Panel>
      ) : null}
      {r.outcome === 'won' ? (
        <Panel title="Won" bodyClassName="px-3.5 py-2.5 text-[12.5px]">
          <Facts
            rows={[
              ['Awarded', r.award_value ? money(r.award_value, r.currency) : 'Not recorded yet'],
              ['Decided', r.decided_at ? dateLabel(r.decided_at) : null],
              ['Client', r.client_name],
            ]}
          />
        </Panel>
      ) : null}
      <Panel title="Submissions" sub="Recorded in the browser for now" bodyClassName="flex flex-col">
        {d.submissions.length ? (
          d.submissions.map((s) => (
            <div key={s.id} className="flex flex-col border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
              <b className="text-ink">
                {s.submitted_at ? `${dateLabel(s.submitted_at)}, ${timeLabel(s.submitted_at)}` : 'Not dated'}
                {s.method ? <span className="font-medium text-ink-3"> · {s.method}</span> : null}
              </b>
              <span className="text-[11.5px] text-ink-3">
                {[s.bid_value ? money(s.bid_value, r.currency) : null, s.receipt_no ? `receipt ${s.receipt_no}` : null, s.acknowledged_at ? `acknowledged ${dateLabel(s.acknowledged_at)}` : 'not acknowledged yet'].filter(Boolean).join(' · ')}
              </span>
              {s.note ? <span className="text-[12px] text-ink-2">{s.note}</span> : null}
            </div>
          ))
        ) : (
          <Empty text="Nothing has been submitted." />
        )}
      </Panel>
      <Panel title="Evaluation" sub="What the buyer said, and when" bodyClassName="flex flex-col">
        {d.evaluations.length ? (
          d.evaluations.map((e) => (
            <div key={e.id} className="flex flex-col border-b border-line/60 px-3.5 py-2 text-[12.5px] last:border-b-0">
              <span className="flex items-center gap-1.5">
                <b className="min-w-0 flex-1 truncate text-ink">{e.title ?? e.kind[0]!.toUpperCase() + e.kind.slice(1)}</b>
                {e.score !== null ? (
                  <b className="shrink-0 text-ink tabular-nums">
                    {Number(e.score)}
                    {e.max_score !== null ? ` / ${Number(e.max_score)}` : ''}
                  </b>
                ) : null}
              </span>
              <span className="text-[11.5px] text-ink-3">{[e.kind, e.happened_at ? dateLabel(e.happened_at) : null].filter(Boolean).join(' · ')}</span>
              {e.body ? <span className="text-[12px] whitespace-pre-wrap text-ink-2">{e.body}</span> : null}
            </div>
          ))
        ) : (
          <Empty text="Nothing from the buyer yet." />
        )}
      </Panel>
    </div>
  );
}

function History({ d }: { d: Data }) {
  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface" aria-label="Stage history">
      {d.history.length ? (
        d.history.map((h) => (
          <div key={h.id} className="flex items-start gap-3 border-b border-line/60 px-3.5 py-2.5 text-[12.5px] last:border-b-0">
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="text-ink">{h.from ? `${h.from} → ${h.to}` : h.to}</b>
              {h.note ? <span className="text-[12px] text-ink-2">{h.note}</span> : null}
            </span>
            <span className="flex shrink-0 flex-col items-end text-[11.5px] text-ink-3">
              <span>{h.actor}</span>
              <span title={`${dateLabel(h.at)}, ${timeLabel(h.at)}`}>{relative(h.at)}</span>
            </span>
          </div>
        ))
      ) : (
        <Empty text="No moves yet." />
      )}
    </div>
  );
}

function Activity({ d, id, onAdded }: { d: Data; id: number; onAdded: () => void }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await addNote(id, body.trim());
      setBody('');
      toast('success', 'Note added.');
      onAdded();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3">
        <textarea
          aria-label="Note"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save();
          }}
          rows={3}
          maxLength={5000}
          placeholder="A call with the buyer, a clarification, something the next person should know…"
          className="w-full resize-y rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-primary"
        />
        <div className="flex justify-end">
          <button type="button" className={btnPrimary} disabled={busy || !body.trim()} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Add note'}
          </button>
        </div>
      </div>
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface" aria-label="Activity">
        {d.activity.length ? (
          d.activity.map((a) => (
            <div key={a.id} className="flex items-start gap-3 border-b border-line/60 px-3.5 py-2.5 text-[12.5px] last:border-b-0">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[11.5px] font-semibold text-ink-3">{a.kind === 'note' ? 'Note' : a.kind.replace(/[._]/g, ' ')}</span>
                <span className="whitespace-pre-wrap text-ink">{a.body}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end text-[11.5px] text-ink-3">
                <span>{a.actor_name ?? 'the system'}</span>
                <span title={`${dateLabel(a.created_at)}, ${timeLabel(a.created_at)}`}>{relative(a.created_at)}</span>
              </span>
            </div>
          ))
        ) : (
          <Empty text="Nothing yet." />
        )}
      </div>
    </div>
  );
}

/** A move with things outstanding, or a cancellation: said out loud, with a note for the history. */
function MoveSheet({ id, to, label, blockers, onClose, onDone }: { id: number; to: string; label: string; blockers: string[]; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const cancel = to === 'cancelled';
  const go = async () => {
    setBusy(true);
    try {
      await moveStage(id, to, blockers.length > 0, note.trim() || undefined);
      toast('success', cancel ? 'Recorded as cancelled.' : `Moved to ${label}.`);
      onDone();
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={cancel ? 'Cancel this tender?' : `Move to ${label} anyway?`}
      width={480}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Back
          </button>
          <button type="button" className={btnPrimary + ' !bg-danger hover:!opacity-90'} disabled={busy} onClick={() => void go()}>
            {busy ? 'Working…' : cancel ? 'Record as cancelled' : 'Move anyway'}
          </button>
        </>
      }
    >
      {cancel ? (
        <p className="m-0 text-[13px] text-ink-2">For a tender the buyer withdrew, or one we will not bid for after all. It leaves the open lists, and it cannot be reopened.</p>
      ) : (
        <>
          <p className="m-0 text-[13px] text-ink-2">
            {blockers.length} {blockers.length === 1 ? 'thing is' : 'things are'} outstanding. Moving anyway is allowed, and the history will say what was missing.
          </p>
          <ul className="m-0 flex max-h-[220px] flex-col gap-1 overflow-y-auto rounded-[9px] bg-[#FFF4E0] px-3 py-2 text-[12.5px] text-[#7A3B05] dark:bg-warning-bg dark:text-warning" aria-label="Outstanding">
            {blockers.map((b, i) => (
              <li key={i} className="ml-3 list-disc">
                {b}
              </li>
            ))}
          </ul>
        </>
      )}
      <Field label={cancel ? 'Why?' : 'Why move it now?'}>
        <input
          aria-label={cancel ? 'Why?' : 'Why move it now?'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
          placeholder={cancel ? 'The buyer withdrew the tender' : 'The certificate is on its way; the closing time will not wait'}
          className={input}
        />
      </Field>
    </Sheet>
  );
}

/** A decision that can come before the paperwork: refused out of order at first, then recordable with that said. */
function useDecision<T>(send: (d: T, override: boolean) => Promise<unknown>, done: string, onDone: () => void, onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<{ message: string; override: boolean } | null>(null);
  const run = async (d: T) => {
    setBusy(true);
    try {
      await send(d, !!refused?.override);
      toast('success', done);
      onDone();
      onClose();
    } catch (e) {
      const { mayOverride } = refusalOf(e);
      setRefused({ message: errorMessage(e), override: mayOverride });
    } finally {
      setBusy(false);
    }
  };
  return { busy, refused, run };
}

function Refusal({ refused }: { refused: { message: string; override: boolean } | null }) {
  if (!refused) return null;
  return (
    <p className="m-0 rounded-[9px] bg-[#FCE9E4] px-3 py-2 text-[12.5px] text-[#8C2A14] dark:bg-danger-bg dark:text-danger">
      {refused.message}
      {refused.override ? ' If the news came before the paperwork, record it anyway — the history will say it was out of order.' : ''}
    </p>
  );
}

function WinSheet({ id, currency, onClose, onDone }: { id: number; currency: string; onClose: () => void; onDone: () => void }) {
  const [d, setD] = useState<WinDraft>({ award: '', note: '' });
  const { busy, refused, run } = useDecision<WinDraft>((x, o) => recordWin(id, x, o), 'Recorded as won. The client, deal and project follow from it.', onDone, onClose);
  return (
    <Sheet
      title="Record this as won"
      width={480}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void run(d)}>
            {busy ? 'Recording…' : refused?.override ? 'Record it anyway' : 'Record as won'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">Winning makes the client, a CRM deal and a project. Leave the value blank if the award letter has not arrived — the project is made without a budget rather than with the bid standing in for it.</p>
      <Field label={`Awarded value (${currency})`}>
        <input aria-label="Awarded value" inputMode="decimal" value={d.award} onChange={(e) => setD({ ...d, award: e.target.value })} placeholder="e.g. 4500000" className={input} />
      </Field>
      <Field label="Note for the history">
        <input aria-label="Note for the history" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} maxLength={300} placeholder="Award letter received 27 September" className={input} />
      </Field>
      <Refusal refused={refused} />
    </Sheet>
  );
}

function LoseSheet({ id, currency, onClose, onDone }: { id: number; currency: string; onClose: () => void; onDone: () => void }) {
  const [d, setD] = useState<LoseDraft>({ reason: '', competitor: '', price: '', lessons: '' });
  const { busy, refused, run } = useDecision<LoseDraft>((x, o) => recordLoss(id, x, o), 'Recorded as lost, with the reason.', onDone, onClose);
  return (
    <Sheet
      title="Record this as lost"
      width={500}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !d.reason.trim()} onClick={() => void run(d)}>
            {busy ? 'Recording…' : refused?.override ? 'Record it anyway' : 'Record as lost'}
          </button>
        </>
      }
    >
      <Field label="Why was it lost?" hint="The one thing that makes the next bid better, and nobody will remember it in six months.">
        <input aria-label="Why was it lost?" value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} maxLength={300} placeholder="Price, a missing document, the competitor's relationship…" className={input} />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Won by">
          <input aria-label="Won by" value={d.competitor} onChange={(e) => setD({ ...d, competitor: e.target.value })} maxLength={200} className={input} />
        </Field>
        <Field label={`Their price (${currency})`}>
          <input aria-label="Their price" inputMode="decimal" value={d.price} onChange={(e) => setD({ ...d, price: e.target.value })} className={input} />
        </Field>
      </div>
      <Field label="What we would do differently">
        <textarea
          aria-label="What we would do differently"
          value={d.lessons}
          onChange={(e) => setD({ ...d, lessons: e.target.value })}
          rows={3}
          className="w-full resize-y rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-primary"
        />
      </Field>
      <Refusal refused={refused} />
    </Sheet>
  );
}
