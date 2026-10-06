import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PdfSearchHit, PdfSearchProgress, PdfSessionView } from '@shared/pdf';
import { call, errorMessage } from '../../core/bridge';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Chip, cx } from '../../components/ui';
import { onSearch } from './client';
import { canUse, pdfEdit } from './edit';
import { batesNumber, CheckRow, Field, GapList, Input, inputCls, Pick, ProBadge, Radios, RunBar, Section, StatusChip, strength } from './parts';
import { GROUP_LABEL, REDACT_PATTERNS, searchTools, toolById, type PdfTool, type ToolGroup, type ToolId } from './tools';

/**
 * The All tools panel and each tool's own left panel (DK02–DK15, PRO-FW-001/002):
 * opening a tool replaces the panel and the toolbar; "‹ All tools" goes back.
 * Panels drive what this build can already do (organising, commenting,
 * signing as a drawn mark, finding redaction patterns, Bates previews) and
 * show the rest with its run button off and the reason (PRO-FW-008).
 */
export interface ToolCtx {
  /** The open document, or null on a tool page with no document (Create, Combine, Actions…). */
  view: PdfSessionView | null;
  page: number;
  goTo: (page: number, y?: number) => void;
  /** Switch the ribbon (Organize, Annotate) and the right panel (comments). */
  ribbon: (tab: 'annotate' | 'organize') => void;
  showComments: () => void;
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

// ── Create & edit ────────────────────────────────────────────────────────

function CreateBody({ tool }: BodyProps) {
  const [src, setSrc] = useState<'file' | 'files' | 'scanner' | 'web' | 'clipboard' | 'blank'>('web');
  const [url, setUrl] = useState('');
  const [levels, setLevels] = useState(true);
  const [marks, setMarks] = useState(true);
  return (
    <>
      <Scroll>
        <p className="px-3.5 pt-3 text-[12px] text-ink-3">Runs on this computer where possible; Office files convert on the WorkSuite server.</p>
        <Section title="From">
          <Radios
            label="Create from"
            value={src}
            onChange={setSrc}
            options={[
              { id: 'file', label: 'Single file', hint: 'Word, Excel, PowerPoint, image, text' },
              { id: 'files', label: 'Multiple files', hint: 'Combine or convert each' },
              { id: 'scanner', label: 'Scanner', hint: 'TWAIN / WIA / ICA / SANE, with OCR' },
              { id: 'web', label: 'Web page', hint: 'URL, link levels, same site only' },
              { id: 'clipboard', label: 'Clipboard / screenshot' },
              { id: 'blank', label: 'Blank page', hint: 'Size and orientation' },
            ]}
          />
        </Section>
        {src === 'web' ? (
          <Section title="Web page">
            <Field label="Web page URL">
              <Input type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
            </Field>
            <CheckRow label="Convert linked pages (1 level, same site)" checked={levels} onChange={setLevels} />
            <CheckRow label="Create bookmarks from headings" checked={marks} onChange={setMarks} />
            <p className="text-[11.5px] text-ink-3">Private network addresses are never captured; your organization may limit the sites allowed.</p>
          </Section>
        ) : null}
        <Gap tool={tool} />
      </Scroll>
      <RunBar tool={tool} label="Create" />
    </>
  );
}

function EditBody({ tool, ctx }: BodyProps) {
  const [font, setFont] = useState('matched');
  const [size, setSize] = useState('13');
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        {ctx.view?.edit.lock?.mine ? <p className="mx-3.5 mt-3 flex items-center gap-1.5 text-[12px] font-semibold text-success"><Icon name="lock" size={13} /> You hold the edit lock</p> : null}
        <Section title="Add">
          <div className="grid grid-cols-2 gap-1.5">
            {[
              ['type', 'Add text'],
              ['image-plus', 'Add image'],
              ['link', 'Link'],
              ['crop', 'Crop pages'],
            ].map(([icon, label]) => (
              <Button key={label} size="sm" icon={icon} disabled title="Arrives with content editing in the engine">
                {label}
              </Button>
            ))}
          </div>
        </Section>
        <Section title="Format text">
          <div className="flex gap-1.5">
            <Pick label="Font" value={font} onChange={setFont} options={[{ id: 'matched', label: 'Matched from the document' }, { id: 'system', label: 'System font…' }]} disabled />
            <div className="w-20">
              <Pick label="Size" value={size} onChange={setSize} options={['9', '10', '11', '12', '13', '14', '16', '18', '24'].map((s) => ({ id: s, label: `${s} pt` }))} disabled />
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {['bold', 'italic', 'underline', 'align-left', 'align-center', 'align-right', 'list', 'line-spacing'].map((i) => (
              <button key={i} type="button" disabled aria-label={i} className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-line text-ink-3 opacity-60">
                <Icon name={i} size={14} />
              </button>
            ))}
          </div>
          <p className="text-[11.5px] text-ink-3">The font is matched from the document (its embedded subset); missing glyphs fall back to a similar installed font, and the substitution is named.</p>
        </Section>
        <Section title="Objects">
          <div className="flex flex-wrap gap-1.5">
            {['Arrange', 'Rotate', 'Flip', 'Replace image'].map((l) => (
              <Button key={l} size="sm" disabled>
                {l}
              </Button>
            ))}
          </div>
        </Section>
        <Section title="Page design">
          {['Header & footer', 'Watermark', 'Background', 'Bates numbering', 'Page labels'].map((l) => (
            <div key={l} className="flex items-center justify-between text-[12.5px] text-ink-2">
              {l}
              <span className="flex gap-1">
                <Button size="sm" disabled>Add</Button>
                <Button size="sm" disabled>Update</Button>
                <Button size="sm" disabled>Remove</Button>
              </span>
            </div>
          ))}
        </Section>
        <Gap tool={tool} />
      </Scroll>
      <RunBar tool={tool} label="Edit text in Office" />
    </>
  );
}

