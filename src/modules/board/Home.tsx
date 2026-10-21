import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Modal, Spinner } from '../../components/ui';
import { brief, dayKey, fmtDate, type Dashboard } from './api';
import { BodyTabs, FlagChip, MonthCal, Panel } from './parts';
import type { BoardView } from './Rail';

/** D-01 Home (director): body tabs, the meeting strip, the month, shared documents and notices, what's new (FR-DX-01..06). */
export default function Home({ data, onMeeting, onGo }: { data: Dashboard; onMeeting: (id: number) => void; onGo: (v: BoardView) => void }) {
  const [body, setBody] = useState<number | null>(null);
  const [panel, setPanel] = useState<'docs' | 'notices'>('docs');
  const [briefOpen, setBriefOpen] = useState(false);
  const [opened] = useState(() => Date.now());
  const meetings = useMemo(() => [...data.meetings].filter((m) => !body || m.body?.id === body).sort((a, b) => a.starts_at.localeCompare(b.starts_at)), [data.meetings, body]);
  const next = meetings.find((m) => Date.parse(m.starts_at) >= opened - 4 * 3_600_000) ?? null;
  const now = new Date();
  const marked = new Set(meetings.map((m) => dayKey(m.starts_at)));
  const hour = now.getHours();
  const c = data.counters ?? {};
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
          <h1 className="text-[18px] font-bold text-ink">Good {hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}{data.user?.name ? `, ${data.user.name.split(' ')[0]}` : ''}</h1>
          <p className="text-[12px] text-ink-3">{[data.user?.role, `${data.bodies.length} boards and committees`].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex gap-2">
          <Button disabled={!next} onClick={() => { setBriefOpen(true); brf.mutate(); }}>Director brief</Button>
          <Button variant="primary" disabled={!next} onClick={() => next && onMeeting(next.id)}>Open next pack</Button>
        </div>
      </div>
      <BodyTabs bodies={data.bodies} value={body} onChange={setBody} />
      <ul aria-label="Meetings" className="flex gap-3 overflow-x-auto pb-1 scroll-thin">
        {meetings.length === 0 ? <li className="text-[13px] text-ink-3">No meetings.</li> : null}
        {meetings.map((m) => (
          <li key={m.id} className="w-[260px] shrink-0">
            <button type="button" onClick={() => onMeeting(m.id)} aria-label={m.title} className="flex h-full w-full flex-col rounded-[10px] border border-line bg-surface p-3 text-left hover:border-primary">
              <div className="flex items-center justify-between text-[10.5px] font-bold tracking-[.5px] text-ink-3 uppercase">
                <span>Meeting · {m.body?.name ?? ''}</span>
                <FlagChip flag={m.flag} />
              </div>
              <div className="mt-1 text-[14px] font-bold text-ink">{m.title}</div>
              <div className="text-[12px] text-ink-3">{m.room ?? ''}</div>
              <div className="mt-auto flex justify-between border-t border-line pt-2 text-[12px]">
                <span className="text-ink-2">{m === next ? 'Next' : m.status === 'draft' ? 'Draft agenda' : 'Scheduled'}</span>
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
          title={panel === 'docs' ? 'Shared documents' : 'Notices'}
          action={<button type="button" className="text-[12px] text-primary underline" onClick={() => setPanel(panel === 'docs' ? 'notices' : 'docs')}>{panel === 'docs' ? 'Notices' : 'Documents'}</button>}
        >
          {panel === 'docs' ? (
            <ul className="space-y-2">
              {(data.documents ?? []).map((d) => (
                <li key={d.id} className="flex gap-2 text-[12.5px]">
                  <Icon name="star" size={14} className={d.starred ? 'text-warning' : 'text-ink-3'} aria-label={d.starred ? 'Favourite' : undefined} />
                  <div><div className="text-ink">{d.title}</div><div className="text-[11.5px] text-ink-3">{[d.source, d.date ? fmtDate(d.date) : null].filter(Boolean).join(' · ')}</div></div>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="space-y-2">
              {(data.notices ?? []).map((n) => <li key={n.id} className="text-[12.5px]"><div className="font-semibold">{n.title}</div><div className="text-ink-3">{n.body}</div></li>)}
            </ul>
          )}
        </Panel>
        <Panel title="What's new for you">
          {counter(c.new_meetings, 'New meetings & circulars', 'calendar')}
          {counter(c.new_items, 'New agenda items & papers', 'packs')}
          {counter(c.amended, 'Amended since you last read', 'packs')}
          {counter(c.approvals, 'Approvals & signatures', 'approvals')}
        </Panel>
      </div>
      {briefOpen && next ? (
        <Modal title={`Director brief · ${next.title}`} onClose={() => setBriefOpen(false)} width={620}>
          {brf.isPending ? <Spinner label="Preparing your brief…" /> : brf.data ? (
            <div className="space-y-3 text-[13px]">
              {brf.data.sections.map((s) => (
                <section key={s.title}>
                  <h3 className="font-bold">{s.title}</h3>
                  <ul className="list-disc pl-5">{s.items.map((i, k) => <li key={k}>{i.text} {i.cite ? <span className="rounded bg-subtle px-1 text-[11px]">{i.cite}</span> : null}</li>)}</ul>
                </section>
              ))}
              <p className="text-[11.5px] text-ink-3">AI draft from the papers you can open. Check the paper before relying on it.</p>
            </div>
          ) : <p className="text-[13px] text-ink-3">No brief.</p>}
        </Modal>
      ) : null}
    </div>
  );
}
