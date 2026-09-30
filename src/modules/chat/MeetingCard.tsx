import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ActiveCall } from '@shared/types';
import { apiGet } from '../../core/api';
import { call, errorMessage, on } from '../../core/bridge';
import { timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Modal, Spinner, cx } from '../../components/ui';
import { openMeeting } from '../meet/api';
import { lengthLabel } from '../meet/home';
import { useMeetT } from '../meet/i18n';
import type { ChatMessage } from './types';

/** The meetings this computer is in now (their windows), kept current. */
export function useActiveMeetings(): Set<string> {
  const [list, setList] = useState<ActiveCall[]>([]);
  useEffect(() => {
    let alive = true;
    void call('calls:list').then((l) => alive && Array.isArray(l) && setList(l), () => undefined);
    const off = on<ActiveCall[]>('calls:changed', (l) => setList(Array.isArray(l) ? l : []));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return new Set(list.filter((c) => c.kind === 'meet' && c.uuid).map((c) => c.uuid!));
}

/** A meeting card's state and its one action. */
export function meetingCardState(m: Pick<ChatMessage, 'call_state'>, inIt: boolean): { status: 'live' | 'ended' | 'removed'; action: 'return' | 'join' | 'details' | null } {
  if (m.call_state === 'gone') return { status: 'removed', action: null };
  if (m.call_state === 'live') return { status: 'live', action: inIt ? 'return' : 'join' };
  return { status: 'ended', action: 'details' };
}

interface RoomCall {
  uuid: string;
  kind: string;
  created_at: string;
  duration: number | null;
  participants: Array<string | { name?: string }>;
  recording: { id: number; title: string; ready: boolean } | null;
}

/**
 * A Meet meeting in a conversation (worksuite-desktop#71): its name, who started it and when, whether it is live
 * or ended, and one action — Join, Return to meeting when this computer is already in it, or View details once it
 * has ended. Compact in the chat drawer; a long name is cut short with the whole of it on hover.
 */
export function MeetingCard({ m, own, roomId, compact }: { m: ChatMessage; own: boolean; roomId: string; compact?: boolean }) {
  const t = useMeetT();
  const active = useActiveMeetings();
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  const { status, action } = meetingCardState(m, !!m.call_uuid && active.has(m.call_uuid));
  const title = m.call_title?.trim() || t('card.meeting');
  const by = own ? t('card.startedByYou') : t('card.startedBy', { name: m.sender_name });
  const when = timeLabel(m.call_started_at ?? m.created_at);
  const go = async () => {
    if (!m.call_uuid) return;
    setBusy(true);
    try {
      await openMeeting(m.call_uuid, title);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const button = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 disabled:opacity-70';

  return (
    <div className={cx('flex', compact ? 'mt-2.5' : 'mt-3', own ? 'justify-end' : 'justify-start')}>
      <article
        aria-label={`${title} — ${status === 'live' ? t('card.live') : status === 'ended' ? t('card.ended') : t('card.removed')}`}
        className={cx('flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border bg-surface', compact ? 'max-w-[340px] px-2.5 py-2' : 'max-w-[440px] px-3 py-2.5', status === 'live' ? 'border-success/40' : 'border-line')}
      >
        <span aria-hidden className={cx('flex shrink-0 items-center justify-center rounded-[10px]', compact ? 'h-8 w-8' : 'h-9 w-9', status === 'live' ? 'bg-success-bg text-success' : status === 'removed' ? 'bg-subtle text-ink-3' : 'bg-selection text-primary')}>
          <Icon name="video" size={compact ? 15 : 17} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <b title={title} className={cx('min-w-0 truncate text-ink', compact ? 'text-[13px]' : 'text-[13.5px]')}>{title}</b>
            <StatusBadge status={status} />
          </span>
          <span className="truncate text-[12px] text-ink-3">
            {by} · {when}
          </span>
        </span>
        {action === 'join' || action === 'return' ? (
          <button type="button" onClick={() => void go()} disabled={busy} aria-busy={busy} className={cx(button, 'bg-primary text-white hover:bg-primary-hover')}>
            {busy ? <Icon name="spinner" size={13} className="animate-spin" /> : action === 'return' ? <Icon name="back" size={13} /> : null}
            {busy ? t('card.joining') : action === 'return' ? t('card.return') : t('card.join')}
          </button>
        ) : action === 'details' ? (
          <button type="button" onClick={() => setDetails(true)} className={cx(button, 'border border-line text-ink hover:bg-subtle')}>
            {t('card.details')}
          </button>
        ) : null}
      </article>
      {details && m.call_uuid ? <MeetingDetails uuid={m.call_uuid} roomId={roomId} title={title} startedAt={m.call_started_at ?? m.created_at} onClose={() => setDetails(false)} /> : null}
    </div>
  );
}

function StatusBadge({ status }: { status: 'live' | 'ended' | 'removed' }) {
  const t = useMeetT();
  if (status === 'live') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-bg px-1.5 py-px text-[10.5px] font-bold text-success">
        <span aria-hidden className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
        </span>
        {t('card.live')}
      </span>
    );
  }
  return <span className="shrink-0 rounded-full bg-subtle px-1.5 py-px text-[10.5px] font-bold text-ink-3">{status === 'ended' ? t('card.ended') : t('card.removed')}</span>;
}

/** When it started, how long it ran, who was in it, and whether it was recorded — from the conversation's call history. */
function MeetingDetails({ uuid, roomId, title, startedAt, onClose }: { uuid: string; roomId: string; title: string; startedAt: string; onClose: () => void }) {
  const t = useMeetT();
  const q = useQuery({ queryKey: ['chat', 'room-calls', roomId], queryFn: ({ signal }) => apiGet<RoomCall[]>(`/api/chat/rooms/${roomId}/calls`, undefined, signal) });
  const row = (q.data ?? []).find((c) => c.uuid === uuid);
  const people = (row?.participants ?? []).map((p) => (typeof p === 'string' ? p : (p.name ?? ''))).filter(Boolean);
  const minutes = row?.duration ? Math.round(row.duration / 60) : null;
  const length = minutes !== null && minutes <= 12 * 60 ? lengthLabel(Math.max(1, minutes)) : null;
  const line = (label: string, value: string | null) =>
    value ? (
      <div className="flex gap-3 border-b border-line py-2 last:border-0">
        <span className="w-24 shrink-0 text-ink-3">{label}</span>
        <span className="min-w-0 flex-1 text-ink">{value}</span>
      </div>
    ) : null;
  return (
    <Modal title={t('card.detailsTitle')} onClose={onClose} width={440} footer={<Button onClick={onClose}>{t('card.close')}</Button>}>
      <div className="flex flex-col text-[13px]">
        <b className="pb-2 text-[14.5px] break-words text-ink">{title}</b>
        {q.isLoading ? <Spinner /> : null}
        {q.isSuccess && !row ? <p className="text-ink-3">{t('card.noDetails')}</p> : null}
        {line(t('card.started'), timeLabel(startedAt))}
        {row ? line(t('card.length'), length) : null}
        {row ? line(t('card.people'), people.length ? people.join(', ') : null) : null}
        {row?.recording ? line(t('card.recording'), row.recording.ready ? t('card.recordingReady') : t('card.recordingProcessing')) : null}
      </div>
    </Modal>
  );
}