function ExportBody({ tool, ctx }: BodyProps) {
  const [fmt, setFmt] = useState<'docx' | 'xlsx' | 'pptx' | 'image' | 'html' | 'rtf'>('docx');
  const [layout, setLayout] = useState<'flow' | 'exact'>('flow');
  const [comments, setComments] = useState(true);
  const [ocr, setOcr] = useState(true);
  const v = ctx.view;
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
              { id: 'docx', label: 'Microsoft Word (.docx)' },
              { id: 'xlsx', label: 'Spreadsheet — Excel (.xlsx)', hint: 'One sheet per table, numbers as numbers' },
              { id: 'pptx', label: 'PowerPoint (.pptx)' },
              { id: 'image', label: 'Image — JPEG, PNG, TIFF', hint: 'Made on this computer' },
              { id: 'html', label: 'HTML web page' },
              { id: 'rtf', label: 'Rich text (.rtf) · Plain text · XML' },
            ]}
          />
        </Section>
        {fmt === 'docx' ? (
          <Section title="Word layout">
            <Radios label="Word layout" value={layout} onChange={setLayout} options={[{ id: 'flow', label: 'Keep flowing text', hint: 'Easier to edit' }, { id: 'exact', label: 'Keep page layout', hint: 'Looks the same' }]} />
            <CheckRow label="Include comments and images" checked={comments} onChange={setComments} />
          </Section>
        ) : null}
        <Section title="Text">
          <CheckRow label="Recognize text if needed — English, Sinhala, Tamil" checked={ocr} onChange={setOcr} />
        </Section>
        <Gap tool={tool} />
      </Scroll>
      <RunBar tool={tool} label="Export" />
    </>
  );
}

interface CombineItem {
  key: string;
  name: string;
  size: number;
  range: string;
}

function CombineBody({ tool }: BodyProps) {
  const [items, setItems] = useState<CombineItem[]>([]);
  const [bookmarks, setBookmarks] = useState(true);
  const [toc, setToc] = useState(false);
  const [compress, setCompress] = useState(false);
  const [name, setName] = useState('Combined.pdf');
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
            <p className="text-[12px] text-ink-3">Add PDFs from this computer. Drive, Mail attachments and Word, Excel and image files arrive with the server combine.</p>
          )}
        </Section>
        <Section title="Options">
          <CheckRow label="Add bookmarks per file" checked={bookmarks} onChange={setBookmarks} />
          <CheckRow label="Table of contents page" checked={toc} onChange={setToc} />
          <CheckRow label="Compress result" checked={compress} onChange={setCompress} />
          <Field label="Save as">
            <Input value={name} onChange={(e) => setName(e.target.value.slice(0, 200))} />
          </Field>
        </Section>
        <Gap tool={tool} />
      </Scroll>
      <RunBar tool={tool} label="Combine" why={items.length < 2 ? 'Add at least two files.' : undefined} />
    </>
  );
}

function OrganizeBody({ tool, ctx }: BodyProps) {
  const v = ctx.view;
  const ok = !!v && canUse(v, 'organize');
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        <Section title="Pages">
          <p className="text-[12.5px] text-ink-2">Select pages in the grid — click, Shift for a range, Ctrl/⌘ for more — then rotate, move, delete, insert or extract. Drag to reorder. Every change can be undone until you save.</p>
          {v && !ok ? <p className="text-[12px] text-warning">{v.mode !== 'EDIT' ? 'Switch to Edit (top of the window) to organize pages; it takes the edit lock.' : (v.edit.reason ?? 'You cannot organize this PDF.')}</p> : null}
          <Button variant="primary" icon="grid" disabled={!v} onClick={() => ctx.ribbon('organize')}>
            Show the page grid
          </Button>
        </Section>
        <Gap tool={tool} />
      </Scroll>
    </>
  );
}

