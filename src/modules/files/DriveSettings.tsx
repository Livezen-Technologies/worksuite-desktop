import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { BandwidthLimit, DrivePrefs } from '@shared/types';
import { MAX_CONCURRENT, transferSections, transferSummary } from '@shared/transfers';
import { app, updatePrefs } from '../../core/app-state';
import { apiGet } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { Button, NumberField, Switch, cx } from '../../components/ui';
import { Select } from '../../components/Select';

/**
 * Drive › Settings (worksuite-desktop#95), also in Settings › Files & Sync:
 * how many files move at once and how fast, what this computer keeps, and
 * what an upload does with a name already taken. Saved on this computer
 * only, and only about the transfers this app makes.
 */
export function DriveSettings({ embedded = false }: { embedded?: boolean }) {
  const prefs = useStore(app, (s) => s.prefs);
  if (!prefs) return null;
  const d = prefs.drive;
  const set = (patch: Partial<DrivePrefs>) => void updatePrefs({ drive: { ...d, ...patch } }).catch((e) => toast('error', errorMessage(e)));
  const reset = () =>
    void call('transfers:resetSettings').then(
      (r) => {
        app.set({ prefs: r.preferences, locks: r.locks });
        toast('success', 'Drive settings are back to their defaults.');
      },
      (e) => toast('error', errorMessage(e)),
    );
  return (
    <div className={cx('flex flex-col', !embedded && 'min-w-0 flex-1 overflow-y-auto px-8 py-6 scroll-thin')} data-drive-settings>
      <div className="max-w-[760px]">
        <div className="mb-4 flex items-start gap-4">
          <div className="min-w-0 flex-1">
            {embedded ? <h3 className="text-[16px] font-bold text-ink">Drive settings</h3> : <h1 className="text-[20px] font-bold text-ink">Drive settings</h1>}
            <p className="mt-1 text-[13px] font-semibold text-ink-2" data-scope>These settings apply to this computer.</p>
            <p className="mt-0.5 text-[12.5px] text-ink-3">
              They govern the uploads and downloads WorkSuite makes here. They don’t change your account’s storage or the file-size limits set on the server.
            </p>
          </div>
          <Button onClick={reset}>Reset to defaults</Button>
        </div>

        <Section title="Transfers">
          <Row label="Files moving at once" hint="At most two uploads and downloads together, across every module. The rest wait their turn in the queue.">
            <Select label="Files moving at once" value={d.maxConcurrent} options={range(1, MAX_CONCURRENT).map((n) => ({ value: n, label: String(n) }))} onValueChange={(v) => set({ maxConcurrent: Number(v) })} />
          </Row>
          <Row label="Uploads at once" hint="Within the limit above.">
            <Select label="Uploads at once" value={d.maxUploads ?? 0} options={[{ value: 0, label: 'No separate limit' }, ...range(1, d.maxConcurrent).map((n) => ({ value: n, label: String(n) }))]} onValueChange={(v) => set({ maxUploads: Number(v) || null })} />
          </Row>
          <Row label="Downloads at once" hint="Within the limit above.">
            <Select label="Downloads at once" value={d.maxDownloads ?? 0} options={[{ value: 0, label: 'No separate limit' }, ...range(1, d.maxConcurrent).map((n) => ({ value: n, label: String(n) }))]} onValueChange={(v) => set({ maxDownloads: Number(v) || null })} />
          </Row>
          <ToggleRow label="Try again after a network problem" hint="A transfer cut off by the network or a busy server is tried again by itself, a few times." checked={d.autoRetry} onChange={(v) => set({ autoRetry: v })} />
          <AllTransfers />
          <Row label="When an upload’s name is taken" hint="What happens when the folder already has a file with that name.">
            <Select
              label="When an upload’s name is taken"
              value={d.conflict}
              options={[
                { value: 'ask', label: 'Ask' },
                { value: 'both', label: 'Keep both' },
                { value: 'skip', label: 'Skip' },
                { value: 'replace', label: 'Replace' },
              ]}
              onValueChange={(v) => set({ conflict: v as DrivePrefs['conflict'] })}
            />
          </Row>
        </Section>

        <Section title="Bandwidth">
          <SpeedRow label="Upload speed" hint="The combined speed of every upload at once." value={d.uploadLimit} onChange={(v) => set({ uploadLimit: v })} />
          <SpeedRow label="Download speed" hint="The combined speed of every download at once." value={d.downloadLimit} onChange={(v) => set({ downloadLimit: v })} />
        </Section>

        <Section title="Storage & Sync">
          <Row label="Download folder" hint={<span className="font-mono">{prefs.downloadFolder}</span>}>
            <Button onClick={() => void call('files:chooseDownloadFolder').then((p) => p && toast('success', 'Download folder changed.'))}>Change…</Button>
          </Row>
          <ToggleRow label="Ask where to save each time" hint="Choose a place and name for every download instead of the download folder." checked={d.askWhereToSave} onChange={(v) => set({ askWhereToSave: v })} />
          <Storage />
          <ToggleRow label="Resume after reconnecting" hint="Transfers the connection interrupted carry on by themselves when it is back. Off: they wait, paused, for you." checked={d.autoResume} onChange={(v) => set({ autoResume: v })} />
          <ToggleRow label="Treat this connection as metered" hint="For this computer: turn on for a mobile hotspot or a connection with a data allowance." checked={!!d.meteredConnection} onChange={(v) => set({ meteredConnection: v })} />
          <Row label="On a metered connection" hint="For background transfers, when the network is metered.">
            <Select
              label="On a metered connection"
              value={d.metered}
              options={[
                { value: 'normal', label: 'Carry on as usual' },
                { value: 'limit', label: 'One file at a time' },
                { value: 'pause', label: 'Pause until unmetered' },
              ]}
              onValueChange={(v) => set({ metered: v as DrivePrefs['metered'] })}
            />
          </Row>
        </Section>

        <Section title="Notifications">
          <ToggleRow label="When a transfer finishes" checked={d.notifyComplete} onChange={(v) => set({ notifyComplete: v })} />
          <ToggleRow label="When a transfer fails" checked={d.notifyFailed} onChange={(v) => set({ notifyFailed: v })} />
        </Section>
      </div>
    </div>
  );
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-4">
      <h2 className="mb-1 text-[14px] font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-6 border-b border-line py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold text-ink">{label}</div>
        {hint ? <div className="mt-0.5 text-[12.5px] text-ink-3">{hint}</div> : null}
      </div>
      <div className="min-w-0 max-w-[60%] shrink-0 break-words">{children}</div>
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row label={label} hint={hint}>
      <Switch label={label} checked={checked} onChange={onChange} />
    </Row>
  );
}

