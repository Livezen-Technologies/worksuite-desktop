import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button, ErrorNote, Spinner } from '../../components/ui';
import { toast } from '../../core/toasts';
import { Ask, Section } from '../garage/parts';
import { PageHead } from '../hr/parts';
import { day, errorText, K, nice, pGet, pPost, stamp, type IssueList, type RoomDetail } from './api';
import { IssueRows, MAINT_READ, MAINT_REPORT, ReportIssue } from './Maintenance';
import { RestockDialog } from './Restock';
import { Facts, NoAccess, Refusal, StatusBadge, usePms } from './parts';

interface RoomHistory {
  items: Array<{ axis: string; from: string | null; to: string; reason: string | null; source: string | null; business_date: string | null; by: string | null; at: string }>;
}

/**
 * A room (`/pms/rooms/<id>`, the deep link and the out-of-order notice): its
 * record (PMS-ROM-001), its statuses and their history (ROM-002), its
 * housekeeping status moved along the edges the server offers
 * (`housekeeping_options`, a reason where one is needed), what went into it
 * (a restock without a task, PMS-HK-012), its maintenance issues and a fault
 * reported from here, its outages — released here with a reason by whoever
 * may. Every write is online only.
 */
export default function RoomScreen({ id }: { id: number }) {
  const pms = usePms();
  const qc = useQueryClient();
  const reads = pms.mayAny('pms.room.view', 'pms.room.manage', 'pms.housekeeping.view', 'pms.reservation.view');
  const q = useQuery({ queryKey: K.room(id), queryFn: ({ signal }) => pGet<RoomDetail>(`/rooms/${id}`, undefined, signal), enabled: reads });
  const h = useQuery({ queryKey: K.roomHistory(id), queryFn: ({ signal }) => pGet<RoomHistory>(`/rooms/${id}/history`, undefined, signal), enabled: reads });
  const [release, setRelease] = useState<number | null>(null);
  const [hkTo, setHkTo] = useState<RoomDetail['housekeeping_options'][number] | null>(null);
  const [restock, setRestock] = useState(false);
  const [reporting, setReporting] = useState(false);
  const readsIssues = pms.mayAny(...MAINT_READ);
  const issues = useQuery({ queryKey: K.roomIssues(id), queryFn: ({ signal }) => pGet<IssueList>(`/rooms/${id}/maintenance`, undefined, signal), enabled: reads && readsIssues && pms.online });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = q.data?.room;
  useEffect(() => {
    const pid = (r as { property_id?: number } | undefined)?.property_id;
    if (pid) pms.adopt(pid);
  }, [r, pms]);

  if (!reads) return <NoAccess what="Rooms are shown to the front desk and housekeeping." />;
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data || !r) return <div className="p-6"><ErrorNote error={q.error ?? new Error('The room could not be loaded.')} /></div>;
  const releases = pms.mayAny('pms.maintenance.manage', 'pms.room.manage', 'pms.room.block');
  const hkMoves = q.data.housekeeping_options.filter((o) => !o.perm || pms.may(o.perm) || pms.may('pms.room.manage'));
  const restocks = pms.mayAny('pms.housekeeping.view', 'pms.housekeeping.manage');

  const setHk = async (o: RoomDetail['housekeeping_options'][number], reason?: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await pPost(`/rooms/${id}/housekeeping`, { to: o.to, version: r.version, ...(reason ? { reason } : {}) });
      toast('success', res.message);
      setHkTo(null);
    } catch (e) {
      setError(errorText(e, 'The room’s status was not changed.'));
      setHkTo(null);
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: K.room(id) });
      void qc.invalidateQueries({ queryKey: K.roomHistory(id) });
      void qc.invalidateQueries({ queryKey: K.live });
    }
  };

  const doRelease = async (outage: number, reason: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await pPost(`/outages/${outage}/release`, { reason });
      toast('success', res.message);
      setRelease(null);
      void qc.invalidateQueries({ queryKey: K.room(id) });
      void qc.invalidateQueries({ queryKey: K.live });
    } catch (e) {
      setError(errorText(e, 'The room was not released.'));
      setRelease(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead
        title={
          <span className="flex items-center gap-2">
            Room {r.number} <StatusBadge badge={r.badge} />
          </span>
        }
        sub={[r.room_type_name ?? r.room_type, r.building, r.floor ? `floor ${r.floor}` : null].filter(Boolean).join(' · ')}
      >
        <Button variant="ghost" icon="back" onClick={pms.back}>
          Back
        </Button>
        <Button onClick={() => pms.go('rack', { room: id })}>On the rack</Button>
        {restocks ? (
          <Button icon="package" disabled={!pms.online} onClick={() => setRestock(true)}>
            Record restock
          </Button>
        ) : null}
        {pms.mayAny(...MAINT_REPORT) ? (
          <Button icon="wrench" disabled={!pms.online} onClick={() => setReporting(true)}>
            Report a fault
          </Button>
        ) : null}
      </PageHead>
      {error ? <Refusal text={error} /> : null}
      {hkMoves.length ? (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Housekeeping status">
          <span className="text-[12.5px] text-ink-3">Housekeeping status:</span>
          {hkMoves.map((o) => (
            <Button key={`${o.to}-${o.on}`} size="sm" disabled={busy || !pms.online} title={pms.online ? undefined : 'Needs WorkSuite'} onClick={() => (o.needs.includes('reason') ? setHkTo(o) : void setHk(o))}>
              {o.label}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="The room">
          <Facts
            rows={[
              ['Housekeeping', r.hk_status_label ?? nice(r.hk_status)],
              ['Service', nice(r.service_status)],
              ['Occupancy', nice(r.occupancy)],
              ['Sellable', r.is_sellable ? 'Yes' : `No${r.sellable_note ? ` — ${r.sellable_note}` : ''}`],
              ['Beds', r.bed_type ? nice(r.bed_type) : '—'],
              ['Up to', r.max_occupancy ? `${r.max_occupancy} guests` : '—'],
              ['Accessible', r.accessible ? 'Yes' : 'No'],
              ['Smoking', r.smoking ? 'Yes' : 'No'],
              ['Zone', r.hk_zone ?? '—'],
              ['Nights booked ahead', String(q.data.future_nights ?? 0)],
            ]}
          />
        </Section>
        <Section title="Out of order, out of service, blocked">
          {q.data.outages.length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">None.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
              {q.data.outages.map((o) => (
                <li key={o.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <b>{o.kind_label ?? nice(o.kind)}</b> from {day(o.start_date)}
                    {o.end_date ? ` until ${day(o.end_date)}` : ''}
                    {o.reason ? ` — ${o.reason}` : ''}
                    {o.status !== 'active' ? ` (${o.status})` : ''}
                  </span>
                  {o.status === 'active' && releases ? (
                    <Button size="sm" disabled={!pms.online} onClick={() => setRelease(o.id)}>
                      Release
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      {readsIssues ? (
        <Section title="Maintenance">
          {!pms.online ? (
            <p className="m-0 text-[13px] text-ink-3">Shown when WorkSuite is back.</p>
          ) : issues.isLoading ? (
            <Spinner />
          ) : (issues.data?.items ?? []).length === 0 ? (
            <p className="m-0 text-[13px] text-ink-3">No issues.</p>
          ) : (
            <IssueRows items={issues.data!.items} />
          )}
        </Section>
      ) : null}
      <Section title="History">
        {h.isLoading ? (
          <Spinner />
        ) : (h.data?.items ?? []).length === 0 ? (
          <p className="m-0 text-[13px] text-ink-3">Nothing yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] text-ink-2">
            {h.data!.items.slice(0, 50).map((x, i) => (
              <li key={i}>
                {stamp(x.at)} · {nice(x.axis)}: {x.from ? `${nice(x.from)} → ` : ''}
                <b>{nice(x.to)}</b>
                {x.reason ? ` · ${x.reason}` : ''}
                {x.by ? ` · ${x.by}` : ''}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {hkTo ? <Ask title={hkTo.label} fields={[{ name: 'reason', label: 'Reason', required: true }]} confirm={hkTo.label} busy={busy} onClose={() => setHkTo(null)} onSubmit={(v) => void setHk(hkTo, v.reason)} /> : null}
      {restock ? (
        <RestockDialog
          path={`/rooms/${id}/restocks`}
          room={r.number}
          onClose={() => setRestock(false)}
          onDone={() => {
            setRestock(false);
            void qc.invalidateQueries({ queryKey: K.roomHistory(id) });
          }}
        />
      ) : null}
      {reporting ? <ReportIssue room={{ id, number: r.number }} onClose={() => setReporting(false)} onDone={(issue) => pms.open({ kind: 'issue', id: issue })} /> : null}
      {release ? <Ask title="Release the room" text="It is sold again from today." fields={[{ name: 'reason', label: 'Reason', required: true }]} confirm="Release" busy={busy} onClose={() => setRelease(null)} onSubmit={(v) => void doRelease(release, v.reason ?? '')} /> : null}
    </div>
  );
}
