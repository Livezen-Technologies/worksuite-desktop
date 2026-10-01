import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { apiUrl } from '../../core/api';
import { toast } from '../../core/toasts';
import { Ask, ChooseFiles, input, Section } from '../garage/parts';
import { PageHead } from '../hr/parts';
import { day, errorText, K, newKey, pGet, pGetMeta, pPost, pUpload, stamp, type LostItem, type Rack } from './api';
import { ActionButtons, useActions } from './ops';
import { Facts, NoAccess, Refusal, usePms, VipPill } from './parts';
import { Checkbox } from '../../components/Checkbox';

/** What each move of a found item needs said (the server's `LostFoundMachine`; a claim is guarded by a claimant). */
const MORE: Record<string, Array<{ name: string; label: string; required?: boolean; hint?: string }>> = {
  claim: [{ name: 'claimant', label: 'Claimed by', required: true, hint: 'The guest or person who says it is theirs.' }],
};

/**
 * Lost and found (§11.6): items logged where they were found — a room links
 * them to the guest in it or the last to leave it — listed open first, with
 * those kept past the property's days due for disposal; stored, claimed,
 * returned or disposed of by a supervisor (`pms.housekeeping.manage`), each
 * move asking what it needs. Anyone in housekeeping logs an item and adds
 * its photo. Online only.
 */