function OcrBody({ tool, ctx }: BodyProps) {
  const [langs, setLangs] = useState({ eng: true, sin: true, tam: false });
  const [output, setOutput] = useState<'image' | 'editable'>('image');
  const [where, setWhere] = useState<'device' | 'server'>('device');
  const [pages, setPages] = useState<'all' | 'notext'>('notext');
  const [enh, setEnh] = useState({ straighten: true, rotate: true, background: false, crop: false });
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        <Section title="Recognize text">
          <Field label="Pages">
            <Pick label="Pages" value={pages} onChange={setPages} options={[{ id: 'notext', label: 'Only pages without text' }, { id: 'all', label: `All pages${ctx.view ? ` (${ctx.view.pageCount})` : ''}` }]} />
          </Field>
          <div className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
            Languages
            <CheckRow label="English" checked={langs.eng} onChange={(x) => setLangs({ ...langs, eng: x })} />
            <CheckRow label="Sinhala" checked={langs.sin} onChange={(x) => setLangs({ ...langs, sin: x })} />
            <CheckRow label="Tamil" checked={langs.tam} onChange={(x) => setLangs({ ...langs, tam: x })} />
          </div>
          <Radios label="Output" value={output} onChange={setOutput} options={[{ id: 'image', label: 'Searchable image', hint: 'Keeps the scan' }, { id: 'editable', label: 'Editable text and images', hint: 'Pro' }]} />
          <Radios label="Where it runs" value={where} onChange={setWhere} options={[{ id: 'device', label: 'On this computer', hint: 'Fast, works offline' }, { id: 'server', label: 'WorkSuite server', hint: 'Tesseract job' }]} />
        </Section>
        <Section title="Enhance">
          <CheckRow label="Straighten pages" checked={enh.straighten} onChange={(x) => setEnh({ ...enh, straighten: x })} />
          <CheckRow label="Auto-rotate to upright" checked={enh.rotate} onChange={(x) => setEnh({ ...enh, rotate: x })} />
          <CheckRow label="Remove background and shadows" checked={enh.background} onChange={(x) => setEnh({ ...enh, background: x })} />
          <CheckRow label="Detect and crop pages" checked={enh.crop} onChange={(x) => setEnh({ ...enh, crop: x })} />
        </Section>
        <Section title="Correct recognized text">
          <p className="text-[12px] text-ink-3">After recognition, words below the confidence threshold are listed here to accept, edit or mark as not text — with suggestions from WorkSuite records (PO, invoice and vehicle numbers).</p>
        </Section>
        <Gap tool={tool} />
      </Scroll>
      <RunBar tool={tool} label="Recognize text" secondary={<Button disabled title="Scanner bridge not built yet">Scan from scanner</Button>} />
    </>
  );
}

function CompressBody({ tool, ctx }: BodyProps) {
  const [preset, setPreset] = useState<'screen' | 'ebook' | 'print' | 'custom'>('ebook');
  const [adv, setAdv] = useState({ downsample: true, fonts: true, discard: true, linearize: true, compat: false });
  const [out, setOut] = useState<'version' | 'copy'>('copy');
  const v = ctx.view;
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        {v ? <p className="px-3.5 pt-3 text-[12px] text-ink-3">{v.name} · {bytes(v.size)}</p> : null}
        <Section title="Preset">
          <Radios
            label="Preset"
            value={preset}
            onChange={setPreset}
            options={[
              { id: 'screen', label: 'Screen', hint: '72 dpi — smallest, for email' },
              { id: 'ebook', label: 'Ebook', hint: '150 dpi' },
              { id: 'print', label: 'Print', hint: '300 dpi' },
              { id: 'custom', label: 'Custom', hint: 'Advanced optimizer (Pro)' },
            ]}
          />
        </Section>
        {preset === 'custom' ? (
          <Section title="Advanced optimizer">
            <CheckRow label="Downsample colour images above 225 dpi to 150" checked={adv.downsample} onChange={(x) => setAdv({ ...adv, downsample: x })} />
            <CheckRow label="Unembed standard fonts, subset the rest" checked={adv.fonts} onChange={(x) => setAdv({ ...adv, fonts: x })} />
            <CheckRow label="Discard hidden layers, thumbnails, form actions" checked={adv.discard} onChange={(x) => setAdv({ ...adv, discard: x })} />
            <CheckRow label="Fast web view (linearize)" checked={adv.linearize} onChange={(x) => setAdv({ ...adv, linearize: x })} />
            <CheckRow label="Make compatible with PDF 1.6" checked={adv.compat} onChange={(x) => setAdv({ ...adv, compat: x })} />
          </Section>
        ) : null}
        <Section title="Result">
          <Radios label="Result" value={out} onChange={setOut} options={[{ id: 'version', label: 'Replace as a new version' }, { id: 'copy', label: 'Save as a copy' }]} />
          <p className="text-[11.5px] text-ink-3">The original is kept when the result would not be smaller.</p>
        </Section>
        <Gap tool={tool} />
      </Scroll>
      <RunBar tool={tool} label="Compress" secondary={<Button disabled>Audit space usage</Button>} />
    </>
  );
}

// ── Review & sign ────────────────────────────────────────────────────────

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
          <p className="text-[12px] text-ink-3">Invite reviewers (people, groups, external emails) with a deadline and reminders; see who opened, commented and is done; end the review to merge comments into a new version.</p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" disabled title="Needs api/files/{id}/pdf/reviews">Start a review</Button>
            <Button size="sm" disabled>Summarize comments</Button>
            <Button size="sm" disabled>Export comments</Button>
            <Button size="sm" disabled>Import</Button>
          </div>
        </Section>
        <Gap tool={tool} />
      </Scroll>
    </>
  );
}

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

interface Recipient {
  id: number;
  name: string;
  email: string;
  role: 'signer' | 'approver' | 'filler' | 'cc';
  auth: 'worksuite' | 'email_otp' | 'sms_otp' | 'code';
}

