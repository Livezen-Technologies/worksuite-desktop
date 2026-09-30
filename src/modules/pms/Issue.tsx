import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Modal, Spinner } from '../../components/ui';
import { apiUrl } from '../../core/api';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Ask, ChooseFiles, input, Section } from '../garage/parts';
import { PageHead } from '../hr/parts';
import type { Pickable } from '../inventory/control';
import { ProductPick } from '../inventory/pickers';
import { day, errorText, K, MAX_PHOTO, newKey, pGet, pPost, pUpload, stamp, type Issue } from './api';
import { MAINT_READ, MAINT_REPORT } from './Maintenance';
import { ActionButtons, PersonPick, useActions } from './ops';
import { useHasInventory } from './Restock';
import { Facts, NoAccess, Refusal, usePms } from './parts';


/**
 * A maintenance issue (§11.3, `/pms/maintenance/<id>`): its lifecycle as the
 * server allows it — assign (to a technician, or "Take it"), start, hold,
 * resume, resolve with what was done (and a photo when the property asks),
 * reopen, close, cancel — the room taken out of order or out of service and
 * put back, the parts used (an Inventory product or a name), photos, and its
 * history. Everything after reporting is `pms.maintenance.manage`'s; the
 * room's outage also `pms.room.manage`'s. Online only.
 */
