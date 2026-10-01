import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { apiUrl } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { isOfficeFile, mediaToken, openDocument } from '../../core/open-document';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { mediaUrl, openAttachment, type ChatFile } from './types';

/** An attachment as Chat and Web Chat both have it. */
export type Attachment = Pick<ChatFile, 'filename' | 'mime' | 'size' | 'url' | 'download_url'> & Partial<Pick<ChatFile, 'id' | 'preview' | 'is_image' | 'poster_url'>>;

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'office' | 'csv' | 'text' | 'other';

const TEXT_EXT = /\.(txt|text|md|markdown|log|json|xml|ya?ml|ini|conf|cfg|env|sql|html?|css|js|mjs|ts|tsx|jsx|py|rb|php|java|kt|go|rs|c|h|cpp|cs|sh|bat|ps1|srt|vtt)$/i;

const extOf = (name: string) => /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase() ?? '';

export function previewKind(f: Pick<Attachment, 'filename' | 'mime' | 'preview' | 'is_image'>): PreviewKind {
  const mime = (f.mime ?? '').toLowerCase();
  const name = f.filename ?? '';
  if (f.preview === 'image' || f.is_image || mime.startsWith('image/')) return 'image';
  if (f.preview === 'video' || mime.startsWith('video/')) return 'video';
  if (f.preview === 'audio' || mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (isOfficeFile(name)) return 'office';
  if (mime === 'text/csv' || mime === 'text/tab-separated-values' || /\.(csv|tsv)$/i.test(name)) return 'csv';
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml' || TEXT_EXT.test(name)) return 'text';
  return 'other';
}

/** Text and CSV are read into the page: past this they are offered to download instead. */
export const TEXT_LIMIT = 2 * 1024 * 1024;
/** Rows of a CSV drawn at once. */
export const CSV_ROWS = 1000;

/**
 * Where the attachment's bytes are read from inside the page: the app's own origin (the API proxy, which reads a
 * signed `/media/` address for it), since the page may not fetch the server directly.
 */
function readUrl(f: Attachment): string | null {
  const token = mediaToken(f.url) ?? mediaToken(f.download_url);
  if (token) return apiUrl(`/media/${token}`);
  return f.url?.startsWith('/chat/files/') || f.url?.startsWith('/api/') ? mediaUrl(f.url) : null;
}

/**
 * Open an attachment (#38). A picture, a video, a sound, a CSV or a text file opens in the preview over the
 * conversation, which stays where it was underneath. A PDF opens in PDF Studio (pages, zoom, search) and a Word,
 * Excel or PowerPoint file in a WorkSuite DOC / Sheet / Slides tab, as before. `gallery` is the pictures around it
 * (the conversation's, the Media tab's), to go through with ‹ ›.
 */
export function openChatAttachment(f: Attachment, link: (url: string) => void, gallery?: Attachment[]): void {
  const kind = previewKind(f);
  if (kind === 'pdf' || kind === 'office') {
    openAttachment(f, link);
    return;
  }
  const pictures = kind === 'image' && gallery?.length ? gallery.filter((g) => previewKind(g) === 'image') : [];
  const at = pictures.findIndex((g) => (f.id !== undefined && g.id === f.id) || (g.url === f.url && g.filename === f.filename));
  openPreview(at >= 0 ? pictures : [f], Math.max(0, at), link);
}

/** The pictures of what is on screen (the conversation, the Media tab), for ‹ › in the preview. */
export const AttachmentGallery = createContext<Attachment[]>([]);
export const useAttachmentGallery = () => useContext(AttachmentGallery);

let mounted: { root: Root; host: HTMLElement } | null = null;

/** Shows the preview over the page, wherever Chat is (its tab, the drawer, a window of its own). */
export function openPreview(items: Attachment[], start: number, link: (url: string) => void): void {
  closePreview();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted = { root, host };
  // What had focus (the attachment clicked) gets it back on closing: the conversation is where it was.
  const opener = document.activeElement as HTMLElement | null;
  const close = () => {
    closePreview();
    if (opener?.isConnected) opener.focus();
  };
  root.render(<AttachmentViewer items={items} start={start} link={link} onClose={close} />);
}

export function closePreview(): void {
  if (!mounted) return;
  const { root, host } = mounted;
  mounted = null;
  if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
  root.unmount();
  host.remove();
}

const download = (f: Attachment, link: (url: string) => void) => {
  const token = mediaToken(f.download_url) ?? mediaToken(f.url);
  if (token) {
    void call('transfers:download', { chatMedia: token, name: f.filename, open: false })
      .then(() => toast('info', `Downloading ${f.filename}…`))
      .catch((e) => toast('error', errorMessage(e)));
  } else if (f.download_url) link(f.download_url);
};
const canOpenElsewhere = (f: Attachment) => !!(mediaToken(f.download_url) ?? mediaToken(f.url));
const openElsewhere = (f: Attachment) => {
  const token = mediaToken(f.download_url) ?? mediaToken(f.url);
  if (token) void openDocument({ chatMedia: token }, f.filename);
};

const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

export function AttachmentViewer({ items, start, link, onClose }: { items: Attachment[]; start: number; link: (url: string) => void; onClose: () => void }) {
  const [i, setI] = useState(Math.min(start, items.length - 1));
  const f = items[i]!;
  const kind = previewKind(f);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [turn, setTurn] = useState(0);
  const [full, setFull] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // A new file starts fitted and upright.
  const [seen, setSeen] = useState(i);
  if (seen !== i) {
    setSeen(i);
    setZoom('fit');
    setTurn(0);
  }

  const step = (dir: 1 | -1) => {
    const now = zoom === 'fit' ? 1 : zoom;
    const next = dir > 0 ? ZOOMS.find((z) => z > now) : [...ZOOMS].reverse().find((z) => z < now);
    if (next) setZoom(next);
  };
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    else void box.current?.requestFullscreen?.().catch(() => undefined);
  };
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  useEffect(() => {
    box.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Full screen ends first (the system does that); the next Escape closes.
        if (document.fullscreenElement) return;
        onClose();
      } else if (e.key === 'ArrowRight' && i < items.length - 1) setI(i + 1);
      else if (e.key === 'ArrowLeft' && i > 0) setI(i - 1);
      else if (kind === 'image' && (e.key === '+' || e.key === '=')) step(1);
      else if (kind === 'image' && e.key === '-') step(-1);
      else if (kind === 'image' && e.key === '0') setZoom('fit');
      else if (kind === 'image' && (e.key === 'r' || e.key === 'R')) setTurn((t) => (t + 90) % 360);
      else if (kind === 'image' && (e.key === 'f' || e.key === 'F')) fullscreen();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const tool = 'flex h-[34px] min-w-[34px] items-center justify-center rounded-[8px] border border-[#2A3A66] px-2 text-[13px] hover:bg-white/10 disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-[#7C93F2]';
  const type = (extOf(f.filename) || f.mime.split('/')[1] || 'file').toUpperCase();

  return (
    <div
      ref={box}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${f.filename}`}
      className="no-drag fixed inset-0 z-[60] flex flex-col bg-[#0D1424] text-[#E6ECFA] outline-none"
    >
      <div className="flex min-h-[52px] shrink-0 flex-wrap items-center gap-2 border-b border-[#1E2C57] bg-[#0F1B3D] px-3 py-2">
        <button type="button" aria-label="Back to the conversation" title="Back to the conversation" onClick={onClose} className={tool}>
          <Icon name="chevron-left" size={18} />
        </button>
        <span className="rounded-[6px] bg-white/10 px-2 py-0.5 text-[10.5px] font-bold">{type}</span>
        <div className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-[14px]" title={f.filename}>
            {f.filename}
          </b>
          <span className="text-[12px] text-[#AFC0E8]">
            {f.mime || 'File'} · {bytes(f.size)}
            {items.length > 1 ? ` · ${i + 1} of ${items.length}` : ''}
          </span>
        </div>
        {items.length > 1 ? (
          <>
            <button type="button" aria-label="Previous" title="Previous (←)" disabled={i === 0} onClick={() => setI(i - 1)} className={tool}>
              <Icon name="chevron-left" size={16} />
            </button>
            <button type="button" aria-label="Next" title="Next (→)" disabled={i >= items.length - 1} onClick={() => setI(i + 1)} className={tool}>
              <Icon name="chevron-right" size={16} />
            </button>
          </>
        ) : null}
        {kind === 'image' ? (
          <div role="group" aria-label="Picture" className="flex items-center gap-1">
            <button type="button" aria-label="Zoom out" title="Zoom out (−)" disabled={zoom !== 'fit' && zoom <= ZOOMS[0]!} onClick={() => step(-1)} className={tool}>
              <Icon name="zoom-out" size={16} />
            </button>
            <button type="button" aria-label="Fit to window" title="Fit (0)" onClick={() => setZoom('fit')} className={cx(tool, 'w-[56px] tabular-nums')}>
              {zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`}
            </button>
            <button type="button" aria-label="Zoom in" title="Zoom in (+)" disabled={zoom !== 'fit' && zoom >= ZOOMS[ZOOMS.length - 1]!} onClick={() => step(1)} className={tool}>
              <Icon name="zoom-in" size={16} />
            </button>
            <button type="button" aria-label="Rotate" title="Rotate (R)" onClick={() => setTurn((t) => (t + 90) % 360)} className={tool}>
              <Icon name="rotate-cw" size={16} />
            </button>
            <button type="button" aria-label={full ? 'Exit full screen' : 'Full screen'} title={full ? 'Exit full screen (F)' : 'Full screen (F)'} onClick={fullscreen} className={tool}>
              <Icon name={full ? 'fullscreen-exit' : 'fullscreen'} size={16} />
            </button>
          </div>
        ) : null}
        <button type="button" onClick={() => download(f, link)} disabled={!f.download_url && !f.url} className={cx(tool, 'gap-1.5 font-semibold')}>
          <Icon name="download" size={15} /> Download
        </button>
        {canOpenElsewhere(f) ? (
          <button type="button" onClick={() => openElsewhere(f)} className={cx(tool, 'gap-1.5 font-semibold max-sm:hidden')}>
            <Icon name="external" size={15} /> Open in app
          </button>
        ) : null}
        <button type="button" aria-label="Close" title="Close (Esc)" onClick={onClose} className={tool}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        <Body key={i} f={f} kind={kind} zoom={zoom} turn={turn} link={link} />
      </div>
    </div>
  );
}

