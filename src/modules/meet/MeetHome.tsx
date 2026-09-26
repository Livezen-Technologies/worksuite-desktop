import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import qrcode from 'qrcode-generator';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { bytes, dateLabel, dayKey, parseTs, relative, timeLabel, todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Button, Empty, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import type { Room } from '../chat/types';
import { useNow } from '../calls/parts';
import { ScheduleDialog } from '../meetings/ScheduleDialog';
import { createMeeting, formatCode, invitation, openMeeting, parseMeetingInput, resolveCode, type Created, type HistoryRow, type Recording, type UpcomingRow } from './api';

/** WorkSuite Meet — home (MeetHome): start, join, what is coming up, what happened, recordings. */
export function MeetHome() {
  useTabTitle('Meet');
  const { navigate } = useTab();
  const me = useStore(app, (s) => s.auth?.user?.name ?? null);
  const perms = useStore(app, (s) => s.bootstrap?.permissions ?? []);
  const meetings = useStore(app, (s) => s.apps.some((a) => a.id === 'meetings'));
  const [menu, setMenu] = useState(false);
  const [code, setCode] = useState('');
  const [created, setCreated] = useState<Created | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [busy, setBusy] = useState(false);
  const upcoming = useQuery({ queryKey: ['meet', 'upcoming'], queryFn: ({ signal }) => apiGet<{ meetings: UpcomingRow[] }>('/api/meet/upcoming', undefined, signal), refetchInterval: 60_000 });
  const history = useQuery({ queryKey: ['meet', 'history'], queryFn: ({ signal }) => apiGet<{ meetings: HistoryRow[] }>('/api/meet/history', undefined, signal) });
  const canSchedule = perms.includes('*') || perms.includes('meeting.schedule');
  const now = useNow(60_000);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const instant = () => run(async () => {
    setMenu(false);
    const m = await createMeeting({ title: 'Instant meeting' });
    await openMeeting(m.uuid, m.title);
  });
  const later = () => run(async () => {
    setMenu(false);
    setCreated(await createMeeting({ later: true, title: `${me ? `${me.split(' ')[0]}'s` : 'A'} meeting` }));
  });
  const join = () => run(async () => {
    const what = parseMeetingInput(code);
    if (!what) return;
    const uuid = 'uuid' in what ? what.uuid : (await resolveCode(what.code)).uuid;
    await openMeeting(uuid);
    setCode('');
  });

  const live = (upcoming.data?.meetings ?? []).filter((u) => (history.data?.meetings ?? []).some((h) => h.uuid === u.uuid && h.status === 'live'));
  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <main className="grid min-h-full gap-7 px-9 py-7 text-[13px] [grid-template-columns:1fr_1.1fr]">
        <div className="flex flex-col gap-[18px]">
          <span className="text-[12px] font-bold tracking-[0.7px] text-teal">WORKSUITE MEET</span>
          <h1 className="text-[34px] leading-[1.2] font-bold tracking-[-0.6px] text-ink">Video meetings for your team</h1>
          <p className="text-[14px] leading-[1.6] text-ink-2">Start now, schedule for later, or join with a code. Meetings open in their own window with screen share, recording, whiteboard and chat.</p>
          <div className="relative flex items-center gap-2.5">
            <button type="button" aria-haspopup="menu" aria-expanded={menu} disabled={busy} onClick={() => setMenu(!menu)} className="h-11 shrink-0 rounded-[10px] bg-primary px-[18px] text-[14px] font-bold text-white hover:bg-primary-hover">
              New meeting ⌄
            </button>
            <form
              className="flex min-w-0 flex-1 gap-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                void join();
              }}
            >
              <input value={code} onChange={(e) => setCode(e.target.value)} aria-label="Meeting code or link" placeholder="Enter a code or meeting link" className="h-11 min-w-0 flex-1 rounded-[10px] border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-primary" />
              <button type="submit" disabled={busy || !code.trim()} className="h-11 rounded-[10px] border border-primary px-4 font-bold text-primary hover:bg-selection disabled:opacity-50">
                Join
              </button>
            </form>
            {menu ? (
              <div role="menu" aria-label="New meeting" className="absolute top-12 left-0 z-20 flex w-[360px] flex-col rounded-[12px] border border-line bg-surface p-1.5 shadow-[0_14px_36px_rgb(var(--ws-shadow-rgb)/.18)]">
                <MenuItem title="Start an instant meeting" hint="Join now and invite people from inside" onClick={() => void instant()} />
                <MenuItem title="Create a meeting for later" hint="Get a link and code to share" onClick={() => void later()} />
                <MenuItem title="Schedule a meeting" hint={canSchedule ? 'Invite people; it shows in Calendar' : 'Needs the "Schedule meetings" permission'} disabled={!canSchedule} onClick={() => (setMenu(false), setScheduling(true))} />
              </div>
            ) : null}
          </div>
          <Recordings />
        </div>
        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface px-[18px] py-4">
            <div className="flex items-center">
              <h2 className="flex-1 text-[15px] font-bold text-ink">Upcoming</h2>
              {meetings ? <button type="button" onClick={() => navigate('/meetings')} className="text-[12px] font-semibold text-primary hover:underline">All meetings</button> : null}
            </div>
            {upcoming.isLoading ? <Spinner /> : upcoming.error ? <ErrorNote error={upcoming.error} onRetry={() => void upcoming.refetch()} /> : null}
            {!upcoming.isLoading && !upcoming.data?.meetings.length ? <p className="py-2 text-ink-3">Nothing scheduled.</p> : null}
            {(upcoming.data?.meetings ?? []).slice(0, 6).map((u) => {
              const isLive = live.some((l) => l.uuid === u.uuid);
              const soon = parseTs(u.scheduled_at).getTime() - now < 15 * 60_000;
              const day = dayKey(parseTs(u.scheduled_at));
              return (
                <div key={u.uuid} className={cx('flex items-center gap-3 rounded-[10px] px-3 py-2.5', isLive ? 'bg-selection' : 'bg-subtle')}>
                  <span className="w-[74px] shrink-0 font-mono text-[12px] font-semibold text-primary">{day === todayInZone() ? timeLabel(u.scheduled_at) : `${dateLabel(u.scheduled_at).replace(/, \d{4}$/, '')}`}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <b className="truncate text-ink">{u.title || 'Meeting'}</b>
                    <span className="truncate text-[11.5px] text-ink-3">{isLive ? 'Now · Meet' : `${u.people} invited`}{u.host_name && !u.is_host ? ` · ${u.host_name}` : ''}</span>
                  </span>
                  {isLive ? <span className="rounded-[10px] bg-danger-bg px-2 py-0.5 text-[11px] font-bold text-danger">Live now</span> : null}
                  <span className="text-[11px] font-semibold text-ink-2">{u.is_host ? 'You host' : 'Invited'}</span>
                  {isLive || soon || !u.record_id || !meetings ? (
                    <button type="button" onClick={() => void openMeeting(u.uuid, u.title)} className={cx('h-[30px] rounded-[7px] px-3 text-[12px] font-bold', isLive || soon ? 'bg-primary text-white' : 'border border-line bg-surface text-ink')}>
                      Join
                    </button>
                  ) : (
                    <button type="button" onClick={() => navigate(`/meetings?meeting=${u.record_id}`)} className="h-[30px] rounded-[7px] border border-line bg-surface px-3 text-[12px] font-bold text-ink">
                      Details
                    </button>
                  )}
                </div>
              );
            })}
          </section>
          <section className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-[18px] py-4">
            <h2 className="text-[15px] font-bold text-ink">Recent</h2>
            {history.isLoading ? <Spinner /> : history.error ? <ErrorNote error={history.error} onRetry={() => void history.refetch()} /> : null}
            {!history.isLoading && !history.data?.meetings.length ? <p className="py-2 text-ink-3">No meetings yet.</p> : null}
            {(history.data?.meetings ?? []).slice(0, 8).map((h) => (
              <RecentRow key={h.uuid} h={h} onChat={(id) => navigate(`/chat?room=${id}`)} />
            ))}
          </section>
        </div>
      </main>
      {created ? <CreatedDialog m={created} host={me} onClose={() => setCreated(null)} /> : null}
      {scheduling ? <ScheduleDialog onClose={() => setScheduling(false)} online /> : null}
    </div>
  );
}

function MenuItem({ title, hint, onClick, disabled }: { title: string; hint: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className="flex flex-col gap-0.5 rounded-[8px] px-3 py-2.5 text-left hover:bg-selection disabled:opacity-50">
      <b className="text-ink">{title}</b>
      <span className="text-[12px] text-ink-3">{hint}</span>
    </button>
  );
}

function minutes(h: HistoryRow): string | null {
  if (!h.started_at || !h.ended_at) return null;
  const m = Math.round((parseTs(h.ended_at).getTime() - parseTs(h.started_at).getTime()) / 60_000);
  return m > 0 ? `${m} min` : null;
}

function RecentRow({ h, onChat }: { h: HistoryRow; onChat: (roomId: number) => void }) {
  const meta = [
    relative(h.started_at ?? h.created_at),
    minutes(h),
    h.people.length ? `${h.people.length} ${h.people.length === 1 ? 'person' : 'people'}` : null,
    h.status === 'live' ? 'live now' : h.status === 'not_started' ? 'not started' : null,
    h.recording ? 'recorded' : null,
  ].filter(Boolean);
  return (
    <div className="flex items-center gap-2.5 border-b border-line py-[7px] last:border-0">
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-ink">{h.title || 'Meeting'}</b>
        <span className="truncate text-[11.5px] text-ink-3">{meta.join(' · ')}</span>
      </span>
      <span className="flex shrink-0 gap-2 text-[12px] font-semibold text-primary">
        {h.status !== 'ended' ? <button type="button" className="hover:underline" onClick={() => void openMeeting(h.uuid, h.title)}>Join</button> : null}
        {h.room_id ? <button type="button" className="hover:underline" onClick={() => onChat(h.room_id!)}>Open chat</button> : null}
        <button type="button" className="hover:underline" onClick={() => void navigator.clipboard.writeText(h.join_url).then(() => toast('success', 'Meeting link copied.'))}>
          Copy meeting link
        </button>
      </span>
    </div>
  );
}

function Recordings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['meet', 'recordings'], queryFn: ({ signal }) => apiGet<{ recordings: Recording[] }>('/api/meet/recordings', undefined, signal), refetchInterval: 60_000 });
  const [renaming, setRenaming] = useState<Recording | null>(null);
  const [deleting, setDeleting] = useState<Recording | null>(null);
  const [title, setTitle] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['meet', 'recordings'] });
  const rename = useMutation({ mutationFn: (r: Recording) => apiPut(`/api/meet/recordings/${r.id}`, { title }), onSuccess: () => (setRenaming(null), refresh()), onError: (e) => toast('error', errorMessage(e)) });
  const remove = useMutation({ mutationFn: (r: Recording) => apiDelete(`/api/meet/recordings/${r.id}`), onSuccess: () => (setDeleting(null), refresh(), toast('success', 'Recording deleted.')), onError: (e) => toast('error', errorMessage(e)) });
  const download = (r: Recording) => void call('transfers:download', { recording: r.id, name: `${(r.title || 'Meeting recording').replace(/[\\/:*?"<>|]/g, '-').slice(0, 200)}.mp4` }).catch((e) => toast('error', errorMessage(e)));
  return (
    <section className="mt-auto flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-[18px] py-4">
      <div className="flex items-center">
        <h2 className="flex-1 text-[15px] font-bold text-ink">Recordings</h2>
        <span className="text-[12px] text-ink-3">Only you can see your recordings</span>
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {!q.isLoading && !q.data?.recordings.length ? <Empty icon="video" title="No recordings" hint="Record a meeting you host from its controls." /> : null}
      {(q.data?.recordings ?? []).map((r) => (
        <div key={r.id} className="flex items-center gap-2.5 border-b border-line py-2 last:border-0">
          <span className="h-[34px] w-14 shrink-0 rounded-[6px] bg-[#D8E4F6] dark:bg-selection" aria-hidden />
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate text-ink">{r.title || 'Meeting recording'}</b>
            <span className="text-[11.5px] text-ink-3">{dateLabel(r.created_at)}{r.size ? ` · ${bytes(r.size)}` : ''}</span>
          </span>
          <span className={cx('text-[11.5px] font-bold', r.ready ? 'text-success' : 'text-[#9A4A06] dark:text-warning')}>{r.ready ? 'Ready' : 'Processing'}</span>
          <span className="flex shrink-0 gap-1.5 text-[12px] font-semibold text-primary">
            <button type="button" className="hover:underline" onClick={() => (setTitle(r.title), setRenaming(r))}>Rename</button>·
            <button type="button" className="hover:underline disabled:opacity-50" disabled={!r.ready} onClick={() => download(r)}>Download</button>·
            <button type="button" className="text-danger hover:underline" onClick={() => setDeleting(r)}>Delete</button>
          </span>
        </div>
      ))}
      {renaming ? (
        <Modal title="Rename recording" onClose={() => setRenaming(null)} width={420} footer={<><Button onClick={() => setRenaming(null)}>Cancel</Button><Button variant="primary" loading={rename.isPending} disabled={!title.trim()} onClick={() => rename.mutate(renaming)}>Save</Button></>}>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Recording name" maxLength={190} className="h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary" />
        </Modal>
      ) : null}
      {deleting ? (
        <Modal title="Delete this recording?" onClose={() => setDeleting(null)} width={420} footer={<><Button onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(deleting)}>Delete</Button></>}>
          <p className="text-[13px] text-ink-2">“{deleting.title}” is deleted for good. It cannot be recovered.</p>
        </Modal>
      ) : null}
    </section>
  );
}

