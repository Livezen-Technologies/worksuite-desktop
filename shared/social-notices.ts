/**
 * Social Media Manager's native notification buttons (WS-SMM-SRS-001 SMM-DSK-002, SMM-NTF-001, WF-17, AC-16).
 *
 * A banner about a post, an approval or an inbox thread offers the one or two things a person does next: View post,
 * Approve, Reply, and for a manual reminder Copy caption. Every button but Copy only opens the screen — nothing is
 * approved, published or sent from a banner: a person decides with the full preview in front of them (C6). Copy puts
 * the caption the server sent with the reminder on the clipboard, so it can be pasted into the network's own app.
 *
 * Events (the server's `event` / `event_key`): social.post.approval_requested · approved · changes_requested ·
 * rejected · published · failed · held · reminder_due · missed, social.account.expiring · expired,
 * social.inbox.assigned · at_risk, social.report.ready.
 */

export type SocialButton = { label: string; link: string } | { label: string; copy: string };

export interface SocialNotice {
  buttons: SocialButton[];
}

const ROUTE = /^\/social-media\/(posts|approvals|inbox)\/(\d{1,12})(?:[/?#]|$)/;

/** The caption a reminder carries for copying: `actions: [{ copy: "…" }]`, at most a long post's worth. */
function captionOf(actions: unknown): string | null {
  if (!Array.isArray(actions)) return null;
  for (const a of actions) {
    if (a && typeof a === 'object' && typeof (a as { copy?: unknown }).copy === 'string') {
      const t = (a as { copy: string }).copy.trim();
      if (t) return t.slice(0, 64_000);
    }
  }
  return null;
}

export function socialNoticeActions(event: string | null | undefined, link: string | null | undefined, actions?: unknown): SocialNotice | null {
  if (!event || !event.startsWith('social.')) return null;
  const m = ROUTE.exec(link ?? '');
  if (!m) return null;
  const [, kind, id] = m;
  if (kind === 'inbox') return { buttons: [{ label: 'Reply', link: `/social-media/inbox/${id}` }] };
  const post = `/social-media/posts/${id}`;
  if (event === 'social.post.approval_requested') return { buttons: [{ label: 'View post', link: post }, { label: 'Approve', link: `/social-media/approvals/${id}` }] };
  if (event === 'social.post.changes_requested') return { buttons: [{ label: 'Edit post', link: post }] };
  if (event === 'social.post.reminder_due') {
    const caption = captionOf(actions);
    return { buttons: caption ? [{ label: 'Copy caption', copy: caption }, { label: 'Mark as posted', link: post }] : [{ label: 'Mark as posted', link: post }] };
  }
  return { buttons: [{ label: 'View post', link: post }] };
}
