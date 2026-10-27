import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { parsePageRange, splitEvery, type PdfSearchHit, type PdfSearchProgress, type PdfSessionView, type PdfStamp, type PdfToolResult } from '@shared/pdf';
import { call, errorMessage } from '../../core/bridge';
import { useTab } from '../../core/tab-context';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Chip, cx } from '../../components/ui';
import { onSearch } from './client';
import { canUse, pdfEdit } from './edit';
import { batesNumber, CheckRow, Field, GapList, Input, Pick, ProBadge, Radios, Section, StatusChip, strength } from './parts';
import { GROUP_LABEL, NEEDS_LABEL, REDACT_PATTERNS, searchTools, toolById, type PdfTool, type ToolGroup, type ToolId } from './tools';

/**
 * The All tools panel and each tool's own left panel (DK02–DK15, PRO-FW-001/002):
 * opening a tool replaces the panel and the toolbar; "‹ All tools" goes back.
 * Panels run what this computer does with the PDF engine it ships (D-G12):
 * create from pictures or blank pages, combine, organise (duplicate, split),
 * export page images and text, protect and unlock a copy, redact, and stamp
 * Bates numbers, headers, footers and watermarks. What runs elsewhere says so —
 * "Needs the WorkSuite server" (PDF Studio Pro, with the Pro panel) or "Needs
 * WorkSuite Office" — instead of a button that is always off (PRO-FW-008).
 */
export interface ToolCtx {
  /** The open document, or null on a tool page with no document (Create, Combine, Actions…). */
  view: PdfSessionView | null;
  page: number;
  goTo: (page: number, y?: number) => void;
  /** Switch the ribbon (Organize, Annotate) and the right panel (comments). */
  ribbon: (tab: 'annotate' | 'organize') => void;
  showComments: () => void;
  /** The Pro panel (PDF Studio Pro on the server), for a Drive PDF. */
  showPro?: () => void;
  /** Another tool's panel. */
  openTool?: (id: ToolId) => void;
}

const GROUPS: ToolGroup[] = ['create', 'review', 'protect', 'advanced'];