/** Unlimited, or a number of KB/s or MB/s: saved when the number is a real one. */
function SpeedRow({ label, hint, value, onChange }: { label: string; hint: string; value: BandwidthLimit; onChange: (v: BandwidthLimit) => void }) {
  const [text, setText] = useState(String(value.value));
  // A value changed elsewhere (a reset) shows here too.
  const [shown, setShown] = useState(value.value);
  if (shown !== value.value) {
    setShown(value.value);
    setText(String(value.value));
  }
  const commit = () => {
    const n = Number(text);
    if (n > 0 && n <= 1_000_000) onChange({ ...value, value: n });
    else setText(String(value.value));
  };
  return (
    <Row label={label} hint={hint}>
      <div className="flex items-center justify-end gap-2">
        <Select label={label} value={value.on ? 'custom' : 'unlimited'} options={[{ value: 'unlimited', label: 'Unlimited' }, { value: 'custom', label: 'Custom' }]} onValueChange={(v) => onChange({ ...value, on: v === 'custom' })} />
        {value.on ? (
          <>
            <NumberField
              size="sm"
              width={80}
              min={1}
              max={1_000_000}
              inputMode="decimal"
              aria-label={`${label} limit`}
              value={text}
              invalid={!(Number(text) > 0 && Number(text) <= 1_000_000)}
              onValueChange={setText}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
            />
            <Select label={`${label} unit`} value={value.unit} options={[{ value: 'KB', label: 'KB/s' }, { value: 'MB', label: 'MB/s' }]} onValueChange={(v) => onChange({ ...value, unit: v as BandwidthLimit['unit'] })} />
          </>
        ) : null}
      </div>
    </Row>
  );
}

