import { useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { cx } from '../../../components/ui';
import { btnSmall, input } from '../../hr/parts';
import type { DamageMark, Media, Options } from '../api';

/**
 * The damage diagram (SRS §12 Figure C-2, FR-CHK-03): pick a view, a zone of
 * it and the mark, and attach one of the check-in photos. The top view has
 * the figure's eight zones (front bumper, hood, the four corners, rear bumper,
 * boot); front, rear and the sides a three-by-three grid. The zone codes are
 * the same the office web page writes, so either reads the other's marks.
 * Kept with the check-in and bound to the signature by the server.
 */
export interface Zone {
  zone: string;
  label: string;
  col: number;
  row: number;
}

const TOP: Zone[] = [
  { zone: 'fb', label: 'Front bumper', col: 0, row: 0 },
  { zone: 'hd', label: 'Hood', col: 2, row: 0 },
  { zone: 'lf', label: 'Left front', col: 0, row: 1 },
  { zone: 'rf', label: 'Right front', col: 2, row: 1 },
  { zone: 'lr', label: 'Left rear', col: 0, row: 2 },
  { zone: 'rr', label: 'Right rear', col: 2, row: 2 },
  { zone: 'rb', label: 'Rear bumper', col: 0, row: 3 },
  { zone: 'bt', label: 'Boot', col: 2, row: 3 },
];
const ROWS = ['Upper', 'Middle', 'Lower'];
const COLS = ['left', 'centre', 'right'];
const GRID: Zone[] = ROWS.flatMap((r, row) => COLS.map((c, col) => ({ zone: `${'tmb'[row]}${'lcr'[col]}`, label: `${r} ${c}`, col, row })));

export function zonesOf(view: string): Zone[] {
  return view === 'top' ? TOP : GRID;
}

export function zoneLabel(view: string, zone: string): string {
  return zonesOf(view).find((z) => z.zone === zone)?.label ?? zone.toUpperCase();
}

/** A mark at the middle of its zone, as a share of the view (0–1). */
export function markAt(view: string, z: Zone, mark: string, note: string | null, mediaId: number | null): DamageMark {
  const rows = view === 'top' ? 4 : 3;
  return { view, zone: z.zone, mark, x: Number(((z.col + 0.5) / 3).toFixed(4)), y: Number(((z.row + 0.5) / rows).toFixed(4)), note, media_id: mediaId };
}

export function DamageMap({ options, marks, onChange, photos, disabled }: { options: Options; marks: DamageMark[]; onChange: (m: DamageMark[]) => void; photos: Media[]; disabled?: boolean }) {
  const views = Object.entries(options.checkin.views);
  const [view, setView] = useState(views.some(([k]) => k === 'top') ? 'top' : (views[0]?.[0] ?? 'top'));
  const [zone, setZone] = useState<string | null>(null);
  const [mark, setMark] = useState(Object.keys(options.checkin.damage_marks)[0] ?? 'scratch');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState('');
  const zones = zonesOf(view);
  const rows = view === 'top' ? 4 : 3;
  const here = marks.filter((m) => m.view === view);

  const add = () => {
    const z = zones.find((x) => x.zone === zone);
    if (!z) return;
    onChange([...marks, markAt(view, z, mark, note.trim() || null, photo ? Number(photo) : null)]);
    setZone(null);
    setNote('');
    setPhoto('');
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div role="tablist" aria-label="Damage diagram view" className="flex flex-wrap gap-1">
        {views.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={view === k}
            onClick={() => {
              setView(k);
              setZone(null);
            }}
            className={cx('h-7 rounded-[7px] px-2.5 text-[12px] font-semibold', view === k ? 'bg-primary text-white' : 'border border-line bg-surface text-ink-2 hover:bg-subtle')}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <div className="grid w-[240px] shrink-0 gap-1.5" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }} aria-label={`${options.checkin.views[view] ?? view} view`}>
          {Array.from({ length: rows * 3 }, (_, i) => {
            const col = i % 3;
            const row = Math.floor(i / 3);
            const z = zones.find((x) => x.col === col && x.row === row);
            if (!z) return <div key={i} aria-hidden className={cx('rounded-[8px]', view === 'top' && (row === 1 || row === 2) && 'bg-subtle')} />;
            const count = here.filter((m) => m.zone === z.zone).length;
            return (
              <button
                key={i}
                type="button"
                disabled={disabled}
                aria-pressed={zone === z.zone}
                onClick={() => setZone(z.zone)}
                className={cx('relative flex h-12 items-center justify-center rounded-[8px] border px-1 text-center text-[11px] leading-tight font-semibold', zone === z.zone ? 'border-primary bg-selection text-primary' : count ? 'border-[#F1B8A8] bg-[#FCE9E4] text-[#8C2A14] dark:bg-danger-bg dark:text-danger' : 'border-line bg-surface text-ink-2 enabled:hover:bg-subtle')}
              >
                {z.label}
                {count ? <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] text-white">{count}</span> : null}
              </button>
            );
          })}
        </div>
        {!disabled ? (
          <div className="flex min-w-[240px] flex-1 flex-col gap-2">
            {zone ? (
              <>
                <b className="text-[12.5px] text-ink">{zoneLabel(view, zone)}</b>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(options.checkin.damage_marks).map(([k, label]) => (
                    <button key={k} type="button" aria-pressed={mark === k} onClick={() => setMark(k)} className={cx('h-7 rounded-[7px] px-2.5 text-[12px] font-semibold', mark === k ? 'bg-danger text-white' : 'border border-line bg-surface text-ink-2 hover:bg-subtle')}>
                      {label}
                    </button>
                  ))}
                </div>
                <input aria-label="Note on the mark" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className={input} maxLength={255} />
                {photos.length ? (
                  <Select aria-label="Photo of the mark" value={photo} onValueChange={setPhoto} options={[{ value: '', label: 'No photo' }, ...photos.map((p) => ({ value: String(p.id), label: p.caption ?? p.name ?? `Photo ${p.id}` }))]} />
                ) : null}
                <button type="button" className={cx(btnSmall, 'self-start')} onClick={add}>
                  <Icon name="plus" size={14} /> Add the mark
                </button>
              </>
            ) : (
              <span className="text-[12.5px] text-ink-3">Choose where the damage is.</span>
            )}
          </div>
        ) : null}
      </div>
      {marks.length ? (
        <ul className="m-0 flex flex-col gap-1 p-0" aria-label="Damage marks">
          {marks.map((m, i) => (
            <li key={`${m.view}-${m.zone}-${i}`} className="flex list-none items-center gap-2 text-[12.5px]">
              <span className="h-2 w-2 shrink-0 rounded-full bg-danger" />
              <span className="min-w-0 flex-1">
                <b>{options.checkin.damage_marks[m.mark] ?? m.mark}</b> — {options.checkin.views[m.view] ?? m.view}, {zoneLabel(m.view, m.zone)}
                {m.note ? ` · ${m.note}` : ''}
                {m.media_id ? ' · with a photo' : ''}
              </span>
              {!disabled ? (
                <button type="button" aria-label="Remove the mark" className="text-ink-3 hover:text-danger" onClick={() => onChange(marks.filter((_, j) => j !== i))}>
                  <Icon name="x" size={14} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-[12px] text-ink-3">No damage marked.</span>
      )}
    </div>
  );
}
