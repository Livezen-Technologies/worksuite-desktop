import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button, Spinner } from '../../components/ui';
import { Field, input } from '../../components/FormKit';
import { codeOf, errorData, errorText, K, newKey, pGet, pPost, type GuestHit, type GuestProfile } from './api';
import { Refusal, usePms, VipPill } from './parts';

export interface PickedGuest {
  id: number;
  name: string;
  vip_level: string;
}

const MATCH: Record<string, string> = { email: 'same email', phone: 'same phone', id_number: 'same ID number', name_and_date_of_birth: 'same name and date of birth' };

/**
 * Finding the guest for a booking or a walk-in (§7): one search over the
 * company's guests and the CRM contacts who never stayed, by name, email or
 * phone; a CRM contact gets its hospitality profile when chosen. A new guest
 * is checked for duplicates first (PMS-DUP-001/002, AC-05): "Possible
 * existing guest found", the existing one offered, a new one only on purpose.
 */
export default function GuestPick({ picked, onPick, startAdding = false }: { picked: PickedGuest | null; onPick: (g: PickedGuest | null) => void; startAdding?: boolean }) {
  const pms = usePms();
  const org = pms.property.org_id;
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(startAdding);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', phone: '', nationality: '' });
  const [candidates, setCandidates] = useState<GuestHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => newKey('guest'));
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const hits = useQuery({ queryKey: K.guests(org, q), queryFn: ({ signal }) => pGet<{ items: GuestHit[] }>('/guests', { q, org, limit: 12 }, signal), enabled: q.length >= 2 && pms.may('pms.guest.view') });

  /** A CRM contact without a profile gets one; a guest is taken as they are. */
  const choose = async (h: GuestHit) => {
    setError(null);
    if (h.guest_id) return onPick({ id: h.guest_id, name: h.name, vip_level: h.vip_level });
    setBusy(true);
    try {
      const r = await pPost<{ id: number; guest: GuestProfile }>('/guests', { org_id: org, property_id: pms.property.id, client_id: h.client_id }, newKey('guest'));
      onPick({ id: r.data.id ?? r.data.guest.id, name: r.data.guest.name, vip_level: r.data.guest.vip_level });
    } catch (e) {
      setError(errorText(e, 'The guest could not be chosen.'));
    } finally {
      setBusy(false);
    }
  };

  const create = async (force: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const body = { org_id: org, property_id: pms.property.id, ...Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== '')), ...(force ? { force: true } : {}) };
      if (!force) {
        const check = await pPost<{ candidates: GuestHit[] }>('/guests/check', body);
        if (check.data.candidates.length) {
          setCandidates(check.data.candidates);
          return;
        }
      }
      const r = await pPost<{ id: number; guest: GuestProfile }>('/guests', body, key);
      setKey(newKey('guest'));
      setAdding(false);
      setCandidates(null);
      onPick({ id: r.data.id ?? r.data.guest.id, name: r.data.guest.name, vip_level: r.data.guest.vip_level });
    } catch (e) {
      if (codeOf(e) === 'possible_duplicate') setCandidates(errorData<{ candidates: GuestHit[] }>(e)?.candidates ?? []);
      else setError(errorText(e, 'The guest was not added.'));
    } finally {
      setBusy(false);
    }
  };

  if (picked) {
    return (
      <div className="flex items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2">
        <b className="text-[14px]">{picked.name}</b>
        <VipPill level={picked.vip_level} />
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => onPick(null)}>
          Change guest
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {!adding ? (
        <>
          <input className={input} aria-label="Find the guest" placeholder="Name, email or phone" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          {hits.isLoading && q.length >= 2 ? <Spinner /> : null}
          {(hits.data?.items ?? []).length > 0 ? (
            <ul className="m-0 flex max-h-[240px] list-none flex-col gap-1 overflow-y-auto p-0 scroll-thin" aria-label="Guests found">
              {(hits.data?.items ?? []).map((h) => (
                <li key={h.client_id}>
                  <button type="button" disabled={busy} onClick={() => void choose(h)} className="flex w-full items-center gap-2 rounded-[8px] border border-line px-3 py-1.5 text-left hover:bg-subtle">
                    <b className="text-[13px]">{h.name}</b>
                    <VipPill level={h.vip_level} />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">{[h.email, h.phone].filter(Boolean).join(' · ')}</span>
                    <span className="text-[11px] text-ink-3">{h.guest_id ? 'Guest' : 'CRM contact'}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : q.length >= 2 && !hits.isLoading ? (
            <p className="m-0 text-[12.5px] text-ink-3">Nobody found.</p>
          ) : null}
          {pms.may('pms.guest.edit') ? (
            <Button size="sm" icon="user-plus" className="self-start" onClick={() => setAdding(true)}>
              New guest
            </Button>
          ) : null}
        </>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create(false);
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <Field label="First name *">
              <input aria-label="First name" className={input} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} autoFocus />
            </Field>
            <Field label="Last name *">
              <input aria-label="Last name" className={input} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
            </Field>
            <Field label="Email">
              <input aria-label="Email" className={input} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input aria-label="Phone" className={input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Nationality">
              <input aria-label="Nationality" className={input} value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} />
            </Field>
          </div>
          {candidates ? (
            <div className="flex flex-col gap-1.5 rounded-[10px] border border-warning/40 bg-warning-bg px-3 py-2 text-[12.5px]">
              <b className="text-warning">Possible existing guest found</b>
              {candidates.map((c) => (
                <div key={c.client_id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <b>{c.name}</b> {[c.email, c.phone].filter(Boolean).join(' · ')}
                    <span className="block text-ink-3">{(c.matched_on ?? []).map((m) => MATCH[m] ?? m).join(', ')}</span>
                  </span>
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => void choose(c)}>
                    This guest
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="ghost" className="self-start" disabled={busy} onClick={() => void create(true)}>
                None of them — add a new guest
              </Button>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button variant="primary" loading={busy} disabled={!form.first_name.trim() || !form.last_name.trim() || !pms.online} onClick={() => void create(false)}>
              Add guest
            </Button>
            <Button variant="ghost" onClick={() => {
                setAdding(false);
                setCandidates(null);
              }}>
              Back to search
            </Button>
          </div>
          <button type="submit" hidden />
        </form>
      )}
      {error ? <Refusal text={error} /> : null}
    </div>
  );
}
