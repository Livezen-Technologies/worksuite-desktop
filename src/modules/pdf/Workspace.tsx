import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { activeContentBlocked, clampZoom, nextZoom, VIEW_MODES, ZOOM_STEPS, type PdfLinkView, type PdfSearchOptions, type PdfSessionView, type PdfSource, type PdfViewMode } from '@shared/pdf';
import { call, errorMessage } from '../../core/bridge';
import { registerCommand } from '../../core/commands';
import { toast } from '../../core/toasts';
import { useTab, useTabTitle } from '../../core/tab-context';
import { Icon } from '../../components/Icon';
import { Button, Chip, FileBadge, Spinner, cx } from '../../components/ui';
import { PdfCanvas, type Jump } from './Canvas';
import { onSearch, onSession, pdf, routeFor } from './client';
import { Failure, PasswordPrompt, PrintDialog } from './Dialogs';
import { fitZoom } from './layout';
import { Attachments, Bookmarks, DriveDetails, LeftTabs, Properties, RightTabs, SearchPanel, Thumbnails, type LeftPanel, type RightPanel, type SearchState } from './Panels';

/**
 * One PDF in a WorkSuite tab (§4): the title bar with its save state, the
 * ribbon (only this version's commands; the rest arrive with editing), the
 * navigation panel, the canvas, the properties panel and the status bar.
 */
export interface WorkspaceActions {
  find: (advanced: boolean) => void;
  print: () => void;
  save: () => void;
  zoom: (dir: 1 | -1) => void;
  tool: (t: 'select' | 'hand') => void;
}

type Fit = 'width' | 'page' | 'auto' | null;
type RibbonTab = 'home' | 'view' | 'review';

const MODE_LABEL: Record<PdfViewMode, { label: string; icon: string }> = {
  single: { label: 'Single page', icon: 'file' },
  continuous: { label: 'Continuous', icon: 'layout-strip' },
  'two-page': { label: 'Two pages', icon: 'layout-side' },
  'two-page-continuous': { label: 'Two pages, continuous', icon: 'grid' },
};

const EMPTY_SEARCH: SearchState = {
  query: '',
  options: { matchCase: false, wholeWord: false, regex: false, comments: false, bookmarks: false },
  searchId: null,
  hits: [],
  pagesDone: 0,
  done: false,
  truncated: false,
  error: null,
  active: -1,
};

