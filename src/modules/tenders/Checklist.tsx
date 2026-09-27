import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { dateLabel, dayWords, relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, Sheet } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { K, useOwners, type DocAccess } from './api';
import { AttachMenu, saveTenderFile, Uploading, useDropZone, useTenderUploads } from './files';
import { addLine, applyPack, attachToLine, bulkLines, fetchChecklist, filterLines, K2, LINE_STATUS, lineChanges, lineDraft, removeLine, reviewLine, sectionsOf, updateLine, type Line, type LineDraft, type LineFilter } from './work';

/**
 * The bid pack as a checklist: what the buyer asked for, section by section in
 * the buyer's order, with what is on file against each line, who is chasing
 * it, and whether it has been checked. "Ready" is the server's: a mandatory
 * line counts when something readable is on file, it has not been sent back,
 * and neither it nor the line has expired. A line that does not count says
 * why, in the words the pipeline uses when it refuses to move the tender on.
 *
 * Sending a document back needs a reason, one line at a time. Approving and
 * removing can be done for a selection; approving needs the approval
 * permission, and so does removing or making optional a required line that
 * is not yet satisfied.
 */
const FILTERS: Array<[LineFilter, string]> = [
  ['all', 'All'],
  ['outstanding', 'Outstanding'],
  ['missing', 'Missing'],
  ['pending_review', 'Pending review'],
  ['rejected', 'Sent back'],
  ['approved', 'Approved'],
  ['optional', 'Optional'],
];

