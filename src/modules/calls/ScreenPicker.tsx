import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ScreenSources } from '@shared/types';
import { call, errorMessage, platform } from '../../core/bridge';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { Icon } from '../../components/Icon';
import { Button, Modal, Spinner, cx } from '../../components/ui';
import { Select } from '../../components/Select';
import { Checkbox } from '../../components/Checkbox';

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

type Quality = NonNullable<SharePick['quality']>;
const QUALITY_KEY = 'ws.share.quality';
const QUALITIES: Quality[] = ['auto', 'quality', 'balanced', 'performance'];

function savedQuality(): Quality {
  try {
    const q = localStorage.getItem(QUALITY_KEY) as Quality | null;
    return q && QUALITIES.includes(q) ? q : 'auto';
  } catch {
    return 'auto';
  }
}

/**
 * What the picker has to say (worksuite-desktop#70), one thing at a time: the list; the Screen Recording
 * permission is off (not Accessibility, which only remote control needs); the system would not list anything; or
 * there is genuinely nothing of this kind to share.
 */
export type PickerView = { kind: 'loading' } | { kind: 'denied'; restart: boolean } | { kind: 'failed'; detail: string | null; restart: boolean } | { kind: 'empty'; partial: string | null; restart: boolean } | { kind: 'list'; partial: string | null };

export function pickerView(q: { isLoading: boolean; error: unknown; data?: ScreenSources }, tab: 'screen' | 'window'): PickerView {
  if (q.isLoading) return { kind: 'loading' };
  if (q.error) return { kind: 'failed', detail: errorMessage(q.error), restart: false };
  const d = q.data;
  if (!d) return { kind: 'loading' };
  const state = d.state ?? ((d.permission === 'denied' || d.permission === 'restricted') ? 'denied' : 'ok');
  if (state === 'denied') return { kind: 'denied', restart: !!d.restartMayHelp };
  if (state === 'failed') return { kind: 'failed', detail: d.problem ?? null, restart: !!d.restartMayHelp };
  const here = d.sources.filter((s) => s.kind === tab);
  const partial = state === 'partial' ? (d.problem ?? null) : null;
  if (!here.length) return { kind: 'empty', partial, restart: tab === 'screen' && !!d.restartMayHelp };
  return { kind: 'list', partial };
}

/**
 * Choose what to share (FR-COM-05): a screen or one window, shown as they
 * look now. Nothing is captured until the person presses Share. Used again
 * to change what is shared without stopping. On Windows the computer's
 * sound can go with it; elsewhere the system does not allow it.
 *
 * The list is asked for again on Retry and whenever this window comes back
 * into focus — after allowing Screen Recording in System Settings, say. The
 * sharing quality is remembered.
 */
