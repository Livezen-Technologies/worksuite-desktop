import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, apiPost } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, Modal, cx } from '../../../components/ui';
import { junkMessage } from '../api';
import type { MessageRef } from '../types';
import { addMyListEntry, protectionKeys, releaseQuarantined, requestRelease, scanAttachment } from './api';
import { actionLabel, type AttachmentAccess, type BannerModel } from './verdicts';
import type { AttachmentStatus, BannerAction, MessageProtection } from './types';

/**
 * The verdict banner (P-UI-10, MPR-UX-01, MPR-UX-08): one component for Junk, Phish, Spoof, Malware, Policy, Not scanned
 * and Checking, between the reader's header and the body. Icon and words, never colour alone; an accessible name; its
 * actions as real buttons in reading order. A danger banner is announced (role alert), the others are a status.
 * Everything it does needs the server, so offline its buttons say so and wait.
 */

const TONES: Record<BannerModel['tone'], string> = {
  danger: 'border-[#F3C7BE] bg-[#FCE9E4] text-[#8A1C12] dark:border-[#5A2620] dark:bg-[#3D1A16] dark:text-[#FFB4A8]',
  warn: 'border-[#F2D3AE] bg-[#FDF0E1] text-[#7A3B05] dark:border-[#5A3B14] dark:bg-[#3A2610] dark:text-[#F5C08A]',
  info: 'border-[#C9DBFA] bg-[#E6F0FF] text-[#0A4AB0] dark:border-[#1D3D6E] dark:bg-[#0F2A52] dark:text-[#9CC4FF]',
  neutral: 'border-line bg-subtle text-ink',
};

export interface BannerProps {
  model: BannerModel;
  protection: MessageProtection;
  msgRef: MessageRef;
  from: { name: string | null; email: string };
  subject: string;
  offline: boolean;
  /** The attachments that are locked and may be scanned now. */
  scannable: Array<{ ref: string; access: AttachmentAccess }>;
  onHeaders: () => void;
  onReportPhish: () => void;
  /** The message left the folder (Junk, Not junk, released elsewhere). */
  onGone: () => void;
  /** A shown-from-this-computer note ("Saved verdict — checked again when you are online"). */
  cachedNote?: string | null;
}

