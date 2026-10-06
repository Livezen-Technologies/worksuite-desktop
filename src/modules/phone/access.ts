import { app } from '../../core/app-state';
import { useStore } from '../../core/store';

/**
 * Who sees what in the Phone (WS-VOIP-SRS-001 §2.2, design "permission-shaped" navigation):
 *
 *   anyone signed in      — My phone: the softphone, own calls, voicemail, forwarding, hot desk
 *   voip.reports          — Supervise: all calls, recordings, reports, live queue depth (managers)
 *   voip.supervise (new)  — Live board listen / whisper / barge
 *   voip.manage           — Administer: extensions, servers, trunks, routes, IVR, queues, dial plan, settings
 *
 * The server refuses anyway (its route filters and in-method checks); this only keeps the screens someone cannot
 * use out of their way. `*` is a super-admin.
 */
export function can(perms: readonly string[] | null | undefined, p: string): boolean {
  return !!perms && (perms.includes('*') || perms.includes(p));
}

export interface PhoneAccess {
  /** All calls, recordings and reports. */
  reports: boolean;
  /** Listen, whisper, barge and pause agents. */
  supervise: boolean;
  /** Telephony administration. */
  manage: boolean;
  /** The Supervise section at all. */
  supervisor: boolean;
}

export function phoneAccess(perms: readonly string[] | null | undefined): PhoneAccess {
  const manage = can(perms, 'voip.manage');
  const reports = manage || can(perms, 'voip.reports');
  const supervise = manage || can(perms, 'voip.supervise');
  return { reports, supervise, manage, supervisor: reports || supervise };
}

export function usePhoneAccess(): PhoneAccess {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  return phoneAccess(perms);
}
