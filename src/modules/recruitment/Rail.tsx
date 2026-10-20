import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

/**
 * The Recruitment nav (220px, the "Desktop Recruitment nav" design): the desktop's own screens — the pipeline, the
 * review queue and my work — and the rest of Recruitment, which opens on the web.
 */
export type RecView = 'pipe' | 'review' | 'today' | 'cards' | 'appr';
export const NATIVE = new Set<string>(['pipe', 'review', 'today', 'cards', 'appr']);

export interface RailCan { review: boolean; evaluate: boolean; createJob: boolean }

export function RecruitmentRail({ view, onPick, onWeb, counts, can }: {
  view: RecView;
  onPick: (v: RecView) => void;
  /** A part of Recruitment the desktop does not draw: its web page. */
  onWeb: (path: string) => void;
  counts: Partial<Record<RecView, number>>;
  can: RailCan;
}) {
  const item = (id: RecView, label: string, icon: string) => {
    const on = view === id;
    const n = counts[id];
    return (
      <button
        key={id}
        type="button"
        aria-current={on ? 'page' : undefined}
        onClick={() => onPick(id)}
        className={cx('relative flex h-[32px] shrink-0 items-center gap-[9px] rounded-[7px] pr-2 pl-2.5 text-left', on ? 'bg-[#EEF1FD] font-bold text-[#3B5BDB] dark:bg-selection dark:text-primary' : 'font-medium text-ink-2 hover:bg-subtle')}
      >
        <Icon name={icon} size={16} className={cx('shrink-0', on ? 'text-primary' : 'text-ink-3')} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {n ? <span className="shrink-0 text-[11.5px] text-ink-3 tabular-nums">{n}</span> : null}
      </button>
    );
  };
  const web = (label: string, path: string, icon: string) => (
    <button key={path} type="button" onClick={() => onWeb(path)} title="Opens on the web" className="flex h-[32px] shrink-0 items-center gap-[9px] rounded-[7px] pr-2 pl-2.5 text-left font-medium text-ink-2 hover:bg-subtle">
      <Icon name={icon} size={16} className="shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Icon name="external" size={12} className="shrink-0 text-ink-3" />
    </button>
  );
  const head = (label: string) => <div className="mt-3 mb-0.5 px-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">{label}</div>;

  return (
    <nav aria-label="Recruitment" className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-[#FBFBFD] text-[13px] text-ink dark:bg-surface">
      {can.createJob ? (
        <div className="px-2.5 pt-3.5 pb-1">
          <button type="button" onClick={() => onWeb('/recruitment/jobs/new')} className="flex h-[34px] w-full items-center justify-center gap-1.5 rounded-[8px] bg-primary text-[13px] font-bold text-white hover:bg-primary-hover">
            <Icon name="plus" size={15} /> New job
          </button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pt-2 pb-2.5 scroll-thin">
        {web('Dashboard', '/recruitment', 'grid')}
        {item('pipe', 'Pipeline', 'kanban')}
        {can.review ? item('review', 'Review queue', 'inbox') : null}
        {head('My work')}
        {item('today', 'Interviews today', 'calendar-clock')}
        {can.evaluate ? item('cards', 'Scorecards', 'list-checks') : null}
        {item('appr', 'Approvals', 'check-check')}
        {head('Jobs')}
        {web('Open vacancies', '/recruitment/jobs', 'briefcase')}
        {web('Requisitions', '/recruitment/requisitions', 'file-text')}
        {head('Other')}
        {web('Offers', '/recruitment/offers', 'handshake')}
        {web('Talent pool', '/recruitment/talent-pools', 'users')}
        {web('Reports', '/recruitment/reports', 'chart')}
      </div>
    </nav>
  );
}
