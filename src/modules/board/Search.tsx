import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { call } from '../../core/bridge';
import { Spinner, cx } from '../../components/ui';
import { fetchSearch, K, type SearchResult } from './api';
import { FlagChip, Muted } from './parts';

const TYPES: Array<[SearchResult['type'], string]> = [['agenda', 'Agenda items'], ['paper', 'Papers'], ['minutes', 'Minutes'], ['resolution', 'Resolutions'], ['comment', 'Comments'], ['note', 'My notes'], ['circular', 'Circulars']];
const LABEL: Record<string, string> = { agenda: 'Agenda item', paper: 'Paper', minutes: 'Minutes', resolution: 'Resolution', comment: 'Comment', note: 'My note', circular: 'Circular' };

/** Marks each word of the query in the text. */
export function highlight(text: string, q: string): ReactNode[] {
  const words = q.trim().split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return [text];
  const re = new RegExp(`(${words.join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="bg-[#FDE68A] text-ink">{part}</mark> : part));
}

/** Server search, or the offline vault's when the server cannot be reached (FR-OFF-01). */
async function runSearch(q: string, offline: boolean, signal?: AbortSignal): Promise<{ hits: SearchResult[]; offline: boolean }> {
  const local = async () => ({ hits: (await call('board:search', { q })).map((h) => ({ type: h.type, title: h.title, snippet: h.snippet, page: h.page, meeting_id: h.meetingId })), offline: true });
  if (offline) return local();
  try {
    return { hits: await fetchSearch(q, signal), offline: false };
  } catch {
    return local();
  }
}

/** D-07 Search: type filters with counts, highlighted matches with pages, works offline in downloaded packs. */
export default function Search({ offline, onOpen }: { offline: boolean; onOpen: (meetingId: number) => void }) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState<SearchResult['type'] | null>(null);
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const res = useQuery({ queryKey: [...K.search(q), offline], queryFn: ({ signal }) => runSearch(q, offline, signal), enabled: q.length >= 2 });
  const hits = res.data?.hits ?? [];
  const shown = type ? hits.filter((h) => h.type === type) : hits;
  const chip = (t: SearchResult['type'] | null, label: string, n: number) => (
    <button key={t ?? 'all'} type="button" aria-pressed={type === t} onClick={() => setType(t)} className={cx('h-[26px] rounded-full px-3 text-[12px]', type === t ? 'bg-ink text-white' : 'border border-line bg-surface')}>{label} · {n}</button>
  );
  return (
    <div className="flex h-full flex-col gap-3 p-5">
      <label className="flex items-center gap-2 rounded-[10px] border border-primary bg-surface px-3 py-2">
        <span className="sr-only">Search Board</span>
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Search meetings, papers, minutes, resolutions…" className="flex-1 bg-transparent text-[14px] outline-none" />
        <span className="text-[11.5px] text-ink-3">Works offline in downloaded packs</span>
      </label>
      {q.length >= 2 ? (
        <div className="flex flex-wrap gap-1.5">
          {chip(null, 'All', hits.length)}
          {TYPES.map(([t, l]) => chip(t, l, hits.filter((h) => h.type === t).length))}
        </div>
      ) : null}
      {res.isFetching ? <Spinner /> : null}
      {res.data?.offline ? <Muted>Offline: results from the packs kept on this computer.</Muted> : null}
      <ul aria-label="Results" className="divide-y divide-line rounded-[10px] border border-line bg-surface">
        {shown.map((h, i) => (
          <li key={i}>
            <button type="button" disabled={!h.meeting_id} onClick={() => h.meeting_id && onOpen(h.meeting_id)} className="w-full p-3 text-left hover:bg-subtle">
              <div className="flex items-center gap-2 text-[13px]">
                <span className="rounded bg-subtle px-1.5 text-[11px]">{LABEL[h.type]}</span>
                <b>{highlight(h.title, q)}</b>
                {h.page ? <span className="text-[11.5px] text-ink-3">· p {h.page}</span> : null}
                {h.meta ? <span className="text-[11.5px] text-ink-3">· {h.meta}</span> : null}
                <FlagChip flag={h.flag} />
              </div>
              {h.snippet ? <p className="mt-0.5 text-[12.5px] text-ink-2">{highlight(h.snippet, q)}</p> : null}
            </button>
          </li>
        ))}
      </ul>
      {q.length >= 2 && !res.isFetching ? <Muted>Results only include items you can open.</Muted> : null}
    </div>
  );
}