function EsignBody({ tool, ctx }: BodyProps) {
  const [order, setOrder] = useState<'sequential' | 'parallel'>('sequential');
  const [list, setList] = useState<Recipient[]>([]);
  const [subject, setSubject] = useState(ctx.view ? `Please sign: ${ctx.view.name.replace(/\.pdf$/i, '')}` : '');
  const [message, setMessage] = useState('');
  const [deadline, setDeadline] = useState('');
  const [remind, setRemind] = useState('2');
  const [lang, setLang] = useState<'en' | 'si' | 'ta'>('en');
  const add = () => setList((l) => [...l, { id: Date.now() + l.length, name: '', email: '', role: 'signer', auth: 'email_otp' }]);
  const upd = (id: number, p: Partial<Recipient>) => setList((l) => l.map((r) => (r.id === id ? { ...r, ...p } : r)));
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        <Section title="Recipients" aside={<Pick label="Order" value={order} onChange={setOrder} options={[{ id: 'sequential', label: 'In order' }, { id: 'parallel', label: 'Any order' }]} />}>
          {list.map((r, i) => (
            <div key={r.id} className="flex flex-col gap-1 rounded-[8px] border border-line p-2">
              <div className="flex items-center gap-1.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-selection text-[11px] font-bold text-primary">{i + 1}</span>
                <Input aria-label="Name" placeholder="Name" value={r.name} onChange={(e) => upd(r.id, { name: e.target.value.slice(0, 120) })} />
                <button type="button" aria-label="Remove recipient" onClick={() => setList((l) => l.filter((x) => x.id !== r.id))} className="text-ink-3 hover:text-danger"><Icon name="x" size={14} /></button>
              </div>
              <Input aria-label="Email" type="email" placeholder="Email or WorkSuite user" value={r.email} onChange={(e) => upd(r.id, { email: e.target.value.slice(0, 200) })} />
              <div className="flex gap-1.5">
                <Pick label="Role" value={r.role} onChange={(role) => upd(r.id, { role })} options={[{ id: 'signer', label: 'Signer' }, { id: 'approver', label: 'Approver' }, { id: 'filler', label: 'Form filler' }, { id: 'cc', label: 'Copy (CC)' }]} />
                <Pick label="Verify with" value={r.auth} onChange={(auth) => upd(r.id, { auth })} options={[{ id: 'worksuite', label: 'WorkSuite sign-in' }, { id: 'email_otp', label: 'Email code' }, { id: 'sms_otp', label: 'SMS code' }, { id: 'code', label: 'Access code' }]} />
              </div>
            </div>
          ))}
          <Button size="sm" icon="user-plus" onClick={add}>Add recipient or group</Button>
        </Section>
        <Section title="Message">
          <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value.slice(0, 200))} /></Field>
          <Field label="Message">
            <textarea value={message} rows={3} onChange={(e) => setMessage(e.target.value.slice(0, 2000))} className={cx(inputCls, 'h-auto py-1.5')} />
          </Field>
        </Section>
        <Section title="Options">
          <Field label="Deadline"><Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
          <Field label="Reminders"><Pick label="Reminders" value={remind} onChange={setRemind} options={[{ id: '0', label: 'None' }, { id: '1', label: 'Every day' }, { id: '2', label: 'Every 2 days' }, { id: '7', label: 'Every week' }]} /></Field>
          <Field label="Language"><Pick label="Language" value={lang} onChange={setLang} options={[{ id: 'en', label: 'English' }, { id: 'si', label: 'Sinhala' }, { id: 'ta', label: 'Tamil' }]} /></Field>
        </Section>
        <Section title="Fields per recipient">
          <div className="flex flex-wrap gap-1">
            {['Signature', 'Initials', 'Date signed', 'Name', 'Title', 'Company', 'Text input', 'Checkbox', 'Stamp', 'Attachment'].map((f) => (
              <Chip key={f}>{f}</Chip>
            ))}
          </div>
          <p className="text-[11.5px] text-ink-3">Signing locks the PDF’s pages. Each signature is a Drive version; the final copy gets an audit report page.</p>
        </Section>
        <Gap tool={tool} />
      </Scroll>
      <RunBar tool={tool} label="Send for signature" secondary={<Button disabled>Save as template</Button>} />
    </>
  );
}

function PrepareFormBody({ tool, ctx }: BodyProps) {
  const [tab, setTab] = useState<'general' | 'appearance' | 'format' | 'validate' | 'calculate' | 'actions'>('calculate');
  const [formula, setFormula] = useState('WORKDAYS(from_date, to_date)');
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        <Section title="Add a field">
          <div className="grid grid-cols-5 gap-1">
            {[
              ['text-cursor', 'Text'],
              ['check', 'Checkbox'],
              ['circle-dot', 'Radio'],
              ['chevron-down', 'Dropdown'],
              ['list', 'List'],
              ['calendar', 'Date'],
              ['signature', 'Signature'],
              ['square', 'Button'],
              ['qr-code', 'Barcode'],
              ['image', 'Image'],
            ].map(([icon, label]) => (
              <button key={label} type="button" disabled title={label} className="flex flex-col items-center gap-0.5 rounded-[6px] border border-line py-1 text-[10.5px] text-ink-3 opacity-70">
                <Icon name={icon!} size={14} />
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" disabled>Detect fields</Button>
            <Button size="sm" disabled>Map to a record…</Button>
          </div>
        </Section>
        <Section title="Field properties">
          <div role="tablist" aria-label="Field properties" className="flex flex-wrap gap-1">
            {(['general', 'appearance', 'format', 'validate', 'calculate', 'actions'] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('rounded-[6px] px-2 py-0.5 text-[11.5px] font-semibold capitalize', tab === t ? 'bg-selection text-primary' : 'text-ink-3 hover:bg-subtle')}>
                {t}
              </button>
            ))}
          </div>
          {tab === 'calculate' ? (
            <Field label="Simple formula" hint="IF, ROUND, TODAY, WORKDAYS, DATEDIF, CONCAT and arithmetic. Runs in PDF Studio’s safe form engine — document JavaScript stays blocked.">
              <Input value={formula} onChange={(e) => setFormula(e.target.value.slice(0, 500))} className="font-mono" />
            </Field>
          ) : (
            <p className="text-[12px] text-ink-3">Select a field on the page to edit its {tab} properties.</p>
          )}
        </Section>
        <Gap tool={tool} />
      </Scroll>
      <RunBar tool={tool} label="Save form" />
    </>
  );
}

