import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { call, errorMessage } from '../../core/bridge';
import { suggestedModel, useLocalAIStatus, useLocalModels } from '../../core/local-ai';
import { navigate } from '../../core/tabs';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { compatibility, firstUseOffer, PROBLEM_ADVICE, problemKind, secondsLeft, STAGES, stageOf, storageNeeded, timeLeftLabel } from './setup';

/** "Not now" puts the offer away for a week; Settings → Local AI keeps it meanwhile. */
const SNOOZE = 'ws.ai.localSetup.snoozed';
const SNOOZE_MS = 7 * 24 * 3600_000;
/** The model this computer set up from here, so "ready" is said once it is (also after the panel was closed). */
const SETTING_UP = 'ws.ai.localSetup.model';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* a convenience */
  }
}
const snoozed = () => Number(read(SNOOZE) ?? 0) > Date.now() - SNOOZE_MS;

/**
 * "Set up your AI Assistant" (worksuite-desktop#49): the first time the assistant opens with no model on this
 * computer that can answer, the model that suits it — its name, download size and the space it needs — with
 * Download and Set Up and Not Now. The computer is checked first (space; memory, as a warning). A setup shows its
 * stages (Downloading → Verifying → Preparing AI → Ready) with percentage, size and time left, can be paused,
 * cancelled, resumed and tried again, and carries on in the background: close the panel and it is still there on
 * opening it. Local chat is offered only once the model has loaded and answered; then "Your AI Assistant is ready to
 * use" with Start Chatting. Once a model can answer, nothing is offered again.
 */
