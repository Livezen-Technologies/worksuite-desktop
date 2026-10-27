import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { apiGet, request } from '../../core/api';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { send } from './api';
import {
  BUTTON_COLOR, BUTTON_COLOURS, CONTENT_WIDTH, DIVIDER_SPACING, IMAGE_WIDTHS, TYPE_WORD, changed, convertHtml, copyOf, dangerousUrl, displayHtml, imagesWithoutAlt,
  makeBlock, parseBlocks, plainText, safeUrl, sanitizeText, serializeBlocks, tagText, tagsUsed, unknownTags, withScheme,
  type Block, type BlockType, type ButtonBlock, type Column, type ColumnsBlock, type DividerBlock, type HtmlBlock, type ImageBlock,
} from './email-blocks';
import { Field, Seg, Sheet, btn, btnPrimary, btnSmall, input } from './parts';
import { refusal, type EmailImage, type Pair } from './types';

/**
 * The email's content, as blocks (DK07): the palette and the merge tags on
 * the left, the email as it will look in the middle — on a desk, on a phone,
 * or as the plain text the server sends beside it — and the chosen block's
 * properties on the right.
 *
 * The blocks are `email-blocks.ts`'s, the web editor's format to the byte, so
 * either client opens what the other wrote. Text is typed where it shows (an
 * editable region that pastes plain words, so nothing from another program
 * comes along, and whose markup passes the same allowlist before it is shown
 * and before it is saved). HTML that is not a block is shown cleaned by the
 * server's own rules, without its style sheet, which would restyle WorkSuite.
 *
 * Uncontrolled: it reads `initial` when it opens and reports the whole body
 * outward on every change. Give it a new `key` to put other content in.
 */
type View = 'desktop' | 'mobile' | 'text';
type Picked = string | 'footer' | null;
type Adding = Exclude<BlockType, 'html'>;

const PALETTE: Array<{ type: Adding | 'footer'; label: string; icon: string }> = [
  { type: 'text', label: 'Text', icon: 'type' },
  { type: 'image', label: 'Image', icon: 'image' },
  { type: 'button', label: 'Button', icon: 'rounded' },
  { type: 'columns', label: 'Columns', icon: 'columns' },
  { type: 'divider', label: 'Divider', icon: 'separator' },
  { type: 'footer', label: 'Footer', icon: 'layout-strip' },
];

/** Tags the footer already carries on every copy. */
const IN_FOOTER = new Set(['unsubscribe_url', 'preferences_url']);

/**
 * The email's own look inside the app: the browser's defaults for headings,
 * paragraphs and lists (which the app's reset takes away), on the email's
 * white paper. These are the email's colours, not the app's, in either theme.
 */
