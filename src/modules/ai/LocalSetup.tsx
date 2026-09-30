import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { call, errorMessage } from '../../core/bridge';
import { bytes } from '../../core/time';
import { suggestedModel, useLocalModels } from '../../core/local-ai';
import { toast } from '../../core/toasts';

const DISMISSED = 'ws.ai.localSetup.dismissed';

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
}

/**
 * First-use Local AI setup in the assistant (worksuite-desktop#55): while nothing is set up on this computer, the
 * model that suits it (Gemma 3 4B when the server offers it) with its size, what it needs and its licence, and one
 * button that downloads it, checks it and tries it. The download's progress, pause and the readiness check show
 * here as they happen; "Not now" hides the offer (Settings → Local AI still has it).
 */
export function LocalSetup() {
  const models = useLocalModels();
  const [hidden, setHidden] = useState(dismissed);
  const [busy, setBusy] = useState(false);
  const all = models.data ?? [];
  // The model being set up, once one is, so its progress stays in view until it is ready.
  const active = all.find((m) => m.model.purpose === 'chat' && (m.state === 'downloading' || m.state === 'verifying' || m.state === 'paused' || m.state === 'failed' || (m.state === 'installed' && m.readiness !== 'ready' && m.readiness !== 'untested')));
  const v = active ?? suggestedModel(all);
  if (hidden || !v) return null;
  const m = v.model;
  const pct = m.bytes ? Math.min(100, Math.round((v.received / m.bytes) * 100)) : 0;
  const go = (p: Promise<unknown>) => {
    setBusy(true);
    void p.catch((e) => toast('error', errorMessage(e))).finally(() => setBusy(false));
  };
  const hide = () => {
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {
      /* shown again next time */
    }
    setHidden(true);
  };

  return (
    <section aria-label="Set up Local AI" className="space-y-2 rounded-[12px] border border-line bg-subtle/60 p-3 text-[12.5px]">
      <div className="flex items-start gap-2">
        <Icon name="cpu" size={16} className="mt-0.5 shrink-0 text-ink-2" />
        <div className="min-w-0 flex-1">
          <b className="block text-[13px] text-ink">Answer on this computer too</b>
          <span className="text-ink-3">
            {m.name} · version {m.version} · {bytes(m.bytes)} download · needs about {bytes(m.minMemoryBytes)} of memory{v.fits ? '' : ' (may be slow here)'}
          </span>
        </div>
        {v.state === 'available' ? (
          <button type="button" aria-label="Not now" title="Not now" onClick={hide} className="shrink-0 rounded-[6px] p-0.5 text-ink-3 hover:bg-subtle hover:text-ink">
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </div>
      {v.state === 'available' || v.state === 'failed' ? (
        <p className="text-[11.5px] text-ink-3">
          Licence:{' '}
          <button type="button" className="text-primary hover:underline" onClick={() => void call('app:openExternal', { url: m.license.url })}>
            {m.license.name}
          </button>
          . {m.notice ?? 'By downloading it you accept its terms.'}
        </p>
      ) : null}
      {v.error ? <p className="text-danger">{v.error}</p> : null}
      {v.state === 'installed' && v.readiness === 'failed' ? <p className="text-danger">It downloaded, but did not answer on this computer: {v.readinessError}</p> : null}
      {v.state === 'downloading' || v.state === 'paused' ? (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className={v.state === 'paused' ? 'h-full rounded-full bg-ink-3' : 'h-full rounded-full bg-primary transition-[width]'} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-[11.5px] text-ink-3">
            {v.state === 'paused' ? 'Paused' : 'Downloading'} · {bytes(v.received)} of {bytes(m.bytes)} ({pct}%)
          </div>
        </div>
      ) : null}
      {v.state === 'verifying' ? <p className="flex items-center gap-1.5 text-ink-2"><Icon name="spinner" size={13} className="animate-spin" /> Checking the file…</p> : null}
      {v.state === 'installed' && v.readiness === 'testing' ? <p className="flex items-center gap-1.5 text-ink-2"><Icon name="spinner" size={13} className="animate-spin" /> Setting it up: loading the model and trying it…</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {v.state === 'available' || v.state === 'failed' ? (
          <button type="button" disabled={busy} onClick={() => go(call('ai:localInstall', { id: m.id }))} className="h-7 rounded-[7px] bg-primary px-2.5 text-[12px] font-bold text-white hover:bg-primary-hover disabled:opacity-60">
            {v.state === 'failed' ? 'Try again' : 'Download and set up'}
          </button>
        ) : null}
        {v.state === 'downloading' ? (
          <>
            <button type="button" onClick={() => go(call('ai:localCancelInstall', { id: m.id }))} className="h-7 rounded-[7px] border border-line px-2.5 text-[12px] font-semibold text-ink hover:bg-subtle">Pause</button>
            <button type="button" onClick={() => go(call('ai:localCancelInstall', { id: m.id, discard: true }))} className="h-7 rounded-[7px] px-2.5 text-[12px] font-semibold text-ink-2 hover:bg-subtle">Cancel</button>
          </>
        ) : null}
        {v.state === 'paused' ? (
          <>
            <button type="button" onClick={() => go(call('ai:localInstall', { id: m.id }))} className="h-7 rounded-[7px] bg-primary px-2.5 text-[12px] font-bold text-white hover:bg-primary-hover">Resume</button>
            <button type="button" onClick={() => go(call('ai:localCancelInstall', { id: m.id, discard: true }))} className="h-7 rounded-[7px] px-2.5 text-[12px] font-semibold text-ink-2 hover:bg-subtle">Cancel</button>
          </>
        ) : null}
        {v.state === 'installed' && v.readiness === 'failed' ? (
          <button type="button" disabled={busy} onClick={() => go(call('ai:localTest', { id: m.id }))} className="h-7 rounded-[7px] border border-line px-2.5 text-[12px] font-semibold text-ink hover:bg-subtle disabled:opacity-60">Test again</button>
        ) : null}
      </div>
    </section>
  );
}
