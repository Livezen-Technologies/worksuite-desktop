import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button, Spinner, cx } from '../../components/ui';
import { app } from '../../core/app-state';
import { COMMENT_MAX, commentProblem, fetchAgenda, fetchComments, flagOf, fmtDate, fmtTime, K, postComment, summarize, type Attendance, type Audience } from './api';
import { SummaryPanel } from './Agenda';
import { FlagChip } from './parts';

const SHARE: Record<Audience, string> = { ALL: 'All members', SPECIFIC: 'Specific…', PRIVATE: 'Private' };

/** D-04 Item comments & AI summary (FR-DX-10, FR-DX-11, FR-AI-03). */
export default function Comments({ meetingId, item, participants, canComment, onItem }: { meetingId: number; item: number | null; participants: Attendance[]; canComment: boolean; onItem: (id: number) => void }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<'item' | 'all'>(item ? 'item' : 'all');
  const [body, setBody] = useState('');
  const [share, setShare] = useState<Audience>('ALL');
  const [people, setPeople] = useState<number[]>([]);
  const agenda = useQuery({ queryKey: K.agenda(meetingId), queryFn: ({ signal }) => fetchAgenda(meetingId, signal) });
  const forItem = scope === 'item' ? item : null;
  const list = useQuery({ queryKey: K.comments(meetingId, forItem), queryFn: ({ signal }) => fetchComments(meetingId, forItem, signal) });
  const items = agenda.data ?? [];
  const idx = items.findIndex((i) => i.id === item);
  const cur = idx >= 0 ? items[idx]! : null;
  const paper = cur?.papers?.[0] ?? null;
  const sum = useQuery({ queryKey: K.summary(paper?.id ?? 0), queryFn: () => summarize(paper!.id), enabled: !!paper });
  const me = Number(app.get().auth?.user?.id ?? 0);
  const names = new Map(participants.map((p) => [p.user_id, p.name]));
  const itemNo = new Map(items.map((i) => [i.id, `${i.number} ${i.title}`]));
  const send = useMutation({
    mutationFn: () => postComment(meetingId, item!, body, share, people),
    onSuccess: () => { setBody(''); void qc.invalidateQueries({ queryKey: ['board', 'comments', meetingId] }); },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const problem = body ? commentProblem(body, share, people) : null;

  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-[18px] font-bold">{cur ? `${cur.number} ${cur.title}` : 'All comments'} <FlagChip flag={flagOf(cur?.flags)} /></h1>
          <p className="text-[12px] text-ink-3">{list.data?.length ?? 0} comments</p>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" disabled={idx <= 0} onClick={() => onItem(items[idx - 1]!.id)}>‹ {idx > 0 ? items[idx - 1]!.number : ''}</Button>
          <Button size="sm" disabled={idx < 0 || idx >= items.length - 1} onClick={() => onItem(items[idx + 1]!.id)}>{idx >= 0 && idx < items.length - 1 ? items[idx + 1]!.number : ''} ›</Button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_300px] gap-3">
        <section className="flex min-h-0 flex-col rounded-[10px] border border-line bg-surface">
          <div role="tablist" className="grid grid-cols-2 border-b border-line text-[13px]">
            {(['item', 'all'] as const).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={scope === s} disabled={s === 'item' && !item} onClick={() => setScope(s)} className={cx('py-2', scope === s ? 'border-b-2 border-primary font-bold text-primary' : 'text-ink-2')}>
                {s === 'item' ? 'This item' : 'All comments in meeting'}
              </button>
            ))}
          </div>
          <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3.5 scroll-thin" aria-label="Comments">
            {list.isPending ? <Spinner /> : null}
            {(list.data ?? []).map((c) => {
              const mine = c.user_id === me;
              return (
                <li key={c.id} className={cx('max-w-[75%] rounded-[10px] border border-line p-2.5 text-[12.5px]', mine ? 'ml-auto bg-selection dark:bg-selection' : 'bg-subtle')}>
                  <div className="flex justify-between gap-3 font-semibold"><span>{mine ? 'You' : c.author}</span><span className="font-normal text-ink-3">{fmtDate(c.created_at)} {fmtTime(c.created_at)}</span></div>
                  {scope === 'all' && itemNo.get(c.agenda_item_id) ? <div className="text-[11px] text-ink-3">{itemNo.get(c.agenda_item_id)}</div> : null}
                  <p className="whitespace-pre-wrap">{c.body}</p>
                  <span className="text-[11px] text-primary">{c.audience === 'SPECIFIC' ? (c.shared_with ?? []).map((u) => names.get(u) ?? `#${u}`).join(', ') : SHARE[c.audience]}</span>
                </li>
              );
            })}
          </ul>
          {item && canComment ? (
            <div className="flex gap-3 border-t border-line p-3.5">
              <label className="flex flex-1 flex-col text-[12px]">
                Add a comment
                <textarea value={body} maxLength={COMMENT_MAX + 50} onChange={(e) => setBody(e.target.value)} placeholder={`Write a comment on ${cur?.number ?? 'this item'}…`} className="mt-1 h-[80px] rounded-[8px] border border-line bg-surface p-2" />
                <span className="mt-1 flex justify-between text-[11px] text-ink-3"><span>Encrypted · never copied into minutes automatically</span><span className={body.length > COMMENT_MAX ? 'text-danger' : ''}>{body.length} / {COMMENT_MAX}</span></span>
              </label>
              <div className="flex w-[130px] flex-col gap-1.5 text-[12px]" role="radiogroup" aria-label="Share with">
                Share with
                {(Object.keys(SHARE) as Audience[]).map((s) => <Button key={s} size="sm" role="radio" aria-checked={share === s} variant={share === s ? 'primary' : 'secondary'} onClick={() => setShare(s)}>{SHARE[s]}</Button>)}
                {share === 'SPECIFIC' ? (
                  <select multiple aria-label="People" className="h-[64px] rounded border border-line" value={people.map(String)} onChange={(e) => setPeople([...e.target.selectedOptions].map((o) => Number(o.value)))}>
                    {participants.filter((p) => p.user_id !== me).map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
                  </select>
                ) : null}
                <Button variant="primary" size="sm" disabled={!!problem || !body.trim() || send.isPending} title={problem ?? undefined} onClick={() => send.mutate()}>Send</Button>
              </div>
            </div>
          ) : item ? <p className="border-t border-line p-3 text-[12px] text-ink-3">Your role cannot comment during the live meeting.</p> : null}
        </section>
        <SummaryPanel title={`AI summary${cur ? ` · ${cur.number}` : ''}`} paper={paper} q={sum} />
      </div>
    </div>
  );
}