const PAPER = cx(
  'text-[16px] leading-[1.6] [&_a]:text-brand-soft [&_a]:underline [&_blockquote]:border-l-[3px] [&_blockquote]:border-line [&_blockquote]:pl-3',
  '[&_h1]:my-[0.67em] [&_h1]:text-[2em] [&_h1]:leading-tight [&_h1]:font-bold [&_h2]:my-[0.83em] [&_h2]:text-[1.5em] [&_h2]:leading-tight [&_h2]:font-bold',
  '[&_h3]:my-[1em] [&_h3]:text-[1.17em] [&_h3]:font-bold [&_li]:my-0.5 [&_ol]:my-[1em] [&_ol]:list-decimal [&_ol]:pl-[1.5em] [&_p]:my-[1em]',
  '[&_ul]:my-[1em] [&_ul]:list-disc [&_ul]:pl-[1.5em] [&_img]:max-w-full [&_table]:border-collapse',
);
const PAPER_STYLE = { background: '#ffffff', color: '#1f2937', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, 'Noto Sans Sinhala', 'Noto Sans Tamil', sans-serif" } as const;

export interface BlockEditorProps {
  initial: string;
  onChange: (html: string) => void;
  /** The company the pictures belong to, and the plain-text version is made for. */
  orgId: number;
  /** The server's closed list of merge tags (`options.merge_tags`). */
  mergeTags: Pair[];
  readOnly?: boolean;
  /** For the footer's picture of itself. */
  companyName?: string | null;
  topicName?: string | null;
  /** Other text the email carries (its subject, its preview text), so the tag checks see all of it. */
  alsoText?: string[];
}

export function BlockEditor({ initial, onChange, orgId, mergeTags, readOnly = false, companyName, topicName, alsoText = [] }: BlockEditorProps) {
  const [blocks, setBlocks] = useState<Block[]>(() => parseBlocks(initial));
  const [picked, setPicked] = useState<Picked>(null);
  const [view, setView] = useState<View>('desktop');
  /** Where the cursor last was in a text region: a merge tag, a format or a link goes there. */
  const caret = useRef<{ el: HTMLElement; range: Range } | null>(null);

  const emit = (next: Block[]) => {
    setBlocks(next);
    onChange(serializeBlocks(next));
  };
  const put = (b: Block) => emit(blocks.map((x) => (x.id === b.id ? b : x)));
  const add = (type: Adding) => {
    const b = makeBlock(type);
    const at = blocks.findIndex((x) => x.id === picked);
    emit(at < 0 ? [...blocks, b] : [...blocks.slice(0, at + 1), b, ...blocks.slice(at + 1)]);
    setPicked(b.id);
  };
  const move = (id: string, by: -1 | 1) => {
    const i = blocks.findIndex((x) => x.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j]!, next[i]!];
    emit(next);
  };
  const remove = (id: string) => {
    emit(blocks.filter((x) => x.id !== id));
    setPicked(null);
  };
  const duplicate = (id: string) => {
    const i = blocks.findIndex((x) => x.id === id);
    if (i < 0) return;
    const c = copyOf(blocks[i]!);
    emit([...blocks.slice(0, i + 1), c, ...blocks.slice(i + 1)]);
    setPicked(c.id);
  };
  /** An HTML block turned into blocks, when the writer asks: never on opening. */
  const convert = (id: string) => {
    const i = blocks.findIndex((x) => x.id === id);
    const b = blocks[i];
    if (!b || b.type !== 'html') return;
    const made = convertHtml(b.html);
    emit([...blocks.slice(0, i), ...made, ...blocks.slice(i + 1)]);
    setPicked(made[0]?.id ?? null);
  };

  const html = serializeBlocks(blocks);
  const current = blocks.find((b) => b.id === picked) ?? null;

  /** Put the cursor back where it was (a click on a panel button took the focus), then act there. */
  const atCaret = (act: () => void): boolean => {
    const c = caret.current;
    if (!c || !c.el.isConnected || readOnly) return false;
    c.el.focus();
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(c.range);
    act();
    return true;
  };

  const insertTag = (tag: string, fallback: string) => {
    const words = tagText(tag, fallback);
    if (atCaret(() => insertText(words))) return;
    if (current?.type === 'text' && !readOnly) {
      put(changed(current, { html: appendWords(current.html, words) }));
      return;
    }
    void navigator.clipboard?.writeText(words).then(
      () => toast('info', `Copied ${words}: click into a text block, or paste it where it goes.`),
      () => toast('info', `Click into a text block first, then choose ${words}.`),
    );
  };

  return (
    <div className="flex flex-wrap overflow-hidden rounded-[12px] border border-line bg-surface">
      <aside aria-label="Blocks and merge tags" className="flex min-w-0 flex-[1_1_220px] flex-col gap-4 border-line p-4 md:max-w-[260px] md:border-r">
        <section>
          <h3 className="m-0 mb-2 text-[11px] font-bold tracking-[.5px] text-ink-3 uppercase">Blocks</h3>
          <div className="grid grid-cols-2 gap-2">
            {PALETTE.map((p) => (
              <button
                key={p.type}
                type="button"
                disabled={readOnly && p.type !== 'footer'}
                aria-label={p.type === 'footer' ? 'Footer: what WorkSuite adds to every copy' : `Add a ${p.label.toLowerCase()} block`}
                onClick={() => (p.type === 'footer' ? setPicked('footer') : add(p.type))}
                className={cx('flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-[10px] border border-line bg-surface px-1.5 py-2.5 text-[12.5px] font-semibold text-ink-2 hover:border-primary/40 hover:bg-subtle disabled:opacity-50', p.type === 'footer' && picked === 'footer' && 'border-primary bg-selection text-primary')}
              >
                <Icon name={p.icon} size={17} />
                {p.label}
              </button>
            ))}
          </div>
        </section>
        <MergeTags tags={mergeTags} html={html} alsoText={alsoText} readOnly={readOnly} onInsert={insertTag} />
      </aside>

      <section aria-label="The email" className="min-w-0 flex-[999_1_480px] bg-ground p-4 md:p-5">
        <div className="mb-3 flex justify-center">
          <Seg
            label="Show the email"
            value={view}
            onChange={setView}
            options={[
              { id: 'desktop', label: <span className="inline-flex items-center gap-1.5"><Icon name="monitor" size={14} />Desktop</span> },
              { id: 'mobile', label: <span className="inline-flex items-center gap-1.5"><Icon name="mobile" size={14} />Mobile</span> },
              { id: 'text', label: <span className="inline-flex items-center gap-1.5"><Icon name="type" size={14} />Plain text</span> },
            ]}
          />
        </div>
        {view === 'text' ? (
          <PlainVersion orgId={orgId} html={html} />
        ) : (
          <div
            className={cx('mx-auto overflow-hidden rounded-[6px] border border-line [transform:translateZ(0)]', PAPER)}
            style={{ ...PAPER_STYLE, maxWidth: view === 'mobile' ? 375 : 600 }}
            // A link in the email is for the recipient: here a click chooses the block.
            onClickCapture={(e) => {
              if ((e.target as HTMLElement).closest('a')) e.preventDefault();
            }}
          >
            {/* A list for screen readers, not an <ol>: the email's own list styles (PAPER) would number the blocks. */}
            <div role="list" aria-label="Blocks" style={{ padding: view === 'mobile' ? '20px 16px' : '32px' }}>
              {blocks.map((b, i) => (
                <div role="listitem" key={b.id}>
                  <Shell
                    block={b}
                    at={i}
                    of={blocks.length}
                    on={picked === b.id}
                    readOnly={readOnly}
                    onPick={() => setPicked(b.id)}
                    onMove={(by) => move(b.id, by)}
                    onDuplicate={() => duplicate(b.id)}
                    onRemove={() => remove(b.id)}
                  >
                    <BlockView block={b} readOnly={readOnly} onChange={put} onCaret={(el, range) => (caret.current = { el, range })} />
                  </Shell>
                </div>
              ))}
            </div>
            {blocks.length === 0 ? <p className="m-0 px-8 pb-6 text-center text-[14px]" style={{ color: '#6b7280' }}>Nothing here yet. Add a block from the left.</p> : null}
            <FooterView on={picked === 'footer'} onPick={() => setPicked('footer')} company={companyName} topic={topicName} />
          </div>
        )}
      </section>

      <aside aria-label="Properties" className="flex min-w-0 flex-[1_1_240px] flex-col gap-3 border-line p-4 md:max-w-[300px] md:border-l">
        {picked === 'footer' ? (
          <FooterProps company={companyName} />
        ) : current ? (
          <Props block={current} orgId={orgId} readOnly={readOnly} onChange={put} atCaret={atCaret} onConvert={() => convert(current.id)} />
        ) : (
          <NoneChosen blocks={blocks} />
        )}
      </aside>
    </div>
  );
}

