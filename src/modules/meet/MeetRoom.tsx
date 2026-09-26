import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Track, type Participant } from 'livekit-client';
import { apiGet } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { bytes, dateLabel, parseTs } from '../../core/time';
import { toast } from '../../core/toasts';
import { Button, Empty, FileBadge, Modal, Spinner, cx } from '../../components/ui';
import { CallAvatar, Pill, useNow, VideoView } from '../calls/parts';
import { ScreenPicker } from '../calls/ScreenPicker';
import { Thread } from '../chat/Thread';
import type { ChatFile } from '../chat/types';
import { formatCode, invitation } from './api';
import { ShareInChat, ShareRow } from './MeetHome';
import { isGuest, meet, metaOf, type Stroke } from './session';
import { Select } from '../../components/Select';

type Tab = 'People' | 'Chat' | 'Board' | 'Files' | 'Info';

/** 00:24:10 — how long the meeting has been going. */
export function hms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}
const TABS: Tab[] = ['People', 'Chat', 'Board', 'Files', 'Info'];

/** The meeting room (MeetRoom): the people, the controls, and a drawer beside them. */
export function MeetRoom() {
  const [tab, setTab] = useState<Tab | null>('People');
  const [picking, setPicking] = useState(false);
  const [ending, setEnding] = useState(false);
  const now = useNow();
  const room = meet.room!;
  const lp = room.localParticipant;
  const info = meet.info!;
  const people: Participant[] = [lp, ...meet.present];
  const shared = people.map((p) => ({ p, t: p.getTrackPublication(Track.Source.ScreenShare)?.track })).find((x) => x.t);
  const started = info.started_at ? parseTs(info.started_at).getTime() : meet.joinedAt;
  const clock = started ? hms(now - started) : '';
  const waiting = meet.waiting;
  const cols = people.length <= 1 ? 1 : people.length <= 4 ? 2 : 3;

  return (
    <div className="flex h-full flex-col bg-[#0B1226] text-[13px] text-[#E6ECFA]">
      <div className="flex h-11 shrink-0 items-center gap-2.5 bg-[#0F1B3D] px-3.5">
        <b className="truncate">{info.title || 'Meeting'}</b>
        <span className="font-mono text-[12px] text-[#AFC0E8]">{clock}</span>
        {room.isRecording ? (
          <span className="flex items-center gap-1.5 rounded-full bg-[#3A1A14] px-2 py-0.5 text-[11.5px] font-bold text-[#FFB4A2]">
            <span className="h-2 w-2 rounded-full bg-[#E0522F]" />
            Recording
          </span>
        ) : null}
        {meet.locked ? <span className="rounded-full bg-[#2A3A66] px-2 py-0.5 text-[11.5px] font-semibold">Locked — no new participants</span> : null}
        <span className="flex-1" />
        {info.meeting_id ? <span className="text-[12px] text-[#AFC0E8]">Meeting ID {formatCode(info.meeting_id)}</span> : null}
        <button type="button" onClick={() => void navigator.clipboard.writeText(info.join_url).then(() => toast('success', 'Join link copied.'))} className="h-7 rounded-[7px] bg-[#2A3A66] px-2.5 text-[12px] font-semibold hover:bg-[#344777]">
          Copy join link
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-3.5">
          {meet.error ? (
            <div className="flex items-center gap-2 rounded-[10px] bg-[#3A1A14] px-3 py-2 text-[12.5px] text-[#FFD2C4]" role="alert">
              <span className="flex-1">{meet.error}</span>
              <button type="button" onClick={() => meet.note(null)} className="font-bold">×</button>
            </div>
          ) : null}
          {meet.isHost && waiting.length ? (
            <div className="flex items-center gap-2 rounded-[10px] bg-[#16254F] px-3 py-2 text-[12.5px]">
              <span className="flex-1">
                <b>{waiting.length === 1 ? (waiting[0]!.name || 'Someone') : `${waiting.length} people`}</b> {waiting.length === 1 ? 'is' : 'are'} waiting to join
              </span>
              <button type="button" onClick={() => void Promise.all(waiting.map((p) => meet.admit(p)))} className="h-7 rounded-[7px] bg-white px-2.5 text-[12px] font-bold text-[#151A2D]">
                Admit{waiting.length > 1 ? ' all' : ''}
              </button>
              <button type="button" onClick={() => setTab('People')} className="h-7 rounded-[7px] bg-[#2A3A66] px-2.5 text-[12px] font-semibold">
                See who
              </button>
            </div>
          ) : null}
          {shared?.t ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="relative min-h-0 flex-1 overflow-hidden rounded-[12px] bg-[#16254F]">
                <VideoView track={shared.t} className="h-full w-full object-contain" />
                <span className="absolute bottom-2 left-2 rounded-[6px] bg-[rgba(11,18,38,.8)] px-2 py-1 text-[12px]">{shared.p === lp ? 'You are sharing your screen' : `${shared.p.name || 'Someone'} is sharing`}</span>
              </div>
              <div className="flex h-[110px] shrink-0 gap-2 overflow-x-auto scroll-thin">
                {people.map((p) => <Tile key={p.identity} p={p} self={p === lp} host={metaOf(p).host || (p === lp && meet.isHost)} className="w-[180px] shrink-0" />)}
              </div>
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 gap-2.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: '1fr' }}>
              {people.map((p) => <Tile key={p.identity} p={p} self={p === lp} host={metaOf(p).host || (p === lp && meet.isHost)} />)}
            </div>
          )}
          <div role="toolbar" aria-label="Meeting controls" className="flex flex-wrap items-center justify-center gap-2 self-center rounded-2xl bg-[#16254F] px-3.5 py-2.5">
            <Pill warn={!lp.isMicrophoneEnabled} onClick={() => void meet.toggleMic()}>{lp.isMicrophoneEnabled ? 'Mute' : 'Unmute'}</Pill>
            <Pill warn={!lp.isCameraEnabled} onClick={() => void meet.toggleCamera()}>{lp.isCameraEnabled ? 'Camera' : 'Camera off'}</Pill>
            <Pill on={lp.isScreenShareEnabled} onClick={() => (lp.isScreenShareEnabled ? void meet.share(null) : setPicking(true))}>{lp.isScreenShareEnabled ? 'Stop sharing' : 'Share'}</Pill>
            {meet.isHost ? <Pill on={room.isRecording} onClick={() => void meet.record(!room.isRecording)}>{room.isRecording ? 'Stop recording' : 'Record'}</Pill> : null}
            {(['Board', 'Chat', 'People'] as Tab[]).map((t) => (
              <Pill key={t} on={tab === t} onClick={() => setTab(tab === t ? null : t)}>
                {t}
                {t === 'People' && meet.isHost && waiting.length ? ` · ${waiting.length}` : ''}
              </Pill>
            ))}
            <span className="mx-1 h-7 w-px bg-[#2A3A66]" />
            <button type="button" onClick={() => void meet.leave()} className="h-11 rounded-full bg-[#C4321C] px-5 font-bold text-white hover:bg-[#A8291A]">Leave</button>
            {meet.isHost ? (
              <button type="button" onClick={() => setEnding(true)} className="h-11 rounded-full border border-[#C4321C] px-4 font-bold text-[#FFB4A2] hover:bg-[#3A1A14]">
                End for all
              </button>
            ) : null}
          </div>
        </div>
        {tab ? (
          <aside aria-label="Meeting drawer" className="flex w-[340px] shrink-0 flex-col bg-surface text-ink">
            <div role="tablist" className="flex items-center border-b border-line px-2">
              {TABS.map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('h-[42px] px-2.5 text-[12.5px]', tab === t ? 'font-bold text-primary shadow-[inset_0_-2px_0_var(--color-primary)]' : 'font-medium text-ink-2')}>
                  {t}
                </button>
              ))}
              <span className="flex-1" />
              <button type="button" aria-label="Close panel" onClick={() => setTab(null)} className="px-2 text-[16px] text-ink-2 hover:text-ink">×</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
              {tab === 'People' ? <PeoplePanel /> : null}
              {tab === 'Chat' ? (
                info.room_id ? (
                  <div className="flex h-full flex-col">
                    <span className="border-b border-line px-3 py-2 text-[11.5px] text-ink-3">Meeting chat · saved to the meeting's conversation</span>
                    <div className="min-h-0 flex-1">
                      <Thread roomId={String(info.room_id)} room={undefined} mini bare rooms={[]} />
                    </div>
                  </div>
                ) : (
                  <Empty icon="chat" title="This meeting has no chat" />
                )
              ) : null}
              {tab === 'Board' ? <Whiteboard /> : null}
              {tab === 'Files' ? <FilesPanel roomId={info.room_id} /> : null}
              {tab === 'Info' ? <InfoPanel /> : null}
            </div>
          </aside>
        ) : null}
      </div>
      {picking ? (
        <ScreenPicker
          onClose={() => setPicking(false)}
          onPick={(id) => {
            setPicking(false);
            void meet.share(id);
          }}
        />
      ) : null}
      {ending ? (
        <Modal title="End the meeting for everyone?" onClose={() => setEnding(false)} width={420} footer={<><Button onClick={() => setEnding(false)}>Cancel</Button><Button variant="danger" onClick={() => (setEnding(false), void meet.endForAll())}>End for all</Button></>}>
          <p className="text-[13px] text-ink-2">Everyone is disconnected{room.isRecording ? ' and the recording stops' : ''}. The meeting cannot be joined again.</p>
        </Modal>
      ) : null}
    </div>
  );
}

