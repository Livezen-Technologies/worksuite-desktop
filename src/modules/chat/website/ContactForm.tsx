import { useState } from 'react';
import { apiDelete, apiPost } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { Checkbox } from '../../../components/Checkbox';
import { Icon } from '../../../components/Icon';
import { Button, Modal, cx } from '../../../components/ui';
import { WEBSITE, type ContactFormState } from './api';

type Field = ContactFormState['fields'][number];
const FIELDS: Array<[Field, string]> = [['name', 'Name'], ['email', 'Email'], ['phone', 'Phone number'], ['company', 'Company']];
const MESSAGE = 'Could you share your contact details below? We will use them to follow up with you.';

/**
 * Send a contact form, beside Reply to visitor / Internal note: pick what to ask for and the visitor gets a form in
 * their chat. What they fill in updates their profile, and the chat carries on (server Communication 1.58.0).
 */
export function ContactFormButton({ conversationId, waiting, disabled, onDone }: { conversationId: number; waiting: boolean; disabled?: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Field[]>(['name', 'email', 'phone']);
  const [message, setMessage] = useState(MESSAGE);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      await apiPost(`${WEBSITE}/conversations/${conversationId}/contact-form`, { fields, message: message.trim() || undefined });
      toast('success', 'Contact form sent — the visitor fills it in in the chat.');
      setOpen(false);
      onDone();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled || waiting}
        onClick={() => setOpen(true)}
        title={waiting ? 'A contact form is waiting for the visitor' : 'Send the visitor a contact details form'}
        className={cx('ml-auto flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-semibold text-ink-3 hover:bg-subtle hover:text-ink disabled:opacity-50 disabled:hover:bg-transparent')}
      >
        <Icon name="id-card" size={14} /> Contact form
      </button>
      {open ? (
        <Modal title="Send a contact form" labelledBy="website-contact-form" width={400} onClose={() => setOpen(false)} footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!fields.length} onClick={() => void send()}>Send form</Button>
          </>
        }>
          <div className="space-y-3.5">
            <p className="m-0 text-[13px] text-ink-2">The visitor fills it in inside the chat. What they give goes on their profile.</p>
            <fieldset className="m-0 grid grid-cols-2 gap-2 border-0 p-0">
              <legend className="mb-1.5 text-[12px] font-semibold text-ink-2">Ask for</legend>
              {FIELDS.map(([f, label]) => (
                <label key={f} className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
                  <Checkbox checked={fields.includes(f)} onChange={() => setFields((now) => (now.includes(f) ? now.filter((x) => x !== f) : [...now, f]))} />
                  {label}
                </label>
              ))}
            </fieldset>
            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-ink-2">Message above the form</span>
              <textarea value={message} maxLength={1000} rows={3} onChange={(e) => setMessage(e.target.value)}
                className="w-full resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none focus:border-primary" />
            </label>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** While the form waits: "Waiting for the visitor's contact details", with Withdraw. */
export function ContactFormWaiting({ conversationId, form, onDone }: { conversationId: number; form: ContactFormState; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const asked = FIELDS.filter(([f]) => form.fields.includes(f)).map(([, l]) => l.toLowerCase()).join(', ');
  return (
    <div role="status" className="flex items-center gap-2 border-t border-line bg-selection/60 px-3.5 py-2 text-[12px] text-ink-2">
      <Icon name="id-card" size={14} className="shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="font-semibold text-ink">Waiting for the visitor&apos;s contact details</span> ({asked}){form.asked_by ? ` · sent by ${form.asked_by}` : ''}
      </span>
      <button type="button" disabled={busy} className="shrink-0 font-semibold text-primary hover:underline disabled:opacity-50" onClick={() => {
        setBusy(true);
        apiDelete(`${WEBSITE}/conversations/${conversationId}/contact-form`).then(onDone, (e) => toast('error', errorMessage(e))).finally(() => setBusy(false));
      }}>
        Withdraw
      </button>
    </div>
  );
}