export function AllToolsPanel({ onPick, onClose }: { onPick: (id: ToolId) => void; onClose?: () => void }) {
  const [q, setQ] = useState('');
  const found = searchTools(q);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
        <b className="flex-1 text-[14px] text-ink">All tools</b>
        {onClose ? (
          <button type="button" aria-label="Close All tools" onClick={onClose} className="rounded-[6px] p-1 text-ink-3 hover:bg-subtle hover:text-ink">
            <Icon name="x" size={15} />
          </button>
        ) : null}
      </div>
      <div className="shrink-0 px-3 py-2">
        <div className="flex items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5">
          <Icon name="search" size={14} className="text-ink-3" />
          <input aria-label="Search tools" placeholder="Search tools" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3 scroll-thin">
        {GROUPS.map((g) => {
          const list = found.filter((t) => t.group === g);
          if (!list.length) return null;
          return (
            <div key={g} className="px-2">
              <div className="mt-2 px-1.5 pb-1 text-[11px] font-bold tracking-[.3px] text-ink-3 uppercase">{GROUP_LABEL[g]}</div>
              <ul role="list" aria-label={GROUP_LABEL[g]}>
                {list.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => onPick(t.id)} title={t.blurb} className="flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2 text-left text-[12.5px] font-medium text-ink hover:bg-subtle">
                      <Icon name={t.icon} size={15} className="shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1 truncate">{t.label}</span>
                      {t.pro ? <ProBadge note={t.proNote} /> : null}
                      {t.status !== 'ui' ? <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', t.status === 'ready' ? 'bg-success' : 'bg-primary')} title={t.status === 'ready' ? 'Ready' : 'Partly ready'} /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {!found.length ? <p className="px-4 py-3 text-[12.5px] text-ink-3">No tool matches “{q}”.</p> : null}
      </div>
    </div>
  );
}

/** One tool's panel, with "‹ All tools" above it. */
export function ToolPanel({ id, ctx, onBack }: { id: ToolId; ctx: ToolCtx; onBack: () => void }) {
  const tool = toolById(id);
  if (!tool) return null;
  const Body = BODIES[id];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-1 border-b border-line px-3 pt-2 pb-2.5">
        <button type="button" onClick={onBack} className="w-fit text-[12px] font-semibold text-primary hover:underline">
          ‹ All tools
        </button>
        <div className="flex items-center gap-2">
          <Icon name={tool.icon} size={17} className="text-primary" />
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink">{tool.label}</h2>
          {tool.pro ? <ProBadge note={tool.proNote} /> : null}
          <StatusChip tool={tool} />
        </div>
      </div>
      <Body tool={tool} ctx={ctx} />
    </div>
  );
}

type BodyProps = { tool: PdfTool; ctx: ToolCtx };

function Scroll({ children }: { children: React.ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">{children}</div>;
}

function Gap({ tool }: { tool: PdfTool }) {
  return (
    <div className="px-3.5 py-3">
      <GapList tool={tool} />
    </div>
  );
}

function NeedsDoc({ ctx }: { ctx: ToolCtx }) {
  return ctx.view ? null : <p className="mx-3.5 mt-3 rounded-[8px] bg-warning-bg px-3 py-2 text-[12px] text-warning">Open a PDF to use this tool on it.</p>;
}

// ── shared pieces of the tools that run here (D-G12) ─────────────────────

/** What a tool that makes a file says when it is done, with Open for a PDF made on this computer. */
function useMaker() {
  const { navigate } = useTab();
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<PdfToolResult | null>(null);
  const run = async (fn: () => Promise<PdfToolResult>, done: (r: PdfToolResult) => string) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.saved) {
        setMade(r);
        toast('success', done(r));
      }
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const result = made?.open ? (
    <p role="status" className="flex items-center gap-2 rounded-[8px] bg-success-bg px-3 py-2 text-[12px] text-success">
      <Icon name="check" size={14} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">Saved {made.name}</span>
      <button type="button" className="font-semibold underline" onClick={() => navigate(`/pdf?local=${made.open!.handle}`)}>
        Open it
      </button>
    </p>
  ) : made ? (
    <p role="status" className="flex items-center gap-2 rounded-[8px] bg-success-bg px-3 py-2 text-[12px] text-success">
      <Icon name="check" size={14} className="shrink-0" /> Saved {made.files} file{made.files === 1 ? '' : 's'} in {made.name}
    </p>
  ) : null;
  return { busy, run, result };
}

/** Where a change to the pages needs Edit: why not, and the switch to it. */
function EditGate({ ctx }: { ctx: ToolCtx }) {
  const v = ctx.view;
  if (!v || canUse(v, 'organize')) return null;
  return (
    <div className="mx-3.5 mt-3 flex flex-col gap-1.5 rounded-[8px] bg-warning-bg px-3 py-2 text-[12px] text-warning-ink">
      <span>{v.edit.canOrganize ? 'Changing the pages needs Edit, which takes the edit lock.' : (v.edit.reason ?? 'You cannot change this PDF.')}</span>
      {v.edit.canOrganize ? (
        <Button size="sm" className="self-start" onClick={() => void pdfEdit.mode(v.id, 'EDIT').catch((e) => toast('error', errorMessage(e)))}>
          Switch to Edit
        </Button>
      ) : null}
    </div>
  );
}

/** What part of a tool runs elsewhere, said plainly where a button that could never work used to be. */
function Needs({ tool, ctx, what }: { tool: PdfTool; ctx: ToolCtx; what?: string }) {
  const drive = ctx.view?.source.kind === 'drive';
  // The part that runs on the server is in the Pro panel, for a Drive PDF, wherever the tool works in part.
  const pro = tool.status === 'partial';
  return (
    <div data-needs={tool.needs} className="mx-3.5 mt-3 flex flex-col gap-1.5 rounded-[10px] border border-line bg-ground px-3 py-2.5 text-[12px] text-ink-2">
      <span className="flex items-center gap-1.5 font-bold text-ink">
        <Icon name={tool.needs === 'office' ? 'file-text' : 'server'} size={14} className="text-ink-3" />
        {NEEDS_LABEL[tool.needs ?? 'server']}
      </span>
      <span>{what ?? (pro ? 'This runs in PDF Studio Pro on the WorkSuite server, for PDFs kept in Drive.' : tool.missing[0])}</span>
      {pro && ctx.showPro ? (
        <Button size="sm" icon="sparkles" className="self-start" disabled={!drive} title={drive ? undefined : 'Open the PDF from Drive to use the Pro panel.'} onClick={ctx.showPro}>
          Open the Pro panel
        </Button>
      ) : null}
    </div>
  );
}

/** The bar of a tool that runs here: why it cannot run yet, if so, and the button. */
function Run({ label, why, busy, onRun, secondary }: { label: string; why?: string | null; busy?: boolean; onRun: () => void; secondary?: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-surface px-3.5 py-3">
      {why ? (
        <p className="flex items-start gap-1.5 text-[11.5px] leading-[1.45] text-ink-3">
          <Icon name="info" size={13} className="mt-[1px] shrink-0" />
          <span>{why}</span>
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        {secondary}
        <Button variant="primary" loading={busy} disabled={!!why || busy} onClick={onRun}>
          {label}
        </Button>
      </div>
    </div>
  );
}

const ALL_PAGES = (n: number) => Array.from({ length: n }, (_, i) => i);
/** Typed page numbers ("1-3, 5"), or every page when empty. */
const pagesOf = (text: string, count: number) => (text.trim() ? parsePageRange(text, count) : ALL_PAGES(count));

// ── Create & edit ────────────────────────────────────────────────────────

function CreateBody({ tool, ctx }: BodyProps) {
  const [src, setSrc] = useState<'images' | 'blank' | 'office'>('images');
  const [fit, setFit] = useState<'image' | 'a4' | 'letter'>('a4');
  const [paper, setPaper] = useState<'a4' | 'letter' | 'legal'>('a4');
  const [landscape, setLandscape] = useState(false);
  const [count, setCount] = useState('1');
  const [name, setName] = useState('New PDF.pdf');
  const m = useMaker();
  const n = Math.max(1, Math.min(500, Number(count) || 1));
  return (
    <>
      <Scroll>
        <Section title="From">
          <Radios
            label="Create from"
            value={src}
            onChange={setSrc}
            options={[
              { id: 'images', label: 'Pictures', hint: 'PNG or JPEG, one page each — made on this computer' },
              { id: 'blank', label: 'Blank pages', hint: 'Size and orientation' },
              { id: 'office', label: 'Word, Excel, PowerPoint or a web page', hint: 'Converted by WorkSuite Office' },
            ]}
          />
        </Section>
        {src === 'images' ? (
          <Section title="Pages">
            <Field label="Page size">
              <Pick label="Page size" value={fit} onChange={setFit} options={[{ id: 'a4', label: 'A4, the picture fitted' }, { id: 'letter', label: 'Letter, the picture fitted' }, { id: 'image', label: 'The picture’s own size' }]} />
            </Field>
          </Section>
        ) : src === 'blank' ? (
          <Section title="Pages">
            <div className="grid grid-cols-2 gap-1.5">
              <Field label="Paper"><Pick label="Paper" value={paper} onChange={setPaper} options={[{ id: 'a4', label: 'A4' }, { id: 'letter', label: 'Letter' }, { id: 'legal', label: 'Legal' }]} /></Field>
              <Field label="Pages"><Input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 3))} /></Field>
            </div>
            <CheckRow label="Landscape" checked={landscape} onChange={setLandscape} />
          </Section>
        ) : (
          <Needs tool={tool} ctx={ctx} what="Word, Excel and PowerPoint files and web pages are turned into PDFs by WorkSuite Office on the server; this computer does not convert them." />
        )}
        {src !== 'office' ? (
          <Section title="Save as">
            <Field label="File name"><Input value={name} onChange={(e) => setName(e.target.value.slice(0, 200))} /></Field>
            {m.result}
          </Section>
        ) : null}
        <Gap tool={tool} />
      </Scroll>
      {src !== 'office' ? (
        <Run
          label={src === 'images' ? 'Choose pictures…' : 'Create'}
          why={!name.trim() ? 'Name the file.' : null}
          busy={m.busy}
          onRun={() =>
            void m.run(
              () => call('pdf:compose', { req: src === 'images' ? { kind: 'images', fit, name: name.trim() } : { kind: 'blank', pages: n, size: paper, landscape, name: name.trim() } }),
              (r) => `Saved ${r.name}.`,
            )
          }
        />
      ) : null}
    </>
  );
}

function EditBody({ tool, ctx }: BodyProps) {
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        {ctx.view?.edit.lock?.mine ? <p className="mx-3.5 mt-3 flex items-center gap-1.5 text-[12px] font-semibold text-success"><Icon name="lock" size={13} /> You hold the edit lock</p> : null}
        <Section title="Page design">
          <p className="text-[12.5px] text-ink-2">Headers, footers, Page n of N, the date, Bates numbers and diagonal watermarks are stamped on the pages here, kept in the PDF and undone like any change.</p>
          <Button icon="hash" disabled={!ctx.view} onClick={() => ctx.openTool?.('bates')}>
            Header, footer & watermark…
          </Button>
        </Section>
        <Section title="Text and images">
          <p className="text-[12px] text-ink-3">Editing a PDF’s own text, images and links runs on the WorkSuite server: find and replace in the document’s font, with a preview, for Drive PDFs.</p>
        </Section>
        <Needs tool={tool} ctx={ctx} />
        <Gap tool={tool} />
      </Scroll>
    </>
  );
}

function ExportBody({ tool, ctx }: BodyProps) {
  const [fmt, setFmt] = useState<'png' | 'text' | 'office'>('png');
  const [dpi, setDpi] = useState<'72' | '150' | '300'>('150');
  const [range, setRange] = useState('');
  const m = useMaker();
  const v = ctx.view;
  const pages = v ? pagesOf(range, v.pageCount) : null;
  const why = !v ? 'Open a PDF first.' : !pages ? 'Those pages are not in this PDF (for example 1-3, 5).' : fmt === 'png' && pages.length > 500 ? 'At most 500 pages as images at once.' : null;
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        {v ? <p className="px-3.5 pt-3 text-[12px] text-ink-3">{v.name} · {v.pageCount} pages · {bytes(v.size)}</p> : null}
        <Section title="Export to">
          <Radios
            label="Format"
            value={fmt}
            onChange={setFmt}
            options={[
              { id: 'png', label: 'Images — PNG, one per page', hint: 'Made on this computer' },
              { id: 'text', label: 'Plain text (.txt)', hint: 'Made on this computer' },
              { id: 'office', label: 'Word, Excel, PowerPoint or HTML', hint: 'Converted by WorkSuite Office' },
            ]}
          />
        </Section>
        {fmt === 'office' ? (
          <Needs tool={tool} ctx={ctx} what="Word, Excel, PowerPoint and HTML are made from a PDF by WorkSuite Office on the server; this computer does not convert them." />
        ) : (
          <Section title="Pages">
            <Field label="Pages" hint="Empty for all of them, or for example 1-3, 5."><Input value={range} onChange={(e) => setRange(e.target.value.slice(0, 200))} placeholder="All" /></Field>
            {fmt === 'png' ? <Field label="Resolution"><Pick label="Resolution" value={dpi} onChange={setDpi} options={[{ id: '72', label: '72 dpi — screen' }, { id: '150', label: '150 dpi' }, { id: '300', label: '300 dpi — print' }]} /></Field> : null}
            {m.result}
          </Section>
        )}
        <Gap tool={tool} />
      </Scroll>
      {fmt !== 'office' ? (
        <Run
          label="Export"
          why={why}
          busy={m.busy}
          onRun={() => v && pages && void m.run(() => call('pdf:derive', { session: v.id, req: fmt === 'png' ? { kind: 'images', pages, dpi: Number(dpi) as 72 | 150 | 300 } : { kind: 'text', pages } }), (r) => (fmt === 'png' ? `Saved ${r.files} page images in ${r.name}.` : `Saved ${r.name}.`))}
        />
      ) : null}
    </>
  );
}

