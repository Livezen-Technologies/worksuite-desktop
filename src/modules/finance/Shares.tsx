import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Spinner } from '../../components/ui';
import { btnBad, Cell, PageHead, row, THead } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { can, refusal, shortDate } from './api';
import { ConfirmSheet, LoadFailed, Notice } from './parts';
import type { ScreenProps } from './Rail';
import { calendarDay, fetchShares, forbiddenWhy, KS, revokeShare, type ShareRow } from './setup';

/**
 * The links that show one of this company's reports to somebody without a
 * sign-in, and the way to turn one off.
 *
 * Without this list the share dialog's "you can revoke it at any time" was a
 * promise nothing kept: only a hash of the token is stored and the token is
 * shown once, so a link sent to the wrong address served the figures for its
 * full seven days.
 *
 * A dead link says which kind of dead. The recipient sees one message for
 * revoked, expired and used-up alike, so a guessed token learns nothing; the
 * owner needs to know which, because only one of them is fixed by a new link
 * with a longer life.
 *
 * Listing takes `finance.reports.share` with the figures; the server widens the
 * list to everybody's links for a `finance.reports.manage` holder, and every
 * link it lists to you is one you may revoke.
 */
export default function Shares({ company }: ScreenProps) {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const mayList = can(perms, 'finance.reports.view') && can(perms, 'finance.reports.share');
  const q = useQuery({ queryKey: KS.shares(company.id), queryFn: ({ signal }) => fetchShares(company.id, signal), retry: false, enabled: mayList });
  const [revoking, setRevoking] = useState<ShareRow | null>(null);
  const [busy, setBusy] = useState(false);

  const page = (children: ReactNode, sub = 'Links that show a report to somebody without a sign-in.') => (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Shared reports" sub={sub} />
      {children}
    </div>
  );

  if (!mayList) {
    return page(
      <Notice tone="grey">
        Share links are listed for the people who may create them, which takes <code className="font-mono text-[11.5px]">finance.reports.share</code> as well as <code className="font-mono text-[11.5px]">finance.reports.view</code>. Seeing everybody’s links also needs{' '}
        <code className="font-mono text-[11.5px]">finance.reports.manage</code>.
      </Notice>,
    );
  }
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) {
    const why = forbiddenWhy(q.error);
    return why ? page(<Notice tone="grey">{why}</Notice>) : <LoadFailed what="The share links" onRetry={() => void q.refetch()} />;
  }

  const d = q.data;
  const revoke = async (r: ShareRow) => {
    setBusy(true);
    try {
      await revokeShare(company.id, r.id);
      toast('success', 'Link revoked. It stops working immediately.');
      setRevoking(null);
      void qc.invalidateQueries({ queryKey: KS.shares(company.id) });
    } catch (e) {
      // "Created by somebody else" is the server's, and names the grant that would allow it.
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  const ceiling = d.rows[0]?.max_views ?? 500;

  return page(
    <>
      {d.rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[12px] border border-dashed border-line bg-surface px-6 py-8 text-center text-[13px] text-ink-2">
          <Icon name="link" size={22} className="text-ink-3" />
          No links yet. Create one from the Share button on a report.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line bg-surface">
          <div className="min-w-[780px]">
            <THead
              cols={[
                ['Report', null],
                ['Period', 210],
                ['Expires', 100],
                ['Opened', 90],
                ['State', 140],
                ['', 70],
              ]}
            />
            {d.rows.map((r) => (
              <div key={r.id} className={row}>
                <Cell w={null}>{d.reports[r.report] ?? r.report}</Cell>
                <Cell w={210} className="text-ink-2 tabular-nums">
                  {shortDate(r.from)} → {shortDate(r.to)}
                </Cell>
                <Cell w={100} className="text-ink-2 tabular-nums">
                  {shortDate(calendarDay(r.expires_at))}
                </Cell>
                <span className="flex w-[90px] shrink-0 flex-col text-right tabular-nums">
                  <span className="text-ink-2">
                    {r.views}
                    <span className="text-ink-3"> / {r.max_views}</span>
                  </span>
                  {r.last_seen_at ? <span className="text-[11px] text-ink-3">last {shortDate(calendarDay(r.last_seen_at))}</span> : null}
                </span>
                <span className="w-[140px] shrink-0">{r.live ? <Pill tone="green">Live</Pill> : <Pill tone="grey">{deadWord(r.why_dead)}</Pill>}</span>
                <span className="flex w-[70px] shrink-0 justify-end">
                  {r.live ? (
                    <button type="button" className={btnBad} aria-label={`Revoke the ${d.reports[r.report] ?? r.report} link`} onClick={() => setRevoking(r)}>
                      Revoke
                    </button>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="m-0 text-[11.5px] leading-relaxed text-ink-3">
        A link is dead once it is revoked, once it expires, or once it has been opened {ceiling} times — the ceiling exists so a link that escapes into a mailing list stops on its own. The recipient sees the same message for all three, so a guessed token learns nothing.
      </p>

      {revoking ? (
        <ConfirmSheet
          title="Revoke this link?"
          body="It stops working immediately. Anybody holding it sees the same message as an expired link. This cannot be undone — you would have to create a new one."
          action="Revoke"
          danger
          busy={busy}
          onYes={() => void revoke(revoking)}
          onClose={() => setRevoking(null)}
        />
      ) : null}
    </>,
    `Links that show a report to somebody without a sign-in. ${d.note}`,
  );
}

/** "view limit reached" → "View limit reached"; a dead link the server did not explain is "Not live". */
function deadWord(why: string | null): string {
  return why ? why.charAt(0).toUpperCase() + why.slice(1) : 'Not live';
}
