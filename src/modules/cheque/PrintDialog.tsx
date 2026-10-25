import { useEffect, useRef, useState } from 'react';
import type { ChequePrintOutcome } from '@shared/cheque';
import { Modal } from '../../components/ui';
import { refusal } from '../finance/api';
import { errorMessage } from '../../core/bridge';
import { confirmPrint, fetchChecks, openPdf, printCheque, requestReprint, type Checks, type Profile, type QueueItem } from './api';
import { withStepUp } from './StepUp';
import { Check, Note, btn, btnPrimary, num } from './parts';

/**
 * D03 — Direct print + confirm (CHQ-PRT-03..08, WF-06, WF-12). The main process asks the server for the job (the
 * nine pre-print checks run there), prints the leaf silently at 100 % and reports it spooled. Then the person takes
 * the leaf out and answers; the leaf stays reserved until they do:
 *
 *  - Printed correctly → `confirm printed` → PRINTED.
 *  - Something went wrong → the leaf is unused (`failed_unused`: stays reserved, print again) or spoiled
 *    (`spoiled`: VOID, the server reserves the next leaf and says whether approval still holds, BR-05).
 *  - A cheque already confirmed but unusable is a reprint request with a reason, for a different approver (BR-12).
 */
type Step = 'checking' | 'blocked' | 'sending' | 'failed' | 'check' | 'wrong' | 'saving' | 'done';