/** Words added to the end of a text block, inside its last paragraph when it ends with one. */
function appendWords(html: string, words: string): string {
  const m = /<\/(p|h[1-6]|li|div)>\s*$/i.exec(html);
  return m ? `${html.slice(0, m.index)} ${words}${html.slice(m.index)}` : `${html} ${words}`;
}

/** Type words where the cursor is, as the keyboard would (so undo works); by hand where the browser cannot. */
function insertText(words: string): void {
  let done = false;
  try {
    done = document.execCommand('insertText', false, words);
  } catch {
    done = false;
  }
  if (done) return;
  const sel = window.getSelection();
  if (!sel?.rangeCount) return;
  const r = sel.getRangeAt(0);
  r.deleteContents();
  const t = document.createTextNode(words);
  r.insertNode(t);
  r.setStartAfter(t);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  const host = (t.parentElement?.closest('[contenteditable="true"]') ?? null) as HTMLElement | null;
  host?.dispatchEvent(new Event('input', { bubbles: true }));
}

function pastePlain(e: ClipboardEvent<HTMLDivElement>): void {
  e.preventDefault();
  const words = e.clipboardData.getData('text/plain');
  if (words) insertText(words);
}

/** A block on the canvas: chosen by a click or by the keyboard, moved with Alt+arrows, removed with Delete. */
function Shell({ block, at, of, on, readOnly, onPick, onMove, onDuplicate, onRemove, children }: {
  block: Block; at: number; of: number; on: boolean; readOnly: boolean; onPick: () => void; onMove: (by: -1 | 1) => void; onDuplicate: () => void; onRemove: () => void; children: ReactNode;
}) {
  const typed = block.type === 'text' || block.type === 'columns';
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (readOnly || e.target !== e.currentTarget) return;
    const act = e.altKey && e.key === 'ArrowUp' ? () => onMove(-1) : e.altKey && e.key === 'ArrowDown' ? () => onMove(1) : e.key === 'Delete' || e.key === 'Backspace' ? onRemove : null;
    if (!act) return;
    e.preventDefault();
    act();
  };
  const tool = 'flex size-7 items-center justify-center rounded-[6px] text-ink-2 hover:bg-subtle hover:text-ink disabled:opacity-40';
  return (
    <div
      role="group"
      aria-label={`${TYPE_WORD[block.type]} block, ${at + 1} of ${of}`}
      aria-current={on ? 'true' : undefined}
      tabIndex={typed ? -1 : 0}
      onMouseDown={onPick}
      onFocusCapture={onPick}
      onKeyDown={keys}
      className={cx('relative -mx-2 rounded-[4px] px-2 outline-offset-2', on ? 'outline-2 outline-primary' : 'hover:outline hover:outline-1 hover:outline-primary/40', 'focus-visible:outline-2 focus-visible:outline-primary')}
    >
      {on && !readOnly ? (
        <div className="absolute -top-4 right-1 z-10 flex gap-0.5 rounded-[8px] border border-line bg-surface p-0.5 text-ink shadow-[0_2px_8px_rgb(var(--ws-shadow-rgb)/.14)]" onMouseDown={(e) => e.stopPropagation()}>
          <button type="button" className={tool} aria-label="Move up" title="Move up (Alt+↑)" disabled={at === 0} onClick={() => onMove(-1)}>
            <Icon name="arrow-up" size={14} />
          </button>
          <button type="button" className={tool} aria-label="Move down" title="Move down (Alt+↓)" disabled={at === of - 1} onClick={() => onMove(1)}>
            <Icon name="arrow-down" size={14} />
          </button>
          <button type="button" className={tool} aria-label="Duplicate" title="Duplicate" onClick={onDuplicate}>
            <Icon name="copy" size={14} />
          </button>
          <button type="button" className={cx(tool, 'hover:text-danger')} aria-label="Delete" title="Delete" onClick={onRemove}>
            <Icon name="trash" size={14} />
          </button>
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** A region of text typed in place. Uncontrolled while it has the focus, so the cursor stays where it is. */
function Editable({ html, label, readOnly, onHtml, onCaret }: { html: string; label: string; readOnly: boolean; onHtml: (html: string) => void; onCaret: (el: HTMLElement, range: Range) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  /* Only the allowlist's markup is ever put into the page. */
  const safe = sanitizeText(html);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.innerHTML !== safe) el.innerHTML = safe;
  }, [safe]);
  const keep = () => {
    const el = ref.current;
    const sel = window.getSelection();
    if (el && sel?.rangeCount && el.contains(sel.anchorNode)) onCaret(el, sel.getRangeAt(0).cloneRange());
  };
  return (
    <div className="relative">
      {plainText(safe) === '' ? (
        <span aria-hidden="true" className="pointer-events-none absolute top-[1em] left-0" style={{ color: '#9ca3af' }}>
          Type here…
        </span>
      ) : null}
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        aria-readonly={readOnly || undefined}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onFocus={() => {
          try {
            document.execCommand('defaultParagraphSeparator', false, 'p');
          } catch {
            /* A browser without it keeps its own separator. */
          }
        }}
        onInput={(e) => onHtml(e.currentTarget.innerHTML)}
        onKeyUp={keep}
        onMouseUp={keep}
        onBlur={keep}
        onPaste={pastePlain}
        onDrop={(e) => e.preventDefault()}
        className="min-h-[1.6em] outline-none"
      />
    </div>
  );
}

function Picture({ src, alt, width, full }: { src: string; alt: string; width: number; full: boolean }) {
  if (!safeUrl(src) || dangerousUrl(src)) {
    return (
      <div className="flex h-[150px] items-center justify-center gap-2 rounded-[6px] text-[13px]" style={{ background: '#e7eef9', color: '#64748b' }}>
        <Icon name="image" size={16} /> Choose a picture in the properties
      </div>
    );
  }
  return <img src={src} alt={alt} width={width} style={{ display: 'block', width: full ? '100%' : undefined, maxWidth: '100%', height: 'auto', margin: full ? undefined : '0 auto', border: 0 }} />;
}

function BlockView({ block: b, readOnly, onChange, onCaret }: { block: Block; readOnly: boolean; onChange: (b: Block) => void; onCaret: (el: HTMLElement, range: Range) => void }) {
  switch (b.type) {
    case 'text':
      return <Editable html={b.html} label="Text" readOnly={readOnly} onCaret={onCaret} onHtml={(h) => onChange(changed(b, { html: h }))} />;
    case 'columns':
      return (
        <div className="mb-4 flex gap-4">
          {b.columns.map((c, i) => (
            <div key={i} className="min-w-0 flex-1">
              {c.kind === 'text' ? (
                <Editable html={c.html} label={i === 0 ? 'Left column' : 'Right column'} readOnly={readOnly} onCaret={onCaret} onHtml={(h) => onChange(changed(b, { columns: setColumn(b.columns, i as 0 | 1, { kind: 'text', html: h }) }))} />
              ) : (
                <Picture src={c.src} alt={c.alt} width={CONTENT_WIDTH / 2 - 8} full />
              )}
            </div>
          ))}
        </div>
      );
    case 'image': {
      const full = b.width === null || b.width >= CONTENT_WIDTH;
      return (
        <div style={{ margin: '0 0 16px' }}>
          <Picture src={b.src} alt={b.alt} width={full ? CONTENT_WIDTH : (b.width ?? CONTENT_WIDTH)} full={full} />
        </div>
      );
    }
    case 'button':
      return (
        <div style={{ margin: '8px 0 24px' }}>
          <span style={{ display: 'inline-block', padding: '12px 24px', fontWeight: 600, color: '#ffffff', background: b.color, borderRadius: 6 }}>{b.label || 'Button'}</span>
        </div>
      );
    case 'divider':
      return (
        <div style={{ padding: `${Math.max(0, b.spacing)}px 0` }}>
          <hr style={{ border: 0, borderTop: '1px solid #e5e7eb', margin: 0 }} />
        </div>
      );
    case 'html': {
      const shown = displayHtml(b.html);
      return shown.trim() ? (
        // Cleaned by the server's own rules, its style sheets taken out: what is left cannot run or restyle WorkSuite.
        <div dangerouslySetInnerHTML={{ __html: shown }} />
      ) : (
        <p className="m-0 py-2 text-[12.5px]" style={{ color: '#6b7280' }}>
          Kept as written: {/<style/i.test(b.html) ? 'the email’s own style sheet' : 'markup with nothing to show'}.
        </p>
      );
    }
  }
}

function setColumn(cols: [Column, Column], side: 0 | 1, col: Column): [Column, Column] {
  return side === 0 ? [col, cols[1]] : [cols[0], col];
}

/** The plain-text version the server sends beside the HTML, as the server makes it — footer and all. */
function PlainVersion({ orgId, html }: { orgId: number; html: string }) {
  const q = useQuery({
    queryKey: ['marketing', 'preview-text', orgId, html],
    queryFn: async ({ signal }) => (await request<{ text?: string }>('POST', '/api/marketing/preview', { body: { org_id: orgId, body_html: html }, signal })).data?.text ?? '',
    enabled: orgId > 0,
    retry: false,
    staleTime: 60_000,
  });
  return (
    <div className="mx-auto max-w-[600px] rounded-[8px] border border-line bg-surface p-4">
      <p className="m-0 mb-2 text-[12px] text-ink-3">What mail apps that prefer text show: the server’s plain-text version, with the footer’s lines.</p>
      {orgId <= 0 ? (
        <p className="m-0 text-[12.5px] text-ink-3">Choose the company first.</p>
      ) : q.isLoading ? (
        <Spinner label="Making the plain-text version…" />
      ) : q.error ? (
        <ErrorNote error={new Error(refusal(q.error, 'The plain-text version could not be made.'))} onRetry={() => void q.refetch()} />
      ) : (
        <pre aria-label="Plain-text version" className="m-0 font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-ink">{q.data || 'Nothing written yet.'}</pre>
      )}
    </div>
  );
}

/** Where the footer goes: the server writes it on every copy, from the company's settings. */
function FooterView({ on, onPick, company, topic }: { on: boolean; onPick: () => void; company?: string | null; topic?: string | null }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label="Footer, added by WorkSuite to every copy"
      aria-pressed={on}
      className={cx('block w-full px-8 py-4 text-left text-[12px] leading-[1.6]', on ? 'outline-2 -outline-offset-2 outline-primary' : 'hover:outline hover:outline-1 hover:-outline-offset-1 hover:outline-primary/40')}
      style={{ background: '#f8fafc', color: '#64748b' }}
    >
      <span className="block">{company || 'Your company'} · its postal address</span>
      <span className="block">You receive this because {topic ? `you subscribed to ${topic}` : 'you agreed to hear from us'}.</span>
      <span className="block">
        <span className="underline">Manage preferences</span> · <span className="underline">Unsubscribe</span>
      </span>
    </button>
  );
}

