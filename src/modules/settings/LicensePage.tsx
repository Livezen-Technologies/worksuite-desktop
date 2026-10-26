import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { APP_CATALOGUE } from '@shared/apps';
import type { Bootstrap, DeviceInfo } from '@shared/types';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { stampDayLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Chip, cx } from '../../components/ui';

const STORAGE: Record<string, string> = {
  keychain: 'macOS Keychain',
  dpapi: 'Windows DPAPI',
  gnome_libsecret: 'libsecret',
  kwallet: 'KWallet',
  kwallet5: 'KWallet',
  kwallet6: 'KWallet',
};

/** Where the sign-in token is kept, in words. */
export function storageLabel(d: Pick<DeviceInfo, 'secureStorage'> | null | undefined): string {
  if (!d) return '—';
  if (!d.secureStorage.available || !d.secureStorage.persistent) return 'Memory only — not saved on this computer';
  return STORAGE[d.secureStorage.backend] ?? d.secureStorage.backend;
}

/** "dev_01J8…4QX": enough to recognise it, not the whole id. */
export function shortId(id: string | null | undefined): string {
  if (!id) return 'not registered';
  return id.length > 12 ? `${id.slice(0, 7)}…${id.slice(-3)}` : id;
}

export interface Entitlement {
  id: string;
  label: string;
  enabled: boolean;
}

/** The modules this organization's plan gives this person (the bootstrap's entitlements, else its apps). */
export function entitlements(b: Pick<Bootstrap, 'entitlements' | 'apps'> | null | undefined): Entitlement[] {
  if (!b) return [];
  const slugs = Object.keys(b.entitlements ?? {}).filter((k) => b.entitlements[k]);
  const enabled = new Set(slugs.length ? slugs : Array.isArray(b.apps) ? b.apps : []);
  const all = b.apps === '*' && !slugs.length;
  const seen = new Set<string>();
  const out: Entitlement[] = [];
  for (const def of [...APP_CATALOGUE].sort((x, y) => x.order - y.order)) {
    if (!def.app || seen.has(def.app)) continue;
    seen.add(def.app);
    out.push({ id: def.app, label: def.label, enabled: all || enabled.has(def.app) });
  }
  return out;
}

function daysAgo(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null;
}

function Row({ label, children, pending }: { label: string; children: ReactNode; pending?: boolean }) {
  return (
    <div className="flex items-center gap-4 border-b border-line py-2.5 text-[13.5px]">
      <div className="w-[140px] shrink-0 text-ink-3">{label}</div>
      <div className={cx('min-w-0 flex-1', pending ? 'text-ink-3' : 'text-ink')}>{children}</div>
      {pending ? <Chip>Needs server</Chip> : null}
    </div>
  );
}

const NOT_YET = 'Not provided by the server yet';

