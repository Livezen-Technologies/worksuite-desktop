import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiGet, apiUrl } from '../../core/api';
import { bytes, duration } from '../../core/time';
import { Icon } from '../../components/Icon';
import { Button, Spinner, cx } from '../../components/ui';
import { IMAGE_EDIT_EXTS, TEXT_EXTS, can, extOf, kindOf, mediaUrl, opened, tagOf, type DriveFile, type Preview as PreviewInfo } from './api';
import { useDrive } from './ctx';
import { FileIcon } from './Thumb';
import { isSlidesFile } from '../office/slides/overlay';
import { fetchBytes } from '../office/slides/render';
import { SlidesViewer } from '../office/slides/SlidesViewer';

/**
 * The viewer (DriveMedia): the file as big as it goes — a picture, a video,
 * a sound or text — with ‹ › through the files around it, and what it is on
 * the right. ← → move, Esc closes.
 */
export function Preview({ files, start, onClose }: { files: DriveFile[]; start: number; onClose: () => void }) {
  const d = useDrive();
  const [i, setI] = useState(start);
  const [zoom, setZoom] = useState<'fit' | 'full'>('fit');
  const f = files[i]!;
  // A presentation: the slide viewer (#321) — its own ← → change slides; ‹ › above still go through the files.
  const slides = isSlidesFile(f.name);
  const info = useQuery({ queryKey: ['files', 'preview', f.id], queryFn: ({ signal }) => apiGet<PreviewInfo>(`/api/drive/preview/${f.id}`, undefined, signal) });
  const p = info.data;
  // A file stored without a media type (as the app's uploads were before 0.2.7)
  // gets no preview from the server; its own address still plays or shows.
  const kind = kindOf(f.name, f.extension);
  const how = p?.preview ?? (kind === 'image' || kind === 'video' || kind === 'audio' ? kind : TEXT_EXTS.includes(extOf(f.name, f.extension)) ? 'text' : null);
  const src = mediaUrl(p?.url ?? (p?.preview ? null : p?.download_url?.replace(/[?&]download=1$/, '')));
  const text = useQuery({
    queryKey: ['files', 'text', f.id],
    queryFn: ({ signal }) => apiGet<{ content: string; language: string | null; lines: number }>(`/api/drive/editor/${f.id}`, undefined, signal),
    enabled: how === 'text',
  });

  // Opening counts as opening (Recent, Continue working).
  const [seen, setSeen] = useState<number | null>(null);
  if (seen !== f.id) {
    setSeen(f.id);
    setZoom('fit');
  }
  useEffect(() => {
    void opened(f.id);
  }, [f.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') onClose();
      else if (!slides && e.key === 'ArrowRight' && i < files.length - 1) setI(i + 1);
      else if (!slides && e.key === 'ArrowLeft' && i > 0) setI(i - 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [i, files.length, onClose, slides]);

  const facts: Array<[string, string]> = [
    ['Type', `${(f.extension ?? '').toUpperCase() || 'File'}${p?.kind ? ` · ${p.kind}` : ''}`],
    ...(p?.width && p.height ? [['Size', `${p.width} × ${p.height}`] as [string, string]] : []),
    ...(p?.duration_ms ? [['Length', duration(Math.round(p.duration_ms / 1000))] as [string, string]] : []),
    ['File size', bytes(f.size)],
    ['Location', f.folder_path ? `My Drive › ${f.folder_path.replace(/\//g, ' › ')}` : f.folder_name || 'My Drive'],
    ['Owner', f.access?.owner ? 'You' : (f.owner_name ?? '—')],
  ];

  return (
    <div role="dialog" aria-modal="true" aria-label={`Preview ${f.name}`} className="no-drag fixed inset-0 z-50 flex flex-col bg-[#0D1424] text-[#E6ECFA]">
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-[#1E2C57] bg-[#0F1B3D] px-4">
        <button type="button" aria-label="Back to the folder" onClick={onClose} className="flex h-[34px] w-[34px] items-center justify-center rounded-[8px] hover:bg-white/10"><Icon name="chevron-left" size={18} /></button>
        <span className="rounded-[6px] bg-white/10 px-2 py-0.5 text-[10.5px] font-bold">{tagOf(f.name, f.extension)}</span>
        <div className="flex min-w-0 flex-col">
          <b className="truncate text-[14px]">{f.name}</b>
          <span className="text-[12px] text-[#AFC0E8]">{f.folder_name || 'My Drive'} · {i + 1} of {files.length}</span>
        </div>
        <span className="flex-1" />
        <button type="button" aria-label="Previous file" disabled={i === 0} onClick={() => setI(i - 1)} className="h-[34px] w-[34px] rounded-[8px] border border-[#2A3A66] text-[18px] hover:bg-white/10 disabled:opacity-30">‹</button>
        <button type="button" aria-label="Next file" disabled={i >= files.length - 1} onClick={() => setI(i + 1)} className="h-[34px] w-[34px] rounded-[8px] border border-[#2A3A66] text-[18px] hover:bg-white/10 disabled:opacity-30">›</button>
        {how === 'image' && IMAGE_EDIT_EXTS.includes(extOf(f.name, f.extension)) && (can(f.access, 'upload_version') || can(f.access, 'download')) ? (
          <button type="button" onClick={() => (onClose(), d.editImage(f))} className="h-[34px] rounded-[8px] bg-[#3B5BDB] px-3 font-bold text-white hover:brightness-110">Edit photo</button>
        ) : null}
        {how === 'text' ? <button type="button" onClick={() => (onClose(), d.editText(f))} className="h-[34px] rounded-[8px] border border-[#2A3A66] px-3 font-semibold hover:bg-white/10">{can(f.access, 'edit') ? 'Edit' : 'Open in the editor'}</button> : null}
        {can(f.access, 'share') ? <button type="button" onClick={() => d.share({ type: 'file', f })} className="h-[34px] rounded-[8px] border border-[#2A3A66] px-3 font-semibold hover:bg-white/10">Share…</button> : null}
        {can(f.access, 'download') ? (
          <>
            <button type="button" onClick={() => d.download([f], true)} className="h-[34px] rounded-[8px] border border-[#2A3A66] px-3 font-semibold hover:bg-white/10">Open locally</button>
            <button type="button" onClick={() => d.download([f])} className="h-[34px] rounded-[8px] bg-[#3B5BDB] px-3.5 font-bold text-white hover:brightness-110">Download</button>
          </>
        ) : null}
        <button type="button" aria-label="Close viewer" onClick={onClose} className="ml-1 flex h-[34px] w-[34px] items-center justify-center rounded-[8px] text-[18px] hover:bg-white/10">×</button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {slides && p?.status !== 'blocked' ? (
            <div className="flex min-h-0 flex-1 bg-surface text-ink">
              <SlidesViewer
                key={f.id}
                name={f.name}
                load={(signal) => fetchBytes(apiUrl(`/api/files/${f.id}/download`), signal)}
                onDownload={can(f.access, 'download') ? () => d.download([f]) : undefined}
                onOpenInOffice={() => (onClose(), d.office(f, 'VIEW'))}
              />
            </div>
          ) : null}
          <div className={cx('relative flex min-h-0 flex-1 items-center justify-center p-6', zoom === 'full' && 'overflow-auto', slides && p?.status !== 'blocked' && 'hidden')}>
            {info.isLoading ? <Spinner /> : null}
            {p && p.status !== 'ready' ? (
              <Unavailable f={f} why={p.status === 'blocked' ? 'This file was held back by the virus check.' : 'This file can’t be shown here.'} />
            ) : null}
            {p?.status === 'ready' && how === 'image' && src ? (
              <img src={src} alt={f.name} onClick={() => setZoom(zoom === 'fit' ? 'full' : 'fit')} className={cx('cursor-zoom-in rounded-[6px] shadow-2xl', zoom === 'fit' ? 'max-h-full max-w-full object-contain' : 'max-w-none cursor-zoom-out')} />
            ) : null}
            {p?.status === 'ready' && how === 'video' && src ? <video key={src} src={src} poster={mediaUrl(p.poster_url) ?? undefined} controls autoPlay className="max-h-full max-w-full rounded-[8px] bg-black shadow-2xl" /> : null}
            {p?.status === 'ready' && how === 'audio' && src ? (
              <div className="flex w-[520px] max-w-full flex-col items-center gap-5">
                <span className="flex h-40 w-40 items-center justify-center rounded-[24px] bg-white/10"><Icon name="music" size={54} /></span>
                <audio key={src} src={src} controls autoPlay className="w-full" />
              </div>
            ) : null}
            {p?.status === 'ready' && how === 'text' ? (
              text.data ? (
                <pre className="h-full w-full max-w-[1000px] overflow-auto rounded-[10px] bg-[#111A31] p-4 font-mono text-[12.5px] leading-[1.6] whitespace-pre-wrap text-[#D6DEF2] scroll-thin">{text.data.content}</pre>
              ) : text.error ? (
                <Unavailable f={f} why="This text can’t be shown here." />
              ) : (
                <Spinner />
              )
            ) : null}
            {p?.status === 'ready' && (!how || (how !== 'text' && !src)) ? <Unavailable f={f} why={how && !src ? 'You can open it, but not download it, so it can’t be shown here.' : 'There is no preview for this kind of file.'} /> : null}
          </div>
          {how === 'image' ? (
            <div className="flex h-9 shrink-0 items-center justify-end gap-2 px-4 text-[12px] text-[#AFC0E8]">
              {p?.width && p.height ? <span className="mr-auto">{p.width} × {p.height}</span> : null}
              <span>Zoom</span>
              <button type="button" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')} className={cx('rounded-[6px] px-2 py-0.5', zoom === 'fit' ? 'bg-white/15 text-white' : 'hover:bg-white/10')}>Fit</button>
              <button type="button" aria-pressed={zoom === 'full'} onClick={() => setZoom('full')} className={cx('rounded-[6px] px-2 py-0.5', zoom === 'full' ? 'bg-white/15 text-white' : 'hover:bg-white/10')}>100%</button>
            </div>
          ) : null}
          {files.length > 1 ? (
            <div role="list" aria-label="Files here" className="flex h-[82px] shrink-0 items-center gap-2.5 overflow-x-auto border-t border-[#1E2C57] px-4 scroll-thin">
              {files.map((x, n) => (
                <button key={x.id} type="button" role="listitem" aria-current={n === i ? 'true' : undefined} title={x.name} onClick={() => setI(n)} className={cx('flex h-[58px] w-[86px] shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-white/5', n === i ? 'outline-3 outline-offset-2 outline-[#7FA2FF]' : 'opacity-55 hover:opacity-90')}>
                  <FileIcon f={x} size={48} />
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <aside aria-label="Details" className={cx(slides && 'hidden', 'flex w-[300px] shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-[#1E2C57] bg-[#0F1B3D] p-4 text-[12.5px]')}>
          <h2 className="text-[13px] font-bold">Details</h2>
          {facts.map(([k, v]) => (
            <div key={k} className="flex gap-2.5">
              <span className="w-[76px] shrink-0 text-[#AFC0E8]">{k}</span>
              <span className="min-w-0 break-words">{v}</span>
            </div>
          ))}
          {f.description ? <p className="mt-1 rounded-[8px] bg-white/5 p-2.5 leading-[1.5]">{f.description}</p> : null}
          <button type="button" onClick={() => (onClose(), d.details({ type: 'file', f }, 'comments'))} className="mt-2 self-start font-semibold text-[#AFC6FF] hover:underline">Comments and versions…</button>
        </aside>
      </div>
    </div>
  );
}

function Unavailable({ f, why }: { f: DriveFile; why: string }) {
  const d = useDrive();
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <FileIcon f={f} size={72} />
      <b className="text-[15px]">{f.name}</b>
      <span className="text-[#AFC0E8]">{why}</span>
      {can(f.access, 'download') ? <Button variant="primary" onClick={() => d.download([f], true)}>Open locally</Button> : null}
    </div>
  );
}
