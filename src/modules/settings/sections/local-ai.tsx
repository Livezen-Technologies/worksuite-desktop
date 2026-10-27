import { useStore } from '../../../core/store';
import { app } from '../../../core/app-state';
import { useStudioStatus, type StudioDiscovery, studioState, STUDIO_KEY, testStudioModel, discoverStudioModels, setStudioModels } from '../../ai/studio';
import { useState } from 'react';
import { queryClient } from '../../../core/query';
import { toast } from '../../../core/toasts';
import { errorMessage, call } from '../../../core/bridge';
import { Chip, Button, cx } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { Checkbox } from '../../../components/Checkbox';
import { useLocalAIStatus, useLocalModels, LOCAL_AI_KEY } from '../../../core/local-ai';
import { SpeechModelSettings } from '../../meet/SpeechModel';
import { bytes, relative } from '../../../core/time';
import { secondsLeft, timeLeftLabel } from '../../ai/setup';
import { Row, H } from './parts';

/** Settings › Local AI and AI Studio. */

const TIER_WORDS = { minimal: 'Minimal', basic: 'Basic', good: 'Good', strong: 'Strong' } as const;
const RUNTIME_WORDS = { off: 'Off (starts when asked)', starting: 'Starting…', ready: 'Ready', loading: 'Loading the model…', busy: 'Answering…', error: 'Stopped' } as const;

/**
 * AI Studio: the models the assistant answers with through WorkSuite (the server's connection to
 * aistudio.livezentech.com). Anyone with `ai.view` sees the connection and may try a model; `ai.settings` may
 * ask the hub which models this key can run and choose the ones this workspace offers.
 */
