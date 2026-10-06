import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type DragEvent } from 'react';
import { Icon } from '../../components/Icon';
import { Avatar, Spinner, Switch, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { CameraCapture } from '../chat/attach';
import { addPhoto, answered, attemptKey, fetchClient, fetchVisit, K, mediaUrl, publishPhoto, saveRecord, type RecordMedia, type VisitItem } from './api';
import { AllergyLine } from './Clients';
import { Choice, Failed, Label, Note, Page, Panel, Tag, TouchButton, useDesk, type TagTone } from './parts';

/**
 * The service record at the desk (D17, REC-01…05): what was used and how —
 * the formula, the technique, the timings — and photos before and after, so
 * the next visit can repeat it. "Same as last time" fills in the client's
 * last record for the same service.
 *
 * Kept by WorkSuite against the appointment, one record each; saving again
 * changes it. Photos are files in WorkSuite Files, checked by what they are,
 * and staff-only: a photo is used on the website only with the client's
 * consent on file, which WorkSuite checks when it is switched on.
 */
const STATUS_TONE: Record<string, TagTone> = { completed: 'success', in_service: 'indigo', checked_in: 'indigo', confirmed: 'blue', pending: 'warning' };

export default function ServiceRecord() {
  const desk = useDesk();
  const visitId = Number(desk.params.get('visit') ?? 0);
  const detail = useQuery({ queryKey: K.visit(visitId), queryFn: ({ signal }) => fetchVisit(visitId, signal), enabled: visitId > 0 });

  if (desk.offline) {
    return (
      <Page title="Service record" sub="What was done, so the next visit can repeat it">
        <Note tone="muted">Service records and their photos are kept in WorkSuite. Record this one when the line is back.</Note>
      </Page>
    );
  }
  if (!visitId) {
    return (
      <Page title="Service record" sub="What was done, so the next visit can repeat it">
        <Note tone="muted">Open a visit’s service record from the client’s recent visits, or from the calendar.</Note>
      </Page>
    );
  }
  if (detail.isError) {
    return (
      <Page title="Service record">
        <Failed text={detail.error instanceof Error ? detail.error.message : 'The visit could not be loaded.'} onRetry={() => void detail.refetch()} />
      </Page>
    );
  }
  if (!detail.data) return <Spinner label="Loading the visit…" />;

  const items = detail.data.visit.items;
  const asked = Number(desk.params.get('appointment') ?? 0);
  const first = items.find((i) => i.appointment_id === asked) ?? items[0];
  if (!first) return <Spinner />;
  return <RecordFor key={first.appointment_id} initial={first.appointment_id} />;
}

function RecordFor({ initial }: { initial: number }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const visitId = Number(desk.params.get('visit') ?? 0);
  const detail = useQuery({ queryKey: K.visit(visitId), queryFn: ({ signal }) => fetchVisit(visitId, signal) });
  const [apptId, setApptId] = useState(initial);
  const d = detail.data!;
  const visit = d.visit;
  const item: VisitItem = visit.items.find((i) => i.appointment_id === apptId) ?? visit.items[0]!;
  const entry = d.records?.find((r) => r.appointment_id === item.appointment_id);
  const card = useQuery({ queryKey: K.client(visit.client.id), queryFn: ({ signal }) => fetchClient(visit.client.id, signal) });
  const recordId = entry?.record?.id ?? null;
  const photos: RecordMedia[] = (card.data?.records ?? []).find((r) => r.id === recordId || r.appointment_id === item.appointment_id)?.media ?? [];
  const allergies = d.allergies.filter((a) => !a.withdrawn_at);
  const test = d.patch_tests.find((p) => p.result === 'negative' && p.valid_until);

  return (
    <Page title="Service record" sub="What was done, so the next visit can repeat it">
      {visit.items.length > 1 ? (
        <Choice
          label="Which service"
          value={String(item.appointment_id)}
          onChange={(v) => setApptId(Number(v))}
          options={visit.items.map((i) => ({ value: String(i.appointment_id), label: `${i.service} · ${i.provider.split(' ')[0]}` }))}
        />
      ) : null}
      <div className="flex flex-col gap-3.5 xl:flex-row xl:items-start">
        <Panel className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-3">
            <Avatar name={visit.client.name} size={42} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[19px] font-extrabold text-ink">
                {visit.client.name} · {item.service}
              </div>
              <div className="truncate text-[12.5px] text-ink-2">
                {item.provider} · {item.start}–{item.end} · {visit.number}
              </div>
            </div>
            <Tag tone={STATUS_TONE[item.status] ?? 'muted'}>{item.status_label}</Tag>
          </div>
          <AllergyLine allergies={allergies} test={test} />
          <RecordForm
            key={`${item.appointment_id}-${entry?.record?.id ?? 'new'}`}
            appointmentId={item.appointment_id}
            record={entry?.record ?? null}
            last={entry?.last ?? null}
            onSaved={() => {
              void qc.invalidateQueries({ queryKey: K.visit(visitId) });
              void qc.invalidateQueries({ queryKey: K.client(visit.client.id) });
            }}
          />
        </Panel>

        <Photos
          recordId={recordId}
          photos={photos}
          loading={card.isLoading}
          onChanged={() => {
            void qc.invalidateQueries({ queryKey: K.client(visit.client.id) });
            void qc.invalidateQueries({ queryKey: K.visit(visitId) });
          }}
        />
      </div>
    </Page>
  );
}

function RecordForm({ appointmentId, record, last, onSaved }: { appointmentId: number; record: { formula: string | null; technique: string | null; timing: string | null } | null; last: { formula: string | null; technique: string | null; timing: string | null; at: string | null } | null; onSaved: () => void }) {
  const desk = useDesk();
  const [formula, setFormula] = useState(record?.formula ?? '');
  const [technique, setTechnique] = useState(record?.technique ?? '');
  const [timing, setTiming] = useState(record?.timing ?? '');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(attemptKey);
  const empty = formula.trim() === '' && technique.trim() === '' && timing.trim() === '';
  const may = desk.may('salon.visit.service');
  const box = 'w-full rounded-[14px] border-2 border-line bg-surface px-4 py-3 text-[15px] leading-relaxed text-ink outline-none focus:border-primary';

  async function save() {
    setBusy(true);
    try {
      const r = await saveRecord(appointmentId, { formula: formula.trim(), technique: technique.trim(), timing: timing.trim() }, key);
      toast('success', r.message || 'Record saved.');
      setKey(attemptKey());
      onSaved();
    } catch (e) {
      if (answered(e)) setKey(attemptKey());
      toast('error', e instanceof Error ? e.message : 'The record was not saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Label className="mt-1">Formula</Label>
      <textarea aria-label="Formula" rows={4} maxLength={4000} value={formula} placeholder="6.1 + 7.3 (3:1), 20 vol 1:1.5" onChange={(e) => setFormula(e.target.value)} className={box} />
      <Label>Technique</Label>
      <textarea aria-label="Technique" rows={2} maxLength={4000} value={technique} placeholder="Roots only, 2 cm regrowth. Rinsed cool." onChange={(e) => setTechnique(e.target.value)} className={box} />
      <label className="flex items-center gap-3">
        <Label className="w-24 shrink-0">Timing</Label>
        <input aria-label="Timing" maxLength={160} value={timing} placeholder="35 min processing" onChange={(e) => setTiming(e.target.value)} className="h-11 min-w-0 flex-1 rounded-[12px] border border-line bg-surface px-3.5 text-[15px] text-ink outline-none focus:border-primary" />
      </label>
      {!may ? <Note tone="muted">Recording a service needs SalonMate’s permission to record services.</Note> : null}
      <div className="mt-1 flex gap-2.5">
        <TouchButton
          icon="undo"
          disabled={!last || !may}
          title={last ? 'Fill in the last record for this service' : 'No earlier record for this service'}
          onClick={() => {
            if (!last) return;
            setFormula(last.formula ?? '');
            setTechnique(last.technique ?? '');
            setTiming(last.timing ?? '');
          }}
        >
          Same as last time
        </TouchButton>
        <TouchButton variant="primary" icon="check" className="flex-1" loading={busy} disabled={empty || !may} onClick={() => void save()}>
          Save to Client 360
        </TouchButton>
      </div>
    </>
  );
}

type Kind = 'before' | 'after' | 'other';

/** Before and after, taken with the desk's webcam or dropped in as a file (REC-02…04). */
function Photos({ recordId, photos, loading, onChanged }: { recordId: number | null; photos: RecordMedia[]; loading: boolean; onChanged: () => void }) {
  const desk = useDesk();
  const [busy, setBusy] = useState<Kind | 'publish' | null>(null);
  const [camera, setCamera] = useState<Kind | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [pickKind, setPickKind] = useState<Kind>('other');
  const may = desk.may('salon.visit.service');
  const latest = (k: Kind) => [...photos].reverse().find((p) => p.kind === k) ?? null;
  const others = photos.filter((p) => p.kind === 'other');
  const allPublic = photos.length > 0 && photos.every((p) => p.public);

  async function upload(file: Blob, name: string, kind: Kind) {
    if (!recordId) {
      toast('warning', 'Save the record first, then add its photos.');
      return;
    }
    setBusy(kind);
    try {
      const r = await addPhoto(recordId, file, name, kind);
      toast('success', r.message || 'Photo kept.');
      onChanged();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'The photo was not kept.');
    } finally {
      setBusy(null);
    }
  }

  const drop = (kind: Kind) => (e: DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) void upload(f, f.name, kind);
  };

  async function website(on: boolean) {
    setBusy('publish');
    try {
      let said: string | null = null;
      for (const p of photos) said = (await publishPhoto(desk.org, p.id, on)) ?? said;
      toast('success', said ?? (on ? 'May be used on the website.' : 'Staff-only again.'));
      onChanged();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'That was not changed.');
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  const tile = (kind: 'before' | 'after', label: string) => {
    const p = latest(kind);
    return (
      <div key={kind} onDragOver={(e) => e.preventDefault()} onDrop={drop(kind)} className="relative aspect-[4/3] overflow-hidden rounded-[14px] border border-line">
        {p && p.mime.startsWith('image/') && p.mime !== 'image/heic' ? (
          <img src={mediaUrl(p.id)} alt={`${label} photo`} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-ink-2" style={{ background: 'repeating-linear-gradient(135deg, var(--ws-subtle), var(--ws-subtle) 8px, var(--ws-ground) 8px, var(--ws-ground) 16px)' }}>
            <span className="flex flex-col items-center gap-1 text-[14px] font-bold">
              <Icon name={p ? 'file' : 'image'} size={22} />
              {p ? `${label} · kept` : label}
            </span>
          </div>
        )}
        <div className="absolute right-2 bottom-2 flex gap-1.5">
          <button type="button" disabled={!may || busy !== null} aria-label={`Take the ${label.toLowerCase()} photo`} onClick={() => setCamera(kind)} className="grid h-9 w-9 place-items-center rounded-[10px] bg-surface/90 text-ink shadow hover:bg-surface disabled:opacity-50">
            {busy === kind ? <Icon name="spinner" size={16} className="animate-spin-slow" /> : <Icon name="camera" size={16} />}
          </button>
          <button
            type="button"
            disabled={!may || busy !== null}
            aria-label={`Choose the ${label.toLowerCase()} photo`}
            onClick={() => {
              setPickKind(kind);
              picker.current?.click();
            }}
            className="grid h-9 w-9 place-items-center rounded-[10px] bg-surface/90 text-ink shadow hover:bg-surface disabled:opacity-50"
          >
            <Icon name="upload" size={16} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <Panel className="flex w-full flex-col gap-3 xl:w-[480px] xl:shrink-0">
      <div>
        <h2 className="text-[18px] font-extrabold text-ink">Photos</h2>
        <p className="text-[12.5px] text-ink-2">Stored in WorkSuite Files · staff-only</p>
      </div>
      {loading ? <Spinner label="Loading the photos…" /> : null}
      {!recordId ? <Note tone="muted">Save the record first, then add its photos.</Note> : null}
      <div className="grid grid-cols-2 gap-2.5">
        {tile('before', 'Before')}
        {tile('after', 'After')}
        {others.map((p) => (
          <div key={p.id} className="aspect-[4/3] overflow-hidden rounded-[14px] border border-line">
            {p.mime.startsWith('image/') && p.mime !== 'image/heic' ? <img src={mediaUrl(p.id)} alt="Photo" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-ink-2"><Icon name="file" size={22} /></div>}
          </div>
        ))}
        <button
          type="button"
          disabled={!may || !recordId || busy !== null}
          onDragOver={(e) => e.preventDefault()}
          onDrop={drop('other')}
          onClick={() => setCamera('other')}
          className="flex aspect-[4/3] flex-col items-center justify-center gap-1.5 rounded-[14px] border-2 border-dashed border-[#C9CEDD] text-[13px] font-bold text-ink-2 hover:bg-subtle disabled:opacity-50 dark:border-line"
        >
          <Icon name="camera" size={22} />
          Take with webcam or drop a file
        </button>
      </div>
      <input
        ref={picker}
        type="file"
        hidden
        accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void upload(f, f.name, pickKind);
        }}
      />
      <div className="mt-1 flex items-center gap-3">
        <Switch checked={allPublic} disabled={photos.length === 0 || busy !== null || !desk.may('salon.client.edit')} onChange={(on) => void website(on)} label="Client agrees to website use" />
        <span className="text-[14px] text-ink">Client agrees to website use</span>
      </div>
      <p className={cx('-mt-1 text-[12.5px] text-ink-2')}>Off means the photos can never appear on the website or the booking page. On needs the client’s signed consent on file.</p>

      {camera ? <CameraCapture onClose={() => setCamera(null)} onTaken={(blob, name) => void upload(blob, name, camera)} /> : null}
    </Panel>
  );
}