export function ScreenPicker({ onPick, onClose, changing, control, inMeeting }: { onPick: (p: SharePick) => void; onClose: () => void; changing?: boolean; control?: PickerControl; inMeeting?: boolean }) {
  const [tab, setTab] = useState<'screen' | 'window'>('screen');
  const [picked, setPicked] = useState<string | null>(null);
  // Settings › Meet › Behaviour › Share computer sound when presenting (D05)
  // is the default; this checkbox still decides each share.
  const soundByDefault = useStore(app, (st) => st.prefs?.meetBehaviour?.shareComputerSound === true);
  const [audio, setAudio] = useState(soundByDefault);
  const [quality, setQualityState] = useState<Quality>(savedQuality);
  // Until the person changes it, "let people ask" follows the saved default, which may arrive after the picker opens.
  const [allowRequests, setAllowRequests] = useState<boolean | null>(null);
  const allow = allowRequests ?? control?.allowRequests ?? false;
  const canAudio = platform === 'win32';
  const meeting = inMeeting || !!control;
  const q = useQuery({ queryKey: ['screen-sources'], queryFn: () => call('media:screenSources'), gcTime: 0, staleTime: 0, retry: false, refetchOnWindowFocus: false });
  const view = pickerView(q, tab);
  const list = (q.data?.sources ?? []).filter((s) => s.kind === tab);

  // Back from System Settings (or another app): look again.
  const refetch = q.refetch;
  useEffect(() => {
    const again = () => void refetch();
    const visible = () => { if (document.visibilityState === 'visible') again(); };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('focus', again); document.removeEventListener('visibilitychange', visible); };
  }, [refetch]);

  const setQuality = (v: Quality) => {
    setQualityState(v);
    try {
      localStorage.setItem(QUALITY_KEY, v);
    } catch {
      /* only a convenience */
    }
  };
  const choose = (id: string) => {
    const s = (q.data?.sources ?? []).find((x) => x.id === id);
    if (!s) return;
    onPick({ id, name: s.name ?? 'your screen', audio: canAudio && audio, ...(meeting ? { quality, allowRequests: allow && !!control && !control.unavailable } : {}) });
  };
  const settings = () => void call('media:privacySettings', { pane: 'screen' });
  const restart = () => void call('app:relaunch');
  const retry = () => {
    setPicked(null);
    void q.refetch();
  };
  const pickedStill = picked && list.some((s) => s.id === picked) ? picked : null;

  return (
    <Modal
      title={changing ? 'Share something else' : 'Share your screen'}
      onClose={onClose}
      width={680}
      footer={
        <>
          {canAudio ? (
            <label className="mr-auto flex items-center gap-2 text-[12.5px] text-ink-2">
              <Checkbox checked={audio} onChange={(e) => setAudio(e.target.checked)} />
              Share the computer's sound
            </label>
          ) : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="screen-share" disabled={!pickedStill} onClick={() => pickedStill && choose(pickedStill)}>
            {changing ? 'Switch' : 'Share'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {platform === 'darwin' ? <div role="status" className="rounded-[8px] border border-line bg-well px-3 py-2 text-[12.5px] text-ink-2">Screen Recording / Screen &amp; System Audio Recording: {q.isFetching ? 'Checking' : q.error || q.data?.permissionStatus === 'unknown' || q.data?.permission === 'unknown' || q.data?.permission === 'not-determined' ? 'Unable to Verify' : q.data?.permission === 'granted' ? 'Granted' : q.data?.permission === 'denied' || q.data?.permission === 'restricted' ? 'Denied' : 'Unable to Verify'}.{q.data?.permissionProblem ? <span className="block">{q.data.permissionProblem}</span> : null}</div> : null}
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="What to share" className="flex gap-1 text-[12.5px] font-semibold">
            {(['screen', 'window'] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('rounded-full px-3 py-1', tab === t ? 'bg-ink text-surface' : 'border border-line text-ink')}>
                {t === 'screen' ? 'Entire screen' : 'A window'}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <button type="button" onClick={retry} disabled={q.isFetching} className="flex items-center gap-1.5 rounded-[7px] px-2 py-1 text-[12.5px] font-semibold text-primary hover:bg-selection disabled:opacity-60">
            <Icon name="refresh" size={13} className={q.isFetching ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {meeting && !changing ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-line px-3 py-2.5 text-[12.5px] text-ink-2">
            <label className="flex items-center gap-2">
              Quality
              <Select value={quality} onChange={(e) => setQuality(e.target.value as Quality)} className="h-7 rounded-[7px] border border-line bg-surface px-1.5 text-ink" aria-label="Sharing quality">
                <option value="auto">Automatic</option>
                <option value="quality">Sharp text</option>
                <option value="balanced">Balanced</option>
                <option value="performance">Smooth motion</option>
              </Select>
            </label>
            {!control ? (
              <span className="text-ink-3">Checking whether others can ask to control this computer…</span>
            ) : control.unavailable ? (
              // Remote control's own permission (Accessibility): it never stands in the way of sharing.
              <span className="text-ink-3">{control.unavailable} You can still share.</span>
            ) : (
              <label className="flex items-center gap-2">
                <Checkbox checked={allow} onChange={(e) => setAllowRequests(e.target.checked)} />
                Let people ask to control what I share
              </label>
            )}
          </div>
        ) : null}

        {view.kind === 'loading' ? <Spinner label="Looking for screens and windows…" /> : null}
        {view.kind === 'denied' ? (
          <Notice tone="warn" title="WorkSuite isn’t allowed to record the screen">
            Allow WorkSuite under <b>Screen Recording / Screen &amp; System Audio Recording</b> in your system’s privacy settings — that is separate from Accessibility, which only remote control needs.
            {view.restart ? ' The permission changed during this run, but capture is not yet available; restart WorkSuite, then check again.' : ' Then come back here; the list refreshes on its own.'}
            <Actions>
              <Button size="sm" variant="primary" onClick={settings}>Open System Settings</Button>
              {view.restart ? <Button size="sm" onClick={restart}>Restart WorkSuite</Button> : null}
              <Button size="sm" icon="refresh" onClick={retry}>Check again</Button>
            </Actions>
          </Notice>
        ) : null}
        {view.kind === 'failed' ? (
          <Notice tone="error" title="The screens and windows could not be listed">
            {view.restart ? 'If you have just allowed Screen Recording, WorkSuite needs to restart before macOS lets it see the screen. ' : 'Refresh the source list and check the selected screen or window is still open. '}
            {view.detail ? <span className="block pt-1 text-[11.5px] opacity-80">The system said: {view.detail}</span> : null}
            <Actions>
              <Button size="sm" variant="primary" icon="refresh" onClick={retry}>Try again</Button>
              {view.restart ? <Button size="sm" onClick={restart}>Restart WorkSuite</Button> : null}
              {platform === 'darwin' ? <Button size="sm" onClick={settings}>Open System Settings</Button> : null}
            </Actions>
          </Notice>
        ) : null}
        {view.kind === 'empty' || view.kind === 'list' ? (
          <>
            {view.partial ? (
              <p className="flex items-center gap-1.5 text-[12px] text-warning-ink dark:text-warning">
                <Icon name="alert" size={13} /> {tab === 'screen' ? 'Windows' : 'Screens'} could not be listed this time; {tab === 'screen' ? 'screens' : 'windows'} can still be shared.
              </p>
            ) : null}
            <div className="grid max-h-[380px] grid-cols-2 gap-2.5 overflow-y-auto scroll-thin sm:grid-cols-3" role="listbox" aria-label={tab === 'screen' ? 'Screens' : 'Windows'}>
              {list.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-selected={pickedStill === s.id}
                  onClick={() => setPicked(s.id)}
                  onDoubleClick={() => choose(s.id)}
                  className={cx('flex flex-col gap-1.5 rounded-[10px] border p-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary', pickedStill === s.id ? 'border-primary bg-selection' : 'border-line hover:bg-subtle')}
                >
                  {s.thumbnail ? <img src={s.thumbnail} alt="" className="aspect-[16/10] w-full rounded-[6px] bg-subtle object-contain" /> : <span className="flex aspect-[16/10] w-full items-center justify-center rounded-[6px] bg-subtle text-ink-3"><Icon name={s.kind === 'screen' ? 'monitor' : 'app-window'} size={22} /></span>}
                  <span className="truncate text-[12px] font-semibold text-ink">{s.name}</span>
                </button>
              ))}
              {view.kind === 'empty' ? (
                <p className="col-span-full py-6 text-center text-[12.5px] text-ink-3">
                  {tab === 'window' ? 'No other windows are open to share. Open the one you want, then Refresh — or share the entire screen.' : view.restart ? 'No screen can be seen yet. If you have just allowed Screen Recording, restart WorkSuite.' : 'No screen could be found.'}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function Notice({ tone, title, children }: { tone: 'warn' | 'error'; title: string; children: React.ReactNode }) {
  return (
    <div role="alert" className={cx('flex flex-col gap-1 rounded-[10px] px-3.5 py-3 text-[12.5px]', tone === 'warn' ? 'border border-warning-line bg-warning-bg text-warning-strong dark:border-transparent dark:bg-warning-bg dark:text-warning' : 'bg-danger-bg text-danger')}>
      <b className="text-[13px]">{title}</b>
      <div>{children}</div>
    </div>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 flex flex-wrap gap-2">{children}</div>;
}
