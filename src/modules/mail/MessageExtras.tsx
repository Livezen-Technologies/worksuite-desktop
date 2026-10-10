import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError, apiGet, apiPost, withMailbox } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Button, Chip, ErrorNote, Modal, Spinner } from '../../components/ui';
import type { SmimeVerdict } from '@shared/smime';
import type { MessageMarkers, MessageRef } from './types';

/**
 * What a message carries beside its text (ENH-MAIL-03 P4): Report phishing
 * (DMO-SEC-02), Recall (DMO-CMP-10), voting buttons and their tally
 * (DMO-CMP-12), a read-receipt request (DMO-CMP-11) and S/MIME status
 * (DMO-SEC-05).
 *
 * HONEST ABOUT LIMITS (§1.4): recall, votes and read receipts are only
 * guaranteed between WorkSuite mailboxes, and each place that offers them
 * says so before the person relies on it.
 */

// ---- Report phishing / junk (DMO-SEC-02, WF-DO10, O-UI-17) ---------------------------------------

export function ReportDialog({ kind, msgRef, from, subject, canBlock, onDone, onClose }: { kind: 'phishing' | 'junk'; msgRef: MessageRef; from: string; subject: string; canBlock: boolean; onDone: () => void; onClose: () => void }) {
  const qc = useQueryClient();
  const [block, setBlock] = useState(kind === 'phishing');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      // Mail protection (ENH-MAIL-04 MPR-TRN, WF-P06): phishing is reported to the protection service — held for the
      // reporter, its links and fingerprint on the organisation's lists. An older server takes the plain report.
      if (kind === 'phishing') {
        const held = await apiPost(`/api/mail/messages/${msgRef.uid}/report-phish`, { folder: msgRef.folder, ...(msgRef.mailbox ? { mailbox: msgRef.mailbox } : {}) }).then(
          () => true,
          (e: unknown) => {
            if (e instanceof ApiError && e.status === 404) return false;
            throw e;
          },
        );
        if (held) {
          const blocked = block && canBlock ? await blockSender(from, msgRef.mailbox) : false;
          void qc.invalidateQueries({ queryKey: ['mail'] });
          toast('success', `${text('Reported — it is held in your quarantine, and its links are blocked for everyone in your organisation.')}${block ? ` ${blocked ? text('{email} is blocked.', { email: from }) : text('{email} could not be blocked from this mailbox.', { email: from })}` : ''}`);
          onDone();
          return;
        }
      }
      const r = await apiPost<{ moved_to: string | null; forwarded_to: string | null; security_mailbox: boolean }>(`/api/mail/messages/${msgRef.uid}/report`, { folder: msgRef.folder, kind, block, ...(msgRef.mailbox ? { mailbox: msgRef.mailbox } : {}) });
      let blocked = false;
      if (block && canBlock) {
        blocked = await apiPost('/api/mail/rules/sender', { email: from, action: 'block', ...(msgRef.mailbox ? { mailbox: msgRef.mailbox } : {}) }).then(
          () => true,
          () => false,
        );
      }
      void qc.invalidateQueries({ queryKey: ['mail'] });
      const where = r.moved_to === 'trash' ? text('moved to Deleted Items') : r.moved_to === 'junk' ? text('moved to Junk') : text('left where it is — move it yourself');
      const told = kind === 'phishing' ? (r.forwarded_to ? text('Your security team has a copy.') : text('It is in your organisation’s list of reported messages.')) : '';
      toast('success', `${text('Reported — {where}.', { where })} ${told}${block ? ` ${blocked ? text('{email} is blocked.', { email: from }) : text('{email} could not be blocked from this mailbox.', { email: from })}` : ''}`.trim());
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={kind === 'phishing' ? text('Report phishing') : text('Report junk')}
      labelledBy="mail-report-title"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={kind === 'phishing' ? 'danger' : 'primary'} onClick={() => void send()} loading={busy}>
            {kind === 'phishing' ? text('Report phishing') : text('Report junk')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 p-4 text-[13px] text-ink">
        <p>{kind === 'phishing' ? text('“{subject}” is removed from your inbox and sent, untouched, to your organisation’s security team, who can remove it from other mailboxes too.', { subject: subject || text('(no subject)') }) : text('“{subject}” goes to Junk, and the spam filter learns from it.', { subject: subject || text('(no subject)') })}</p>
        <label className="flex items-center gap-2">
          <Checkbox checked={block} onChange={(e) => setBlock(e.target.checked)} disabled={!canBlock} />
          {text('Also block {email}', { email: from })}
        </label>
        {!canBlock ? <p className="text-[12px] text-ink-3">Blocking needs a WorkSuite mailbox, which keeps its rules on the mail server.</p> : null}
      </div>
    </Modal>
  );
}

