import { timeLabel } from '../../../core/time';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';
import { describeCard } from '../../calls/log';
import { answerCall, startCall } from '../../calls/start';
import { openMeeting } from '../../meet/api';
import { MeetingCard } from '../MeetingCard';
import type { ChatMessage } from '../types';

/** A call's card in the thread (ChatDrawer: "Missed voice call · Call back"). Moved here from Thread with the kit (#229). */
export function CallCard({ m, own, roomId, compact }: { m: ChatMessage; own: boolean; roomId: string; compact?: boolean }) {
  // A Meet meeting has a card of its own: its name, who started it, live or ended, and one action (worksuite-desktop#71).
  if (m.call_kind === 'meeting') return <MeetingCard m={m} own={own} roomId={roomId} compact={compact} />;
  return <NativeCallCard m={m} own={own} roomId={roomId} compact={compact} />;
}

function NativeCallCard({ m, own, roomId, compact }: { m: ChatMessage; own: boolean; roomId: string; compact?: boolean }) {
  const d = describeCard(m, own);
  const video = m.call_mode === 'video' || m.call_kind === 'meeting';
  const act = () => {
    if (d.action === 'Join') {
      if (m.call_kind === 'meeting') void openMeeting(m.call_uuid!);
      else void answerCall(m.call_uuid!, roomId, false, m.sender_name);
    } else if (d.action) void startCall(roomId, video ? 'video' : 'audio', m.sender_name);
  };
  if (compact) {
    return (
      <div className={cx('mt-2.5 flex', own ? 'justify-end' : 'justify-start')}>
        <div className="flex items-center gap-2 rounded-full bg-surface py-1.5 pr-1.5 pl-1.5 shadow-[0_1px_2px_rgb(var(--ws-shadow-rgb)/.12)]">
          <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full', d.tone === 'missed' ? 'bg-danger-bg text-danger' : d.tone === 'live' ? 'bg-success-bg text-success' : 'bg-selection text-primary')}>
            <Icon name={video ? 'video' : 'phone'} size={14} />
          </span>
          <b className={cx('text-[12.5px]', d.tone === 'missed' ? 'text-danger' : 'text-ink')}>{d.title}</b>
          <span className="text-[12px] text-ink-3">
            {timeLabel(m.created_at)}
            {d.detail ? ` · ${d.detail}` : ''}
          </span>
          {d.action ? <CallAction action={d.action} video={video} onClick={act} /> : null}
        </div>
      </div>
    );
  }
  return (
    <div className={cx('mt-3 flex', own ? 'justify-end' : 'justify-start')}>
      <div className={cx('flex items-center gap-2.5 rounded-[12px] border px-3 py-2.5', d.tone === 'missed' ? 'border-[#F1B8A8] bg-surface dark:border-danger/40' : d.tone === 'live' ? 'border-[#9EE6C3] bg-surface' : 'border-line bg-surface')}>
        <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', d.tone === 'missed' ? 'bg-danger-bg text-danger' : d.tone === 'live' ? 'bg-success-bg text-success' : 'bg-selection text-primary')}>
          <Icon name={video ? 'video' : 'phone'} size={15} />
        </span>
        <span className="flex min-w-0 flex-col">
          <b className={cx('text-[13px]', d.tone === 'missed' ? 'text-danger' : 'text-ink')}>{d.title}</b>
          <span className="text-[12px] text-ink-3">
            {timeLabel(m.created_at)}
            {d.detail ? ` · ${d.detail}` : ''}
          </span>
        </span>
        {d.action ? <CallAction action={d.action} video={video} onClick={act} className="ml-1" /> : null}
      </div>
    </div>
  );
}

/**
 * Join, Call back or Call again (#431): a filled button with the call's icon, so it reads as the thing to press.
 * Call back was pale green text on pale green in the drawer and a bare outline in the thread, and looked like a label.
 */
export function CallAction({ action, video, onClick, className }: { action: 'Join' | 'Call back' | 'Call again'; video: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={action === 'Join' ? 'Join the call' : `${action} with a ${video ? 'video' : 'voice'} call`}
      className={cx(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold text-white shadow-[0_1px_2px_rgb(var(--ws-shadow-rgb)/.18)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        action === 'Join' ? 'bg-success hover:brightness-95' : 'bg-primary hover:bg-primary-hover',
        className,
      )}
    >
      <Icon name={video ? 'video' : 'phone'} size={13} />
      {action}
    </button>
  );
}
