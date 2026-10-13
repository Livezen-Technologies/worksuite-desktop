import { useState } from 'react';
import type { ServiceHealthState } from '@shared/accounts';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { useNow } from '../../core/use-now';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { changes } from './labels';

/** The banner's first sentence for the service's state, or null when there is nothing to say. */
export function serviceHeadline(service: ServiceHealthState | null | undefined, cloud: boolean): string | null {
  if (!service) return null;
  const label = service.label?.trim() || (cloud ? 'WorkSuite Cloud' : 'your WorkSuite server');
  switch (service.state) {
    case 'unavailable':
      return `${label} is temporarily unavailable.`;
    case 'unreachable':
      return `Can’t reach ${label}.`;
    default:
      return null;
  }
}

/** "Retrying in 2 min" / "Retrying in 40 s" / "Retrying now". */
export function retryIn(nextRetryAt: string | null, now: number): string | null {
  if (!nextRetryAt) return null;
  const at = Date.parse(nextRetryAt);
  if (!Number.isFinite(at)) return null;
  const s = Math.round((at - now) / 1000);
  if (s <= 0) return 'Retrying now…';
  return s >= 60 ? `Retrying in ${Math.round(s / 60)} min.` : `Retrying in ${s} s.`;
}

/** Puts the answer to `connection:workOffline` into the status the banner reads, before `status:changed` catches up. */
function applyService(next: ServiceHealthState | null | undefined): void {
  const status = app.get().status;
  if (next && status) app.set({ status: { ...status, service: next } });
}

/**
 * Screen 16's banner: the open account's server can't be used right now — "WorkSuite Cloud is temporarily
 * unavailable" (the gateway answers 5xx/503) or "Can't reach <host>" (the internet works, the server doesn't) — from
 * `StatusSnapshot.service`. Offline-capable apps keep working; it says how many changes wait to sync. Retry asks the
 * desktop to check now (`connection:reconnect`); Work Offline turns on the desktop's Work Offline
 * (`connection:workOffline {on:true}`: writes queue and nothing is tried on the network) and the banner gives way to
 * a slim "Working offline · Go online" strip, which turns it off again. No internet at all is the title bar's to say,
 * not this banner's.
 */
export function ServiceBanner() {
  const service = useStore(app, (s) => s.status?.service ?? null);
  const pending = useStore(app, (s) => s.status?.pendingChanges ?? 0);
  const cloud = useStore(app, (s) => s.auth?.account?.deployment === 'CLOUD' || s.auth?.account?.kind === 'personal');
  const [busy, setBusy] = useState<'retry' | 'offline' | 'online' | null>(null);
  const now = useNow(1000).getTime();
  const headline = serviceHeadline(service, cloud);
  if (!service) return null;
  const setOffline = async (on: boolean) => {
    setBusy(on ? 'offline' : 'online');
    try {
      applyService(await call('connection:workOffline', { on }));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  if (service.workOffline) {
    return (
      <div role="status" data-testid="work-offline-strip" className="flex shrink-0 items-center gap-3 border-b border-line bg-subtle px-6 py-1.5 text-[13px] text-ink-2">
        <Icon name="cloud-off" size={15} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <b>Working offline.</b> Changes are kept on this computer{pending > 0 ? ` (${changes(pending)} waiting to sync)` : ''} until you go online.
        </span>
        <Button size="sm" loading={busy === 'online'} onClick={() => void setOffline(false)}>
          Go online
        </Button>
      </div>
    );
  }
  if (!headline) return null;
  const retry = async () => {
    setBusy('retry');
    try {
      await call('connection:reconnect');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const next = retryIn(service.nextRetryAt, now);
  return (
    <div role="status" aria-live="polite" data-testid="service-banner" className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-warning/40 bg-warning-bg px-6 py-3 text-[14px] text-warning-ink">
      <Icon name={service.state === 'unreachable' ? 'wifi-off' : 'cloud-off'} size={18} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <b>{headline}</b> Offline-capable apps remain available.{pending > 0 ? ` ${changes(pending)} waiting to sync.` : ''}
        {next ? <span className="ml-1 opacity-80">{next}</span> : null}
      </span>
      <Button size="md" loading={busy === 'retry'} className="h-[34px] rounded-[8px] border-warning/60 text-warning-ink" onClick={() => void retry()}>
        Retry
      </Button>
      <Button size="md" loading={busy === 'offline'} className="h-[34px] rounded-[8px] border-transparent bg-warning text-white hover:opacity-90" onClick={() => void setOffline(true)}>
        Work Offline
      </Button>
    </div>
  );
}