/** Block a sender on the person's protection list; through the mail rules on a server without one. */
async function blockSender(email: string, mailbox: string | null): Promise<boolean> {
  try {
    await apiPost('/api/mail/protection/lists/me', { kind: 'block', value: email.toLowerCase() });
    return true;
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) return false;
  }
  return apiPost('/api/mail/rules/sender', { email, action: 'block', ...(mailbox ? { mailbox } : {}) }).then(
    () => true,
    () => false,
  );
}

// ---- Recall (DMO-CMP-10, WF-DO07, O-UI-15) -------------------------------------------------------------

interface RecallInfo {
  recallable: boolean;
  reason: string | null;
  expires_at?: string;
  days?: number;
  recipients: Array<{ address: string; recallable: boolean; reason: string | null }>;
  recalls: RecallReport[];
}

export interface RecallReport {
  id: number;
  mode: string;
  created_at: string;
  counts: Record<string, number>;
  results: Array<{ recipient: string; state: string; detail: string | null }>;
}

export function recallStateWords(state: string): string {
  switch (state) {
    case 'deleted':
      return text('Removed before it was read');
    case 'read':
      return text('Already read — left where it is');
    case 'external':
      return text('Outside your organisation — not recalled');
    case 'not_found':
      return text('Not found (deleted or never delivered)');
    default:
      return text('Could not be reached');
  }
}

