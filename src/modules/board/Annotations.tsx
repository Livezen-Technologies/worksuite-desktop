import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button, Spinner, cx } from '../../components/ui';
import { fetchAnnotations, fmtDate, K, reattach, type Annotation } from './api';
import { Muted, Panel, Status } from './parts';

/** The text of "Export my notes": one block per note, page and quote first. */
export function exportNotes(list: Annotation[]): string {
  return list.map((a) => [`${a.item ?? a.paper} · p ${a.page}${a.detached ? ' (detached)' : ''}`, a.quote ? `“${a.quote}”` : null, a.note ?? null, ''].filter((x) => x !== null).join('\n')).join('\n');
}

/** D-06 Annotations: mine / shared with me, detached notes with re-attach, who sees my notes (FR-ANN-01..04). */
export default function Annotations({ meetingId, packVersion }: { meetingId: number; packVersion: number }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<'mine' | 'shared'>('mine');
  const mine = useQuery({ queryKey: K.annotations(meetingId, 'mine'), queryFn: ({ signal }) => fetchAnnotations(meetingId, 'mine', signal) });
  const shared = useQuery({ queryKey: K.annotations(meetingId, 'shared'), queryFn: ({ signal }) => fetchAnnotations(meetingId, 'shared', signal) });
  const list = (scope === 'mine' ? mine : shared).data ?? [];
  const re = useMutation({
    mutationFn: (a: Annotation) => reattach(a.id, packVersion),
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.annotations(meetingId, 'mine') }),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const doExport = () => {
    const url = URL.createObjectURL(new Blob([exportNotes(mine.data ?? [])], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-board-notes-${meetingId}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-3 flex items-start justify-between">
        <div><h1 className="text-[18px] font-bold">Annotations</h1><p className="text-[12px] text-ink-3">Pack v{packVersion}</p></div>
        <div className="flex gap-1.5" role="tablist">
          <Button size="sm" role="tab" aria-selected={scope === 'mine'} variant={scope === 'mine' ? 'primary' : 'secondary'} onClick={() => setScope('mine')}>Mine · {mine.data?.length ?? 0}</Button>
          <Button size="sm" role="tab" aria-selected={scope === 'shared'} variant={scope === 'shared' ? 'primary' : 'secondary'} onClick={() => setScope('shared')}>Shared with me · {shared.data?.length ?? 0}</Button>
          <Button size="sm" disabled={!mine.data?.length} onClick={doExport}>Export my notes</Button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_300px] gap-3">
        <Panel title={scope === 'mine' ? 'My notes' : 'Shared with me'}>
          {(scope === 'mine' ? mine : shared).isPending ? <Spinner /> : null}
          <ul className="space-y-2.5" aria-label="Annotations">
            {list.map((a) => (
              <li key={a.id} className={cx('rounded-[8px] border-l-4 p-2.5', a.detached ? 'border-warning bg-warning/5' : a.share === 'shared' ? 'border-primary bg-subtle' : 'border-[#EAB308] bg-subtle')}>
                <div className="flex items-center justify-between text-[12.5px] font-bold">
                  <span className="flex items-center gap-1.5">{a.item ?? a.paper} · p {a.page}{a.detached && a.version ? ` (v${a.version})` : ''}
                    {a.detached ? <Status tone="warning">Detached — page changed</Status> : a.share === 'shared' ? <Status tone="indigo">Shared · {(a.with ?? []).join(', ') || a.owner}</Status> : <Status>Private</Status>}
                  </span>
                  <span className="font-normal text-ink-3">{fmtDate(a.at)}</span>
                </div>
                {a.quote ? <blockquote className="mt-1 rounded bg-surface px-2 py-1 font-serif text-[12px]">{a.quote}</blockquote> : null}
                {a.note ? <p className="mt-1 text-[12.5px]">{a.note}</p> : null}
                {a.detached && scope === 'mine' ? <button type="button" className="mt-1 text-[12px] text-primary underline" onClick={() => re.mutate(a)}>Re-attach on v{packVersion}</button> : null}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Who sees my notes?">
          <p className="text-[12.5px]">Private notes are only yours. They never appear in minutes, archive exports or anyone else's view.</p>
          <p className="mt-2 text-[12.5px]">A shared note is visible only to the people you chose, and you can unshare it.</p>
          <Muted>Tools: highlight · underline · strike · pen · text note · sticky note · shape · bookmark</Muted>
        </Panel>
      </div>
    </div>
  );
}
