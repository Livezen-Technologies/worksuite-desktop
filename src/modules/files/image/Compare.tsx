import { useEffect, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Spinner, cx } from '../../../components/ui';
import { dateLabel } from '../../../core/time';
import { compareImages, sourceUrl, versionBytes, type ImageVersion } from './api';
import { DarkButton, Seg } from './controls';

/**
 * Compare versions (SAV-09, SAV-10, VWR-E-04; P08): any two versions — or a version and the edit not saved yet — by
 * a split slider, side by side, or toggled. The history lists each version with who saved it, when, its note, and
 * EDITABLE where its layers can be reopened. Restoring makes a new version from an old one; nothing is deleted.
 */
export interface CompareProps {
  fileId: number;
  versions: ImageVersion[];
  current: number;
  /** The edit not saved yet, as a picture: offered as the right side. */
  unsaved?: { url: string; label: string } | null;
  canRestore: boolean;
  onReopen: (v: ImageVersion) => void;
  onRestore: (v: ImageVersion) => void;
  onClose: () => void;
}

type Mode = 'split' | 'side' | 'toggle';

function useSide(fileId: number, versions: ImageVersion[], v: number | 'unsaved', unsaved: CompareProps['unsaved']): { url: string | null; error: boolean } {
  const [state, setState] = useState<{ key: string; url: string | null; error: boolean }>({ key: '', url: null, error: false });
  const key = `${fileId}:${v}`;
  useEffect(() => {
    if (v === 'unsaved') return;
    let gone = false;
    let made: string | null = null;
    const row = versions.find((x) => x.version === v);
    void (async () => {
      try {
        const r = await compareImages(`${fileId}:${v}`, `${fileId}:${v}`);
        const u = sourceUrl(r.a.url);
        if (u) {
          if (!gone) setState({ key, url: u, error: false });
          return;
        }
      } catch {
        /* the version's own bytes instead */
      }
      try {
        if (!row) throw new Error('no such version');
        made = URL.createObjectURL(await versionBytes(fileId, row.id));
        if (!gone) setState({ key, url: made, error: false });
      } catch {
        if (!gone) setState({ key, url: null, error: true });
      }
    })();
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [fileId, v, key, versions]);
  if (v === 'unsaved') return { url: unsaved?.url ?? null, error: false };
  return state.key === key ? { url: state.url, error: state.error } : { url: null, error: false };
}

export function CompareView(p: CompareProps) {
  const sorted = [...p.versions].sort((a, b) => b.version - a.version);
  const oldest = sorted[sorted.length - 1]?.version ?? p.current;
  const [mode, setMode] = useState<Mode>('split');
  const [left, setLeft] = useState<number>(oldest === p.current && sorted[1] ? sorted[1].version : oldest);
  const [right, setRight] = useState<number | 'unsaved'>(p.unsaved ? 'unsaved' : p.current);
  const [picked, setPicked] = useState<number>(sorted[0]?.version ?? p.current);
  const [split, setSplit] = useState(50);
  const [showRight, setShowRight] = useState(true);
  const a = useSide(p.fileId, p.versions, left, p.unsaved);
  const b = useSide(p.fileId, p.versions, right, p.unsaved);
  const label = (v: number | 'unsaved') => (v === 'unsaved' ? (p.unsaved?.label ?? 'Your edit') : `v${v}${v === p.current ? ' · Current' : v === oldest ? ' · Original upload' : ''}`);
  const chosen = p.versions.find((v) => v.version === picked) ?? null;
  const options = sorted.map((v) => ({ value: String(v.version), label: label(v.version) }));

  const pic = (side: { url: string | null; error: boolean }, alt: string, cls?: string) =>
    side.url ? <img src={side.url} alt={alt} className={cx('max-h-full max-w-full object-contain', cls)} /> : side.error ? <span className="text-[12.5px] text-[#FFB4A3]">This version could not be loaded.</span> : <Spinner />;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative flex min-w-0 flex-1 items-center justify-center bg-[#0B1120] p-6">
        {mode === 'side' ? (
          <div className="grid h-full w-full grid-cols-2 gap-4">
            <figure className="flex min-h-0 flex-col items-center justify-center gap-2">
              {pic(a, label(left))}
              <figcaption className="rounded-[6px] bg-black/60 px-2 py-0.5 text-[12px] font-bold text-white">{label(left)}</figcaption>
            </figure>
            <figure className="flex min-h-0 flex-col items-center justify-center gap-2">
              {pic(b, label(right))}
              <figcaption className="rounded-[6px] bg-[#3B5BDB] px-2 py-0.5 text-[12px] font-bold text-white">{label(right)}</figcaption>
            </figure>
          </div>
        ) : mode === 'toggle' ? (
          <button type="button" onClick={() => setShowRight(!showRight)} aria-label={`Showing ${showRight ? label(right) : label(left)} — click to switch`} className="relative flex h-full w-full items-center justify-center">
            {pic(showRight ? b : a, showRight ? label(right) : label(left))}
            <span className="absolute top-2 left-2 rounded-[6px] bg-black/60 px-2 py-0.5 text-[12px] font-bold text-white">{showRight ? label(right) : label(left)} · click to switch</span>
          </button>
        ) : (
          <div className="relative flex h-full w-full items-center justify-center">
            <div className="relative inline-flex max-h-full max-w-full">
              {pic(b, label(right))}
              {a.url ? <img src={a.url} alt={label(left)} className="absolute inset-0 h-full w-full object-contain" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} /> : null}
              <span className="absolute top-2 left-2 rounded-[6px] bg-black/60 px-2 py-0.5 text-[12px] font-bold text-white">{label(left)}</span>
              <span className="absolute top-2 right-2 rounded-[6px] bg-[#3B5BDB] px-2 py-0.5 text-[12px] font-bold text-white">{label(right)}</span>
              <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-white" style={{ left: `${split}%` }} />
              <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Divider" className="absolute inset-x-0 top-1/2 w-full -translate-y-1/2 cursor-ew-resize opacity-0" />
            </div>
          </div>
        )}
      </div>
      <aside aria-label="Compare versions" className="flex w-[320px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-[#1E2A4A] bg-[#0F1629] p-4 scroll-thin">
        <div className="flex items-center">
          <h2 className="flex-1 text-[15px] font-bold text-white">Compare versions</h2>
          <button type="button" aria-label="Close compare" onClick={p.onClose} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[#C3CEEA] hover:bg-white/10">
            <Icon name="x" size={16} />
          </button>
        </div>
        <Seg label="How to compare" value={mode} onChange={setMode} options={[{ value: 'split', label: 'Split' }, { value: 'side', label: 'Side by side' }, { value: 'toggle', label: 'Toggle' }]} />
        <span className="text-[11px] font-bold tracking-[0.07em] text-[#8C9BC0] uppercase">Left</span>
        <Select value={String(left)} aria-label="Left version" options={options} onValueChange={(v) => setLeft(Number(v))} className="h-8 w-full text-white" />
        <span className="text-[11px] font-bold tracking-[0.07em] text-[#8C9BC0] uppercase">Right</span>
        <Select value={String(right)} aria-label="Right version" options={[...(p.unsaved ? [{ value: 'unsaved', label: p.unsaved.label }] : []), ...options]} onValueChange={(v) => setRight(v === 'unsaved' ? 'unsaved' : Number(v))} className="h-8 w-full text-white" />
        <span className="text-[11px] font-bold tracking-[0.07em] text-[#8C9BC0] uppercase">History</span>
        <ul className="flex flex-col gap-2">
          {sorted.map((v) => (
            <li key={v.id}>
              <button type="button" aria-pressed={picked === v.version} onClick={() => (setPicked(v.version), setLeft(v.version))} className={cx('flex w-full flex-col gap-0.5 rounded-[10px] border px-3 py-2 text-left', picked === v.version ? 'border-[#5B7BFF] bg-[#1A2650]' : 'border-[#24314F] hover:border-[#3A4C7A]')}>
                <span className="flex items-center gap-2 text-[12.5px] text-white">
                  <b>{`v${v.version}`}</b>
                  {v.editable ? <span className="rounded-[4px] bg-[#23349E] px-1.5 text-[10px] font-bold tracking-wide">EDITABLE</span> : null}
                  <span className="ml-auto text-[11.5px] text-[#8C9BC0]">{v.created_at ? dateLabel(v.created_at) : ''}</span>
                </span>
                <span className="text-[12.5px] text-[#E6ECFA]">{v.note || v.summary || (v.version === oldest ? 'Original upload' : 'Saved')}</span>
                {v.author ? <span className="text-[11.5px] text-[#8C9BC0]">{v.author}</span> : null}
              </button>
            </li>
          ))}
        </ul>
        {chosen ? (
          <div className="mt-auto flex flex-col gap-2 pt-2">
            <div className="flex gap-2">
              <DarkButton disabled={!chosen.editable} title={chosen.editable ? undefined : 'No editable layers were kept with this version'} onClick={() => p.onReopen(chosen)}>
                {`Reopen v${chosen.version} in editor`}
              </DarkButton>
              {p.canRestore && chosen.version !== p.current ? (
                <DarkButton primary onClick={() => p.onRestore(chosen)}>
                  {`Restore v${chosen.version}`}
                </DarkButton>
              ) : null}
            </div>
            <span className="text-[12px] text-[#8C9BC0]">{`Restore makes a new version (v${p.current + 1}) from v${chosen.version}, so nothing in the history is lost.`}</span>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