export function RecallDialog({ messageId, onReplace, onClose }: { messageId: string; onReplace: () => void; onClose: () => void }) {
  const info = useQuery({ queryKey: ['mail', 'recall', messageId], queryFn: () => apiGet<RecallInfo>('/api/mail/recalls', { message_id: messageId }), retry: false });
  const [busy, setBusy] = useState<'delete' | 'replace' | null>(null);
  const [report, setReport] = useState<RecallReport | null>(null);
  const run = async (mode: 'delete' | 'replace') => {
    setBusy(mode);
    try {
      const r = await apiPost<RecallReport>('/api/mail/recalls', { message_id: messageId, mode });
      setReport(r);
      if (mode === 'replace') onReplace();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const i = info.data;
  const shown = report ?? i?.recalls[0] ?? null;
  return (
    <Modal title={text('Recall this message')} labelledBy="mail-recall-title" width={560} onClose={busy ? undefined : onClose} footer={
      report ? <Button variant="primary" onClick={onClose}>Close</Button> : (
        <>
          <Button onClick={onClose} disabled={!!busy}>Cancel</Button>
          <Button onClick={() => void run('replace')} disabled={!i?.recallable || !!busy} loading={busy === 'replace'}>Delete and replace…</Button>
          <Button variant="primary" onClick={() => void run('delete')} disabled={!i?.recallable || !!busy} loading={busy === 'delete'}>Delete unread copies</Button>
        </>
      )
    }>
      <div className="flex flex-col gap-3 p-4 text-[13px] text-ink">
        <p role="note" className="rounded-[8px] bg-subtle px-3 py-2 text-[12.5px] text-ink-2">Recall only works for colleagues with a WorkSuite mailbox in your organisation, and only for a copy they have not read yet. Anyone else keeps the message.</p>
        {info.isLoading ? <Spinner /> : info.error ? <ErrorNote error={info.error} /> : i?.reason === 'not_sent_here' ? (
          <p>This message was not sent from WorkSuite, so it cannot be recalled.</p>
        ) : i ? (
          <>
            {!i.recallable ? <p className="text-warning">{i.reason === 'too_old' ? text('It is older than {n} days, your organisation’s recall window.', { n: i.days ?? 7 }) : text('None of the recipients has a WorkSuite mailbox in your organisation.')}</p> : null}
            {shown ? (
              <section aria-label={text('Recall report')}>
                <h3 className="mb-1 font-semibold">{text('Recall report')}</h3>
                <ul className="flex flex-col gap-1">
                  {shown.results.map((r) => (
                    <li key={r.recipient} className="flex items-center gap-2">
                      <Icon name={r.state === 'deleted' ? 'check' : r.state === 'read' ? 'eye' : 'x'} size={13} className={r.state === 'deleted' ? 'text-success' : 'text-ink-3'} />
                      <span className="min-w-0 flex-1 truncate">{r.recipient}</span>
                      <span className="text-[12px] text-ink-3">{recallStateWords(r.state)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <ul className="flex flex-col gap-1">
                {i.recipients.map((r) => (
                  <li key={r.address} className="flex items-center gap-2">
                    <Icon name={r.recallable ? 'check' : 'x'} size={13} className={r.recallable ? 'text-success' : 'text-ink-3'} />
                    <span className="min-w-0 flex-1 truncate">{r.address}</span>
                    <span className="text-[12px] text-ink-3">{r.recallable ? text('Can be recalled if unread') : r.reason === 'too_old' ? text('Too old') : text('Outside your organisation')}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

// ---- Voting buttons (DMO-CMP-12) ---------------------------------------------------------------------------

export function VoteBar({ msgRef, choices, subject, onReply }: { msgRef: MessageRef; choices: string[]; subject: string; onReply: (choice: string) => void }) {
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: ['mail', 'vote', msgRef.mailbox, msgRef.folder, msgRef.uid],
    queryFn: () => apiGet<{ choices: string[]; counted: boolean; mine: string | null }>(`/api/mail/messages/${msgRef.uid}/vote`, withMailbox({ folder: msgRef.folder }, msgRef.mailbox)),
    retry: false,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const vote = async (choice: string) => {
    if (state.data && !state.data.counted) return onReply(choice);
    setBusy(choice);
    try {
      await apiPost(`/api/mail/messages/${msgRef.uid}/vote`, { folder: msgRef.folder, choice, ...(msgRef.mailbox ? { mailbox: msgRef.mailbox } : {}) });
      void qc.invalidateQueries({ queryKey: ['mail', 'vote', msgRef.mailbox, msgRef.folder, msgRef.uid] });
      toast('success', text('You voted {choice}.', { choice }));
    } catch (e) {
      // The sender is not on this server after all: the vote goes back as a reply.
      if (e instanceof ApiError && e.status === 409) onReply(choice);
      else toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const mine = state.data?.mine ?? null;
  return (
    <div role="group" aria-label={text('Voting buttons')} className="mx-6 mt-3 flex flex-wrap items-center gap-2 rounded-[8px] border border-line bg-selection px-3 py-2 text-[12.5px] text-ink">
      <Icon name="tasks" size={14} className="text-primary" />
      <span className="font-semibold">{mine ? text('You voted {choice}.', { choice: mine }) : text('The sender asks you to vote:')}</span>
      {choices.map((c) => (
        <Button key={c} size="sm" variant={mine === c ? 'primary' : 'secondary'} onClick={() => void vote(c)} loading={busy === c} aria-pressed={mine === c}>
          {c}
        </Button>
      ))}
      <span className="text-[11.5px] text-ink-3">{state.data && !state.data.counted ? text('The sender is not on this WorkSuite server — your choice goes back as a reply about “{subject}”.', { subject: subject || text('(no subject)') }) : text('Counted for the sender in WorkSuite.')}</span>
    </div>
  );
}

export function VoteTally({ messageId }: { messageId: string }) {
  const t = useQuery({
    queryKey: ['mail', 'tally', messageId],
    queryFn: () => apiGet<{ options: string[]; counts: Record<string, number>; responses: Array<{ voter: string; choice: string }>; waiting: string[] } | null>('/api/mail/votes', { message_id: messageId }),
    retry: false,
    refetchInterval: 60_000,
  });
  if (!t.data) return null;
  return (
    <div role="status" aria-label={text('Voting results')} className="mx-6 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[8px] border border-line bg-subtle px-3 py-2 text-[12.5px] text-ink">
      <Icon name="chart" size={14} className="text-primary" />
      {t.data.options.map((o) => (
        <span key={o}>
          <b>{o}</b> {t.data!.counts[o] ?? 0}
        </span>
      ))}
      {t.data.waiting.length ? <span className="text-ink-3">{text('{n} not voted yet', { n: t.data.waiting.length })}</span> : null}
      <span className="text-[11.5px] text-ink-3">Votes from people outside this WorkSuite server arrive as replies instead.</span>
    </div>
  );
}

// ---- Read receipts (DMO-CMP-11) ---------------------------------------------------------------------------

/** Send a read receipt to whoever asked — a short message, as most mail apps understand one. */
export async function sendReceipt(to: string, subject: string, mailbox: string | null): Promise<void> {
  const when = new Date().toUTCString();
  await apiPost('/api/mail/send', {
    to: [to],
    subject: `Read: ${subject}`.slice(0, 250),
    body_html: `<p>${text('Your message “{subject}” was read on {when}.', { subject: subject.replace(/[<>&]/g, ''), when })}</p>`,
    track: false,
    ...(mailbox ? { mailbox: Number(mailbox) } : {}),
  });
}

export function ReceiptBar({ to, subject, mailbox, onAnswered }: { to: string; subject: string; mailbox: string | null; onAnswered: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div role="note" className="mx-6 mt-3 flex flex-wrap items-center gap-2 rounded-[8px] border border-line bg-subtle px-3 py-2 text-[12.5px] text-ink">
      <Icon name="mail-check" size={14} className="text-ink-3" />
      <span className="min-w-0 flex-1">{text('{email} asked to be told when you read this.', { email: to })}</span>
      <Button size="sm" loading={busy} onClick={() => {
        setBusy(true);
        void sendReceipt(to, subject, mailbox).then(() => (toast('success', text('Read receipt sent.')), onAnswered()), (e) => toast('error', errorMessage(e))).finally(() => setBusy(false));
      }}>Send receipt</Button>
      <Button size="sm" variant="ghost" onClick={onAnswered}>Don’t send</Button>
    </div>
  );
}

// ---- S/MIME (DMO-SEC-05) -------------------------------------------------------------------------------

/** The S/MIME status chip: only "verified" when the signature, chain, dates and address all checked on this computer. */
export function SmimeChip({ msgRef, from, mailbox }: { msgRef: MessageRef; from: string; mailbox: string | null }) {
  const v = useQuery({
    queryKey: ['mail', 'smime', msgRef.mailbox, msgRef.folder, msgRef.uid],
    queryFn: () => call('smime:verify', { uid: msgRef.uid, folder: msgRef.folder, mailbox: msgRef.mailbox ?? null }),
    retry: false,
    staleTime: 10 * 60_000,
  });
  const verdict: SmimeVerdict | undefined = v.data;
  // A verified signer's public certificate is kept for this person, to encrypt to them later.
  useEffect(() => {
    if (verdict?.state === 'verified' && verdict.certificate) void apiPost('/api/mail/certificates', { address: from, certificate: verdict.certificate, source: 'collected', ...(mailbox ? { mailbox } : {}) }).catch(() => undefined);
  }, [verdict, from, mailbox]);
  if (v.isLoading) return <Chip>{text('Signed · checking…')}</Chip>;
  if (v.error || !verdict) return <span title={v.error ? errorMessage(v.error) : undefined}><Chip tone="warning">{text('Signed · not checked')}</Chip></span>;
  if (verdict.state === 'none') return null;
  const label = {
    verified: text('Signed · verified'),
    untrusted: text('Signed · not trusted'),
    invalid: text('Signed · does not match'),
    mismatch: text('Signed · another address'),
    expired: text('Signed · certificate expired'),
    encrypted: text('Encrypted'),
  }[verdict.state];
  return (
    <span title={verdict.detail}>
      <Chip tone={verdict.state === 'verified' ? 'success' : verdict.state === 'invalid' || verdict.state === 'mismatch' ? 'danger' : 'warning'}>
        <Icon name={verdict.state === 'verified' ? 'shield-check' : 'shield-alert'} size={12} />
        {label}
      </Chip>
    </span>
  );
}

/** Sensitivity and importance as the sender marked them (DMO-CMP-13). */
export function MarkerChips({ markers }: { markers: MessageMarkers | undefined }) {
  if (!markers) return null;
  return (
    <>
      {markers.importance === 'high' ? (
        <Chip tone="danger">
          <Icon name="alert" size={12} />
          {text('High importance')}
        </Chip>
      ) : null}
      {markers.sensitivity ? <Chip tone="warning">{{ personal: text('Personal'), private: text('Private'), confidential: text('Confidential') }[markers.sensitivity]}</Chip> : null}
    </>
  );
}