export default function Checklist({ id, org, canManage, canApprove, can }: { id: number; org: string; canManage: boolean; canApprove: boolean; can: DocAccess }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K2.checklist(id), queryFn: ({ signal }) => fetchChecklist(id, signal) });
  const [filter, setFilter] = useState<LineFilter>('all');
  const [picked, setPicked] = useState<number[]>([]);
  const [editing, setEditing] = useState<Line | 'new' | null>(null);
  const [sending, setSending] = useState<Line | null>(null);
  const [packs, setPacks] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [history, setHistory] = useState<number | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: K2.checklist(id) });
    void qc.invalidateQueries({ queryKey: K.tender(id) });
  };
  const uploads = useTenderUploads(id, refresh);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data;
  const shown = filterLines(c.items, filter);
  const choosable = canManage || canApprove;
  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      toast('success', done);
      refresh();
      return true;
    } catch (e) {
      toast('error', errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const outstanding = c.items.filter((l) => l.mandatory && !l.settled).length;

  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-wrap items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3" aria-label="Checklist progress">
        <div className="flex min-w-[240px] flex-1 flex-col gap-1.5">
          {c.completion === null ? (
            <b className="text-[13px] text-ink">{c.items.length ? 'Nothing on this checklist is marked required.' : 'No checklist yet.'}</b>
          ) : (
            <>
              <span className="flex items-baseline gap-2">
                <b className="text-[20px] text-ink tabular-nums">{c.completion}%</b>
                <span className="text-[12.5px] text-ink-2">
                  {c.counts.required - outstanding} of {c.counts.required} required {c.counts.required === 1 ? 'line is' : 'lines are'} ready
                </span>
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-subtle" title={c.basis}>
                <span className={cx('block h-full rounded-full', c.completion >= 100 ? 'bg-success' : 'bg-primary')} style={{ width: `${Math.min(100, c.completion)}%` }} />
              </span>
            </>
          )}
          <span className="text-[11.5px] text-ink-3">{c.completion === null ? 'Add the buyer’s requirements before relying on the pipeline to stop an incomplete bid.' : c.basis}</span>
        </div>
        {canManage ? (
          <div className="flex shrink-0 gap-2">
            {c.packs.length ? (
              <button type="button" className={btn} onClick={() => setPacks(true)}>
                <Icon name="list-todo" size={15} /> Add a standard pack…
              </button>
            ) : null}
            <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
              <Icon name="plus" size={15} /> Add a line
            </button>
          </div>
        ) : null}
      </section>

      {c.items.length ? (
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Show">
          {FILTERS.map(([f, label]) => {
            const n = f === 'all' ? c.items.length : f === 'outstanding' ? outstanding : f === 'optional' ? c.counts.optional : c.counts[f as keyof typeof c.counts];
            if (f !== 'all' && !n) return null;
            return (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => (setFilter(f), setPicked([]))}
                className={cx(
                  'h-7 rounded-[14px] border px-2.5 text-[12px] font-semibold',
                  filter === f ? 'border-primary bg-selection text-primary' : 'border-line bg-surface text-ink-2 hover:bg-subtle',
                  f === 'outstanding' && filter !== f && 'text-[#9A4A06] dark:text-warning',
                  f === 'rejected' && filter !== f && 'text-danger',
                )}
              >
                {label} <span className="tabular-nums">{n}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {picked.length ? (
        <div className="flex items-center gap-2 self-start rounded-[9px] border border-[#C7D0F5] bg-[#EEF1FC] px-2.5 py-1.5 dark:border-primary/40 dark:bg-selection">
          <b className="text-[12.5px] text-primary">{picked.length} selected</b>
          {canApprove ? (
            <button type="button" className={btnSmall + ' !h-7'} disabled={busy !== null} onClick={() => void act('bulk', () => bulkLines(id, 'approve', picked), 'Approved — lines with nothing on file were left.').then((ok) => ok && setPicked([]))}>
              Approve
            </button>
          ) : null}
          {canManage ? (
            <button type="button" className={btnSmall + ' !h-7 !text-danger'} disabled={busy !== null} onClick={() => void act('bulk', () => bulkLines(id, 'remove', picked), 'Removed.').then((ok) => ok && setPicked([]))}>
              Remove
            </button>
          ) : null}
          <button type="button" className="text-[12px] font-semibold text-primary hover:underline" onClick={() => setPicked([])}>
            Clear the selection
          </button>
        </div>
      ) : null}

      <Uploading live={uploads.live} />

      {!c.items.length ? (
        <div className="rounded-[12px] border border-line bg-surface">
          <Empty text={canManage ? 'Nothing on the checklist. Add the buyer’s requirements one by one, or start from a standard pack.' : 'Nothing on the checklist yet.'} />
        </div>
      ) : !shown.length ? (
        <div className="rounded-[12px] border border-line bg-surface">
          <Empty text="Nothing here with that filter." />
        </div>
      ) : (
        sectionsOf(shown).map((s, si) => (
          <section key={`${s.name}-${si}`} aria-label={s.name} className="overflow-hidden rounded-[12px] border border-line bg-surface">
            <div className="flex items-center gap-2 border-b border-line bg-ground px-3.5 py-2">
              {choosable ? (
                <input
                  type="checkbox"
                  aria-label={`Choose every line in ${s.name}`}
                  checked={s.lines.every((l) => picked.includes(l.id))}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...new Set([...p, ...s.lines.map((l) => l.id)])] : p.filter((x) => !s.lines.some((l) => l.id === x))))}
                  className="accent-primary"
                />
              ) : null}
              <b className="text-[11.5px] font-bold tracking-[.4px] text-ink-3 uppercase">{s.name}</b>
            </div>
            {s.lines.map((l) => (
              <LineRow
                key={l.id}
                l={l}
                chosen={picked.includes(l.id)}
                onChoose={choosable ? () => setPicked((p) => (p.includes(l.id) ? p.filter((x) => x !== l.id) : [...p, l.id])) : null}
                canManage={canManage}
                canApprove={canApprove}
                can={can}
                busy={busy}
                showHistory={history === l.id}
                onHistory={() => setHistory((h) => (h === l.id ? null : l.id))}
                onAttach={() => void uploads.pick({ into: 'line', id: l.id }, `Attach to ${l.label}`.slice(0, 100))}
                onDropFiles={canManage && can.upload ? (files) => void uploads.drop(files.slice(0, 1), { into: 'line', id: l.id }) : null}
                onDrive={async (files) => {
                  const f = files[0];
                  if (f) await act(`attach:${l.id}`, () => attachToLine(l.id, Number(f.id), f.name), 'Attached.');
                }}
                onApprove={() => void act(`review:${l.id}`, () => reviewLine(l.id, 'approved'), 'Approved.')}
                onSendBack={() => setSending(l)}
                onEdit={() => setEditing(l)}
                onRemove={() => void act(`remove:${l.id}`, () => removeLine(l.id), 'Removed.')}
              />
            ))}
          </section>
        ))
      )}

      {editing ? <LineSheet tenderId={id} org={org} line={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
      {sending ? <SendBackSheet line={sending} onClose={() => setSending(null)} onSaved={refresh} /> : null}
      {packs ? <PackSheet tenderId={id} packs={c.packs} onClose={() => setPacks(false)} onSaved={refresh} /> : null}
    </div>
  );
}

function LineRow({
  l,
  chosen,
  onChoose,
  canManage,
  canApprove,
  can,
  busy,
  showHistory,
  onHistory,
  onAttach,
  onDropFiles,
  onDrive,
  onApprove,
  onSendBack,
  onEdit,
  onRemove,
}: {
  l: Line;
  chosen: boolean;
  onChoose: (() => void) | null;
  canManage: boolean;
  canApprove: boolean;
  can: DocAccess;
  busy: string | null;
  showHistory: boolean;
  onHistory: () => void;
  onAttach: () => void;
  /** A file dropped on the line, filed as its next version. */
  onDropFiles: ((files: File[]) => void) | null;
  onDrive: (files: Array<{ id: number | string; name: string }>) => Promise<void>;
  onApprove: () => void;
  onSendBack: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const current = l.files.find((f) => f.current) ?? null;
  const st = LINE_STATUS[l.status];
  const reviewable = l.status === 'uploaded' || l.status === 'pending_review' || l.status === 'approved';
  const zone = useDropZone(!!onDropFiles, (files) => onDropFiles?.(files));
  return (
    <div
      data-line={l.id}
      {...zone.props}
      className={cx('flex flex-col gap-1 border-b border-line/60 px-3.5 py-2.5 text-[12.5px] last:border-b-0', chosen && 'bg-[#F4F6FE] dark:bg-selection/40', zone.over && 'bg-selection outline-2 -outline-offset-2 outline-primary outline-dashed')}
    >
      <div className="flex items-start gap-2.5">
        {onChoose ? <input type="checkbox" aria-label={`Choose ${l.label}`} checked={chosen} onChange={onChoose} className="mt-1 accent-primary" /> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-1.5">
            <b className="text-[13px] text-ink">{l.label}</b>
            {l.mandatory ? <Pill tone="blue">Required</Pill> : <Pill>Optional</Pill>}
            <Pill tone={st.tone}>{st.label}</Pill>
            {l.library ? <Pill tone="green">From the company library</Pill> : null}
          </span>
          {l.detail ? <span className="text-ink-2">{l.detail}</span> : null}
          {l.status === 'rejected' && l.rejection_reason ? (
            <span className="text-danger">
              Sent back{l.reviewer_name ? ` by ${l.reviewer_name}` : ''}: {l.rejection_reason}
            </span>
          ) : l.mandatory && !l.settled && l.why_not ? (
            <span className="text-[#9A4A06] dark:text-warning">{l.why_not}</span>
          ) : null}
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-ink-3">
            {current ? (
              <button
                type="button"
                disabled={!can.download}
                title={can.download ? 'Open it' : 'You may not take copies of tender documents'}
                onClick={() => void saveTenderFile({ tenderLine: { line: l.id } }, current.name ?? l.label, true)}
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline disabled:text-ink-3 disabled:no-underline"
              >
                <Icon name="file" size={12} /> {current.name ?? 'The file'}
                {l.files.length > 1 ? <span className="font-medium text-ink-3"> · v{current.version}</span> : null}
              </button>
            ) : null}
            {l.files.length > 1 ? (
              <button type="button" onClick={onHistory} className="hover:underline">
                {showHistory ? 'Hide earlier versions' : `${l.files.length - 1} earlier ${l.files.length === 2 ? 'version' : 'versions'}`}
              </button>
            ) : null}
            {l.owner_name ? <span>Chased by {l.owner_name}</span> : null}
            {l.expires_on ? <span className={cx(l.mandatory && !l.settled && 'text-danger')}>Expires {dayWords(l.expires_on, { year: true })}</span> : null}
            {l.reviewer_name && l.status === 'approved' ? (
              <span>
                Approved by {l.reviewer_name}
                {l.reviewed_at ? ` ${relative(l.reviewed_at)}` : ''}
              </span>
            ) : null}
            {l.note ? <span className="italic">{l.note}</span> : null}
          </span>
          {showHistory ? (
            <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 rounded-[8px] bg-subtle px-2.5 py-1.5 text-[11.5px]" aria-label="Earlier versions">
              {l.files
                .filter((f) => !f.current)
                .map((f) => (
                  <li key={f.id} className="flex items-center gap-2">
                    <span className="w-8 shrink-0 text-ink-3 tabular-nums">v{f.version}</span>
                    <button
                      type="button"
                      disabled={!can.download}
                      onClick={() => void saveTenderFile({ tenderLine: { line: l.id, version: f.id } }, f.name ?? `${l.label} v${f.version}`, true)}
                      className="min-w-0 flex-1 truncate text-left text-primary hover:underline disabled:text-ink-3"
                    >
                      {f.name ?? 'The file'}
                    </button>
                    <span className="text-ink-3">{f.uploaded_at ? dateLabel(f.uploaded_at) : ''}</span>
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {canManage && can.upload ? <AttachMenu small label={current ? 'New version' : 'Attach'} disabled={busy !== null} onComputer={onAttach} onDrive={onDrive} /> : null}
          {canApprove && reviewable && l.status !== 'approved' ? (
            <button type="button" className={btnSmall + ' !h-7 !border-[#9BD3B3] !text-[#145C39] dark:!text-success'} disabled={busy !== null} onClick={onApprove}>
              Approve
            </button>
          ) : null}
          {canApprove && reviewable ? (
            <button type="button" className={btnSmall + ' !h-7'} disabled={busy !== null} onClick={onSendBack}>
              Send back…
            </button>
          ) : null}
          {canManage ? (
            <button type="button" aria-label={`Edit ${l.label}`} title="Edit" className={btnSmall + ' !h-7 !w-7 justify-center !px-0'} onClick={onEdit}>
              <Icon name="compose" size={13} />
            </button>
          ) : null}
          {canManage ? (
            <button type="button" aria-label={`Remove ${l.label}`} title="Remove" className={btnSmall + ' !h-7 !w-7 justify-center !px-0 !text-danger'} disabled={busy !== null} onClick={onRemove}>
              <Icon name="trash" size={13} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LineSheet({ tenderId, org, line, onClose, onSaved }: { tenderId: number; org: string; line: Line | null; onClose: () => void; onSaved: () => void }) {
  const before: LineDraft = line ? lineDraft(line) : { label: '', section: '', detail: '', note: '', mandatory: true, owner: '', issued_on: '', expires_on: '' };
  const [d, setD] = useState<LineDraft>(before);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owners = useOwners(org);
  const changes = line ? lineChanges(before, d) : null;
  const save = async () => {
    if (!d.label.trim()) return setError('Give the line a name.');
    setBusy(true);
    setError(null);
    try {
      if (line) {
        if (changes && Object.keys(changes).length) await updateLine(line.id, changes);
      } else {
        await addLine(tenderId, { label: d.label.trim(), ...(d.section.trim() ? { section: d.section.trim() } : {}), ...(d.detail.trim() ? { detail: d.detail.trim() } : {}), mandatory: d.mandatory });
      }
      toast('success', line ? 'Saved.' : 'Line added.');
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof LineDraft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  return (
    <Sheet
      title={line ? 'Edit the line' : 'Add a line'}
      width={520}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !d.label.trim() || (!!line && !Object.keys(changes ?? {}).length)} onClick={() => void save()}>
            {busy ? 'Saving…' : line ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      <Field label="What the buyer asks for">
        <input aria-label="What the buyer asks for" autoFocus value={d.label} onChange={set('label')} maxLength={200} placeholder="Tax clearance certificate" className={input} />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Section">
          <input aria-label="Section" value={d.section} onChange={set('section')} maxLength={120} placeholder="B. Eligibility" className={input} />
        </Field>
        <label className="flex items-center gap-2 pt-5 text-[12.5px] font-semibold text-ink">
          <input type="checkbox" checked={d.mandatory} onChange={(e) => setD({ ...d, mandatory: e.target.checked })} className="accent-primary" />
          Required — the bid cannot go out without it
        </label>
      </div>
      <Field label="Detail">
        <input aria-label="Detail" value={d.detail} onChange={set('detail')} maxLength={500} placeholder="Certified copy, issued within the last three months" className={input} />
      </Field>
      {line ? (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Chased by">
              <Select<string>
                aria-label="Chased by"
                searchable
                value={d.owner}
                onValueChange={(v) => setD({ ...d, owner: v })}
                options={[{ value: '', label: 'Nobody yet' }, ...(owners.data ?? []).filter((o) => o.holds || String(o.id) === d.owner).map((o) => ({ value: String(o.id), label: o.name }))]}
                className={input}
              />
            </Field>
            <Field label="Note">
              <input aria-label="Note" value={d.note} onChange={set('note')} maxLength={500} className={input} />
            </Field>
            <Field label="Issued on">
              <input type="date" aria-label="Issued on" value={d.issued_on} onChange={set('issued_on')} className={input} />
            </Field>
            <Field label="Expires on" hint="A line past its expiry stops counting as ready.">
              <input type="date" aria-label="Expires on" value={d.expires_on} onChange={set('expires_on')} className={input} />
            </Field>
          </div>
          {line.mandatory && !d.mandatory && !line.settled ? <p className="m-0 text-[12px] text-[#9A4A06] dark:text-warning">This line is required and not yet satisfied. Making it optional needs the approval permission.</p> : null}
        </>
      ) : null}
      {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
    </Sheet>
  );
}

function SendBackSheet({ line, onClose, onSaved }: { line: Line; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    try {
      await reviewLine(line.id, 'rejected', reason.trim());
      toast('success', 'Sent back.');
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Send back ${line.label}`}
      width={480}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary + ' !bg-danger hover:!opacity-90'} disabled={busy || !reason.trim()} onClick={() => void go()}>
            {busy ? 'Sending…' : 'Send back'}
          </button>
        </>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">Whoever redoes it sees this. The line stops counting as ready until a corrected document is attached — attaching the same file again is refused.</p>
      <Field label="What is wrong with it?">
        <input aria-label="What is wrong with it?" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="The certificate expired in August; attach the renewed one." className={input} />
      </Field>
      {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
    </Sheet>
  );
}

function PackSheet({ tenderId, packs, onClose, onSaved }: { tenderId: number; packs: Array<{ key: string; label: string; blurb: string; lines: number }>; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const go = async (key: string) => {
    setBusy(key);
    try {
      const r = await applyPack(tenderId, key);
      toast('success', `${r.added} ${r.added === 1 ? 'line' : 'lines'} added${r.linked ? `, ${r.linked} satisfied from the company library` : ''}.${r.skipped ? ` ${r.skipped} were already on the list.` : ''}`);
      onSaved();
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet
      title="Add a standard pack"
      width={500}
      onClose={onClose}
      footer={
        <button type="button" className={btn} onClick={onClose}>
          Close
        </button>
      }
    >
      <p className="m-0 text-[13px] text-ink-2">Lines already on the checklist are left as they are, and anything the company library already holds is filed against its line.</p>
      {packs.map((p) => (
        <div key={p.key} className="flex items-center gap-3 rounded-[10px] border border-line px-3 py-2.5">
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="text-[13px] text-ink">{p.label}</b>
            <span className="text-[12px] text-ink-3">
              {p.blurb} · {p.lines} lines
            </span>
          </span>
          <button type="button" className={btnPrimary} disabled={busy !== null} onClick={() => void go(p.key)}>
            {busy === p.key ? 'Adding…' : 'Add'}
          </button>
        </div>
      ))}
    </Sheet>
  );
}
