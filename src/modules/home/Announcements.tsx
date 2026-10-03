import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { sanitizeHtml } from '../../core/rich';
import { relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Button, Chip, Modal, Spinner, cx } from '../../components/ui';

/**
 * Announcements sent to you (worksuite-desktop#98, #104): the Home widget, the
 * one opened from it or from a notification, and all of them. The server sends
 * only what you are among the audience of, still published and not expired —
 * withdrawn ones disappear — so what is shown here is what you may read. An
 * edit, withdrawal or expiry elsewhere reaches this list as the realtime
 * `hr.announcement.changed` (core/query.ts), and one whose expiry passes while
 * it is on screen leaves without waiting for that.
 */
export interface MyAnnouncement {
  id: number;
  title: string;
  preview: string | null;
  category?: string | null;
  priority: 'normal' | 'important' | 'urgent';
  pinned: boolean;
  requires_ack: boolean;
  published_at: string | null;
  expires_at: string | null;
  link?: string | null;
  link_label?: string | null;
  read: boolean;
  acknowledged: boolean;
  company: string | null;
  /** Newer servers: who wrote it, and every company it went to. */
  author?: string | null;
  companies?: Array<{ id: number; name: string }>;
  company_ids?: number[];
}

interface Full extends MyAnnouncement {
  body: string;
}

export const MY_ANNOUNCEMENTS = ['announcements', 'mine'] as const;

/** Urgent ones, then pinned ones, then important, then the rest. */
const rank = (a: MyAnnouncement) => (a.priority === 'urgent' ? 0 : a.pinned ? 1 : a.priority === 'important' ? 2 : 3);

/** Urgent and pinned first (an urgent pinned one before an urgent one), then the newest. */
export function ranked(items: MyAnnouncement[]): MyAnnouncement[] {
  return [...items].sort((a, b) => rank(a) - rank(b) || Number(b.pinned) - Number(a.pinned) || (b.published_at ?? '').localeCompare(a.published_at ?? ''));
}

/** Not past its expiry (server times are UTC): one that lapses while Home is open leaves at once. */
export function current(items: MyAnnouncement[], now = Date.now()): MyAnnouncement[] {
  return items.filter((a) => !a.expires_at || Date.parse(`${a.expires_at.replace(' ', 'T')}Z`) > now);
}

/** Those for the company chosen in the header; all of them when it is "All organizations". */
export function forCompany(items: MyAnnouncement[], orgId: string | string[] | null): MyAnnouncement[] {
  const ids = orgId === null ? [] : Array.isArray(orgId) ? orgId : [orgId];
  if (!ids.length) return items;
  return items.filter((a) => !a.companies?.length || a.companies.some((c) => ids.includes(String(c.id))));
}

