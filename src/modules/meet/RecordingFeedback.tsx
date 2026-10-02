import { Button, Spinner } from '../../components/ui';
export function RecordingFeedback({ active, since, now, phase = 'idle', error, stopped, retry, stopPending }: {
  active: boolean; since: number | null; now: number; phase?: 'idle' | 'starting' | 'stopping' | 'error';
  error?: string | null; stopped?: boolean; retry?: () => void; stopPending?: () => void;
}) {
  const seconds = Math.max(0, Math.floor((now - (since ?? now)) / 1000));
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return <div className="no-drag flex flex-wrap items-center gap-2 text-[11.5px]">
    {active ? <span role="status" className="flex flex-wrap items-center gap-1.5 rounded bg-[#3A1A14] px-2 py-1 font-bold text-[#FFB4A2]"><span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />Recording On{since ? ` · ${clock}` : ''}<span className="font-normal">This meeting is being recorded</span></span> : null}
    {phase === 'starting' || phase === 'stopping' ? <span role="status" className="flex items-center gap-1.5"><Spinner />{phase === 'starting' ? 'Starting Recording…' : 'Stopping Recording…'}</span> : null}
    {error ? <span role="alert" className="text-danger">{error}{retry ? <Button onClick={retry}>Retry recording</Button> : null}{stopPending ? <Button onClick={stopPending}>Stop pending recording</Button> : null}</span> : null}
    {stopped && !active ? <span role="status">Recording has stopped. Processing and upload continue separately.</span> : null}
  </div>;
}
