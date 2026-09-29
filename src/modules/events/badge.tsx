import { useState, type ReactNode } from 'react';
import { Button, Modal } from '../../components/ui';
import { toast } from '../../core/toasts';
import type { BadgeJob } from '@shared/event-desk';
import { codeOf, errorData, errorText, ePost } from './api';
import { printJobs, usePrintSettings } from './desk';
import { Refusal } from './parts';

/**
 * A badge, printed at this desk (EV-BDG-010..013): a print job on the server
 * first (`POST registrations/{id}/badge/print` — the first print, or a
 * reprint with its permission, confirmation and reason), then the server's
 * badge page on this computer's printer, and the job reported printed or
 * failed (the main process's event-desk-print.ts). The server decides which
 * template, and whether this is a first print or a reprint.
 */

/** Print jobs already on the server (an automatic print on check-in, a phone's job): on this desk's printer now. */
export async function printQueued(eventId: number, jobIds: number[]): Promise<boolean> {
  try {
    const r = await printJobs(eventId, jobIds);
    toast(r.ok ? 'success' : 'error', r.message);
    return r.ok;
  } catch (e) {
    toast('error', errorText(e, 'The badge was not printed.'));
    return false;
  }
}

/** Print a registration's badge; a reprint asks for its reason first. */
export function useBadge(eventId: number, deviceId: number | null): { print: (registrationId: number, who: string) => void; busy: boolean; dialog: ReactNode } {
  const settings = usePrintSettings();
  const [busy, setBusy] = useState(false);
  const [reprint, setReprint] = useState<{ id: number; who: string; message: string } | null>(null);
  const [waiting, setWaiting] = useState<{ jobId: number; who: string; message: string } | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const send = async (registrationId: number, who: string, again?: { reason: string }) => {
    setBusy(true);
    setError(null);
    try {
      const r = await ePost<{ job: BadgeJob }>(`/registrations/${registrationId}/badge/print`, {
        device_id: deviceId ?? undefined,
        printer: settings.data?.printer_name ?? undefined,
        ...(again ? { confirm: true, reason: again.reason || undefined } : {}),
      });
      setReprint(null);
      await printQueued(eventId, [r.data.job.id]);
    } catch (e) {
      const code = codeOf(e);
      if (code === 'confirm' || (again && errorData<{ field?: string }>(e)?.field === 'reason')) {
        setReprint({ id: registrationId, who, message: errorText(e) });
        if (again) setError(errorText(e));
      } else if (code === 'already_queued') {
        const job = errorData<{ job_id?: number }>(e)?.job_id;
        if (job) setWaiting({ jobId: job, who, message: errorText(e) });
        else toast('error', errorText(e));
      } else if (again) {
        setError(errorText(e));
      } else {
        toast('error', errorText(e, 'The badge was not printed.'));
      }
    } finally {
      setBusy(false);
    }
  };

  const dialog = (
    <>
      {reprint ? (
        <Modal
          title={`Reprint the badge — ${reprint.who}`}
          onClose={() => setReprint(null)}
          width={460}
          footer={
            <>
              <Button onClick={() => setReprint(null)}>Cancel</Button>
              <Button variant="primary" icon="printer" loading={busy} onClick={() => void send(reprint.id, reprint.who, { reason: reason.trim() })}>
                Reprint
              </Button>
            </>
          }
        >
          <p className="mt-0 text-[13px] text-ink-2">{reprint.message}</p>
          <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink-2">
            Why is it printed again?
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} placeholder="Lost, damaged, name corrected…" className="h-9 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-normal text-ink outline-none focus:border-primary" />
          </label>
          {error ? (
            <div className="mt-3">
              <Refusal text={error} />
            </div>
          ) : null}
        </Modal>
      ) : null}
      {waiting ? (
        <Modal
          title={`A badge is waiting — ${waiting.who}`}
          onClose={() => setWaiting(null)}
          width={440}
          footer={
            <>
              <Button onClick={() => setWaiting(null)}>Close</Button>
              <Button
                variant="primary"
                icon="printer"
                onClick={() => {
                  const id = waiting.jobId;
                  setWaiting(null);
                  void printQueued(eventId, [id]);
                }}
              >
                Print it here
              </Button>
            </>
          }
        >
          <p className="m-0 text-[13px] text-ink-2">{waiting.message} Print that one on this desk’s printer?</p>
        </Modal>
      ) : null}
    </>
  );

  return { print: (id, who) => void send(id, who), busy, dialog };
}
