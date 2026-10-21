import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Modal, Spinner } from '../../components/ui';
import { bodiesOf, bodyKeyOf, brief, dayKey, flagOf, fmtDate, titleCase, type Dashboard } from './api';
import { BodyTabs, FlagChip, MonthCal, Panel } from './parts';
import type { BoardView } from './Rail';

/** D-01 Home (director): body tabs, the meeting strip, the month, pending decisions and my actions, what's new (FR-DX-01..06). */
export default function Home({ data, onMeeting, onGo }: { data: Dashboard; onMeeting: (id: number) => void; onGo: (v: BoardView) => void }) {
  const [body, setBody] = useState<string | null>(null);
  const [panel, setPanel] = useState<'decisions' | 'actions'>('decisions');
  const [briefOpen, setBriefOpen] = useState(false);
  const [opened] = useState(() => Date.now());
  const bodies = bodiesOf(data);
  const meetings = useMemo(() => [...(data.upcoming ?? [])].filter((m) => !body || bodyKeyOf(m) === body).sort((a, b) => a.starts_at.localeCompare(b.starts_at)), [data.upcoming, body]);
  const next = meetings.find((m) => Date.parse(m.starts_at) >= opened - 4 * 3_600_000) ?? null;
  const now = new Date();
  const marked = new Set([...meetings.map((m) => dayKey(m.starts_at)), ...(data.calendar ?? []).map((c) => dayKey(c.date))]);
  const hour = now.getHours();
  const c = data.whats_new ?? {};
  const brf = useMutation({ mutationFn: () => brief(next!.id), onError: (e) => toast('error', errorMessage(e)) });

  const counter = (n: number | undefined, label: string, go: BoardView) => (
    <button type="button" onClick={() => onGo(go)} className="flex w-full items-center gap-2.5 rounded-[8px] px-2 py-2 text-left text-[13px] hover:bg-subtle">
      <span className="flex h-[24px] min-w-[24px] items-center justify-center rounded-full bg-[#EEF1FD] px-1.5 text-[12px] font-bold text-primary dark:bg-selection">{n ?? 0}</span>
      <span className="flex-1">{label}</span>
      <Icon name="chevron-right" size={14} className="text-ink-3" />
    </button>
  );

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-5 scroll-thin">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-bold text-ink">Good {hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}</h1>
          <p className="text-[12px] text-ink-3">{bodies.length} boards and committees</p>
        </div>
        <div className="flex gap-2">
          <Button disabled={!next} onClick={() => { setBriefOpen(true); brf.mutate(); }}>Director brief</Button>
          <Button variant="primary" disabled={!next} onClick={() => next && onMeeting(next.id)}>Open next pack</Button>
        </div>
      </div>
      <BodyTabs bodies={bodies} value={body} onChange={setBody} />
      <ul aria-label="Meetings" className="flex gap-3 overflow-x-auto pb-1 scroll-thin">
        {meetings.length === 0 ? <li className="text-[13px] text-ink-3">No meetings.</li> : null}
        {meetings.map((m) => (
          <li key={m.id} className="w-[260px] shrink-0">
            <button type="button" onClick={() => onMeeting(m.id)} aria-label={m.title} className="flex h-full w-full flex-col rounded-[10px] border border-line bg-surface p-3 text-left hover:border-primary">
              <div className="flex items-center justify-between text-[10.5px] font-bold tracking-[.5px] text-ink-3 uppercase">
                <span>Meeting · {m.body ?? ''}</span>
                <FlagChip flag={flagOf(m.flags)} />
              </div>
              <div className="mt-1 text-[14px] font-bold text-ink">{m.title}</div>
              <div className="text-[12px] text-ink-3">{m.location ?? ''}</div>
              <div className="mt-auto flex justify-between border-t border-line pt-2 text-[12px]">
                <span className="text-ink-2">{m === next ? 'Next' : titleCase(m.gov_status)}</span>
                <span className="font-bold">{fmtDate(m.starts_at)}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
      <div className="grid min-h-[300px] flex-1 grid-cols-3 gap-3">
        <Panel title={now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}>
          <MonthCal year={now.getFullYear()} month={now.getMonth()} marked={marked} today={dayKey(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString())} />
        </Panel>
        <Panel
          title={panel === 'decisions' ? 'Pending decisions' : 'My actions'}
          action={<button type="button" className="text-[12px] text-primary underline" onClick={() => setPanel(panel === 'decisions' ? 'actions' : 'decisions')}>{panel === 'decisions' ? 'Actions' : 'Decisions'}</button>}
        >
          {panel === 'decisions' ? (
            <ul className="space-y-2">
              {(data.pending_decisions ?? []).map((d) => (
                <li key={`${d.kind}-${d.id}`} className="text-[12.5px]">
                  <div className="text-ink">{[d.number, d.title].filter(Boolean).join(' ')}</div>
                  <div className="text-[11.5px] text-ink-3">{[d.kind === 'circular' ? 'Circular' : 'Resolution', d.label ?? titleCase(d.state)].filter(Boolean).join(' · ')}</div>
                </li>
              ))}
              {!data.pending_decisions?.length ? <li className="text-[12.5px] text-ink-3">Nothing pending.</li> : null}
            </ul>
          ) : (
            <ul className="space-y-2">
              {(data.actions ?? []).map((a) => <li key={a.id} className="text-[12.5px]"><div className="font-semibold">{a.title}</div><div className="text-ink-3">{[a.meeting_number, a.due_on ? fmtDate(a.due_on) : null, titleCase(a.status)].filter(Boolean).join(' · ')}</div></li>)}
              {!data.actions?.length ? <li className="text-[12.5px] text-ink-3">No open actions.</li> : null}
            </ul>
          )}
        </Panel>
        <Panel title="What's new for you">
          {counter((c.new_meetings ?? 0) + (c.new_circulars ?? 0), 'New meetings & circulars', 'calendar')}
          {counter(c.new_items_and_papers, 'New agenda items & papers', 'packs')}
          {counter(c.amended, 'Amended since you last read', 'packs')}
          {counter((c.pending_approvals ?? 0) + (c.pending_signatures ?? 0), 'Approvals & signatures', 'approvals')}
        </Panel>
      </div>
      {briefOpen && next ? (
        <Modal title={`Director brief · ${next.title}`} onClose={() => setBriefOpen(false)} width={620}>
          {brf.isPending ? <Spinner label="Preparing your brief…" /> : brf.data ? (
            <div className="space-y-3 text-[13px]">
              {([['Decisions to take', brf.data.decision_items], ['High-risk items', brf.data.high_risk_items], ['Pending actions', brf.data.pending_actions], ['Questions to ask', brf.data.suggested_questions]] as const).map(([t, list]) => list.length ? (
                <section key={t}>
                  <h3 className="font-bold">{t}</h3>
                  <ul className="list-disc pl-5">{list.map((i, k) => <li key={k}>{i}</li>)}</ul>
                </section>
              ) : null)}
              <p className="text-[11.5px] text-ink-3">{brf.data.label ?? 'From the papers you can open. Check the paper before relying on it.'}</p>
            </div>
          ) : <p className="text-[13px] text-ink-3">No brief.</p>}
        </Modal>
      ) : null}
    </div>
  );
}
