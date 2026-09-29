import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Button, Modal, Spinner, cx } from '../../components/ui';
import { isMac } from '../../core/bridge';
import { toast } from '../../core/toasts';
import type { DeskScanOutcome, ScanView } from '@shared/event-desk';
import { at, eGet, errorText, K, type Summary } from './api';
import { printQueued, useBadge } from './badge';
import { Camera, cameraAvailable } from './camera';
import { DK, deskScan, deskSync, useDeskStatus, usePrintSettings } from './desk';
import { Counter, Key, Refusal, ResultPanel, useEvent } from './parts';
import { usePhoneJobs } from './phone-jobs';
import SearchPanel from './SearchPanel';
import TakePayment from './TakePayment';
import WalkIn from './WalkIn';

/**
 * Event Desk Mode (Events SRS §15.2, EV-POR-010..012; §9.1–9.3): the event's
 * name, a large scan area that has the keyboard's focus, the result in its
 * colour, live counters, Search, Walk-in and Print badge, and whether
 * WorkSuite answers — operable by the scanner and the keyboard alone.
 *
 * A USB or Bluetooth scanner is a keyboard: it types the code into the scan
 * field and presses Enter. A typed registration number works the same way
 * (EV-CHK-003). Enter in an empty field presses the result's main button
 * (Check in, Check out). F2 / Alt+S search, F3 / Alt+W walk-in, F4 / Alt+P
 * print the badge, F6 / Alt+O switches check-in and check-out, Esc clears.
 *
 * Every scan goes to the main process (event-desk.ts): to the server with this
 * computer's device and gate, or — WorkSuite out of reach — to the desk's own
 * copy, answered with the server's rules and kept for WorkSuite.
 */

type Mode = 'in' | 'out';

interface Shown {
  outcome: DeskScanOutcome;
  /** What was scanned, to act on the result (check in, pay, print) without scanning again. */
  subject: { code: string } | { registration_id: number };
  at: number;
}

const KEYS: Record<string, 'search' | 'walkin' | 'print' | 'mode'> = { F2: 'search', F3: 'walkin', F4: 'print', F6: 'mode' };
const ALT_KEYS: Record<string, 'search' | 'walkin' | 'print' | 'mode'> = { KeyS: 'search', KeyW: 'walkin', KeyP: 'print', KeyO: 'mode' };

/** A short tone for the result (EV-CHK-010 "optional sound"): high for in, low for a refusal. */
function beep(ok: boolean): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.08;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.12 : 0.35));
    o.onended = () => void ctx.close();
  } catch {
    /* no sound on this computer */
  }
}