interface CombineItem {
  key: string;
  name: string;
  size: number;
  range: string;
}

function CombineBody({ tool, ctx }: BodyProps) {
  const [items, setItems] = useState<CombineItem[]>([]);
  const [bookmarks, setBookmarks] = useState(true);
  const [name, setName] = useState('Combined.pdf');
  const m = useMaker();
  const add = async () => {
    try {
      const picked = await call('pdf:pickLocal');
      setItems((l) => [...l, ...picked.map((p) => ({ key: p.handle, name: p.name, size: p.size, range: '' }))]);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const move = (i: number, d: -1 | 1) =>
    setItems((l) => {
      const n = [...l];
      const j = i + d;
      if (j < 0 || j >= n.length) return l;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  // Ranges are checked by the engine against each file; here only that they read as page numbers.
  const parts = items.map((it) => ({ it, pages: it.range.trim() ? parsePageRange(it.range, 100_000) : [] }));
  const bad = parts.find((p) => p.pages === null);
  const why = items.length < 2 ? 'Add at least two PDFs.' : bad ? `The pages of ${bad.it.name} do not read (for example 1-3, 5).` : !name.trim() ? 'Name the file.' : null;
  return (
    <>
      <Scroll>
        <Section title={`Files · ${items.length}`} aside={<Button size="sm" icon="plus" onClick={() => void add()}>Add from this computer</Button>}>
          {items.length ? (
            <ul aria-label="Files to combine" className="flex flex-col gap-1">
              {items.map((it, i) => (
                <li key={it.key} className="flex items-center gap-1.5 rounded-[8px] border border-line px-2 py-1.5 text-[12.5px]">
                  <Icon name="file-text" size={14} className="shrink-0 text-danger" />
                  <span className="min-w-0 flex-1 truncate" title={it.name}>{it.name}</span>
                  <input aria-label={`Pages of ${it.name}`} placeholder="All" value={it.range} onChange={(e) => setItems((l) => l.map((x) => (x.key === it.key ? { ...x, range: e.target.value.slice(0, 60) } : x)))} className="h-6 w-16 rounded-[6px] border border-line bg-surface px-1 text-[11.5px]" />
                  <button type="button" aria-label="Move up" onClick={() => move(i, -1)} className="text-ink-3 hover:text-ink"><Icon name="arrow-up" size={13} /></button>
                  <button type="button" aria-label="Move down" onClick={() => move(i, 1)} className="text-ink-3 hover:text-ink"><Icon name="arrow-down" size={13} /></button>
                  <button type="button" aria-label="Remove" onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))} className="text-ink-3 hover:text-danger"><Icon name="x" size={13} /></button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-ink-3">Add PDFs from this computer: they are combined here, in this order, into a new PDF.</p>
          )}
        </Section>
        <Section title="Options">
          <CheckRow label="Add a bookmark per file" checked={bookmarks} onChange={setBookmarks} />
          <Field label="Save as"><Input value={name} onChange={(e) => setName(e.target.value.slice(0, 200))} /></Field>
          {m.result}
        </Section>
        <Needs tool={tool} ctx={ctx} what="Word, Excel and image files are combined after WorkSuite Office converts them on the server." />
        <Gap tool={tool} />
      </Scroll>
      <Run
        label="Combine"
        why={why}
        busy={m.busy}
        onRun={() => void m.run(() => call('pdf:compose', { req: { kind: 'combine', parts: parts.map((p) => ({ file: p.it.key, ...(p.pages?.length ? { pages: p.pages } : {}), title: p.it.name.replace(/\.pdf$/i, '') })), bookmarks, name: name.trim() } }), (r) => `Combined into ${r.name}.`)}
      />
    </>
  );
}

function OrganizeBody({ tool, ctx }: BodyProps) {
  const v = ctx.view;
  const ok = !!v && canUse(v, 'organize');
  const [dup, setDup] = useState('');
  const [every, setEvery] = useState('1');
  const [busy, setBusy] = useState(false);
  const m = useMaker();
  const dupPages = v && dup.trim() ? parsePageRange(dup, v.pageCount) : null;
  const n = Math.max(1, Number(every) || 1);
  const duplicate = async () => {
    if (!v || !dupPages) return;
    setBusy(true);
    try {
      await pdfEdit.apply(v.id, { op: 'page.duplicate', pages: dupPages, at: Math.max(...dupPages) + 1 });
      toast('success', `${dupPages.length} page${dupPages.length === 1 ? '' : 's'} duplicated. Undo takes it back.`);
      setDup('');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        <Section title="Pages">
          <p className="text-[12.5px] text-ink-2">Select pages in the grid — click, Shift for a range, Ctrl/⌘ for more — then rotate, move, delete, insert or extract. Drag to reorder. Every change can be undone until you save.</p>
          <Button variant="primary" icon="grid" disabled={!v} onClick={() => ctx.ribbon('organize')}>
            Show the page grid
          </Button>
        </Section>
        <EditGate ctx={ctx} />
        <Section title="Duplicate">
          <Field label="Pages to duplicate" hint="The copies go after the last of them."><Input value={dup} onChange={(e) => setDup(e.target.value.slice(0, 100))} placeholder="e.g. 2, 4-5" /></Field>
          <Button size="sm" icon="copy" loading={busy} disabled={!ok || !dupPages || busy} onClick={() => void duplicate()}>Duplicate</Button>
        </Section>
        <Section title="Split into files">
          <Field label="Pages in each file"><Input inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value.replace(/\D/g, '').slice(0, 5))} /></Field>
          {v ? <p className="text-[11.5px] text-ink-3">{Math.ceil(v.pageCount / n)} files in a folder you choose; this PDF stays as it is.</p> : null}
          <Button size="sm" icon="scissors" disabled={!v || m.busy} loading={m.busy} onClick={() => v && void m.run(() => call('pdf:derive', { session: v.id, req: { kind: 'split', groups: splitEvery(v.pageCount, n) } }), (r) => `Split into ${r.files} files in ${r.name}.`)}>
            Split…
          </Button>
          {m.result}
        </Section>
        <Gap tool={tool} />
      </Scroll>
    </>
  );
}

function CommentBody({ tool, ctx }: BodyProps) {
  const v = ctx.view;
  const ok = !!v && canUse(v, 'annotate');
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        <Section title="Comment">
          <p className="text-[12.5px] text-ink-2">Highlight, underline, strike out, notes, text boxes, drawing, shapes and stamps — saved inside the PDF, so they open in any PDF reader. No lock needed.</p>
          {v && !ok ? <p className="text-[12px] text-warning">{v.edit.canAnnotate ? 'Switch to Annotate (top of the window) to comment.' : (v.edit.reason ?? 'You cannot comment on this PDF.')}</p> : null}
          <div className="flex gap-1.5">
            <Button variant="primary" icon="highlighter" disabled={!v} onClick={() => ctx.ribbon('annotate')}>Comment tools</Button>
            <Button icon="chat" disabled={!v} onClick={ctx.showComments}>Comments list</Button>
          </div>
        </Section>
        <Section title="Shared review" aside={<ProBadge />}>
          <p className="text-[12px] text-ink-3">Inviting reviewers, replies, statuses and @mentions run in PDF Studio Pro on the WorkSuite server, for Drive PDFs: open the Pro panel.</p>
          {ctx.showPro ? (
            <Button size="sm" icon="sparkles" className="self-start" disabled={v?.source.kind !== 'drive'} onClick={ctx.showPro}>
              Open the Pro panel
            </Button>
          ) : null}
        </Section>
        <Gap tool={tool} />
      </Scroll>
    </>
  );
}


// ── Review & sign ────────────────────────────────────────────────────────

/** A drawn signature: strokes in the pad's own pixels. */
type Stroke = Array<[number, number]>;
const PAD_W = 280;
const PAD_H = 110;

function SignaturePad({ strokes, onStrokes }: { strokes: Stroke[]; onStrokes: (s: Stroke[]) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<Stroke | null>(null);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    g.clearRect(0, 0, PAD_W, PAD_H);
    g.lineWidth = 2;
    g.lineCap = 'round';
    g.strokeStyle = '#0f172a';
    for (const s of strokes) {
      g.beginPath();
      s.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
  }, [strokes]);
  const at = (e: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) * PAD_W) / Math.max(1, r.width)), Math.round(((e.clientY - r.top) * PAD_H) / Math.max(1, r.height))];
  };
  return (
    <canvas
      ref={ref}
      width={PAD_W}
      height={PAD_H}
      aria-label="Draw your signature"
      className="w-full touch-none rounded-[8px] border border-line bg-white"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drawing.current = [at(e)];
      }}
      onPointerMove={(e) => {
        if (!drawing.current || drawing.current.length >= 4000) return;
        drawing.current.push(at(e));
        onStrokes([...strokes, drawing.current]);
      }}
      onPointerUp={() => {
        if (drawing.current && drawing.current.length > 1 && strokes.length < 200) onStrokes([...strokes.filter((s) => s !== drawing.current), drawing.current]);
        drawing.current = null;
      }}
    />
  );
}

