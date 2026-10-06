import { useEffect, useMemo } from 'react';
import { app } from '../../../core/app-state';
import { call, hasDesktop, on } from '../../../core/bridge';
import { useStore } from '../../../core/store';
import { navigate, tabsStore } from '../../../core/tabs';
import { toast } from '../../../core/toasts';
import { useNow } from '../../../core/use-now';
import { Icon } from '../../../components/Icon';
import { Button, cx, IconButton } from '../../../components/ui';
import { clock, prettyNumber } from '../lib/format';
import { CallerBadge, Mono } from '../parts';
import { phone, type Line } from './engine';
import { runPhone, serveRemote, usePhoneState } from './client';

/**
 * The phone in the shell (VOIP-SP-01/03, design W03): held by the main window from sign-in to sign-out, so the
 * extension stays registered on every screen. It rings over any page with who is calling and what the business
 * knows about them; the call itself always lands in the one in-call screen (Phone), and a call on hold stays in
 * the dock at the bottom of every page. Native notifications and the global shortcuts (D01) are the main process's.
 */
export default function PhoneHost() {
  const locked = useStore(app, (s) => s.lock?.locked ?? false);

  useEffect(() => {
    if (hasDesktop()) {
      phone.notify = (n) => void call('phone:notify', n).catch(() => undefined);
      phone.shortcuts = (on) => void call('phone:shortcuts', { on }).catch(() => undefined);
    }
    void phone.start();
    const stopRemote = serveRemote();
    const offShortcut = hasDesktop() ? on<{ action?: string }>('phone:shortcut', (e) => {
      if (e.action === 'answer' || e.action === 'hangup' || e.action === 'mute') phone.shortcut(e.action);
    }) : () => undefined;
    return () => {
      offShortcut();
      stopRemote();
      void phone.stop();
    };
  }, []);

  useEffect(() => phone.setLocked(locked), [locked]);

  if (locked) return null;
  return <PhoneOverlays />;
}

function PhoneOverlays() {
  const lines = usePhoneState((s) => s.lines);
  const tabRoute = useStore(tabsStore, (s) => s.tabs.find((t) => t.id === s.activeId)?.route ?? '');
  const ringing = useMemo(() => lines.filter((l) => l.state === 'ringing'), [lines]);
  const talking = lines.some((l) => l.state === 'connected');
  const docked = useMemo(() => lines.filter((l) => l.state !== 'ended' && l.state !== 'ringing'), [lines]);
  const onPhonePage = tabRoute.startsWith('/phone');
  return (
    <>
      {/* While talking, the waiting call shows in the call screen's own strip (Hold & answer); elsewhere it rings here. */}
      {ringing.length && !(talking && onPhonePage) ? (
        <div className="pointer-events-none fixed top-14 right-4 z-[60] flex w-[380px] max-w-[calc(100vw-32px)] flex-col gap-2">
          {ringing.slice(0, 3).map((l) => (
            <RingToast key={l.id} line={l} waiting={talking} />
          ))}
        </div>
      ) : null}
      {docked.length && !onPhonePage ? <CallDock lines={docked} /> : null}
    </>
  );
}