function CompareBody({ tool, ctx }: BodyProps) {
  const [mode, setMode] = useState<'side' | 'single' | 'overlay' | 'text'>('side');
  const [ign, setIgn] = useState({ headers: true, whitespace: true, case: false, images: false });
  const v = ctx.view;
  return (
    <>
      <Scroll>
        <Section title="Documents">
          <Field label="Old"><div className={cx(inputCls, 'flex items-center')}>{v ? `${v.name}${v.source.version ? ` · v${v.source.version}` : ''}` : 'Choose a PDF…'}</div></Field>
          <Field label="New" hint="A Drive version, another Drive file, a file on this computer or a mail attachment."><div className={cx(inputCls, 'flex items-center text-ink-3')}>Choose…</div></Field>
        </Section>
        <Section title="View">
          <Radios label="Compare view" value={mode} onChange={setMode} options={[{ id: 'side', label: 'Side by side', hint: 'Synced scroll' }, { id: 'single', label: 'Single page with markers' }, { id: 'overlay', label: 'Overlay' }, { id: 'text', label: 'Text only' }]} />
        </Section>
        <Section title="Ignore">
          <CheckRow label="Headers and footers" checked={ign.headers} onChange={(x) => setIgn({ ...ign, headers: x })} />
          <CheckRow label="Whitespace" checked={ign.whitespace} onChange={(x) => setIgn({ ...ign, whitespace: x })} />
          <CheckRow label="Case" checked={ign.case} onChange={(x) => setIgn({ ...ign, case: x })} />
          <CheckRow label="Images" checked={ign.images} onChange={(x) => setIgn({ ...ign, images: x })} />
        </Section>
        <Gap tool={tool} />
      </Scroll>
      <RunBar tool={tool} label="Compare" secondary={<Button disabled>Save report as PDF</Button>} />
    </>
  );
}

// ── Protect ──────────────────────────────────────────────────────────────

function ProtectBody({ tool, ctx }: BodyProps) {
  const [method, setMethod] = useState<'password' | 'certificate' | 'policy'>('password');
  // Kept in this component's memory only; never stored or sent (PRO-PRT-005).
  const [open, setOpen] = useState('');
  const [perm, setPerm] = useState('');
  const [print, setPrint] = useState<'none' | 'low' | 'high'>('high');
  const [changes, setChanges] = useState<'none' | 'pages' | 'fill' | 'comment' | 'all'>('fill');
  const [copy, setCopy] = useState(false);
  const [reader, setReader] = useState(true);
  const [enc, setEnc] = useState<'aes256' | 'aes128'>('aes256');
  const s = strength(open);
  const v = ctx.view;
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        {v?.security.encrypted ? <p className="mx-3.5 mt-3 rounded-[8px] bg-selection px-3 py-2 text-[12px] text-primary">This PDF is already protected ({v.security.encryption}).</p> : null}
        <Section title="Method">
          <Radios label="Method" value={method} onChange={setMethod} options={[{ id: 'password', label: 'Password' }, { id: 'certificate', label: 'Certificates', hint: 'Only named people can open' }, { id: 'policy', label: 'Organization policy', hint: 'e.g. “Confidential — internal”' }]} />
        </Section>
        {method === 'password' ? (
          <>
            <Section title="Passwords">
              <Field label="Password to open">
                <Input type="password" autoComplete="new-password" value={open} onChange={(e) => setOpen(e.target.value)} />
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
              <Field label="Permissions password"><Input type="password" autoComplete="new-password" value={perm} onChange={(e) => setPerm(e.target.value)} /></Field>
            </Section>
            <Section title="Allowed">
              <Field label="Printing"><Pick label="Printing" value={print} onChange={setPrint} options={[{ id: 'none', label: 'Not allowed' }, { id: 'low', label: 'Low resolution' }, { id: 'high', label: 'High resolution' }]} /></Field>
              <Field label="Changes"><Pick label="Changes" value={changes} onChange={setChanges} options={[{ id: 'none', label: 'None' }, { id: 'pages', label: 'Inserting, deleting and rotating pages' }, { id: 'fill', label: 'Filling forms and signing' }, { id: 'comment', label: 'Commenting, filling and signing' }, { id: 'all', label: 'Any except extracting pages' }]} /></Field>
              <CheckRow label="Copying text, images and other content" checked={copy} onChange={setCopy} />
              <CheckRow label="Screen readers can read text" checked={reader} onChange={setReader} />
              <Field label="Encryption"><Pick label="Encryption" value={enc} onChange={setEnc} options={[{ id: 'aes256', label: 'AES-256 · Acrobat 9 and later' }, { id: 'aes128', label: 'AES-128 · for older readers' }]} /></Field>
            </Section>
          </>
        ) : (
          <Section title={method === 'certificate' ? 'Recipients' : 'Policy'}>
            <p className="text-[12px] text-ink-3">{method === 'certificate' ? 'Choose people from the WorkSuite directory or import .cer files; each gets their own permissions.' : 'Your organization’s security policies are managed in Admin Center › Files › PDF Studio.'}</p>
          </Section>
        )}
        <p className="px-3.5 pt-3 text-[11.5px] text-ink-3">Saved as a copy so the Drive original stays readable for search and previews. WorkSuite never stores the password — keep it safe.</p>
        <Gap tool={tool} />
      </Scroll>
      <RunBar tool={tool} label="Protect as copy" why={method === 'password' && !open && !perm ? 'Enter a password to open or a permissions password.' : undefined} secondary={v?.security.encrypted ? <Button disabled>Remove security</Button> : undefined} />
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
  const [sanitize, setSanitize] = useState({ meta: true, comments: false, hidden: true, scripts: true, deleted: true });
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
        <Section title="Sanitize — remove hidden information">
          <CheckRow label="Metadata (author, producer, XMP)" checked={sanitize.meta} onChange={(x) => setSanitize({ ...sanitize, meta: x })} />
          <CheckRow label="Comments, attachments, form data" checked={sanitize.comments} onChange={(x) => setSanitize({ ...sanitize, comments: x })} />
          <CheckRow label="Hidden text, layers, overlapping objects" checked={sanitize.hidden} onChange={(x) => setSanitize({ ...sanitize, hidden: x })} />
          <CheckRow label="Scripts, links, bookmarks" checked={sanitize.scripts} onChange={(x) => setSanitize({ ...sanitize, scripts: x })} />
          <CheckRow label="Deleted or cropped content" checked={sanitize.deleted} onChange={(x) => setSanitize({ ...sanitize, deleted: x })} />
        </Section>
        <Gap tool={tool} />
      </Scroll>
      <RunBar tool={tool} label="Apply & sanitize…" />
    </>
  );
}

