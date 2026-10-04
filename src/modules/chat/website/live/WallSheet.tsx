import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { WALL_MODE_DEFAULTS, type LiveDeskInfo, type WallModePrefs } from '@shared/types';
import { Checkbox } from '../../../../components/Checkbox';
import { Button, cx, Spinner } from '../../../../components/ui';
import { apiGet } from '../../../../core/api';
import { call, isMac, on } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { WEBSITE } from '../api';
import { presetsFor, type Dashboard } from './liveMap';

/**
 * The Wall mode sheet (worksuite-desktop L-06; WS-WCHAT MAP-UI-06, MAP-24, WF-M3): before wall mode opens on a display —
 * from the tray's "Wall mode on Display 2" or the dashboard's Wall mode button — it confirms the screen and how:
 * SHOW ON one of the connected displays ("Display 1 · Built-in · this window", "Display 2 · LG UltraFine 27″"); names
 * and messages hidden (always, locked on); keep the display awake; cycle the map World → region → home country every
 * 60 s; open wall mode when WorkSuite starts. Open on Display 2 saves the choices and puts the wall up there.
 */

/** "World → Asia → Sri Lanka": the views the wall cycles through, for the home country. */
export function cycleWords(home: string | null | undefined): string {
  const p = presetsFor(home ?? null);
  return p.length > 1 ? p.map((x) => x.label).join(' → ') : text('World → region → home country');
}

export function WallSheetWindow() {
  const info = useQuery({ queryKey: ['live', 'desk'], queryFn: () => call('live:info') });
  // Read again when the sheet is asked for again (the screens may have changed).
  const { refetch } = info;
  useEffect(() => on('live:wallChanged', () => void refetch()), [refetch]);
  // The home country, for the cycle's words; the sheet works without it.
  const dash = useQuery({ queryKey: ['website', 'dashboard', 0], queryFn: ({ signal }) => apiGet<Dashboard>(`${WEBSITE}/dashboard`, undefined, signal), retry: false });
  const close = () => void call('windows:close').catch(() => undefined);
  return (
    <section aria-label={text('Wall mode')} className="flex h-full flex-col bg-surface text-[13px] text-ink">
      <div className="drag flex h-9 shrink-0 items-center border-b border-line bg-subtle" style={{ paddingLeft: isMac ? 78 : 12, paddingRight: isMac ? 12 : 140 }}>
        <span className="text-[12.5px] font-bold">{text('Wall mode')}</span>
      </div>
      {info.data ? <WallSheet info={info.data} home={dash.data?.home_country ?? null} onCancel={close} /> : <Spinner />}
    </section>
  );
}

export function WallSheet({ info, home, onCancel }: { info: LiveDeskInfo; home: string | null; onCancel: () => void }) {
  const saved: WallModePrefs = info.wallPrefs ?? WALL_MODE_DEFAULTS;
  const displays = info.displays ?? [];
  const [picked, setPicked] = useState<number | null>(saved.displayId ?? displays[1]?.id ?? displays[0]?.id ?? null);
  const [keepAwake, setKeepAwake] = useState(saved.keepAwake);
  const [cycle, setCycle] = useState(saved.cycle);
  const [openAtStart, setOpenAtStart] = useState(saved.openAtStart);
  const [busy, setBusy] = useState(false);
  const chosen = displays.find((d) => d.id === picked) ?? null;

  const open = () => {
    if (!chosen) return;
    setBusy(true);
    void call('live:wall', { displayId: chosen.id, keepAwake, cycle, openAtStart }).then(
      () => setBusy(false),
      () => setBusy(false),
    );
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="px-4 pt-3.5 pb-1.5">
        <p id="wall-show-on" className="mb-1.5 text-[12px] font-bold text-ink-2">
          {text('SHOW ON')}
        </p>
        <div role="radiogroup" aria-labelledby="wall-show-on" className="flex gap-2">
          {displays.map((d) => {
            const on = d.id === picked;
            return (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPicked(d.id)}
                className={cx('flex-1 rounded-[10px] px-2.5 py-[9px] text-left text-[12px] text-ink-2', on ? 'border-2 border-primary bg-selection' : 'border border-line hover:bg-subtle')}
              >
                <span className={cx('block', on ? 'font-bold text-primary' : 'font-semibold text-ink')}>{on ? `${d.display} ✓` : d.display}</span>
                <span className="block truncate">{d.detail}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-2">
          <Choice label={text('Hide visitor names and messages')} lock={text('🔒 always')} hint={text('Places and events only.')} checked disabled />
          <Choice label={text('Keep the display awake')} checked={keepAwake} onChange={setKeepAwake} />
          <Choice label={text('Cycle map views every 60 s')} hint={cycleWords(home)} checked={cycle} onChange={setCycle} />
          <Choice label={text('Open wall mode when WorkSuite starts')} hint={text('For a dedicated support-room screen.')} checked={openAtStart} onChange={setOpenAtStart} />
        </div>
      </div>
      <div className="mt-auto flex justify-end gap-2 px-4 pt-2.5 pb-3.5">
        <Button variant="secondary" onClick={onCancel} className="text-[12.5px]">
          {text('Cancel')}
        </Button>
        <Button variant="primary" onClick={open} disabled={!chosen} loading={busy} className="text-[12.5px] font-bold">
          {chosen ? text('Open on {display}', { display: chosen.display }) : text('Open wall mode')}
        </Button>
      </div>
    </div>
  );
}

/** One of the sheet's choices: a box, its words, and a line under them when there is one. */
function Choice({ label, hint, lock, checked, disabled, onChange }: { label: string; hint?: string; lock?: string; checked: boolean; disabled?: boolean; onChange?: (v: boolean) => void }) {
  return (
    <label className={cx('flex items-start gap-2.5 py-[7px]', disabled ? 'cursor-default' : 'cursor-pointer')}>
      <Checkbox size="lg" checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} className="mt-px" />
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">
          {label} {lock ? <span className="text-[11px] font-normal text-ink-3">{lock}</span> : null}
        </span>
        {hint ? <span className="block text-[11.5px] text-ink-3">{hint}</span> : null}
      </span>
    </label>
  );
}
