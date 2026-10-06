/**
 * W02 / D02 Create post — a published post, read-only (SMM-PUB-004/005/006, WF-06): each target's state, its link on
 * the network, its numbers, why a failed one failed in plain words with Retry, "Post again", and the history.
 */
import { useMutation } from '@tanstack/react-query';
import { Button } from '../../../components/ui';
import { call, errorMessage } from '../../../core/bridge';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { accountById, SK, socialApi, useInvalidate, type Account, type Post, type PostEvent } from '../api';
import { ERROR_CLASS } from '../lib/status';
import { logStamp, whenLabel } from '../lib/time';
import { AccountLabel, compact, NetChip, Panel, TargetStatusPill } from '../parts';

export function PostResult({ post, events, accounts, canRetry, canDuplicate }: { post: Post; events: PostEvent[]; accounts: Account[]; canRetry: boolean; canDuplicate: boolean }) {
  const { go } = useTab();
  const invalidate = useInvalidate();
  const retry = useMutation({
    mutationFn: (targetId: number) => socialApi.retry(targetId),
    onSuccess: () => {
      invalidate(SK.post(post.id), SK.postsAll);
      toast('success', 'Trying again.');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const again = useMutation({
    mutationFn: () => socialApi.duplicate(post.id),
    onSuccess: (r) => {
      invalidate(SK.postsAll);
      go(`/social-media/posts/${r.post.id}`);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <Panel
      title="Results"
      action={
        canDuplicate ? (
          <Button size="sm" variant="secondary" icon="copy" loading={again.isPending} onClick={() => again.mutate()}>
            Post again
          </Button>
        ) : null
      }
    >
      <ul className="flex flex-col divide-y divide-line">
        {post.targets.map((t) => {
          const a = accountById(accounts, t.account_id);
          const err = t.error_class ? ERROR_CLASS[t.error_class] : null;
          return (
            <li key={t.id} className="flex flex-col gap-1.5 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                {a ? (
                  <AccountLabel account={a} className="flex-1" />
                ) : (
                  <span className="flex flex-1 items-center gap-2">
                    <NetChip network={t.network} />
                    <span className="text-[13px] text-ink-2">Account {t.account_id}</span>
                  </span>
                )}
                <TargetStatusPill status={t.status} />
                {t.permalink ? (
                  <Button size="sm" variant="ghost" icon="external" onClick={() => void call('app:openExternal', { url: t.permalink! }).catch((e: unknown) => toast('error', errorMessage(e)))}>
                    Open post
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-x-4 text-[12px] text-ink-3">
                {t.published_at ? <span>Published {whenLabel(t.published_at)}</span> : t.run_at ? <span>Due {whenLabel(t.run_at)}</span> : null}
                {t.metrics ? (
                  <>
                    <span>Reach {t.metrics.reach === null ? 'not measured' : compact(t.metrics.reach)}</span>
                    <span>Engagements {t.metrics.engagements === null ? 'not measured' : compact(t.metrics.engagements)}</span>
                    <span>Clicks {t.metrics.clicks === null ? 'not measured' : compact(t.metrics.clicks)}</span>
                  </>
                ) : null}
                {t.attempts ? <span>{t.attempts} attempt{t.attempts === 1 ? '' : 's'}</span> : null}
              </div>
              {t.status === 'failed' || err ? (
                <div className="flex flex-wrap items-center gap-2 rounded-[8px] bg-danger-bg px-2.5 py-1.5 text-[12.5px] text-danger">
                  <span className="flex-1">{err ? err.label : (t.error_message ?? 'It failed.')}</span>
                  {t.status === 'failed' && canRetry ? (
                    <Button size="sm" variant="secondary" icon="refresh" loading={retry.isPending && retry.variables === t.id} onClick={() => retry.mutate(t.id)}>
                      {err?.action === 'reconnect_retry' ? 'Retry after reconnecting' : 'Retry'}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {events.length ? (
        <div className="mt-3 border-t border-line pt-3">
          <h3 className="mb-1.5 text-[12px] font-bold tracking-[.04em] text-ink-3 uppercase">History</h3>
          <ol className="flex flex-col gap-1 text-[12.5px]">
            {events.map((e) => (
              <li key={e.id} className="flex gap-2">
                <span className="w-[120px] shrink-0 text-ink-3 tabular-nums">{logStamp(e.created_at)}</span>
                <span className="text-ink-2">
                  {e.actor ? <b className="font-semibold text-ink">{e.actor.name}</b> : null} {e.text}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Panel>
  );
}
