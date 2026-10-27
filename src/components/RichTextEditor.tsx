import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { text } from '../core/i18n';
import { Icon } from './Icon';
import { cx } from './ui';

/**
 * The shared formatted-text editor (contentEditable + the browser's editing
 * commands): bold, italic, underline, strikethrough, colour and highlight, a
 * text style, lists, indent, quote, links with a checked address, clear
 * formatting and its own undo/redo — with the usual shortcuts and a toolbar
 * whose buttons say which marks are on (`aria-pressed`).
 *
 * `value` is HTML. The editor keeps its own text while you type and hands it
 * out through `clean` (the caller's allow-list); a `value` that comes back
 * unchanged is never written over the caret, while a different one — a
 * restored draft, an AI rewrite, a template — replaces the content and can be
 * undone. Pasted markup goes through `clean` too; pasted or dropped files go
 * to `onFiles` (or are refused) and never become inline data.
 */

export type ToolId = 'bold' | 'italic' | 'underline' | 'strike' | 'colour' | 'highlight' | 'block' | 'bullets' | 'numbers' | 'indent' | 'outdent' | 'quote' | 'link' | 'table' | 'clear' | 'undo' | 'redo';

export const ALL_TOOLS: ToolId[] = ['undo', 'redo', 'block', 'bold', 'italic', 'underline', 'strike', 'colour', 'highlight', 'link', 'table', 'bullets', 'numbers', 'outdent', 'indent', 'quote', 'clear'];

interface ToolDef {
  label: string;
  icon: string;
  keys?: string;
  /** The `document.execCommand` it runs; tools without one are handled by the editor. */
  cmd?: string;
  arg?: string;
  /** Reported as on/off from the selection. */
  mark?: boolean;
}

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
const MOD = mac ? '⌘' : 'Ctrl+';

function defs(): Record<ToolId, ToolDef> {
  return {
    bold: { label: text('Bold'), icon: 'bold', keys: `${MOD}B`, cmd: 'bold', mark: true },
    italic: { label: text('Italic'), icon: 'italic', keys: `${MOD}I`, cmd: 'italic', mark: true },
    underline: { label: text('Underline'), icon: 'underline', keys: `${MOD}U`, cmd: 'underline', mark: true },
    strike: { label: text('Strikethrough'), icon: 'strikethrough', keys: `${MOD}Shift+X`, cmd: 'strikeThrough', mark: true },
    colour: { label: text('Text colour'), icon: 'text-colour' },
    highlight: { label: text('Highlight'), icon: 'highlighter' },
    block: { label: text('Text style'), icon: 'heading' },
    bullets: { label: text('Bulleted list'), icon: 'list', keys: `${MOD}Shift+8`, cmd: 'insertUnorderedList', mark: true },
    numbers: { label: text('Numbered list'), icon: 'list-ordered', keys: `${MOD}Shift+7`, cmd: 'insertOrderedList', mark: true },
    indent: { label: text('Increase indent'), icon: 'indent', keys: 'Tab', cmd: 'indent' },
    outdent: { label: text('Decrease indent'), icon: 'outdent', keys: 'Shift+Tab', cmd: 'outdent' },
    quote: { label: text('Quote'), icon: 'quote', keys: `${MOD}Shift+9`, mark: true },
    link: { label: text('Link'), icon: 'link', keys: `${MOD}K`, mark: true },
    table: { label: text('Insert table'), icon: 'table' },
    clear: { label: text('Clear formatting'), icon: 'clear-format', keys: `${MOD}\\` },
    undo: { label: text('Undo'), icon: 'undo-edit', keys: `${MOD}Z` },
    redo: { label: text('Redo'), icon: 'redo-edit', keys: mac ? '⌘Shift+Z' : 'Ctrl+Y' },
  };
}

export const TEXT_COLOURS = ['#202124', '#5F6368', '#C5221F', '#E37400', '#188038', '#1967D2', '#7B1FA2'];
export const HIGHLIGHTS = ['#FDE293', '#CEEAD6', '#D2E3FC', '#FAD2CF', '#E9D2FD'];
/** Applied, then found and taken off again: how "no colour" is done with the browser's colour commands. */
const SENTINEL = '#010203';
const SENTINEL_RGB = 'rgb(1, 2, 3)';