function MergeTags({ tags, html, alsoText, readOnly, onInsert }: { tags: Pair[]; html: string; alsoText: string[]; readOnly: boolean; onInsert: (tag: string, fallback: string) => void }) {
  const [fallback, setFallback] = useState('');
  const fid = useId();
  const used = tagsUsed(html, ...alsoText);
  const unknown = unknownTags(tags.map((t) => t.value), html, ...alsoText);
  return (
    <section className="flex min-w-0 flex-col">
      <h3 className="m-0 mb-1 text-[11px] font-bold tracking-[.5px] text-ink-3 uppercase">Merge tags</h3>
      <p className="m-0 mb-2 text-[12px] text-ink-3">Closed list — unknown tags block sending.</p>
      {tags.length === 0 ? (
        <p className="m-0 text-[12px] text-ink-3">This server did not send its list of tags.</p>
      ) : (
        <>
          <label htmlFor={fid} className="mb-1 text-[12px] font-semibold text-ink-2">
            Fallback for the next tag
          </label>
          <input id={fid} className={cx(input, 'mb-2 h-[30px] text-[12.5px]')} value={fallback} onChange={(e) => setFallback(e.target.value)} placeholder="there" disabled={readOnly} />
          <ul className="m-0 list-none p-0">
            {tags.map((t) => {
              const fb = IN_FOOTER.has(t.value) ? '' : fallback.trim() || (t.value === 'first_name' ? 'there' : '');
              return (
                <li key={t.value} className="border-b border-line/70 last:border-b-0">
                  <button
                    type="button"
                    disabled={readOnly}
                    title={`Insert ${tagText(t.value, fb)}`}
                    // Keep the cursor in the text being written.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onInsert(t.value, fb)}
                    className="flex w-full items-baseline justify-between gap-2 py-1.5 text-left text-[12.5px] hover:bg-subtle disabled:opacity-60"
                  >
                    <code className="min-w-0 truncate font-mono text-primary">{`{{${t.value}}}`}</code>
                    <span className="shrink-0 text-[11px] text-ink-3">
                      {IN_FOOTER.has(t.value) ? 'required · in the footer' : t.value === 'first_name' && !fallback.trim() ? 'fallback “there”' : t.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {used.size > 0 || unknown.length > 0 ? (
        <div className="mt-3">
          <h4 className="m-0 mb-1 text-[11px] font-bold tracking-[.5px] text-ink-3 uppercase">In this email</h4>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12px]">
            {unknown.map((t) => (
              <li key={t} className="flex items-start gap-1.5 text-danger">
                <Icon name="x-circle" size={14} className="mt-0.5 shrink-0" />
                <span>
                  <code className="font-mono">{`{{${t}}}`}</code> is not on the list: it blocks sending.
                </span>
              </li>
            ))}
            {[...used.entries()].filter(([t]) => !unknown.includes(t)).map(([t, safe]) => (
              <li key={t} className={cx('flex items-start gap-1.5', safe || IN_FOOTER.has(t) ? 'text-ink-2' : 'text-warning-ink dark:text-warning')}>
                <Icon name={safe || IN_FOOTER.has(t) ? 'check' : 'warning'} size={14} className="mt-0.5 shrink-0" />
                <span>
                  <code className="font-mono">{`{{${t}}}`}</code> {safe ? 'has a fallback' : IN_FOOTER.has(t) ? 'is filled in for everyone' : 'has no fallback: anyone without one sees nothing there'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function NoneChosen({ blocks }: { blocks: Block[] }) {
  const noAlt = imagesWithoutAlt(blocks);
  return (
    <>
      <h3 className="m-0 text-[15px] font-bold text-ink">Properties</h3>
      <p className="m-0 text-[12.5px] text-ink-3">Choose a block in the email to change it, or add one from the left. Text is typed where it shows; on a chosen block, Alt+↑ and Alt+↓ move it and Delete removes it.</p>
      {noAlt > 0 ? (
        <p className="m-0 rounded-[8px] bg-warning-bg px-2.5 py-2 text-[12px] text-warning-ink dark:text-warning">
          {noAlt === 1 ? 'A picture has' : `${noAlt} pictures have`} no alt text. The pre-send check warns about it: a screen reader cannot say what it shows, and nobody sees it while pictures are off.
        </p>
      ) : null}
    </>
  );
}

function FooterProps({ company }: { company?: string | null }) {
  return (
    <>
      <h3 className="m-0 text-[15px] font-bold text-ink">Footer</h3>
      <p className="m-0 text-[12.5px] text-ink-2">
        WorkSuite adds it to every copy when it sends, and it cannot be edited out: {company || 'the company'}’s name and postal address, why the person is getting the email, a link to choose their topics, and an unsubscribe link that works without signing in — with the one-click unsubscribe header mailbox providers ask for.
      </p>
      <p className="m-0 rounded-[8px] bg-selection px-2.5 py-2 text-[12px] text-primary">The postal address comes from Marketing’s settings, or the company’s invoice address. Without one the campaign cannot be sent.</p>
    </>
  );
}

/** The chosen block's settings. */
function Props({ block, orgId, readOnly, onChange, atCaret, onConvert }: { block: Block; orgId: number; readOnly: boolean; onChange: (b: Block) => void; atCaret: (act: () => void) => boolean; onConvert: () => void }) {
  const title = <h3 className="m-0 text-[15px] font-bold text-ink">{TYPE_WORD[block.type]} block</h3>;
  switch (block.type) {
    case 'text':
      return (
        <>
          {title}
          <Formatting readOnly={readOnly} atCaret={atCaret} />
          <p className="m-0 text-[12px] text-ink-3">Type in the block itself. A merge tag goes where the cursor is; pasted text comes in as plain words.</p>
        </>
      );
    case 'columns':
      return <ColumnsProps block={block} orgId={orgId} readOnly={readOnly} onChange={onChange} atCaret={atCaret} title={title} />;
    case 'image':
      return <ImageProps block={block} orgId={orgId} readOnly={readOnly} onChange={onChange} title={title} />;
    case 'button':
      return <ButtonProps block={block} readOnly={readOnly} onChange={onChange} title={title} />;
    case 'divider':
      return <DividerProps block={block} readOnly={readOnly} onChange={onChange} title={title} />;
    case 'html':
      return <HtmlProps block={block} readOnly={readOnly} onChange={onChange} onConvert={onConvert} title={title} />;
  }
}

/** The formatting a text region takes: paragraph or heading, bold, italic, lists, a link. */
function Formatting({ readOnly, atCaret }: { readOnly: boolean; atCaret: (act: () => void) => boolean }) {
  const [url, setUrl] = useState('');
  const run = (command: string, arg?: string) => {
    const done = atCaret(() => {
      try {
        document.execCommand(command, false, arg);
      } catch {
        /* Nothing to do where the browser cannot. */
      }
    });
    if (!done) toast('info', 'Click into the text first.');
  };
  const tool = 'flex h-[30px] min-w-[30px] items-center justify-center rounded-[7px] border border-line bg-surface px-1.5 text-[12px] font-semibold text-ink-2 hover:bg-subtle disabled:opacity-50';
  const items: Array<[string, string, string, string?]> = [
    ['Paragraph', 'pilcrow', 'formatBlock', 'p'],
    ['Heading', 'heading', 'formatBlock', 'h1'],
    ['Subheading', 'text-size', 'formatBlock', 'h2'],
    ['Bold', 'bold', 'bold'],
    ['Italic', 'italic', 'italic'],
    ['Underline', 'underline', 'underline'],
    ['Bulleted list', 'list', 'insertUnorderedList'],
    ['Numbered list', 'list-ordered', 'insertOrderedList'],
  ];
  const href = safeUrl(withScheme(url));
  return (
    <div className="flex flex-col gap-2">
      <div role="toolbar" aria-label="Text formatting" className="flex flex-wrap gap-1">
        {items.map(([label, icon, command, arg]) => (
          <button key={label} type="button" className={tool} aria-label={label} title={label} disabled={readOnly} onMouseDown={(e) => e.preventDefault()} onClick={() => run(command, arg)}>
            <Icon name={icon} size={15} />
          </button>
        ))}
      </div>
      <Field label="Link the chosen words">
        <span className="flex gap-1.5">
          <input className={cx(input, 'h-[30px] text-[12.5px]')} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" disabled={readOnly} />
          <button type="button" className={btnSmall} disabled={readOnly || !href} onMouseDown={(e) => e.preventDefault()} onClick={() => run('createLink', href)}>
            Link
          </button>
          <button type="button" className={btnSmall} aria-label="Remove the link" title="Remove the link" disabled={readOnly} onMouseDown={(e) => e.preventDefault()} onClick={() => run('unlink')}>
            <Icon name="unlink" size={14} />
          </button>
        </span>
      </Field>
    </div>
  );
}

/** The picture's file name, from its address. */
function fileName(src: string): string {
  const tail = src.split(/[?#]/)[0]!.split('/').pop() || src;
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}

function Warn({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="m-0 flex gap-1.5 text-[11.5px] text-warning-ink dark:text-warning">
      <Icon name="warning" size={13} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** A picture's settings: which picture, what it says to somebody who cannot see it, and where it leads. */
function ImageFields({ src, alt, href, orgId, readOnly, onPatch, onPicked }: {
  src: string; alt: string; href: string; orgId: number; readOnly: boolean;
  onPatch: (p: { src?: string; alt?: string; href?: string }) => void; onPicked?: (img: EmailImage) => void;
}) {
  const [picking, setPicking] = useState(false);
  const altId = useId();
  const warnId = useId();
  const noAlt = !!safeUrl(src) && !alt.trim();
  return (
    <>
      <Field label="Image" hint={src ? fileName(src) : undefined}>
        <span className="flex gap-1.5">
          <input className={cx(input, 'min-w-0 font-mono text-[12px]')} value={src} title={src} onChange={(e) => onPatch({ src: e.target.value.trim() })} disabled={readOnly} placeholder="https://" />
          <button type="button" className={btn} disabled={readOnly} onClick={() => setPicking(true)}>
            Choose…
          </button>
        </span>
      </Field>
      <div className="flex flex-col gap-1">
        <label htmlFor={altId} className="text-[12.5px] font-semibold text-ink">
          Alt text
        </label>
        <input id={altId} className={cx(input, noAlt && 'border-warning')} value={alt} onChange={(e) => onPatch({ alt: e.target.value })} disabled={readOnly} maxLength={200} placeholder="What the picture shows" aria-describedby={noAlt ? warnId : undefined} />
        {noAlt ? <Warn id={warnId}>Add alt text: it is what a screen reader says, and what shows while pictures are off. The pre-send check warns without it.</Warn> : null}
      </div>
      <Field label="Link" hint="Where a click on the picture goes. Empty: nowhere.">
        <input className={cx(input, 'font-mono text-[12.5px]')} value={href} onChange={(e) => onPatch({ href: e.target.value })} onBlur={(e) => onPatch({ href: withScheme(e.target.value) })} disabled={readOnly} placeholder="https://" />
      </Field>
      {picking ? (
        <ImagePicker
          orgId={orgId}
          onClose={() => setPicking(false)}
          onPick={(img) => {
            setPicking(false);
            if (onPicked) onPicked(img);
            else onPatch({ src: img.url });
          }}
        />
      ) : null}
    </>
  );
}

function ImageProps({ block, orgId, readOnly, onChange, title }: { block: ImageBlock; orgId: number; readOnly: boolean; onChange: (b: Block) => void; title: ReactNode }) {
  const widths = [...new Set([...IMAGE_WIDTHS, ...(block.width ? [block.width] : [])])].sort((x, y) => y - x);
  return (
    <>
      {title}
      <ImageFields
        src={block.src}
        alt={block.alt}
        href={block.href}
        orgId={orgId}
        readOnly={readOnly}
        onPatch={(p) => onChange(changed(block, p))}
        /* A picture narrower than the column keeps its own width. */
        onPicked={(img) => onChange(changed(block, { src: img.url, width: img.width && img.width < CONTENT_WIDTH ? img.width : block.width }))}
      />
      <Field label="Width">
        <Select<string>
          aria-label="Width"
          value={block.width === null ? '' : String(block.width)}
          disabled={readOnly}
          onValueChange={(v) => onChange(changed(block, { width: v === '' ? null : Number(v) }))}
          options={[{ value: '', label: 'Full width' }, ...widths.map((w) => ({ value: String(w), label: `${w} px, centred` }))]}
        />
      </Field>
      <p className="m-0 rounded-[8px] bg-selection px-2.5 py-2 text-[12px] text-primary">Images are served from the public images library so they load in every inbox without sign-in.</p>
    </>
  );
}

function ColumnsProps({ block, orgId, readOnly, onChange, atCaret, title }: { block: ColumnsBlock; orgId: number; readOnly: boolean; onChange: (b: Block) => void; atCaret: (act: () => void) => boolean; title: ReactNode }) {
  return (
    <>
      {title}
      <p className="m-0 text-[12px] text-ink-3">Two columns, side by side on a desk and on most phones.</p>
      {block.columns.map((col, i) => {
        const side = i as 0 | 1;
        const set = (c: Column) => onChange(changed(block, { columns: setColumn(block.columns, side, c) }));
        return (
          <fieldset key={side} className="m-0 flex flex-col gap-2.5 rounded-[10px] border border-line p-3">
            <legend className="px-1 text-[12.5px] font-bold text-ink">{side === 0 ? 'Left column' : 'Right column'}</legend>
            <Field label="Holds">
              <Seg<'text' | 'image'>
                label={`${side === 0 ? 'Left' : 'Right'} column holds`}
                value={col.kind}
                onChange={(k) => !readOnly && k !== col.kind && set(k === 'image' ? { kind: 'image', src: '', alt: '', href: '' } : { kind: 'text', html: '<p>Text.</p>' })}
                options={[{ id: 'text', label: 'Text' }, { id: 'image', label: 'Image' }]}
              />
            </Field>
            {col.kind === 'image' ? (
              <ImageFields src={col.src} alt={col.alt} href={col.href} orgId={orgId} readOnly={readOnly} onPatch={(p) => set({ ...col, ...p })} />
            ) : (
              <p className="m-0 text-[12px] text-ink-3">Type in the column itself.</p>
            )}
          </fieldset>
        );
      })}
      {block.columns.some((c) => c.kind === 'text') ? <Formatting readOnly={readOnly} atCaret={atCaret} /> : null}
    </>
  );
}

function ButtonProps({ block, readOnly, onChange, title }: { block: ButtonBlock; readOnly: boolean; onChange: (b: Block) => void; title: ReactNode }) {
  return (
    <>
      {title}
      <Field label="Label">
        <input className={input} value={block.label} onChange={(e) => onChange(changed(block, { label: e.target.value }))} disabled={readOnly} maxLength={80} />
      </Field>
      <Field label="Link">
        <input className={cx(input, 'font-mono text-[12.5px]')} value={block.href} onChange={(e) => onChange(changed(block, { href: e.target.value }))} onBlur={(e) => onChange(changed(block, { href: withScheme(e.target.value) }))} disabled={readOnly} placeholder="https://" />
      </Field>
      {block.href.trim() === '' ? <Warn>Give the button a link: without one it goes nowhere.</Warn> : null}
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-1 text-[12.5px] font-semibold text-ink">Colour</legend>
        <div className="flex flex-wrap items-center gap-1.5">
          {BUTTON_COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              aria-pressed={block.color.toLowerCase() === c}
              disabled={readOnly}
              onClick={() => onChange(changed(block, { color: c }))}
              className={cx('size-7 rounded-[6px] border-2', block.color.toLowerCase() === c ? 'border-ink' : 'border-transparent')}
              style={{ background: c }}
            />
          ))}
          <input className={cx(input, 'h-[30px] w-[96px] font-mono text-[12px]')} aria-label="Colour, as a hex code" value={block.color} placeholder={BUTTON_COLOR} onChange={(e) => onChange(changed(block, { color: e.target.value }))} disabled={readOnly} />
        </div>
      </fieldset>
    </>
  );
}

function DividerProps({ block, readOnly, onChange, title }: { block: DividerBlock; readOnly: boolean; onChange: (b: Block) => void; title: ReactNode }) {
  const spacings = [...new Set([...DIVIDER_SPACING, block.spacing])].sort((x, y) => x - y);
  return (
    <>
      {title}
      <Field label="Spacing above and below">
        <Select<string> aria-label="Spacing above and below" value={String(block.spacing)} disabled={readOnly} onValueChange={(v) => onChange(changed(block, { spacing: Number(v) }))} options={spacings.map((s) => ({ value: String(s), label: `${s} px` }))} />
      </Field>
    </>
  );
}

function HtmlProps({ block, readOnly, onChange, onConvert, title }: { block: HtmlBlock; readOnly: boolean; onChange: (b: Block) => void; onConvert: () => void; title: ReactNode }) {
  const id = useId();
  return (
    <>
      {title}
      <p className="m-0 text-[12px] text-ink-3">Kept exactly as written — before the block editor, or in another tool. The server takes out scripts and event handlers when it saves.</p>
      <label htmlFor={id} className="text-[12.5px] font-semibold text-ink">
        HTML
      </label>
      <textarea
        id={id}
        value={block.html}
        onChange={(e) => onChange(changed(block, { html: e.target.value }))}
        readOnly={readOnly}
        spellCheck={false}
        className="min-h-[220px] w-full resize-y rounded-[8px] border border-line bg-ground p-2 font-mono text-[11.5px] leading-relaxed text-ink outline-none focus:border-primary"
      />
      {!readOnly ? (
        <button type="button" className={btnSmall} onClick={onConvert}>
          Turn into blocks
        </button>
      ) : null}
    </>
  );
}

/** The company's pictures, a way to add one, or one already on the web. A picture's address is public: it goes out in the email. */
function ImagePicker({ orgId, onPick, onClose }: { orgId: number; onPick: (img: EmailImage) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const q = useQuery({ queryKey: ['marketing', 'images'], queryFn: ({ signal }) => apiGet<{ items: EmailImage[]; max_bytes?: number }>('/api/marketing/images', undefined, signal) });
  const mine = (q.data?.items ?? []).filter((i) => i.org_id === orgId);
  const mb = q.data?.max_bytes ? `${Math.round(q.data.max_bytes / 1_048_576)} MB` : null;

  const upload = async (f: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', f);
      form.append('org_id', String(orgId));
      const r = await send<EmailImage>('POST', '/api/marketing/images', form);
      void qc.invalidateQueries({ queryKey: ['marketing', 'images'] });
      toast('success', r.message ?? 'Uploaded.');
      onPick(r.data);
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Choose a picture" width={640} onClose={onClose} footer={<button type="button" className={btn} onClick={onClose}>Cancel</button>}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          aria-label="Picture file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = '';
          }}
        />
        <button type="button" className={btnPrimary} disabled={busy || orgId <= 0} onClick={() => file.current?.click()}>
          <Icon name="upload" size={15} /> {busy ? 'Uploading…' : 'Upload a picture'}
        </button>
        <span className="text-[12px] text-ink-3">PNG, JPEG, GIF or WebP{mb ? `, up to ${mb}` : ''}. Pictures are public: anybody with the email can see them.</span>
      </div>
      <Field label="Or a picture already on the web">
        <span className="flex gap-1.5">
          <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          <button type="button" className={btn} disabled={!/^https:\/\/\S+$/i.test(url.trim())} onClick={() => onPick({ id: 0, org_id: orgId, name: url.trim(), url: url.trim(), width: null, height: null, bytes: 0, created_at: null })}>
            Use it
          </button>
        </span>
      </Field>
      {q.isLoading ? (
        <Spinner label="Loading pictures…" />
      ) : q.error ? (
        <p className="m-0 text-[12.5px] text-danger">{refusal(q.error, 'The pictures could not be loaded.')}</p>
      ) : mine.length === 0 ? (
        <p className="m-0 text-[12.5px] text-ink-3">No pictures uploaded for this company yet.</p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 sm:grid-cols-4">
          {mine.map((img) => (
            <li key={img.id}>
              <button type="button" onClick={() => onPick(img)} title={img.name} className="block w-full overflow-hidden rounded-[8px] border border-line text-left hover:border-primary">
                <img src={img.url} alt={img.name} className="h-20 w-full bg-subtle object-cover" />
                <span className="block truncate px-2 py-1 text-[11px] text-ink-2">{img.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
