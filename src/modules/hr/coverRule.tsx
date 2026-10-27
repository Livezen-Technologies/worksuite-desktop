import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { ApiError, apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { createStore, useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { cx } from '../../components/ui';
import type { LeaveDecided, LeaveReview } from './api';
import { btn, btnPrimary, Sheet } from '../../components/PageKit';

/**
 * Approving leave before the cover has said yes (worksuite-desktop#262, #263): one rule for every Approve — the
 * review panel, the Leave list, Waiting on me and Home. Approve still works, but first asks "<Name> hasn't accepted
 * cover yet. Approve anyway?", with Remind and Open request beside it; the cover person approving their own cover
 * gets "Accept cover & approve". Where the organisation needs the cover to accept first — said by the review
 * (`cover_first`), or by the server refusing — Approve becomes a disabled "Waiting for cover" saying why. A refusal
 * is never a red toast.
 *
 * "Approve anyway" sends `approve_without_cover: true` with the decision. A server that knows it approves; one
 * that does not refuses as before, and from then on that request shows "Waiting for cover".
 */

export interface Cover {
  userId: number;
  name: string;
  status: 'pending' | 'accepted' | 'declined';
  note: string | null;
  /** The person signed in is the one asked to cover. */
  mine: boolean;
  /** The server lets the approver nudge them, or name somebody else (newer servers only). */
  canRemind: boolean;
  canChange: boolean;
}

export function coverOf(v: Pick<LeaveReview, 'responsible'> | null | undefined, me: string | number | null | undefined): Cover | null {
  const r = v?.responsible;
  if (!r) return null;
  return {
    userId: Number(r.user_id),
    name: r.name || 'The cover',
    status: r.status === 'accepted' || r.status === 'declined' ? r.status : 'pending',
    note: r.note ?? null,
    mine: me !== null && me !== undefined && String(r.user_id) === String(me),
    canRemind: r.can_remind === true,
    canChange: r.can_change === true,
  };
}

/** The leave review, one cache for the panel and every Approve that asks it about the cover first. */
export function leaveReview(id: number) {
  return { queryKey: ['hr', 'leave-review', id] as const, queryFn: ({ signal }: { signal?: AbortSignal }) => apiGet<LeaveReview>(`/api/hr/leave/requests/${id}/review`, undefined, signal) };
}

const fetchReview = (qc: QueryClient, id: number) => qc.fetchQuery({ ...leaveReview(id), staleTime: 15_000 });

/** The server saying no because the cover has not accepted ("The person responsible for cover has not accepted this yet."). */
export function isCoverRefusal(e: unknown): boolean {
  return e instanceof ApiError && !e.offline && !e.forbidden && (e.code === 'COVER_NOT_ACCEPTED' || (e.status >= 400 && e.status < 500 && /\bcover\b/i.test(e.message)));
}

/** Requests the server refused to approve before their cover accepted: they wait for the cover from then on. */
const refused = createStore<{ ids: number[] }>({ ids: [] });

function learn(id: number): void {
  if (!refused.get().ids.includes(id)) refused.set((s) => ({ ids: [...s.ids, id] }));
}

/** For tests: forget what the server refused. */
export function resetCoverRule(): void {
  refused.set({ ids: [] });
}

/** This request may not be approved until the cover accepts: the organisation's setting, or the server said so. */
export function useCoverFirst(id: number, v?: Pick<LeaveReview, 'cover_first'> | null): boolean {
  const ids = useStore(refused, (s) => s.ids);
  return v?.cover_first === true || (v?.cover_first !== false && ids.includes(id));
}

/** Approve's place while the cover has not accepted and the organisation needs that first. */
export function WaitingForCover({ name, className }: { name?: string | null; className?: string }) {
  const why = `${name ? `${name} hasn’t accepted cover yet.` : 'The colleague asked to cover hasn’t accepted yet.'} Your organisation needs the cover to accept before leave is approved.`;
  return (
    <button
      type="button"
      aria-disabled="true"
      title={why}
      aria-label={`Waiting for cover. ${why}`}
      onClick={(e) => e.preventDefault()}
      className={cx('inline-flex h-[34px] shrink-0 cursor-not-allowed items-center gap-1.5 rounded-[8px] border border-warning-line bg-warning-bg px-3 text-[13px] font-semibold whitespace-nowrap text-warning-ink dark:border-warning/30 dark:bg-warning-bg dark:text-warning', className)}
    >
      Waiting for cover
    </button>
  );
}

interface Asking {
  id: number;
  cover: Cover | null;
  note: string;
  blocked: boolean;
}

/**
 * Approve with the cover rule. `approve(id)` asks the review about the cover unless told (`cover`: the list row's
 * `responsible_status`, or `'none'`); `dialog` is the question, to render beside the button; `onOpen` adds "Open
 * request" to it.
 */
export function useApproveLeave({ onApproved, onOpen }: { onApproved?: (id: number, r: LeaveDecided) => void; onOpen?: (id: number) => void } = {}) {
  const qc = useQueryClient();
  const me = useStore(app, (s) => s.auth?.user?.id);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const review = (id: number, known?: LeaveReview | null) => (known ? Promise.resolve(known) : fetchReview(qc, id).catch(() => null));

  const send = async (id: number, note: string, anyway: boolean, known?: LeaveReview | null): Promise<void> => {
    setBusy(id);
    try {
      const r = await apiPost<LeaveDecided | null>(`/api/hr/leave/requests/${id}/decide`, { decision: 'approved', ...(note ? { note } : {}), ...(anyway ? { approve_without_cover: true } : {}) });
      setAsking(null);
      toast('success', 'Approved.');
      void qc.invalidateQueries({ queryKey: ['hr'] });
      onApproved?.(id, r ?? {});
    } catch (e) {
      if (!isCoverRefusal(e)) {
        toast('error', errorMessage(e));
        return;
      }
      // Not an error: the organisation wants the cover first. Say so where the question is, and keep it shown.
      learn(id);
      const v = await review(id, known);
      setAsking({ id, cover: coverOf(v, me), note, blocked: true });
    } finally {
      setBusy(null);
    }
  };

  const approve = async (id: number, opts: { note?: string; review?: LeaveReview | null; cover?: string | null } = {}): Promise<void> => {
    const note = opts.note?.trim() ?? '';
    if (opts.cover === 'none' || opts.cover === 'accepted') return send(id, note, false, opts.review);
    setBusy(id);
    const v = await review(id, opts.review);
    setBusy(null);
    const cover = coverOf(v, me);
    if (!cover || cover.status === 'accepted') return send(id, note, false, v);
    setAsking({ id, cover, note, blocked: v?.cover_first === true || (v?.cover_first !== false && refused.get().ids.includes(id)) });
  };

  const acceptAndApprove = async (a: Asking) => {
    setBusy(a.id);
    try {
      await apiPost(`/api/hr/leave/requests/${a.id}/cover`, { answer: 'accepted' });
    } catch (e) {
      setBusy(null);
      toast('error', errorMessage(e));
      return;
    }
    await send(a.id, a.note, false);
  };

  const remind = async (a: Asking) => {
    setBusy(a.id);
    try {
      await apiPost(`/api/hr/leave/requests/${a.id}/cover/remind`, {});
      toast('success', `Reminded ${a.cover?.name ?? 'the cover'}.`);
      setAsking(null);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const dialog = asking ? (
    <CoverQuestion
      a={asking}
      busy={busy === asking.id}
      onAnyway={() => void send(asking.id, asking.note, true)}
      onAcceptAndApprove={() => void acceptAndApprove(asking)}
      onRemind={() => void remind(asking)}
      onOpen={onOpen ? () => (setAsking(null), onOpen(asking.id)) : undefined}
      onClose={() => setAsking(null)}
    />
  ) : null;
  return { approve, busy, dialog };
}

function CoverQuestion({ a, busy, onAnyway, onAcceptAndApprove, onRemind, onOpen, onClose }: { a: Asking; busy: boolean; onAnyway: () => void; onAcceptAndApprove: () => void; onRemind: () => void; onOpen?: () => void; onClose: () => void }) {
  const c = a.cover;
  const state = !c ? 'The colleague asked to cover hasn’t accepted yet.' : c.mine ? 'You haven’t accepted cover for this yet.' : c.status === 'declined' ? `${c.name} declined to cover this${c.note ? `: “${c.note}”` : ''}.` : `${c.name} hasn’t accepted cover yet.`;
  return (
    <Sheet
      title={a.blocked ? 'Waiting for cover' : 'Approve before cover?'}
      width={440}
      onClose={onClose}
      footer={
        <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-2">
          <button type="button" className={btn} onClick={onClose}>
            {a.blocked ? 'Close' : 'Cancel'}
          </button>
          {onOpen ? (
            <button type="button" className={btn} onClick={onOpen}>
              Open request
            </button>
          ) : null}
          {c?.canRemind && !c.mine ? (
            <button type="button" disabled={busy} className={btn} onClick={onRemind}>
              Remind {c.name}
            </button>
          ) : null}
          {c?.mine && c.status === 'pending' ? (
            <button type="button" disabled={busy} className={btnPrimary + ' !bg-success hover:!bg-success'} onClick={onAcceptAndApprove}>
              Accept cover & approve
            </button>
          ) : null}
          {!a.blocked ? (
            <button type="button" disabled={busy} className={btnPrimary + ' !bg-success hover:!bg-success'} onClick={onAnyway}>
              Approve anyway
            </button>
          ) : null}
        </div>
      }
    >
      <p className="m-0 text-[13px] text-ink">
        {state} {a.blocked ? 'Your organisation needs the cover to accept before leave is approved.' : 'Approve anyway?'}
      </p>
    </Sheet>
  );
}