function CertificatesBody({ tool, ctx }: BodyProps) {
  const [act, setAct] = useState<'sign' | 'certify' | 'certify-invisible' | 'timestamp'>('sign');
  const n = ctx.view?.security.signatures ?? 0;
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        <Section title="Signatures in this PDF">
          {ctx.view ? (
            n ? (
              <p className="flex items-center gap-1.5 text-[12.5px] text-ink"><Icon name="badge-check" size={15} className="text-ink-3" /> {n} signature{n === 1 ? '' : 's'} found — not validated yet.</p>
            ) : (
              <p className="text-[12.5px] text-ink-3">This PDF has no digital signatures.</p>
            )
          ) : null}
          <div className="flex gap-1.5">
            <Button size="sm" disabled={!n} title="Validation (integrity, identity, revocation, timestamp) arrives with PRO-4">Validate all</Button>
            <Button size="sm" disabled>Trusted certificates</Button>
          </div>
        </Section>
        <Section title="Sign or certify">
          <Radios label="Action" value={act} onChange={setAct} options={[{ id: 'sign', label: 'Digitally sign' }, { id: 'certify', label: 'Certify (visible)' }, { id: 'certify-invisible', label: 'Certify (invisible)' }, { id: 'timestamp', label: 'Timestamp' }]} />
          <Field label="Digital ID" hint="From the OS keychain, a PKCS#12 file or a smart card. Private keys never leave it.">
            <div className={cx(inputCls, 'flex items-center text-ink-3')}>No digital IDs found</div>
          </Field>
        </Section>
        <Gap tool={tool} />
      </Scroll>
      <RunBar tool={tool} label={act === 'timestamp' ? 'Timestamp' : act === 'sign' ? 'Sign' : 'Certify'} />
    </>
  );
}

// ── Advanced ─────────────────────────────────────────────────────────────

const A11Y_CATS = ['Document', 'Page content', 'Forms', 'Alternate text', 'Tables', 'Lists', 'Headings'];

function AccessibilityBody({ tool, ctx }: BodyProps) {
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        <Section title="Fix">
          <div className="grid grid-cols-2 gap-1.5">
            {['Auto-tag document', 'Reading order', 'Set alternate text', 'Autotag form fields', 'Read out loud'].map((l) => (
              <Button key={l} size="sm" disabled>{l}</Button>
            ))}
          </div>
        </Section>
        <Section title="Accessibility check · PDF/UA-1 + WCAG 2.2">
          <ul className="flex flex-col gap-0.5">
            {A11Y_CATS.map((c) => (
              <li key={c} className="flex items-center justify-between text-[12.5px] text-ink-2">
                {c}
                <span className="text-[11.5px] text-ink-3">Not checked</span>
              </li>
            ))}
          </ul>
        </Section>
        <StandardsRows view={ctx.view} />
        <Gap tool={tool} />
      </Scroll>
      <RunBar tool={tool} label="Run full check" />
    </>
  );
}

function StandardsRows({ view }: { view: PdfSessionView | null }) {
  return (
    <Section title="Standards">
      {[
        ['PDF/A', 'Archive'],
        ['PDF/UA', 'Accessible'],
        ['PDF/X', 'Print'],
      ].map(([std, use]) => (
        <div key={std} className="flex items-center gap-2 text-[12.5px]">
          <b className="w-14 text-ink">{std}</b>
          <span className="flex-1 text-ink-3">{use}</span>
          <Chip>Not checked</Chip>
        </div>
      ))}
      {view?.info?.version ? <p className="text-[11.5px] text-ink-3">This file is PDF {view.info.version}.</p> : null}
    </Section>
  );
}

