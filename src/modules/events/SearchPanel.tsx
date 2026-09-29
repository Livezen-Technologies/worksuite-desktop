import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { ApiError } from '../../core/api';
import { at, eGet, errorText, type SearchHit } from './api';
import { deskSearch } from './desk';
import { Refusal, useEvent } from './parts';

/**
 * The desk's search (EV-CHK-050): name, registration number, phone, email,
 * company or ticket, from two characters — the server's search online
 * (`GET checkin/search`), the desk's copy offline (name, number, company and
 * ticket: the copy carries no email or phone). Arrows move, Enter picks.
 */
export default function SearchPanel({ onPick }: { onPick: (hit: SearchHit) => void }) {
  const { event, online } = useEvent();
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState('');
  const [sel, setSel] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setTyped(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);

  const r = useQuery({
    queryKey: ['events', 'desk-search', event.id, online, typed],
    queryFn: async ({ signal }): Promise<{ items: SearchHit[]; local: boolean }> => {
      if (online) {
        try {
          return { items: (await eGet<{ items: SearchHit[] }>(`/events/${event.id}/checkin/search`, { q: typed, limit: 20 }, signal)).items, local: false };
        } catch (e) {
          if (!(e instanceof ApiError && e.offline)) throw e;
        }
      }
      return { items: (await deskSearch(event.id, typed, 20)) as SearchHit[], local: true };
    },
    enabled: typed.length >= 2,
    networkMode: 'always',
    retry: false,
  });
  const items = r.data?.items ?? [];

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter' && items[sel]) {
      e.preventDefault();
      onPick(items[sel]);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        autoFocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
        }}
        onKeyDown={onKey}
        placeholder={online ? 'Name, registration number, phone, email, company or ticket' : 'Name, registration number, company or ticket'}
        aria-label="Search attendees"
        className="h-11 rounded-[10px] border border-line bg-surface px-3 text-[16px] text-ink outline-none focus:border-primary"
      />
      {r.data?.local ? <div className="text-[12px] text-ink-3">From this computer’s offline copy of the gate’s tickets.</div> : null}
      {typed.length > 0 && typed.length < 2 ? <div className="text-[12px] text-ink-3">Type two characters or more.</div> : null}
      {r.isFetching && !r.data ? <Spinner /> : null}
      {r.error ? <Refusal text={errorText(r.error)} /> : null}
      {r.data && items.length === 0 ? <div className="py-4 text-center text-[13px] text-ink-3">Nobody found.</div> : null}
      <ul className="m-0 flex max-h-[420px] list-none flex-col gap-1 overflow-y-auto p-0 scroll-thin" role="listbox" aria-label="Attendees found">
        {items.map((h, i) => (
          <li key={h.registration_id} role="option" aria-selected={i === sel}>
            <button
              type="button"
              onClick={() => onPick(h)}
              onMouseEnter={() => setSel(i)}
              className={cx('flex w-full items-center gap-3 rounded-[10px] border px-3 py-2 text-left', i === sel ? 'border-primary bg-selection' : 'border-line bg-surface')}
            >
              <Icon name="user" size={18} className="text-ink-3" />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[14px] text-ink">{h.name || h.number}</b>
                <span className="block truncate text-[12px] text-ink-2">
                  {h.number} · {h.ticket.name}
                  {h.company ? ` · ${h.company}` : ''}
                </span>
              </span>
              <span className="text-right text-[12px] text-ink-2">
                <span className="block font-semibold">{h.status_label}</span>
                <span className="block text-ink-3">
                  {h.presence.state === 'INSIDE' ? 'Inside' : h.presence.state === 'OUTSIDE' ? 'Checked out' : 'Not arrived'}
                  {h.presence.last_in ? ` · ${at(h.presence.last_in)}` : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
