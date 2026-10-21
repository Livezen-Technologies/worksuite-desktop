import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { officeRoute } from '@shared/office';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { navigate } from '../../core/tabs';
import { bytes, dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Checkbox } from '../../components/Checkbox';
import { cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Sheet } from '../hr/parts';
import { Pill } from '../inventory/parts';
import type { TenderDoc } from './api';
import { saveTenderFile } from './files';
import { diffLines, diffStats, sideBySide } from './lineDiff';
import { compareVersions, documentOnline, documentVersions, restoreVersion, versionFileName, type DocVersion } from './versions';

/**
 * Edit online / Open online for a tender document: asks the server what this
 * reader may do (`/online`) and opens the document's Drive file in the Office
 * tab — the same tab Drive opens — in that mode.
 */
export async function openDocumentOnline(d: Pick<TenderDoc, 'id' | 'title'>): Promise<void> {
  try {
    const o = await documentOnline(d.id);
    if (!o.online || !o.file_id || !o.mode) return void toast('error', o.reason ?? `${d.title} cannot be opened online.`);
    // The tab Drive opens (files/office.ts openOfficeTab): the one already open, in any window, or a new one.
    const elsewhere = await call('office:focusFile', { fileId: o.file_id }).catch(() => false);
    if (!elsewhere) navigate(officeRoute(o.file_id, { mode: o.mode, name: o.name || d.title }), app.get().organizationId);
  } catch (e) {
    toast('error', errorMessage(e));
  }
}

/**
 * A tender document's versions: every save of the online editor, every
 * Replace and every restore. View or save any of them, compare two side by
 * side, or restore one — it becomes the newest version, so nothing is lost.
 * The buttons follow the server's `can`.
 */