export function LocalSetup({ onStart }: { onStart: () => void }) {
  const models = useLocalModels();
  const status = useLocalAIStatus();
  const [hidden, setHidden] = useState(snoozed);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState(() => read(SETTING_UP));
  const all = models.data ?? [];
  const offer = firstUseOffer(all, suggestedModel(all));
  const ours = mine ? all.find((m) => m.model.id === mine) : undefined;
  const justReady = !!ours && ours.state === 'installed' && ours.readiness === 'ready';
  const v = justReady ? ours : offer;

  if (!models.data || !v) return null;
  const m = v.model;
  // An offer nobody has started can be put away; a setup under way stays in view until it is done.
  if (hidden && v.state === 'available' && !justReady) return null;

  const go = (p: Promise<unknown>) => {
    setBusy(true);
    void p.catch((e) => toast('error', errorMessage(e))).finally(() => setBusy(false));
  };
  const start = () => {
    write(SETTING_UP, m.id);
    setMine(m.id);
    go(call('ai:localInstall', { id: m.id }));
  };
  const notNow = () => {
    write(SNOOZE, String(Date.now()));
    setHidden(true);
  };
  const finish = () => {
    write(SETTING_UP, null);
    setMine(null);
    onStart();
  };

  if (justReady) {
    return (
      <section aria-label="Your AI Assistant is ready" className="space-y-2 rounded-[12px] border border-success/40 bg-success-bg p-3 text-[12.5px]">
        <div className="flex items-start gap-2">
          <Icon name="check-circle" size={18} className="mt-0.5 shrink-0 text-success" />
          <div className="min-w-0 flex-1">
            <b className="block text-[13.5px] text-ink">Your AI Assistant is ready to use</b>
            <span className="text-ink-2">{m.name} answers on this computer — nothing you ask it leaves it, also offline.</span>
          </div>
        </div>
        <button type="button" onClick={finish} className="h-8 rounded-[8px] bg-primary px-3 text-[12.5px] font-bold text-white hover:bg-primary-hover">
          Start chatting
        </button>
      </section>
    );
  }

  const hw = status.data?.hardware;
  const fit = compatibility(v, hw);
  const { stage, stopped } = stageOf(v);
  const started = v.state !== 'available';
  const pct = m.bytes ? Math.min(100, Math.round((v.received / m.bytes) * 100)) : 0;
  const readinessFailed = v.state === 'installed' && v.readiness === 'failed';
  const problem = v.state === 'failed' ? v.error : readinessFailed ? v.readinessError : null;
  const kind = problemKind(problem, readinessFailed);
  const left = v.state === 'downloading' ? timeLeftLabel(secondsLeft(v)) : null;
  const button = 'h-8 rounded-[8px] px-3 text-[12.5px] font-bold disabled:opacity-60';

  return (
    <section aria-label="Set up your AI Assistant" className="space-y-2.5 rounded-[12px] border border-line bg-subtle/60 p-3 text-[12.5px]">
      <div className="flex items-start gap-2">
        <Icon name="cpu" size={17} className="mt-0.5 shrink-0 text-ink-2" />
        <div className="min-w-0 flex-1">
          <b className="block text-[13.5px] text-ink">Set up your AI Assistant</b>
          <span className="text-ink-2">
            {m.name} · {bytes(m.bytes)} download · needs {bytes(storageNeeded({ model: m, received: 0 }))} of free space
          </span>
          {!started ? <span className="block text-ink-3">Answers on this computer, also offline; nothing you ask it leaves it.</span> : null}
        </div>
      </div>

      {!started && fit.storage ? (
        <p role="alert" className="rounded-[8px] bg-danger-bg p-2 text-danger">
          Not enough free space: it needs {bytes(storageNeeded(v))} and this computer has {bytes(fit.free ?? 0)}. Free some up, then check again.
        </p>
      ) : null}
      {!started && !fit.storage && fit.slow && hw ? (
        <p className="rounded-[8px] bg-warning-bg p-2 text-[#7A4308] dark:text-warning">
          It needs about {bytes(m.minMemoryBytes)} of memory and this computer has {bytes(Math.max(hw.memoryBytes, hw.vramBytes))}: it will work, slowly.
        </p>
      ) : null}
      {!started ? (
        <p className="text-[11.5px] text-ink-3">
          Licence:{' '}
          <button type="button" className="text-primary hover:underline" onClick={() => void call('app:openExternal', { url: m.license.url })}>
            {m.license.name}
          </button>
          . {m.notice ?? 'By downloading it you accept its terms.'}
        </p>
      ) : null}

      {started ? (
        <ol aria-label="Setup stages" className="flex items-center gap-1 text-[11.5px]">
          {STAGES.map((s, i) => {
            const at = STAGES.findIndex((x) => x.id === stage);
            const done = i < at;
            const now = i === at;
            return (
              <li key={s.id} aria-current={now ? 'step' : undefined} className={cx('flex items-center gap-1', done ? 'text-success' : now ? (stopped === 'failed' ? 'font-bold text-danger' : 'font-bold text-ink') : 'text-ink-3')}>
                <Icon name={done ? 'check-circle' : now && stopped === 'failed' ? 'alert' : now && !stopped ? 'spinner' : 'clock'} size={12} className={now && !stopped ? 'animate-spin' : ''} />
                {s.label}
                {i < STAGES.length - 1 ? <span className="mx-0.5 text-ink-3">→</span> : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {v.state === 'downloading' || v.state === 'paused' || (v.state === 'failed' && v.received > 0) ? (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Download" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={cx('h-full rounded-full', v.state === 'downloading' ? 'bg-primary transition-[width]' : 'bg-ink-3')} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-[11.5px] text-ink-3">
            {pct}% · {bytes(v.received)} of {bytes(m.bytes)}
            {v.state === 'paused' ? ' · paused' : left ? ` · ${left}` : v.state === 'downloading' ? ' · estimating time left…' : ''}
          </div>
        </div>
      ) : null}
      {v.state === 'installed' && v.readiness === 'testing' ? <p className="text-ink-2">Loading the model and trying it, to be sure it works on this computer…</p> : null}

      {problem ? (
        <div role="alert" className="space-y-0.5 rounded-[8px] bg-danger-bg p-2 text-danger">
          <b className="block font-semibold">{PROBLEM_ADVICE[kind]}</b>
          <span className="block text-[11.5px] opacity-80">{problem}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {v.state === 'available' ? (
          <>
            <button type="button" disabled={busy || fit.storage} onClick={start} className={cx(button, 'bg-primary text-white hover:bg-primary-hover')}>
              {fit.slow && !fit.storage ? 'Download and set up anyway' : 'Download and set up'}
            </button>
            {fit.storage ? (
              <button type="button" onClick={() => void status.refetch()} className={cx(button, 'border border-line text-ink hover:bg-subtle')}>Check again</button>
            ) : null}
            <button type="button" onClick={notNow} className={cx(button, 'text-ink-2 hover:bg-subtle')}>Not now</button>
          </>
        ) : null}
        {v.state === 'failed' ? (
          <button type="button" disabled={busy} onClick={start} className={cx(button, 'bg-primary text-white hover:bg-primary-hover')}>
            {kind === 'connection' && v.received > 0 ? 'Resume' : 'Try again'}
          </button>
        ) : null}
        {v.state === 'downloading' ? (
          <button type="button" onClick={() => go(call('ai:localCancelInstall', { id: m.id }))} className={cx(button, 'border border-line text-ink hover:bg-subtle')}>Pause</button>
        ) : null}
        {v.state === 'paused' ? (
          <button type="button" disabled={busy} onClick={start} className={cx(button, 'bg-primary text-white hover:bg-primary-hover')}>Resume</button>
        ) : null}
        {v.state === 'downloading' || v.state === 'paused' || v.state === 'failed' ? (
          <button type="button" onClick={() => go(call('ai:localCancelInstall', { id: m.id, discard: true }).then(() => write(SETTING_UP, null)))} className={cx(button, 'text-ink-2 hover:bg-subtle')}>Cancel</button>
        ) : null}
        {readinessFailed ? (
          <>
            <button type="button" disabled={busy} onClick={() => go(call('ai:localTest', { id: m.id }))} className={cx(button, 'bg-primary text-white hover:bg-primary-hover')}>Test again</button>
            <button type="button" onClick={() => navigate('/settings/local-ai')} className={cx(button, 'border border-line text-ink hover:bg-subtle')}>Choose another model</button>
          </>
        ) : null}
        {kind === 'storage' && v.state === 'failed' ? (
          <button type="button" onClick={() => navigate('/settings/local-ai')} className={cx(button, 'border border-line text-ink hover:bg-subtle')}>Settings → Local AI</button>
        ) : null}
      </div>
    </section>
  );
}
