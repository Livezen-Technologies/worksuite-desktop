import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Avatar, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { addClient, answered, attemptKey, fetchClient, fetchClients, K, refusal, worstAllergy, type ClientCandidate, type Reliability, type Severity } from './api';
import { localId, useCopyClient, useCopyClients } from './offline';
import { AllergyChip, Failed, ReliabilityTag, TierTag, TouchButton, useDesk, type WalkInSeed } from './parts';

/**
 * Who a walk-in or a booking is for (CTR-01, CTR-02): found by any part of
 * their name, mobile or email, or added here. With WorkSuite out of reach the
 * search runs over the day's copy, and a new client is kept with the visit —
 * WorkSuite checks then whether it already knows them.
 */
export interface Chosen {
  id: number;
  /** A client added here while WorkSuite is out of reach, until it knows them. */
  local?: string;
  mobile?: string;
  name: string;
  phone: string | null;
  tier?: string | null;
  reliability?: Reliability | string | null;
  visits?: number | null;
  /** "new client · created just now" */
  note?: string | null;
  allergy: { severity: Severity; substance: string } | null;
}

/** The client a screen was opened for (Book again, the next visit), read from their card or the copy. */
export function useSeededClient(seed: WalkInSeed) {
  const desk = useDesk();
  const [chosen, setChosen] = useState<Chosen | null>(() =>
    seed.local ? { id: 0, local: seed.local.id, name: seed.local.name, mobile: seed.local.mobile, phone: seed.local.mobile ?? null, note: 'new client', allergy: null } : seed.client_id ? { id: seed.client_id, name: '', phone: null, allergy: null } : null,
  );
  const offline = desk.offline;
  const seeded = !!chosen && chosen.name === '';
  const card = useQuery({ queryKey: K.client(chosen?.id ?? 0), queryFn: ({ signal }) => fetchClient(chosen!.id, signal), enabled: seeded && !offline });
  const copied = useCopyClient(chosen?.id ?? null, seeded && offline);
  const client: Chosen | null =
    seeded && card.data
      ? {
          id: card.data.client.id,
          name: card.data.client.name,
          phone: card.data.client.phone ?? card.data.client.mobile,
          tier: card.data.profile.tier,
          reliability: card.data.profile.reliability,
          visits: card.data.profile.visits,
          allergy: worstAllergy(card.data.allergies),
        }
      : seeded && offline && copied.data
        ? { id: copied.data.id, name: copied.data.name, phone: copied.data.phone, tier: copied.data.tier ?? null, reliability: copied.data.reliability ?? null, allergy: (copied.data.allergy ?? null) as Chosen['allergy'] }
        : seeded
          ? null
          : chosen;
  const loading = seeded && (offline ? copied.isLoading : !card.isError);
  return { client, setClient: setChosen, loading };
}

/** The chosen client, in a box with Change (D04, D16). */
export function ClientBox({ client, onChange, framed = false }: { client: Chosen; onChange: () => void; framed?: boolean }) {
  const sub = [client.phone, client.visits ? `${client.visits} visit${client.visits === 1 ? '' : 's'}` : null, client.note].filter(Boolean).join(' · ');
  return (
    <div className={cx('flex items-center gap-3', framed && 'rounded-[14px] border-2 border-primary bg-selection px-3.5 py-3')}>
      <Avatar name={client.name} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[17px] font-bold text-ink">{client.name}</span>
          <TierTag tier={client.tier} />
          {client.reliability && client.reliability !== 'reliable' ? <ReliabilityTag reliability={client.reliability} /> : null}
          {client.allergy ? <AllergyChip allergy={client.allergy} /> : null}
        </div>
        {sub ? <div className="truncate text-[12.5px] text-ink-2">{sub}</div> : null}
      </div>
      <TouchButton className="min-h-10 px-3.5 text-[14px]" onClick={onChange}>
        Change
      </TouchButton>
    </div>
  );
}

