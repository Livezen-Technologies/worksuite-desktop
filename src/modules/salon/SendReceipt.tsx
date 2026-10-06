import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '../../core/toasts';
import { answered, attemptKey, fetchClient, K, refusal, sendReceipt, type ReceiptChannel, type Visit } from './api';
import { DeskDialog, Label, Note, Segmented, TouchButton, useDesk } from './parts';

/**
 * The receipt to the client after payment (D07): by WhatsApp, as text from
 * the salon's shared number, or by email, as the receipt itself. To the
 * mobile or address on file, which the desk may change for this one. A
 * client who asked for no messages is sent it only when they ask for it now.
 */
export function SendReceipt({ visit, channel: first, onClose, onSent }: { visit: Visit; channel: ReceiptChannel; onClose: () => void; onSent: (said: string) => void }) {
  const desk = useDesk();
  const card = useQuery({ queryKey: K.client(visit.client.id), queryFn: ({ signal }) => fetchClient(visit.client.id, signal) });
  const [channel, setChannel] = useState<ReceiptChannel>(first);
  const [typed, setTyped] = useState<Partial<Record<ReceiptChannel, string>>>({});
  const [asked, setAsked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(attemptKey);
  const onFile = channel === 'email' ? (card.data?.client.email ?? '') : (card.data?.client.mobile ?? card.data?.client.phone ?? visit.client.phone ?? '');
  const to = typed[channel] ?? onFile;

  async function send(anyway: boolean) {
    setBusy(true);
    try {
      const r = await sendReceipt(visit.id, { channel, to: to.trim() || undefined, anyway: anyway || undefined, desk: desk.desk.id }, key);
      setKey(attemptKey());
      toast('success', r.message ?? 'Receipt sent.');
      onSent(r.message ?? `Receipt sent by ${channel === 'email' ? 'email' : 'WhatsApp'} to ${r.data.to}.`);
      onClose();
    } catch (e) {
      if (answered(e)) setKey(attemptKey());
      const d = refusal<{ code?: string }>(e);
      if (d.code === 'no_messages') setAsked(e instanceof Error ? e.message : 'This client asked not to get messages.');
      else toast('error', e instanceof Error ? e.message : 'The receipt was not sent.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <DeskDialog
      tone="indigo"
      icon={channel === 'email' ? 'mail' : 'message-circle'}
      title="Send the receipt"
      sub={`${visit.client.name} · ${visit.number}`}
      labelledBy="salon-send-receipt"
      width={560}
      onClose={onClose}
      footer={
        <>
          <TouchButton onClick={onClose}>Cancel</TouchButton>
          {asked ? (
            <TouchButton variant="primary" loading={busy} disabled={to.trim() === ''} onClick={() => void send(true)}>
              They asked for it — send
            </TouchButton>
          ) : (
            <TouchButton variant="primary" icon="send" loading={busy} disabled={to.trim() === ''} onClick={() => void send(false)}>
              Send by {channel === 'email' ? 'email' : 'WhatsApp'}
            </TouchButton>
          )}
        </>
      }
    >
      <Segmented
        label="Send by"
        value={channel}
        onChange={(c) => {
          setChannel(c);
          setAsked(null);
        }}
        options={[
          { value: 'whatsapp', label: 'WhatsApp' },
          { value: 'email', label: 'Email' },
        ]}
      />
      <label className="flex flex-col gap-1">
        <Label>{channel === 'email' ? 'Email address' : 'Mobile'}</Label>
        <input
          aria-label={channel === 'email' ? 'Email address' : 'Mobile'}
          type={channel === 'email' ? 'email' : 'tel'}
          value={to}
          maxLength={190}
          placeholder={channel === 'email' ? 'amaya@example.com' : '077 123 4567'}
          onChange={(e) => setTyped({ ...typed, [channel]: e.target.value })}
          className="h-12 rounded-[12px] border border-line bg-surface px-3.5 text-[16px] text-ink outline-none focus:border-primary"
        />
        <span className="text-[12.5px] text-ink-2">
          {to.trim() !== '' && to === onFile ? 'The one on file.' : onFile ? 'Only this receipt goes here; the client’s record is not changed.' : 'None on file — type the one the client gives.'}
        </span>
      </label>
      {asked ? <Note tone="warning">{asked}</Note> : null}
    </DeskDialog>
  );
}
