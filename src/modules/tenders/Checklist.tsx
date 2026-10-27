import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { dateLabel, dayWords, relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, Sheet } from '../../components/PageKit';
import { Pill } from '../../components/ListKit';
import { BLANK, fetchList, K, useOwners, type DocAccess } from './api';
import { ReviewScreen } from './Review';
import { notifiedNote, reviewMessage, reviewRecipients, tellInChat, usePeople } from './people';
import { AttachMenu, saveTenderFile, UploadBar, Uploading, uploadsFor, useDropZone, useTenderUploads, type LiveUpload } from './files';
import { addLine, applyPack, attachToLine, bulkLines, fetchChecklist, filterLines, importPlan, K2, LINE_STATUS, lineChanges, lineDraft, removeLine, reviewLine, sectionsOf, sectionTemplates, updateLine, type Line, type LineDraft, type LineFilter } from './work';
import { Checkbox } from '../../components/Checkbox';

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
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [history, setHistory] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState<number | null>(null);
  // A section renamed or deleted from its heading: sections are the name the lines carry, so both act on every line in it.
  const [sectioning, setSectioning] = useState<{ name: string | null; mode: 'rename' | 'delete' } | null>(null);
  const nameOf = usePeople();
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
            <button type="button" className={btn} onClick={() => setImporting(true)}>
              <Icon name="history" size={15} /> Import sections…
            </button>
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
                  f === 'outstanding' && filter !== f && 'text-warning-ink dark:text-warning',
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
        <div className="flex items-center gap-2 self-start rounded-[9px] border border-info-line bg-selection px-2.5 py-1.5 dark:border-primary/40 dark:bg-selection">
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

      {/* A line's own uploads show on the line; the rest here. */}
      <Uploading live={uploads.live.filter((t) => t.target.into !== 'line')} />

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
                <Checkbox
                  aria-label={`Choose every line in ${s.name}`}
                  checked={s.lines.every((l) => picked.includes(l.id))}
                  indeterminate={s.lines.some((l) => picked.includes(l.id)) && !s.lines.every((l) => picked.includes(l.id))}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...new Set([...p, ...s.lines.map((l) => l.id)])] : p.filter((x) => !s.lines.some((l) => l.id === x))))}
                />
              ) : null}
              <b className="min-w-0 flex-1 truncate text-[11.5px] font-bold tracking-[.4px] text-ink-3 uppercase">{s.name}</b>
              {canManage ? (
                <span className="flex shrink-0 items-center gap-0.5">
                  <button type="button" aria-label={`Rename section ${s.name}`} title="Rename section" onClick={() => setSectioning({ name: s.lines[0]?.section ?? null, mode: 'rename' })} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink">
                    <Icon name="compose" size={13} />
                  </button>
                  {s.lines[0]?.section ? (
                    <button type="button" aria-label={`Delete section ${s.name}`} title="Delete section" onClick={() => setSectioning({ name: s.lines[0]?.section ?? null, mode: 'delete' })} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-danger-bg hover:text-danger">
                      <Icon name="trash" size={13} />
                    </button>
                  ) : null}
                </span>
              ) : null}
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
                uploading={uploadsFor(uploads.live, 'line', l.id)}
                uploaderName={nameOf(l.files.find((f) => f.current)?.uploaded_by)}
                onReview={() => setReviewing(l.id)}
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

      {editing ? <LineSheet tenderId={id} org={org} line={editing === 'new' ? null : editing} sections={sectionNames(c.items)} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
      {sectioning ? <SectionSheet tenderId={id} name={sectioning.name} mode={sectioning.mode} lines={c.items.filter((l) => (l.section ?? null) === sectioning.name)} taken={sectionNames(c.items)} onClose={() => setSectioning(null)} onSaved={refresh} /> : null}
      {sending ? <SendBackSheet tenderId={id} line={sending} nameOf={nameOf} serverTells={c.notifies} onClose={() => setSending(null)} onSaved={refresh} /> : null}
      {reviewing !== null ? <ReviewScreen tenderId={id} lines={c.items} startId={reviewing} canApprove={canApprove} canDownload={can.download} serverTells={c.notifies} onClose={() => setReviewing(null)} onChanged={refresh} /> : null}
      {importing ? <ImportSheet tenderId={id} org={org} existing={c.items} onClose={() => setImporting(false)} onSaved={refresh} /> : null}
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
  uploading,
  uploaderName,
  onReview,
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
  /** Files on their way to this line, each shown with its progress bar. */
  uploading: LiveUpload[];
  /** Who uploaded the current file, by name, when the directory says. */
  uploaderName: string | null;
  /** Open the file in the reviewer, inside WorkSuite. */
  onReview: () => void;
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
      className={cx('flex flex-col gap-1 border-b border-line/60 px-3.5 py-2.5 text-[12.5px] last:border-b-0', chosen && 'bg-info-soft dark:bg-selection/40', zone.over && 'bg-selection outline-2 -outline-offset-2 outline-primary outline-dashed')}
    >
      <div className="flex items-start gap-2.5">
        {onChoose ? <Checkbox aria-label={`Choose ${l.label}`} checked={chosen} onChange={onChoose} className="mt-1" /> : null}
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
            <span className="text-warning-ink dark:text-warning">{l.why_not}</span>
          ) : null}
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-ink-3">
            {current ? (
              <button
                type="button"
                disabled={!can.download}
                title={can.download ? 'Review it here' : 'You may not take copies of tender documents'}
                onClick={onReview}
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline disabled:text-ink-3 disabled:no-underline"
              >
                <Icon name="file" size={12} /> {current.name ?? 'The file'}
                {l.files.length > 1 ? <span className="font-medium text-ink-3"> · v{current.version}</span> : null}
              </button>
            ) : null}
            {current && (uploaderName || current.uploaded_at) ? (
              <span>
                Uploaded{uploaderName ? ` by ${uploaderName}` : ''}
                {current.uploaded_at ? ` ${relative(current.uploaded_at)}` : ''}
              </span>
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
          {uploading.length ? (
            <div className="mt-1.5 flex max-w-[520px] flex-col gap-1.5">
              {uploading.map((t) => (
                <UploadBar key={t.id} t={t} />
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {canManage && can.upload ? <AttachMenu small label={current ? 'New version' : 'Attach'} disabled={busy !== null} onComputer={onAttach} onDrive={onDrive} /> : null}
          {canApprove && reviewable && l.status !== 'approved' ? (
            <button type="button" className={btnSmall + ' !h-7 !border-success-line !text-success-ink dark:!text-success'} disabled={busy !== null} onClick={onApprove}>
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

/** The sections this tender's lines are in, in the order they first appear. */
function sectionNames(lines: Line[]): string[] {
  return [...new Set(lines.map((l) => l.section).filter((x): x is string => !!x && !!x.trim()))];
}

const NEW_SECTION = '\u0000new';

/**
 * A line's section: one this tender already has, none, or a new one named here. It was a free text box, so the same
 * section typed twice a little differently ("B. Eligibility" and "B Eligibility") split the checklist in two.
 */
export function SectionPicker({ value, sections, onChange }: { value: string; sections: string[]; onChange: (v: string) => void }) {
  const known = !value || sections.includes(value);
  const [typing, setTyping] = useState(!known);
  if (typing) {
    return (
      <div className="flex gap-1.5">
        <input aria-label="New section name" autoFocus value={value} onChange={(e) => onChange(e.target.value)} maxLength={120} placeholder="B. Eligibility" className={cx(input, 'min-w-0 flex-1')} />
        {sections.length ? (
          <button type="button" className={btnSmall} onClick={() => { setTyping(false); onChange(''); }}>
            Pick one
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <Select<string>
      aria-label="Section"
      value={value}
      onValueChange={(v) => (v === NEW_SECTION ? (setTyping(true), onChange('')) : onChange(v))}
      options={[{ value: '', label: 'No section' }, ...sections.map((x) => ({ value: x, label: x })), { value: NEW_SECTION, label: 'New section…' }]}
      className={input}
    />
  );
}

/** Rename a section (every line in it), or delete it: its lines kept without a section, or removed with it. */
export function SectionSheet({ tenderId, name, mode, lines, taken, onClose, onSaved }: { tenderId: number; name: string | null; mode: 'rename' | 'delete'; lines: Line[]; taken: string[]; onClose: () => void; onSaved: () => void }) {
  const [next, setNext] = useState(name ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = name ?? 'Other';
  const n = lines.length;
  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      toast('success', done);
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const moveAll = (section: string) => Promise.all(lines.map((l) => updateLine(l.id, { section })));
  const clash = mode === 'rename' && next.trim() !== (name ?? '') && taken.includes(next.trim());
  if (mode === 'rename') {
    return (
      <Sheet
        title="Rename section"
        width={440}
        onClose={onClose}
        footer={
          <>
            <button type="button" className={btn} onClick={onClose}>Cancel</button>
            <button type="button" className={btnPrimary} disabled={busy !== null || !next.trim() || next.trim() === (name ?? '')} onClick={() => void run('rename', () => moveAll(next.trim()), clash ? `Moved into ${next.trim()}.` : 'Section renamed.')}>
              {busy ? 'Saving…' : clash ? 'Merge' : 'Rename'}
            </button>
          </>
        }
      >
        <Field label="Section name">
          <input aria-label="Section name" autoFocus value={next} onChange={(e) => setNext(e.target.value)} maxLength={120} className={input} />
        </Field>
        <p className="text-[12px] text-ink-3">
          {clash ? `A section called ${next.trim()} already exists: its ${n} line${n === 1 ? '' : 's'} will join it.` : `Renames it on ${n === 1 ? 'its line' : `all ${n} of its lines`}.`}
        </p>
        {error ? <p role="alert" className="text-[12.5px] text-danger">{error}</p> : null}
      </Sheet>
    );
  }
  return (
    <Sheet
      title={`Delete section ${label}?`}
      width={460}
      onClose={onClose}
      footer={<button type="button" className={btn} onClick={onClose}>Cancel</button>}
    >
      <p className="text-[12.5px] text-ink-2">{`It has ${n} line${n === 1 ? '' : 's'}. Keep ${n === 1 ? 'it' : 'them'} on the checklist without a section, or delete ${n === 1 ? 'it' : 'them'} with the section.`}</p>
      <div className="flex flex-col gap-2">
        <button type="button" className={btn} disabled={busy !== null} onClick={() => void run('keep', () => moveAll(''), 'Section deleted; its lines are kept.')}>
          {busy === 'keep' ? 'Saving…' : `Keep the ${n === 1 ? 'line' : `${n} lines`}, without a section`}
        </button>
        <button type="button" className={cx(btn, 'border-danger text-danger hover:bg-danger-bg')} disabled={busy !== null} onClick={() => void run('remove', () => bulkLines(tenderId, 'remove', lines.map((l) => l.id)), 'Section and its lines deleted.')}>
          {busy === 'remove' ? 'Deleting…' : `Delete the section and its ${n === 1 ? 'line' : `${n} lines`}`}
        </button>
      </div>
      {error ? <p role="alert" className="text-[12.5px] text-danger">{error}</p> : null}
    </Sheet>
  );
}

function LineSheet({ tenderId, org, line, sections, onClose, onSaved }: { tenderId: number; org: string; line: Line | null; sections: string[]; onClose: () => void; onSaved: () => void }) {
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
          <SectionPicker value={d.section} sections={sections} onChange={(v) => setD({ ...d, section: v })} />
        </Field>
        <label className="flex items-center gap-2 pt-5 text-[12.5px] font-semibold text-ink">
          <Checkbox checked={d.mandatory} onChange={(e) => setD({ ...d, mandatory: e.target.checked })} />
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
          {line.mandatory && !d.mandatory && !line.settled ? <p className="m-0 text-[12px] text-warning-ink dark:text-warning">This line is required and not yet satisfied. Making it optional needs the approval permission.</p> : null}
        </>
      ) : null}
      {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
    </Sheet>
  );
}

function SendBackSheet({ tenderId, line, nameOf, serverTells, onClose, onSaved }: { tenderId: number; line: Line; nameOf: (id: number | null | undefined) => string | null; serverTells: boolean; onClose: () => void; onSaved: () => void }) {
  const me = useStore(app, (s) => (s.auth?.user?.id ? Number(s.auth.user.id) : null));
  const current = line.files.find((f) => f.current) ?? null;
  const tellIds = reviewRecipients(current?.uploaded_by ?? null, line.owner_id, me);
  const tellNames = tellIds.map((u) => (u === current?.uploaded_by ? nameOf(u) : (nameOf(u) ?? line.owner_name)) ?? 'a colleague');
  const [tell, setTell] = useState(!serverTells);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    try {
      const r0 = await reviewLine(line.id, 'rejected', reason.trim());
      let told = notifiedNote(r0.notified, (u) => nameOf(u) ?? (u === line.owner_id ? line.owner_name : null));
      if (tell && tellIds.length) {
        const r = await tellInChat(tellIds, reviewMessage({ decision: 'rejected', line: line.label, file: current?.name ?? null, comment: reason.trim(), tenderId }));
        told += r.sent ? ` ${tellNames.slice(0, r.sent).join(' and ')} ${r.sent === 1 ? 'was' : 'were'} told in Chat.` : '';
        if (r.failed) toast('warning', 'Sent back, but a Chat message could not be sent.');
      }
      toast('success', `Sent back.${told}`);
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
      {tellIds.length && serverTells ? (
        <p className="m-0 text-[12.5px] text-ink-2">
          {tellNames.join(' and ')} {tellNames.length === 1 ? 'is' : 'are'} notified with what is wrong — in the bell, on their phone and desktop, and by email.
        </p>
      ) : null}
      {tellIds.length ? (
        <label className="flex items-start gap-2 text-[12.5px] text-ink-2">
          <Checkbox checked={tell} onChange={(e) => setTell(e.target.checked)} className="mt-0.5" />
          <span>
            {serverTells ? `Also message ${tellNames.join(' and ')} in Team Chat` : `Tell ${tellNames.join(' and ')} in Chat`}
            <span className="block text-[11.5px] text-ink-3">With what is wrong and a link to this tender.</span>
          </span>
        </label>
      ) : null}
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

/** Sections copied from an earlier tender: pick the tender, tick its sections, and their lines are added here. */
export function ImportSheet({ tenderId, org, existing, onClose, onSaved }: { tenderId: number; org: string; existing: Line[]; onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState<{ id: number; title: string } | null>(null);
  const [chosen, setChosen] = useState<Array<string | null> | null>(null);
  const [busy, setBusy] = useState<{ done: number; of: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['tenders', 'import-from', org, q.trim()],
    queryFn: ({ signal }) => fetchList(org, { ...BLANK, q: q.trim(), sort: 'updated', dir: 'desc' }, signal),
    enabled: !from,
  });
  const old = useQuery({ queryKey: K2.checklist(from?.id ?? 0), queryFn: ({ signal }) => fetchChecklist(from!.id, signal), enabled: !!from });
  const templates = old.data ? sectionTemplates(old.data.items) : [];
  const picked = chosen ?? templates.map((t) => t.name);
  const plan = old.data ? importPlan(old.data.items, picked, existing) : { add: [], skipped: 0 };
  const go = async () => {
    setError(null);
    setBusy({ done: 0, of: plan.add.length });
    try {
      // One at a time, so the lines keep the earlier tender's order.
      for (const [i, body] of plan.add.entries()) {
        await addLine(tenderId, body);
        setBusy({ done: i + 1, of: plan.add.length });
      }
      toast('success', `${plan.add.length} ${plan.add.length === 1 ? 'line' : 'lines'} imported.${plan.skipped ? ` ${plan.skipped} already on the list.` : ''}`);
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      onSaved();
    } finally {
      setBusy(null);
    }
  };
  const toggle = (name: string | null) => setChosen(picked.includes(name) ? picked.filter((x) => x !== name) : [...picked, name]);
  return (
    <Sheet
      title="Import sections from a tender"
      width={520}
      onClose={onClose}
      footer={
        <>
          {from ? (
            <button type="button" className={btn} disabled={!!busy} onClick={() => (setFrom(null), setChosen(null))}>
              Back
            </button>
          ) : null}
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          {from ? (
            <button type="button" className={btnPrimary} disabled={!!busy || !plan.add.length} onClick={() => void go()}>
              {busy ? `Importing ${busy.done} of ${busy.of}…` : `Import ${plan.add.length} ${plan.add.length === 1 ? 'line' : 'lines'}`}
            </button>
          ) : null}
        </>
      }
    >
      {!from ? (
        <>
          <input aria-label="Find a tender" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, reference or buyer" className={input} />
          {list.isLoading ? <Spinner /> : list.error ? <ErrorNote error={list.error} onRetry={() => void list.refetch()} /> : null}
          <div className="flex flex-col gap-1.5" role="list" aria-label="Tenders">
            {(list.data?.items ?? [])
              .filter((t) => t.id !== tenderId)
              .map((t) => (
                <button key={t.id} type="button" role="listitem" className="flex flex-col items-start rounded-[10px] border border-line px-3 py-2 text-left hover:bg-subtle" onClick={() => setFrom({ id: t.id, title: t.title })}>
                  <b className="text-[13px] text-ink">{t.title}</b>
                  <span className="text-[12px] text-ink-3">{[t.reference, t.organization ?? t.client_name, t.stage_label].filter(Boolean).join(' · ')}</span>
                </button>
              ))}
            {list.data && !list.data.items.some((t) => t.id !== tenderId) ? <p className="text-[12.5px] text-ink-3">No other tender matches.</p> : null}
          </div>
        </>
      ) : (
        <>
          <p className="m-0 text-[13px] text-ink-2">
            From <b className="text-ink">{from.title}</b>. Requirements, sections, details and whether each is required are copied; files and review status are not.
          </p>
          {old.isLoading ? <Spinner /> : old.error ? <ErrorNote error={old.error} onRetry={() => void old.refetch()} /> : null}
          {old.data && !templates.length ? <p className="text-[12.5px] text-ink-3">That tender has no checklist yet.</p> : null}
          <div className="flex flex-col gap-1.5">
            {templates.map((t) => (
              <label key={t.name ?? ''} className="flex items-center gap-2.5 rounded-[10px] border border-line px-3 py-2">
                <Checkbox aria-label={`Import ${t.name ?? 'Other'}`} checked={picked.includes(t.name)} onChange={() => toggle(t.name)} />
                <span className="min-w-0 flex-1 text-[13px] text-ink">{t.name ?? 'Other'}</span>
                <span className="text-[12px] text-ink-3 tabular-nums">
                  {t.count} {t.count === 1 ? 'line' : 'lines'}
                </span>
              </label>
            ))}
          </div>
          {plan.skipped ? <p className="text-[12px] text-ink-3">{`${plan.skipped} ${plan.skipped === 1 ? 'line is' : 'lines are'} already on this checklist and will be left as they are.`}</p> : null}
        </>
      )}
      {error ? <p role="alert" className="text-[12.5px] text-danger">{error}</p> : null}
    </Sheet>
  );
}