function FillSignBody({ tool, ctx }: BodyProps) {
  const [method, setMethod] = useState<'draw' | 'type'>('draw');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const v = ctx.view;
  const ok = !!v && canUse(v, 'annotate');
  const why = !v ? 'Open a PDF first.' : !ok ? (v.edit.canAnnotate ? 'Switch to Annotate (top of the window) to sign.' : (v.edit.reason ?? 'You cannot sign this PDF.')) : method === 'draw' && !strokes.length ? 'Draw your signature first.' : method === 'type' && !typed.trim() ? 'Type your name first.' : null;
  const place = async () => {
    if (!v || why) return;
    const [pw, ph] = v.pages[ctx.page] ?? [612, 792];
    const w = Math.min(180, pw * 0.4);
    const h = (w * PAD_H) / PAD_W;
    const x0 = pw - w - 36;
    const y0 = ph - h - 54;
    setBusy(true);
    try {
      if (method === 'draw') {
        const k = w / PAD_W;
        await pdfEdit.add(v.id, ctx.page, { kind: 'ink', color: [15, 23, 42], opacity: 1, width: 1.5, strokes: strokes.map((s) => s.map(([x, y]) => [x0 + x * k, y0 + y * k] as [number, number])) });
      } else {
        await pdfEdit.add(v.id, ctx.page, { kind: 'text', color: [15, 23, 42], opacity: 1, width: 1, rect: [x0, y0, w, h], text: typed.trim(), fontSize: 22 });
      }
      toast('success', `Signature placed on page ${ctx.page + 1}. Drag it into place, then save.`);
      setStrokes([]);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        <Section title="Fields">
          <p className="text-[12px] text-ink-3">Form fields with required-field progress, and prefill from a record (Garage job card, Sales order, HR employee), arrive when the engine reads AcroForms.</p>
        </Section>
        <Section title="Your signature">
          <Radios label="Signature method" value={method} onChange={setMethod} options={[{ id: 'draw', label: 'Draw' }, { id: 'type', label: 'Type' }]} />
          {method === 'draw' ? (
            <>
              <SignaturePad strokes={strokes} onStrokes={setStrokes} />
              <button type="button" onClick={() => setStrokes([])} className="w-fit text-[12px] font-semibold text-primary hover:underline">Clear</button>
            </>
          ) : (
            <Input aria-label="Type your name" value={typed} maxLength={80} onChange={(e) => setTyped(e.target.value)} placeholder="Your name" />
          )}
          <p className="text-[11.5px] text-ink-3">Placed as a mark on page {ctx.page + 1} and saved with the PDF as a new version. Image and saved signatures, initials and in-person signing with a witness record come next.</p>
        </Section>
        <Section title="Ask others to sign" aside={<ProBadge />}>
          <p className="text-[12px] text-ink-3">Signing requests use Request e-signatures. While signatures are collected the PDF holds a signing lock.</p>
        </Section>
        <Gap tool={tool} />
      </Scroll>
      <div className="flex shrink-0 flex-col gap-2 border-t border-line px-3.5 py-3">
        {why ? <p className="text-[11.5px] text-ink-3">{why}</p> : null}
        <div className="flex justify-end">
          <Button variant="primary" icon="signature" loading={busy} disabled={!!why} onClick={() => void place()}>
            Place signature
          </Button>
        </div>
      </div>
    </>
  );
}

// ── Protect ──────────────────────────────────────────────────────────────

function ProtectBody({ tool, ctx }: BodyProps) {
  // Kept in this component's memory only; never stored, and sent only to the engine that writes the copy (PRO-PRT-005).
  const [open, setOpen] = useState('');
  const [perm, setPerm] = useState('');
  const [print, setPrint] = useState(true);
  const [changes, setChanges] = useState(false);
  const [comments, setComments] = useState(true);
  const [copy, setCopy] = useState(false);
  const m = useMaker();
  const s = strength(open);
  const v = ctx.view;
  const why = !v ? 'Open a PDF first.' : !perm ? 'Enter a permissions password: it is what lets someone change these settings later.' : perm === open ? 'Use a permissions password different from the password to open.' : null;
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        {v?.security.encrypted ? <p className="mx-3.5 mt-3 rounded-[8px] bg-selection px-3 py-2 text-[12px] text-primary">This PDF is already protected ({v.security.encryption}). A protected copy gets the new passwords instead.</p> : null}
        <Section title="Passwords">
          <Field label="Password to open" hint="Leave empty to let anyone open it, with the permissions below.">
            <Input type="password" autoComplete="new-password" value={open} onChange={(e) => setOpen(e.target.value.slice(0, 128))} />
          </Field>
          {open ? (
            <div className="flex items-center gap-2" aria-live="polite">
              <span className="flex h-1.5 flex-1 gap-0.5">
                {[1, 2, 3, 4].map((i) => (
                  <span key={i} className={cx('flex-1 rounded-full', i <= s.score ? (s.score >= 3 ? 'bg-success' : s.score === 2 ? 'bg-warning' : 'bg-danger') : 'bg-subtle')} />
                ))}
              </span>
              <span className="text-[11.5px] font-semibold text-ink-2">{s.label}</span>
            </div>
          ) : null}
          <Field label="Permissions password"><Input type="password" autoComplete="new-password" value={perm} onChange={(e) => setPerm(e.target.value.slice(0, 128))} /></Field>
        </Section>
        <Section title="Allowed">
          <CheckRow label="Printing" checked={print} onChange={setPrint} />
          <CheckRow label="Changing pages and content" checked={changes} onChange={setChanges} />
          <CheckRow label="Commenting, filling forms and signing" checked={comments} onChange={setComments} />
          <CheckRow label="Copying text and images" hint="Screen readers can always read it." checked={copy} onChange={setCopy} />
          <p className="text-[11.5px] text-ink-3">Encrypted with AES-256 (Acrobat 9 and later), here on this computer. Saved as a copy so the original stays readable for search and previews. WorkSuite never keeps the password — keep it safe.</p>
          {m.result}
        </Section>
        {v?.security.encrypted ? (
          <Section title="Remove security">
            <p className="text-[12px] text-ink-3">You opened this PDF with its password: save a copy without any.</p>
            <Button size="sm" icon="lock-open" disabled={m.busy} onClick={() => void m.run(() => call('pdf:derive', { session: v.id, req: { kind: 'unprotect' } }), (r) => `Saved ${r.name} without security.`)}>
              Save an unlocked copy…
            </Button>
          </Section>
        ) : null}
        <Needs tool={tool} ctx={ctx} what="Encrypting for named people's certificates, and your organization's security policies, run on the WorkSuite server." />
        <Gap tool={tool} />
      </Scroll>
      <Run
        label="Protect as copy…"
        why={why}
        busy={m.busy}
        onRun={() => v && void m.run(() => call('pdf:derive', { session: v.id, req: { kind: 'protect', userPassword: open, ownerPassword: perm, allow: { print, copy, modify: changes, annotate: comments } } }), (r) => `Saved ${r.name}, protected.`)}
      />
    </>
  );
}


