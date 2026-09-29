import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Spinner } from '../../components/ui';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { ChooseFiles, DropZone, input, Section } from '../garage/parts';
import { PageHead } from '../hr/parts';
import { day, errorText, K, MAX_DOCUMENT, pGet, pUpload, stamp, type GuestDocument, type GuestProfile, type ReservationSummary } from './api';
import { Facts, Money, NoAccess, Refusal, ReservationPill, usePms, VipPill } from './parts';

const IDENTITY = new Set(['passport', 'national_id', 'visa', 'driving_licence']);

/**
 * A guest's profile at the desk (§7.1): who they are (CRM's), their
 * hospitality details and flagged preferences (PMS-GST-005), their
 * reservations here, their documents — identification listed only for
 * people who may see it (PMS-GST-004) — and a document added from this
 * computer (PMS-DOC-001).
 */
export default function GuestScreen({ id }: { id: number }) {
  const pms = usePms();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.guest(id), queryFn: ({ signal }) => pGet<{ guest: GuestProfile; documents: GuestDocument[]; activity: Array<{ text: string; at: string; by?: string | null }> }>(`/guests/${id}`, undefined, signal), enabled: pms.may('pms.guest.view') });
  const res = useQuery({ queryKey: K.guestReservations(id), queryFn: ({ signal }) => pGet<{ items: ReservationSummary[] }>(`/guests/${id}/reservations`, undefined, signal), enabled: pms.may('pms.guest.view') });
  const [kind, setKind] = useState('other');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!pms.may('pms.guest.view')) return <NoAccess what="Guests are shown to people who may see them (“See guests”)." />;
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-6"><ErrorNote error={q.error ?? new Error('The guest could not be loaded.')} /></div>;
  const g = q.data.guest;
  const sensitive = pms.may('pms.guest.sensitive_data');
  const kinds = pms.options.document_kinds.filter((k) => sensitive || !IDENTITY.has(k.value));

  const upload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (file.size > MAX_DOCUMENT) {
      setError(`${file.name} is larger than 15 MB.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await pUpload(`/guests/${id}/documents`, file, file.name, { kind, property_id: pms.property.id });
      toast('success', r.message);
      void qc.invalidateQueries({ queryKey: K.guest(id) });
    } catch (e) {
      setError(errorText(e, 'The document was not kept.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead
        title={
          <span className="flex items-center gap-2">
            {g.name} <VipPill level={g.vip_level} />
          </span>
        }
        sub={`${g.stays} ${g.stays === 1 ? 'stay' : 'stays'}${g.last_stay ? ` · last ${day(g.last_stay)}` : ''}`}
      >
        <Button variant="ghost" icon="back" onClick={pms.back}>
          Back
        </Button>
      </PageHead>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Profile">
          <Facts
            rows={[
              ['Email', g.email],
              ['Phone', g.phone],
              ['Address', g.address],
              ['Nationality', g.nationality],
              ['Language', g.language],
              ['Guest type', g.guest_type],
              ['VIP', g.vip_level === 'none' ? 'No' : `${g.vip_level.toUpperCase()}${g.vip_note ? ` — ${g.vip_note}` : ''}`],
              ['Identification', g.has_identity ? (g.identity_verified ? 'On file, verified' : 'On file') : 'None'],
              ['Special requirements', g.special_requirements],
              ['Notes', g.notes],
            ]}
          />
          {g.preferences.length ? (
            <ul className="mt-3 mb-0 list-none p-0 text-[12.5px]">
              {g.preferences.map((p) => (
                <li key={p.id} className={p.is_flag ? 'font-semibold text-warning' : 'text-ink-2'}>
                  {p.category}: {p.preference}
                  {p.note ? ` — ${p.note}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
        <Section title="Reservations">
          {res.isLoading ? (
            <Spinner />
          ) : (res.data?.items ?? []).length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">None at the properties you reach.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
              {res.data!.items.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <button type="button" className="font-mono text-[12px] font-semibold text-primary" onClick={() => pms.open({ kind: 'reservation', id: r.id })}>
                    {r.confirmation_no}
                  </button>
                  <span className="min-w-0 flex-1 text-ink-2">
                    {day(r.arrival_date)} → {day(r.departure_date)}
                  </span>
                  <ReservationPill label={r.status_label} badge={r.badge} />
                  <Money amount={r.total_amount} currency={r.currency} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <Section title="Documents">
        {q.data.documents.length ? (
          <ul className="m-0 mb-3 flex list-none flex-col gap-1 p-0 text-[13px]">
            {q.data.documents.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <b>{d.kind_label}</b>
                <span className="min-w-0 flex-1 truncate text-ink-2">
                  {d.file_name} · {bytes(d.bytes)}
                  {d.redacted ? ' · erased' : d.retain_until ? ` · kept until ${day(d.retain_until)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-0 text-[13px] text-ink-3">No documents{sensitive ? '' : ' you may see'}.</p>
        )}
        {pms.may('pms.guest.edit') ? (
          <DropZone enabled={pms.online && !busy} onFiles={(f) => void upload(f)} label="Drop a document here" className="flex flex-wrap items-center gap-2 rounded-[10px] border border-dashed border-line px-3 py-3">
            <Select aria-label="What it is" value={kind} onChange={(e) => setKind(e.target.value)} options={kinds} className={`${input} w-48`} />
            <ChooseFiles multiple={false} accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" disabled={!pms.online || busy} label="Choose a photo or PDF…" onFiles={(f) => void upload(f)} />
            <span className="text-[12px] text-ink-3">or drop it here · photos and PDFs up to 15 MB</span>
          </DropZone>
        ) : null}
        {error ? <div className="mt-2"><Refusal text={error} /></div> : null}
      </Section>
      {q.data.activity.length ? (
        <Section title="Activity">
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] text-ink-2">
            {q.data.activity.slice(0, 20).map((a, i) => (
              <li key={i}>
                {stamp(a.at)} · {a.text}
                {a.by ? ` · ${a.by}` : ''}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
