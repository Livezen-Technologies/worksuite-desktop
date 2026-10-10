import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { apiUrl } from '../core/api';
import { Icon } from './Icon';
import { IconButton, Spinner, cx } from './ui';
import { SlidesViewer } from '../modules/office/slides/SlidesViewer';

/**
 * A file shown inside WorkSuite (the tender reviewer's viewer): PDFs drawn by
 * pdf.js page by page on a canvas — no plugin, nothing of the document's own
 * script, links or forms run — pictures as they are, text as text. Anything
 * else (Word, Excel) says so and offers to open it in its own app.
 */
export type ViewKind = 'pdf' | 'image' | 'text' | 'slides' | 'other';

const IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const TEXT = /\.(txt|csv|md|json|xml|log)$/i;

export function viewKind(name: string, mime: string | null): ViewKind {
  const m = (mime ?? '').toLowerCase().split(';')[0]!.trim();
  if (m === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (/^image\/(png|jpe?g|gif|webp|bmp)$/.test(m) || IMAGE.test(name)) return 'image';
  if (m.startsWith('text/') || m === 'application/json' || TEXT.test(name)) return 'text';
  // A presentation: the slide viewer (#321), drawn by the Slides engine — slides, thumbnails, zoom and Present.
  if (m === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || /\.pptx$/i.test(name)) return 'slides';
  return 'other';
}

export const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** The next zoom step in or out from `z`, with "fit width" counted as where it is now. */
export function stepZoom(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOMS.find((s) => s > z + 0.001) ?? ZOOMS[ZOOMS.length - 1]!;
  return [...ZOOMS].reverse().find((s) => s < z - 0.001) ?? ZOOMS[0]!;
}

interface Loaded {
  kind: ViewKind;
  blob: Blob;
  url: string;
}

/**
 * Reads a file through the app (the session's own credentials, the API proxy's rules) and shows it.
 * `url`: an address of the app's own to read instead (a copy kept on this computer); `onPage`: told
 * each PDF page as it comes into view (a lesson counting the pages read).
 */
/** How long the viewer waits for the file to start arriving before it says it couldn't open it (#253). */
export const OPEN_TIMEOUT_MS = 60_000;

export function FileViewer({ path, name, onOpen, onSave, url: source, onPage }: { path: string; name: string; onOpen?: () => void; onSave?: () => void; url?: string; onPage?: (page: number) => void }) {
  const [file, setFile] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let gone = false;
    let url: string | null = null;
    const ctl = new AbortController();
    // A file that never starts arriving is an error with Retry, never "Opening the file…" for ever (#253).
    const timer = setTimeout(() => ctl.abort(new DOMException('timeout', 'TimeoutError')), OPEN_TIMEOUT_MS);
    void (async () => {
      try {
        const res = await fetch(source ?? apiUrl(path), { cache: 'no-store', signal: ctl.signal });
        clearTimeout(timer);
        if (!res.ok) {
          let message = res.status === 403 ? 'You may not see this file.' : res.status === 404 ? 'The file is not there any more.' : `The server answered ${res.status}.`;
          try {
            message = ((await res.json()) as { message?: string }).message ?? message;
          } catch {
            /* not JSON */
          }
          throw new Error(message);
        }
        const blob = await res.blob();
        if (gone) return;
        url = URL.createObjectURL(blob);
        setFile({ kind: viewKind(name, res.headers.get('content-type') ?? blob.type), blob, url });
      } catch (e) {
        clearTimeout(timer);
        if (gone) return;
        const timedOut = ctl.signal.aborted;
        // To Diagnostics (the window's errors are logged): where it was read from, never the file's name.
        console.error('[file-viewer] could not open a file', { path: (source ?? path).split('?')[0], timedOut, error: e instanceof Error ? e.message.slice(0, 200) : String(e) });
        setError(timedOut ? 'The file took too long to arrive.' : e instanceof Error && e.message && !/^(Failed to fetch|NetworkError|Load failed)/i.test(e.message) ? e.message : 'The file could not be read.');
      }
    })();
    return () => {
      gone = true;
      clearTimeout(timer);
      ctl.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, name, source, attempt]);

  const retry = () => {
    setError(null);
    setFile(null);
    setAttempt((n) => n + 1);
  };

  if (error) return <Unshown icon="alert" title="Couldn't open this file" hint={error} onRetry={retry} onOpen={onOpen} onSave={onSave} />;
  if (!file) return <Spinner label="Opening the file…" className="h-full" />;
  if (file.kind === 'pdf') return <PdfView blob={file.blob} name={name} onPage={onPage} />;
  if (file.kind === 'image') return <ImageView url={file.url} name={name} />;
  if (file.kind === 'text') return <TextView blob={file.blob} />;
  if (file.kind === 'slides') return <SlidesViewer name={name} load={async () => new Uint8Array(await file.blob.arrayBuffer())} onDownload={onSave} onOpenInOffice={onOpen} />;
  return <Unshown icon="file" title={`${name} can't be shown inside WorkSuite`} hint="Word, Excel and other files open in the app they belong to." onOpen={onOpen} onSave={onSave} />;
}