export function LicensePage() {
  const b = useStore(app, (s) => s.bootstrap);
  const auth = useStore(app, (s) => s.auth);
  const orgId = useStore(app, (s) => s.organizationId);
  const device = useQuery({ queryKey: ['security', 'deviceInfo'], queryFn: () => call('security:deviceInfo'), enabled: !!b });
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    void call('session:refresh')
      .then((next) => toast(next ? 'success' : 'warning', next ? 'License refreshed.' : 'WorkSuite could not reach the server. Your saved copy is still in use.'))
      .catch((e) => toast('error', errorMessage(e)))
      .finally(() => setRefreshing(false));
  };
  if (!b) {
    return (
      <div className="rounded-[12px] border border-line bg-surface p-5 text-[13.5px] text-ink-2">
        <h2 className="text-[20px] leading-tight font-bold text-ink">License</h2>
        <p className="mt-2">Sign in to see your organization's license on this computer.</p>
      </div>
    );
  }
  const org = b.organizations.find((o) => o.id === (orgId ?? b.defaultOrganizationId)) ?? b.organizations[0] ?? null;
  const license = b.license;
  const status = license?.status ?? 'Unknown';
  const checked = license?.lastValidatedAt;
  const days = daysAgo(checked);
  const verified = checked ? stampDayLabel(checked, 'year') : null;
  const list = entitlements(b);
  const on = list.filter((e) => e.enabled);
  const off = list.filter((e) => !e.enabled);
  const d = device.data;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <section aria-label="License" className="rounded-[12px] border border-line bg-surface p-5">
        <div className="flex items-center gap-3">
          <h2 className="text-[20px] font-bold text-ink">License</h2>
          <Chip tone={status === 'ACTIVE' ? 'success' : 'warning'}>{status.toUpperCase()}{b.offline ? ' · CACHED' : ''}</Chip>
          <div className="flex-1" />
          <Button variant="primary" loading={refreshing} onClick={refresh}>
            Refresh License
          </Button>
        </div>
        <div className="mt-3">
          <Row label="Edition" pending={!license?.edition}>
            {license?.edition ?? NOT_YET}
          </Row>
          <Row label="Status">
            {status} — last verified {days === null ? 'unknown' : days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}
            {verified ? ` (${verified})` : ''}
            {b.offline ? ' · using the saved copy' : ''}
          </Row>
          <Row label="License" pending={!license?.keyMasked}>
            {license?.keyMasked ?? NOT_YET}
          </Row>
          <Row label="Organization">{org?.name ?? auth?.user?.organizationName ?? '—'}</Row>
          <Row label="Valid until" pending={!license?.expiresAt}>
            {license?.expiresAt ? stampDayLabel(license.expiresAt, 'year') : NOT_YET}
          </Row>
          <Row label="This device">
            {d ? (
              <>
                {d.name} · <span className="font-mono">{shortId(d.id)}</span>
              </>
            ) : (
              '—'
            )}
          </Row>
          <Row label="Token storage">
            {storageLabel(d)}
            {b.policy.signed ? ' · policy signature valid' : ''}
          </Row>
          <Row label="Activation limit" pending={license?.maxActivations == null}>
            {license?.maxActivations == null ? NOT_YET : `${license.maxActivations} server installation${license.maxActivations === 1 ? '' : 's'}`}
          </Row>
          <Row label="Offline grace" pending={license?.graceDays == null && !license?.graceEndsAt}>
            {license?.graceEndsAt ? `Until ${stampDayLabel(license.graceEndsAt, 'year')}` : license?.graceDays != null ? `${license.graceDays} days (server license)` : NOT_YET}
          </Row>
        </div>
      </section>
      <div className="space-y-4">
        <section aria-label="Entitlements on this device" className="rounded-[12px] border border-line bg-surface p-5">
          <h3 className="text-[15px] font-bold text-ink">Entitlements on this device</h3>
          <p className="text-[12px] text-ink-3">From your organization&apos;s sign-in · refreshed when your access changes</p>
          <ul className="mt-3 grid grid-cols-2 gap-1.5">
            {[...on, ...(showAll ? off : [])].map((e) => (
              <li key={e.id} className={cx('truncate rounded-[8px] px-2.5 py-1.5 text-[13px]', e.enabled ? 'bg-subtle text-ink' : 'bg-subtle/50 text-ink-3')}>
                {e.enabled ? '✓' : '—'} {e.label}
              </li>
            ))}
          </ul>
          {off.length ? (
            <button type="button" className="mt-2 text-[12.5px] font-semibold text-primary hover:underline" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show included only' : `${off.length} not included`}
            </button>
          ) : null}
        </section>
        <section className="rounded-[12px] border border-line bg-surface p-5 text-[13px] text-ink-2">
          <p>
            <strong className="text-ink">Your data is safe.</strong> A sign-in check that is due or has lapsed never deletes mail, files, notes or offline changes. They stay on this
            computer and sync once WorkSuite is verified again.
            {b.policy.wipe_on_revoke !== 'tokens' ? ' If an administrator removes this device, your organization’s policy may clear its saved copy.' : ''}
          </p>
        </section>
        <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
          <Icon name="info" size={13} /> License details come from your server’s latest verification. Refresh retrieves its current saved license status.
        </p>
      </div>
    </div>
  );
}
