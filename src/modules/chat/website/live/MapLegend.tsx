import { cx } from '../../../../components/ui';
import { text } from '../../../../core/i18n';
import { LEGEND, STATE } from './liveMap';
import type { MapTheme } from './WorldMapView';

/** What the colours and shapes mean (C-00): the five states as rings, then a city marker and a country-only ring. */
export function MapLegend({ className, theme = 'light' }: { className?: string; theme?: MapTheme }) {
  const dark = theme === 'dark';
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11.5px]', dark ? 'text-[#c9cfe3]' : 'text-ink-2', className)} aria-label={text('Map legend')} role="list">
      {LEGEND.map((s) => (
        <span key={s} role="listitem" className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="box-border h-2.5 w-2.5 rounded-full border-[2.5px]" style={{ borderColor: STATE[s].colour }} aria-hidden />
          {text(STATE[s].label)}
        </span>
      ))}
      <span className={cx('h-3.5 w-px', dark ? 'bg-[#2a3870]' : 'bg-line')} aria-hidden />
      <span role="listitem" className="flex items-center gap-1.5 whitespace-nowrap">
        <span className={cx('box-border h-2.5 w-2.5 rounded-full border-[1.5px]', dark ? 'border-[#e9edff] bg-[#e9edff]' : 'border-[#273498] bg-white')} aria-hidden />
        {text('City')}
      </span>
      <span role="listitem" className="flex items-center gap-1.5 whitespace-nowrap">
        <span className={cx('box-border h-[11px] w-[11px] rounded-full border-[1.5px] border-dashed', dark ? 'border-[#9aa3c4]' : 'border-[#6b7083]')} aria-hidden />
        {text('Country only ≈')}
      </span>
    </div>
  );
}
