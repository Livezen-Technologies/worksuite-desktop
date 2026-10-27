import { Checkbox } from '../../components/Checkbox';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Track } from 'livekit-client';
import type { StreamDestination, StreamLayout, StreamOrientation, StreamPlatform, LivestreamStatus } from '@shared/livestream';
import { PLATFORM_LABEL, STREAM_GUIDANCE, STREAM_LABEL, streamActive } from '@shared/livestream';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button, Modal, Spinner, cx } from '../../components/ui';
import { app } from '../../core/app-state';
import { meet } from './session';
import { VideoView } from '../../components/CallKit';
const field = 'w-full rounded border border-line bg-surface px-3 py-2 text-ink';
const initial = { label: '', platform: 'youtube' as StreamPlatform, server_url: 'rtmps://a.rtmps.youtube.com/live2', stream_key: '', orientation: 'landscape' as StreamOrientation, layout: 'grid' as StreamLayout, title: 'WorkSuite meeting', description: '', visibility: 'private' as StreamDestination['visibility'] };
/** Uses tracks only: the preview and broadcast never capture this app's windows, panels or controls. */
export function StreamPreview({ layout, orientation }: { layout: StreamLayout; orientation: StreamOrientation }) {
  const [, redraw] = useState(0);
  useEffect(() => { const timer = setInterval(() => redraw(n => n + 1), 1000); return () => clearInterval(timer); }, []);
  const participants = meet.room ? [meet.room.localParticipant, ...meet.present].sort((a, b) => a.identity.localeCompare(b.identity)) : [];
  const speaker = participants.find(p => p.identity === meet.lastSpeaker) ?? participants[0];
  const tiles = layout === 'screen' ? participants.filter(p => p.isScreenShareEnabled).slice(0, 1) : layout === 'speaker' ? speaker ? [speaker] : [] : participants;
  return <div aria-label={`${orientation} ${layout} broadcast preview`} className={cx('relative mx-auto grid w-full max-w-[420px] gap-1 overflow-hidden rounded bg-stage text-white', orientation === 'portrait' ? 'aspect-[9/16] max-w-[158px]' : 'aspect-video')} style={{ gridTemplateColumns: `repeat(${layout === 'grid' ? Math.max(1, Math.ceil(Math.sqrt(tiles.length))) : 1}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout === 'grid' ? Math.max(1, Math.ceil(tiles.length / Math.max(1, Math.ceil(Math.sqrt(tiles.length))))) : 1}, minmax(0, 1fr))` }}>
    {tiles.length ? tiles.map(p => { const pub = p.getTrackPublication(layout === 'screen' ? Track.Source.ScreenShare : Track.Source.Camera); const track = pub && !pub.isMuted ? pub.track : null; return <div key={p.identity} className="relative min-h-0 overflow-hidden bg-navy-2">{track ? <VideoView track={track} className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-sm">{p.name || 'Participant'}</div>}</div>; }) : <span className="absolute inset-0 flex items-center justify-center p-3 text-center text-sm">{layout === 'screen' ? 'Waiting for a shared screen' : 'Meeting media preview appears when connected'}</span>}
  </div>;
}
export function LivestreamDestinations() {
  const client = useQueryClient();
  const list = useQuery({ queryKey: ['meet', 'stream-destinations'], queryFn: () => apiGet<{ destinations: StreamDestination[]; youtube_connect: boolean }>('/api/meet/livestream/destinations'), refetchInterval: 10_000 });
  const [editing, setEditing] = useState<StreamDestination | 'new' | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [test, setTest] = useState<Record<number, string>>({});
  const run = async (action: () => Promise<unknown>) => { if (busy) return; setBusy(true); setError(''); try { await action(); await client.invalidateQueries({ queryKey: ['meet', 'stream-destinations'] }); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  return <section className="flex flex-col gap-3">
    <p className="text-sm text-ink-2">Save destinations for meetings you host or co-host. Up to five selected destinations can broadcast together. Keys and account tokens stay encrypted on the server.</p>
    <div className="flex flex-wrap gap-2"><Button onClick={() => setEditing('new')}>Add Destination</Button><Button disabled={busy || !list.data?.youtube_connect} onClick={() => void run(async () => { const r = await apiPost<{ url: string }>('/api/meet/livestream/youtube/connect'); if (!await call('app:openExternal', { url: r.url })) throw new Error('Could not open Google account connection.'); })}>Connect YouTube account</Button><Button onClick={() => void list.refetch()}>Refresh</Button></div>
    {!list.data?.youtube_connect ? <p className="text-xs text-ink-3">YouTube account connection requires an administrator’s Google OAuth registration. Stream-key setup is available for all supported platforms when the account has streaming access.</p> : null}
    {error || list.error ? <p role="alert" className="text-sm text-danger">{error || errorMessage(list.error)}</p> : null}
    {list.isLoading ? <Spinner /> : null}
    {list.data?.destinations.map(d => <div key={d.id} className="rounded border border-line p-3"><b>{d.label}</b><p className="text-xs text-ink-2">{PLATFORM_LABEL[d.platform]} · {d.connected ? 'Account connected' : d.tested_at ? 'Server reachable' : 'Not tested'} · {d.orientation} · {d.layout}</p><p className="text-xs text-ink-3">{d.connected ? 'Managed by your connected account' : `${d.server_url} · Stream key: ••••••••`}</p><div className="mt-2 flex flex-wrap gap-2"><Button disabled={busy} onClick={() => setEditing(d)}>Edit</Button><Button disabled={busy} onClick={() => void run(async () => { const r = await apiPost<{ reachable: boolean; message: string }>(`/api/meet/livestream/destinations/${d.id}/test`); setTest(t => ({ ...t, [d.id]: r.message })); })}>Test Connection</Button><Button disabled={busy} onClick={() => void run(async () => { const r = await apiDelete<{ warning?: string }>(`/api/meet/livestream/destinations/${d.id}`); if (r?.warning) toast('info', r.warning); })}>Disconnect</Button></div>{test[d.id] ? <p role="status" className="mt-2 text-xs">{test[d.id]}</p> : null}</div>)}
    {editing ? <DestinationEditor destination={editing === 'new' ? undefined : editing} close={() => setEditing(null)} saved={() => { setEditing(null); void list.refetch(); }} /> : null}
  </section>;
}
function DestinationEditor({ destination, close, saved }: { destination?: StreamDestination; close: () => void; saved: () => void }) {
  const [form, setForm] = useState(destination ? { ...initial, ...destination, stream_key: '' } : initial);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const connected = destination?.connected;
  const patch = (value: Partial<typeof form>) => setForm(f => ({ ...f, ...value }));
  const save = async () => { if (busy) return; setBusy(true); try { const payload = { label: form.label, platform: form.platform, server_url: form.server_url, stream_key: form.stream_key, orientation: form.orientation, layout: form.layout, title: form.title, description: form.description, visibility: form.visibility }; if (destination) await apiPut(`/api/meet/livestream/destinations/${destination.id}`, payload); else await apiPost('/api/meet/livestream/destinations', payload); saved(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  return <Modal title={destination ? 'Edit Destination' : 'Add Destination'} onClose={close} width={620}>
    <div className="flex flex-col gap-3"><label>Name<input aria-label="Destination name" value={form.label} maxLength={100} onChange={e => patch({ label: e.target.value })} className={field} /></label>
      <label>Platform<select aria-label="Platform" disabled={connected} value={form.platform} onChange={e => patch({ platform: e.target.value as StreamPlatform, server_url: e.target.value === 'youtube' ? initial.server_url : '' })} className={field}>{Object.entries(PLATFORM_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <p className="text-sm text-ink-2">{STREAM_GUIDANCE[form.platform]}</p>
      {!connected ? <><label>Server URL<input aria-label="Server URL" value={form.server_url} maxLength={1024} onChange={e => patch({ server_url: e.target.value })} placeholder="rtmps://stream.example.com/live" className={field} /></label><label>Stream key<input aria-label="Stream key" type="password" autoComplete="new-password" value={form.stream_key} maxLength={1024} onChange={e => patch({ stream_key: e.target.value })} placeholder={destination ? 'Leave blank to keep the saved key' : 'Paste your stream key'} className={field} /></label></> : null}
      <div className="grid grid-cols-2 gap-2"><label>Orientation<select aria-label="Orientation" value={form.orientation} onChange={e => patch({ orientation: e.target.value as StreamOrientation })} className={field}><option value="landscape">Landscape 16:9</option><option value="portrait">Portrait 9:16</option></select></label><label>Output<select aria-label="Broadcast output" value={form.layout} onChange={e => patch({ layout: e.target.value as StreamLayout })} className={field}><option value="grid">Participant grid</option><option value="speaker">Active speaker</option><option value="screen">Shared screen</option></select></label></div>
      <StreamPreview layout={form.layout} orientation={form.orientation} />
      {connected ? <><label>Broadcast title<input aria-label="Broadcast title" value={form.title} maxLength={100} onChange={e => patch({ title: e.target.value })} className={field} /></label><label>Description<textarea aria-label="Description" value={form.description ?? ''} maxLength={5000} onChange={e => patch({ description: e.target.value })} className={field} /></label><label>Visibility<select aria-label="Visibility" value={form.visibility} onChange={e => patch({ visibility: e.target.value as StreamDestination['visibility'] })} className={field}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label></> : <p className="text-xs text-ink-3">With stream keys, set title, description and visibility in the platform’s streaming dashboard. WorkSuite does not override them.</p>}
      <p className="text-xs text-ink-3">Only meeting video and audio are broadcast. Private chat, participant-management panels and host controls are excluded. A shared screen broadcasts whatever its owner shares.</p>
      {error ? <p role="alert" className="text-danger">{error}</p> : null}<div className="flex justify-end gap-2"><Button onClick={close}>Cancel</Button><Button disabled={busy || !form.label.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save Destination'}</Button></div>
    </div>
  </Modal>;
}
export function LivestreamControls({ close }: { close: () => void }) {
  useSyncExternalStore(meet.subscribe, meet.snapshot);
  const list = useQuery({ queryKey: ['meet', 'stream-destinations'], queryFn: () => apiGet<{ destinations: StreamDestination[] }>('/api/meet/livestream/destinations') });
  const [selected, setSelected] = useState<number[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const allowed = meet.canManage;
  const status = meet.livestream;
  const run = async (action: () => Promise<unknown>) => { if (busy || !allowed) return; setBusy(true); setError(''); try { await action(); await meet.refreshLivestream(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  return <Modal title="Livestreaming" onClose={close} width={740}><div className="flex flex-col gap-3">
    <p className="text-sm text-ink-2">Broadcast meeting video and audio to selected destinations. Everyone in the meeting is notified. Recording remains separate.</p>
    {!allowed ? <p role="alert">Only the host and authorized co-hosts can manage livestreaming.</p> : null}
    {status?.destinations.map(job => <div key={job.id} className="flex flex-wrap items-center gap-2 rounded border border-line p-3"><b className="flex-1">{job.label}</b><span role="status">{STREAM_LABEL[job.status]}</span><Button disabled={busy || !allowed || !streamActive(job.status)} onClick={() => void run(() => apiPost(`/api/meet/${meet.uuid}/livestream/${job.destination_id}/stop`))}>Stop destination</Button><Button disabled={busy || !allowed || job.status === 'stopping' || job.mine !== Number(app.get().auth?.user?.id)} onClick={() => void run(() => apiPost(`/api/meet/${meet.uuid}/livestream/${job.destination_id}/reconnect`))}>Reconnect</Button>{job.error ? <p role="alert" className="w-full text-sm text-danger">{job.error}</p> : null}</div>)}
    {list.data?.destinations.map(d => <div key={d.id} className="rounded border border-line p-3"><label className="flex items-center gap-2"><Checkbox aria-label={`Select ${d.label}`} disabled={busy || !allowed || selected.length >= 5 && !selected.includes(d.id)} checked={selected.includes(d.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, d.id] : ids.filter(id => id !== d.id))} /><b>{d.label}</b><span className="text-xs text-ink-2">{PLATFORM_LABEL[d.platform]} · {d.orientation} · {d.layout}</span></label><StreamPreview layout={d.layout} orientation={d.orientation} /></div>)}
    <details><summary className="cursor-pointer font-semibold">Manage saved destinations</summary><LivestreamDestinations /></details>
    {error || list.error ? <p role="alert" className="text-danger">{error || errorMessage(list.error)}</p> : null}
    <div className="flex flex-wrap justify-end gap-2"><Button disabled={busy || !allowed || !status?.active} onClick={() => void run(() => apiPost(`/api/meet/${meet.uuid}/livestream/stop`))}>Stop Livestream</Button><Button disabled={busy || !allowed || !selected.length} onClick={() => void run(() => apiPost(`/api/meet/${meet.uuid}/livestream/start`, { destinations: selected }))}>Start Livestream</Button></div>
  </div></Modal>;
}
export function LivestreamBadge({ status }: { status: Pick<LivestreamStatus, 'active' | 'live' | 'count'> | null }) {
  if (!status?.active) return null;
  return <span role="status" className="rounded-full bg-danger px-2 py-0.5 text-[11.5px] font-bold text-white">{status.live ? 'LIVE' : 'Livestream connecting'} · {status.count} {status.count === 1 ? 'destination' : 'destinations'}</span>;
}
/** Announce a newly joined participant too; compare state, not every poll response. */
export function useLivestreamNotice(status: Pick<LivestreamStatus, 'active' | 'live'> | null) {
  const before = useRef(false);
  useEffect(() => { const active = !!status?.active; if (active !== before.current) toast('info', active ? 'This meeting is being livestreamed to external destinations. Your meeting video and audio may be broadcast.' : 'Livestreaming has stopped.'); before.current = active; }, [status?.active]);
}