/** A QR code as SVG squares — no markup from a string. */
export function QrCode({ text, size = 132 }: { text: string; size?: number }) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) cells.push([c, r]);
  return (
    <svg width={size} height={size} viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label="QR code to join" className="rounded-[8px] bg-white">
      {cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill="#151A2D" />)}
    </svg>
  );
}

/** Your meeting link is ready (MeetCreated). */
export function CreatedDialog({ m, host, onClose }: { m: Created; host: string | null; onClose: () => void }) {
  const [sharing, setSharing] = useState(false);
  const text = invitation(m, host);
  const copy = (value: string, what: string) => void navigator.clipboard.writeText(value).then(() => toast('success', `${what} copied.`));
  const rows: Array<[string, string, string]> = [
    ['Meeting link', m.join_url.replace(/^https?:\/\//, ''), 'Copy link'],
    ['Meeting ID', formatCode(m.code), 'Copy meeting ID'],
    ...(m.passcode ? ([['Password', m.passcode, 'Copy password']] as Array<[string, string, string]>) : []),
  ];
  return (
    <Modal title="Your meeting link is ready" onClose={onClose} width={640} footer={<><Button onClick={onClose}>Later</Button><Button variant="primary" onClick={() => (onClose(), void openMeeting(m.uuid, m.title))}>Join now</Button></>}>
      <div className="flex flex-col gap-4 text-[13px]">
        <span className="text-ink-3">{m.title || 'Meeting'} · you host</span>
        <div className="flex gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {rows.map(([k, v, a]) => (
              <div key={k} className="flex items-center gap-2.5 rounded-[9px] border border-line px-3 py-2">
                <span className="w-24 shrink-0 text-ink-3">{k}</span>
                <span className="min-w-0 flex-1 truncate font-mono font-semibold text-ink selectable">{v}</span>
                <button type="button" onClick={() => copy(k === 'Meeting link' ? m.join_url : v, k)} className="shrink-0 text-[12px] font-semibold text-primary hover:underline">{a}</button>
              </div>
            ))}
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <QrCode text={m.join_url} />
            <span className="text-[11.5px] text-ink-3">Scan to join</span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <b className="text-ink">Invitation</b>
          <div className="whitespace-pre-wrap rounded-[9px] bg-subtle px-3 py-2.5 text-ink-2 selectable">{text}</div>
        </div>
        <ShareRow text={text} m={m} onChat={() => setSharing(true)} copy={copy} />
      </div>
      {sharing ? <ShareInChat text={text} onClose={() => setSharing(false)} /> : null}
    </Modal>
  );
}

