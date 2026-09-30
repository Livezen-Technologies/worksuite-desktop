import { useEffect, useRef } from 'react';
import type { BadgeJob, DeskPrintSettings } from '@shared/event-desk';
import { eGet, ePost } from './api';
import { printQueued } from './badge';

/**
 * Badges sent to this desk's printer from elsewhere (EV-BDG-013 "Mobile shall
 * … send the job to a desk printer"): a phone at the door, another desk, the
 * web. They are print jobs on the server addressed to a printer by name; while
 * the desk is open and set to take them, it asks every ten seconds
 * (`GET badge-prints?status=QUEUED&printer=`), takes each (`dispatch` — the
 * job's version, so two desks never print the same one) and prints it here.
 */
export function usePhoneJobs(eventId: number, deviceId: number | null, settings: DeskPrintSettings | null, enabled: boolean): void {
  const busy = useRef(false);
  const name = settings?.take_phone_jobs ? settings.printer_name : null;
  useEffect(() => {
    if (!enabled || !name) return;
    let stop = false;
    const round = async () => {
      if (busy.current || stop) return;
      busy.current = true;
      try {
        const q = await eGet<{ items: BadgeJob[] }>(`/events/${eventId}/badge-prints`, { status: 'QUEUED', printer: name, limit: 20 });
        const taken: number[] = [];
        for (const job of q.items) {
          if (stop) break;
          try {
            await ePost(`/badge-prints/${job.id}/dispatch`, { printer: name, device_id: deviceId ?? undefined, version: job.version });
            taken.push(job.id);
          } catch {
            /* another desk took it, or it moved: next round */
          }
        }
        if (taken.length > 0 && !stop) await printQueued(eventId, taken);
      } catch {
        /* the next round asks again */
      } finally {
        busy.current = false;
      }
    };
    void round();
    const t = window.setInterval(() => void round(), 10_000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [eventId, deviceId, name, enabled]);
}
