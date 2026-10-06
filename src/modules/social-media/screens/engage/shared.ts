import { app } from '../../../../core/app-state';
import { useStore } from '../../../../core/store';
import type { Approval, ApprovalStep, Person, Post } from '../../api';
import { longWhen } from '../../lib/time';

/**
 * Small pieces W05 Approvals and W06 Inbox share: who is signed in (the bootstrap's user, whose id is a string while
 * the module's people carry numbers), approval-step words, and the short date the design writes ("Mon 06 Oct, 12:00").
 */

/** The signed-in user's id as the module numbers people, or null when the bootstrap has none. */
export function useMyId(): number | null {
  const id = useStore(app, (s) => s.bootstrap?.user?.id ?? null);
  const n = id === null ? NaN : Number(id);
  return Number.isFinite(n) ? n : null;
}

export function isMe(p: Pick<Person, 'id'> | null | undefined, me: number | null): boolean {
  return !!p && me !== null && p.id === me;
}

/** "Mon 06 Oct, 12:00" — longWhen without the year. */
export function shortWhen(stamp: string | null | undefined): string {
  return stamp ? longWhen(stamp).replace(/ \d{4},/, ',') : '';
}

export function currentStep(a: Approval | null | undefined): ApprovalStep | undefined {
  if (!a) return undefined;
  return a.steps.find((s) => s.index === a.current_step) ?? a.steps.find((s) => s.state === 'current');
}

/** The caller decides the step the post is on (APR-003). */
export function waitingForMe(p: Post): boolean {
  const a = p.approval;
  return !!a && a.state === 'pending' && (a.can_decide || !!currentStep(a)?.mine);
}

export function sentByMe(p: Post, me: number | null): boolean {
  return isMe(p.approval?.submitted_by ?? p.created_by, me);
}

/** "Step 2 of 3", or null when the post has no multi-step request. */
export function stepOf(a: Approval | null | undefined): string | null {
  if (!a || a.steps.length === 0) return null;
  return `Step ${a.current_step} of ${a.steps.length}`;
}

/** Who asked for changes on a post sent back to draft. */
export function changesBy(a: Approval | null | undefined): string | null {
  const s = a?.steps.find((x) => x.state === 'changes_requested');
  if (!s) return null;
  return s.decided_by?.name ?? s.external_name ?? s.label.split(' — ')[0] ?? null;
}

/** The people someone can @mention on a post (APR-004): its approvers, owner, submitter and commenters, once each. */
export function mentionable(post: Post | null | undefined, commenters: Array<Person | null | undefined>, me: number | null): Person[] {
  const out = new Map<number, Person>();
  const add = (p: Person | null | undefined) => {
    if (p && p.id !== me && !out.has(p.id)) out.set(p.id, p);
  };
  for (const s of post?.approval?.steps ?? []) s.approvers.forEach(add);
  add(post?.owner);
  add(post?.approval?.submitted_by);
  add(post?.created_by);
  commenters.forEach(add);
  return [...out.values()];
}

/** True when the keystroke is meant for a text field, not a page shortcut. */
export function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}
