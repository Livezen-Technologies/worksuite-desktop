import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, ErrorNote, Spinner } from '../../../components/ui';
import { toast } from '../../../core/toasts';
import { PageHead } from '../../../components/PageKit';
import { eGet, ePost, K, when, type Enrollment } from '../api';
import { Ask, useEl } from '../parts';

type Waiting = Enrollment & { step?: string | number | null; requested_at?: string | null };

/**
 * Requests to join waiting for the person (WF-07): through the approval chain
 * `elearning.enrollment` — a learner's line manager, or the holders of
 * `elearning.enrollment.manage`. Declining needs a word to the learner.
 */
export default function Approvals() {
  const el = useEl();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.approvals, queryFn: ({ signal }) => eGet<{ items: Waiting[] }>('/approvals', undefined, signal) });
  const [asking, setAsking] = useState<{ e: Waiting; decision: 'approve' | 'reject' } | null>(null);
  const decide = async (e: Waiting, decision: 'approve' | 'reject', comment: string) => {
    const r = await ePost(`/enrollments/${e.id}/decide`, { decision, comment });
    toast('success', r.message);
    setAsking(null);
    void qc.invalidateQueries({ queryKey: K.approvals });
    void qc.invalidateQueries({ queryKey: ['elearning', 'enrollments'] });
  };
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Requests to join" sub="Learners asking to join courses that need approval." />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data?.items.length === 0 ? <p className="m-0 text-[13px] text-ink-3">Nothing is waiting for you.</p> : null}
      <ul className="m-0 flex max-w-[900px] list-none flex-col gap-1.5 p-0">
        {(q.data?.items ?? []).map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px]">
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => el.open.enrollment(e.id)}>
              <b className="text-ink hover:text-primary">{e.learner.name}</b> <span className="text-ink-2">— {e.course.title}</span>
              <span className="block text-[12px] text-ink-3">Asked {when(e.requested_at ?? e.created_at, true)}</span>
            </button>
            <Button size="sm" variant="success" disabled={!el.online} onClick={() => setAsking({ e, decision: 'approve' })}>
              Approve
            </Button>
            <Button size="sm" disabled={!el.online} onClick={() => setAsking({ e, decision: 'reject' })}>
              Decline
            </Button>
          </li>
        ))}
      </ul>
      {asking ? (
        <Ask
          title={`${asking.decision === 'approve' ? 'Approve' : 'Decline'} ${asking.e.learner.name}`}
          text={asking.e.course.title}
          label={asking.decision === 'approve' ? 'Comment' : 'Why'}
          required={asking.decision === 'reject'}
          danger={asking.decision === 'reject'}
          confirm={asking.decision === 'approve' ? 'Approve' : 'Decline'}
          onClose={() => setAsking(null)}
          onConfirm={(w) => decide(asking.e, asking.decision, w)}
        />
      ) : null}
    </div>
  );
}