/** W03: the call toast over any page — account context, Answer / To voicemail / Decline. */
function RingToast({ line, waiting }: { line: Line; waiting: boolean }) {
  const now = useNow(1000);
  const c = line.context;
  const name = line.remoteName ?? c?.contact?.name ?? c?.account?.name ?? c?.lead?.name ?? null;
  const open = c?.deals.filter((d) => d.open) ?? [];
  const overdue = c?.invoices.filter((i) => i.overdue) ?? [];
  const run = async (cmd: Parameters<typeof runPhone>[0], go?: boolean) => {
    const r = await runPhone(cmd);
    if (!r.ok) toast('error', r.message);
    else if (go) navigate('/phone');
  };
  return (
    <section role="alertdialog" aria-label={`Incoming call from ${name ?? line.remote}`} className="pointer-events-auto animate-in rounded-[14px] border border-line bg-surface p-4 shadow-2xl">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold tracking-[.3px] text-success uppercase">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
        {waiting ? 'Call waiting' : 'Incoming call'}
        {line.via ? ` · ${line.via}` : ''}
        <span className="ml-auto font-normal tracking-normal text-ink-3 normal-case">waiting {clock(Math.floor((now.getTime() - line.createdAt) / 1000))}</span>
      </div>
      <div className="flex items-center gap-3">
        <CallerBadge name={name ?? line.remote} size={44} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold text-ink">{name ?? prettyNumber(line.remote)}</div>
          <Mono className="block truncate text-[12px] text-ink-3">{prettyNumber(line.remote)}</Mono>
        </div>
      </div>
      {c?.matched ? (
        <div className="mt-2.5 flex flex-col gap-0.5 rounded-[10px] bg-subtle px-3 py-2 text-[11.5px] text-ink-2">
          <b className="text-ink">{[c.account?.name ?? c.contact?.company, c.account?.status].filter(Boolean).join(' · ') || (c.lead ? 'Lead' : 'Contact')}</b>
          {open[0] ? (
            <span>
              Open deal {open[0].name} · {open[0].currency} {Math.round(open[0].amount).toLocaleString()}
            </span>
          ) : null}
          {overdue.length ? (
            <span className="text-warning">
              {overdue.length} invoice{overdue.length === 1 ? '' : 's'} overdue · {overdue[0]!.currency} {Math.round(overdue.reduce((s, i) => s + i.outstanding, 0)).toLocaleString()}
            </span>
          ) : null}
          {c.calls[0] ? <span>Last call {c.calls[0].agent ? `with ${c.calls[0].agent}` : ''}</span> : null}
        </div>
      ) : c && c.confidence === 'none' ? (
        <div className="mt-2 text-[11.5px] text-ink-3">No contact match</div>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button variant="success" className="flex-1" onClick={() => void run({ cmd: 'answer', id: line.id }, false)} aria-keyshortcuts="Alt+Meta+A">
          {waiting ? 'Hold & answer' : 'Answer'}
        </Button>
        <Button className="flex-1" onClick={() => void run({ cmd: 'decline', id: line.id, voicemail: true })}>
          To voicemail
        </Button>
        <Button variant="danger" className="flex-1" onClick={() => void run({ cmd: 'decline', id: line.id })}>
          Decline
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-ink-3">Answering opens the call without leaving this page. It also rings on your other phones.</p>
    </section>
  );
}

/** The call dock (W03): calls in progress and on hold, on every page. */
function CallDock({ lines }: { lines: Line[] }) {
  const now = useNow(1000);
  return (
    <div className="pointer-events-none fixed bottom-10 left-1/2 z-[55] flex -translate-x-1/2 flex-col items-center gap-1.5">
      {lines.slice(0, 3).map((l) => (
        <div key={l.id} className="pointer-events-auto flex items-center gap-2.5 rounded-full bg-[#0b1220] py-1.5 pr-1.5 pl-4 text-[12.5px] text-white shadow-2xl">
          <span className={cx('h-2 w-2 rounded-full', l.held ? 'bg-[#F79009]' : l.state === 'connected' ? 'bg-[#22A861]' : 'bg-white/50')} />
          <button type="button" className="max-w-[220px] truncate font-semibold" onClick={() => navigate('/phone')} title="Open the call">
            {l.remoteName ?? prettyNumber(l.remote)}
          </button>
          <span className="text-white/60">
            {l.held ? 'On hold' : l.state === 'connected' ? '' : 'Calling…'}
            {l.state === 'connected' ? (
              <>
                {l.held ? ' · ' : ''}
                <Mono>{clock(Math.floor((now.getTime() - (l.answeredAt ?? l.createdAt)) / 1000))}</Mono>
              </>
            ) : null}
          </span>
          {l.state === 'connected' ? (
            <>
              <IconButton icon={l.muted ? 'mic-off' : 'mic'} label={l.muted ? 'Unmute' : 'Mute'} className="!h-7 !w-7 text-white hover:!bg-white/10" size={14} onClick={() => void runPhone({ cmd: 'mute', id: l.id })} />
              <Button size="sm" className="!h-7 rounded-full !border-white/15 !bg-white/10 !text-white" onClick={() => void runPhone({ cmd: 'hold', id: l.id })}>
                {l.held ? 'Resume' : 'Hold'}
              </Button>
            </>
          ) : null}
          <button type="button" aria-label="End call" onClick={() => void runPhone({ cmd: 'hangup', id: l.id })} className="flex h-7 items-center gap-1 rounded-full bg-[#D92D20] px-3 text-[12px] font-semibold text-white hover:opacity-90">
            <Icon name="phone-off" size={13} />
            End
          </button>
        </div>
      ))}
    </div>
  );
}
