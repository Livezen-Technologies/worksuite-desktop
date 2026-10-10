import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { bytes, dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import { btn, btnPrimary, btnSmall, Empty, Field, input, Sheet } from '../hr/parts';
import { Pill } from '../inventory/parts';
import { K, type DocAccess, type TenderDoc } from './api';
import { AttachMenu, saveTenderFile, tenderOfficeDoc, Uploading, useDropZone, useTenderUploads } from './files';
import { OpenWithButton } from '../office/open-with';
import { addDocuments, DOC_KINDS, docKindLabel, removeDocument, replaceDocument, updateDocument } from './work';
import { Checkbox } from '../../components/Checkbox';

/**
 * The tender's documents: the buyer's notice and specification, our bid,
 * clarifications, addenda and the award letter. Filed from this computer
 * (picked, or dropped on the list) or from Drive; opened, saved, replaced with a new version, renamed or taken
 * off. What each reader may do is the server's answer (`can`), so a button
 * that would be refused is not shown. A file the malware scan is holding, or
 * one removed from Drive, says so rather than failing when opened.
 */
export default function Documents({ id, docs, can }: { id: number; docs: TenderDoc[]; can: DocAccess }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState('tender_notice');
  const [editing, setEditing] = useState<TenderDoc | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: K.tender(id) });
  const uploads = useTenderUploads(id, refresh);
  // Files dropped on the list are added as documents of the kind chosen above.
  const zone = useDropZone(can.upload, (files) => void uploads.drop(files, { into: 'document', docKind: kind }));
  const remove = async (d: TenderDoc) => {
    setBusy(d.id);
    try {
      await removeDocument(d.id);
      toast('success', `${d.title} was taken off the tender. The file stays in Drive.`);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {can.upload ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-semibold text-ink-2">Add a</span>
          <Select<string> aria-label="What this document is" value={kind} onValueChange={setKind} options={DOC_KINDS.map(([value, label]) => ({ value, label }))} className={input + ' !w-[180px]'} />
          <AttachMenu
            label="Add"
            onComputer={() => void uploads.pick({ into: 'document', docKind: kind }, `Add a ${docKindLabel(kind).toLowerCase()}`, true)}
            onDrive={async (files) => {
              try {
                await addDocuments(id, files, kind);
                toast('success', files.length === 1 ? 'Document attached.' : `${files.length} documents attached.`);
              } catch (e) {
                toast('error', errorMessage(e));
              } finally {
                refresh();
              }
            }}
          />
        </div>
      ) : null}
      <Uploading live={uploads.live} />
      <div {...zone.props} className={cx('overflow-hidden rounded-[12px] border border-line bg-surface', zone.over && 'outline-2 -outline-offset-2 outline-primary outline-dashed')} aria-label="Documents">
        {docs.length ? (
          docs.map((d) => {
            const f = d.file;
            const openable = f?.state === 'ready' && can.download;
            return (
              <div key={d.id} data-doc={d.id} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-2.5 text-[12.5px] last:border-b-0">
                <Icon name="file" size={18} className="shrink-0 text-ink-3" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <b className="truncate text-[13px] text-ink">{d.title}</b>
                    <Pill>{docKindLabel(d.kind)}</Pill>
                    {d.is_final ? <Pill tone="green">Final</Pill> : null}
                    {d.version > 1 ? <span className="text-[11.5px] text-ink-3">v{d.version}</span> : null}
                  </span>
                  <span className="truncate text-[11.5px] text-ink-3">
                    {[
                      !f
                        ? 'No file yet'
                        : f.state === 'held'
                          ? 'Held by the malware scan — nobody can open it until it is cleared'
                          : f.state === 'deleted'
                            ? 'The file was removed from Drive'
                            : [f.name, f.size !== null ? bytes(f.size) : null].filter(Boolean).join(' · '),
                      d.added_by_name ? `added by ${d.added_by_name}` : null,
                      dateLabel(d.created_at),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {d.note ? <span className="text-[12px] text-ink-2">{d.note}</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {openable ? (
                    <>
                      <button type="button" className={btnSmall + ' !h-7'} onClick={() => void saveTenderFile({ tenderDocument: d.id }, f!.download_name, true)}>
                        Open
                      </button>
                      <OpenWithButton doc={tenderOfficeDoc({ tenderDocument: d.id }, f!.download_name)} className={btnSmall + ' !h-7 !w-7 justify-center !px-0'} />
                      <button type="button" aria-label={`Save ${d.title}`} title="Save to your downloads" className={btnSmall + ' !h-7 !w-7 justify-center !px-0'} onClick={() => void saveTenderFile({ tenderDocument: d.id }, f!.download_name)}>
                        <Icon name="download" size={13} />
                      </button>
                    </>
                  ) : null}
                  {can.edit && can.upload ? (
                    <AttachMenu
                      small
                      label={f ? 'Replace' : 'Attach'}
                      onComputer={() => void uploads.pick({ into: 'replace', id: d.id }, `A new version of ${d.title}`.slice(0, 100))}
                      onDrive={async (files) => void (await replaceFromDrive(d.id, files[0], refresh))}
                    />
                  ) : null}
                  {can.edit ? (
                    <button type="button" aria-label={`Edit ${d.title}`} title="Edit" className={btnSmall + ' !h-7 !w-7 justify-center !px-0'} onClick={() => setEditing(d)}>
                      <Icon name="compose" size={13} />
                    </button>
                  ) : null}
                  {can.delete ? (
                    <button type="button" aria-label={`Take ${d.title} off`} title="Take it off the tender" className={cx(btnSmall, '!h-7 !w-7 justify-center !px-0 !text-danger')} disabled={busy === d.id} onClick={() => void remove(d)}>
                      <Icon name="trash" size={13} />
                    </button>
                  ) : null}
                </span>
              </div>
            );
          })
        ) : (
          <Empty text={can.upload ? 'No documents yet. The buyer’s notice and specification are the usual first two.' : 'No documents yet.'} />
        )}
      </div>
      {!can.download && docs.length ? <p className="m-0 text-[12px] text-ink-3">You can see what is filed here, but taking copies of tender documents needs its own permission.</p> : null}
      {editing ? <EditDoc doc={editing} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
    </div>
  );
}

async function replaceFromDrive(docId: number, f: { id: number | string } | undefined, refresh: () => void) {
  if (!f) return;
  try {
    await replaceDocument(docId, Number(f.id));
    toast('success', 'Replaced.');
  } catch (e) {
    toast('error', errorMessage(e));
  } finally {
    refresh();
  }
}

function EditDoc({ doc, onClose, onSaved }: { doc: TenderDoc; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(doc.title);
  const [kind, setKind] = useState(doc.kind);
  const [note, setNote] = useState(doc.note ?? '');
  const [final, setFinal] = useState(doc.is_final);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = {
    ...(title.trim() !== doc.title ? { title: title.trim() } : {}),
    ...(kind !== doc.kind ? { kind } : {}),
    ...(note.trim() !== (doc.note ?? '') ? { note: note.trim() } : {}),
    ...(final !== doc.is_final ? { is_final: final } : {}),
  };
  const save = async () => {
    if (!title.trim()) return setError('Give the document a title.');
    setBusy(true);
    try {
      await updateDocument(doc.id, patch);
      toast('success', 'Saved.');
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
      title="Edit the document"
      width={480}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !Object.keys(patch).length} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <Field label="Title">
        <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={250} className={input} />
      </Field>
      <Field label="What it is">
        <Select<string> aria-label="What it is" value={kind} onValueChange={setKind} options={DOC_KINDS.map(([value, label]) => ({ value, label }))} className={input} />
      </Field>
      <Field label="Note">
        <input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={input} />
      </Field>
      <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
        <Checkbox checked={final} onChange={(e) => setFinal(e.target.checked)} />
        The final version
      </label>
      {error ? <p className="m-0 text-[12.5px] text-danger">{error}</p> : null}
    </Sheet>
  );
}