/** A small table to type into: two rows of three cells, with borders an email client will show. */
const CELL = '<td style="border: 1px solid #cccccc; padding: 4px 8px; vertical-align: top"><br></td>';
export const TABLE_HTML = `<table style="border-collapse: collapse"><tbody><tr>${CELL.repeat(3)}</tr><tr>${CELL.repeat(3)}</tr></tbody></table><div><br></div>`;

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text as editor HTML: escaped, lines kept. */
export function plainToHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

/** The editor's text, a line per paragraph, list item and break. */
export function htmlLines(html: string): string {
  const spaced = html.replace(/<\/(p|div|h[1-6]|li|blockquote|pre)>|<br\s*\/?>/gi, (m) => `${m}\n`);
  const t = new DOMParser().parseFromString(spaced, 'text/html').body.textContent ?? '';
  return t.replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * A link address as typed, made into one the editor will keep — or null.
 * `www.…` gains https://, a bare address gains mailto:, anything else must be
 * http(s) with a host, mailto with an address, or (when allowed) tel.
 */
export function normalizeLink(input: string, allowTel = false): string | null {
  let url = input.trim();
  if (!url || /\s/.test(url)) return null;
  if (/^[^@\s/:]+@[^@\s/]+\.[^@\s/]+$/.test(url)) url = `mailto:${url}`;
  else if (/^www\./i.test(url)) url = `https://${url}`;
  if (/^mailto:/i.test(url)) return /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(url.split('?')[0]!) ? url : null;
  if (/^tel:/i.test(url)) return allowTel && /^tel:\+?[\d\s().-]{3,}$/i.test(url) ? url : null;
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && /\./.test(u.hostname) ? url : null;
  } catch {
    return null;
  }
}

const BLOCKS = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'PRE', 'LI', 'TD', 'TH'];

interface Active {
  marks: Set<ToolId>;
  block: string;
  link: HTMLAnchorElement | null;
}

/** What the caret sits in: marks from the elements around it (and the browser's own state, when it has one). */
function activeAt(box: HTMLElement | null): Active {
  const marks = new Set<ToolId>();
  let block = '';
  let link: HTMLAnchorElement | null = null;
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  const node = sel?.anchorNode ?? null;
  if (!box || !node || !box.contains(node)) return { marks, block, link };
  for (let el: Element | null = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement; el && el !== box; el = el.parentElement) {
    const tag = el.tagName;
    const style = (el as HTMLElement).style;
    if (tag === 'B' || tag === 'STRONG' || /^(bold|[6-9]00)$/.test(style?.fontWeight ?? '')) marks.add('bold');
    if (tag === 'I' || tag === 'EM' || style?.fontStyle === 'italic') marks.add('italic');
    if (tag === 'U' || /underline/.test(style?.textDecoration ?? '')) marks.add('underline');
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || /line-through/.test(style?.textDecoration ?? '')) marks.add('strike');
    if (tag === 'UL') marks.add('bullets');
    if (tag === 'OL') marks.add('numbers');
    if (tag === 'BLOCKQUOTE') marks.add('quote');
    if (tag === 'A' && !link) {
      marks.add('link');
      link = el as HTMLAnchorElement;
    }
    if (!block && BLOCKS.includes(tag) && tag !== 'LI' && tag !== 'BLOCKQUOTE') block = tag.toLowerCase();
  }
  if (typeof document.queryCommandState === 'function') {
    for (const [id, cmd] of [['bold', 'bold'], ['italic', 'italic'], ['underline', 'underline'], ['strike', 'strikeThrough']] as const) {
      try {
        if (document.queryCommandState(cmd)) marks.add(id);
      } catch {
        /* not supported here */
      }
    }
  }
  return { marks, block, link };
}

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  /** The allow-list everything leaving the editor (and everything pasted) goes through. */
  clean: (html: string) => string;
  label: string;
  placeholder?: string;
  tools?: ToolId[];
  /** Different names for some tools, where a screen has always used its own. */
  toolLabels?: Partial<Record<ToolId, string>>;
  /** The "Text style" choices: block tags. */
  blocks?: Array<{ value: string; label: string }>;
  allowTel?: boolean;
  /** Files pasted or dropped in. Without it they are refused (and `onFilesRefused` says why). */
  onFiles?: (files: File[]) => void;
  onFilesRefused?: () => void;
  /** Turn "- ", "1. " and "> " at the start of a line into a list or a quote. */
  markdownShortcuts?: boolean;
  /** Controls after the formatting tools (AI, attach…). */
  toolbarEnd?: ReactNode;
  /** Below the text (a shortcut hint, say). */
  footer?: ReactNode;
  /** Grow to fill the parent (a page-sized editor; the parent scrolls, the toolbar stays) rather than sit at `minHeight`. */
  fill?: boolean;
  minHeight?: number;
  maxHeight?: number | string;
  autoFocus?: boolean;
  className?: string;
  boxClassName?: string;
  /** For a parent that wants to focus the text. */
  editorRef?: React.MutableRefObject<HTMLDivElement | null>;
}