export function DocumentVersions({ doc, onClose, onChanged }: { doc: TenderDoc; onClose: () => void; onChanged: () => void }) {
  const q = useQuery({ queryKey: ['tenders', 'doc-versions', doc.id], queryFn: () => documentVersions(doc.id) });
  const [picked, setPicked] = useState<number[]>([]);
  const [comparing, setComparing] = useState<[number, number] | null>(null);
  const [restoring, setRestoring] = useState<DocVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const name = doc.file?.download_name ?? doc.title;
  const data = q.data;
  const toggle = (v: number) => setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p.slice(-1), v]));
  const file = (v: DocVersion, open: boolean) => void saveTenderFile({ tenderDocument: doc.id, tenderDocumentVersion: v.version }, versionFileName(name, v.version), open);
  const restore = async (v: DocVersion) => {
    setBusy(true);
    try {
      const now = await restoreVersion(doc.id, v.version);
      toast('success', `Version ${v.version} restored as version ${now}.`);
      setRestoring(null);
      setPicked([]);
      void q.refetch();
      onChanged();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={`Versions of ${doc.title}`}
      width={comparing ? 960 : 560}
      onClose={onClose}
      footer={
        comparing ? (
          <button type="button" className={btn} onClick={() => setComparing(null)}>
            Back to versions
          </button>
        ) : (
          <>
            {data?.comparable && data.can.view ? (
              <button type="button" className={btn} disabled={picked.length !== 2} onClick={() => setComparing([Math.min(...picked), Math.max(...picked)] as [number, number])}>
                Compare {picked.length === 2 ? `v${Math.min(...picked)} and v${Math.max(...picked)}` : 'two versions'}
              </button>
            ) : null}
            <button type="button" className={btnPrimary} onClick={onClose}>
              Done
            </button>
          </>
        )
      }
    >
      {q.isPending ? (
        <p className="m-0 text-[12.5px] text-ink-3">Loading the versions…</p>
      ) : q.isError ? (
        <p className="m-0 text-[12.5px] text-danger">{errorMessage(q.error)}</p>
      ) : comparing ? (
        <Compare docId={doc.id} from={comparing[0]} to={comparing[1]} />
      ) : !data?.versions.length ? (
        <Empty text="No versions yet." />
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-line" aria-label="Versions">
          {data.versions.map((v) => (
            <div key={v.version} data-version={v.version} className="flex items-center gap-2.5 border-b border-line/60 px-3 py-2 text-[12.5px] last:border-b-0">
              {data.comparable && data.can.view ? <Checkbox aria-label={`Pick version ${v.version} to compare`} checked={picked.includes(v.version)} onChange={() => toggle(v.version)} /> : null}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5">
                  <b className="text-ink">v{v.version}</b>
                  {v.current ? <Pill tone="green">Current</Pill> : null}
                  {v.label ? <span className="truncate text-ink-2">{v.label}</span> : null}
                </span>
                <span className="truncate text-[11.5px] text-ink-3">{[v.author, v.made_at ? dateLabel(v.made_at) : null, v.size !== null ? bytes(v.size) : null].filter(Boolean).join(' · ')}</span>
              </span>
              {data.can.view ? (
                <button type="button" className={btnSmall + ' !h-7'} aria-label={`View version ${v.version}`} onClick={() => file(v, true)}>
                  View
                </button>
              ) : null}
              {data.can.download ? (
                <button type="button" className={btnSmall + ' !h-7 !w-7 justify-center !px-0'} aria-label={`Save version ${v.version}`} title="Save to your downloads" onClick={() => file(v, false)}>
                  <Icon name="download" size={13} />
                </button>
              ) : null}
              {data.can.restore && !v.current ? (
                <button type="button" className={btnSmall + ' !h-7'} aria-label={`Restore version ${v.version}`} onClick={() => setRestoring(v)}>
                  Restore
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {restoring ? (
        <div role="alertdialog" aria-label={`Restore version ${restoring.version}?`} className="flex flex-col gap-2 rounded-[10px] border border-line bg-subtle p-3 text-[12.5px]">
          <b className="text-ink">Restore version {restoring.version}?</b>
          <span className="text-ink-2">Version {restoring.version} becomes the newest version of “{doc.title}”. The current version stays in the history, so this can be undone.</span>
          <span className="flex justify-end gap-2">
            <button type="button" className={btn} onClick={() => setRestoring(null)}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void restore(restoring)}>
              {busy ? 'Restoring…' : 'Restore'}
            </button>
          </span>
        </div>
      ) : null}
    </Sheet>
  );
}

function Compare({ docId, from, to }: { docId: number; from: number; to: number }) {
  const q = useQuery({ queryKey: ['tenders', 'doc-compare', docId, from, to], queryFn: () => compareVersions(docId, from, to) });
  const lines = useMemo(() => (q.data ? diffLines(q.data.from.lines, q.data.to.lines) : []), [q.data]);
  const rows = useMemo(() => sideBySide(lines), [lines]);
  const stats = diffStats(lines);
  if (q.isPending) return <p className="m-0 text-[12.5px] text-ink-3">Comparing…</p>;
  if (q.isError) return <p className="m-0 text-[12.5px] text-danger">{errorMessage(q.error)}</p>;
  const truncated = q.data.from.truncated || q.data.to.truncated;
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-[12px] text-ink-2">
        v{from} → v{to}: {stats.added} added, {stats.removed} removed{truncated ? ' · only the start of a long document is compared' : ''}
      </p>
      {!stats.added && !stats.removed ? <Empty text="The words of these two versions are the same." /> : null}
      <div className="grid grid-cols-2 overflow-hidden rounded-[10px] border border-line text-[12px]" aria-label="Differences">
        <div className="border-b border-line bg-subtle px-2.5 py-1.5 font-semibold text-ink-2">v{from}</div>
        <div className="border-b border-s border-line bg-subtle px-2.5 py-1.5 font-semibold text-ink-2">v{to}</div>
        {rows.map((r, i) => (
          <div key={i} className="contents" data-kind={r.kind}>
            <div className={cx('px-2.5 py-1 whitespace-pre-wrap break-words', (r.kind === 'removed' || r.kind === 'changed') && 'bg-danger-bg text-danger')}>{r.left ?? ''}</div>
            <div className={cx('border-s border-line px-2.5 py-1 whitespace-pre-wrap break-words', (r.kind === 'added' || r.kind === 'changed') && 'bg-[#E6F4EA] text-[#1F7A4D] dark:bg-[#1F7A4D]/20')}>{r.right ?? ''}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