export function ShareRow({ text, m, onChat, copy }: { text: string; m: { uuid: string; title?: string | null }; onChat: () => void; copy: (v: string, what: string) => void }) {
  const btn = 'h-8 rounded-[8px] border border-line bg-surface px-3 text-[12px] font-semibold text-ink hover:bg-subtle';
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={btn} onClick={() => copy(text, 'Invitation')}>Copy invitation</button>
      <button type="button" className={btn} onClick={() => void call('app:openExternal', { url: `mailto:?subject=${encodeURIComponent(m.title || 'WorkSuite meeting')}&body=${encodeURIComponent(text)}` })}>Email invite</button>
      <button type="button" className={btn} onClick={onChat}>Share in chat</button>
      <button type="button" className={btn} onClick={() => void call('app:openExternal', { url: `https://wa.me/?text=${encodeURIComponent(text)}` })}>WhatsApp</button>
      <button type="button" className={btn} onClick={() => void call('app:openInBrowser', { path: `/meet/${m.uuid}` })}>Open link</button>
    </div>
  );
}

/** Post the invitation into a conversation. */
export function ShareInChat({ text, onClose }: { text: string; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const rooms = useQuery({ queryKey: ['chat', 'rooms', 'share'], queryFn: ({ signal }) => apiGet<{ rooms: Room[] }>('/api/chat/rooms', undefined, signal) });
  const needle = q.trim().toLowerCase();
  const list = (rooms.data?.rooms ?? []).filter((r) => r.type !== 'widget' && (!needle || r.name.toLowerCase().includes(needle))).slice(0, 40);
  const send = async (r: Room) => {
    setBusy(true);
    try {
      await apiPost('/api/chat/messages', { room_id: r.id, message: text, client_message_id: `desktop-${crypto.randomUUID()}` });
      toast('success', `Shared in ${r.name}.`);
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Share in chat" onClose={onClose} width={420}>
      <div className="flex flex-col gap-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search conversations" placeholder="Search conversations…" className="h-9 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary" />
        <div className="max-h-72 overflow-y-auto scroll-thin">
          {rooms.isLoading ? <Spinner /> : null}
          {list.map((r) => (
            <button key={r.id} type="button" disabled={busy} onClick={() => void send(r)} className="block w-full truncate rounded-[8px] px-2 py-1.5 text-left text-[13px] text-ink hover:bg-subtle">
              {r.name}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