function Tile({ p, self, host, className }: { p: Participant; self: boolean; host?: boolean; className?: string }) {
  const cam = p.getTrackPublication(Track.Source.Camera);
  const track = cam?.track && !cam.isMuted ? cam.track : null;
  return (
    <div className={cx('relative flex min-h-0 items-center justify-center overflow-hidden rounded-[12px] bg-[#2F4A7A]', p.isSpeaking && 'shadow-[inset_0_0_0_3px_#3DD68C]', className)}>
      {track ? <VideoView track={track} mirror={self} className="h-full w-full object-cover" /> : <CallAvatar name={p.name || p.identity} size={84} />}
      <span className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-[6px] bg-[rgba(11,18,38,.7)] px-2 py-[3px] text-[12px] font-semibold">
        {self ? 'You' : p.name || 'Guest'}
        {host ? <span className="text-[11px] font-normal text-[#AFC0E8]">Host</span> : isGuest(p) ? <span className="text-[11px] font-normal text-[#AFC0E8]">Guest</span> : null}
      </span>
      {!p.isMicrophoneEnabled ? <span className="absolute top-2 right-2 rounded-[6px] bg-[rgba(11,18,38,.7)] px-2 py-[3px] text-[11px] font-semibold">Muted</span> : null}
    </div>
  );
}

