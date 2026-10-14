import { useEffect, useState, type CSSProperties } from 'react';
import { EMPTY_CLOUD_STATUS, quotaLevel, type CloudStatus, type QuotaLevel, type StorageUsage } from '@shared/cloud';
import { app, updatePrefs } from '../../core/app-state';
import { call, errorMessage, hasDesktop } from '../../core/bridge';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Spinner, cx } from '../../components/ui';
import { Card, Head } from './parts';

/**
 * Account › Storage (Connection & Startup screen 12) and the storage pieces shown elsewhere for a Personal account:
 * the Home card and the sidebar meter (screen 10), and the banner at 95 % and full. Everything here is WorkSuite
 * Cloud's own count — what this computer keeps (cache, offline copies, local AI models, logs) never uses it.
 * Nothing is ever deleted automatically: the buttons open Files or Cloud's web pages, where the person chooses.
 */

/** "620 MB", "2 GB", "1.95 GB": two significant decimals at most, no trailing zeros. */
export function size(n: number | null | undefined): string {
  const v = Math.max(0, Number(n ?? 0));
  if (v < 1024) return `${Math.round(v)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  const digits = x >= 100 ? 0 : x >= 10 ? 1 : 2;
  return `${Number(x.toFixed(digits))} ${units[i]}`;
}

export function percent(used: number, limit: number): number {
  if (!(limit > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

/** Whether the active account is a Personal (WorkSuite Cloud) one. */
export function usePersonal(): boolean {
  return useStore(app, (s) => s.auth?.account?.kind === 'personal');
}

/**
 * The active Personal account's Cloud status: the store's (`cloud:changed`), asked for once when the store has
 * none yet. Null for any other account.
 */
export function useCloudStatus(): CloudStatus | null {
  const personal = usePersonal();
  const fromStore = useStore(app, (s) => s.cloud);
  const fromAuth = useStore(app, (s) => s.auth?.cloud ?? null);
  useEffect(() => {
    if (!personal || fromStore || !hasDesktop()) return;
    let alive = true;
    call('cloud:status').then(
      (c) => alive && c && app.set({ cloud: c }),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [personal, fromStore]);
  return personal ? (fromStore ?? fromAuth) : null;
}

/** The meter's colour for a level: the brand's until 85 %, then the warning's, then the danger's. */
function tone(level: QuotaLevel | undefined): string {
  return level === 'full' || level === 'critical' ? 'var(--color-danger)' : level === 'warning' ? 'var(--color-warning)' : 'var(--color-primary)';
}

function Bar({ used, limit, level, height = 10, track = 'bg-selection', style }: { used: number; limit: number; level?: QuotaLevel; height?: number; track?: string; style?: CSSProperties }) {
  const pct = percent(used, limit);
  return (
    <div className={cx('overflow-hidden rounded-full', track)} style={{ height, ...style }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`Storage ${pct}% used`}>
      <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: tone(level) }} />
    </div>
  );
}

/** The sidebar's meter (screen 10): "Storage 620 MB of 2 GB", for a Personal account only. On the navy sidebar. */
export function StorageMeter({ className }: { className?: string }) {
  const cloud = useCloudStatus();
  const s = cloud?.storage;
  if (!s || !(s.limit > 0)) return null;
  return (
    <button type="button" onClick={() => navigate('/account/storage')} data-testid="storage-meter" className={cx('mx-2.5 mt-2 block rounded-[10px] bg-white/6 px-3 py-2.5 text-start text-[12px] text-navy-ink/80 hover:bg-white/10', className)}>
      Storage <b className="font-bold text-white">{size(s.used)}</b> of {size(s.limit)}
      <Bar used={s.used} limit={s.limit} level={s.level} height={5} track="bg-white/12" style={{ marginTop: 6 }} />
    </button>
  );
}

/** Home's storage card (screen 10): used of the plan's total, the percentage, and Manage storage. */
export function StorageCard({ onManage }: { onManage?: () => void }) {
  const cloud = useCloudStatus();
  const s = cloud?.storage;
  if (!s || !(s.limit > 0)) return null;
  const pct = percent(s.used, s.limit);
  return (
    <section data-testid="storage-card" aria-label="Storage" className="flex flex-wrap items-center gap-6 rounded-[16px] border border-line bg-surface px-[22px] py-5">
      <div className="min-w-[220px] flex-1">
        <div className="flex justify-between gap-3 text-[14px] text-ink">
          <b>Storage</b>
          <span>
            <b>{size(s.used)}</b> / {size(s.limit)} · {pct}%
          </span>
        </div>
        <Bar used={s.used} limit={s.limit} level={s.level} style={{ marginTop: 10 }} />
        {s.level === 'full' || s.level === 'critical' ? <p className="m-0 mt-2 text-[12.5px] text-danger">{s.level === 'full' ? 'Your storage is full. New uploads wait until there is room — nothing is deleted.' : 'Your storage is almost full.'}</p> : null}
      </div>
      <button type="button" onClick={onManage ?? (() => navigate('/account/storage'))} className="text-[14px] font-semibold text-primary hover:underline">
        Manage storage
      </button>
    </section>
  );
}

/** At 95 % and full (screen 12's red bar): what that means, Manage Storage and Upgrade. Nothing else shows it. */
export function StorageBanner({ storage }: { storage: CloudStatus['storage'] }) {
  if (!storage || (storage.level !== 'critical' && storage.level !== 'full')) return null;
  return (
    <div role="status" data-testid="storage-banner" className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-danger px-6 py-3 text-[14px] text-white">
      <b>
        You have used {size(storage.used)} of your {size(storage.limit)} storage.
      </b>
      <span className="min-w-[200px] flex-1">
        {storage.level === 'full' ? 'New uploads wait until there is room.' : `New uploads will stop at ${size(storage.limit)}.`} Nothing is ever deleted automatically.
      </span>
      <button type="button" onClick={() => navigate('/account/storage')} className="font-bold text-white underline">
        Manage Storage
      </button>
      <button type="button" onClick={() => void openWeb('upgrade')} className="flex h-[34px] items-center rounded-[8px] bg-white px-3.5 font-bold text-danger">
        Upgrade
      </button>
    </div>
  );
}

export async function openWeb(page: 'storage' | 'upgrade' | 'privacy' | 'support' | 'verify' | 'forgot'): Promise<void> {
  try {
    await call('cloud:openWeb', { page });
  } catch (e) {
    toast('error', errorMessage(e));
  }
}

/** Category colours, in order: theme tokens, so Light, Dark and the colour profiles all read. */
const SWATCHES = ['var(--color-primary)', 'color-mix(in srgb, var(--color-primary) 62%, white)', 'var(--color-teal)', 'var(--color-warning)', 'var(--color-ink-3)'];
const NOTES: Record<string, string> = { trash: 'Empty Trash to recover storage' };

const LIMITS = [1024, 2048, 5120, 10240, 20480, 51200];

/** "This computer": the desktop cache and its limit (automatic follows the organization's offline limit). */
function ThisComputer() {
  const prefs = useStore(app, (s) => s.prefs);
  const cap = useStore(app, (s) => s.bootstrap?.policy?.offline_storage_max_mb ?? null);
  const [cache, setCache] = useState<number | null>(null);
  useEffect(() => {
    if (!hasDesktop()) return;
    let alive = true;
    call('offline:status').then(
      (s) => alive && setCache(s.cacheBytes),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  const limit = prefs?.desktopCacheLimitMb ?? 'auto';
  const options = LIMITS.filter((mb) => cap === null || mb <= cap);
  const set = (v: string) => void updatePrefs({ desktopCacheLimitMb: v === 'auto' ? 'auto' : Number(v) }).catch((e) => toast('error', errorMessage(e)));
  return (
    <Card title="This computer">
      <div className="flex justify-between text-[13.5px] text-ink-3">
        <span>Desktop cache</span>
        <b className="text-ink">{cache === null ? '—' : size(cache)}</b>
      </div>
      <label className="mt-2 flex items-center justify-between gap-3 text-[13.5px] text-ink-3">
        <span>Limit</span>
        <select value={String(limit)} onChange={(e) => set(e.target.value)} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[13px] font-semibold text-ink">
          <option value="auto">Automatic</option>
          {options.map((mb) => (
            <option key={mb} value={mb}>
              {size(mb * 1024 * 1024)}
            </option>
          ))}
        </select>
      </label>
      {cap !== null ? <p className="m-0 mt-2 text-[12px] text-ink-3">Your organization allows up to {size(cap * 1024 * 1024)} on this computer.</p> : null}
    </Card>
  );
}

/** Account › Storage (screen 12). */
export default function StoragePage() {
  const cloud = useCloudStatus() ?? EMPTY_CLOUD_STATUS;
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchUsage = () => call('cloud:storage').then(setUsage, (e) => setError(errorMessage(e)));
  useEffect(() => void fetchUsage(), []);
  const load = () => {
    setError(null);
    void fetchUsage();
  };

  const total = usage?.limit ?? cloud.storage?.limit ?? 0;
  const used = usage?.used ?? cloud.storage?.used ?? 0;
  const free = Math.max(0, total - used);
  const level = quotaLevel(used, total);

  return (
    <div className="flex flex-col gap-4" data-testid="account-storage">
      {total ? (
        <div className="-mx-7 -mt-[22px] mb-1">
          <StorageBanner storage={{ used, limit: total, level }} />
        </div>
      ) : null}
      <Head title={total ? `Storage — ${size(total)} total` : 'Storage'} sub="What your WorkSuite Cloud account keeps. Nothing is ever deleted automatically." />
      {error ? (
        <div className="flex items-center gap-3 rounded-[12px] border border-line bg-surface p-4 text-[13px] text-ink-2">
          <Icon name="cloud-off" size={16} className="text-ink-3" />
          <span className="flex-1">{error}</span>
          <Button size="sm" onClick={load}>
            Try again
          </Button>
        </div>
      ) : null}
      {!usage && !error ? <Spinner /> : null}
      <div className="flex flex-wrap items-start gap-7">
        <div className="flex min-w-[300px] flex-1 flex-col gap-4">
          {usage ? (
            <>
              <div className="flex h-[18px] overflow-hidden rounded-[9px] bg-selection" aria-hidden="true">
                {usage.categories.map((c, i) => (
                  <div key={c.key} style={{ width: `${total ? (c.bytes / total) * 100 : 0}%`, background: SWATCHES[i % SWATCHES.length] }} />
                ))}
              </div>
              <div className="text-[14px] text-ink-3">
                <b className="text-ink">{size(used)}</b> used · {size(free)} free · {size(usage.reserved)} reserved by uploads in progress
              </div>
              <ul className="m-0 flex list-none flex-col p-0" aria-label="By category">
                {usage.categories.map((c, i) => {
                  const note = c.policy ?? NOTES[c.key];
                  return (
                    <li key={c.key} className="flex items-center gap-3 border-b border-line py-2.5 text-[14px] text-ink last:border-b-0">
                      <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ background: SWATCHES[i % SWATCHES.length] }} />
                      <span className="flex-1">
                        {c.label ?? c.key}
                        {note ? <span className="text-[12.5px] text-ink-3"> · {note}</span> : null}
                      </span>
                      <b>{size(c.bytes)}</b>
                    </li>
                  );
                })}
              </ul>
              {usage.largest.length ? (
                <Card title="Largest files">
                  <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
                    {usage.largest.slice(0, 5).map((f) => (
                      <li key={f.id} className="flex justify-between gap-3">
                        <span className="truncate text-ink">{f.name}</span>
                        <span className="shrink-0 text-ink-3">{size(f.bytes)}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </>
          ) : null}
          <div className="flex flex-wrap gap-2.5">
            <Button size="lg" icon="search" onClick={() => navigate('/files?view=storage')}>
              Review Large Files
            </Button>
            <Button size="lg" icon="trash" onClick={() => navigate('/files?view=trash')}>
              Empty Trash
            </Button>
            <Button size="lg" icon="history" onClick={() => void openWeb('storage')}>
              Delete Old Versions
            </Button>
            <Button size="lg" variant="primary" onClick={() => void openWeb('upgrade')}>
              Upgrade
            </Button>
          </div>
        </div>
        <div className="flex w-[300px] max-w-full flex-col gap-3.5">
          <Card title="Not counted">
            <p className="m-0 text-[13.5px] leading-[1.55] text-ink-3">
              Desktop cache, offline copies, local AI models, search index and logs live on this computer and never use your {total ? size(total) : 'storage'}.
            </p>
          </Card>
          <ThisComputer />
        </div>
      </div>
    </div>
  );
}
