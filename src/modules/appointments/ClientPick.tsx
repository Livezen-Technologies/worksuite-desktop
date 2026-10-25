import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError } from '../../core/api';
import { Button, cx } from '../../components/ui';
import { addClient, K, searchClients, type ClientRow } from './api';
import { input, label, Refused, useDesk } from './parts';

/**
 * The client field of New appointment, Walk-in and the waitlist: CRM's customers by name, phone or email, and a new
 * client added without leaving the form (CRM keeps names unique: a name taken comes back as that client to choose).
 */
export function ClientPick({ value, onChange, autoFocus, phoneFirst }: { value: ClientRow | null; onChange: (c: ClientRow | null) => void; autoFocus?: boolean; phoneFirst?: boolean }) {
  const desk = useDesk();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 200);
    return () => window.clearTimeout(t);
  }, [q]);
  const found = useQuery({ queryKey: K.clients(debounced.toLowerCase()), queryFn: ({ signal }) => searchClients(debounced, signal), enabled: debounced.length >= 2 && !value });

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await addClient({ name: name.trim(), phone: phone.trim() || undefined });
      onChange(r.data.customer);
      setAdding(false);
    } catch (e) {
      const taken = e instanceof ApiError ? (e.data as { customer?: ClientRow } | null)?.customer : undefined;
      setErr(e instanceof Error ? e.message : String(e));
      if (taken) onChange(taken);
    } finally {
      setBusy(false);
    }
  };

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-[10px] border border-primary bg-[#EEF1FD] px-3 py-2 dark:bg-selection">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-bold text-ink">{value.name}</div>
          <div className="truncate text-[12px] text-ink-2">{[value.phone, value.email].filter(Boolean).join(' · ') || 'No phone or email'}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }
  if (adding) {
    return (
      <div className="rounded-[10px] border border-line p-3">
        <div className="grid grid-cols-2 gap-2">
          <label><span className={label}>Name</span><input autoFocus className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={190} /></label>
          <label><span className={label}>Phone</span><input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} /></label>
        </div>
        <div className="mt-2"><Refused>{err}</Refused></div>
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Back</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={!name.trim() || !desk.online} onClick={() => void save()}>Add client</Button>
        </div>
      </div>
    );
  }
  const items = found.data?.items ?? [];
  return (
    <div>
      <input
        autoFocus={autoFocus}
        className={input}
        placeholder={phoneFirst ? 'Phone (finds existing clients)' : 'Name, phone or email'}
        aria-label="Find a client"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
            e.preventDefault();
            setAdding(true);
            setName(/^\+?[\d\s-]+$/.test(q) ? '' : q);
            setPhone(/^\+?[\d\s-]+$/.test(q) ? q : '');
          } else if (e.key === 'Enter' && items[0]) {
            e.preventDefault();
            onChange(items[0]);
          }
        }}
      />
      {debounced.length >= 2 ? (
        <ul className="mt-1 max-h-[180px] overflow-y-auto rounded-[10px] border border-line bg-surface p-1 scroll-thin" role="listbox" aria-label="Clients">
          {items.map((c) => (
            <li key={c.id}>
              <button type="button" role="option" aria-selected={false} onClick={() => onChange(c)} className="flex w-full items-baseline gap-2 rounded-[8px] px-2.5 py-1.5 text-left hover:bg-subtle">
                <b className="text-[13px] text-ink">{c.name}</b>
                <span className="truncate text-[12px] text-ink-3">{[c.phone, c.email].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
          {!items.length && !found.isPending ? <li className="px-2.5 py-1.5 text-[12px] text-ink-3">No match yet. A new client can be added.</li> : null}
          <li>
            <button type="button" disabled={!desk.online} onClick={() => (setAdding(true), setName(/^\+?[\d\s-]+$/.test(q) ? '' : q), setPhone(/^\+?[\d\s-]+$/.test(q) ? q : ''))} className={cx('w-full rounded-[8px] px-2.5 py-1.5 text-left text-[12.5px] font-semibold text-primary hover:bg-subtle disabled:opacity-50')}>
              {`+ New client “${q.trim().slice(0, 30)}” (Ctrl+N)`}
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
