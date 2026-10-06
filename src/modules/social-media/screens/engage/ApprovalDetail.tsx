import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Icon } from '../../../../components/Icon';
import { Avatar, Button, cx, Modal } from '../../../../components/ui';
import { errorMessage } from '../../../../core/bridge';
import { useTab } from '../../../../core/tab-context';
import { toast } from '../../../../core/toasts';
import { accountById, brandById, postWhen, SK, socialApi, useComments, useInvalidate, type Account, type ApprovalStep, type Brand, type Person, type Post } from '../../api';
import type { SocialAccess } from '../../access';
import { networkInfo } from '../../lib/networks';
import { brandClock, longWhen, minutesUntil, whenLabel } from '../../lib/time';
import { Field, MediaTile, NetChip, Notice, OptionalView, Pill, TEXTAREA } from '../../parts';
import { ShareForReview } from './ReviewLinks';
import { changesBy, mentionable, shortWhen, stepOf, waitingForMe } from './shared';

/**
 * W05 Approvals — the selected post (R-Approvals artboard, WF-04; SMM-APR-003…006, AC-05, AC-06): the exact
 * per-account preview, when and where it goes, the policy's steps, the internal comment thread with @mentions, and
 * the decision. Request changes needs a comment (APR-003); a post whose time passed in review is held, never
 * published unapproved (APR-006).
 */