export default function IssueScreen({ id }: { id: number }) {
  const pms = usePms();
  const qc = useQueryClient();
  const reads = pms.mayAny(...MAINT_READ);
  const fixes = pms.may('pms.maintenance.manage');
  const outs = pms.mayAny('pms.maintenance.manage', 'pms.room.manage');
  const me = useStore(app, (s) => Number(s.bootstrap?.user.id ?? 0));
  const q = useQuery({ queryKey: K.issue(id), queryFn: ({ signal }) => pGet<{ issue: Issue; history: Array<{ text: string; by: string | null; at: string }>; outage_kinds?: Record<string, string> }>(`/maintenance-issues/${id}`, undefined, signal), enabled: reads && pms.online });
  const acts = useActions([K.issue(id), ['pms', 'live', 'maintenance'], K.live]);
  const [to, setTo] = useState<number | null>(null);
  const [dialog, setDialog] = useState<'ooo' | 'back' | 'part' | null>(null);
  const [busy, setBusy] = useState(false);
  const i = q.data?.issue;
  useEffect(() => {
    if (i) pms.adopt(i.property_id);
  }, [i, pms]);

  if (!reads) return <NoAccess what="Maintenance is shown to maintenance, housekeeping and the front desk." />;
  if (!pms.online) return <NoAccess what="A maintenance issue shows when WorkSuite is back: its state is the server’s." />;
  if (q.isLoading) return <Spinner />;
  if (q.error || !i) return <div className="p-6"><ErrorNote error={q.error ?? new Error('The issue could not be loaded.')} onRetry={() => void q.refetch()} /></div>;
  const open = !['closed', 'cancelled'].includes(i.status);
  const assign = (i.options ?? []).find((o) => o.action === 'assign');
  const reassign = fixes && open && !!i.assigned_to && !assign;
  const reload = () => {
    void qc.invalidateQueries({ queryKey: K.issue(id) });
    void qc.invalidateQueries({ queryKey: ['pms', 'live'] });
  };
  const write = async (fn: () => Promise<{ message: string; data?: unknown }>) => {
    setBusy(true);
    acts.setError(null);
    try {
      const r = await fn();
      toast('success', r.message);
      const move = (r.data as { reassign?: Array<{ confirmation_no?: string }> } | undefined)?.reassign ?? [];
      if (move.length) toast('info', `${move.length} reservation${move.length === 1 ? '' : 's'} to move: ${move.map((x) => x.confirmation_no).filter(Boolean).join(', ')}.`);
      setDialog(null);
      reload();
    } catch (e) {
      acts.setError(errorText(e, 'Nothing was changed.'));
      setDialog(null);
    } finally {
      setBusy(false);
    }
  };
  const photo = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (f.size > MAX_PHOTO) return acts.setError(`${f.name} is larger than 10 MB.`);
    await write(() => pUpload(`/maintenance-issues/${id}/photos`, f, f.name, {}));
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title={i.title} sub={`${i.status_label} · ${i.category_label} · ${i.room_number ? `room ${i.room_number}` : 'no room'} · reported ${day(i.business_date ?? i.created_at)}${i.reported_by ? ` by ${i.reported_by}` : ''}`}>
        <Button variant="ghost" icon="back" onClick={() => pms.go('maintenance')}>
          Maintenance
        </Button>
        {fixes && open && !i.assigned_to && me > 0 && assign ? (
          <Button disabled={acts.busy || !pms.online} onClick={() => void acts.send(`/maintenance-issues/${id}`, 'assign', { assigned_to: me, version: i.version })}>
            Take it
          </Button>
        ) : null}
        <ActionButtons options={i.options} busy={acts.busy} online={pms.online} skip={['assign']} primary={(i.options ?? []).find((o) => ['start', 'resolve', 'resume', 'close'].includes(o.action))?.action} onPick={(o) => acts.run(`/maintenance-issues/${id}`, o, i.version)} />
      </PageHead>
      {acts.error ? <Refusal text={acts.error} /> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Section title="The issue">
            <Facts
              rows={[
                ['Details', i.description ?? '—'],
                ['Priority', i.priority],
                ['Assigned', i.assigned_name ?? 'Nobody yet'],
                ['Reported via', i.reported_via],
                ['Resolution', i.resolution ?? '—'],
                ['Resolved', stamp(i.resolved_at)],
                ['Closed', stamp(i.closed_at)],
              ]}
            />
          </Section>
          <Section
            title="Parts used"
            action={
              fixes && open ? (
                <Button size="sm" icon="plus" disabled={!pms.online} onClick={() => setDialog('part')}>
                  Add part
                </Button>
              ) : null
            }
          >
            {i.parts_used.length === 0 ? (
              <p className="m-0 text-[13px] text-ink-3">None.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
                {i.parts_used.map((p, k) => (
                  <li key={k}>
                    {p.name} × {p.quantity}
                    {p.note ? ` — ${p.note}` : ''} <span className="text-[11.5px] text-ink-3">{p.by ?? ''} · {stamp(p.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="History">
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] text-ink-2">
              {q.data!.history.map((h, k) => (
                <li key={k}>
                  {stamp(h.at)} · {h.text}
                  {h.by ? ` · ${h.by}` : ''}
                </li>
              ))}
            </ul>
          </Section>
        </div>
        <div className="flex flex-col gap-4">
          {fixes && open && (assign || reassign) ? (
            <Section title={reassign ? 'Give to someone else' : 'Give to'}>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <PersonPick label="Technician" value={to} onChange={setTo} />
                </div>
                <Button disabled={!to || acts.busy || !pms.online} onClick={() => void acts.send(`/maintenance-issues/${id}`, 'assign', { assigned_to: to, version: i.version })}>
                  Assign
                </Button>
              </div>
              <p className="mt-1 mb-0 text-[11.5px] text-ink-3">They must hold the maintenance permission at this property.</p>
            </Section>
          ) : null}
          {i.room_id ? (
            <Section title="The room">
              <p className="m-0 text-[13px]">
                Room {i.room_number}
                {i.outage && i.outage.status === 'active' ? (
                  <>
                    {' '}
                    · <b className="text-danger">{i.outage.kind_label}</b> {day(i.outage.start_date)} – {day(i.outage.end_date)}
                  </>
                ) : ' · in service'}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {outs && open && !(i.outage && i.outage.status === 'active') ? (
                  <Button size="sm" disabled={!pms.online} onClick={() => setDialog('ooo')}>
                    Take out of order
                  </Button>
                ) : null}
                {outs && i.outage && i.outage.status === 'active' ? (
                  <Button size="sm" disabled={!pms.online} onClick={() => setDialog('back')}>
                    Back in service
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => pms.open({ kind: 'room', id: i.room_id! })}>
                  The room
                </Button>
              </div>
            </Section>
          ) : null}
          <Section
            title="Photos"
            action={
              fixes || pms.mayAny(...MAINT_REPORT) ? (
                <ChooseFiles multiple={false} accept="image/jpeg,image/png,image/webp,image/heic" disabled={!pms.online || busy} label="Add a photo…" onFiles={(f) => void photo(f)} />
              ) : null
            }
          >
            {i.photos.length === 0 ? (
              <p className="m-0 text-[13px] text-ink-3">None.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {i.photos.map((p) => (
                  <img key={p.id} src={apiUrl(p.url)} alt={`${i.title}, photo`} className="size-24 rounded-[8px] border border-line object-cover" />
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
      {acts.dialog}
      {dialog === 'ooo' ? (
        <Ask
          title={`Take room ${i.room_number} out`}
          text="Out of order takes the room out of the inventory; out of service does not. The reservations on those nights are named so they can be moved."
          fields={[
            { name: 'kind', label: 'How', type: 'select', options: [{ value: 'out_of_order', label: 'Out of order' }, { value: 'out_of_service', label: 'Out of service' }] },
            { name: 'end_date', label: 'Until', type: 'date' },
            { name: 'reason', label: 'Reason', hint: 'Blank: the fault.' },
          ]}
          confirm="Take out"
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(v) => void write(() => pPost(`/maintenance-issues/${id}/out-of-order`, { kind: v.kind, ...(v.end_date ? { end_date: v.end_date } : {}), ...(v.reason ? { reason: v.reason } : {}) }))}
        />
      ) : null}
      {dialog === 'back' ? (
        <Ask title={`Room ${i.room_number} back in service`} fields={[{ name: 'reason', label: 'Reason', required: true }]} confirm="Back in service" busy={busy} onClose={() => setDialog(null)} onSubmit={(v) => void write(() => pPost(`/maintenance-issues/${id}/back-in-service`, { reason: v.reason }))} />
      ) : null}
      {dialog === 'part' ? <PartDialog busy={busy} onClose={() => setDialog(null)} onSave={(body, key) => void write(() => pPost(`/maintenance-issues/${id}/parts`, body, key))} /> : null}
    </div>
  );
}

/** A part used on the job: an Inventory product (taken from the store the property names), or just its name. */
function PartDialog({ busy, onClose, onSave }: { busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>, key: string) => void }) {
  const pms = usePms();
  const inventory = useHasInventory();
  const [how, setHow] = useState<'product' | 'name'>(inventory ? 'product' : 'name');
  const [product, setProduct] = useState<Pickable | null>(null);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [key] = useState(() => newKey('part'));
  const ready = Number(quantity) > 0 && (how === 'product' ? !!product : !!name.trim());
  return (
    <Modal
      title="A part used"
      onClose={onClose}
      width={480}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!ready || !pms.online} onClick={() => onSave({ ...(how === 'product' ? { product_id: product!.id } : { name: name.trim() }), quantity: Number(quantity), ...(note.trim() ? { note: note.trim() } : {}) }, key)}>
            Add part
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2 text-[12.5px]">
        {inventory ? <Select aria-label="What" value={how} options={[{ value: 'product', label: 'An Inventory product' }, { value: 'name', label: 'Something else, by name' }]} onChange={(e) => setHow(e.target.value as 'product' | 'name')} className={input} /> : null}
        {how === 'product' ? <ProductPick org={String(pms.property.org_id)} warehouse={null} value={product} onChange={setProduct} label="Part" /> : <input aria-label="Part" placeholder="What was used" value={name} onChange={(e) => setName(e.target.value)} className={input} />}
        <input aria-label="Quantity" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={input} />
        <input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className={input} />
      </div>
    </Modal>
  );
}