function Unshown({ icon, title, hint, onRetry, onOpen, onSave }: { icon: string; title: string; hint: string; onRetry?: () => void; onOpen?: () => void; onSave?: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center" role={onRetry ? 'alert' : undefined}>
      <Icon name={icon} size={34} className="text-ink-3" />
      <b className="text-[15px] text-ink">{title}</b>
      <p className="m-0 max-w-[420px] text-[13px] text-ink-2">{hint}</p>
      <div className="flex gap-2">
        {onRetry ? (
          <button type="button" onClick={onRetry} className="h-9 rounded-[8px] bg-primary px-4 text-[13px] font-bold text-white hover:bg-primary-hover">
            Retry
          </button>
        ) : null}
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className={onRetry ? 'h-9 rounded-[8px] border border-line px-4 text-[13px] font-semibold text-ink hover:bg-subtle' : 'h-9 rounded-[8px] bg-primary px-4 text-[13px] font-bold text-white hover:bg-primary-hover'}
          >
            Open in its app
          </button>
        ) : null}
        {onSave ? (
          <button type="button" onClick={onSave} className="h-9 rounded-[8px] border border-line px-4 text-[13px] font-semibold text-ink hover:bg-subtle">
            Save a copy
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ImageView({ url, name }: { url: string; name: string }) {
  const [actual, setActual] = useState(false);
  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <button type="button" onClick={() => setActual(!actual)} className="h-7 rounded-[7px] border border-line px-2.5 text-[12px] font-semibold text-ink hover:bg-subtle">
          {actual ? 'Fit' : '100%'}
        </button>
      </Toolbar>
      <div className={cx('min-h-0 flex-1 overflow-auto bg-[#E9ECF2] p-4 scroll-thin dark:bg-black/30', !actual && 'flex items-center justify-center')}>
        <img src={url} alt={name} className={cx('shadow-md', actual ? 'max-w-none' : 'max-h-full max-w-full object-contain')} />
      </div>
    </div>
  );
}

function TextView({ blob }: { blob: Blob }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    void blob
      .slice(0, 512 * 1024)
      .text()
      .then(setText, () => setText(''));
  }, [blob]);
  if (text === null) return <Spinner />;
  return <pre className="m-0 h-full overflow-auto bg-surface p-4 font-mono text-[12.5px] leading-[1.55] whitespace-pre-wrap text-ink selectable scroll-thin">{text}</pre>;
}

function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 text-[12.5px] text-ink-2">{children}</div>;
}

/** pdf.js, loaded the first time a PDF is shown so the rest of the app does not carry it. */
async function pdfjs() {
  const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  return lib;
}

