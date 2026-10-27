import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button, Spinner, cx } from '../../components/ui';
import { currentVersionFor, fetchAnnotations, fmtDate, K, reattach, titleCase, type Annotation } from './api';
import { Muted, Panel, Status } from './parts';

/** The text of "Export my notes": one block per note, page and quote first. */
export function exportNotes(list: Annotation[]): string {
  return list.map((a) => [`${titleCase(a.kind)} · p ${a.page ?? '—'}${a.detached ? ' (detached)' : ''}`, a.anchor?.text ? `“${a.anchor.text}”` : null, a.body ?? null, ''].filter((x) => x !== null).join('\n')).join('\n');
}

const SHARED: Record<string, string> = { SELECTED: 'Shared with chosen people', COMMITTEE: 'Shared with the committee', SECRETARY: 'Shared with the secretary', EVERYONE: 'Shared with everyone' };

/** D-06 Annotations: mine / shared with me, detached notes with re-attach, who sees my notes (FR-ANN-01..04). */
export default function Annotations({ meetingId, packVersion }: { meetingId: number; packVersion: number | null }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<'mine' | 'shared'>('mine');
  const mine = useQuery({ queryKey: K.annotations(meetingId, 'mine'), queryFn: ({ signal }) => fetchAnnotations(meetingId, 'mine', signal) });
  const shared = useQuery({ queryKey: K.annotations(meetingId, 'shared'), queryFn: ({ signal }) => fetchAnnotations(meetingId, 'shared', signal) });
  const list = (scope === 'mine' ? mine : shared).data ?? [];
  const re = useMutation({
    mutationFn: async (a: Annotation) => {
      const cur = a.paper_version_id ? await currentVersionFor(meetingId, a.paper_version_id) : null;
      if (!cur) throw new Error('The paper this note was on is no longer in the meeting.');
      return reattach(a, cur.id);
    },
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
        <div><h1 className="text-[18px] font-bold">Annotations</h1><p className="text-[12px] text-ink-3">{packVersion ? `Pack v${packVersion}` : 'No pack published yet'}</p></div>
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
              <li key={a.id} className={cx('rounded-[8px] border-l-4 p-2.5', a.detached ? 'border-warning bg-warning/5' : a.visibility !== 'PRIVATE' ? 'border-primary bg-subtle' : 'border-amber bg-subtle')}>
                <div className="flex items-center justify-between text-[12.5px] font-bold">
                  <span className="flex items-center gap-1.5">{titleCase(a.kind)} · p {a.page ?? '—'}
                    {a.detached ? <Status tone="warning">Detached — page changed</Status> : a.visibility !== 'PRIVATE' ? <Status tone="indigo">{scope === 'shared' ? (a.author ?? 'Shared') : SHARED[a.visibility]}</Status> : <Status>Private</Status>}
                  </span>
                  <span className="font-normal text-ink-3">{fmtDate(a.updated_at)}</span>
                </div>
                {a.anchor?.text ? <blockquote className="mt-1 rounded bg-surface px-2 py-1 font-serif text-[12px]">{a.anchor.text}</blockquote> : null}
                {a.body ? <p className="mt-1 text-[12.5px]">{a.body}</p> : null}
                {a.detached && scope === 'mine' ? <button type="button" className="mt-1 text-[12px] text-primary underline" onClick={() => re.mutate(a)}>Re-attach to the current version</button> : null}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Who sees my notes?">
          <p className="text-[12.5px]">Private notes are only yours. They never appear in minutes, archive exports or anyone else's view.</p>
          <p className="mt-2 text-[12.5px]">A shared note is visible only to the people you chose, and you can unshare it.</p>
          <Muted>Tools: highlight · underline · strike · pen · note · sticky note · shape · bookmark</Muted>
        </Panel>
      </div>
    </div>
  );
}
