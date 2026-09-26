import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button, Modal } from '../../components/ui';
import { digits } from './api';
import { Select } from '../../components/Select';

interface Account {
  id: number;
  name: string;
  phone: string | null;
  status: string;
  is_default: boolean;
  ready: boolean;
}

/**
 * "Send a WhatsApp message" (the web's WhatsappShare): the number, the
 * account to send from, and the words, all seen before anything goes. Only
 * accounts this person may send from are offered; the server checks again.
 */
export function WhatsappSend({ phone, name, contactId, onClose }: { phone: string; name: string; contactId: number; onClose: () => void }) {
  const targets = useQuery({ queryKey: ['whatsapp', 'targets'], queryFn: ({ signal }) => apiGet<{ accounts: Account[] }>('/api/whatsapp/share/targets', undefined, signal) });
  const accounts = targets.data?.accounts ?? [];
  const [to, setTo] = useState(digits(phone));
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  // The connected one somebody uses, not merely the first: a "setup" account cannot carry a message.
  const fallback = accounts.find((a) => a.is_default && a.ready) ?? accounts.find((a) => a.ready) ?? accounts[0];
  const accountId = picked ?? fallback?.id ?? null;
  const chosen = accounts.find((a) => a.id === accountId);
  const usable = digits(to).length >= 8 && text.trim() !== '' && accountId !== null;

  const send = async () => {
    setSending(true);
    try {
      const r = await apiPost<{ ok: boolean; chat_id: number; problems: string[] }>('/api/whatsapp/share', {
        phone: digits(to),
        name,
        message: text.trim(),
        file_id: null,
        account_id: accountId,
        source: { module: 'contact', id: contactId, label: name },
      });
      if (r.problems?.length) {
        toast('error', `Not sent. ${r.problems.join(' ')}`);
        return;
      }
      onClose();
      toast('success', 'Sent on WhatsApp', r.chat_id ? { label: 'Open the conversation', run: () => void call('app:openInBrowser', { path: `/whatsapp?chat=${r.chat_id}` }) } : undefined);
    } catch (e) {
      toast('error', `Not sent. ${errorMessage(e)}`);
    } finally {
      setSending(false);
    }
  };

  const field = 'h-[34px] w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-medium text-ink outline-none focus:border-primary';
  return (
    <Modal
      title="Send on WhatsApp"
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="send" disabled={!usable || sending || !accounts.length} loading={sending} onClick={() => void send()}>{sending ? 'Sending…' : 'Send'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[12.5px]">
        {targets.isSuccess && !accounts.length ? <p className="rounded-[8px] bg-warning-bg p-2.5 text-[12px] text-warning">You do not have a WhatsApp number you can send from. Ask whoever manages the numbers to share one with you.</p> : null}
        <label className="flex flex-col gap-1 font-semibold text-ink">
          To
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="94771234567" className={`${field} font-mono`} />
          <span className="text-[11px] font-normal text-ink-3">{name} · with the country code, no plus</span>
        </label>
        {accounts.length > 1 ? (
          <label className="flex flex-col gap-1 font-semibold text-ink">
            Send from
            <Select value={accountId ?? ''} onChange={(e) => setPicked(Number(e.target.value))} className={field}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.phone ? ` · +${a.phone}` : ''}
                  {a.ready ? '' : ' (not connected)'}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        {chosen && !chosen.ready ? <p className="rounded-[8px] bg-warning-bg p-2 text-[11.5px] text-warning">{chosen.name} is not connected right now, so this will probably fail.</p> : null}
        <label className="flex flex-col gap-1 font-semibold text-ink">
          Message
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={4000} placeholder="Write the message…" className="w-full resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] font-medium text-ink outline-none focus:border-primary" />
        </label>
      </div>
    </Modal>
  );
}
