import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../core/api';
import { refusal } from './types';
import { talk, type CallCdr } from './wsd';

/**
 * The telephone system's side of one call on the desktop (MKT-CAL-11/14):
 * talk time, how the switch saw it end, and the recording when the contact
 * agreed to it. Read only when asked for.
 */
export function CallRecord({ callId }: { callId: number }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['marketing', 'call-cdr', callId],
    queryFn: ({ signal }) => apiGet<CallCdr>(`/api/marketing/calls/log/${callId}/cdr`, {}, signal),
    enabled: open,
  });

  if (!open) return <button type="button" className="text-[11.5px] font-semibold text-primary hover:underline" onClick={() => setOpen(true)}>Talk time &amp; recording</button>;
  if (q.isLoading) return <span className="text-[11.5px] text-ink-3">Reading the telephone system…</span>;
  if (q.error || !q.data) return <span className="text-[11.5px] text-danger">{refusal(q.error, 'The call record could not be read.')}</span>;

  const c = q.data;

  if (!c.linked) return <span className="text-[11.5px] text-ink-3">{c.voip ? 'No telephone-system record matches this call yet.' : 'There is no telephone system on this installation.'}</span>;

  return (
    <div className="mt-1 flex flex-col gap-1 text-[11.5px] text-ink-2">
      <span>Talk time {talk(c.talk_seconds)} · {c.disposition ?? 'unknown'}</span>
      {c.recording ? <audio controls preload="none" src={c.recording} className="h-8 w-full max-w-xs" aria-label="Call recording" /> : c.recording_note ? <span>{c.recording_note}</span> : null}
    </div>
  );
}
