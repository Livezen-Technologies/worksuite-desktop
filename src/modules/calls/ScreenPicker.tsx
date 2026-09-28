import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { call, platform } from '../../core/bridge';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { Select } from '../../components/Select';

/** What was picked: the source, its name for "Sharing Screen 1", and whether its sound goes too. */
export interface SharePick {
  id: string;
  name: string;
  audio: boolean;
  /** In a meeting (RC01): how the picture is sent, and whether others may ask to control it. */
  quality?: 'auto' | 'quality' | 'balanced' | 'performance';
  allowRequests?: boolean;
}

/** What the meeting's picker offers about control (RC01): the person's default, and why it is not offered when it is not. */
export interface PickerControl {
  allowRequests: boolean;
  unavailable: string | null;
}

/**
 * Choose what to share (FR-COM-05): a screen or one window, shown as they
 * look now. Nothing is captured until the person presses Share. Used again
 * to change what is shared without stopping. On Windows the computer's
 * sound can go with it; elsewhere the system does not allow it.
 */
export function ScreenPicker({ onPick, onClose, changing, control }: { onPick: (p: SharePick) => void; onClose: () => void; changing?: boolean; control?: PickerControl }) {
  const [tab, setTab] = useState<'screen' | 'window'>('screen');
  const [picked, setPicked] = useState<string | null>(null);
  const [audio, setAudio] = useState(false);
  const [quality, setQuality] = useState<NonNullable<SharePick['quality']>>('auto');
  const [allowRequests, setAllowRequests] = useState(control?.allowRequests ?? false);
  const canAudio = platform === 'win32';
  const choose = (id: string) => {
    const s = (q.data?.sources ?? []).find((x) => x.id === id);
    onPick({ id, name: s?.name ?? 'your screen', audio: canAudio && audio, ...(control ? { quality, allowRequests: allowRequests && !control.unavailable } : {}) });
  };
  const q = useQuery({ queryKey: ['screen-sources'], queryFn: () => call('media:screenSources'), gcTime: 0, staleTime: 0 });
  const list = (q.data?.sources ?? []).filter((s) => s.kind === tab);
  const blocked = q.data && q.data.permission !== 'granted' && q.data.permission !== 'not-determined';
  return (
    <Modal
      title={changing ? 'Share something else' : 'Share your screen'}
      onClose={onClose}
      width={640}
      footer={
        <>
          {canAudio ? (
            <label className="mr-auto flex items-center gap-2 text-[12.5px] text-ink-2">
              <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} className="accent-[var(--color-primary)]" />
              Share the computer's sound
            </label>
          ) : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!picked} onClick={() => picked && choose(picked)}>
            {changing ? 'Switch' : 'Share'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div role="tablist" aria-label="What to share" className="flex gap-1 text-[12.5px] font-semibold">
          {(['screen', 'window'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('rounded-full px-3 py-1', tab === t ? 'bg-ink text-surface' : 'border border-line text-ink')}>
              {t === 'screen' ? 'Entire screen' : 'A window'}
            </button>
          ))}
        </div>
        {blocked ? (
          <div className="rounded-[10px] border border-[#F1D9B5] bg-[#FFF9EC] px-3 py-2.5 text-[12.5px] text-[#7A3B05] dark:bg-warning-bg dark:text-warning">
            WorkSuite is not allowed to record the screen. Allow it under Screen Recording in your system privacy settings, then reopen this.{' '}
            <button type="button" className="font-bold underline" onClick={() => void call('media:privacySettings', { pane: 'screen' })}>
              Open privacy settings
            </button>
          </div>
        ) : null}
        {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
        {control && !changing ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-line px-3 py-2.5 text-[12.5px] text-ink-2">
            <label className="flex items-center gap-2">
              Quality
              <Select value={quality} onChange={(e) => setQuality(e.target.value as NonNullable<SharePick['quality']>)} className="h-7 rounded-[7px] border border-line bg-surface px-1.5 text-ink" aria-label="Sharing quality">
                <option value="auto">Automatic</option>
                <option value="quality">Sharp text</option>
                <option value="balanced">Balanced</option>
                <option value="performance">Smooth motion</option>
              </Select>
            </label>
            {control.unavailable ? (
              <span className="text-ink-3">{control.unavailable}</span>
            ) : (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={allowRequests} onChange={(e) => setAllowRequests(e.target.checked)} className="accent-[var(--color-primary)]" />
                Let people ask to control what I share
              </label>
            )}
          </div>
        ) : null}
        <div className="grid max-h-[360px] grid-cols-3 gap-2.5 overflow-y-auto scroll-thin" role="listbox" aria-label={tab === 'screen' ? 'Screens' : 'Windows'}>
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={picked === s.id}
              onClick={() => setPicked(s.id)}
              onDoubleClick={() => choose(s.id)}
              className={cx('flex flex-col gap-1.5 rounded-[10px] border p-1.5 text-left', picked === s.id ? 'border-primary bg-selection' : 'border-line hover:bg-subtle')}
            >
              {s.thumbnail ? <img src={s.thumbnail} alt="" className="aspect-[16/10] w-full rounded-[6px] bg-subtle object-contain" /> : <span className="aspect-[16/10] w-full rounded-[6px] bg-subtle" />}
              <span className="truncate text-[12px] font-semibold text-ink">{s.name}</span>
            </button>
          ))}
          {!q.isLoading && list.length === 0 ? <p className="col-span-3 py-6 text-center text-[12.5px] text-ink-3">Nothing to share here.</p> : null}
        </div>
      </div>
    </Modal>
  );
}