export function useMyAnnouncements(enabled = true) {
  return useQuery({
    queryKey: MY_ANNOUNCEMENTS,
    queryFn: ({ signal }) => apiGet<{ items: MyAnnouncement[] }>('/api/hr/announcements/mine', undefined, signal).then((r) => r.items ?? []),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

/** Still waiting for your acknowledgement — what Waiting for Me counts. */
export function toAcknowledge(items: MyAnnouncement[]): MyAnnouncement[] {
  return items.filter((a) => a.requires_ack && !a.acknowledged);
}

const TONE = { urgent: 'danger', important: 'warning', normal: 'muted' } as const;

export function PriorityChip({ a }: { a: Pick<MyAnnouncement, 'priority' | 'pinned'> }) {
  return (
    <>
      {a.priority === 'urgent' || a.priority === 'important' ? <Chip tone={TONE[a.priority]}>{a.priority === 'urgent' ? 'Urgent' : 'Important'}</Chip> : null}
      {a.pinned ? <Chip tone="indigo">Pinned</Chip> : null}
    </>
  );
}

/** "3 companies", in the reader's language. */
const companiesCount = (n: number) => text('{n} companies', { n });

function byline(a: MyAnnouncement): string {
  return [a.author, a.published_at ? relative(a.published_at) : null, a.companies && a.companies.length > 1 ? companiesCount(a.companies.length) : a.company].filter(Boolean).join(' · ');
}

export function useAcknowledge() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<number | null>(null);
  const acknowledge = async (id: number) => {
    setBusy(id);
    try {
      await apiPost(`/api/hr/announcements/mine/${id}/ack`, {});
      toast('success', text('Acknowledged.'));
      void qc.invalidateQueries({ queryKey: MY_ANNOUNCEMENTS });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return { acknowledge, busy };
}

/** Whom it went to, as the card's small heading: the company, or how many. */
function audience(a: MyAnnouncement): string | null {
  return a.companies && a.companies.length > 1 ? companiesCount(a.companies.length) : (a.company ?? a.companies?.[0]?.name ?? null);
}

/** The cards of the Home widget (optimized): up to five, the ones to acknowledge with their button. */
export function AnnouncementRows({ items, onOpen, limit = 5 }: { items: MyAnnouncement[]; onOpen: (id: number) => void; limit?: number }) {
  const { acknowledge, busy } = useAcknowledge();
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.slice(0, limit).map((a) => (
        <li key={a.id} className={cx('flex flex-col gap-2 rounded-[10px] border border-line bg-well p-3', a.priority === 'urgent' && 'border-danger/40')}>
          <button type="button" onClick={() => onOpen(a.id)} className="flex min-w-0 flex-col gap-1.5 text-left">
            <span className="flex min-w-0 items-center justify-between gap-2">
              <span className="truncate text-[11px] font-semibold tracking-[0.04em] text-teal uppercase">{audience(a)}</span>
              <span className="shrink-0 text-[12px] text-ink-3">{[a.author, a.published_at ? relative(a.published_at) : null].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              {!a.read ? <span aria-label="Unread" className="h-2 w-2 shrink-0 rounded-full bg-primary" /> : null}
              <b className="truncate text-[14px] font-semibold text-ink">{a.title}</b>
              <PriorityChip a={a} />
            </span>
            {a.preview ? <span className="line-clamp-2 text-[13px] leading-[1.45] text-ink-2">{a.preview}</span> : null}
          </button>
          {a.requires_ack && !a.acknowledged ? (
            <Button size="sm" variant="primary" className="self-start" loading={busy === a.id} onClick={() => void acknowledge(a.id)}>
              Acknowledge
            </Button>
          ) : a.requires_ack ? (
            <Chip tone="success" className="self-start">
              Acknowledged
            </Chip>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** One announcement, opened: read, marked read, acknowledged here. A withdrawn or expired one says so. */
export function AnnouncementReader({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...MY_ANNOUNCEMENTS, id], queryFn: ({ signal }) => apiGet<Full>(`/api/hr/announcements/mine/${id}`, undefined, signal), retry: false });
  const { acknowledge, busy } = useAcknowledge();
  const a = q.data;
  useEffect(() => {
    if (a && !a.read) void apiPost(`/api/hr/announcements/mine/${id}/read`, {}).then(() => qc.invalidateQueries({ queryKey: MY_ANNOUNCEMENTS }), () => undefined);
  }, [a, id, qc]);
  return (
    <Modal
      title={a?.title ?? 'Announcement'}
      onClose={onClose}
      width={620}
      footer={
        <>
          <span className="flex-1" />
          {a?.requires_ack && !a.acknowledged ? (
            <Button variant="primary" loading={busy === id} onClick={() => void acknowledge(id).then(() => q.refetch())}>
              Acknowledge
            </Button>
          ) : null}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <p className="text-[13px] text-ink-2">This announcement is no longer available. It may have been withdrawn or expired, or it was not sent to you.</p>
      ) : a ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-3">
            <PriorityChip a={{ priority: a.priority, pinned: !!a.pinned }} />
            <span>{byline(a)}</span>
            {a.requires_ack && a.acknowledged ? <Chip tone="success">Acknowledged</Chip> : null}
          </div>
          <div className="rich-text text-[13.5px] leading-relaxed text-ink" dangerouslySetInnerHTML={{ __html: sanitizeHtml(a.body, { profile: 'rich' }) }} />
        </div>
      ) : null}
    </Modal>
  );
}

/** Every announcement sent to you ("See all"). */
export function AllAnnouncements({ items, onOpen, onClose }: { items: MyAnnouncement[]; onOpen: (id: number) => void; onClose: () => void }) {
  return (
    <Modal title="Announcements" onClose={onClose} width={640}>
      {items.length ? <AnnouncementRows items={ranked(items)} onOpen={onOpen} limit={200} /> : <p className="text-[13px] text-ink-3">No announcements.</p>}
    </Modal>
  );
}