const DEFAULT_BLOCKS = () => [
  { value: 'div', label: text('Normal text') },
  { value: 'h2', label: text('Heading') },
  { value: 'h3', label: text('Subheading') },
];

export const RICH_CONTENT_CLASS =
  'break-words leading-[1.6] text-ink [&_a]:text-primary [&_a]:underline [&_blockquote]:my-1 [&_blockquote]:border-l-[3px] [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-2 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:text-[18px] [&_h2]:font-bold [&_h3]:text-[15px] [&_h3]:font-bold [&_h4]:font-bold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:my-0.5 [&_pre]:whitespace-pre-wrap [&_pre]:rounded-[6px] [&_pre]:bg-subtle [&_pre]:p-2 [&_pre]:font-mono [&_table]:my-1 [&_table]:border-collapse [&_td]:min-w-[48px] [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1 [&_[style*=background-color]]:text-ink';

export function RichTextEditor({
  value,
  onChange,
  clean,
  label,
  placeholder,
  tools = ALL_TOOLS,
  toolLabels,
  blocks,
  allowTel,
  onFiles,
  onFilesRefused,
  markdownShortcuts,
  toolbarEnd,
  footer,
  fill,
  minHeight = 120,
  maxHeight,
  autoFocus,
  className,
  boxClassName,
  editorRef,
}: RichTextEditorProps) {
  const box = useRef<HTMLDivElement | null>(null);
  const last = useRef<string | null>(null);
  const history = useRef<string[]>([]);
  const cursor = useRef(-1);
  const typedAt = useRef(0);
  const range = useRef<Range | null>(null);
  const [empty, setEmpty] = useState(!value);
  const [active, setActive] = useState<Active>({ marks: new Set(), block: '', link: null });
  const [panel, setPanel] = useState<null | 'link' | 'colour' | 'highlight'>(null);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState('');
  const d = defs();
  const name = (id: ToolId) => toolLabels?.[id] ?? d[id].label;
  const choices = blocks ?? DEFAULT_BLOCKS();

  const isEmpty = (el: HTMLElement) => !(el.textContent ?? '').trim() && !el.querySelector('li, img, hr, blockquote');

  const record = (html: string, typing: boolean) => {
    const now = Date.now();
    if (html === history.current[cursor.current]) return;
    const coalesce = typing && now - typedAt.current < 1000 && cursor.current > 0;
    history.current = [...history.current.slice(0, cursor.current + (coalesce ? 0 : 1)), html].slice(-200);
    cursor.current = history.current.length - 1;
    typedAt.current = typing ? now : 0;
  };

  // A value from outside (first render, a restored draft, a rewrite) replaces the text; our own echo does not.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || value === last.current) return;
    el.innerHTML = value;
    last.current = value;
    record(value, false);
    setEmpty(isEmpty(el));
  }, [value]);

  useEffect(() => {
    if (autoFocus) box.current?.focus();
    const onSelection = () => {
      const s = window.getSelection();
      if (s?.rangeCount && box.current?.contains(s.anchorNode)) {
        range.current = s.getRangeAt(0).cloneRange();
        setActive(activeAt(box.current));
      }
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remember = () => {
    const s = window.getSelection();
    if (s?.rangeCount && box.current?.contains(s.anchorNode)) range.current = s.getRangeAt(0).cloneRange();
    setActive(activeAt(box.current));
  };

  const restore = () => {
    box.current?.focus();
    if (range.current && box.current?.contains(range.current.startContainer)) {
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range.current);
    }
  };

  const changed = (typing = false) => {
    const el = box.current;
    if (!el) return;
    const html = clean(el.innerHTML);
    record(html, typing);
    last.current = html;
    setEmpty(isEmpty(el));
    onChange(html);
    remember();
  };

  const caretToEnd = () => {
    const el = box.current;
    if (!el) return;
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
    range.current = null;
  };

  const travel = (step: -1 | 1) => {
    const next = Math.max(0, Math.min(history.current.length - 1, cursor.current + step));
    if (next === cursor.current || !box.current) return;
    cursor.current = next;
    typedAt.current = 0;
    const html = history.current[next]!;
    box.current.innerHTML = html;
    last.current = html;
    setEmpty(isEmpty(box.current));
    onChange(html);
    caretToEnd();
  };

  const selectionInBox = (): Range | null => {
    const s = window.getSelection();
    if (s?.rangeCount && box.current?.contains(s.anchorNode)) return s.getRangeAt(0);
    return null;
  };

  /** Colour on, or (with null) off: the sentinel colour is applied and then taken back out. */
  const colour = (kind: 'colour' | 'highlight', c: string | null) => {
    restore();
    const cmd = kind === 'colour' ? 'foreColor' : 'hiliteColor';
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(cmd, false, c ?? SENTINEL);
    document.execCommand('styleWithCSS', false, 'false');
    if (!c && box.current) {
      const prop = kind === 'colour' ? 'color' : 'background-color';
      box.current.querySelectorAll<HTMLElement>('[style], font[color]').forEach((el) => {
        if (el.tagName === 'FONT' && /^#?010203$/i.test(el.getAttribute('color') ?? '')) el.removeAttribute('color');
        if (el.style.getPropertyValue(prop).replace(/\s/g, '') === SENTINEL_RGB.replace(/\s/g, '') || el.style.getPropertyValue(prop).toLowerCase() === SENTINEL) el.style.removeProperty(prop);
        if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
        if ((el.tagName === 'SPAN' || el.tagName === 'FONT') && !el.attributes.length) el.replaceWith(...el.childNodes);
      });
    }
    setPanel(null);
    changed();
  };

  const openLink = () => {
    remember();
    const a = activeAt(box.current).link;
    setLink(a?.getAttribute('href') ?? '');
    setLinkError('');
    setPanel('link');
  };

  const applyLink = () => {
    const url = normalizeLink(link, allowTel);
    if (!url) {
      setLinkError(allowTel ? text('Use an https, http, mailto or tel address.') : text('Use an https, http or mailto address (for example https://example.com).'));
      return;
    }
    restore();
    const existing = activeAt(box.current).link;
    if (existing) {
      existing.setAttribute('href', url);
    } else {
      const r = selectionInBox();
      if (!r || r.collapsed) document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}">${escapeHtml(url.replace(/^mailto:/i, ''))}</a>`);
      else document.execCommand('createLink', false, url);
    }
    setPanel(null);
    changed();
  };

  const removeLink = () => {
    restore();
    const a = activeAt(box.current).link;
    if (a) {
      const r = document.createRange();
      r.selectNodeContents(a);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(r);
    }
    document.execCommand('unlink');
    if (a?.isConnected) a.replaceWith(...a.childNodes);
    setPanel(null);
    changed();
  };

  const clear = () => {
    restore();
    const r = selectionInBox();
    if (r && !r.collapsed) {
      document.execCommand('removeFormat');
      document.execCommand('unlink');
    } else if (box.current) {
      box.current.innerHTML = plainToHtml(htmlLines(box.current.innerHTML));
    }
    changed();
  };

  const run = (id: ToolId) => {
    if (id === 'undo' || id === 'redo') return travel(id === 'undo' ? -1 : 1);
    if (id === 'link') return panel === 'link' ? setPanel(null) : openLink();
    if (id === 'colour' || id === 'highlight') {
      remember();
      return setPanel(panel === id ? null : id);
    }
    if (id === 'clear') return clear();
    restore();
    if (id === 'table') {
      document.execCommand('insertHTML', false, TABLE_HTML);
      return changed();
    }
    if (id === 'quote') document.execCommand('formatBlock', false, active.marks.has('quote') ? 'div' : 'blockquote');
    else document.execCommand(d[id].cmd!, false, d[id].arg);
    changed();
  };

  /** "- ", "* ", "1. " or "> " typed at the start of a line. */
  const shortcut = (): boolean => {
    const s = window.getSelection();
    if (!s?.rangeCount || !s.isCollapsed || !box.current?.contains(s.anchorNode)) return false;
    const node = s.anchorNode!;
    const start = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const blockEl = start?.closest('div, p, h1, h2, h3, h4, li, blockquote') ?? null;
    const scope = blockEl && box.current.contains(blockEl) && blockEl !== box.current ? blockEl : box.current;
    if (scope.closest('li, blockquote') && scope !== box.current) return false;
    const before = document.createRange();
    before.setStart(scope, 0);
    before.setEnd(s.anchorNode!, s.anchorOffset);
    // Only the text since the last line break in this block counts.
    const typed = before.toString().split('\n').pop() ?? '';
    const cmd = typed === '-' || typed === '*' ? 'insertUnorderedList' : typed === '1.' ? 'insertOrderedList' : typed === '>' ? 'quote' : null;
    if (!cmd || before.cloneContents().querySelector?.('br')) return false;
    s.removeAllRanges();
    s.addRange(before);
    document.execCommand('delete');
    if (cmd === 'quote') document.execCommand('formatBlock', false, 'blockquote');
    else document.execCommand(cmd);
    changed();
    return true;
  };

  const files = (list: FileList | null | undefined): File[] => (list ? [...list] : []);

  const show = (id: ToolId) => tools.includes(id);
  const button = (id: ToolId) => (
    <button
      key={id}
      type="button"
      aria-label={name(id)}
      title={d[id].keys ? `${name(id)} (${d[id].keys})` : name(id)}
      aria-pressed={d[id].mark ? active.marks.has(id) : id === 'colour' || id === 'highlight' ? panel === id : undefined}
      aria-expanded={id === 'link' || id === 'colour' || id === 'highlight' ? panel === id : undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => run(id)}
      className={cx('inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-[6px] px-1 text-ink-2 hover:bg-subtle hover:text-ink', (active.marks.has(id) || panel === id) && 'bg-selection text-primary')}
    >
      <Icon name={d[id].icon} size={15} />
    </button>
  );
  const sep = (key: string) => <span key={key} aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-line" />;

  const groups: ToolId[][] = [['undo', 'redo'], ['block'], ['bold', 'italic', 'underline', 'strike', 'colour', 'highlight'], ['link', 'table'], ['bullets', 'numbers', 'outdent', 'indent', 'quote'], ['clear']];
  const bar: ReactNode[] = [];
  for (const g of groups) {
    const here = g.filter(show);
    if (!here.length) continue;
    if (bar.length) bar.push(sep(`sep-${g[0]}`));
    for (const id of here) {
      if (id === 'block') {
        bar.push(
          <select
            key="block"
            aria-label={name('block')}
            title={name('block')}
            value={choices.some((c) => c.value === active.block) ? active.block : choices[0]!.value}
            onMouseDown={remember}
            onFocus={remember}
            onChange={(e) => {
              restore();
              document.execCommand('formatBlock', false, e.target.value);
              changed();
            }}
            className="h-7 shrink-0 rounded-[6px] border border-transparent bg-transparent px-1 text-[12.5px] text-ink-2 hover:border-line hover:text-ink"
          >
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>,
        );
      } else bar.push(button(id));
    }
  }

  return (
    <div className={cx('relative flex flex-col rounded-[10px] border border-line bg-surface transition-shadow focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25', fill && 'flex-1', className)}>
      <div role="toolbar" aria-label={text('{label} formatting', { label })} className={cx('flex shrink-0 flex-wrap items-center gap-0.5 rounded-t-[10px] border-b border-line bg-surface px-1.5 py-1', fill && 'sticky top-0 z-10')}>
        {bar}
        {toolbarEnd ? <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">{toolbarEnd}</span> : null}
      </div>
      {panel === 'link' ? (
        <div
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-subtle/60 px-2.5 py-1.5 text-[12.5px]"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setPanel(null);
              restore();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              applyLink();
            }
          }}
        >
          <Icon name="link" size={14} className="text-ink-3" />
          <input
            autoFocus
            aria-label={text('Link address')}
            aria-invalid={!!linkError || undefined}
            placeholder="https://"
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              setLinkError('');
            }}
            className="h-7 min-w-[180px] flex-1 rounded-[6px] border border-line bg-surface px-2 text-ink outline-none focus:border-primary"
          />
          <button type="button" onClick={applyLink} className="h-7 rounded-[6px] bg-primary px-2.5 font-semibold text-[var(--ws-on-primary)] hover:bg-primary-hover">
            {active.link ? text('Update link') : text('Add link')}
          </button>
          {active.link ? (
            <button type="button" onClick={removeLink} className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 font-semibold text-ink-2 hover:bg-surface">
              <Icon name="unlink" size={13} /> {text('Remove link')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setPanel(null);
              restore();
            }}
            className="h-7 rounded-[6px] px-2 text-ink-2 hover:bg-surface"
          >
            {text('Cancel link')}
          </button>
          {linkError ? (
            <span role="alert" className="basis-full text-danger">
              {linkError}
            </span>
          ) : null}
        </div>
      ) : null}
      {panel === 'colour' || panel === 'highlight' ? (
        <div role="group" aria-label={name(panel)} className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-subtle/60 px-2.5 py-1.5" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setPanel(null), restore())}>
          {(panel === 'colour' ? TEXT_COLOURS : HIGHLIGHTS).map((c) => (
            <button key={c} type="button" aria-label={text('{tool} {colour}', { tool: name(panel), colour: c })} title={c} onMouseDown={(e) => e.preventDefault()} onClick={() => colour(panel, c)} className="h-6 w-6 rounded-full border border-line hover:scale-110" style={{ background: c }} />
          ))}
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => colour(panel, null)} className="h-6 rounded-[6px] px-2 text-[12px] font-semibold text-ink-2 hover:bg-surface">
            {panel === 'colour' ? text('Default colour') : text('No highlight')}
          </button>
        </div>
      ) : null}
      <div className={cx('relative', fill && 'flex flex-1 flex-col')}>
        {empty && placeholder ? <span aria-hidden className="pointer-events-none absolute top-3 left-4 text-[14px] text-ink-3">{placeholder}</span> : null}
        <div
          ref={(el) => {
            box.current = el;
            if (editorRef) editorRef.current = el;
          }}
          role="textbox"
          aria-label={label}
          aria-multiline="true"
          aria-placeholder={placeholder}
          contentEditable
          suppressContentEditableWarning
          spellCheck
          onInput={() => changed(true)}
          onMouseUp={remember}
          onKeyUp={remember}
          onFocus={remember}
          onPaste={(e) => {
            const cd = e.clipboardData;
            const pasted = files(cd?.files);
            if (pasted.length) {
              e.preventDefault();
              if (onFiles) onFiles(pasted);
              else onFilesRefused?.();
              return;
            }
            e.preventDefault();
            const html = cd?.getData('text/html') ?? '';
            document.execCommand('insertHTML', false, html ? clean(html) : plainToHtml(cd?.getData('text/plain') ?? ''));
            changed();
          }}
          onDragOver={(e) => {
            if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
          }}
          onDrop={(e) => {
            const dropped = files(e.dataTransfer?.files);
            if (!dropped.length) return;
            e.preventDefault();
            if (onFiles) onFiles(dropped);
            else onFilesRefused?.();
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Escape' && panel) {
              e.preventDefault();
              setPanel(null);
              return;
            }
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && (active.marks.has('bullets') || active.marks.has('numbers'))) {
              e.preventDefault();
              run(e.shiftKey ? 'outdent' : 'indent');
              return;
            }
            if (markdownShortcuts && e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey && shortcut()) {
              e.preventDefault();
              return;
            }
            if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
            const key = e.key.toLowerCase();
            const code = e.code;
            const id: ToolId | null =
              key === 'z' ? (e.shiftKey ? 'redo' : 'undo')
              : key === 'y' ? 'redo'
              : key === 'k' ? 'link'
              : key === 'b' && !e.shiftKey ? 'bold'
              : key === 'i' && !e.shiftKey ? 'italic'
              : key === 'u' && !e.shiftKey ? 'underline'
              : key === 'x' && e.shiftKey ? 'strike'
              : key === '\\' ? 'clear'
              : e.shiftKey && (code === 'Digit8' || key === '*' || key === '8') ? 'bullets'
              : e.shiftKey && (code === 'Digit7' || key === '&' || key === '7') ? 'numbers'
              : e.shiftKey && (code === 'Digit9' || key === '(' || key === '9') ? 'quote'
              : null;
            // Undo, redo and the formatting keys only for the tools this editor has; the rest pass through.
            if (!id || (!show(id) && id !== 'undo' && id !== 'redo')) return;
            e.preventDefault();
            run(id);
          }}
          className={cx('bare-focus outline-none', RICH_CONTENT_CLASS, /(^|\s)p[xy]?-/.test(boxClassName ?? '') ? '' : 'px-4 py-3', /(^|\s)text-\[/.test(boxClassName ?? '') ? '' : 'text-[14px]', fill && 'flex-1', boxClassName)}
          style={{ minHeight, maxHeight: fill ? undefined : maxHeight }}
        />
      </div>
      {footer}
    </div>
  );
}
