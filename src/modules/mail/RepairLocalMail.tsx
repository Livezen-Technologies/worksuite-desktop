import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { MailRepairResult } from '@shared/types';
import { apiGet } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Button, ErrorNote, Modal } from '../../components/ui';
import type { RecoverProps } from '../registry';
import { safeMailboxes } from './safety';
import { includedIds, runSync } from './sync';

/**
 * Repair local mail data (worksuite-desktop#338): offered on Mail's "failed to load" screen and in Settings › Mail ›
 * Accounts & offline. The main process checks the database (electron/services/mail-repair.ts): healthy, Mail's copy
 * on this computer is cleared and downloaded again from the server — a fresh full sync; damaged, WorkSuite restarts
 * and rebuilds it. Unsent mail in the outbox, drafts and the account settings are kept either way.
 */

/** Run the repair, then start Mail from the server again. */
export async function repairLocalMail(qc: QueryClient): Promise<MailRepairResult> {
  const r = await call('offline:repairMail');
  if (r.action === 'cleared') {
    // Nothing read before the repair is drawn again: every Mail query asks afresh.
    qc.removeQueries({ queryKey: ['mail'] });
    try {
      const boxes = safeMailboxes(await apiGet<unknown>('/api/mail/mailboxes')).mailboxes;
      void runSync(includedIds(null, boxes), { all: true });
    } catch {
      // Offline: the copy is downloaded again when the server can be reached.
    }
  }
  return r;
}

/** What happened, in words. */
export function repairWords(r: MailRepairResult): string {
  const kept = r.kept.outbox === 1 ? text('1 unsent message and your account settings were kept.') : text('{n} unsent messages and your account settings were kept.', { n: r.kept.outbox });
  if (r.action === 'restart') return `${text('The local mail database is damaged. WorkSuite restarts to rebuild it from the server.')} ${kept}`;
  return `${text('Mail on this computer was cleared and is being downloaded again.')} ${kept}`;
}

export function RepairLocalMailButton({ onDone, size = 'md' }: RecoverProps & { size?: 'sm' | 'md' }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await repairLocalMail(qc);
      toast(r.action === 'restart' ? 'info' : 'success', repairWords(r));
      setOpen(false);
      if (r.action === 'cleared') onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size={size} icon="wrench" onClick={() => setOpen(true)}>
        {text('Repair local mail data')}
      </Button>
      {open ? (
        <Modal
          title={text('Repair local mail data')}
          width={480}
          onClose={busy ? undefined : () => setOpen(false)}
          footer={
            <>
              <Button disabled={busy} onClick={() => setOpen(false)}>
                {text('Cancel')}
              </Button>
              <Button variant="primary" loading={busy} onClick={() => void run()}>
                {text('Repair')}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 text-[13px] text-ink-2">
            <p className="m-0">{text('WorkSuite checks the mail kept on this computer, sets the old copy aside and downloads your mail again from the server.')}</p>
            <p className="m-0">{text('Unsent mail in your outbox, drafts and your account settings are kept. If the local database is damaged, WorkSuite restarts to rebuild it.')}</p>
            {error ? <ErrorNote error={error} /> : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** Mail's way out of its "failed to load" screen (registry `recover`). */
export default function RepairLocalMail({ onDone }: RecoverProps) {
  return <RepairLocalMailButton onDone={onDone} />;
}