function StandardsBody({ tool, ctx }: BodyProps) {
  const [std, setStd] = useState('pdfa-2b');
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        <StandardsRows view={ctx.view} />
        <Section title="Save as">
          <Pick label="Standard" value={std} onChange={setStd} options={['pdfa-1b', 'pdfa-2b', 'pdfa-2u', 'pdfa-3b', 'pdfa-4', 'pdfx-1a', 'pdfx-3', 'pdfx-4', 'pdfua-1'].map((s) => ({ id: s, label: s.replace(/^pdf(a|x|ua)-/, (_, k: string) => `PDF/${k.toUpperCase()}-`) }))} />
          <p className="text-[11.5px] text-ink-3">Converted with fixups (embed fonts, output intent, transparency) and verified with veraPDF on the server; the report is attached to the file.</p>
        </Section>
        <Gap tool={tool} />
      </Scroll>
      <RunBar tool={tool} label="Save as copy" secondary={<Button disabled>Verify</Button>} />
    </>
  );
}

function PrintProductionBody({ tool, ctx }: BodyProps) {
  const [profile, setProfile] = useState('fogra39');
  const [preflight, setPreflight] = useState('x4');
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        <Section title="Output preview">
          <Field label="Simulation profile"><Pick label="Simulation profile" value={profile} onChange={setProfile} options={[{ id: 'fogra39', label: 'Coated FOGRA39 (ISO 12647-2)' }, { id: 'fogra51', label: 'PSO Coated v3 (FOGRA51)' }, { id: 'swop', label: 'U.S. Web Coated (SWOP) v2' }]} /></Field>
          <p className="text-[12px] text-ink-3">Separations and total area coverage appear here once the engine manages colour.</p>
        </Section>
        <Section title="Preflight">
          <Field label="Profile"><Pick label="Preflight profile" value={preflight} onChange={setPreflight} options={[{ id: 'x1a', label: 'PDF/X-1a' }, { id: 'x4', label: 'PDF/X-4' }, { id: 'digital', label: 'Digital printing' }, { id: 'web', label: 'Web-ready' }]} /></Field>
        </Section>
        <Section title="Prepress">
          {['Set page boxes', 'Add printer marks', 'Convert colours', 'Flattener preview', 'Fix hairlines'].map((l) => (
            <Button key={l} size="sm" disabled className="justify-start">{l}</Button>
          ))}
        </Section>
        <Gap tool={tool} />
      </Scroll>
      <RunBar tool={tool} label="Run preflight" />
    </>
  );
}

function MeasureBody({ tool, ctx }: BodyProps) {
  const [kind, setKind] = useState<'distance' | 'perimeter' | 'area'>('distance');
  const [a, setA] = useState('1');
  const [b, setB] = useState('100');
  const [unit, setUnit] = useState<'mm' | 'cm' | 'm' | 'in' | 'ft'>('mm');
  const [snap, setSnap] = useState(true);
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        <Section title="Measure">
          <Radios label="Measure" value={kind} onChange={setKind} options={[{ id: 'distance', label: 'Distance' }, { id: 'perimeter', label: 'Perimeter' }, { id: 'area', label: 'Area' }]} />
        </Section>
        <Section title="Scale ratio">
          <div className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
            <Input aria-label="Page units" value={a} onChange={(e) => setA(e.target.value.replace(/[^\d.]/g, '').slice(0, 8))} className="w-16" />
            {unit} =
            <Input aria-label="Real units" value={b} onChange={(e) => setB(e.target.value.replace(/[^\d.]/g, '').slice(0, 8))} className="w-20" />
            <div className="w-20"><Pick label="Unit" value={unit} onChange={setUnit} options={(['mm', 'cm', 'm', 'in', 'ft'] as const).map((u) => ({ id: u, label: u }))} /></div>
          </div>
          <CheckRow label="Snap to paths, endpoints and midpoints" checked={snap} onChange={setSnap} />
          <p className="text-[11.5px] text-ink-3">Measurements are saved as comments and export to CSV.</p>
        </Section>
        <Gap tool={tool} />
      </Scroll>
      <RunBar tool={tool} label="Start measuring" secondary={<Button disabled>Export CSV</Button>} />
    </>
  );
}

function BatesBody({ tool, ctx }: BodyProps) {
  const [prefix, setPrefix] = useState('LZT-');
  const [start, setStart] = useState('1');
  const [digits, setDigits] = useState('6');
  const [suffix, setSuffix] = useState('');
  const [pos, setPos] = useState<'br' | 'bc' | 'bl' | 'tr'>('br');
  const n = ctx.view?.pageCount ?? 1;
  const s = Number(start) || 0;
  const d = Number(digits) || 6;
  return (
    <>
      <Scroll>
        <Section title="Bates numbering">
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="Prefix"><Input value={prefix} onChange={(e) => setPrefix(e.target.value.slice(0, 20))} /></Field>
            <Field label="Suffix"><Input value={suffix} onChange={(e) => setSuffix(e.target.value.slice(0, 20))} /></Field>
            <Field label="Start"><Input inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, '').slice(0, 9))} /></Field>
            <Field label="Digits"><Input inputMode="numeric" value={digits} onChange={(e) => setDigits(e.target.value.replace(/\D/g, '').slice(0, 2))} /></Field>
          </div>
          <Field label="Position"><Pick label="Position" value={pos} onChange={setPos} options={[{ id: 'br', label: 'Bottom right' }, { id: 'bc', label: 'Bottom centre' }, { id: 'bl', label: 'Bottom left' }, { id: 'tr', label: 'Top right' }]} /></Field>
          <p aria-label="Bates preview" className="rounded-[8px] bg-ground px-2.5 py-1.5 font-mono text-[12px] text-ink">
            {batesNumber(prefix, s, d, suffix, 0)} … {batesNumber(prefix, s, d, suffix, n - 1)}
          </p>
          <p className="text-[11.5px] text-ink-3">Numbering continues across files in list order; a log (file, first, last) is saved as CSV beside the set.</p>
        </Section>
        <Section title="Full-text index">
          <p className="text-[12px] text-ink-3">PDFs in Drive are indexed by the WorkSuite server automatically; build a portable index for an offline set (USB, court bundle).</p>
          <div className="flex gap-1.5"><Button size="sm" disabled>Choose folder</Button><Button size="sm" disabled>Embed index in PDF</Button></div>
        </Section>
        <Gap tool={tool} />
      </Scroll>
      <RunBar tool={tool} label="Add Bates numbers" />
    </>
  );
}

