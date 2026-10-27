import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import { btn, btnPrimary, Field, input, Sheet } from '../../components/PageKit';
import { sendInvoice, sendOutcome, sendPreview, sendProblem, splitAddresses, type SendBody } from './actions';
import { fetchTemplates, KA } from './admin';
import { amount, invoiceName, K, type InvoiceDetail } from './api';

/**
 * Send an invoice (W12, G-05): to and cc, a message template, the subject and
 * message, the PDF and a "Pay now" link, and WhatsApp beside the email. The
 * right-hand side is what the customer sees, as the server renders it
 * (`send-preview`), drawn in a sandbox with no scripts. Sending is the
 * server's: it says which channels went, and anything it could not do.
 */
export default function SendDialog({ inv, org, onClose }: { inv: InvoiceDetail; org: string; onClose: (sent?: boolean) => void }) {
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: [...KA.templates(org), 'invoice'], queryFn: ({ signal }) => fetchTemplates(org, 'invoice', signal), staleTime: 300_000, retry: false });
  const [to, setTo] = useState(inv.contact_email ?? inv.client_email ?? '');
  const [cc, setCc] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState(`Invoice ${invoiceName(inv)}`);
  const [message, setMessage] = useState(defaultMessage(inv));
  const [attachPdf, setAttachPdf] = useState(true);
  const [payLink, setPayLink] = useState(inv.due > 0);
  const [whatsapp, setWhatsapp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const body: SendBody = { to: splitAddresses(to), cc: splitAddresses(cc), template_id: templateId ? Number(templateId) : null, subject: subject.trim(), message: message.trim(), attach_pdf: attachPdf, include_pay_link: payLink, whatsapp };
  const problem = sendProblem(body);
  const key = JSON.stringify({ ...body, to: [], cc: [] });

  // The preview follows the words, a moment after typing stops.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      sendPreview(inv.id, JSON.parse(key) as SendBody).then(
        (p) => (setPreview(p), setPreviewError(null)),
        (e) => setPreviewError(errorMessage(e)),
      );
    }, 400);
    return () => void (timer.current && clearTimeout(timer.current));
  }, [inv.id, key]);

  const chooseTemplate = (v: string) => {
    setTemplateId(v);
    const t = (templates.data ?? []).find((x) => String(x.id) === v);
    if (t) {
      if (t.subject) setSubject(t.subject);
      if (t.body) setMessage(t.body);
    }
  };

  const send = async () => {
    if (problem) return;
    setBusy(true);
    try {
      const r = await sendInvoice(inv.id, body);
      const o = sendOutcome(r.data);
      toast(o.ok ? 'success' : 'error', r.message ?? o.text);
      for (const w of o.warnings) toast('error', w);
      void qc.invalidateQueries({ queryKey: K.all });
      if (o.ok) onClose(true);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={`Send ${invoiceName(inv)}`}
      width={900}
      onClose={() => onClose()}
      footer={
        <>
          {problem ? <span className="mr-auto self-center text-[12.5px] text-ink-3">{problem}</span> : null}
          <button type="button" className={btn} onClick={() => onClose()}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !!problem} onClick={() => void send()}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </>
      }
    >
      <p className="m-0 -mt-1 text-[12.5px] text-ink-3">
        {inv.client ?? 'No customer'} · outstanding {amount(inv.due, inv.currency)}
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4">
        <div className="flex min-w-0 flex-col gap-2.5">
          <Field label="To" hint="Separate several with commas">
            <input aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} placeholder="accounts@customer.lk" className={input} />
          </Field>
          <Field label="Cc">
            <input aria-label="Cc" value={cc} onChange={(e) => setCc(e.target.value)} className={input} />
          </Field>
          <Field label="Template">
            <Select<string>
              aria-label="Template"
              value={templateId}
              onValueChange={chooseTemplate}
              options={[{ value: '', label: 'No template — write it here' }, ...(templates.data ?? []).map((t) => ({ value: String(t.id), label: t.name, hint: t.is_default ? 'default' : undefined }))]}
              className={input}
            />
          </Field>
          <Field label="Subject">
            <input aria-label="Subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} className={input} />
          </Field>
          <Field label="Message">
            <textarea aria-label="Message" value={message} maxLength={5000} onChange={(e) => setMessage(e.target.value)} className={input + ' !h-[150px] resize-none py-2 leading-relaxed'} />
          </Field>
          <Option checked={attachPdf} onChange={setAttachPdf} title="Attach the invoice PDF" />
          <Option checked={payLink} onChange={setPayLink} disabled={inv.due <= 0} title="Include a “Pay now” link" sub={inv.due <= 0 ? 'Nothing is owed on this invoice.' : 'Card, QR or bank transfer, through the company’s gateways.'} />
          <Option checked={whatsapp} onChange={setWhatsapp} title="Also send by WhatsApp" sub={inv.client_phone ? `To ${inv.client_phone}` : 'To the customer’s WhatsApp number, where WhatsApp is installed.'} />
        </div>
        <aside aria-label="What the customer sees" className="flex min-w-0 flex-col gap-2 rounded-[10px] border border-line bg-subtle p-3">
          <b className="text-[11px] tracking-[.4px] text-ink-3 uppercase">Customer sees</b>
          {preview ? <b className="truncate text-[12.5px] text-ink">{preview.subject}</b> : null}
          {previewError ? (
            <p className="m-0 text-[12px] text-ink-3">The preview could not be drawn: {previewError}</p>
          ) : (
            <iframe title="Email preview" sandbox="" srcDoc={preview?.html ?? ''} className={cx('h-[320px] w-full rounded-[8px] border border-line bg-white', !preview && 'opacity-50')} />
          )}
          <p className="m-0 text-[11.5px] leading-snug text-ink-3">Opening the link marks the invoice as viewed and adds a line to its history.</p>
        </aside>
      </div>
    </Sheet>
  );
}

function Option({ checked, onChange, title, sub, disabled }: { checked: boolean; onChange: (v: boolean) => void; title: string; sub?: string; disabled?: boolean }) {
  return (
    <label className={cx('flex items-start gap-2 text-[12.5px] text-ink', disabled && 'opacity-60')}>
      <Checkbox checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span>
        <b>{title}</b>
        {sub ? <span className="block text-ink-3">{sub}</span> : null}
      </span>
    </label>
  );
}

/** The message a send starts with, before any template: the customer, the number, what is owed and by when. */
export function defaultMessage(inv: Pick<InvoiceDetail, 'client' | 'number' | 'id' | 'due' | 'currency' | 'due_date'>): string {
  const owed = inv.due > 0 ? `${amount(inv.due, inv.currency)} is outstanding${inv.due_date ? ` (due ${dateLabel(inv.due_date)})` : ''}.` : 'It is settled — thank you.';
  return `Dear ${inv.client ?? 'customer'},\n\nPlease find invoice ${inv.number ?? `#${inv.id}`} attached. ${owed}\n\nThank you.`;
}