export function ApprovalDetail({ post, accounts, brands, access, me, now, onDecided }: { post: Post; accounts: Account[]; brands: Brand[]; access: SocialAccess; me: number | null; now: number; onDecided: (id: number) => void }) {
  const { go } = useTab();
  const invalidate = useInvalidate();
  const commentsQ = useComments(post.id);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Person[]>([]);
  const [rejecting, setRejecting] = useState(false);
  const [sharing, setSharing] = useState(false);

  const a = post.approval ?? null;
  const step = stepOf(a);
  const changes = a?.state === 'changes_requested';
  const decides = access.approve && waitingForMe(post);
  const at = postWhen(post);
  const late = post.status === 'in_review' && at !== null && (minutesUntil(at, now) ?? 1) < 0;
  const brand = brandById(brands, post.brand_id);
  const comments = commentsQ.data?.offered ? commentsQ.data.data : [];
  const people = mentionable(post, comments.map((c) => c.author), me);
  const mentions = picked.filter((p) => text.includes(`@${p.name}`)).map((p) => p.id);

  const done = () => {
    setText('');
    setPicked([]);
    invalidate(SK.postsAll, SK.status, SK.post(post.id), SK.comments(post.id));
  };
  const decide = useMutation({
    mutationFn: (v: { decision: 'approve' | 'changes' | 'reject'; comment?: string }) => socialApi.decide(post.id, v.decision, v.comment),
    onSuccess: (_r, v) => {
      toast('success', v.decision === 'approve' ? 'Approved' : v.decision === 'changes' ? 'Changes requested — back to the owner' : 'Rejected');
      setRejecting(false);
      done();
      onDecided(post.id);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const comment = useMutation({
    mutationFn: () => socialApi.addComment(post.id, text.trim(), mentions),
    onSuccess: () => done(),
    onError: (e) => toast('error', errorMessage(e)),
  });

  const typed = text.trim();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="min-w-0 flex-1 text-[17px] font-bold text-ink">{post.internal_title || post.base_text.split('\n')[0]}</h2>
        {changes ? <Pill tone="danger">Changes requested</Pill> : step ? <Pill tone="warning">{step}</Pill> : null}
        {access.create || access.approve ? (
          <Button size="sm" icon="link" onClick={() => setSharing(true)}>
            Share for review
          </Button>
        ) : null}
      </div>

      {late ? (
        <Notice tone="danger" icon="warning">
          Held — the time passed before approval. It is never published unapproved; approve to choose a new time.
        </Notice>
      ) : null}

      <div className="flex flex-wrap gap-4">
        <Preview post={post} accounts={accounts} />
        <div className="flex min-w-[260px] flex-1 flex-col gap-3 text-[13px]">
          <Meta label="Account">
            {post.targets.map((t) => {
              const acc = accountById(accounts, t.account_id);
              return (
                <span key={t.id} className="block">
                  {acc?.handle ?? acc?.display_name ?? `Account ${t.account_id}`} · {networkInfo(t.network).label}
                </span>
              );
            })}
          </Meta>
          <Meta label="Scheduled for">
            {at ? (
              <>
                {longWhen(at)}
                {brandClock(at, brand?.timezone) ? <span className="block text-[12px] text-ink-3">{brandClock(at, brand?.timezone)}</span> : null}
              </>
            ) : (
              'Not scheduled'
            )}
          </Meta>
          <Meta label="Campaign">{post.campaign?.name ?? '—'}</Meta>
          {a ? <Steps steps={a.steps} submittedBy={a.submitted_by} /> : <p className="text-[12.5px] text-ink-3">No approval request on this post.</p>}
        </div>
      </div>

      <section aria-label="Comments" className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4">
        <h3 className="text-[14px] font-bold text-ink">Comments</h3>
        <OptionalView q={commentsQ} what="Comments" compact>
          {(rows) =>
            rows.length === 0 ? (
              <p className="text-[12.5px] text-ink-3">No comments yet. Comments are internal and never published.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {rows.map((c) => {
                  const who = c.author?.name ?? c.reviewer_name ?? 'Reviewer';
                  return (
                    <li key={c.id} className="flex gap-2.5">
                      <Avatar name={who} size={28} />
                      <div className="min-w-0">
                        <div className="text-[12.5px]">
                          <span className="font-semibold text-ink">{who}</span>
                          {c.reviewer_name && !c.author ? <span className="text-ink-3"> · external reviewer</span> : null}
                          <span className="ml-1.5 text-ink-3">{whenLabel(c.created_at)}</span>
                        </div>
                        <p className="text-[13px] whitespace-pre-wrap text-ink-2">{c.body}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          }
        </OptionalView>
        <MentionBox value={text} onChange={setText} people={people} onPick={(p) => setPicked((x) => (x.some((y) => y.id === p.id) ? x : [...x, p]))} />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!typed} loading={comment.isPending} onClick={() => comment.mutate()}>
            Comment
          </Button>
          {decides ? (
            <>
              <span className="flex-1" />
              {!typed ? <span className="text-[11.5px] text-ink-3">Write a comment to request changes.</span> : null}
              <Button
                className="border-danger/60 text-danger hover:bg-danger-bg"
                disabled={!typed}
                loading={decide.isPending && decide.variables?.decision === 'changes'}
                onClick={() => decide.mutate({ decision: 'changes', comment: typed })}
              >
                Request changes
              </Button>
              {access.create || access.editAny ? (
                <Button icon="pen" onClick={() => go(`/social-media/posts/${post.id}`)}>
                  Edit
                </Button>
              ) : null}
              <Button variant="success" icon="check" loading={decide.isPending && decide.variables?.decision === 'approve'} onClick={() => decide.mutate({ decision: 'approve', comment: typed || undefined })}>
                Approve
              </Button>
            </>
          ) : (
            <>
              <span className="flex-1" />
              <span className="text-[12px] text-ink-3">{changes ? `Changes asked by ${changesBy(a) ?? 'a reviewer'} — the owner edits and sends it again.` : a ? 'Someone else decides this step.' : ''}</span>
              {changes && (access.create || access.editAny) ? (
                <Button icon="pen" onClick={() => go(`/social-media/posts/${post.id}`)}>
                  Edit
                </Button>
              ) : null}
            </>
          )}
        </div>
        {decides ? (
          <div className="text-right">
            <button type="button" onClick={() => setRejecting(true)} className="text-[12px] font-semibold text-danger underline-offset-2 hover:underline">
              Reject this post…
            </button>
          </div>
        ) : null}
      </section>

      {rejecting ? <RejectModal busy={decide.isPending} onClose={() => setRejecting(false)} onReject={(reason) => decide.mutate({ decision: 'reject', comment: reason })} /> : null}
      {sharing ? <ShareForReview postId={post.id} onClose={() => setSharing(false)} /> : null}
    </div>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11.5px] text-ink-3">{label}</div>
      <div className="font-semibold text-ink">{children}</div>
    </div>
  );
}

/** The exact variant per account, with a switcher when the post goes to several. */
function Preview({ post, accounts }: { post: Post; accounts: Account[] }) {
  const [i, setI] = useState(0);
  const t = post.targets[Math.min(i, post.targets.length - 1)];
  if (!t) return <p className="text-[12.5px] text-ink-3">This post has no accounts yet.</p>;
  const acc = accountById(accounts, t.account_id);
  const name = acc?.handle?.replace(/^@/, '') ?? acc?.display_name ?? networkInfo(t.network).label;
  const text = t.customised && t.text !== null ? t.text : post.base_text;
  const media = t.media && t.media.length ? t.media : post.media;
  return (
    <div className="flex w-full max-w-[340px] min-w-[260px] flex-1 flex-col gap-2">
      {post.targets.length > 1 ? (
        <div role="tablist" aria-label="Preview for" className="flex flex-wrap gap-1">
          {post.targets.map((x, n) => (
            <button key={x.id} type="button" role="tab" aria-selected={n === i} onClick={() => setI(n)} className={cx('inline-flex h-7 items-center gap-1.5 rounded-[7px] border px-2 text-[12px] font-semibold', n === i ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2 hover:bg-subtle')}>
              <NetChip network={x.network} size={16} />
              {accountById(accounts, x.account_id)?.display_name ?? networkInfo(x.network).label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <NetChip network={t.network} size={24} />
          <span className="truncate text-[13px] font-semibold text-ink">{name}</span>
          {t.customised ? <span className="ml-auto text-[11px] text-ink-3">Customised</span> : null}
        </div>
        {media[0] ? <MediaTile media={media[0]} className="aspect-[4/5] w-full rounded-none" /> : null}
        {media.length > 1 ? <div className="px-3 pt-1.5 text-[11px] text-ink-3">1 of {media.length}</div> : null}
        <p className="px-3 py-2.5 text-[13px] whitespace-pre-wrap text-ink">
          <span className="font-semibold">{name}</span> {text}
        </p>
      </div>
    </div>
  );
}

function Steps({ steps, submittedBy }: { steps: ApprovalStep[]; submittedBy?: Person | null }) {
  return (
    <ol className="mt-1 flex flex-col gap-2.5" aria-label="Approval steps">
      {steps.map((s) => {
        const sub =
          s.state === 'approved'
            ? `${s.index === 1 && submittedBy && s.decided_by?.id === submittedBy.id ? 'Submitted' : `Approved${s.decided_by ? ` by ${s.decided_by.name}` : ''}`}${s.decided_at ? ` ${shortWhen(s.decided_at)}` : ''}`
            : s.state === 'current'
              ? `Waiting${s.reply_due_at ? ` · reply target ${shortWhen(s.reply_due_at)}` : ''}`
              : s.state === 'changes_requested'
                ? `Changes requested${s.decided_by ? ` by ${s.decided_by.name}` : ''}`
                : s.state === 'rejected'
                  ? `Rejected${s.decided_by ? ` by ${s.decided_by.name}` : ''}`
                  : s.state === 'skipped'
                    ? 'Skipped'
                    : `Opens after step ${s.index - 1}${s.kind === 'external' ? ' · no WorkSuite login needed' : ''}`;
        const circle =
          s.state === 'approved' ? 'bg-success text-white' : s.state === 'current' ? 'bg-primary text-white' : s.state === 'changes_requested' || s.state === 'rejected' ? 'bg-danger text-white' : 'bg-subtle text-ink-3';
        return (
          <li key={s.index} className="flex gap-2.5">
            <span className={cx('inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold', circle)} aria-hidden>
              {s.state === 'approved' ? <Icon name="check" size={13} /> : s.index}
            </span>
            <span className="min-w-0">
              <span className={cx('block text-[13px]', s.state === 'current' ? 'font-bold text-ink' : 'font-semibold text-ink-2')}>{s.label}</span>
              <span className="block text-[11.5px] text-ink-3">{sub}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** "Add a comment" with @mention suggestions from the people on the post (APR-004). */
function MentionBox({ value, onChange, people, onPick }: { value: string; onChange: (v: string) => void; people: Person[]; onPick: (p: Person) => void }) {
  const [caret, setCaret] = useState(0);
  const before = value.slice(0, caret);
  const m = /(?:^|\s)@([\p{L}\p{N}_.]*(?: [\p{L}\p{N}_.]*)?)$/u.exec(before);
  const q = m ? m[1]!.toLowerCase() : null;
  const hits = q === null ? [] : people.filter((p) => p.name.toLowerCase().startsWith(q) || p.name.toLowerCase().includes(q)).slice(0, 5);
  const insert = (p: Person) => {
    const start = before.lastIndexOf('@');
    const next = `${value.slice(0, start)}@${p.name} ${value.slice(caret)}`;
    onChange(next);
    setCaret(start + p.name.length + 2);
    onPick(p);
  };
  return (
    <div className="relative">
      <Field label="Add a comment" hint="Internal — never published. Type @ to mention someone.">
        <textarea
          className={cx(TEXTAREA, 'min-h-[72px]')}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        />
      </Field>
      {hits.length ? (
        <ul role="listbox" aria-label="Mention" className="absolute top-[calc(100%-18px)] left-2 z-10 w-64 rounded-[10px] border border-line bg-surface py-1 shadow-lg">
          {hits.map((p) => (
            <li key={p.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => insert(p)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink hover:bg-subtle focus-visible:bg-subtle">
                <Avatar name={p.name} size={20} />
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RejectModal({ busy, onClose, onReject }: { busy: boolean; onClose: () => void; onReject: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      title="Reject this post"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!reason.trim()} loading={busy} onClick={() => onReject(reason.trim())}>
            Reject
          </Button>
        </>
      }
    >
      <Field label="Reason" hint="The owner sees this. A rejected post is not published; use Request changes if it can be fixed.">
        <textarea className={cx(TEXTAREA, 'min-h-[90px]')} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}
