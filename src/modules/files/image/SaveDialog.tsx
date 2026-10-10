import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Checkbox } from '../../../components/Checkbox';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Button, Modal, cx } from '../../../components/ui';
import { bytes, dateLabel } from '../../../core/time';
import { can, flatten, tree as loadTree } from '../api';
import type { EditorSettings, StaleSave } from './api';

/**
 * Save to Drive (SAV-01…08, P07): one dialog for a new version, a copy (named, in a folder the person may upload to),
 * or a download — with the version note, the format and quality, the size it comes to, keeping the layers editable,
 * removing GPS, and telling the people who follow the file. A save that finds the file moved on (409) says who saved
 * which version and offers the next version, a copy, or Compare; nothing is overwritten.
 */
export type SaveChoice = 'version' | 'copy' | 'download';
export type SaveFormat = 'jpg' | 'png' | 'webp';

export interface SaveOptions {
  choice: SaveChoice;
  note: string;
  name: string;
  folderId: number | null;
  format: SaveFormat;
  quality: number;
  keepLayers: boolean;
  stripGps: boolean;
  notify: boolean;
}

export interface SaveDialogProps {
  name: string;
  ext: string;
  version: number;
  folderId: number | null;
  folderName: string;
  canEdit: boolean;
  /** Why a new version cannot be saved (View only, a format saved as a copy…). */
  editReason: string | null;
  canCopy: boolean;
  isNew: boolean;
  defaults: EditorSettings['save_defaults'];
  followers: number;
  autoNote: string;
  hasGps: boolean;
  hasTransparency: boolean;
  initial: SaveChoice;
  stale: StaleSave | null;
  /** Saving offline: kept on this computer, sent when back online. */
  offline: { willBe: number } | null;
  sizeFor: (format: SaveFormat) => { w: number; h: number };
  estimate: (format: SaveFormat, quality: number) => Promise<number>;
  onSave: (o: SaveOptions) => void;
  onCompare: () => void;
  onRequestEdit: (() => void) | null;
  onClose: () => void;
}

const same = (ext: string): SaveFormat => (ext === 'png' || ext === 'gif' || ext === 'bmp' ? 'png' : ext === 'webp' ? 'webp' : 'jpg');