export const BUILT_IN_ACTIONS: Array<{ name: string; steps: string[] }> = [
  { name: 'Prepare tender submission', steps: ['Combine files in folder order, bookmarks per file', 'Recognize text — pages without text', 'Add header & footer “Page n of N”', 'Remove hidden information', 'Compress — ebook preset', 'Protect — no editing, printing allowed', 'Save a copy to “Final”'] },
  { name: 'Archive scanned invoices', steps: ['Recognize text', 'Convert to PDF/A-2b', 'Save a copy'] },
  { name: 'Publish to website', steps: ['Remove hidden information', 'Compress — screen preset', 'Fast web view', 'Save a copy'] },
  { name: 'Make accessible', steps: ['Auto-tag document', 'Set alternate text (prompt)', 'Run full check', 'Save'] },
  { name: 'Remove hidden information', steps: ['Sanitize — all categories', 'Save a copy'] },
];

function ActionsBody({ tool }: BodyProps) {
  const [pick, setPick] = useState(0);
  const [server, setServer] = useState(false);
  const a = BUILT_IN_ACTIONS[pick]!;
  return (
    <>
      <Scroll>
        <Section title="Actions">
          <ul className="flex flex-col">
            {BUILT_IN_ACTIONS.map((x, i) => (
              <li key={x.name}>
                <button type="button" aria-current={i === pick || undefined} onClick={() => setPick(i)} className={cx('flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[12.5px]', i === pick ? 'bg-selection font-semibold text-primary' : 'text-ink hover:bg-subtle')}>
                  <Icon name="zap" size={14} /> {x.name}
                </button>
              </li>
            ))}
          </ul>
          <Button size="sm" icon="plus" disabled>New action</Button>
        </Section>
        <Section title={`Steps · ${a.name}`}>
          <ol className="flex flex-col gap-1">
            {a.steps.map((s, i) => (
              <li key={s} className="flex gap-2 text-[12.5px] text-ink-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-subtle text-[11px] font-bold text-ink-2">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
          <CheckRow label="Run on the server" hint="For large batches; the run continues if you close WorkSuite." checked={server} onChange={setServer} />
        </Section>
        <Gap tool={tool} />
      </Scroll>
      <RunBar tool={tool} label="Start" />
    </>
  );
}

function AiBody({ tool, ctx }: BodyProps) {
  const [q, setQ] = useState('');
  return (
    <>
      <Scroll>
        <NeedsDoc ctx={ctx} />
        <Section title="Ask this PDF">
          <div className="flex flex-wrap gap-1.5">
            {['Generative summary', 'List all deadlines', 'Extract tables to Excel', 'Translate summary to Sinhala', 'Draft reply email'].map((p) => (
              <button key={p} type="button" onClick={() => setQ(p)} className="rounded-full border border-line px-2.5 py-1 text-[11.5px] font-semibold text-ink-2 hover:bg-subtle">
                {p}
              </button>
            ))}
          </div>
          <textarea aria-label="Ask about this document" rows={3} value={q} onChange={(e) => setQ(e.target.value.slice(0, 2000))} placeholder="Ask about this document…" className={cx(inputCls, 'h-auto py-1.5')} />
          <p className="text-[11.5px] text-ink-3">Answers cite pages; clicking a citation highlights the passage. Uses your organization’s AI settings; the document is not used for training. Redacted or protected PDFs are left out.</p>
        </Section>
        <Gap tool={tool} />
      </Scroll>
      <RunBar tool={tool} label="Ask" why={!q.trim() ? 'Type a question or pick a suggestion.' : undefined} />
    </>
  );
}

const BODIES: Record<ToolId, (p: BodyProps) => React.ReactElement> = {
  create: CreateBody,
  edit: EditBody,
  export: ExportBody,
  combine: CombineBody,
  organize: OrganizeBody,
  ocr: OcrBody,
  compress: CompressBody,
  comment: CommentBody,
  'fill-sign': FillSignBody,
  esign: EsignBody,
  'prepare-form': PrepareFormBody,
  compare: CompareBody,
  protect: ProtectBody,
  redact: RedactBody,
  certificates: CertificatesBody,
  accessibility: AccessibilityBody,
  standards: StandardsBody,
  'print-production': PrintProductionBody,
  measure: MeasureBody,
  bates: BatesBody,
  actions: ActionsBody,
  ai: AiBody,
};
