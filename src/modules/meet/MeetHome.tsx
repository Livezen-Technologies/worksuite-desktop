import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import qrcode from 'qrcode-generator';
import { useCanOpen } from '../../core/access';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { bytes, dateLabel, listStamp, timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { mediaUrl } from '../files/api';
import { localRecordingStatus, serverRecordingStatus } from '@shared/recording-status';
import type { Room } from '../chat/types';
import { useNow } from '../calls/parts';
import { PopMenu, below, type MenuItem } from '../files/Menu';
import { ScheduleDialog } from '../meetings/ScheduleDialog';
import { createMeeting, formatCode, invitation, openMeeting, resolveCode, type Created, type HistoryRow, type Recording, type UpcomingRow } from './api';
import { DeviceSettings, Preview, useMeetDevices } from './devices';
import { transferAct, useLocalRecordings, useTransfers } from './recordings';
import { RecordingStatusView } from './RecordingStatus';
import { RecordingProgress } from './RecordingProgress';
import { byDay, checkMeetingInput, dayHeading, historyJoinable, lengthLabel, meetingMinutes, scheduledMinutes, upcomingJoinable } from './home';
import { useMeetT, type MKey } from './i18n';

/**
 * WorkSuite Meet — home (worksuite-desktop#67): starting and joining first — New meeting (start now, a link for
 * later, schedule in Calendar) and a code or link box with its Join — then what is coming up, what happened and
 * the recordings, each compact with See all. A row has one action (Join, when the meeting can be joined) and a ⋯
 * menu for the rest. Camera and microphone are checked before any meeting, from here or the pre-join screen.
 */
export function MeetHome() {
  const t = useMeetT();
  useTabTitle('Meet');
  const { navigate } = useTab();
  const me = useStore(app, (s) => s.auth?.user?.name ?? null);
  const perms = useStore(app, (s) => s.bootstrap?.permissions ?? []);
  // Meetings (details, scheduling) and Chat (a meeting's conversation) are other apps: offered only to whoever has them.
  const meetings = useCanOpen('meetings');
  const chat = useCanOpen('chat');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<MKey | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<'new' | 'join' | null>(null);
  const upcoming = useQuery({ queryKey: ['meet', 'upcoming'], queryFn: ({ signal }) => apiGet<{ meetings: UpcomingRow[] }>('/api/meet/upcoming', undefined, signal), refetchInterval: 60_000 });
  const history = useQuery({ queryKey: ['meet', 'history'], queryFn: ({ signal }) => apiGet<{ meetings: HistoryRow[] }>('/api/meet/history', undefined, signal) });
  const canSchedule = perms.includes('*') || perms.includes('meeting.schedule');
  const now = useNow(60_000);

  const run = async (what: 'new' | 'join', fn: () => Promise<void>) => {
    // One at a time: a second Start now while the first is starting would make a second meeting.
    if (busy) return;
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const instant = () =>
    run('new', async () => {
      const m = await createMeeting({ title: 'Instant meeting' });
      await openMeeting(m.uuid, m.title);
    });
  const later = () => run('new', async () => setCreated(await createMeeting({ later: true, title: `${me ? `${me.split(' ')[0]}'s` : 'A'} meeting` })));
  const join = async () => {
    const what = checkMeetingInput(code);
    if (!what) return;
    if ('error' in what) return setCodeError(what.error);
    setCodeError(null);
    setBusy('join');
    try {
      let uuid: string;
      if ('uuid' in what) uuid = what.uuid;
      else {
        const r = await resolveCode(what.code);
        if (r.ended) return setCodeError('err.ended');
        uuid = r.uuid;
      }
      await openMeeting(uuid);
      setCode('');
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 422)) setCodeError('err.noSuchCode');
      else toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const liveIds = new Set((history.data?.meetings ?? []).filter((h) => h.status === 'live').map((h) => h.uuid));
  const newItems: MenuItem[] = [
    { label: t('home.startNow'), hint: t('home.startNowHint'), icon: 'video', run: () => void instant() },
    { label: t('home.later'), hint: t('home.laterHint'), icon: 'link', run: () => void later() },
    ...(meetings ? [{ label: t('home.schedule'), hint: canSchedule ? t('home.scheduleHint') : t('home.scheduleNoPermission'), icon: 'calendar', disabled: !canSchedule, run: () => setScheduling(true) }] : []),
  ];

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <main className="mx-auto flex max-w-[1240px] flex-col gap-5 px-5 py-6 text-[13px] sm:px-8 lg:py-7">
        <section className="grid items-center gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-3.5">
            <span className="text-[12px] font-bold tracking-[0.7px] text-teal uppercase">{t('home.eyebrow')}</span>
            <h1 className="text-[30px] leading-[1.15] font-bold tracking-[-0.6px] text-ink sm:text-[34px]">{t('home.title')}</h1>
            <p className="text-[14.5px] leading-[1.55] text-ink-2">{t('home.subtitle')}</p>
            <div className="mt-1 flex flex-wrap items-start gap-2.5">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={!!menu}
                disabled={busy === 'new'}
                onClick={(e) => setMenu(below(e.currentTarget, 'left', 320))}
                className="flex h-11 shrink-0 items-center gap-1.5 rounded-[10px] bg-primary px-[18px] text-[14px] font-bold text-white hover:bg-primary-hover disabled:opacity-70"
              >
                {busy === 'new' ? <Icon name="spinner" size={16} className="animate-spin" /> : <Icon name="video" size={16} />}
                {t('home.new')}
                <Icon name="chevron-down" size={15} />
              </button>
              <form
                className="flex min-w-[260px] flex-1 flex-col gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  void join();
                }}
              >
                <div className="flex gap-2.5">
                  <label className={cx('flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[10px] border bg-surface px-3 text-ink-3 focus-within:border-primary', codeError ? 'border-danger' : 'border-line')}>
                    <Icon name="link" size={15} />
                    <input
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value);
                        setCodeError(null);
                      }}
                      aria-label={t('home.codeLabel')}
                      aria-invalid={!!codeError}
                      aria-describedby={codeError ? 'meet-code-error' : undefined}
                      placeholder={t('home.codePlaceholder')}
                      className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none"
                    />
                  </label>
                  <button type="submit" disabled={busy === 'join' || !code.trim()} className="h-11 shrink-0 rounded-[10px] border border-primary px-4 text-[14px] font-bold text-primary hover:bg-selection disabled:opacity-50">
                    {busy === 'join' ? t('home.joining') : t('home.join')}
                  </button>
                </div>
                {codeError ? (
                  <p id="meet-code-error" role="alert" className="flex items-center gap-1.5 text-[12.5px] text-danger">
                    <Icon name="alert" size={13} /> {t(codeError)}
                  </p>
                ) : null}
              </form>
            </div>
            <button type="button" onClick={() => setChecking(true)} className="flex items-center gap-1.5 self-start rounded-[7px] px-1 py-0.5 text-[13px] font-semibold text-primary hover:underline">
              <Icon name="settings" size={14} /> {t('home.checkDevices')}
            </button>
          </div>
          <figure className="hidden flex-col items-center gap-2 lg:flex">
            <Illustration />
            <figcaption className="text-[13px] text-ink-2">{t('home.tagline')}</figcaption>
          </figure>
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <Card title={t('home.upcoming')} action={meetings ? { label: t('home.allMeetings'), run: () => navigate('/meetings') } : undefined}>
            {upcoming.isLoading ? <Spinner /> : upcoming.error ? <ErrorNote error={upcoming.error} onRetry={() => void upcoming.refetch()} /> : null}
            {upcoming.isSuccess && !upcoming.data.meetings.length ? (
              <EmptyState icon="calendar" title={t('home.nothingScheduled')} hint={t('home.nothingScheduledHint')} action={meetings && canSchedule ? { label: t('home.scheduleMeeting'), run: () => setScheduling(true) } : undefined} />
            ) : null}
            {byDay((upcoming.data?.meetings ?? []).slice(0, 6)).map((g) => (
              <div key={g.day} className="flex flex-col">
                <span className="pt-1 pb-1.5 text-[12px] font-semibold text-ink-3">{dayHeading(g.rows[0]!.scheduled_at, { today: t('home.today'), tomorrow: t('home.tomorrow') })}</span>
                {g.rows.map((u) => (
                  <UpcomingCard key={u.uuid} u={u} live={liveIds.has(u.uuid)} joinable={upcomingJoinable(u, now, liveIds.has(u.uuid))} onDetails={meetings && u.record_id ? () => navigate(`/meetings?meeting=${u.record_id}`) : undefined} />
                ))}
              </div>
            ))}
          </Card>
          <RecentCard history={history} onChat={chat ? (id) => navigate(`/chat?room=${id}`) : undefined} onStart={() => void instant()} />
        </div>
        <Recordings />
      </main>
      {menu ? <PopMenu at={menu} width={320} stacked items={newItems} label={t('home.new')} onClose={() => setMenu(null)} /> : null}
      {created ? <CreatedDialog m={created} host={me} onClose={() => setCreated(null)} /> : null}
      {scheduling ? <ScheduleDialog onClose={() => setScheduling(false)} online /> : null}
      {checking ? <DeviceCheck name={me ?? ''} onClose={() => setChecking(false)} /> : null}
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: { label: string; run: () => void }; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-1 rounded-[14px] border border-line bg-surface px-4 py-3.5 sm:px-5">
      <div className="flex items-center gap-2 pb-1">
        <h2 className="flex-1 text-[15.5px] font-bold text-ink">{title}</h2>
        {action ? (
          <button type="button" onClick={action.run} className="flex items-center gap-0.5 rounded-[6px] px-1 text-[12.5px] font-semibold text-primary hover:underline">
            {action.label} <Icon name="chevron-right" size={14} />
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ icon, title, hint, action }: { icon: string; title: string; hint: string; action?: { label: string; run: () => void } }) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] bg-subtle px-3.5 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-surface text-ink-3">
        <Icon name={icon} size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[13px] text-ink">{title}</b>
        <span className="text-[12px] text-ink-3">{hint}</span>
      </span>
      {action ? (
        <button type="button" onClick={action.run} className="h-8 shrink-0 rounded-[8px] border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

function IconTile({ icon }: { icon: string }) {
  return (
    <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-line bg-subtle text-ink-2">
      <Icon name={icon} size={17} />
    </span>
  );
}

function UpcomingCard({ u, live, joinable, onDetails }: { u: UpcomingRow; live: boolean; joinable: boolean; onDetails?: () => void }) {
  const t = useMeetT();
  const length = lengthLabel(scheduledMinutes(u));
  return (
    <div className={cx('flex items-center gap-3 border-t border-line py-2.5', live && 'rounded-[10px] border-transparent bg-selection px-2')}>
      <IconTile icon="calendar" />
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-[13.5px] text-ink">{u.title || 'Meeting'}</b>
        <span className="truncate text-[12px] text-ink-3">
          {[timeLabel(u.scheduled_at), length, u.is_host ? t('home.youHost') : u.host_name ? t('home.hostedBy', { name: u.host_name }) : null].filter(Boolean).join(' · ')}
        </span>
      </span>
      {u.people ? (
        <span className="hidden shrink-0 items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-[11.5px] font-semibold text-ink-2 sm:flex" title={t('home.invited', { n: u.people })}>
          <Icon name="users" size={12} /> {u.people}
        </span>
      ) : null}
      {live ? <span className="shrink-0 rounded-full bg-danger-bg px-2 py-0.5 text-[11px] font-bold text-danger">{t('home.liveNow')}</span> : null}
      {joinable ? (
        <button type="button" onClick={() => void openMeeting(u.uuid, u.title)} className="h-9 shrink-0 rounded-[9px] bg-primary px-4 text-[13px] font-bold text-white hover:bg-primary-hover">
          {t('home.join')}
        </button>
      ) : onDetails ? (
        <button type="button" onClick={onDetails} className="h-9 shrink-0 rounded-[9px] border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle">
          {t('home.openDetails')}
        </button>
      ) : null}
    </div>
  );
}

function RecentCard({ history, onChat, onStart }: { history: ReturnType<typeof useQuery<{ meetings: HistoryRow[] }>>; onChat?: (roomId: number) => void; onStart: () => void }) {
  const t = useMeetT();
  const [all, setAll] = useState(false);
  const rows = history.data?.meetings ?? [];
  const shown = all ? rows : rows.slice(0, 4);
  return (
    <Card title={t('home.recent')} action={rows.length > 4 ? { label: all ? t('home.showFewer') : t('home.seeAll'), run: () => setAll(!all) } : undefined}>
      {history.isLoading ? <Spinner /> : history.error ? <ErrorNote error={history.error} onRetry={() => void history.refetch()} /> : null}
      {history.isSuccess && !rows.length ? <EmptyState icon="video" title={t('home.noRecent')} hint={t('home.noRecentHint')} action={{ label: t('home.startMeeting'), run: onStart }} /> : null}
      {shown.map((h) => (
        <RecentRow key={h.uuid} h={h} onChat={onChat} />
      ))}
    </Card>
  );
}

/** The words under a past meeting: when, how long (when that can be told), how many, and how it stands. */
export function recentMeta(h: HistoryRow, t: ReturnType<typeof useMeetT>): string {
  const n = h.people.length;
  return [
    listStamp(h.started_at ?? h.created_at),
    lengthLabel(meetingMinutes(h.started_at, h.ended_at)),
    n ? (n === 1 ? t('home.person') : t('home.people', { n })) : null,
    h.status === 'live' ? t('home.liveNow') : h.status === 'not_started' ? t('home.notStarted') : null,
    h.recording ? t('home.recorded') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function RecentRow({ h, onChat }: { h: HistoryRow; onChat?: (roomId: number) => void }) {
  const t = useMeetT();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const joinable = historyJoinable(h);
  const chat = h.room_id && onChat ? () => onChat(h.room_id!) : null;
  const copy = (value: string, done: string) => void navigator.clipboard.writeText(value).then(() => toast('success', done));
  const items: MenuItem[] = [
    ...(chat && joinable ? [{ label: t('home.openChat'), icon: 'chat', run: chat }] : []),
    { label: t('home.copyLink'), icon: 'link', run: () => copy(h.join_url, t('home.linkCopied')) },
    ...(h.code ? [{ label: t('home.copyCode'), icon: 'copy', run: () => copy(h.code!, t('home.codeCopied')) }] : []),
  ];
  const title = h.title || 'Meeting';
  return (
    <div className="flex items-center gap-3 border-t border-line py-2.5">
      <IconTile icon={h.status === 'live' ? 'video' : 'calendar'} />
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-[13.5px] text-ink">{title}</b>
        <span className="truncate text-[12px] text-ink-3">{recentMeta(h, t)}</span>
      </span>
      {joinable ? (
        <button type="button" onClick={() => void openMeeting(h.uuid, h.title)} className="h-8 shrink-0 rounded-[8px] bg-primary px-3.5 text-[12.5px] font-bold text-white hover:bg-primary-hover">
          {t('home.join')}
        </button>
      ) : chat ? (
        <button type="button" aria-label={t('home.openChat')} title={t('home.openChat')} onClick={chat} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle hover:text-ink">
          <Icon name="chat" size={16} />
        </button>
      ) : null}
      <button type="button" aria-label={t('home.moreFor', { title })} title={t('home.moreFor', { title })} aria-haspopup="menu" aria-expanded={!!menu} onClick={(e) => setMenu(below(e.currentTarget, 'right', 220))} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle hover:text-ink">
        <Icon name="more-vertical" size={16} />
      </button>
      {menu ? <PopMenu at={menu} width={220} items={items} label={t('home.moreFor', { title })} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

function Recordings() {
  const t = useMeetT();
  const qc = useQueryClient();
  const { navigate } = useTab();
  const now = useNow(15_000);
  const q = useQuery({
    queryKey: ['meet', 'recordings'],
    queryFn: ({ signal }) => apiGet<{ recordings: Recording[] }>('/api/meet/recordings', undefined, signal),
    // Faster while one is still being finished, so it shows Ready soon after it is.
    refetchInterval: (query) => (query.state.data?.recordings.some((r) => r.status && r.status !== 'ready' && r.status !== 'failed') ? 10_000 : 60_000),
  });
  // Recordings made on this computer, step by step (worksuite-desktop#68), with their uploads and downloads (#89).
  const local = useLocalRecordings();
  const transfers = useTransfers();
  const [all, setAll] = useState(false);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; r: Recording } | null>(null);
  const [renaming, setRenaming] = useState<Recording | null>(null);
  const [deleting, setDeleting] = useState<Recording | null>(null);
  const [title, setTitle] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['meet', 'recordings'] });
  const rename = useMutation({ mutationFn: (r: Recording) => apiPut(`/api/meet/recordings/${r.id}`, { title }), onSuccess: () => (setRenaming(null), refresh()), onError: (e) => toast('error', errorMessage(e)) });
  const remove = useMutation({ mutationFn: (r: Recording) => apiDelete(`/api/meet/recordings/${r.id}`), onSuccess: () => (setDeleting(null), refresh(), toast('success', 'Recording removed.')), onError: (e) => toast('error', errorMessage(e)) });
  // A cloud recording that did not reach Drive is filed again while the server still has its whole file (#89).
  const retryCloud = (r: Recording) => void apiPost(`/api/meet/recordings/${r.id}/retry`).then(refresh, (e) => toast('error', errorMessage(e)));
  const fileName = (r: Recording) => `${(r.title || 'Meeting recording').replace(/[\\/:*?"<>|]/g, '-').slice(0, 200)}.mp4`;
  const download = (r: Recording, open = false) =>
    void (r.drive_file_id ? call('transfers:download', { fileId: String(r.drive_file_id), forRecording: r.id, name: fileName(r), open }) : call('transfers:download', { recording: r.id, name: fileName(r), open }))
      .then(() => qc.invalidateQueries({ queryKey: ['meet', 'recording-downloads'] }))
      .catch((e) => toast('error', errorMessage(e)));
  // Play: a recording in Drive opens in Drive's player; one from before plays from a copy downloaded here.
  const play = (r: Recording) => (r.drive_file_id ? navigate(`/files?file=${r.drive_file_id}&play=1`) : download(r, true));
  const localAct = (fn: () => Promise<unknown>) => () => void fn().catch((e) => toast('error', errorMessage(e)));
  const transferOf = (id: string | null | undefined) => (id ? (transfers.find((x) => x.id === id) ?? null) : null);
  const rows = q.data?.recordings ?? [];
  const working = local.filter((r) => r.state !== 'ready');
  const shown = all ? rows : rows.slice(0, 3);
  return (
    <Card title={t('home.recordings')} action={rows.length > 3 ? { label: all ? t('home.showFewer') : t('home.seeAll'), run: () => setAll(!all) } : undefined}>
      {working.length ? (
        <div className="flex flex-col gap-2 pb-2">
          {working.map((r) => {
            const tr = r.transferId ?? null;
            const status = localRecordingStatus(r, transferOf(tr), now);
            return (
              <div key={r.id} className="flex flex-col gap-1.5 rounded-[12px] border border-line p-2.5">
                <div className="flex items-center gap-2">
                  <Icon name={status.phase === 'failed' ? 'alert' : 'laptop'} size={16} className={status.phase === 'failed' ? 'text-danger' : 'text-ink-3'} />
                  <b className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{r.title}</b>
                  <span className="text-[12px] text-ink-3">On this computer{r.bytes ? ` · ${bytes(r.bytes)}` : ''}</span>
                </div>
                <RecordingStatusView
                  status={status}
                  on={{
                    retry: localAct(() => call('meetrec:retry', { id: r.id })),
                    reveal: localAct(() => call('meetrec:reveal', { id: r.id })),
                    play: localAct(() => call('meetrec:open', { id: r.id })),
                    ...(tr ? { pause: transferAct('transfers:pause', tr), resume: transferAct('transfers:resume', tr), cancel: transferAct('transfers:cancel', tr) } : {}),
                  }}
                />
              </div>
            );
          })}
          <span className="text-[11.5px] text-ink-3">Finishing and uploading go on in the background while you work. Quitting WorkSuite pauses them until you open it again. Cancelling an upload never deletes the recording from this computer.</span>
        </div>
      ) : null}
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isSuccess && !rows.length && !working.length ? <EmptyState icon="video" title={t('home.noRecordings')} hint={t('home.noRecordingsHint')} /> : null}
      {rows.length ? (
        <>
          <div className="grid gap-3 pt-1 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((r) => {
              const name = r.title || 'Meeting recording';
              // The copy kept on this computer, when this computer recorded it.
              const mine = r.drive_file_id ? local.find((x) => x.driveFileId === r.drive_file_id && x.fileName) : undefined;
              const base = serverRecordingStatus(r);
              const status = mine ? { ...base, savedLocally: true, actions: [...base.actions, 'reveal' as const] } : base;
              return (
                <div key={r.id} className="flex min-w-0 items-start gap-3 rounded-[12px] border border-line p-2.5">
                  <button
                    type="button"
                    disabled={!status.playable}
                    aria-label={`Play ${name}`}
                    title={status.playable ? 'Play' : status.label}
                    onClick={() => play(r)}
                    className="relative flex h-[60px] w-[96px] shrink-0 items-center justify-center overflow-hidden rounded-[9px] bg-[#D8E4F6] text-[#24365F] disabled:cursor-default dark:bg-selection dark:text-ink"
                  >
                    {r.thumbnail_url && status.playable ? <img src={mediaUrl(r.thumbnail_url) ?? undefined} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : null}
                    <Icon name={status.playable ? 'play' : status.phase === 'failed' ? 'alert' : 'clock'} size={20} className="relative" />
                  </button>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <b className="truncate text-[13.5px] text-ink">{name}</b>
                    <span className="truncate text-[12px] text-ink-3">{[dateLabel(r.created_at).replace(/, \d{4}$/, ''), r.size ? bytes(r.size) : null, r.duration ? `${Math.floor(r.duration / 60)}:${String(r.duration % 60).padStart(2, '0')}` : null, r.method === 'local' ? 'Recorded on a computer' : null].filter(Boolean).join(' · ')}</span>
                    <RecordingProgress recording={r} />
                  </span>
                  <button type="button" aria-label={t('home.moreFor', { title: name })} title={t('home.moreFor', { title: name })} aria-haspopup="menu" onClick={(e) => setMenu({ at: below(e.currentTarget, 'right', 200), r })} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle hover:text-ink">
                    <Icon name="more-vertical" size={16} />
                  </button>
                </div>
              );
            })}
          </div>
          <span className="pt-1.5 text-[11.5px] text-ink-3">{t('home.onlyYou')}</span>
        </>
      ) : null}
      {menu ? (
        <PopMenu
          at={menu.at}
          width={200}
          label={t('home.moreFor', { title: menu.r.title || 'Meeting recording' })}
          onClose={() => setMenu(null)}
          items={[
            { label: t('home.download'), icon: 'download', disabled: !serverRecordingStatus(menu.r).playable, run: () => download(menu.r) },
            ...(menu.r.status === 'failed' && menu.r.method !== 'local' ? [{ label: 'Try again', icon: 'refresh', run: () => retryCloud(menu.r) }] : []),
            ...(menu.r.drive_file_id ? [{ label: 'Open in Drive', icon: 'folder', run: () => navigate(`/files?file=${menu.r.drive_file_id}`) }] : []),
            // Its transcripts (worksuite-desktop#81) are in the meeting's details: made from here, read and emailed there.
            ...(menu.r.meeting_uuid && menu.r.ready
              ? [
                  {
                    label: 'Transcripts…',
                    icon: 'file-text',
                    run: () =>
                      void apiPost<{ id: number }>('/api/meetings/for-meet', { uuid: menu.r.meeting_uuid })
                        .then((r) => navigate(`/meetings?meeting=${r.id}&tab=Transcripts`))
                        .catch((e) => toast('error', errorMessage(e))),
                  },
                ]
              : []),
            { label: t('home.rename'), icon: 'compose', run: () => (setTitle(menu.r.title), setRenaming(menu.r)) },
            { sep: true },
            { label: t('home.delete'), icon: 'trash', danger: true, run: () => setDeleting(menu.r) },
          ]}
        />
      ) : null}
      {renaming ? (
        <Modal title="Rename recording" onClose={() => setRenaming(null)} width={420} footer={<><Button onClick={() => setRenaming(null)}>Cancel</Button><Button variant="primary" loading={rename.isPending} disabled={!title.trim()} onClick={() => rename.mutate(renaming)}>Save</Button></>}>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Recording name" maxLength={190} className="h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary" />
        </Modal>
      ) : null}
      {deleting ? (
        <Modal title="Remove this recording?" onClose={() => setDeleting(null)} width={420} footer={<><Button onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(deleting)}>Remove</Button></>}>
          <p className="text-[13px] text-ink-2">
            {deleting.drive_file_id ? `“${deleting.title}” is removed from this list. The copy in your Drive stays — delete it there if you no longer need it.` : `“${deleting.title}” is deleted for good. It cannot be recovered.`}
          </p>
        </Modal>
      ) : null}
    </Card>
  );
}