export function PrintDialog({ item, profile, onClose, onDone }: { item: QueueItem; profile: Profile; onClose: () => void; onDone: (result: 'printed' | 'failed_unused' | 'spoiled' | 'none') => void }) {
  const [step, setStep] = useState<Step>('checking');
  const [checks, setChecks] = useState<Checks | null>(null);
  const [out, setOut] = useState<ChequePrintOutcome | null>(null);
  const [answer, setAnswer] = useState<'printed' | 'wrong'>('printed');
  const [message, setMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [reprint, setReprint] = useState<string | null>(null);
  const sent = useRef(false);

  const send = async () => {
    // The pre-print checks first (CHQ-PRT-03), shown as the server answers them; the server runs them again when
    // it makes the job, so this is what the person sees, not what lets the print through.
    setStep('checking');
    setMessage(null);
    const c = await fetchChecks(item.cheque_id, profile.id).catch((e: unknown) => ({ ok: false, checks: [{ key: 'server', ok: false, message: refusal(e) }] }));
    setChecks(c);
    if (!c.ok) return setStep('blocked');
    setStep('sending');
    const r = await printCheque({ cheque_id: item.cheque_id, profile_id: profile.id }).catch((e: unknown): ChequePrintOutcome => ({ ok: false, job_id: null, cheque_id: item.cheque_id, spooled: false, message: refusal(e) }));
    setOut(r);
    setStep(r.spooled ? 'check' : 'failed');
  };
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = async (result: 'printed' | 'failed_unused' | 'spoiled') => {
    if (!out?.job_id) return;
    setStep('saving');
    try {
      const r = await confirmPrint(out.job_id, result, notes.trim());
      const next = typeof r?.cheque_number === 'string' && r.cheque_number !== item.cheque_number ? r.cheque_number : null;
      const again = r?.status === 'AWAITING_APPROVAL' || r?.status === 'DRAFT';
      setMessage(
        result === 'printed'
          ? `${item.cheque_number} is PRINTED.`
          : result === 'spoiled'
            ? `${item.cheque_number} is VOID and its number is never used again.${next ? ` The cheque moves to leaf ${next}` : ' The next leaf is reserved for this cheque'}${again ? ' and needs approving again.' : '.'}`
            : `${item.cheque_number} stays reserved. Load it again and print.`,
      );
      setStep('done');
      onDone(result);
    } catch (e) {
      setMessage(refusal(e));
      setStep(result === 'printed' ? 'check' : 'wrong');
    }
  };

  const askReprint = async () => {
    if (!reprint || reprint.trim().length < 5) return;
    try {
      await withStepUp('Asking for a reprint', (token) => requestReprint(item.cheque_id, reprint.trim(), token));
      setMessage('Reprint requested. A different approver has to agree; the original leaf is voided then.');
      setReprint(null);
    } catch (e) {
      setMessage(refusal(e));
    }
  };

  const closeable = step === 'failed' || step === 'done' || step === 'blocked';
  const footer =
    step === 'check' ? (
      <>
        <span className="mr-auto text-[11.5px] text-ink-2">The leaf stays reserved until you answer.</span>
        <button type="button" className={btn} onClick={() => setStep('wrong')}>Something went wrong</button>
        <button type="button" className={btnPrimary} disabled={answer !== 'printed'} onClick={() => void confirm('printed')}>Mark printed</button>
      </>
    ) : step === 'wrong' ? (
      <>
        <button type="button" className={`${btn} mr-auto`} onClick={() => setStep('check')}>Back</button>
        <button type="button" className={btn} onClick={() => void confirm('failed_unused')}>Leaf is unused — print again</button>
        <button type="button" className={btnPrimary} onClick={() => void confirm('spoiled')}>Leaf is spoiled — void it</button>
      </>
    ) : step === 'blocked' ? (
      <button type="button" className={btn} onClick={onClose}>Close</button>
    ) : step === 'failed' ? (
      <>
        <button type="button" className={`${btn} mr-auto`} onClick={onClose}>Close</button>
        <button type="button" className={btnPrimary} onClick={() => void send()}>Try again</button>
      </>
    ) : step === 'done' ? (
      <>
        <button type="button" className={`${btn} mr-auto`} onClick={() => void openPdf('voucher', item.cheque_id, `Voucher ${item.cheque_number}`).catch((e) => setMessage(errorMessage(e)))}>Voucher PDF</button>
        <button type="button" className={btnPrimary} onClick={onClose}>Done</button>
      </>
    ) : null;

  return (
    <Modal width={760} onClose={closeable ? onClose : undefined} footer={footer} title={<span>Printing cheque <span className={num}>{item.cheque_number}</span></span>}>
      <div className="flex flex-col gap-2.5">
        <div className="text-[12.5px] text-ink-2">{`${profile.printer_name}${profile.tray ? ` · ${profile.tray}` : ''} · exact size at 100 %`}</div>
        {step === 'checking' ? <Check tone="warn">Running the pre-print checks…</Check> : null}
        {checks ? (
          checks.ok ? (
            <Check tone="ok">{`Pre-print checks passed (${checks.checks.length} of ${checks.checks.length}) at ${new Date().toLocaleTimeString()}`}</Check>
          ) : (
            checks.checks.filter((c) => !c.ok).map((c) => <Check key={c.key} tone="bad">{c.message}</Check>)
          )
        ) : null}
        {step === 'blocked' ? <Note tone="err">Nothing was printed. Fix what the checks found on the web, then print again.</Note> : null}
        {step === 'sending' ? <Check tone="warn">Sending to the printer…</Check> : null}
        {step === 'failed' ? <Note tone="err">{out?.message ?? 'Not printed.'}</Note> : null}
        {out?.spooled ? (
          <>
            <Check tone="ok">{`Print job ${out.job_id ?? ''} signed for this computer and sent to the spooler`}</Check>
            <Check tone="ok">The printer took the job</Check>
          </>
        ) : null}
        {step === 'check' ? (
          <>
            <Note tone="info">Take the cheque out and check it: date, payee, words, figures and crossing inside their boxes, nothing on the MICR line.</Note>
            <div className="flex gap-3" role="radiogroup" aria-label="How did it print?">
              {(['printed', 'wrong'] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={answer === k} onClick={() => setAnswer(k)} className={`flex flex-1 items-start gap-2 rounded-[10px] border p-3 text-left ${answer === k ? 'border-primary bg-[#EEF1FD] dark:bg-selection' : 'border-line bg-surface'}`}>
                  <span aria-hidden className={`mt-0.5 size-3.5 shrink-0 rounded-full border-2 ${answer === k ? 'border-primary bg-primary' : 'border-ink-3'}`} />
                  <span>
                    <b className="text-[13px]">{k === 'printed' ? 'Printed correctly' : 'Something went wrong'}</b>
                    <span className="block text-[11.5px] text-ink-2">{k === 'printed' ? `Mark ${item.cheque_number} PRINTED` : 'Jam, misalignment, smudge or blank leaf'}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}
        {step === 'wrong' ? (
          <>
            <Note tone="warn">Is the leaf still blank and undamaged? Then it stays reserved and you print it again. If anything is on it, or it is torn, it is spoiled: it becomes VOID and its number is never used again.</Note>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
              Note for audit
              <input className="h-8 rounded-[7px] border border-line bg-surface px-2.5 text-[13px] font-normal text-ink" value={notes} maxLength={250} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Jam on the feed roller" />
            </label>
          </>
        ) : null}
        {step === 'saving' ? <Check tone="warn">Saving your answer…</Check> : null}
        {message ? <Note tone={step === 'done' ? 'plain' : 'err'}>{message}</Note> : null}
        {step === 'done' ? (
          reprint === null ? (
            <button type="button" className="self-start text-[12px] font-semibold text-primary hover:underline" onClick={() => setReprint('')}>Printed but unusable? Request a reprint…</button>
          ) : (
            <div className="flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1 text-[12px] font-semibold text-ink-2">
                Why does it need printing again?
                <input className="h-8 rounded-[7px] border border-line bg-surface px-2.5 text-[13px] font-normal text-ink" value={reprint} maxLength={250} onChange={(e) => setReprint(e.target.value)} />
              </label>
              <button type="button" className={btn} disabled={reprint.trim().length < 5} onClick={() => void askReprint()}>Request reprint</button>
            </div>
          )
        ) : null}
      </div>
    </Modal>
  );
}