function PdfView({ blob, name, onPage }: { blob: Blob; name: string; onPage?: (page: number) => void }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [width, setWidth] = useState(800);
  const [page, setPage] = useState(1);
  const [pageWidth, setPageWidth] = useState(612);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let gone = false;
    let loaded: PDFDocumentProxy | null = null;
    void (async () => {
      try {
        const lib = await pdfjs();
        const data = new Uint8Array(await blob.arrayBuffer());
        // The document's own script, forms and fonts from elsewhere never run or load.
        loaded = await lib.getDocument({ data, enableXfa: false, disableAutoFetch: true, useSystemFonts: true }).promise;
        const first = await loaded.getPage(1);
        if (gone) return;
        setPageWidth(first.getViewport({ scale: 1 }).width);
        setDoc(loaded);
      } catch (e) {
        if (!gone) setError(e instanceof Error && /password/i.test(e.message) ? 'This PDF is protected with a password.' : 'This PDF could not be read.');
      }
    })();
    return () => {
      gone = true;
      void loaded?.loadingTask.destroy();
    };
  }, [blob]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [doc]);

  // Whoever counts the pages read hears of each one as it is shown.
  useEffect(() => {
    if (doc) onPage?.(page);
  }, [doc, page, onPage]);

  const scale = zoom === 'fit' ? Math.max(0.3, (width - 48) / pageWidth) : zoom;
  const go = (n: number) => {
    const target = scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
    target?.scrollIntoView({ block: 'start' });
  };

  if (error) return <Unshown icon="alert" title={error} hint={name} />;
  if (!doc) return <Spinner label="Reading the PDF…" className="h-full" />;
  return (
    <div className="flex h-full flex-col">
      <Toolbar>
        <span className="tabular-nums">
          Page{' '}
          <input
            aria-label="Page"
            value={page}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && n <= doc.numPages) go(n);
            }}
            className="h-6 w-10 rounded-[6px] border border-line bg-surface text-center tabular-nums outline-none focus:border-primary"
          />{' '}
          of {doc.numPages}
        </span>
        <span className="flex-1" />
        <IconButton icon="minus" label="Zoom out" size={14} onClick={() => setZoom(stepZoom(scale, -1))} />
        <span className="w-12 text-center tabular-nums">{Math.round(scale * 100)}%</span>
        <IconButton icon="plus" label="Zoom in" size={14} onClick={() => setZoom(stepZoom(scale, 1))} />
        <button type="button" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')} className={cx('h-7 rounded-[7px] border px-2.5 text-[12px] font-semibold', zoom === 'fit' ? 'border-primary text-primary' : 'border-line text-ink hover:bg-subtle')}>
          Fit width
        </button>
      </Toolbar>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-auto bg-[#E9ECF2] py-4 scroll-thin dark:bg-black/30"
        onScroll={(e) => {
          // The page whose top is nearest the top of the view is the one being read.
          const top = e.currentTarget.getBoundingClientRect().top;
          const pages = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-page]'));
          const current = pages.find((p) => p.getBoundingClientRect().bottom > top + 40);
          if (current) setPage(Number(current.dataset.page));
        }}
      >
        <div className="flex flex-col items-center gap-4">
          {Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage key={i} doc={doc} n={i + 1} scale={scale} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** One page, drawn when it comes near the view and again when the zoom changes. */
function PdfPage({ doc, n, scale }: { doc: PDFDocumentProxy; n: number; scale: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(n <= 2);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = holder.current;
    if (!el || near) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    void doc.getPage(n).then((p) => {
      if (cancelled) return;
      const vp = p.getViewport({ scale });
      setSize({ w: Math.floor(vp.width), h: Math.floor(vp.height) });
      const c = canvas.current;
      if (!near || !c) return;
      const ratio = window.devicePixelRatio || 1;
      c.width = Math.floor(vp.width * ratio);
      c.height = Math.floor(vp.height * ratio);
      const ctx = c.getContext('2d');
      if (!ctx) return;
      task = p.render({ canvas: c, canvasContext: ctx, viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      task.promise.catch(() => undefined);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, n, scale, near]);

  return (
    <div ref={holder} data-page={n} className="bg-white shadow-md" style={size ? { width: size.w, height: size.h } : { width: 600, height: 800 }} aria-label={`Page ${n}`}>
      {near ? <canvas ref={canvas} style={size ? { width: size.w, height: size.h } : undefined} /> : null}
    </div>
  );
}