function PeoplePanel() {
  const [menu, setMenu] = useState<string | null>(null);
  const room = meet.room!;
  const present: Participant[] = [room.localParticipant, ...meet.present];
  const link = 'text-[12px] font-semibold text-primary hover:underline';
  return (
    <div className="flex flex-col gap-3 p-3.5 text-[12.5px]">
      {meet.isHost && meet.waiting.length ? (
        <div className="flex flex-col gap-2 rounded-[10px] border border-[#F1D9B5] bg-[#FFF9EC] p-2.5 dark:bg-warning-bg">
          <div className="flex items-center gap-2">
            <b className="flex-1 text-ink">Waiting to join · {meet.waiting.length}</b>
            <button type="button" className={link} onClick={() => void Promise.all(meet.waiting.map((p) => meet.admit(p)))}>Admit all</button>
            <button type="button" className="text-[12px] font-semibold text-danger hover:underline" onClick={() => void Promise.all(meet.waiting.map((p) => meet.remove(p)))}>Deny all</button>
          </div>
          {meet.waiting.map((p) => (
            <div key={p.identity} className="flex items-center gap-2">
              <b className="min-w-0 flex-1 truncate text-ink">{p.name || 'Guest'}</b>
              <span className="text-[11.5px] text-ink-3">{isGuest(p) ? 'Guest · by link' : 'Signed in'}</span>
              <button type="button" onClick={() => void meet.admit(p)} className="h-7 rounded-[7px] bg-primary px-2.5 text-[12px] font-bold text-white">Admit</button>
              <button type="button" onClick={() => void meet.remove(p)} className="h-7 rounded-[7px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink">Deny</button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex items-center">
        <b className="flex-1 text-ink">In the meeting · {present.length}</b>
      </div>
      {present.map((p) => {
        const self = p === room.localParticipant;
        const host = metaOf(p).host || (self && meet.isHost);
        const state = p.isSpeaking ? 'Speaking' : !p.isMicrophoneEnabled ? 'Muted' : '';
        return (
          <div key={p.identity} className="relative flex items-center gap-2.5">
            <CallAvatar name={p.name || p.identity} size={30} />
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-ink">{self ? `${p.name || 'You'} (you)` : p.name || 'Guest'}</b>
              <span className="text-[11px] text-ink-3">{host ? 'Host' : isGuest(p) ? 'Guest · by link' : 'Member'}</span>
            </span>
            <span className={cx('text-[11.5px] font-semibold', p.isSpeaking ? 'text-success' : 'text-ink-3')}>{state}</span>
            {meet.isHost && !self ? (
              <>
                <button type="button" aria-label={`Actions for ${p.name || 'this person'}`} onClick={() => setMenu(menu === p.identity ? null : p.identity)} className="h-7 w-7 rounded-[7px] text-ink-2 hover:bg-subtle">⋯</button>
                {menu === p.identity ? (
                  <div role="menu" className="absolute top-8 right-0 z-10 w-40 rounded-[10px] border border-line bg-surface py-1 shadow-xl">
                    <button type="button" role="menuitem" disabled={!p.isMicrophoneEnabled} onClick={() => (setMenu(null), void meet.mute(p))} className="block w-full px-3 py-1.5 text-left hover:bg-subtle disabled:opacity-50">Mute</button>
                    <button type="button" role="menuitem" onClick={() => (setMenu(null), void meet.remove(p))} className="block w-full px-3 py-1.5 text-left text-danger hover:bg-subtle">Remove from the meeting</button>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

const COLORS = ['#151A2D', '#23349E', '#B42318', '#1F7A4D', '#B45309'];

/** The shared board: strokes drawn here reach everyone in the meeting at once. */
function Whiteboard() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(COLORS[1]!);
  const [eraser, setEraser] = useState(false);
  const drawing = useRef<Stroke | null>(null);
  const strokes = meet.strokes;

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const { width, height } = c.getBoundingClientRect();
    c.width = Math.round(width * devicePixelRatio);
    c.height = Math.round(height * devicePixelRatio);
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * width, y * height) : ctx.moveTo(x * width, y * height)));
      ctx.stroke();
    }
  }, [strokes]);

  const at = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const line = (from: [number, number], to: [number, number], s: Stroke) => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const { width, height } = c.getBoundingClientRect();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.beginPath();
    ctx.moveTo(from[0] * width, from[1] * height);
    ctx.lineTo(to[0] * width, to[1] * height);
    ctx.stroke();
  };
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <canvas
        ref={canvas}
        aria-label="Whiteboard"
        className="min-h-0 w-full flex-1 touch-none rounded-[10px] border border-line bg-white"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = { color: eraser ? '#FFFFFF' : color, width: eraser ? 18 : 3, points: [at(e)] };
        }}
        onPointerMove={(e) => {
          const s = drawing.current;
          if (!s) return;
          const p = at(e);
          line(s.points[s.points.length - 1]!, p, s);
          s.points.push(p);
        }}
        onPointerUp={() => {
          const s = drawing.current;
          drawing.current = null;
          if (s && s.points.length > 1) meet.draw(s);
        }}
      />
      <div className="flex items-center gap-1.5">
        <button type="button" aria-pressed={!eraser} onClick={() => setEraser(false)} className={cx('h-8 rounded-[8px] px-3 text-[12px] font-semibold', !eraser ? 'bg-primary text-white' : 'border border-line text-ink')}>Pen</button>
        <button type="button" aria-pressed={eraser} onClick={() => setEraser(true)} className={cx('h-8 rounded-[8px] px-3 text-[12px] font-semibold', eraser ? 'bg-primary text-white' : 'border border-line text-ink')}>Eraser</button>
        {COLORS.map((c) => (
          <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={color === c && !eraser} onClick={() => (setColor(c), setEraser(false))} className={cx('h-5 w-5 rounded-full border-2', color === c && !eraser ? 'border-primary' : 'border-transparent')} style={{ background: c }} />
        ))}
        <span className="flex-1" />
        <button type="button" onClick={() => meet.draw(null)} className="h-8 rounded-[8px] border border-line px-3 text-[12px] font-semibold text-ink hover:bg-subtle">Clear board</button>
      </div>
    </div>
  );
}

function FilesPanel({ roomId }: { roomId: number | null }) {
  const q = useQuery({
    queryKey: ['chat', 'shared', String(roomId)],
    queryFn: ({ signal }) => apiGet<{ files: Array<{ message_id: number; sender_name: string; created_at: string; file?: ChatFile }>; media: Array<{ message_id: number; file?: ChatFile; created_at: string; sender_name: string }> }>(`/api/chat/rooms/${roomId}/shared`, undefined, signal),
    enabled: !!roomId,
    refetchInterval: 15_000,
  });
  if (!roomId) return <Empty icon="file" title="This meeting has no conversation to share files in" />;
  const files = [...(q.data?.files ?? []), ...(q.data?.media ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const share = async () => {
    try {
      const picked = await call('files:pickFiles', { multiple: true, title: 'Share files with the meeting' });
      if (picked.length) await call('transfers:upload', { handles: picked.map((p) => p.handle), target: { kind: 'chat', roomId: String(roomId) } });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <div className="flex flex-col gap-2 p-3.5 text-[12.5px]">
      {q.isLoading ? <Spinner /> : null}
      {!q.isLoading && !files.length ? <p className="text-ink-3">Nothing shared yet.</p> : null}
      {files.map((f) => (
        <div key={f.message_id} className="flex items-center gap-2.5 rounded-[9px] border border-line px-2.5 py-2">
          <FileBadge name={f.file?.filename ?? 'file'} size={30} />
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate text-ink">{f.file?.filename}</b>
            <span className="text-[11px] text-ink-3">{f.file ? bytes(f.file.size) : ''} · {f.sender_name} · {dateLabel(f.created_at)}</span>
          </span>
        </div>
      ))}
      <button type="button" onClick={() => void share()} className="h-9 rounded-[8px] border border-line font-semibold text-ink hover:bg-subtle">Share a file from this computer</button>
    </div>
  );
}

function InfoPanel() {
  const info = meet.info!;
  const [chat, setChat] = useState(false);
  const text = invitation({ title: info.title, join_url: info.join_url, code: info.meeting_id, passcode: info.passcode }, info.host_name);
  const copy = (v: string, what: string) => void navigator.clipboard.writeText(v).then(() => toast('success', `${what} copied.`));
  const rows: Array<[string, string]> = [
    ['Meeting link', info.join_url],
    ...(info.meeting_id ? ([['Meeting ID', formatCode(info.meeting_id)]] as Array<[string, string]>) : []),
    ...(info.passcode ? ([['Passcode', info.passcode]] as Array<[string, string]>) : []),
  ];
  return (
    <div className="flex flex-col gap-3 p-3.5 text-[12.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5">
          <span className="text-ink-3">{k}</span>
          <span className="flex items-center gap-2">
            <b className="min-w-0 flex-1 truncate text-ink selectable">{v.replace(/^https?:\/\//, '')}</b>
            <button type="button" onClick={() => copy(v, k)} className="text-[12px] font-semibold text-primary hover:underline">Copy</button>
          </span>
        </div>
      ))}
      <b className="text-ink">Share via</b>
      <ShareRow text={text} m={{ uuid: info.uuid, title: info.title }} onChat={() => setChat(true)} copy={copy} />
      {meet.isHost ? (
        <label className="flex flex-col gap-1">
          <b className="text-ink">Access</b>
          <Select value={meet.locked ? 'locked' : 'ask'} onChange={(e) => void meet.lock(e.target.value === 'locked')} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-ink">
            <option value="ask">Ask to join (host admits)</option>
            <option value="locked">Locked — no new participants</option>
          </Select>
        </label>
      ) : null}
      {chat ? <ShareInChat text={text} onClose={() => setChat(false)} /> : null}
    </div>
  );
}
