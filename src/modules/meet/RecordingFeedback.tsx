import { bytes } from '../../core/time';
import { Button, Spinner } from '../../components/ui';

/**
 * The recording indicator in a meeting (#87): Recording On with its clock — and, for a recording made here, how much
 * has been saved (#240) — Starting and Stopping, and what went wrong. A missing Screen Recording permission says
 * so with Open System Settings and Check again, never a Retry that would make another empty recording.
 */
export function RecordingFeedback({ active, since, now, phase = 'idle', error, stopped, retry, stopPending, size, fix, openSettings }: {
  active: boolean; since: number | null; now: number; phase?: 'idle' | 'starting' | 'stopping' | 'error';
  error?: string | null; stopped?: boolean; retry?: () => void; stopPending?: () => void;
  /** Saved so far, for a recording made on this computer. */
  size?: number | null;
  fix?: 'screen-permission' | null; openSettings?: () => void;
}) {
  const seconds = Math.max(0, Math.floor((now - (since ?? now)) / 1000));
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const permission = fix === 'screen-permission';
  return <div className="no-drag flex flex-wrap items-center gap-2 text-[11.5px]">
    {active ? <span role="status" className="flex flex-wrap items-center gap-1.5 rounded bg-[#3A1A14] px-2 py-1 font-bold text-[#FFB4A2]"><span className="h-2 w-2 shrink-0 rounded-full bg-red-500 motion-safe:animate-pulse" />Recording On{since ? ` · ${clock}` : ''}{size ? <span className="tabular-nums" data-testid="recording-size"> · {bytes(size)}</span> : null}<span className="font-normal">This meeting is being recorded</span></span> : null}
    {phase === 'starting' || phase === 'stopping' ? <span role="status" className="flex items-center gap-1.5"><Spinner />{phase === 'starting' ? 'Starting Recording…' : 'Stopping Recording…'}</span> : null}
    {error && permission ? (
      <span role="alert" className="flex flex-wrap items-center gap-1.5 rounded bg-[#3A2A10] px-2 py-1 text-[#FFD9A0]">
        <b>Screen Recording permission needed.</b> {error}
        {openSettings ? <Button size="sm" variant="primary" onClick={openSettings}>Open System Settings</Button> : null}
        {retry ? <Button size="sm" onClick={retry}>Check again</Button> : null}
      </span>
    ) : error ? <span role="alert" className="text-danger">{error}{retry ? <Button onClick={retry}>Retry recording</Button> : null}{stopPending ? <Button onClick={stopPending}>Stop pending recording</Button> : null}</span> : null}
    {stopped && !active ? <span role="status">Recording has stopped. Processing and upload continue separately.</span> : null}
  </div>;
}