function Problem({ text, onRetry, f, link }: { text: string; onRetry?: () => void; f: Attachment; link: (url: string) => void }) {
  return (
    <div role="alert" className="flex max-w-[420px] flex-col items-center gap-3 text-center">
      <Icon name="alert" size={28} className="text-[#F7A39C]" />
      <p className="text-[14px]">{text}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {onRetry ? (
          <button type="button" onClick={onRetry} className="flex h-9 items-center gap-1.5 rounded-[8px] bg-[#3B5BDB] px-3 text-[13px] font-bold text-white hover:brightness-110">
            <Icon name="rotate-cw" size={14} /> Try again
          </button>
        ) : null}
        <button type="button" onClick={() => download(f, link)} className="flex h-9 items-center gap-1.5 rounded-[8px] border border-[#2A3A66] px-3 text-[13px] font-semibold hover:bg-white/10">
          <Icon name="download" size={14} /> Download
        </button>
        {canOpenElsewhere(f) ? (
          <button type="button" onClick={() => openElsewhere(f)} className="flex h-9 items-center gap-1.5 rounded-[8px] border border-[#2A3A66] px-3 text-[13px] font-semibold hover:bg-white/10">
            <Icon name="external" size={14} /> Open in app
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Body({ f, kind, zoom, turn, link }: { f: Attachment; kind: PreviewKind; zoom: number | 'fit'; turn: number; link: (url: string) => void }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const retry = () => {
    setState('loading');
    setAttempt((a) => a + 1);
  };
  const src = mediaUrl(f.url);

  if (kind === 'image' || kind === 'video' || kind === 'audio') {
    if (!src) return <Problem text="This file cannot be shown here." f={f} link={link} />;
    if (state === 'failed') return <Problem text={`${f.filename} could not be loaded.`} onRetry={retry} f={f} link={link} />;
    const done = () => setState('ready');
    const failed = () => setState('failed');
    return (
      <>
        {state === 'loading' ? <Spinner label="Loading…" className="absolute" /> : null}
        {kind === 'image' ? (
          <img
            key={attempt}
            src={src}
            alt={f.filename}
            onLoad={done}
            onError={failed}
            draggable={false}
            style={{ transform: `rotate(${turn}deg)${zoom === 'fit' ? '' : ` scale(${zoom})`}` }}
            className={cx('origin-center transition-transform select-none', zoom === 'fit' ? 'max-h-full max-w-full object-contain' : 'max-w-none', state !== 'ready' && 'invisible')}
          />
        ) : kind === 'video' ? (
          <video key={attempt} src={src} poster={mediaUrl(f.poster_url) ?? undefined} controls preload="metadata" onLoadedMetadata={done} onError={failed} className={cx('max-h-full max-w-full rounded-[8px] bg-black', state !== 'ready' && 'invisible')} />
        ) : (
          <div className={cx('flex w-full max-w-[520px] flex-col items-center gap-4', state !== 'ready' && 'invisible')}>
            <Icon name="audio-lines" size={48} className="text-[#AFC0E8]" />
            <audio key={attempt} src={src} controls preload="metadata" onLoadedMetadata={done} onError={failed} className="w-full" />
          </div>
        )}
      </>
    );
  }
  if (kind === 'csv' || kind === 'text') return <TextBody key={attempt} f={f} kind={kind} link={link} onRetry={retry} />;
  return <Problem text="There is no preview for this kind of file. Download it, or open it in an app on this computer." f={f} link={link} />;
}

function TextBody({ f, kind, link, onRetry }: { f: Attachment; kind: 'csv' | 'text'; link: (url: string) => void; onRetry: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const url = readUrl(f);
  const tooBig = f.size > TEXT_LIMIT;
  useEffect(() => {
    if (!url || tooBig) return;
    const ctrl = new AbortController();
    fetch(url, { signal: ctrl.signal })
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) throw new Error('You no longer have access to this file.');
        if (!r.ok) throw new Error(`${f.filename} could not be loaded (${r.status}).`);
        return new TextDecoder('utf-8').decode(await r.arrayBuffer());
      })
      .then(setText)
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setProblem(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
  }, [url, tooBig, f.filename]);

  if (!url) return <Problem text="This file cannot be shown here." f={f} link={link} />;
  if (tooBig) return <Problem text={`${f.filename} is too large to preview (${bytes(f.size)}).`} f={f} link={link} />;
  if (problem) return <Problem text={problem} onRetry={onRetry} f={f} link={link} />;
  if (text === null) return <Spinner label="Loading…" />;
  if (kind === 'text') {
    return <pre className="h-full w-full max-w-[1100px] self-stretch overflow-auto rounded-[10px] border border-[#1E2C57] bg-[#0F1B3D] p-4 font-mono text-[12.5px] leading-[1.55] whitespace-pre-wrap break-words selectable">{text}</pre>;
  }
  const rows = parseCsv(text, /\.tsv$/i.test(f.filename) || f.mime === 'text/tab-separated-values' ? '\t' : ',');
  const [head, ...body] = rows;
  const shown = body.slice(0, CSV_ROWS);
  return (
    <div className="flex h-full w-full flex-col self-stretch">
      <div className="min-h-0 flex-1 overflow-auto rounded-[10px] border border-[#1E2C57] bg-[#F7F9FD] text-[#1B2338] dark:bg-[#0F1B3D] dark:text-[#E6ECFA]">
        <table className="min-w-full border-collapse text-[12.5px] selectable">
          {head ? (
            <thead className="sticky top-0 bg-[#E8ECFA] dark:bg-[#1A2A55]">
              <tr>
                {head.map((h, c) => (
                  <th key={c} scope="col" className="border-b border-[#C9D2EE] px-3 py-2 text-left font-bold whitespace-nowrap dark:border-[#2A3A66]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {shown.map((r, n) => (
              <tr key={n} className="odd:bg-black/[.025] dark:odd:bg-white/[.03]">
                {r.map((v, c) => (
                  <td key={c} className="border-b border-[#E1E6F3] px-3 py-1.5 align-top whitespace-pre-wrap dark:border-[#1E2C57]">
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px] text-[#AFC0E8]">
        {body.length > CSV_ROWS ? `The first ${CSV_ROWS.toLocaleString()} of ${body.length.toLocaleString()} rows. Download the file for all of them.` : `${body.length.toLocaleString()} row${body.length === 1 ? '' : 's'}`}
      </p>
    </div>
  );
}

/** CSV (RFC 4180): quoted fields, doubled quotes, line breaks inside quotes; `\r\n` or `\n` between rows. */
export function parseCsv(text: string, sep = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