/** Pause or resume everything in the queue, from here as from Transfers. */
function AllTransfers() {
  const transfers = useStore(app, (s) => s.transfers);
  const { active, queued, paused } = transferSections(transfers);
  const run = (ch: 'transfers:pauseAll' | 'transfers:resumeAll') => void call(ch).catch((e) => toast('error', errorMessage(e)));
  return (
    <Row label="All transfers" hint={transferSummary(transfers) ?? 'Nothing is moving or waiting.'}>
      <div className="flex justify-end gap-2">
        <Button size="sm" icon="pause" disabled={!active.length && !queued.length} onClick={() => run('transfers:pauseAll')}>
          Pause all
        </Button>
        <Button size="sm" icon="play" disabled={!paused.length} onClick={() => run('transfers:resumeAll')}>
          Resume all
        </Button>
      </div>
    </Row>
  );
}

/**
 * What the Drive holds for the account, and what this computer keeps: the
 * cache of pages and lists (cleaned up without touching any file, any upload
 * still waiting or anything kept offline), and the files kept offline.
 */
function Storage() {
  const sync = useStore(app, (s) => s.sync);
  const hasLearning = useStore(app, (s) => s.apps.some((a) => a.id === 'elearning'));
  const quota = useQuery({ queryKey: ['files', 'quota'], queryFn: ({ signal }) => apiGet<{ quota: number; used: number; unlimited: boolean }>('/api/users/me/storage', undefined, signal), staleTime: 60_000 });
  const cache = useQuery({ queryKey: ['offline', 'status'], queryFn: () => call('offline:status') });
  const courses = useQuery({ queryKey: ['elearning', 'offline'], queryFn: () => call('elearning:offlineList'), enabled: hasLearning });
  const synced = (sync?.folders ?? []).reduce((n, f) => n + f.bytes, 0);
  const learning = (courses.data ?? []).reduce((n, c) => n + c.files.reduce((m, f) => m + (f.kept ?? 0), 0), 0);
  const q = quota.data;
  const pct = q && !q.unlimited && q.quota ? Math.min(100, Math.round((q.used / q.quota) * 100)) : null;
  const clean = () =>
    void call('offline:clearCache').then(
      (n) => {
        toast('success', `Cleaned up ${n} cached item${n === 1 ? '' : 's'}. Your files were not touched.`);
        void cache.refetch();
      },
      (e) => toast('error', errorMessage(e)),
    );
  return (
    <>
      <Row label="Drive storage" hint="Your account’s storage on the server.">
        <div className="flex w-[200px] flex-col items-end gap-1" data-quota>
          <span className="font-mono text-[13px] text-ink-2">{q ? `${bytes(q.used)}${q.unlimited || !q.quota ? ' used' : ` of ${bytes(q.quota)}`}` : '—'}</span>
          {pct !== null ? (
            <div role="meter" aria-label="Drive storage used" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-1.5 w-full overflow-hidden rounded-full bg-subtle">
              <div className={cx('h-1.5 rounded-full', pct > 90 ? 'bg-danger' : 'bg-primary')} style={{ width: `${pct}%` }} />
            </div>
          ) : null}
        </div>
      </Row>
      <Row label="Cache on this computer" hint="Saved copies of pages and lists, for reading offline. Cleaning up never deletes your files, uploads still waiting, or files kept offline.">
        <div className="flex items-center justify-end gap-2">
          <span className="font-mono text-[13px] text-ink-2" data-cache>{cache.data ? bytes(cache.data.cacheBytes) : '—'}</span>
          <Button size="sm" onClick={clean}>
            Clean up
          </Button>
        </div>
      </Row>
      <Row label="Files kept offline" hint={`Synced Drive folders${hasLearning ? ' and courses kept for offline learning' : ''}.`}>
        <div className="flex items-center justify-end gap-2">
          <span className="font-mono text-[13px] text-ink-2" data-offline>{bytes(synced + learning)}</span>
          <Button size="sm" icon="laptop" onClick={() => navigate('/files?view=devices')}>
            Manage…
          </Button>
        </div>
      </Row>
    </>
  );
}

