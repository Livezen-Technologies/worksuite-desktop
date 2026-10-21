import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { call } from '../../core/bridge';
import { Button, IconButton, Spinner } from '../../components/ui';
import { dayKey, fetchMeetings, fmtDate, fmtTime, K, type Body } from './api';
import { BodyTabs, FlagChip, MonthCal, Panel } from './parts';

/** D-03 Calendar: two months, filtered by board or committee, and the month's meetings (FR-DX-05). */
export default function Calendar({ bodies, onMeeting }: { bodies: Body[]; onMeeting: (id: number) => void }) {
  const now = new Date();
  const [start, setStart] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [body, setBody] = useState<number | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const second = start.m === 11 ? { y: start.y + 1, m: 0 } : { y: start.y, m: start.m + 1 };
  const from = new Date(Date.UTC(start.y, start.m, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(second.y, second.m + 1, 0)).toISOString().slice(0, 10);
  const q = useQuery({ queryKey: K.meetings(`${from}:${to}`), queryFn: ({ signal }) => fetchMeetings({ from, to }, signal) });
  const list = (q.data ?? []).filter((m) => !body || m.body?.id === body);
  const marked = new Set(list.map((m) => dayKey(m.starts_at)));
  const today = dayKey(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString());
  const monthList = list.filter((m) => (day ? dayKey(m.starts_at) === day : new Date(m.starts_at).getMonth() === start.m)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const shift = (d: number) => setStart((s) => { const t = new Date(s.y, s.m + d, 1); return { y: t.getFullYear(), m: t.getMonth() }; });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="flex h-full flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h1 className="text-[18px] font-bold">Calendar</h1>
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => { setStart({ y: now.getFullYear(), m: now.getMonth() }); setDay(null); }}>Today</Button>
          <IconButton icon="chevron-left" label="Previous month" onClick={() => shift(-1)} />
          <IconButton icon="chevron-right" label="Next month" onClick={() => shift(1)} />
          <Button size="sm" onClick={() => void call('app:openInBrowser', { path: '/calendar?subscribe=board' })}>Subscribe in Calendar</Button>
        </div>
      </div>
      <BodyTabs bodies={bodies} value={body} onChange={setBody} />
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_1fr_300px] gap-3">
        <Panel title=" "><MonthCal year={start.y} month={start.m} marked={marked} today={today} selected={day} onPick={setDay} /></Panel>
        <Panel title=" "><MonthCal year={second.y} month={second.m} marked={marked} today={today} selected={day} onPick={setDay} /></Panel>
        <Panel title={day ? fmtDate(day) : new Date(start.y, start.m, 1).toLocaleDateString(undefined, { month: 'long' })} action={<span className="text-[11.5px] font-normal text-ink-3">{monthList.length} meetings</span>}>
          {q.isPending ? <Spinner /> : (
            <ul className="space-y-2">
              {monthList.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => onMeeting(m.id)} className="w-full rounded-[8px] border border-line p-2.5 text-left hover:border-primary">
                    <div className="flex justify-between text-[10.5px] font-bold text-ink-3 uppercase"><span>{m.body?.name}</span><FlagChip flag={m.flag} /></div>
                    <div className="text-[13px] font-bold">{m.title}</div>
                    <div className="mt-1 flex justify-between text-[12px] text-ink-2"><span>{m.status}</span><span>{fmtTime(m.starts_at)} · {fmtDate(m.starts_at)}</span></div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11.5px] text-ink-3">Times in {zone}. Also in your WorkSuite Calendar.</p>
        </Panel>
      </div>
    </div>
  );
}