function AIStudioBlock() {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const has = (p: string) => !!perms && (perms.includes('*') || perms.includes(p));
  const status = useStudioStatus(has('ai.view'));
  const [busy, setBusy] = useState<string | null>(null);
  const [found, setFound] = useState<StudioDiscovery | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  if (!has('ai.view')) return null;
  const st = status.data;
  const state = studioState(st);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: STUDIO_KEY });
  const test = (m: string) => {
    setBusy(`t:${m}`);
    testStudioModel(m)
      .then((r) => toast(r.ok ? 'success' : 'error', r.ok ? `${m} answers.` : `${m}: ${r.detail}`))
      .catch((e) => toast('error', errorMessage(e)))
      .finally(() => setBusy(null));
  };
  const discover = () => {
    setBusy('discover');
    discoverStudioModels()
      .then((r) => {
        setFound(r);
        setPicked(Array.from(new Set([...r.selected.filter((m) => r.available.includes(m)), ...r.available])));
        if (!r.available.length) toast('error', 'AI Studio has no model this key may run yet.');
      })
      .catch((e) => toast('error', errorMessage(e)))
      .finally(() => setBusy(null));
  };
  const save = () => {
    setBusy('save');
    setStudioModels(picked)
      .then(() => {
        toast('success', picked.length === 1 ? 'The assistant offers 1 AI Studio model.' : `The assistant offers ${picked.length} AI Studio models.`);
        setFound(null);
        refresh();
      })
      .catch((e) => toast('error', errorMessage(e)))
      .finally(() => setBusy(null));
  };
  return (
    <>
      <Row
        label="AI Studio"
        hint={status.error ? errorMessage(status.error) : st ? (st.connected ? 'The assistant answers with these models through WorkSuite when it is not using one on this computer.' : st.detail) : 'Checking…'}
      >
        <div className="flex items-center gap-2">
          <Chip tone={state.tone}>{state.word}</Chip>
          <Button size="sm" icon="refresh" loading={status.isFetching} onClick={refresh}>
            Check
          </Button>
        </div>
      </Row>
      {st && st.models.length ? (
        <div className="border-b border-line py-2">
          {st.models.map((m) => (
            <div key={m} className="flex items-center gap-3 py-1.5">
              <Icon name="cpu" size={15} className="text-ink-3" />
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{m}</span>
              <Button size="sm" variant="ghost" loading={busy === `t:${m}`} onClick={() => test(m)}>
                Test
              </Button>
            </div>
          ))}
        </div>
      ) : st ? (
        <p className="border-b border-line py-2.5 text-[12.5px] text-ink-3">
          {has('ai.settings') ? 'This workspace offers no AI Studio model yet. Find the models already downloaded on AI Studio and choose which to offer.' : 'This workspace offers no AI Studio model yet. An administrator chooses them.'}
        </p>
      ) : null}
      {has('ai.settings') && st?.configured ? (
        <div className="border-b border-line py-2.5">
          {!found ? (
            <Button size="sm" icon="search" loading={busy === 'discover'} onClick={discover}>
              Find models on AI Studio
            </Button>
          ) : (
            <>
              <div className="mb-1.5 text-[12.5px] font-semibold text-ink">Models this key may run — tick the ones the assistant offers</div>
              {found.available.length ? (
                found.available.map((m) => (
                  <label key={m} className="flex items-center gap-2 py-1 text-[13px] text-ink">
                    <Checkbox checked={picked.includes(m)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, m] : p.filter((x) => x !== m)))} aria-label={m} />
                    <span className="font-mono">{m}</span>
                  </label>
                ))
              ) : (
                <p className="text-[12.5px] text-ink-3">None yet. {Object.values(found.results).find((r) => !r.ok)?.detail ?? ''}</p>
              )}
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="primary" disabled={!found.available.length} loading={busy === 'save'} onClick={save}>
                  Offer these
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setFound(null)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}

/** Local AI (WS-SRS-LAI): AI Studio's models through WorkSuite, and the same models downloaded to answer on this computer, also offline. */
export function LocalAISection() {
  const status = useLocalAIStatus();
  const models = useLocalModels();
  const [busy, setBusy] = useState<string | null>(null);
  const run = (key: string, p: Promise<unknown>, ok?: string) => {
    setBusy(key);
    void p
      .then(() => {
        if (ok) toast('success', ok);
        void queryClient.invalidateQueries({ queryKey: LOCAL_AI_KEY });
      })
      .catch((e) => toast('error', errorMessage(e)))
      .finally(() => setBusy(null));
  };
  const st = status.data;
  const hw = st?.hardware;
  const chat = (models.data ?? []).filter((m) => m.model.purpose === 'chat');
  return (
    <>
      <H title="Local AI" hint="The assistant answers with AI Studio's models through WorkSuite, or with one downloaded to this computer — then nothing is sent to a server, also offline. A download is checked against the file WorkSuite names before it is used." />
      <AIStudioBlock />
      <h3 className="mt-2 mb-2 text-[14px] font-bold text-ink">Speech — meeting transcripts</h3>
      <SpeechModelSettings />
      <Row
        label="This computer"
        hint={hw ? `${hw.cpuCores} cores · ${bytes(hw.memoryBytes)} memory${hw.gpu ? ` · GPU (${hw.gpu})${hw.vramBytes ? ` ${bytes(hw.vramBytes)}` : ''}` : ' · CPU only until Local AI first starts'}${hw.freeDiskBytes !== null ? ` · ${bytes(hw.freeDiskBytes)} free` : ''}` : 'Checking…'}
      >
        {hw ? <Chip tone={hw.tier === 'minimal' ? 'warning' : 'indigo'}>{TIER_WORDS[hw.tier]} tier</Chip> : null}
      </Row>
      <Row label="Local AI" hint={st?.error ?? (st?.loaded ? `Model loaded: ${chat.find((m) => m.model.id === st.loaded)?.model.name ?? st.loaded}` : 'The model loads on the first question and unloads after 10 idle minutes.')}>
        <div className="flex items-center gap-2">
          {st ? <Chip tone={st.runtime === 'error' ? 'danger' : st.runtime === 'off' ? 'muted' : 'success'}>{RUNTIME_WORDS[st.runtime]}</Chip> : null}
          <Button size="sm" icon="refresh" loading={busy === 'restart'} onClick={() => run('restart', call('ai:localRestart'), 'Local AI restarted.')}>
            Restart
          </Button>
        </div>
      </Row>
      <Row label="Models to download" hint={st?.catalogError ?? (st?.catalogAt ? `AI Studio's models, from your WorkSuite server${st.catalogSources?.cdn ? ` (${st.catalogSources.cdn} from WorkSuite's signed catalogue)` : ''} — checked ${relative(st.catalogAt)}.` : 'Not checked yet.')}>
        <Button size="sm" icon="refresh" loading={busy === 'catalog'} onClick={() => run('catalog', call('ai:localRefresh'))}>
          Check for models
        </Button>
      </Row>

      <h3 className="mb-1 mt-6 text-[14px] font-bold text-ink">Models on this computer</h3>
      {models.isLoading ? <p className="text-[12.5px] text-ink-3">Loading…</p> : null}
      {!models.isLoading && !chat.length ? <p className="text-[12.5px] text-ink-3">No models to download to this computer yet. The assistant still answers with AI Studio's models above.</p> : null}
      {chat.map((v) => {
        const m = v.model;
        const pct = m.bytes ? Math.min(100, Math.round((v.received / m.bytes) * 100)) : 0;
        return (
          <div key={m.id} className="border-b border-line py-3.5">
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-ink">
                  {m.name}
                  {v.recommended ? <Chip tone="indigo">Recommended</Chip> : null}
                  {v.isDefault ? <Chip tone="success">Default</Chip> : null}
                  {!v.fits ? <Chip tone="warning">May be slow here</Chip> : null}
                </div>
                <div className="mt-0.5 text-[12.5px] text-ink-3">
                  Version {m.version} · {bytes(m.bytes)} download · {m.quantization} · {m.contextLength.toLocaleString()} tokens
                </div>
                <div className="mt-0.5 text-[12.5px] text-ink-3">
                  Needs about {bytes(m.minMemoryBytes)} of memory · {TIER_WORDS[m.tiers[0] ?? 'strong']} tier computers and up
                  {hw ? (v.fits ? ' · suits this computer' : ` · this computer has ${bytes(Math.max(hw.memoryBytes, hw.vramBytes))}`) : ''}
                </div>
                <div className="mt-0.5 text-[12.5px] text-ink-3">
                  Licence:{' '}
                  <button type="button" className="text-primary hover:underline" onClick={() => void call('app:openExternal', { url: m.license.url })}>
                    {m.license.name}
                  </button>
                  {v.state === 'available' || v.state === 'failed' ? ' — by downloading it you accept its terms.' : null}
                </div>
                {m.notice ? <p className="mt-1.5 rounded-[8px] bg-subtle px-2.5 py-1.5 text-[11.5px] leading-[1.5] text-ink-2">{m.notice}</p> : null}
                {v.error ? <div className="mt-1 text-[12.5px] text-danger">{v.error}</div> : null}
                {v.state === 'installed' && v.readiness === 'failed' ? (
                  <div className="mt-1 text-[12.5px] text-danger">It downloaded and matches its checksum, but did not answer on this computer: {v.readinessError}</div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {v.state === 'available' || v.state === 'failed' ? (
                  <Button data-guide="settings.local-ai-download" size="sm" icon="download" loading={busy === `i:${m.id}`} onClick={() => run(`i:${m.id}`, call('ai:localInstall', { id: m.id }))}>
                    {v.state === 'failed' ? 'Try again' : 'Download and set up'}
                  </Button>
                ) : null}
                {v.state === 'paused' ? (
                  <>
                    <Button size="sm" icon="play" onClick={() => run(`i:${m.id}`, call('ai:localInstall', { id: m.id }))}>
                      Resume
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => run(`c:${m.id}`, call('ai:localCancelInstall', { id: m.id, discard: true }))}>
                      Discard
                    </Button>
                  </>
                ) : null}
                {v.state === 'downloading' ? (
                  <>
                    <Button size="sm" icon="pause" onClick={() => run(`c:${m.id}`, call('ai:localCancelInstall', { id: m.id }))}>
                      Pause
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => run(`c:${m.id}`, call('ai:localCancelInstall', { id: m.id, discard: true }))}>
                      Cancel
                    </Button>
                  </>
                ) : null}
                {v.state === 'verifying' ? <Chip tone="indigo">Checking the file…</Chip> : null}
                {v.state === 'installed' && v.readiness === 'testing' ? <Chip tone="indigo">Setting up…</Chip> : null}
                {v.state === 'installed' && v.readiness === 'ready' ? <Chip tone="success">Ready to use</Chip> : null}
                {v.state === 'installed' && (v.readiness === 'failed' || v.readiness === 'untested') ? (
                  <Button size="sm" loading={busy === `t:${m.id}`} onClick={() => run(`t:${m.id}`, call('ai:localTest', { id: m.id }).then((ok) => toast(ok ? 'success' : 'error', ok ? `${m.name} is ready to use.` : `${m.name} did not answer on this computer.`)))}>
                    {v.readiness === 'failed' ? 'Test again' : 'Test'}
                  </Button>
                ) : null}
                {v.state === 'installed' && v.readiness !== 'testing' ? (
                  <>
                    {!v.isDefault && v.readiness !== 'failed' ? (
                      <Button size="sm" loading={busy === `d:${m.id}`} onClick={() => run(`d:${m.id}`, call('ai:localSetDefault', { id: m.id }), `${m.name} answers from now on.`)}>
                        Use this model
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" loading={busy === `k:${m.id}`} onClick={() => run(`k:${m.id}`, call('ai:localCheck', { id: m.id }).then((ok) => toast(ok ? 'success' : 'error', ok ? 'The file is intact.' : 'The file does not match. Remove it and download it again.')))}>
                      Check
                    </Button>
                    <Button size="sm" variant="ghost" icon="trash" loading={busy === `r:${m.id}`} onClick={() => run(`r:${m.id}`, call('ai:localRemove', { id: m.id }), `${m.name} removed.`)}>
                      Remove
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
            {v.state === 'downloading' || v.state === 'paused' ? (
              <div className="mt-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
                  <div className={cx('h-full rounded-full transition-[width]', v.state === 'paused' ? 'bg-ink-3' : 'bg-primary')} style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 text-[11.5px] text-ink-3">
                  {v.state === 'paused' ? 'Paused' : 'Downloading'} · {bytes(v.received)} of {bytes(m.bytes)} ({pct}%)
                  {v.state === 'downloading' && secondsLeft(v) !== null ? ` · ${timeLeftLabel(secondsLeft(v))}` : ''}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