function RibbonButton({ icon, label, onClick, disabled, why, active, shortcut }: { icon: string; label: string; onClick?: () => void; disabled?: boolean; why?: string | null; active?: boolean; shortcut?: string }) {
  const off = disabled || !!why;
  return (
    <button
      type="button"
      onClick={off ? undefined : onClick}
      aria-disabled={off || undefined}
      aria-pressed={active === undefined ? undefined : active}
      title={why ?? (shortcut ? `${label} (${shortcut})` : label)}
      className={cx('flex h-[52px] min-w-[54px] flex-col items-center justify-center gap-0.5 rounded-[8px] px-1.5 text-[11.5px] font-semibold', off ? 'cursor-not-allowed text-ink-3 opacity-50' : active ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle hover:text-ink')}
    >
      <Icon name={icon} size={18} />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

const Sep = () => <span className="mx-1 h-9 w-px shrink-0 bg-line" />;

export function Workspace({ source }: { source: PdfSource }) {
  const { navigate, active } = useTab();
  const [view, setView] = useState<PdfSessionView | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState<Fit>('auto');
  const [mode, setMode] = useState<PdfViewMode>('continuous');
  const [tool, setTool] = useState<'select' | 'hand'>('select');
  const [left, setLeft] = useState<LeftPanel | null>('pages');
  const [right, setRight] = useState<RightPanel | null>(null);
  const [tab, setTab] = useState<RibbonTab>('home');
  const [viewport, setViewport] = useState({ w: 900, h: 700 });
  const [jump, setJump] = useState<Jump | null>(null);
  const [search, setSearch] = useState<SearchState>(EMPTY_SEARCH);
  const [advanced, setAdvanced] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [bannerHidden, setBannerHidden] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [presentation, setPresentation] = useState<{ mode: PdfViewMode; fit: Fit } | null>(null);
  const [readMode, setReadMode] = useState(false);
  const [pageText, setPageText] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const searchId = useRef<string | null>(null);
  const key = routeFor(source);

  useTabTitle(view?.name ?? 'PDF Studio');

  // The session: opened with the tab, closed with it.
  useEffect(() => {
    let live = true;
    let id: string | null = null;
    pdf.open(source).then(
      (v) => {
        if (!live) {
          void pdf.close(v.id).catch(() => undefined);
          return;
        }
        id = v.id;
        setView(v);
      },
      (e) => live && setOpenError(errorMessage(e)),
    );
    return () => {
      live = false;
      if (id) void pdf.close(id).catch(() => undefined);
    };
    // `key` is the source, as a string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const id = view?.id ?? null;
  useEffect(() => {
    if (!id) return;
    const off = onSession(id, setView);
    // Whatever changed before this listener was there.
    void pdf.state(id).then(setView, () => undefined);
    return off;
  }, [id]);

  useEffect(() => {
    if (!id) return;
    return onSearch(id, (p) => {
      if (p.searchId !== searchId.current) return;
      setSearch((s) => ({ ...s, hits: p.hits.length ? [...s.hits, ...p.hits] : s.hits, pagesDone: p.pagesDone, done: p.done, truncated: p.truncated, error: p.error, active: s.active < 0 && p.hits.length ? 0 : s.active }));
    });
  }, [id]);

  const ready = view?.state === 'ready' ? view : null;
  const effectiveZoom = useMemo(() => {
    if (!ready || !fit) return zoom;
    if (fit === 'auto') return Math.min(1.5, fitZoom(ready.pages, page, mode, viewport.w, viewport.h, 'width'));
    return fitZoom(ready.pages, page, mode, viewport.w, viewport.h, fit);
  }, [ready, fit, zoom, page, mode, viewport.w, viewport.h]);

  const onViewport = useCallback((w: number, h: number) => setViewport({ w, h }), []);

  const goTo = useCallback((p: number, y?: number) => {
    setPage(p);
    setJump((j) => ({ page: p, ...(y !== undefined ? { y } : {}), n: (j?.n ?? 0) + 1 }));
  }, []);

  const setZoomTo = (z: number) => {
    setFit(null);
    setZoom(clampZoom(z));
  };

  const runSearch = () => {
    if (!ready) return;
    const q = search.query.trim();
    if (!q) return;
    // Enter again on the same search: the next result.
    if (search.searchId && search.done && search.hits.length) {
      const next = (search.active + 1) % search.hits.length;
      pick(next);
      return;
    }
    void call('pdf:search', { session: ready.id, query: q, options: search.options }).then(
      (r) => {
        searchId.current = r.searchId;
        setSearch((s) => ({ ...s, searchId: r.searchId, hits: [], pagesDone: 0, done: false, truncated: false, error: null, active: -1 }));
      },
      (e) => setSearch((s) => ({ ...s, error: errorMessage(e) })),
    );
  };

  const pick = (i: number) => {
    const h = search.hits[i];
    if (!h) return;
    setSearch((s) => ({ ...s, active: i }));
    goTo(h.page, h.rects[0]?.[1]);
  };

  const find = (adv: boolean) => {
    setLeft('search');
    if (adv) setAdvanced(true);
    setTimeout(() => findInput.current?.focus(), 0);
  };

  const onLink = (p: number, l: PdfLinkView) => {
    if (!ready) return;
    if (l.kind === 'page' && l.page !== undefined) return goTo(l.page);
    void call('pdf:followLink', { session: ready.id, page: p, index: l.index }).then(
      (r) => r.reason && toast('warning', r.reason),
      (e) => toast('error', errorMessage(e)),
    );
  };

  const download = () => {
    if (!ready) return;
    const s = source;
    const req = s.kind === 'drive' ? { fileId: String(s.fileId), name: ready.name } : s.kind === 'mail' ? { mail: { uid: s.uid, ref: s.ref, folder: s.folder, mailbox: s.mailbox }, name: ready.name } : null;
    if (!req) return;
    void call('transfers:download', req).then(
      () => toast('info', `Downloading ${ready.name} — see Transfers.`),
      (e) => toast('error', errorMessage(e)),
    );
  };

  const save = () => toast('info', ready?.readOnly ?? 'This PDF is open read-only.');

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void root.current?.requestFullscreen?.().catch(() => undefined);
  };

  const startPresentation = () => {
    setPresentation({ mode, fit });
    setMode('single');
    setFit('page');
    void root.current?.requestFullscreen?.().catch(() => undefined);
  };

  // Leaving full screen ends a presentation, and puts the view back as it was.
  const presenting = useRef(presentation);
  useEffect(() => {
    presenting.current = presentation;
  });
  useEffect(() => {
    const onChange = () => {
      const on = !!document.fullscreenElement && document.fullscreenElement === root.current;
      setFullscreen(on);
      const was = presenting.current;
      if (!on && was) {
        setMode(was.mode);
        setFit(was.fit);
        setPresentation(null);
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // §4.3 shortcuts, through WorkSuite's shortcut registry while this tab is in front; they act on the latest state.
  const commandsRef = useRef<WorkspaceActions | null>(null);
  useEffect(() => {
    commandsRef.current = {
      find,
      print: () => (ready && !ready.gates.print ? setPrinting(true) : toast('warning', ready?.gates.print ?? 'Open a PDF first.')),
      save,
      zoom: (dir) => setZoomTo(nextZoom(effectiveZoom, dir)),
      tool: (t) => setTool(t),
    };
  });
  useEffect(() => {
    if (!active) return;
    const a = () => commandsRef.current;
    const cmd = (cid: string, label: string, run: () => void, hidden = false) => registerCommand({ id: cid, label, group: 'Module', source: 'module', keywords: 'pdf', run, hidden });
    const offs = [
      cmd('pdf-find', 'Find in this PDF', () => a()?.find(false)),
      cmd('pdf-find-advanced', 'Search this PDF, its comments and bookmarks', () => a()?.find(true)),
      cmd('pdf-print', 'Print this PDF', () => a()?.print()),
      cmd('pdf-save', 'Save this PDF', () => a()?.save()),
      cmd('pdf-zoom-in', 'Zoom in', () => a()?.zoom(1)),
      cmd('pdf-zoom-in-alt', 'Zoom in', () => a()?.zoom(1), true),
      cmd('pdf-zoom-in-pad', 'Zoom in', () => a()?.zoom(1), true),
      cmd('pdf-zoom-out', 'Zoom out', () => a()?.zoom(-1)),
      cmd('pdf-hand', 'Hand tool', () => a()?.tool('hand'), true),
      cmd('pdf-select', 'Select tool', () => a()?.tool('select'), true),
    ];
    return () => offs.forEach((off) => off());
  }, [active]);

  if (openError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex max-w-[420px] flex-col items-center gap-3 text-center">
          <Icon name="alert" size={28} className="text-danger" />
          <p className="text-[13px] text-ink-2">{openError}</p>
          <Button onClick={() => navigate('/pdf')}>Back to PDF Studio</Button>
        </div>
      </div>
    );
  }
  if (!view) return <Spinner label="Opening…" />;

  const bar = (content: ReactNode) => <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1 scroll-thin">{content}</div>;
  const chrome = !presentation && !readMode;
  const s = view.security;
  const blocked = activeContentBlocked(s);
  const found = [s.javascript && `${s.javascript} script${s.javascript === 1 ? '' : 's'}`, s.launchActions && `${s.launchActions} launch action${s.launchActions === 1 ? '' : 's'}`, s.otherActions && `${s.otherActions} other action${s.otherActions === 1 ? '' : 's'}`, s.embeddedFiles && `${s.embeddedFiles} embedded file${s.embeddedFiles === 1 ? '' : 's'}`, s.xfa && 'XFA form code'].filter(Boolean).join(', ');
  const zoomPct = Math.round(effectiveZoom * 100);
  const n = view.pageCount;

  return (
    <div ref={root} className={cx('flex h-full min-h-0 flex-col', presentation ? 'bg-black' : 'bg-ground')}>
      {chrome ? (
        <>
          {/* Title bar (PDF-UI-003): the file, where it lives and its save state. */}
          <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line bg-surface px-3">
            <FileBadge name={view.name.endsWith('.pdf') ? view.name : `${view.name}.pdf`} size={26} />
            <b className="min-w-0 truncate text-[14px] text-ink">{view.name}</b>
            <span className="text-[12px] text-ink-3">{view.source.label}{view.source.version ? ` · v${view.source.version}` : ''}</span>
            {view.state === 'ready' ? <span title={view.readOnly}><Chip tone="muted"><Icon name="eye" size={12} /> Read only</Chip></span> : null}
            <span className="flex-1" />
            {ready && !ready.gates.download ? <Button size="sm" icon="download" onClick={download}>Download</Button> : null}
            {ready ? <Button size="sm" icon="printer" disabled={!!ready.gates.print} title={ready.gates.print ?? 'Print (Ctrl/⌘ P)'} onClick={() => setPrinting(true)}>Print</Button> : null}
          </div>
          {view.lock && !view.lock.mine ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-line bg-selection px-3 py-1.5 text-[12.5px] text-primary">
              <Icon name="lock" size={14} /> {view.lock.holder} is editing this PDF. You are viewing the last saved version.
            </div>
          ) : null}
          {/* Ribbon (§4.1): this version's commands; the others arrive with editing. */}
          <div role="tablist" aria-label="Ribbon" className="flex shrink-0 gap-1 bg-surface px-2 pt-1">
            {(['home', 'view', ...(view.source.kind === 'drive' ? ['review'] : [])] as RibbonTab[]).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('rounded-t-[7px] px-3 py-1 text-[12.5px] font-semibold', tab === t ? 'bg-subtle text-ink' : 'text-ink-3 hover:text-ink')}>
                {t === 'home' ? 'Home' : t === 'view' ? 'View' : 'Review'}
              </button>
            ))}
          </div>
          {bar(
            tab === 'home' ? (
              <>
                <RibbonButton icon="pointer" label="Select" shortcut="V" active={tool === 'select'} onClick={() => setTool('select')} />
                <RibbonButton icon="maximize" label="Hand" shortcut="H" active={tool === 'hand'} onClick={() => setTool('hand')} />
                <Sep />
                <RibbonButton icon="zoom-out" label="Zoom out" shortcut="Ctrl/⌘ −" disabled={!ready} onClick={() => setZoomTo(nextZoom(effectiveZoom, -1))} />
                <RibbonButton icon="zoom-in" label="Zoom in" shortcut="Ctrl/⌘ +" disabled={!ready} onClick={() => setZoomTo(nextZoom(effectiveZoom, 1))} />
                <RibbonButton icon="search" label="Find" shortcut="Ctrl/⌘ F" disabled={!ready} onClick={() => find(false)} />
                <Sep />
                <RibbonButton icon="printer" label="Print" shortcut="Ctrl/⌘ P" disabled={!ready} why={ready?.gates.print} onClick={() => setPrinting(true)} />
                {view.source.kind !== 'local' ? <RibbonButton icon="download" label="Download" disabled={!ready} why={ready?.gates.download} onClick={download} /> : null}
                <RibbonButton icon="disk" label="Save" why={view.readOnly} />
              </>
            ) : tab === 'view' ? (
              <>
                {VIEW_MODES.map((m) => (
                  <RibbonButton key={m} icon={MODE_LABEL[m].icon} label={MODE_LABEL[m].label} active={mode === m} onClick={() => setMode(m)} />
                ))}
                <Sep />
                <RibbonButton icon="scaling" label="Fit width" active={fit === 'width'} onClick={() => setFit('width')} />
                <RibbonButton icon="fullscreen" label="Fit page" active={fit === 'page'} onClick={() => setFit('page')} />
                <RibbonButton icon="file" label="Actual size" active={!fit && zoom === 1} onClick={() => setZoomTo(1)} />
                <Sep />
                <RibbonButton icon={fullscreen ? 'fullscreen-exit' : 'fullscreen'} label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen} />
                <RibbonButton icon="play" label="Present" disabled={!ready} onClick={startPresentation} />
                <RibbonButton icon="book-open" label="Read mode" onClick={() => setReadMode(true)} />
                <Sep />
                <RibbonButton icon="panel-open" label="Navigation" active={!!left} onClick={() => setLeft(left ? null : 'pages')} />
                <RibbonButton icon="info" label="Properties" active={!!right} onClick={() => setRight(right ? null : 'properties')} />
              </>
            ) : (
              <>
                <RibbonButton icon="history" label="Versions" active={right === 'versions'} onClick={() => setRight('versions')} />
                <RibbonButton icon="activity" label="Activity" active={right === 'activity'} onClick={() => setRight('activity')} />
              </>
            ),
          )}
          {blocked && !bannerHidden && view.state === 'ready' ? (
            <div role="status" className="flex shrink-0 items-center gap-2 border-b border-line bg-warning-bg px-3 py-1.5 text-[12.5px] text-warning">
              <Icon name="shield-alert" size={15} />
              <span className="min-w-0 flex-1">Active content in this PDF was blocked: {found}. It never runs in WorkSuite.</span>
              <button type="button" className="font-semibold underline" onClick={() => setRight('properties')}>Details</button>
              <button type="button" aria-label="Hide" onClick={() => setBannerHidden(true)}><Icon name="x" size={14} /></button>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {chrome && left && ready ? (
          <aside aria-label="Navigation panel" className="flex w-[240px] shrink-0 flex-col border-e border-line bg-surface">
            <LeftTabs value={left} onChange={setLeft} />
            <div className="min-h-0 flex-1">
              {left === 'pages' ? <Thumbnails view={ready} page={page} onPage={(p) => goTo(p)} /> : null}
              {left === 'bookmarks' ? <Bookmarks view={ready} onGo={(p) => goTo(p)} /> : null}
              {left === 'search' ? (
                <SearchPanel
                  state={search}
                  pageCount={n}
                  advanced={advanced}
                  inputRef={findInput}
                  onQuery={(q) => setSearch((x) => ({ ...EMPTY_SEARCH, options: x.options, query: q }))}
                  onOptions={(o: PdfSearchOptions) => setSearch((x) => ({ ...EMPTY_SEARCH, query: x.query, options: o }))}
                  onRun={runSearch}
                  onPick={pick}
                />
              ) : null}
              {left === 'attachments' ? <Attachments view={ready} /> : null}
            </div>
          </aside>
        ) : null}

        <main className="flex min-w-0 flex-1 flex-col">
          {view.state === 'opening' ? <Spinner label={`Opening ${view.name}…`} /> : null}
          {view.state === 'password' ? <div className="flex flex-1 overflow-auto p-6"><PasswordPrompt view={view} onDone={setView} /></div> : null}
          {view.state === 'failed' ? (
            <div className="flex flex-1">
              <Failure view={view} onRetry={() => void call('pdf:retry', { session: view.id }).then(setView, (e) => toast('error', errorMessage(e)))} onReport={() => navigate('/pdf?view=diagnostics')} />
            </div>
          ) : null}
          {ready ? (
            <PdfCanvas
              session={ready.id}
              pages={ready.pages}
              zoom={effectiveZoom}
              mode={mode}
              page={page}
              tool={tool}
              hits={search.hits}
              activeHit={search.hits[search.active] ?? null}
              jump={jump}
              onPage={setPage}
              onZoom={setZoomTo}
              onLink={onLink}
              onViewport={onViewport}
              presentation={!!presentation}
            />
          ) : null}
        </main>

        {chrome && right && ready ? (
          <aside aria-label="Properties panel" className="flex w-[290px] shrink-0 flex-col border-s border-line bg-surface">
            <RightTabs value={right} drive={ready.source.kind === 'drive'} onChange={setRight} />
            <div className="min-h-0 flex-1">
              {right === 'properties' ? <Properties view={ready} page={page} /> : <DriveDetails view={ready} tab={right} />}
            </div>
          </aside>
        ) : null}
      </div>

      {/* Status bar (PDF-VIEW-004): page n / N (editable), zoom, fit and Find. */}
      {!presentation ? (
        <div className="flex h-9 shrink-0 items-center gap-1.5 border-t border-line bg-surface px-3 text-[12.5px] text-ink-2">
          {readMode ? <Button size="sm" icon="x" onClick={() => setReadMode(false)}>Leave read mode</Button> : null}
          <button type="button" aria-label="Previous page" disabled={!ready || page <= 0} onClick={() => goTo(Math.max(0, page - 1))} className="rounded-[6px] px-1.5 hover:bg-subtle disabled:opacity-40"><Icon name="chevron-left" size={15} /></button>
          <span>Page</span>
          <input
            aria-label="Page number"
            disabled={!ready}
            value={pageText ?? String(page + 1)}
            onFocus={() => setPageText(String(page + 1))}
            onChange={(e) => setPageText(e.target.value.replace(/[^\d]/g, '').slice(0, 7))}
            onBlur={() => setPageText(null)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const p = Number(pageText);
              if (p >= 1 && p <= n) goTo(p - 1);
              setPageText(null);
              (e.target as HTMLInputElement).blur();
            }}
            className="h-6 w-12 rounded-[6px] border border-line bg-surface text-center text-ink tabular outline-none focus:border-primary"
          />
          <span className="tabular">/ {n || '—'}</span>
          <button type="button" aria-label="Next page" disabled={!ready || page >= n - 1} onClick={() => goTo(Math.min(n - 1, page + 1))} className="rounded-[6px] px-1.5 hover:bg-subtle disabled:opacity-40"><Icon name="chevron-right" size={15} /></button>
          <span className="flex-1" />
          <button type="button" aria-label="Zoom out" disabled={!ready} onClick={() => setZoomTo(nextZoom(effectiveZoom, -1))} className="rounded-[6px] px-1.5 hover:bg-subtle disabled:opacity-40"><Icon name="minus" size={14} /></button>
          <select
            aria-label="Zoom"
            disabled={!ready}
            value={fit ? `fit-${fit}` : String(zoom)}
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith('fit-')) setFit(v.slice(4) as Fit);
              else setZoomTo(Number(v));
            }}
            className="h-6 rounded-[6px] border border-line bg-surface px-1 text-ink tabular"
          >
            {fit ? <option value={`fit-${fit}`}>{zoomPct}%</option> : null}
            {!fit && !ZOOM_STEPS.includes(zoom) ? <option value={String(zoom)}>{zoomPct}%</option> : null}
            {ZOOM_STEPS.map((z) => (
              <option key={z} value={String(z)}>{Math.round(z * 100)}%</option>
            ))}
            <option value="fit-width">Fit width</option>
            <option value="fit-page">Fit page</option>
          </select>
          <button type="button" aria-label="Zoom in" disabled={!ready} onClick={() => setZoomTo(nextZoom(effectiveZoom, 1))} className="rounded-[6px] px-1.5 hover:bg-subtle disabled:opacity-40"><Icon name="plus" size={14} /></button>
          <button type="button" onClick={() => setFit('width')} disabled={!ready} className={cx('rounded-[6px] px-2 py-0.5 hover:bg-subtle disabled:opacity-40', fit === 'width' && 'bg-selection text-primary')}>Fit width</button>
          <button type="button" onClick={() => setFit('page')} disabled={!ready} className={cx('rounded-[6px] px-2 py-0.5 hover:bg-subtle disabled:opacity-40', fit === 'page' && 'bg-selection text-primary')}>Fit page</button>
          <button type="button" onClick={() => find(false)} disabled={!ready} className="flex items-center gap-1 rounded-[6px] px-2 py-0.5 hover:bg-subtle disabled:opacity-40"><Icon name="search" size={13} /> Find</button>
        </div>
      ) : null}

      {printing && ready ? <PrintDialog view={ready} page={page} onClose={() => setPrinting(false)} /> : null}
    </div>
  );
}

