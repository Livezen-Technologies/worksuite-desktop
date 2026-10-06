import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Modal } from '../../../../components/ui';
import { errorMessage } from '../../../../core/bridge';
import { toast } from '../../../../core/toasts';
import { SK, socialApi, useInvalidate, useReviewLinks, type ReviewLink } from '../../api';
import { Check, ConfirmButton, Field, INPUT, Notice, OptionalView } from '../../parts';
import { minutesUntil, whenLabel } from '../../lib/time';

/**
 * W05 "Share for review" (WF-14, SMM-APR-005, AC-14): an expiring link a client opens without a WorkSuite login. The
 * server keeps only a hash of the token, so the address and the access code are shown once, here, after creating it.
 * Existing links list with their expiry and can be revoked.
 */
export function ShareForReview({ postId, onClose }: { postId: number; onClose: () => void }) {
  const invalidate = useInvalidate();
  const linksQ = useReviewLinks(postId);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [days, setDays] = useState('7');
  const [code, setCode] = useState(false);
  const [made, setMade] = useState<ReviewLink | null>(null);
  const [now] = useState(() => Date.now());

  const create = useMutation({
    mutationFn: () => socialApi.createReviewLink(postId, { reviewer_name: name.trim() || undefined, reviewer_email: email.trim() || undefined, expires_in_days: Math.max(1, Math.min(90, Number(days) || 7)), access_code: code }),
    onSuccess: (r) => {
      setMade(r.link);
      invalidate(SK.reviewLinks(postId));
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (linkId: number) => socialApi.revokeReviewLink(postId, linkId),
    onSuccess: () => {
      toast('success', 'Review link revoked');
      invalidate(SK.reviewLinks(postId));
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const copy = (url: string) => {
    void navigator.clipboard?.writeText(url).then(
      () => toast('success', 'Link copied'),
      () => toast('error', 'Could not copy the link'),
    );
  };

  return (
    <Modal
      title="Share for review"
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" icon="link" loading={create.isPending} onClick={() => create.mutate()}>
            Create link
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-ink-3">The reviewer sees this post’s previews and comments only — no account, library or other posts — and can approve or ask for changes without a WorkSuite login.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Reviewer name">
            <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CreativeFX" />
          </Field>
          <Field label="Reviewer email">
            <input className={INPUT} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@client.com" />
          </Field>
          <Field label="Expires after (days)">
            <input className={INPUT} type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
          <div className="flex items-end pb-2">
            <Check checked={code} onChange={setCode}>
              Require an access code
            </Check>
          </div>
        </div>

        {made ? (
          <Notice tone="success" icon="check-circle">
            <span className="block font-semibold">Link created — copy it now; it is not shown again.</span>
            <span className="mt-1 flex min-w-0 items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-[6px] bg-surface px-2 py-1 font-mono text-[12px]">{made.url}</code>
              <Button size="sm" icon="copy" onClick={() => copy(made.url)}>
                Copy
              </Button>
            </span>
            {made.access_code ? (
              <span className="mt-1 block">
                Access code: <span className="font-mono font-bold tracking-wider">{made.access_code}</span>
              </span>
            ) : null}
          </Notice>
        ) : null}

        <div>
          <h3 className="mb-2 text-[13px] font-bold text-ink">Links for this post</h3>
          <OptionalView q={linksQ} what="Review links" compact>
            {(links) =>
              links.length === 0 ? (
                <p className="text-[12.5px] text-ink-3">No review links yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line rounded-[10px] border border-line">
                  {links.map((l) => {
                    const left = minutesUntil(l.expires_at, now);
                    const state = l.revoked_at ? 'Revoked' : left !== null && left <= 0 ? 'Expired' : `Expires ${whenLabel(l.expires_at)}`;
                    const live = !l.revoked_at && (left === null || left > 0);
                    return (
                      <li key={l.id} className="flex items-center gap-3 px-3 py-2.5">
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[13px] font-semibold text-ink">{l.reviewer_name || l.reviewer_email || 'Anyone with the link'}</span>
                          <span className="truncate text-[11.5px] text-ink-3">
                            {state}
                            {l.last_used_at ? ` · opened ${whenLabel(l.last_used_at)}` : ' · not opened yet'}
                          </span>
                        </span>
                        {live ? <ConfirmButton size="sm" variant="secondary" label="Revoke" confirm="Revoke link" loading={revoke.isPending && revoke.variables === l.id} onConfirm={() => revoke.mutate(l.id)} /> : null}
                      </li>
                    );
                  })}
                </ul>
              )
            }
          </OptionalView>
        </div>
      </div>
    </Modal>
  );
}
