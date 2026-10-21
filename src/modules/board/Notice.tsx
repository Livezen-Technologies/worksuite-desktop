import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Button, Spinner } from '../../components/ui';
import { fetchDelivery, fmtDate, fmtTime, K, sendNotice, type Meeting } from './api';
import { Muted, Panel, Status } from './parts';

const CHANNELS: Array<[string, string, string]> = [['email', 'Email', 'Link to pack — no attachments'], ['sms', 'SMS', 'Short alert only'], ['chat', 'WorkSuite Chat', "Committee's secure room"], ['push', 'Push', 'Generic preview until unlocked']];

/** D-11 Send notice (FR-NOT-01..03, FR-NOT-05): only to the people who should get it; delivery per member and channel. */
export default function Notice({ meeting, meetingId }: { meeting: Meeting | null; meetingId: number }) {
  const allowed = meeting?.notice_channels ?? CHANNELS.map((c) => c[0]);
  const [channels, setChannels] = useState<string[]>(allowed.filter((c) => c !== 'sms'));
  const [recipients, setRecipients] = useState<string[]>(['committee']);
  const [subject, setSubject] = useState(meeting ? `${meeting.title} — ${fmtDate(meeting.starts_at)}, ${fmtTime(meeting.starts_at)}` : '');
  const [message, setMessage] = useState('');
  const delivery = useQuery({ queryKey: K.delivery(meetingId), queryFn: ({ signal }) => fetchDelivery(meetingId, signal) });
  const send = useMutation({
    mutationFn: (draft: boolean) => {
      if (!draft && (!subject.trim() || !message.trim() || !channels.length)) throw new Error('A notice needs a subject, a message and a channel.');
      return sendNotice(meetingId, { recipients, channels, subject: subject.trim(), message: message.trim(), draft });
    },
    onSuccess: (_r, draft) => toast('success', draft ? 'Draft saved.' : 'Notice sent.'),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const presenters = (meeting?.participants ?? []).filter((p) => p.kind === 'presenter');
  const toggle = (list: string[], v: string, set: (x: string[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const tone = (s?: string) => (!s ? 'muted' : /opened|read|delivered/i.test(s) ? 'success' : /retry|fail/i.test(s) ? 'warning' : 'muted') as 'success' | 'warning' | 'muted';
  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-3 flex items-start justify-between">
        <div><h1 className="text-[18px] font-bold">Send notice</h1><Muted>Only to the people who should receive it</Muted></div>
        <div className="flex gap-2"><Button size="sm" onClick={() => send.mutate(true)}>Save draft</Button><Button size="sm" variant="primary" loading={send.isPending} onClick={() => send.mutate(false)}>Send</Button></div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_340px] gap-3">
        <Panel title="Notice">
          <div className="text-[12px] font-semibold">Recipients</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Button size="sm" aria-pressed={recipients.includes('committee')} variant={recipients.includes('committee') ? 'primary' : 'secondary'} onClick={() => toggle(recipients, 'committee', setRecipients)}>{meeting?.body?.name ?? 'Members'}</Button>
            <Button size="sm" aria-pressed={recipients.includes('sub-committee')} variant={recipients.includes('sub-committee') ? 'primary' : 'secondary'} onClick={() => toggle(recipients, 'sub-committee', setRecipients)}>+ Sub-committee</Button>
            {presenters.map((p) => <Button key={p.id} size="sm" aria-pressed={recipients.includes(`presenter:${p.id}`)} variant={recipients.includes(`presenter:${p.id}`) ? 'primary' : 'secondary'} onClick={() => toggle(recipients, `presenter:${p.id}`, setRecipients)}>+ {p.name}{p.item_only?.length ? ` (${p.item_only.join(', ')} only)` : ''}</Button>)}
          </div>
          <Muted>Conflicted members get the notice without that item's papers.</Muted>
          <label className="mt-3 block text-[12px] font-semibold">Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1 w-full rounded-[8px] border border-line bg-surface p-2 font-normal" /></label>
          <label className="mt-3 block text-[12px] font-semibold">Message<textarea value={message} onChange={(e) => setMessage(e.target.value)} className="mt-1 h-[220px] w-full rounded-[8px] border border-line bg-surface p-2 font-normal" /></label>
        </Panel>
        <div className="flex min-h-0 flex-col gap-3">
          <Panel title="Channels">
            <Muted>Allowed by your administrator for meeting notices</Muted>
            {CHANNELS.filter(([k]) => allowed.includes(k)).map(([k, label, hint]) => (
              <label key={k} className="mt-2 flex items-start gap-2 rounded-[8px] border border-line p-2 text-[12.5px]">
                <Checkbox checked={channels.includes(k)} onChange={() => toggle(channels, k, setChannels)} />
                <span><b>{label}</b><span className="block text-[11.5px] text-ink-3">{hint}</span></span>
              </label>
            ))}
          </Panel>
          <Panel title="Last notice delivery">
            {delivery.isPending ? <Spinner /> : (
              <table className="w-full text-[12px]">
                <thead><tr className="text-left text-ink-3"><th>Member</th><th>Email</th><th>SMS</th><th>App</th></tr></thead>
                <tbody>{(delivery.data ?? []).map((d) => <tr key={d.member}><td className="py-1">{d.member}</td>{[d.email, d.sms, d.app].map((s, i) => <td key={i}>{s ? <Status tone={tone(s)}>{s}</Status> : '—'}</td>)}</tr>)}</tbody>
              </table>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
