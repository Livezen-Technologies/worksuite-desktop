import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Spinner } from '../../components/ui';
import { btn, btnGood, btnSmall, PageHead } from '../hr/parts';
import { can, K, money, refusal, shortDate } from './api';
import { Notice } from './parts';
import type { ScreenProps } from './Rail';
import { docKey, fetchUnposted, kindLabel, postedSentence, refusedRead, retryPosting, unpostedHeadline, unpostedKey, type UnpostedDoc } from './owed';

/**
 * Documents that were issued while the ledger would not take them.
 *
 * THIS SCREEN IS WHAT MAKES DEFERRED POSTING HONEST RATHER THAN SILENT.
 * Posting happens after a document moves, deliberately — the ledger refuses
 * to run inside another transaction, so the two cannot be made atomic. That
 * leaves a choice of failures: "issued, but not posted" (visible, fixed by
 * retrying) or "posted, but still draft" (a journal for an event that did not
 * happen). The first is better only if somebody can see it; this is where.
 *
 * THE REASON IS THE SERVER'S, LIVE, AND VERBATIM. Each row says why the ledger
 * would refuse it as things stand now, not as they stood when it was issued —
 * a period reopened since is a document that will now post. The words are
 * not rewritten: a friendlier sentence is how the actual cause stops reaching
 * the person who can fix it.
 *
 * Seeing is `finance.reports.view`; retrying is a post to the ledger and
 * needs `finance.journal.post`, so without it the rows carry no button. A
 * retry is safe to press again: a document cannot post twice.
 */
export default function Unposted({ company, onGo }: ScreenProps) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const mayPost = can(perms, 'finance.journal.post');
  const q = useQuery({ queryKey: unpostedKey(company.id), queryFn: ({ signal }) => fetchUnposted(company.id, signal), retry: false });
  const [busy, setBusy] = useState<string | null>(null);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) {
    const refused = refusedRead(q.error, perms);
    return (
      <div className="m-6 flex flex-col items-start gap-2 rounded-[12px] border border-line bg-surface px-4 py-3.5 text-[13px] text-ink-2">
        <span>{refused ?? 'This could not be loaded, so it is not a statement that everything posted — it is a failed request.'}</span>
        {refused ? null : (
          <button type="button" className={btn} onClick={() => void q.refetch()}>
            Try again
          </button>
        )}
      </div>
    );
  }

  const docs = q.data;
  if (!docs.length) {
    return (
      <div className="flex flex-col gap-3.5 px-6 py-5">
        <PageHead title="Not in the ledger" />
        <Notice tone="green" className="flex max-w-[640px] items-start gap-2.5">
          <Icon name="check-circle" size={17} className="mt-px shrink-0" />
          <span className="flex flex-col gap-0.5">
            <b className="text-[13.5px]">Everything that was issued is in the books</b>
            <span>Every issued invoice, credit note, approved bill, recorded payment and approved claim has a journal. Nothing is waiting.</span>
          </span>
        </Notice>
      </div>
    );
  }

  const post = async (d: UnpostedDoc) => {
    setBusy(docKey(d));
    try {
      const r = await retryPosting(company.id, d);
      const id = r?.id;
      toast('success', postedSentence(r), id ? { label: 'Open the journal', run: () => onGo('journals', `&open=${id}`) } : undefined);
      // The journal changes the ledger, the ageing tie-out and the overview's count at once.
      void qc.invalidateQueries({ queryKey: K.company(company.id) });
    } catch (e) {
      toast('error', refusal(e));
      // The refusal may have changed since the list was read; read it again.
      void qc.invalidateQueries({ queryKey: unpostedKey(company.id) });
    } finally {
      setBusy(null);
    }
  };

  const blocked = docs.filter((d) => !d.can_post).length;

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead
        title={unpostedHeadline(docs.length)}
        sub={`These were issued while the ledger would not accept them. They are real documents and real money — they are simply absent from every report until they post.${blocked > 0 ? ` ${blocked} still cannot post; the reason is on the row.` : ''}`}
      />
      {mayPost ? null : (
        <Notice tone="grey">
          Posting one of these needs <code className="font-mono text-[11.5px]">finance.journal.post</code>, which you do not hold. Seeing that a document did not post is not the same act as posting it — somebody who holds it can retry them.
        </Notice>
      )}
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
          <span className="w-[240px] shrink-0">Document</span>
          <span className="w-[104px] shrink-0">Dated</span>
          <span className="w-[150px] shrink-0 text-right">Amount</span>
          <span className="min-w-0 flex-1">Why it is not posted</span>
          {mayPost ? <span className="w-[104px] shrink-0" /> : null}
        </div>
        {docs.map((d) => {
          const k = docKey(d);
          return (
            <div key={k} className="flex items-start gap-2.5 border-b border-line/60 px-3.5 py-[9px] text-[13px] last:border-b-0">
              <span className="flex w-[240px] shrink-0 items-baseline gap-1.5">
                <span className="shrink-0 text-ink-3">{kindLabel(d.kind)}</span>
                <span className="truncate font-mono text-[12px] text-ink">{d.number ?? `#${d.id}`}</span>
              </span>
              <span className="w-[104px] shrink-0 text-ink-2">{d.date ? shortDate(d.date) : '—'}</span>
              <span className="w-[150px] shrink-0 text-right text-ink tabular-nums">{money(d.total, d.currency ?? '')}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                {d.can_post ? (
                  <span className="text-ink-3">Nothing — it can post now. It was refused when it was issued.</span>
                ) : (
                  (d.problems.length ? d.problems : ['The ledger gave no reason.']).map((p, i) => (
                    <span key={i} className="text-warning-ink dark:text-warning">
                      {p}
                    </span>
                  ))
                )}
              </span>
              {mayPost ? (
                <span className="flex w-[104px] shrink-0 justify-end">
                  <button type="button" className={d.can_post ? btnGood : btnSmall} disabled={busy === k} onClick={() => void post(d)}>
                    {busy === k ? 'Posting…' : d.can_post ? 'Post it' : 'Try anyway'}
                  </button>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {mayPost ? <p className="m-0 rounded-[10px] bg-subtle px-3 py-2 text-[12px] text-ink-3">Posting is safe to retry — a document cannot post twice, so pressing it again either works or reports the same reason.</p> : null}
    </div>
  );
}