/** "Check camera and microphone": the same preview and settings as the pre-join screen; the choice is remembered. */
function DeviceCheck({ name, onClose }: { name: string; onClose: () => void }) {
  const t = useMeetT();
  const d = useMeetDevices(true);
  return (
    <Modal title={t('dev.checkTitle')} onClose={onClose} width={640} footer={<Button variant="primary" onClick={onClose}>{t('dev.done')}</Button>}>
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] text-ink-3">{t('dev.checkHint')}</p>
        <Preview d={d} name={name} />
        <DeviceSettings d={d} />
      </div>
    </Modal>
  );
}

/** A light drawing of a meeting in progress, in the theme's colours. */
function Illustration() {
  return (
    <svg viewBox="0 0 420 250" role="img" aria-hidden className="h-auto w-full max-w-[440px]">
      <path d="M40 200 C10 120 70 40 140 60 C120 20 200 10 210 60" fill="none" stroke="var(--color-teal)" strokeOpacity=".35" strokeWidth="14" strokeLinecap="round" />
      <ellipse cx="360" cy="190" rx="44" ry="70" fill="var(--color-primary)" opacity=".18" transform="rotate(25 360 190)" />
      <rect x="70" y="30" width="290" height="190" rx="18" fill="var(--color-surface)" stroke="var(--color-line)" strokeWidth="2" />
      <circle cx="92" cy="50" r="4" fill="var(--color-ink-3)" />
      <circle cx="106" cy="50" r="4" fill="var(--color-ink-3)" />
      <circle cx="120" cy="50" r="4" fill="var(--color-ink-3)" />
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${84 + i * 90} 66)`}>
          <rect width="82" height="92" rx="10" fill="var(--color-primary)" opacity={0.18 + i * 0.1} />
          <circle cx="41" cy="38" r="15" fill="var(--color-surface)" opacity=".9" />
          <path d="M16 92 C18 66 64 66 66 92 Z" fill="var(--color-surface)" opacity=".9" />
        </g>
      ))}
      <circle cx="176" cy="190" r="13" fill="var(--color-subtle)" stroke="var(--color-line)" />
      <circle cx="215" cy="190" r="13" fill="var(--color-subtle)" stroke="var(--color-line)" />
      <circle cx="254" cy="190" r="13" fill="var(--color-danger)" />
      <rect x="248" y="188" width="12" height="4" rx="2" fill="#fff" />
    </svg>
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
  // Posting into a conversation is Chat's: only for whoever has it.
  const chat = useCanOpen('chat');
  const btn = 'h-8 rounded-[8px] border border-line bg-surface px-3 text-[12px] font-semibold text-ink hover:bg-subtle';
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={btn} onClick={() => copy(text, 'Invitation')}>Copy invitation</button>
      <button type="button" className={btn} onClick={() => void call('app:openExternal', { url: `mailto:?subject=${encodeURIComponent(m.title || 'WorkSuite meeting')}&body=${encodeURIComponent(text)}` })}>Email invite</button>
      {chat ? <button type="button" className={btn} onClick={onChat}>Share in chat</button> : null}
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