/** Find the client, or add them (CTR-01, CTR-02): name, mobile or email, on partial input. */
export function FindClient({ onChosen }: { onChosen: (c: Chosen) => void }) {
  const desk = useDesk();
  const [term, setTerm] = useState('');
  const [adding, setAdding] = useState(false);
  const t = term.trim();
  const offline = desk.offline;
  const live = useQuery({ queryKey: K.clients(desk.org, t), queryFn: ({ signal }) => fetchClients(desk.org, t, 8, signal), enabled: t.length >= 2 && !offline });
  const copied = useCopyClients(t, 8, t.length >= 2 && offline);
  const q = offline
    ? { data: copied.data ? { items: copied.data.map((c) => ({ ...c, tier: c.tier ?? null, visits: null, allergy: (c.allergy ?? null) as Chosen['allergy'] })) } : undefined, isError: copied.isError, isLoading: copied.isLoading, refetch: copied.refetch }
    : live;

  if (adding) return <NewClient initial={t} onBack={() => setAdding(false)} onChosen={onChosen} />;

  const rows = q.data?.items ?? [];
  return (
    <div className="flex flex-col gap-2.5">
      <label className="flex min-h-12 items-center gap-2.5 rounded-[12px] border border-slate-line bg-surface px-3.5 focus-within:border-2 focus-within:border-primary dark:border-line">
        <Icon name="search" size={18} className="text-ink-3" />
        <input aria-label="Client" placeholder="Client — name, mobile or email" value={term} onChange={(e) => setTerm(e.target.value)} className="bare-focus min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3" />
      </label>
      {t.length >= 2 ? (
        q.isError ? (
          <Failed text="Clients could not be searched." onRetry={() => void q.refetch()} />
        ) : q.isLoading ? (
          <Spinner label="Searching clients…" />
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-ink-2">Nobody matches “{t}”.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onChosen({ id: c.id, name: c.name, phone: c.phone, tier: c.tier, reliability: c.reliability, visits: c.visits, allergy: c.allergy })}
                  className="flex w-full items-center gap-3 rounded-[12px] border border-line bg-surface px-3 py-2 text-left hover:bg-subtle"
                >
                  <Avatar name={c.name} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14.5px] font-bold text-ink">{c.name}</div>
                    {c.phone ? <div className="truncate text-[12.5px] text-ink-2">{c.phone}</div> : null}
                  </div>
                  {c.allergy ? <AllergyChip allergy={c.allergy} /> : null}
                  <TierTag tier={c.tier} />
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      <TouchButton icon="plus" disabled={!desk.may('salon.client.edit')} onClick={() => setAdding(true)}>
        New client
      </TouchButton>
    </div>
  );
}

/** A new client, as they give their name and mobile. WorkSuite asks whether it already knows them. */
export function NewClient({ initial = '', onBack, onChosen }: { initial?: string; onBack: () => void; onChosen: (c: Chosen) => void }) {
  const desk = useDesk();
  const offline = desk.offline;
  const digits = /\d/.test(initial);
  const [name, setName] = useState(digits ? '' : initial);
  const [mobile, setMobile] = useState(digits ? initial : '');
  const [candidates, setCandidates] = useState<ClientCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(attemptKey);

  async function add(confirmNew = false) {
    const n = name.trim();
    if (!n) return;
    if (offline) {
      /* Kept with the visit; WorkSuite checks for somebody with these details when it answers. */
      onChosen({ id: 0, local: localId('C'), name: n, phone: mobile.trim() || null, mobile: mobile.trim() || undefined, note: 'new client', allergy: null });
      return;
    }
    setBusy(true);
    try {
      const r = await addClient(desk.org, { name: n, mobile: mobile.trim() || undefined, ...(confirmNew ? { confirm_new: true } : {}) }, key);
      toast('success', r.message || 'Client added.');
      onChosen({ id: r.data.client.id, name: r.data.client.name, phone: r.data.client.phone, note: 'new client · created just now', allergy: null });
    } catch (e) {
      if (answered(e)) setKey(attemptKey());
      const d = refusal(e);
      if (d.candidates?.length) setCandidates(d.candidates);
      else toast('error', e instanceof Error ? e.message : 'The client could not be added.');
    } finally {
      setBusy(false);
    }
  }

  const field = 'h-12 rounded-[12px] border border-line bg-surface px-3.5 text-[15px] text-ink outline-none focus:border-primary';
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[17px] font-bold text-ink">New client</h2>
      <label className="flex flex-col gap-1">
        <span className="text-[12.5px] font-semibold text-ink-2">Name</span>
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[12.5px] font-semibold text-ink-2">Mobile</span>
        <input className={field} inputMode="tel" placeholder="077 123 4567 — or leave it empty" value={mobile} onChange={(e) => setMobile(e.target.value)} />
      </label>
      {offline ? <p className="text-[12.5px] text-ink-2">WorkSuite cannot be reached: the client is added with the visit when it answers, and if it already knows somebody with these details it asks which.</p> : null}
      {candidates ? (
        <div className="flex flex-col gap-2 rounded-[12px] border border-[var(--ws-note-line)] bg-warning-bg p-3">
          <p className="text-[13px] font-semibold text-warning-ink">WorkSuite already knows somebody with these details. Is it one of them?</p>
          {candidates.map((c) => (
            <button key={c.id} type="button" onClick={() => onChosen({ id: c.id, name: c.name, phone: c.phone, allergy: null })} className="flex items-center gap-3 rounded-[10px] border border-line bg-surface px-3 py-2 text-left hover:bg-subtle">
              <Avatar name={c.name} size={28} />
              <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-ink">{c.name}</span>
              <span className="truncate text-[12.5px] text-ink-2">{c.phone ?? c.email ?? ''}</span>
            </button>
          ))}
          <TouchButton className="min-h-10 text-[13px]" loading={busy} onClick={() => void add(true)}>
            No — add a new client anyway
          </TouchButton>
        </div>
      ) : null}
      <div className="flex gap-2.5">
        <TouchButton
          onClick={() => {
            onBack();
            setCandidates(null);
          }}
        >
          Back
        </TouchButton>
        <TouchButton variant="primary" icon="user-plus" className="flex-1" loading={busy} disabled={name.trim() === '' || !desk.may('salon.client.edit')} onClick={() => void add()}>
          Add client
        </TouchButton>
      </div>
    </div>
  );
}
