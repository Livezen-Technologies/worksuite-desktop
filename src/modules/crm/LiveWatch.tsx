import { useEffect, useRef } from 'react';
import { apiGet } from '../../core/api';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { toast } from '../../core/toasts';
import { crmCan } from './parts';
import { liveText, liveUnavailable, LiveWatcher, nameOf, nextLiveDelay, proposalRoute, useOnline, type LiveViewing } from './proposalLogic';

/**
 * "Your customer is reading" (CRM SRS v1.3 §17, desk-proposals): while I am
 * signed in and may see proposals, `GET /api/crm/proposals/live` is asked
 * about every 30 seconds — every 2 minutes while the window is hidden, not
 * at all offline, less often after failures — and each viewing session is
 * announced once: a toast with Open while I am looking at the desktop, the
 * system notification otherwise. Either opens the proposal in the Proposals
 * tab.
 */
export function ProposalLiveWatch() {
  const online = useOnline();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const allowed = crmCan(perms, 'crm.proposals.view');
  const watcher = useRef(new LiveWatcher());

  useEffect(() => {
    if (!allowed || !online) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let missing = false;
    const visible = () => document.visibilityState !== 'hidden';
    const schedule = () => {
      clearTimeout(timer);
      if (stopped) return;
      const d = nextLiveDelay({ visible: visible(), online: true, failures, missing });
      if (d !== null) timer = setTimeout(() => void tick(), d);
    };
    const tick = async () => {
      try {
        const r = await apiGet<{ viewing?: LiveViewing[] } | null>('/api/crm/proposals/live');
        failures = 0;
        missing = false;
        if (!stopped) for (const v of watcher.current.update(Array.isArray(r?.viewing) ? r.viewing : [])) announce(v);
      } catch (e) {
        if (liveUnavailable(e)) missing = true;
        else failures += 1;
      }
      schedule();
    };
    // Back in view: ask now rather than wait out the hidden window's longer gap.
    const onVisibility = () => {
      if (visible() && !missing) {
        clearTimeout(timer);
        void tick();
      } else schedule();
    };
    document.addEventListener('visibilitychange', onVisibility);
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [allowed, online]);

  return null;
}

/** One viewing session, once: in the app while it is in front of me, as a system notification while it is not. */
export function announce(v: LiveViewing): void {
  const route = proposalRoute(v.proposal_id);
  const title = liveText(v);
  const body = [nameOf(v.account), v.title].filter(Boolean).join(' · ');
  if (document.visibilityState !== 'hidden' && document.hasFocus()) {
    toast('info', body ? `${title} (${body})` : title, { label: 'Open', run: () => navigate(route) }, 12_000, { key: `crm-live:${v.proposal_id}` });
    return;
  }
  const id = `crm-live:${LiveWatcher.keyOf(v)}`.replace(/[^A-Za-z0-9:._\-/ ]/g, '_').slice(0, 200);
  void call('notifications:reminder', { id, title: title.slice(0, 200), body: body.slice(0, 300), route }).catch(() => undefined);
}