interface PatternHits {
  id: string;
  label: string;
  hits: PdfSearchHit[];
  done: boolean;
  error: string | null;
}

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Masks the middle of a found value in the review list, so the panel does not put it on screen in full. */
export function maskMatch(s: string): string {
  if (s.length <= 4) return '•'.repeat(s.length);
  return `${s.slice(0, 2)}${'•'.repeat(Math.min(12, s.length - 4))}${s.slice(-2)}`;
}

function RedactBody({ tool, ctx }: BodyProps) {
  const [on, setOn] = useState<Record<string, boolean>>({ nic: true, phone: true, email: true, card: false, bank: false });
  const [words, setWords] = useState('');
  const [results, setResults] = useState<PatternHits[] | null>(null);
  const [running, setRunning] = useState(false);
  const v = ctx.view;
  const canSearch = !!v && v.state === 'ready' && v.capabilities?.regex !== false;

  const find = async () => {
    if (!v || running) return;
    const jobs = REDACT_PATTERNS.filter((p) => on[p.id]).map((p) => ({ id: p.id, label: p.label, regex: p.regex }));
    const w = words.split(/[,\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
    if (w.length) jobs.push({ id: 'words', label: `Words: ${w.map((x) => `“${x}”`).join(', ')}`, regex: w.map(escapeRx).join('|').slice(0, 200) });
    if (!jobs.length) return;
    setRunning(true);
    const out: PatternHits[] = jobs.map((j) => ({ id: j.id, label: j.label, hits: [], done: false, error: null }));
    setResults(out.map((x) => ({ ...x })));
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i]!;
      try {
        await new Promise<void>((resolve) => {
          let searchId: string | null = null;
          const early: PdfSearchProgress[] = [];
          const take = (p: PdfSearchProgress) => {
            out[i]!.hits.push(...p.hits);
            out[i]!.error = p.error;
            if (p.done) {
              out[i]!.done = true;
              off();
              resolve();
            }
            setResults(out.map((x) => ({ ...x, hits: [...x.hits] })));
          };
          const off = onSearch(v.id, (p) => {
            if (searchId === null) early.push(p);
            else if (p.searchId === searchId) take(p);
          });
          call('pdf:search', { session: v.id, query: j.regex, options: { matchCase: false, wholeWord: false, regex: true, comments: false, bookmarks: false } }).then(
            (r) => {
              searchId = r.searchId;
              early.filter((p) => p.searchId === searchId).forEach(take);
            },
            (e) => {
              out[i]!.error = errorMessage(e);
              out[i]!.done = true;
              off();
              resolve();
            },
          );
        });
      } catch {
        /* reported in the row */
      }
    }
    setResults(out.map((x) => ({ ...x, hits: [...x.hits] })));
    setRunning(false);
  };
  const total = results?.reduce((n, r) => n + r.hits.length, 0) ?? 0;
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(0);
  const redactWhy = !v ? 'Open a PDF first.' : running ? 'Wait for the search to finish.' : !total ? 'Find something to redact first, and review it.' : !canUse(v, 'organize') ? 'Switch to Edit to redact: it takes the edit lock.' : null;
  /** True redaction on this computer: every area found, page by page, as one change each (undo takes it back). */
  const apply = async () => {
    if (!v || !results || redactWhy) return;
    const byPage = new Map<number, Array<[number, number, number, number]>>();
    for (const r of results) for (const h of r.hits) for (const [x, y, w, hh] of h.rects) byPage.set(h.page, [...(byPage.get(h.page) ?? []), [Math.max(0, x - 1), Math.max(0, y - 1), w + 2, hh + 2]]);
    setApplying(true);
    try {
      for (const [page, rects] of byPage) for (let k = 0; k < rects.length; k += 500) await pdfEdit.apply(v.id, { op: 'page.redact', page, rects: rects.slice(k, k + 500) });
      setApplied(total);
      setResults(null);
      toast('success', `Redacted ${total} found on ${byPage.size} page${byPage.size === 1 ? '' : 's'}.`);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setApplying(false);
    }
  };
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        <Section title="Find and mark">
          {REDACT_PATTERNS.map((p) => (
            <CheckRow key={p.id} label={p.label} checked={!!on[p.id]} onChange={(x) => setOn({ ...on, [p.id]: x })} />
          ))}
          <Field label="Words and phrases" hint="Separate with commas. Sinhala and Tamil work too.">
            <Input value={words} onChange={(e) => setWords(e.target.value.slice(0, 500))} placeholder="e.g. Temple Road, Wickramasinghe" />
          </Field>
          <Button icon="search" loading={running} disabled={!canSearch || running} onClick={() => void find()}>
            Find
          </Button>
          {results ? (
            <div aria-live="polite" className="flex flex-col gap-1.5">
              <p className="text-[12px] font-semibold text-ink-2">{running ? 'Searching…' : `${total} found to review`}</p>
              {results.map((r) => (
                <div key={r.id} className="rounded-[8px] border border-line p-2">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                    <span className="min-w-0 flex-1 truncate">{r.label}</span>
                    <Chip tone={r.hits.length ? 'warning' : 'muted'}>{r.done ? r.hits.length : '…'}</Chip>
                  </div>
                  {r.error ? <p className="text-[11.5px] text-danger">{r.error}</p> : null}
                  {r.hits.length ? (
                    <ul aria-label={`${r.label} found`} className="mt-1 flex max-h-32 flex-col overflow-y-auto scroll-thin">
                      {r.hits.slice(0, 200).map((h, k) => (
                        <li key={k}>
                          <button type="button" onClick={() => ctx.goTo(h.page, h.rects[0]?.[1])} className="flex w-full gap-2 rounded-[6px] px-1 py-0.5 text-left text-[11.5px] text-ink-2 hover:bg-subtle">
                            <span className="text-ink-3 tabular">p.{h.page + 1}</span>
                            <span className="font-mono">{maskMatch(h.match)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </Section>
        <EditGate ctx={ctx} />
        {applied ? <p role="status" className="mx-3.5 mt-3 rounded-[8px] bg-success-bg px-3 py-2 text-[12px] text-success">Redacted {applied} found. The text under them is gone from the pages; save to keep it, or undo.</p> : null}
        <Needs tool={tool} ctx={ctx} what="Reason codes, verification and Sanitise a copy (metadata, hidden layers, scripts) run in PDF Studio Pro on the WorkSuite server, for Drive PDFs." />
        <Gap tool={tool} />
      </Scroll>
      <Run label={total ? `Redact ${total} found` : 'Redact'} why={redactWhy} busy={applying} onRun={() => void apply()} />
    </>
  );
}

// ── Advanced ─────────────────────────────────────────────────────────────

type StampKind = 'bates' | 'header' | 'watermark';
const PLACE_OF: Record<'br' | 'bc' | 'bl' | 'tr' | 'tc' | 'tl', PdfStamp['place']> = { br: 'bottom-right', bc: 'bottom-center', bl: 'bottom-left', tr: 'top-right', tc: 'top-center', tl: 'top-left' };

function BatesBody({ tool, ctx }: BodyProps) {
  const [kind, setKind] = useState<StampKind>('bates');
  const [prefix, setPrefix] = useState('LZT-');
  const [start, setStart] = useState('1');
  const [digits, setDigits] = useState('6');
  const [suffix, setSuffix] = useState('');
  const [pos, setPos] = useState<keyof typeof PLACE_OF>('br');
  const [words, setWords] = useState('Page {page} of {pages}');
  const [mark, setMark] = useState('CONFIDENTIAL');
  const [size, setSize] = useState('10');
  const [range, setRange] = useState('');
  const [busy, setBusy] = useState(false);
  const v = ctx.view;
  const n = v?.pageCount ?? 1;
  const s = Number(start) || 0;
  const d = Math.min(12, Math.max(1, Number(digits) || 6));
  const pages = v ? pagesOf(range, v.pageCount) : null;
  const stamp: PdfStamp =
    kind === 'watermark'
      ? { text: mark.trim() || ' ', place: 'center', size: Math.min(96, Math.max(6, Number(size) || 48)), color: [180, 35, 24], opacity: 0.2, diagonal: true }
      : kind === 'header'
        ? { text: words.trim() || ' ', place: PLACE_OF[pos], size: Math.min(96, Math.max(6, Number(size) || 10)), color: [21, 26, 45], opacity: 1, date: new Date().toLocaleDateString() }
        : { text: '{bates}', place: PLACE_OF[pos], size: Math.min(96, Math.max(6, Number(size) || 10)), color: [21, 26, 45], opacity: 1, bates: { prefix, start: s, digits: d, suffix } };
  const why = !v ? 'Open a PDF first.' : !canUse(v, 'organize') ? (v.edit.canOrganize ? 'Switch to Edit to stamp the pages.' : (v.edit.reason ?? 'You cannot change this PDF.')) : !pages ? 'Those pages are not in this PDF (for example 1-3, 5).' : !stamp.text.trim() ? 'Write the words to stamp.' : null;
  const apply = async () => {
    if (!v || !pages || why) return;
    setBusy(true);
    try {
      await pdfEdit.apply(v.id, { op: 'page.stamp', pages, stamp });
      toast('success', `Stamped ${pages.length} page${pages.length === 1 ? '' : 's'}. Undo takes it back; save to keep it.`);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const count = pages?.length ?? n;
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        <EditGate ctx={ctx} />
        <Section title="Stamp">
          <Radios label="Stamp" value={kind} onChange={setKind} options={[{ id: 'bates', label: 'Bates numbers' }, { id: 'header', label: 'Header or footer', hint: '{page}, {pages} and {date} are filled in' }, { id: 'watermark', label: 'Watermark', hint: 'Across the page, faint' }]} />
        </Section>
        {kind === 'bates' ? (
          <Section title="Bates numbering">
            <div className="grid grid-cols-2 gap-1.5">
              <Field label="Prefix"><Input value={prefix} onChange={(e) => setPrefix(e.target.value.slice(0, 20))} /></Field>
              <Field label="Suffix"><Input value={suffix} onChange={(e) => setSuffix(e.target.value.slice(0, 20))} /></Field>
              <Field label="Start"><Input inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, '').slice(0, 9))} /></Field>
              <Field label="Digits"><Input inputMode="numeric" value={digits} onChange={(e) => setDigits(e.target.value.replace(/\D/g, '').slice(0, 2))} /></Field>
            </div>
            <p aria-label="Bates preview" className="rounded-[8px] bg-ground px-2.5 py-1.5 font-mono text-[12px] text-ink">
              {batesNumber(prefix, s, d, suffix, 0)} … {batesNumber(prefix, s, d, suffix, Math.max(0, count - 1))}
            </p>
          </Section>
        ) : kind === 'header' ? (
          <Section title="Words">
            <Field label="Text" hint="Latin letters; Sinhala and Tamil come with the font pipeline."><Input value={words} onChange={(e) => setWords(e.target.value.slice(0, 200))} /></Field>
          </Section>
        ) : (
          <Section title="Watermark">
            <Field label="Text"><Input value={mark} onChange={(e) => setMark(e.target.value.slice(0, 200))} /></Field>
          </Section>
        )}
        <Section title="Where">
          {kind !== 'watermark' ? (
            <Field label="Position"><Pick label="Position" value={pos} onChange={setPos} options={[{ id: 'br', label: 'Bottom right' }, { id: 'bc', label: 'Bottom centre' }, { id: 'bl', label: 'Bottom left' }, { id: 'tr', label: 'Top right' }, { id: 'tc', label: 'Top centre' }, { id: 'tl', label: 'Top left' }]} /></Field>
          ) : null}
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="Pages"><Input value={range} onChange={(e) => setRange(e.target.value.slice(0, 200))} placeholder="All" /></Field>
            <Field label="Size (pt)"><Input inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value.replace(/\D/g, '').slice(0, 2))} /></Field>
          </div>
        </Section>
        <Gap tool={tool} />
      </Scroll>
      <Run label={kind === 'bates' ? 'Add Bates numbers' : kind === 'header' ? 'Add header or footer' : 'Add watermark'} why={why} busy={busy} onRun={() => void apply()} />
    </>
  );
}

/** A tool whose work runs on the WorkSuite server: what it does, and where. */
function ServerBody({ tool, ctx }: BodyProps) {
  return (
    <Scroll>
      {tool.works ? <p className="mx-3.5 mt-3 flex items-start gap-1.5 text-[12.5px] text-ink-2"><Icon name="check" size={14} className="mt-[2px] shrink-0 text-success" />{tool.works}</p> : <p className="mx-3.5 mt-3 text-[12.5px] text-ink-2">{tool.blurb}.</p>}
      <Needs tool={tool} ctx={ctx} />
      <Gap tool={tool} />
    </Scroll>
  );
}

/** A tool not listed in this version (it has nothing that works yet); reached only by an old link. */
function HiddenBody({ tool }: BodyProps) {
  return (
    <Scroll>
      <p className="mx-3.5 mt-3 text-[12.5px] text-ink-2">{tool.label} is not in this version.</p>
      <Gap tool={tool} />
    </Scroll>
  );
}


export const BUILT_IN_ACTIONS: Array<{ name: string; steps: string[] }> = [
  { name: 'Prepare tender submission', steps: ['Combine files in folder order, bookmarks per file', 'Recognize text — pages without text', 'Add header & footer “Page n of N”', 'Remove hidden information', 'Compress — ebook preset', 'Protect — no editing, printing allowed', 'Save a copy to “Final”'] },
  { name: 'Archive scanned invoices', steps: ['Recognize text', 'Convert to PDF/A-2b', 'Save a copy'] },
  { name: 'Publish to website', steps: ['Remove hidden information', 'Compress — screen preset', 'Fast web view', 'Save a copy'] },
  { name: 'Make accessible', steps: ['Auto-tag document', 'Set alternate text (prompt)', 'Run full check', 'Save'] },
  { name: 'Remove hidden information', steps: ['Sanitize — all categories', 'Save a copy'] },
];


const BODIES: Record<ToolId, (p: BodyProps) => React.ReactElement> = {
  create: CreateBody,
  edit: EditBody,
  export: ExportBody,
  combine: CombineBody,
  organize: OrganizeBody,
  ocr: ServerBody,
  compress: ServerBody,
  comment: CommentBody,
  'fill-sign': FillSignBody,
  esign: ServerBody,
  'prepare-form': ServerBody,
  compare: ServerBody,
  protect: ProtectBody,
  redact: RedactBody,
  certificates: ServerBody,
  accessibility: ServerBody,
  standards: HiddenBody,
  'print-production': HiddenBody,
  measure: HiddenBody,
  bates: BatesBody,
  actions: ServerBody,
  ai: ServerBody,
};
