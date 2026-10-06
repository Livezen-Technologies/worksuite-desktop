import { useState } from 'react';
import { Button, cx, Empty, Spinner } from '../../../components/ui';
import { useNow } from '../../../core/use-now';
import { useTab } from '../../../core/tab-context';
import { dataOf, postNetworks, postWhen, rowsOf, useAccounts, useBrands, useModuleStatus, usePost, usePosts, type Post } from '../api';
import { useSocialAccess } from '../access';
import { whenLabel } from '../lib/time';
import { NetChips, NotOffered, PageBody, PageHeader, Pill, Refused, UnderlineTabs, useBrandScope } from '../parts';
import { ApprovalDetail } from './engage/ApprovalDetail';
import { changesBy, sentByMe, stepOf, useMyId, waitingForMe } from './engage/shared';

/**
 * W05 Approvals (R-Approvals artboard p.46, WF-04, WF-14; SMM-APR-001…008, AC-05, AC-06, AC-14): posts in review,
 * split by who has to act, with the selected one's preview, steps, comments and decision on the right. Drafts sent
 * back with changes requested are listed too, so the owner finds them. `/social-media/approvals/<id>` selects a post.
 */
type TabId = 'mine' | 'sent' | 'all' | 'changes';

export default function Approvals({ postId }: { postId: number | null }) {
  const { go } = useTab();
  const now = useNow(60_000).getTime();
  const me = useMyId();
  const access = useSocialAccess(dataOf(useModuleStatus().data)?.permissions);
  const [brandId] = useBrandScope();
  const [tab, setTab] = useState<TabId>('mine');

  const reviewQ = usePosts({ status: 'in_review', brand_id: brandId });
  const draftsQ = usePosts({ status: 'draft', brand_id: brandId });
  const accounts = rowsOf(useAccounts().data);
  const brands = rowsOf(useBrands().data);

  const inScope = (p: Post) => brandId === null || p.brand_id === brandId;
  const review = rowsOf(reviewQ.data).filter((p) => p.status === 'in_review' && inScope(p));
  const changes = rowsOf(draftsQ.data).filter((p) => p.approval?.state === 'changes_requested' && inScope(p));
  const lists: Record<TabId, Post[]> = {
    mine: review.filter(waitingForMe),
    sent: review.filter((p) => sentByMe(p, me)),
    all: review,
    changes,
  };
  const rows = lists[tab];
  const known = [...review, ...changes];
  const listed = postId !== null ? known.find((p) => p.id === postId) : rows[0];
  const fetched = usePost(postId !== null && !listed ? postId : null);
  const selected = listed ?? dataOf(fetched.data)?.post ?? null;

  const open = (id: number) => go(`/social-media/approvals/${id}`);
  // After a decision: the next card still waiting in this list, else the list.
  const next = (id: number) => {
    const i = rows.findIndex((p) => p.id === id);
    const after = [...rows.slice(i + 1), ...rows.slice(0, Math.max(0, i))].find((p) => p.id !== id && (tab !== 'mine' || waitingForMe(p)));
    go(after ? `/social-media/approvals/${after.id}` : '/social-media/approvals');
  };

  const offered = reviewQ.data?.offered !== false;
  return (
    <>
      <PageHeader
        crumb="Approvals"
        title="Approvals"
        actions={
          access.settings ? (
            <Button icon="settings" onClick={() => go('/social-media/settings/approvals')}>
              Approval rules
            </Button>
          ) : null
        }
      />
      <PageBody className="flex flex-col gap-4">
        <UnderlineTabs
          label="Approvals"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'mine', label: 'Waiting for me', count: offered ? lists.mine.length : null },
            { id: 'sent', label: 'Sent by me', count: offered ? lists.sent.length : null },
            { id: 'all', label: 'All in review', count: offered ? lists.all.length : null },
            { id: 'changes', label: 'Changes requested', count: draftsQ.data?.offered ? lists.changes.length : null },
          ]}
        />
        <div className="flex min-h-0 flex-wrap items-start gap-4">
          <div className="flex w-full max-w-[420px] min-w-[280px] flex-[1_1_340px] flex-col gap-2">
            {reviewQ.isLoading ? (
              <Spinner />
            ) : reviewQ.error ? (
              <Refused error={reviewQ.error} onRetry={() => void reviewQ.refetch()} />
            ) : !offered ? (
              <NotOffered what="Approvals" compact />
            ) : rows.length === 0 ? (
              <div className="rounded-[12px] border border-line bg-surface">
                <Empty icon="check-circle" title={tab === 'mine' ? 'Nothing is waiting for you' : 'Nothing here'} hint={tab === 'changes' ? 'No drafts have changes requested.' : 'Posts sent for approval show here.'} />
              </div>
            ) : (
              <ul className="flex flex-col gap-2" aria-label="Posts">
                {rows.map((p) => (
                  <li key={p.id}>
                    <Card post={p} on={selected?.id === p.id} onOpen={() => open(p.id)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="min-w-0 flex-[999_1_560px] rounded-[14px] border border-line bg-surface p-5">
            {selected ? (
              <ApprovalDetail key={selected.id} post={selected} accounts={accounts} brands={brands} access={access} me={me} now={now} onDecided={next} />
            ) : fetched.isLoading ? (
              <Spinner />
            ) : !offered ? (
              <NotOffered what="Post previews and decisions" compact />
            ) : (
              <Empty icon="eye" title="Pick a post to review" hint="Its preview, steps and comments show here." />
            )}
          </div>
        </div>
      </PageBody>
    </>
  );
}

function Card({ post, on, onOpen }: { post: Post; on: boolean; onOpen: () => void }) {
  const a = post.approval;
  const changes = a?.state === 'changes_requested';
  const who = a?.submitted_by?.name ?? post.owner?.name ?? post.created_by?.name ?? null;
  const at = postWhen(post);
  const step = stepOf(a);
  const sub = changes
    ? [who, `changes asked by ${changesBy(a) ?? 'a reviewer'}`]
    : [who, at ? `for ${whenLabel(at)}` : null, step ? step.toLowerCase() : null];
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={on ? 'true' : undefined}
      className={cx('flex w-full flex-col gap-1.5 rounded-[12px] border p-3.5 text-left transition-colors', on ? 'border-primary bg-selection' : 'border-line bg-surface hover:bg-subtle')}
    >
      <span className="flex items-center gap-2">
        <NetChips networks={postNetworks(post)} size={20} />
        <span className="flex-1" />
        {changes ? <Pill tone="danger">Changes requested</Pill> : <Pill tone="warning">In review</Pill>}
      </span>
      <span className="line-clamp-2 text-[13.5px] font-bold text-ink">{post.internal_title || post.base_text}</span>
      <span className="truncate text-[12px] text-ink-3">{sub.filter(Boolean).join(' · ')}</span>
    </button>
  );
}