export default function LostFound({ open }: { open: number | null }) {
  const pms = usePms();
  const pid = pms.property.id;
  const reads = pms.mayAny('pms.housekeeping.view', 'pms.housekeeping.manage');
  const supervisor = pms.may('pms.housekeeping.manage');
  const [f, setF] = useState({ open: '1', due: '', q: '' });
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => newKey('lost'));
  useEffect(() => {
    const t = setTimeout(() => setF((x) => ({ ...x, q: text.trim() })), 250);
    return () => clearTimeout(t);
  }, [text]);
  const list = useQuery({
    queryKey: K.lostFound(pid, f),
    queryFn: ({ signal }) => pGet<{ items: LostItem[]; keep_days: number }>(`/properties/${pid}/lost-found`, Object.fromEntries(Object.entries(f).filter(([, v]) => v)), signal),
    enabled: reads && pms.online,
  });
  const one = useQuery({ queryKey: K.lostItem(open ?? 0), queryFn: ({ signal }) => pGet<{ item: LostItem; history: Array<{ text: string; by: string | null; at: string }> }>(`/lost-found/${open}`, undefined, signal), enabled: reads && !!open && pms.online });
  const readsRack = pms.mayAny('pms.room.view', 'pms.reservation.view', 'pms.checkin', 'pms.room.manage');
  const rack = useQuery({ queryKey: K.rack(pid), queryFn: ({ signal }) => pGetMeta<Rack>(`/properties/${pid}/rack`, undefined, signal), enabled: adding && readsRack });
  const acts = useActions([['pms', 'lost-found'], ['pms', 'lost-item']]);

  if (!reads) return <NoAccess what="Lost and found is housekeeping’s." />;

  const record = async (v: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await pPost<{ id: number }>(
        `/properties/${pid}/lost-found`,
        { item: v.item, ...(v.room_id ? { room_id: Number(v.room_id) } : {}), ...(v.location ? { location: v.location } : {}), ...(v.description ? { description: v.description } : {}), ...(v.storage_place ? { storage_place: v.storage_place } : {}) },
        key,
      );
      setKey(newKey('lost'));
      toast('success', r.message);
      setAdding(false);
      void list.refetch();
      if (r.data?.id) pms.open({ kind: 'lost', id: r.data.id });
    } catch (e) {
      setError(errorText(e, 'The item was not recorded.'));
      setAdding(false);
    } finally {
      setBusy(false);
    }
  };
  const photo = async (item: LostItem, files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return setError(`${file.name} is larger than 10 MB.`);
    setBusy(true);
    setError(null);
    try {
      toast('success', (await pUpload(`/lost-found/${item.id}/photo`, file, file.name, {})).message);
      void one.refetch();
    } catch (e) {
      setError(errorText(e, 'The photo was not kept.'));
    } finally {
      setBusy(false);
    }
  };

  const x = one.data?.item;
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Lost & found" sub={list.data ? `Unclaimed items are kept ${list.data.keep_days} days.` : pms.property.name}>
        {open ? (
          <Button variant="ghost" icon="back" onClick={() => pms.go('lostfound')}>
            Every item
          </Button>
        ) : null}
        <Button variant="primary" icon="plus" disabled={!pms.online} onClick={() => setAdding(true)}>
          Record an item
        </Button>
      </PageHead>
      {error || acts.error ? <Refusal text={(error ?? acts.error)!} /> : null}
      {open ? (
        <Section title={x ? `${x.item} · ${x.status_label}` : 'This item'} action={x ? <ActionButtons options={x.options} busy={acts.busy} online={pms.online} onPick={(o) => acts.run(`/lost-found/${x.id}`, o, x.version, {}, MORE[o.action] ?? [])} /> : null}>
          {!pms.online ? (
            <p className="m-0 text-[13px] text-ink-3">Shown when WorkSuite is back.</p>
          ) : one.isLoading ? (
            <Spinner />
          ) : one.error || !x ? (
            <ErrorNote error={one.error ?? new Error('The item could not be loaded.')} />
          ) : (
            <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div>
                <Facts
                  rows={[
                    ['Found', `${x.room_number ? `Room ${x.room_number}` : (x.location ?? '—')} · ${stamp(x.found_at)}${x.found_by ? ` · ${x.found_by}` : ''}`],
                    ['Description', x.description ?? '—'],
                    ['Guest', x.guest ? <span key="g">{x.guest.name} <VipPill level={x.guest.vip_level} /></span> : '—'],
                    ['Stored at', x.storage_place ?? '—'],
                    ['Claimed by', x.claimant ?? '—'],
                    ['Returned to', x.returned_to ? `${x.returned_to} · ${stamp(x.returned_at)}` : '—'],
                    ['Disposed', x.disposed_at ? `${stamp(x.disposed_at)} — ${x.disposal_reason ?? ''}` : '—'],
                    ['Kept until', day(x.keep_until)],
                  ]}
                />
                <ul className="mt-3 mb-0 flex list-none flex-col gap-1 border-t border-line p-0 pt-2 text-[12.5px] text-ink-2">
                  {one.data!.history.map((h, k) => (
                    <li key={k}>
                      {stamp(h.at)} · {h.text}
                      {h.by ? ` · ${h.by}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col items-start gap-2">
                {x.photo ? <img src={apiUrl(x.photo.url)} alt={x.item} className="max-h-48 rounded-[8px] border border-line object-contain" /> : <p className="m-0 text-[13px] text-ink-3">No photo.</p>}
                <ChooseFiles multiple={false} accept="image/jpeg,image/png,image/webp,image/heic" disabled={!pms.online || busy} label={x.photo ? 'Replace photo…' : 'Add a photo…'} onFiles={(fs) => void photo(x, fs)} />
              </div>
            </div>
          )}
        </Section>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Search items" placeholder="Item or description" value={text} onChange={(e) => setText(e.target.value)} className={`${input} w-56`} />
        <label className="flex items-center gap-1.5 text-[12.5px]">
          <Checkbox checked={f.open === '1'} onChange={(e) => setF({ ...f, open: e.target.checked ? '1' : '' })} /> Open only
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px]">
          <Checkbox checked={f.due === '1'} onChange={(e) => setF({ ...f, due: e.target.checked ? '1' : '' })} /> Due for disposal
        </label>
      </div>
      {!pms.online ? (
        <p className="text-[13px] text-ink-3">Lost and found shows when WorkSuite is back.</p>
      ) : list.isLoading ? (
        <Spinner />
      ) : list.error ? (
        <ErrorNote error={list.error} onRetry={() => void list.refetch()} />
      ) : (list.data?.items ?? []).length === 0 ? (
        <p className="text-[13px] text-ink-3">Nothing recorded.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {list.data!.items.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => pms.open({ kind: 'lost', id: i.id })} className={cx('flex w-full flex-wrap items-center gap-2 rounded-[10px] border bg-surface px-3 py-2 text-left text-[13px] hover:bg-subtle', open === i.id ? 'border-primary' : 'border-line')}>
                <b className="min-w-0 flex-1">
                  {i.item}
                  {i.due_for_disposal ? <span className="ml-1.5 text-[11.5px] font-semibold text-warning">due for disposal</span> : null}
                </b>
                <span className="text-[12px] text-ink-2">{i.room_number ? `Room ${i.room_number}` : (i.location ?? '—')}</span>
                <span className="text-[12px] text-ink-2">{i.guest?.name ?? ''}</span>
                <span className="text-[12px] font-semibold">{i.status_label}</span>
                <span className="text-[12px] text-ink-3">{day(i.found_at ?? i.keep_until)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {acts.dialog}
      {adding ? (
        <Ask
          title="Record a found item"
          text="Found in a room, it is linked to the guest in it or the last to leave it."
          fields={[
            { name: 'item', label: 'Item', required: true },
            ...(readsRack ? [{ name: 'room_id', label: 'Room', type: 'select' as const, options: [{ value: '', label: 'Not in a room' }, ...(rack.data?.data.rooms ?? []).map((r) => ({ value: String(r.id), label: r.number }))] }] : []),
            { name: 'location', label: 'Or where', hint: 'The lobby, the pool, the restaurant.' },
            { name: 'description', label: 'Description', type: 'textarea' },
            ...(supervisor ? [{ name: 'storage_place', label: 'Stored at' }] : []),
          ]}
          confirm="Record"
          busy={busy}
          onClose={() => setAdding(false)}
          onSubmit={(v) => void record(v)}
        />
      ) : null}
    </div>
  );
}
