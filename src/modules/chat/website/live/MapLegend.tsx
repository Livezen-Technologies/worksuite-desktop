import { cx } from '../../../../components/ui';
import { text } from '../../../../core/i18n';
import { LEGEND, MAP_STATE, STATE } from './liveMap';

/**
 * What the colours and shapes mean (C-00): the five states as rings, then a city marker and a country-only ring — in
 * the map's own colours for the theme (styles.css `--map-*`, #284), so the legend and the map always agree; on the wall,
 * drawn dark on purpose, the wall's.
 */
export function MapLegend({ className }: { className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11.5px] text-ink-2', className)} aria-label={text('Map legend')} role="list">
      {LEGEND.map((s) => (
        <span key={s} role="listitem" className="flex items-center gap-1.5 whitespace-nowrap">
          <span className={cx('box-border h-2.5 w-2.5 rounded-full border-[2.5px]', MAP_STATE[s].border)} aria-hidden />
          {text(STATE[s].label)}
        </span>
      ))}
      <span className="h-3.5 w-px bg-line" aria-hidden />
      <span role="listitem" className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="box-border h-2.5 w-2.5 rounded-full border-[1.5px] border-[var(--map-chatting)] bg-[var(--map-halo)]" aria-hidden />
        {text('City')}
      </span>
      <span role="listitem" className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="box-border h-[11px] w-[11px] rounded-full border-[1.5px] border-dashed border-[var(--map-approx)] bg-[var(--map-halo)]" aria-hidden />
        {text('Country only ≈')}
      </span>
    </div>
  );
}