export function SaveDialog(p: SaveDialogProps) {
  const d = p.defaults ?? {};
  const [choice, setChoice] = useState<SaveChoice>(p.canEdit || p.isNew ? p.initial : p.initial === 'version' ? (p.canCopy ? 'copy' : 'download') : p.initial);
  const [note, setNote] = useState(p.autoNote);
  const base = p.name.replace(/\.[^.]+$/, '');
  const [format, setFormat] = useState<SaveFormat>(d.format && d.format !== 'same' ? d.format : same(p.ext));
  const [name, setName] = useState(`${base} (edited)`);
  const [folder, setFolder] = useState<number | null>(p.folderId);
  const [quality, setQuality] = useState(d.quality ?? 85);
  const [keepLayers, setKeepLayers] = useState(d.keep_layers ?? true);
  const [stripGps, setStripGps] = useState(d.strip_gps ?? true);
  const [notify, setNotify] = useState(p.followers > 0);
  const [estimate, setEstimate] = useState<number | null>(null);
  const treeQ = useQuery({ queryKey: ['files', 'tree'], queryFn: ({ signal }) => loadTree(signal), enabled: choice === 'copy' && !p.offline });
  const size = p.sizeFor(format);
  // A version keeps the file's own type; a copy or a download can change it.
  const versionFormat = same(p.ext);
  const fmt = choice === 'version' && !p.isNew ? versionFormat : format;

  useEffect(() => {
    let gone = false;
    const t = setTimeout(() => void p.estimate(fmt, quality).then((n) => !gone && setEstimate(n), () => undefined), 250);
    return () => {
      gone = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fmt, quality]);

  const folders = flatten(treeQ.data?.tree ?? []);
  const folderOptions = [
    { value: '', label: 'My Drive' },
    ...folders.map((f) => {
      const ok = !f.access || can(f.access, 'add_files') || !!f.access.owner;
      return { value: String(f.id), label: `${'  '.repeat(f.depth)}${f.name}${ok ? '' : ' — you cannot upload here'}`, disabled: !ok };
    }),
  ];
  const nextVersion = p.stale ? p.stale.version + 1 : p.version + 1;
  const saveLabel = choice === 'download' ? 'Download' : choice === 'copy' ? 'Save copy' : p.isNew ? 'Save to Drive' : p.offline ? `Save · upload as v${p.offline.willBe}` : `Save as v${nextVersion}`;
  const finalName = `${name.trim().replace(/\.[^.]+$/, '')}.${fmt === 'jpg' ? (p.ext === 'jpeg' ? 'jpeg' : 'jpg') : fmt}`;
  const go = () => p.onSave({ choice, note: note.trim(), name: choice === 'version' ? p.name : finalName, folderId: folder, format: fmt, quality, keepLayers, stripGps, notify });

  const option = (value: SaveChoice, title: string, sub: string, disabled: string | null, body?: ReactNode) => (
    <label className={cx('flex cursor-pointer gap-3 rounded-[12px] border p-3.5', choice === value ? 'border-primary bg-selection' : 'border-line', disabled && 'cursor-not-allowed opacity-60')}>
      <input type="radio" name="save-choice" className="mt-1 accent-[var(--color-primary)]" checked={choice === value} disabled={!!disabled} onChange={() => setChoice(value)} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <b className="text-[14px] text-ink">{title}</b>
        <span className="text-[12.5px] text-ink-2">{disabled ?? sub}</span>
        {choice === value ? body : null}
      </span>
    </label>
  );

  return (
    <Modal
      title="Save changes to Drive"
      labelledBy="save-to-drive"
      width={640}
      onClose={p.onClose}
      footer={
        <>
          <span className="mr-auto flex items-center gap-1.5 text-[12px] text-ink-3">
            <Icon name="lock" size={13} />
            {p.canEdit ? 'You have Edit access to this file' : 'You can view this file'}
          </span>
          {!p.canEdit && p.onRequestEdit && !p.isNew ? <Button onClick={p.onRequestEdit}>Request edit access</Button> : null}
          <Button onClick={p.onClose}>Cancel</Button>
          <Button variant="primary" disabled={(choice === 'copy' && !name.trim()) || (choice === 'version' && !p.canEdit && !p.isNew)} onClick={go}>
            {saveLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        {p.stale ? (
          <div role="alert" className="flex items-start gap-2.5 rounded-[10px] bg-warning-bg px-3.5 py-2.5 text-warning">
            <Icon name="warning" size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1">
              <b>{`${p.stale.author ?? 'Someone'} saved v${p.stale.version}${p.stale.savedAt ? ` at ${dateLabel(p.stale.savedAt)}` : ''}`}</b>
              {` while you were editing v${p.version}. Your save becomes v${p.stale.version + 1} — or compare first.`}
            </span>
            <button type="button" onClick={p.onCompare} className="font-bold underline">
              Compare
            </button>
          </div>
        ) : null}
        {p.offline ? <p className="rounded-[10px] bg-selection px-3.5 py-2.5 text-primary">{`You are offline. The edit is saved to the synced copy on this computer with its layers, and uploads as v${p.offline.willBe} when you are back online.`}</p> : null}
        {p.isNew ? null : option(
          'version',
          `New version of ${p.name}`,
          `Becomes v${nextVersion}. Earlier versions stay in Versions${keepLayers ? ', and this edit can be reopened step by step' : ''}.`,
          p.canEdit ? null : (p.editReason ?? 'You have View access only.'),
          <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-label="Version note" placeholder="What changed" className="mt-1 h-9 rounded-[8px] border border-line bg-surface px-2.5 text-ink outline-none focus:border-primary" />,
        )}
        {option(
          'copy',
          p.isNew ? 'Save to Drive' : 'Save as a copy',
          p.isNew ? 'A new picture in the folder you choose.' : 'A new file — the original stays untouched.',
          p.canCopy || p.isNew ? null : 'You cannot download this file, so a copy cannot be made.',
          <div className="mt-1 grid grid-cols-[1fr_200px] gap-2">
            <input value={name} maxLength={200} onChange={(e) => setName(e.target.value.replace(/[/\\]/g, ''))} aria-label="Name of the copy" className="h-9 rounded-[8px] border border-line bg-surface px-2.5 text-ink outline-none focus:border-primary" />
            {p.offline ? <span className="flex items-center text-[12px] text-ink-3">{`Next to the original, in ${p.folderName}`}</span> : <Select value={folder === null ? '' : String(folder)} aria-label="Folder" options={folderOptions} onValueChange={(v) => setFolder(v ? Number(v) : null)} className="w-full" searchable />}
          </div>,
        )}
        {option('download', 'Download only', 'Nothing changes in Drive.', null)}
        <div className="grid grid-cols-[auto_1fr_auto] items-end gap-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold tracking-[0.06em] text-ink-2 uppercase">Format</span>
            <div role="radiogroup" aria-label="Format" className="flex gap-1.5">
              {(['jpg', 'png', 'webp'] as const).map((f) => (
                <button key={f} type="button" role="radio" aria-checked={fmt === f} disabled={choice === 'version' && !p.isNew} onClick={() => setFormat(f)} className={cx('h-8 rounded-full px-3 text-[12.5px] font-semibold disabled:opacity-50', fmt === f ? 'bg-ink text-surface' : 'border border-line text-ink')}>
                  {f === 'jpg' ? 'JPG' : f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <label className={cx('flex flex-col gap-1.5', fmt === 'png' && 'opacity-50')}>
            <span className="flex text-[12.5px] text-ink-2">
              <span className="flex-1">Quality</span>
              <span className="font-mono">{quality}</span>
            </span>
            <input type="range" min={1} max={100} value={quality} disabled={fmt === 'png'} onChange={(e) => setQuality(Number(e.target.value))} aria-label="Quality" className="accent-[var(--color-primary)]" />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold tracking-[0.06em] text-ink-2 uppercase">Size</span>
            <span className="text-[13px] text-ink">
              <b>{`${size.w} × ${size.h}`}</b>
              {` · ${estimate === null ? '…' : `≈ ${bytes(estimate)}`}`}
            </span>
          </div>
        </div>
        {choice === 'version' && !p.isNew && !['jpg', 'jpeg', 'png', 'webp'].includes(p.ext) ? <span className="text-[12px] text-ink-3">{`A ${p.ext.toUpperCase()} is saved as PNG.`}</span> : null}
        {p.hasTransparency && fmt === 'jpg' ? <span className="text-[12px] text-warning">A JPEG cannot be transparent: rounded corners are filled with the frame or corner colour. Choose PNG or WebP to keep them clear.</span> : null}
        <div className="flex flex-col gap-2.5">
          {choice !== 'download' ? (
            <label className="flex items-start gap-2.5">
              <Checkbox checked={keepLayers} onChange={(e) => setKeepLayers(e.target.checked)} />
              <span className="flex flex-col">
                <span className="text-ink">Keep editable layers</span>
                <span className="text-[12px] text-ink-3">Text, stickers and adjustments can be changed later.</span>
              </span>
            </label>
          ) : null}
          <label className="flex items-start gap-2.5">
            <Checkbox checked={stripGps} onChange={(e) => setStripGps(e.target.checked)} />
            <span className="flex flex-col">
              <span className="text-ink">Remove GPS location from the file</span>
              <span className="text-[12px] text-ink-3">{p.hasGps ? 'Camera details are kept.' : 'This picture has no location in it.'}</span>
            </span>
          </label>
          {choice === 'version' && p.followers > 0 ? (
            <label className="flex items-start gap-2.5">
              <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              <span className="text-ink">{`Notify ${p.followers} ${p.followers === 1 ? 'person' : 'people'} following this file`}</span>
            </label>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
