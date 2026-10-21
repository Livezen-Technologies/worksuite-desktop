import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

/**
 * The Board rail (220px, "Desk board rail"): Home, Meetings and Calendar; the current meeting's agenda, packs,
 * comments and annotations; my approvals and actions; archive, search and Ask AI (FR-DX-12, FR-RPT-02).
 */
export type BoardView = 'home' | 'calendar' | 'agenda' | 'packs' | 'comments' | 'annotations' | 'approvals' | 'actions' | 'archive' | 'search' | 'room' | 'minutes' | 'reader';
export const NATIVE = new Set<string>(['home', 'calendar', 'agenda', 'packs', 'comments', 'annotations', 'approvals', 'actions', 'archive', 'search', 'room', 'minutes', 'reader']);

export function BoardRail({ view, onPick, onWeb, counts, meeting, packsReady }: {
  view: BoardView;
  onPick: (v: BoardView) => void;
  onWeb: (path: string) => void;
  counts: Partial<Record<BoardView, number>>;
  /** The current meeting's title, when one is open. */
  meeting: string | null;
  packsReady: number;
}) {
  const item = (id: BoardView, label: string, icon: string, disabled = false) => {
    const on = view === id || (id === 'agenda' && (view === 'room' || view === 'minutes' || view === 'reader'));
    const n = counts[id];
    return (
      <button key={id} type="button" disabled={disabled} aria-current={on ? 'page' : undefined} onClick={() => onPick(id)}
        className={cx('relative flex h-[32px] shrink-0 items-center gap-[9px] rounded-[7px] pr-2 pl-2.5 text-left disabled:opacity-40', on ? 'bg-[#EEF1FD] font-bold text-[#3B5BDB] dark:bg-selection dark:text-primary' : 'font-medium text-ink-2 hover:bg-subtle')}>
        <Icon name={icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {n ? <span className="shrink-0 text-[11.5px] text-ink-3 tabular-nums">{n}</span> : null}
      </button>
    );
  };
  const head = (label: string) => <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{label}</div>;
  const noMeeting = !meeting;
  return (
    <nav aria-label="Board" className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
      <div className="px-3 pt-3.5 pb-1">
        <div className="text-[14px] font-bold">Board</div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pt-1 pb-2.5 scroll-thin">
        {item('home', 'Home', 'home')}
        {item('calendar', 'Calendar', 'calendar')}
        {head(meeting ? `Current meeting · ${meeting}` : 'Current meeting')}
        {item('agenda', 'Agenda', 'list-ordered', noMeeting)}
        {item('packs', 'Board packs', 'book-open')}
        {item('comments', 'Comments', 'message-circle', noMeeting)}
        {item('annotations', 'Annotations', 'highlighter', noMeeting)}
        {head('To do')}
        {item('approvals', 'Approvals', 'signature')}
        {item('actions', 'My actions', 'list-checks')}
        {head('Find')}
        {item('archive', 'Archive', 'archive')}
        {item('search', 'Search', 'search')}
        <button type="button" onClick={() => onWeb('/board/ai')} title="Opens on the web" className="flex h-[32px] shrink-0 items-center gap-[9px] rounded-[7px] pr-2 pl-2.5 text-left font-medium text-ink-2 hover:bg-subtle">
          <Icon name="sparkles" size={16} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1 truncate">Ask AI</span>
          <Icon name="external" size={12} className="shrink-0 text-ink-3" />
        </button>
      </div>
      <div className="flex items-center gap-1.5 border-t border-line px-3 py-2 text-[11.5px] text-ink-3">
        <span className={cx('h-2 w-2 rounded-full', packsReady ? 'bg-success' : 'bg-line')} aria-hidden />
        {packsReady} {packsReady === 1 ? 'pack' : 'packs'} ready offline
      </div>
    </nav>
  );
}