export function VerdictBanner(p: BannerProps) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<BannerAction | null>(null);
  const [asking, setAsking] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: protectionKeys.message(p.msgRef) });
    void qc.invalidateQueries({ queryKey: protectionKeys.quarantineAll });
  };
  const sender = p.from.email.toLowerCase();
  const trust = async () => {
    await addMyListEntry('allow', sender);
    void qc.invalidateQueries({ queryKey: protectionKeys.lists });
    toast('success', text('{email} is on your safe senders. Viruses and phishing are still checked.', { email: sender }));
  };
  const run = async (a: BannerAction) => {
    if (a === 'headers') return p.onHeaders();
    if (a === 'report_phish') return p.onReportPhish();
    if (a === 'request_release') return setAsking(true);
    setBusy(a);
    try {
      if (a === 'junk' || a === 'not_junk') {
        const r = await junkMessage(p.msgRef, a, p.subject);
        void qc.invalidateQueries({ queryKey: ['mail'] });
        if (r.outcome === 'queued') toast('info', text('Offline — this happens when you reconnect. Undo it in Waiting to send.'));
        else if (a === 'not_junk' && r.offerTrust) toast('success', text('Moved to the Inbox.'), { label: text('Always trust sender'), run: () => void trust().catch((e) => toast('error', errorMessage(e))) });
        else toast('success', a === 'junk' ? text('Moved to Junk. The filter learns from it.') : text('Moved to the Inbox.'));
        p.onGone();
      } else if (a === 'release' && p.protection.quarantine_id !== null) {
        await releaseQuarantined(p.protection.quarantine_id);
        toast('success', text('Released to your Inbox.'));
        refresh();
      } else if (a === 'trust_sender') {
        await trust();
      } else if (a === 'block_sender') {
        try {
          await addMyListEntry('block', sender);
          void qc.invalidateQueries({ queryKey: protectionKeys.lists });
        } catch (e) {
          // A server without personal lists still blocks through the mail rules.
          if (!(e instanceof ApiError && e.status === 404)) throw e;
          await apiPost('/api/mail/rules/sender', { email: sender, action: 'block', ...(p.msgRef.mailbox ? { mailbox: p.msgRef.mailbox } : {}) });
        }
        toast('success', text('{email} is blocked: new mail from them goes to Junk.', { email: sender }));
      } else if (a === 'scan_now') {
        await scanAll(p.msgRef, p.scannable);
        refresh();
      }
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const danger = p.model.tone === 'danger';
  const titleId = `verdict-${p.msgRef.uid}`;
  return (
    <section
      role={danger ? 'alert' : 'status'}
      aria-labelledby={titleId}
      data-verdict-banner={p.model.kind}
      className={cx('mx-5 mt-3 flex flex-col gap-2 rounded-[10px] border px-3.5 py-2.5 text-[12.5px] leading-[1.45]', TONES[p.model.tone])}
    >
      <div className="flex items-start gap-2.5">
        <Icon name={p.model.icon} size={18} className={cx('mt-px shrink-0', p.model.kind === 'checking' && 'animate-spin-slow motion-reduce:animate-none')} />
        <div className="min-w-0">
          <p id={titleId} className="font-bold">
            {p.model.title}
          </p>
          <p>{p.model.text}</p>
          {p.protection.reasons.length ? (
            <ul aria-label={text('Why')} className="mt-1 flex flex-col gap-0.5">
              {p.protection.reasons.slice(0, 4).map((r) => (
                <li key={r.code} className="flex gap-1.5">
                  <span aria-hidden>•</span>
                  {r.text}
                </li>
              ))}
            </ul>
          ) : null}
          {p.cachedNote ? <p className="mt-1 opacity-80">{p.cachedNote}</p> : null}
        </div>
      </div>
      {p.model.actions.length ? (
        <div className="flex flex-wrap gap-1.5 pl-[28px]">
          {p.model.actions.map((a) => {
            const local = a === 'headers' || a === 'report_phish';
            const disabled = (p.offline && !local) || (a === 'scan_now' && !p.scannable.length) || busy !== null;
            return (
              <Button
                key={a}
                size="sm"
                variant={a === 'release' || a === 'not_junk' || a === 'scan_now' ? 'primary' : 'secondary'}
                loading={busy === a}
                disabled={disabled}
                title={p.offline && !local ? text('Available when you are back online.') : undefined}
                data-banner-action={a}
                onClick={() => void run(a)}
              >
                {actionLabel(a)}
              </Button>
            );
          })}
        </div>
      ) : null}
      {asking && p.protection.quarantine_id !== null ? <RequestReleaseDialog id={p.protection.quarantine_id} subject={p.subject} onDone={refresh} onClose={() => setAsking(false)} /> : null}
    </section>
  );
}

/** Scan every locked attachment now; each answer replaces its chip when the protection is asked again. */
export async function scanAll(ref: MessageRef, items: Array<{ ref: string }>): Promise<AttachmentStatus[]> {
  const out: AttachmentStatus[] = [];
  for (const a of items.slice(0, 20)) out.push((await scanAttachment(ref, a.ref)).status);
  return out;
}

/** Request release (phish, spoof, policy): an optional note for the admins; the person is told either way (WF-P07). */
export function RequestReleaseDialog({ id, subject, onDone, onClose }: { id: number; subject: string; onDone: () => void; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await requestRelease(id, note);
      toast('success', text('Release requested. You will be told when an administrator decides.'));
      onDone();
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={text('Request release')}
      labelledBy="mail-request-release"
      width={460}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {text('Cancel')}
          </Button>
          <Button variant="primary" onClick={() => void send()} loading={busy}>
            {text('Send request')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 p-4 text-[13px] text-ink">
        <p>{text('An administrator reviews “{subject}” before it can reach your Inbox.', { subject: subject || text('(no subject)') })}</p>
        <label htmlFor="release-note" className="text-[12.5px] font-semibold text-ink-2">
          {text('Why you expected it (optional)')}
        </label>
        <textarea id="release-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} rows={3} className="rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink" />
      </div>
    </Modal>
  );
}
