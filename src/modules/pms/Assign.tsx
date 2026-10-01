import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { input } from '../garage/parts';
import { codeOf, errorText, K, pGet, pPost, type Candidate } from './api';
import { Refusal } from './parts';
import { Checkbox } from '../../components/Checkbox';

/**
 * Choosing a room for one room of a reservation (PMS-ASG-001/002): the
 * server's candidates, best first, each with what it does not meet (the
 * guest's accessibility, smoking, floor, readiness). Another type is an
 * upgrade or a downgrade, and says whether the price changes (PMS-ASG-004).
 * The choice goes through the reservation engine with the reservation's
 * version; a room taken meanwhile is refused in the server's words.
 */
export default function AssignRoom({ lineId, version, what, current, onClose, onDone }: { lineId: number; version: number; what: string; current: string | null; onClose: () => void; onDone: () => void }) {
  const [any, setAny] = useState(false);
  const [pick, setPick] = useState<Candidate | null>(null);
  const [upgrade, setUpgrade] = useState<'complimentary' | 'paid'>('complimentary');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const q = useQuery({ queryKey: K.candidates(lineId, any), queryFn: ({ signal }) => pGet<{ items: Candidate[] }>(`/reservation-rooms/${lineId}/rooms`, any ? { any_type: 1 } : undefined, signal) });

  const save = async (roomId: number | null) => {
    setBusy(true);
    setRefusal(null);
    try {
      const body: Record<string, unknown> = { room_id: roomId ?? '', version };
      if (pick?.upgrade && roomId) {
        body.upgrade_type = upgrade;
        if (reason.trim()) body.reason = reason.trim();
      }
      const r = await pPost(`/reservation-rooms/${lineId}`, body);
      toast('success', r.message);
      onDone();
    } catch (e) {
      setRefusal(codeOf(e) === 'version_conflict' ? `${errorText(e)} Close this and open the reservation again.` : errorText(e, 'The room was not assigned.'));
    } finally {
      setBusy(false);
    }
  };

  const items = q.data?.items ?? [];
  return (
    <Modal
      title={`A room for ${what}`}
      onClose={onClose}
      width={620}
      footer={
        <div className="flex w-full items-center gap-2">
          {current ? (
            <Button variant="ghost" disabled={busy} onClick={() => void save(null)}>
              Unassign {current}
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!pick} onClick={() => pick && void save(pick.room_id)}>
            {pick ? `Assign room ${pick.number}` : 'Assign'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <Checkbox checked={any} onChange={(e) => {
              setAny(e.target.checked);
              setPick(null);
            }} /> Show other room types (upgrade or downgrade)
        </label>
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        ) : items.length === 0 ? (
          <p className="text-[13px] text-ink-3">No room is free for every night of this stay{any ? '' : ' in this room type'}.</p>
        ) : (
          <ul className="m-0 flex max-h-[340px] list-none flex-col gap-1 overflow-y-auto p-0 scroll-thin" role="listbox" aria-label="Rooms">
            {items.map((c) => (
              <li key={c.room_id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={pick?.room_id === c.room_id}
                  onClick={() => setPick(c)}
                  className={cx('flex w-full items-start gap-3 rounded-[10px] border px-3 py-2 text-left', pick?.room_id === c.room_id ? 'border-primary bg-selection' : 'border-line hover:bg-subtle')}
                >
                  <b className="w-12 text-[15px] tabular-nums">{c.number}</b>
                  <span className="min-w-0 flex-1 text-[12.5px]">
                    <span className="block text-ink">
                      {c.room_type}
                      {c.floor ? ` · floor ${c.floor}` : ''}
                      {c.upgrade ? <b className="ml-1 text-primary">· another type</b> : null}
                    </span>
                    <span className={cx('block', c.ready ? 'text-success' : 'text-warning')}>{c.ready ? 'Ready now' : `Not ready (${c.hk_status}${c.occupancy === 'occupied' ? ', occupied' : ''})`}</span>
                    {c.warnings.map((w) => (
                      <span key={w} className="block text-ink-3">
                        {w}
                      </span>
                    ))}
                  </span>
                  {!c.fits ? <span className="text-[11px] font-semibold text-warning">Misses a need</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
        {pick?.upgrade ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink-2">
              The price
              <Select
                aria-label="The price"
                value={upgrade}
                onChange={(e) => setUpgrade(e.target.value as 'complimentary' | 'paid')}
                options={[
                  { value: 'complimentary', label: 'Stays as booked (complimentary)' },
                  { value: 'paid', label: 'Charged at the new type (paid)' },
                ]}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink-2">
              Why
              <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Upgrade for a returning guest" />
            </label>
          </div>
        ) : null}
        {refusal ? <Refusal text={refusal} /> : null}
      </div>
    </Modal>
  );
}