export default function Desk({ active }: { active: boolean }) {
  const ev = useEvent();
  const { event, may, online } = ev;
  const qc = useQueryClient();
  const status = useDeskStatus(event.id);
  const reg = status.data?.registration ?? null;
  const settings = usePrintSettings();
  const [mode, setMode] = useState<Mode>(may('events.checkin.use') ? 'in' : 'out');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const [panel, setPanel] = useState<'search' | 'walkin' | 'pay' | 'camera' | null>(null);
  const [sound, setSound] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const badge = useBadge(event.id, reg?.device_id ?? null);

  const summary = useQuery({
    queryKey: [...K.live(event.id), 'summary'],
    queryFn: ({ signal }) => eGet<Summary>(`/events/${event.id}/checkin/summary`, undefined, signal),
    enabled: online && may('events.checkin.use'),
    refetchInterval: 10_000,
  });

  usePhoneJobs(event.id, reg?.device_id ?? null, settings.data ?? null, active && online && may('events.badge.print'));

  const focusScan = useCallback(() => {
    requestAnimationFrame(() => input.current?.focus());
  }, []);

  useEffect(() => {
    if (active && !panel) focusScan();
  }, [active, panel, focusScan]);

  const run = useCallback(
    async (subject: Shown['subject'], how: 'scan' | 'check_in' | 'check_out') => {
      if (!reg) return;
      setBusy(true);
      try {
        const outcome = await deskScan(event.id, subject, how);
        setShown({ outcome, subject, at: Date.now() });
        if (sound) beep(outcome.source !== 'refused' && outcome.view.result === 'VALID');
        if (outcome.source === 'server' && outcome.badge?.id) void printQueued(event.id, [outcome.badge.id]);
        void qc.invalidateQueries({ queryKey: K.live(event.id) });
        void qc.invalidateQueries({ queryKey: DK.all });
      } catch (e) {
        toast('error', errorText(e, 'The scan was not taken.'));
      } finally {
        setBusy(false);
        focusScan();
      }
    },
    [reg, event.id, sound, qc, focusScan],
  );

  const view: ScanView | null = shown && shown.outcome.source !== 'refused' ? shown.outcome.view : null;
  const primary: 'check_in' | 'check_out' | null = view?.options.includes('check_in') ? 'check_in' : view && mode === 'out' && view.options.includes('check_out') ? 'check_out' : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    setCode('');
    if (c === '') {
      if (shown && primary) void run(shown.subject, primary);
      return;
    }
    void run({ code: c }, mode === 'in' ? 'scan' : 'check_out');
  };

  const printBadge = useCallback(() => {
    const r = view?.registration;
    if (!r || !view.options.includes('print_badge')) {
      toast('info', view?.registration ? 'This badge cannot be printed from here.' : 'Scan or find someone first, then print their badge.');
      return;
    }
    badge.print(r.id, view.attendee?.name ?? r.number);
  }, [view, badge]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (panel) return;
      /* A scanner types wherever the focus is: a key pressed with nothing to type into goes to the scan field (EV-POR-012). */
      const inField = e.target instanceof Element && !!e.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]');
      if (!inField && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        input.current?.focus();
        return;
      }
      let k = KEYS[e.key];
      if (!k && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (isMac && e.target instanceof Element && e.target !== input.current && e.target.closest('input, textarea')) return;
        k = ALT_KEYS[e.code];
      }
      if (e.key === 'Escape' && !panel) {
        setShown(null);
        setCode('');
        focusScan();
        return;
      }
      if (!k) return;
      e.preventDefault();
      if (k === 'search') setPanel('search');
      else if (k === 'walkin' && may('events.walkin.create')) setPanel('walkin');
      else if (k === 'print') printBadge();
      else if (k === 'mode' && may('events.checkin.use') && may('events.checkout.use')) setMode((m) => (m === 'in' ? 'out' : 'in'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, panel, may, printBadge, focusScan]);

  const fullScreen = () => {
    const el = root.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen().catch(() => toast('info', 'Full screen is not available here.'));
  };

  const st = status.data;
  const offlineNote = !online ? (st?.offline_blocked ? `Offline — ${st.offline_blocked}: scans are refused until WorkSuite is back.` : st?.copy ? 'Offline — answering from this computer’s copy of the event; scans are kept and sent when WorkSuite is back.' : 'Offline — this computer has no copy of the event yet, so it cannot check anyone in.') : null;

  if (status.isLoading) return <Spinner label="Opening the desk…" />;
  if (!reg) {
    return (
      <div className="flex flex-col gap-4 px-6 py-6">
        <h1 className="m-0 text-[20px] font-bold text-ink">Check-in desk</h1>
        {st?.wiped ? <Refusal text={st.wiped} /> : null}
        <div className="flex max-w-[640px] items-start gap-3 rounded-[12px] border border-line bg-surface p-5">
          <Icon name="laptop" size={20} className="mt-0.5 text-primary" />
          <div className="flex flex-col gap-2">
            <b className="text-[14px] text-ink">Register this computer at a gate first</b>
            <p className="m-0 text-[13px] text-ink-2">
              A desk checks people in as one of the event’s devices. Registering it gives it the key to its offline copy, kept in this computer’s credential store — never shown.
            </p>
            <div>
              <Button variant="primary" icon="plus" onClick={() => ev.go('setup')}>
                Register this computer
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={root} className="flex min-h-full flex-col bg-ground">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[22px] font-extrabold text-ink">{event.name}</div>
          <div className="text-[12.5px] text-ink-2">
            {reg.device_name}
            {reg.gate_name ? ` · ${reg.gate_name}` : ' · no gate'}
            {st?.device ? ` · ${st.device.status_label}` : ''}
          </div>
        </div>
        <ConnectionChip online={online} status={st} onSync={() => void deskSync(event.id).then(() => qc.invalidateQueries({ queryKey: DK.all }), (e) => toast('error', errorText(e)))} />
        <Button size="sm" icon={sound ? 'volume' : 'volume-off'} onClick={() => setSound((s) => !s)} aria-pressed={sound}>
          {sound ? 'Sound on' : 'Sound off'}
        </Button>
        <Button size="sm" icon="fullscreen" onClick={fullScreen}>
          Full screen
        </Button>
      </header>
      {offlineNote ? (
        <div role="status" className="flex items-center gap-2 border-b border-line bg-warning-bg px-6 py-1.5 text-[12.5px] font-medium text-warning">
          <Icon name="cloud-off" size={14} /> {offlineNote}
        </div>
      ) : null}
      {st?.problem ? (
        <div className="px-6 pt-3">
          <Refusal text={st.problem.message}>{st.problem.code === 'device_key_missing' ? <span>Give the desk a new key under This computer.</span> : null}</Refusal>
        </div>
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] gap-5 px-6 py-5">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex items-center gap-2" role="radiogroup" aria-label="What a scan does">
            {may('events.checkin.use') ? (
              <ModeButton on={mode === 'in'} icon="log-in" onClick={() => setMode('in')}>
                Check in
              </ModeButton>
            ) : null}
            {may('events.checkout.use') ? (
              <ModeButton on={mode === 'out'} icon="logout" onClick={() => setMode('out')}>
                Check out
              </ModeButton>
            ) : null}
            <span className="ml-auto text-[11.5px] text-ink-3">
              <Key>F6</Key> switches
            </span>
          </div>
          <form onSubmit={submit} className={cx('flex items-center gap-3 rounded-[18px] border-2 bg-surface px-5 py-4', mode === 'in' ? 'border-primary' : 'border-warning')}>
            <Icon name="scan" size={34} className={mode === 'in' ? 'text-primary' : 'text-warning'} />
            <input
              ref={input}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-label={mode === 'in' ? 'Scan a ticket or type a registration number to check in' : 'Scan a ticket or type a registration number to check out'}
              placeholder={mode === 'in' ? 'Scan a ticket, or type its registration number' : 'Scan to check out'}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-[26px] font-bold text-ink outline-none placeholder:text-[20px] placeholder:font-medium placeholder:text-ink-3"
            />
            {busy ? <Icon name="spinner" size={24} className="animate-spin-slow text-ink-3" /> : null}
            {cameraAvailable() ? (
              <Button icon="camera" onClick={() => setPanel('camera')}>
                Camera
              </Button>
            ) : null}
          </form>

          {shown ? (
            shown.outcome.source === 'refused' ? (
              <section aria-live="assertive" className="flex flex-col gap-2 rounded-[16px] border-2 border-danger/40 bg-danger-bg p-5 text-danger">
                <div className="flex items-center gap-3">
                  <Icon name="x-circle" size={40} strokeWidth={2.2} />
                  <div className="text-[20px] font-bold">{shown.outcome.message}</div>
                </div>
              </section>
            ) : (
              <ResultPanel view={shown.outcome.view} local={shown.outcome.source === 'local'} message={shown.outcome.message}>
                <div className="flex flex-wrap gap-2">
                  {primary ? (
                    <Button variant={primary === 'check_in' ? 'success' : 'primary'} size="lg" icon={primary === 'check_in' ? 'log-in' : 'logout'} loading={busy} onClick={() => void run(shown.subject, primary)}>
                      {primary === 'check_in' ? 'Check in' : 'Check out'} <Key>Enter</Key>
                    </Button>
                  ) : null}
                  {mode === 'in' && shown.outcome.view.options.includes('check_out') && primary !== 'check_out' && may('events.checkout.use') ? (
                    <Button size="lg" icon="logout" onClick={() => void run(shown.subject, 'check_out')}>
                      Check out
                    </Button>
                  ) : null}
                  {shown.outcome.view.options.includes('take_payment') && online ? (
                    <Button size="lg" icon="credit-card" onClick={() => setPanel('pay')}>
                      Take payment
                    </Button>
                  ) : null}
                  {shown.outcome.view.options.includes('print_badge') && online ? (
                    <Button size="lg" icon="printer" loading={badge.busy} onClick={printBadge}>
                      Print badge <Key>F4</Key>
                    </Button>
                  ) : null}
                </div>
              </ResultPanel>
            )
          ) : (
            <div className="grid flex-1 place-items-center rounded-[16px] border-2 border-dashed border-line py-16 text-center text-ink-3">
              <div>
                <Icon name="scan" size={48} className="mx-auto" />
                <div className="mt-2 text-[16px] font-semibold">{mode === 'in' ? 'Ready to scan' : 'Ready to check people out'}</div>
                <div className="text-[12.5px]">A scanner types into the field above; so can you.</div>
              </div>
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-3" aria-label="Counters and actions">
          <div className="grid grid-cols-2 gap-2">
            <Counter label="Inside" value={summary.data?.inside} big />
            <Counter label="Checked in" value={summary.data?.checked_in} hint={summary.data ? `of ${summary.data.expected} expected` : undefined} big />
          </div>
          {summary.data ? (
            <div className="rounded-[12px] border border-line bg-surface px-4 py-2.5 text-[12.5px] text-ink-2">
              Today: <b className="text-ink">{summary.data.today.checked_in}</b> in · <b className="text-ink">{summary.data.today.checked_out}</b> out · <b className="text-ink">{summary.data.today.denied}</b> refused · <b className="text-ink">{summary.data.today.walk_ins}</b> walk-ins
            </div>
          ) : !online ? (
            <div className="rounded-[12px] border border-line bg-surface px-4 py-2.5 text-[12.5px] text-ink-3">The counters are WorkSuite’s: they come back with the line.</div>
          ) : null}
          <DeskButton icon="search" keys={['F2', 'Alt+S']} onClick={() => setPanel('search')}>
            Search
          </DeskButton>
          {may('events.walkin.create') ? (
            <DeskButton icon="user-plus" keys={['F3', 'Alt+W']} onClick={() => setPanel('walkin')}>
              Walk-in
            </DeskButton>
          ) : null}
          {may('events.badge.print') ? (
            <DeskButton icon="printer" keys={['F4', 'Alt+P']} onClick={printBadge} disabled={!online}>
              Print badge
            </DeskButton>
          ) : null}
          <QueueNote status={st} onOpen={() => ev.go('review')} />
        </aside>
      </div>

      {panel === 'search' ? (
        <Modal title="Find an attendee" onClose={() => setPanel(null)} width={640}>
          <SearchPanel
            onPick={(hit) => {
              setPanel(null);
              void run({ registration_id: hit.registration_id }, mode === 'in' ? 'scan' : 'check_out');
            }}
          />
        </Modal>
      ) : null}
      {panel === 'walkin' ? (
        <WalkIn
          deviceId={reg.device_id}
          gateId={reg.gate_id}
          onClose={() => setPanel(null)}
          onDone={(outcome) => {
            setPanel(null);
            if (outcome) setShown({ outcome, subject: outcome.source !== 'refused' && outcome.view.registration ? { registration_id: outcome.view.registration.id } : { code: '' }, at: Date.now() });
            focusScan();
          }}
        />
      ) : null}
      {panel === 'pay' && view?.registration ? (
        <TakePayment
          registrationId={view.registration.id}
          who={view.attendee?.name ?? view.registration.number}
          onClose={() => setPanel(null)}
          onPaid={() => {
            setPanel(null);
            if (shown) void run(shown.subject, 'scan');
          }}
        />
      ) : null}
      {panel === 'camera' ? (
        <Camera
          onClose={() => setPanel(null)}
          onCode={(c) => {
            setPanel(null);
            void run({ code: c }, mode === 'in' ? 'scan' : 'check_out');
          }}
        />
      ) : null}
      {badge.dialog}
    </div>
  );
}

function ModeButton({ on, icon, onClick, children }: { on: boolean; icon: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cx('inline-flex h-9 items-center gap-2 rounded-[10px] border px-4 text-[13.5px] font-bold', on ? 'border-primary bg-selection text-primary' : 'border-line bg-surface text-ink-2 hover:bg-subtle')}
    >
      <Icon name={icon} size={16} /> {children}
    </button>
  );
}

function DeskButton({ icon, keys, onClick, disabled, children }: { icon: string; keys: string[]; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex h-14 items-center gap-3 rounded-[12px] border border-line bg-surface px-4 text-left text-[16px] font-bold text-ink hover:border-primary disabled:opacity-50">
      <Icon name={icon} size={22} className="text-primary" />
      <span className="flex-1">{children}</span>
      <span className="flex gap-1">
        {keys.map((k) => (
          <Key key={k}>{k}</Key>
        ))}
      </span>
    </button>
  );
}

/** Online or not, the last sync and what waits — always in sight (EV-OFF-007). */
function ConnectionChip({ online, status, onSync }: { online: boolean; status: ReturnType<typeof useDeskStatus>['data']; onSync: () => void }) {
  const waiting = (status?.waiting ?? 0) + (status?.rejected ?? 0);
  return (
    <div className={cx('flex items-center gap-2 rounded-[10px] border px-3 py-1.5 text-[12.5px] font-semibold', online ? 'border-success/30 bg-success-bg text-success' : 'border-warning/40 bg-warning-bg text-warning')} role="status">
      <Icon name={online ? 'wifi' : 'wifi-off'} size={15} />
      <span>{online ? 'Online' : 'Offline'}</span>
      <span className="font-medium text-ink-2">
        · {waiting} waiting
        {status?.last_sync ? ` · synced ${at(status.last_sync.at)}` : status?.copy ? ` · copy ${at(status.copy.pulled_at)}` : ''}
      </span>
      <button type="button" onClick={onSync} className="rounded-[6px] px-1 text-ink-2 hover:bg-white/40 hover:text-ink" title="Send what waits and catch up now">
        <Icon name="refresh" size={14} />
      </button>
    </div>
  );
}

function QueueNote({ status, onOpen }: { status: ReturnType<typeof useDeskStatus>['data']; onOpen: () => void }) {
  if (!status) return null;
  const n = status.waiting + status.rejected;
  return (
    <div className="mt-auto flex flex-col gap-1 rounded-[12px] border border-line bg-surface px-4 py-3 text-[12.5px] text-ink-2">
      <b className="text-ink">This desk</b>
      <span>
        {status.copy ? `Offline copy: ${status.copy.rows} tickets of this gate, updated ${at(status.copy.pulled_at)}` : status.offline_blocked ? `No offline copy: ${status.offline_blocked}.` : 'No offline copy yet.'}
      </span>
      <span>
        {n === 0 ? 'Nothing waits for WorkSuite.' : `${n} scan${n === 1 ? '' : 's'} wait${n === 1 ? 's' : ''} for WorkSuite${status.rejected ? ` (${status.rejected} refused)` : ''}.`}
        {status.others ? ` ${status.others} made by someone else wait for them.` : ''}
      </span>
      {status.flagged ? <span className="font-semibold text-warning">{status.flagged} possible duplicate or conflict from offline scans.</span> : null}
      <button type="button" onClick={onOpen} className="mt-1 self-start text-[12.5px] font-semibold text-primary hover:underline">
        Review offline scans
      </button>
    </div>
  );
}
