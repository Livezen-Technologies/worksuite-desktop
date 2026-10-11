import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { apiUrl } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { toast } from '../../../core/toasts';
import { DriveFilePicker, type DriveFileRow } from '../../../components/DriveFilePicker';
import type { MenuSection } from '../../../components/Menu';
import { HIGHLIGHTS, RICH_CONTENT_CLASS, TEXT_COLOURS, normalizeLink } from '../../../components/RichTextEditor';
import { cx } from '../../../components/ui';
import { insertRow, nextCell, setColumnWidth, gridOf, placeOf, setStyle, tableHtml } from './emailHtml';
import { ImageTools } from './ImageTools';
import { cropImage, dataUrlToFile, imageHtml, prepareImage, sizeImage } from './images';
import { CHECK_OFF, CHECK_ON, FONTS, HR_HTML, LINE_SPACINGS, MERGE_FIELDS, SIZES, buttonHtml, codeBlockHtml, dateTimeHtml, inlineCodeHtml, mergeFieldHtml } from './insert';
import { ButtonDialog, CropDialog, EmojiPanel, FieldStrip, InsertTableDialog, SpecialCharsPanel, Strip, TableGrid } from './panels';
import { pastedHtml, type PasteMode } from './paste';
import { TableTools } from './TableTools';
import { ToolbarRow, type ToolGroup, type ToolRequest } from './Toolbar';

/**
 * The Mail composer's editor (worksuite-desktop#188): contentEditable and
 * the browser's editing commands, as before — the approach is kept; nothing
 * in the issue needs a document model — with one row of grouped tools,
 * pictures inside the message, tables that can be changed after they go
 * in, more to insert, paste options and the shortcuts people expect.
 *
 * `value` is HTML and leaves through `clean` (the composer's allow-list);
 * a `value` that comes back unchanged is never written over the caret, a
 * different one (a restored draft, an AI rewrite, a template) replaces the
 * content and can be undone.
 */

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
const MOD = mac ? '⌘' : 'Ctrl+';
const ALT = mac ? '⌥' : 'Alt+';
const SENTINEL = '#010203';
const LEAF = 'p, div, h1, h2, h3, h4, li, pre, blockquote, td, th';
const BLOCKS = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'PRE', 'LI', 'TD', 'TH'];

/** The paragraph styles. */
const STYLES = (): Array<[string, string]> => [
  ['div', text('Normal text')],
  ['h1', text('Heading 1')],
  ['h2', text('Heading 2')],
  ['h3', text('Heading 3')],
  ['blockquote', text('Quote')],
  ['pre', text('Code')],
];

type Align = 'left' | 'center' | 'right' | 'justify';

interface Here {
  marks: Set<string>;
  block: string;
  align: Align;
  font: string;
  size: string;
  spacing: string;
  colour: string;
  background: string;
  link: HTMLAnchorElement | null;
  cell: HTMLTableCellElement | null;
  checklist: boolean;
}

const NOWHERE: Here = { marks: new Set(), block: 'div', align: 'left', font: '', size: '', spacing: '', colour: '', background: '', link: null, cell: null, checklist: false };

const isChecklist = (ul: Element | null) => !!ul && ul.tagName === 'UL' && /none/.test((ul as HTMLElement).style.listStyleType) && [...ul.children].some((li) => /^[☐☑]/.test((li.textContent ?? '').trim()));

/** What the caret sits in. */
function hereIn(box: HTMLElement | null): Here {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  const node = sel?.anchorNode ?? null;
  if (!box || !node || !box.contains(node)) return NOWHERE;
  const h: Here = { ...NOWHERE, marks: new Set(), block: '' };
  let aligned = false;
  for (let el: Element | null = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement; el && el !== box; el = el.parentElement) {
    const tag = el.tagName;
    const st = (el as HTMLElement).style;
    if (tag === 'B' || tag === 'STRONG' || /^(bold|[6-9]00)$/.test(st?.fontWeight ?? '')) h.marks.add('bold');
    if (tag === 'I' || tag === 'EM' || st?.fontStyle === 'italic') h.marks.add('italic');
    if (tag === 'U' || /underline/.test(st?.textDecoration ?? '')) h.marks.add('underline');
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || /line-through/.test(st?.textDecoration ?? '')) h.marks.add('strike');
    if (tag === 'UL') h.marks.add(isChecklist(el) ? 'checklist' : 'bullets');
    if (tag === 'OL') h.marks.add('numbers');
    if (tag === 'A' && !h.link) h.link = el as HTMLAnchorElement;
    if ((tag === 'TD' || tag === 'TH') && !h.cell) h.cell = el as HTMLTableCellElement;
    if (!h.font && st?.fontFamily) h.font = st.fontFamily;
    if (!h.font && tag === 'FONT' && el.getAttribute('face') && !/^ws\|/.test(el.getAttribute('face')!)) h.font = el.getAttribute('face')!;
    if (!h.size && st?.fontSize) h.size = st.fontSize;
    if (!h.colour && st?.color) h.colour = st.color;
    if (!h.background && st?.backgroundColor) h.background = st.backgroundColor;
    if (BLOCKS.includes(tag)) {
      if (!h.spacing && st?.lineHeight) h.spacing = st.lineHeight;
      const a = (st?.textAlign || el.getAttribute('align') || '') as Align | 'start' | '';
      if (a && !aligned) {
        h.align = a === 'start' ? 'left' : (a as Align);
        aligned = true;
      }
      if (!h.block && tag !== 'LI' && tag !== 'TD' && tag !== 'TH') h.block = tag.toLowerCase() === 'p' ? 'div' : tag.toLowerCase();
    }
  }
  h.checklist = h.marks.has('checklist');
  if (typeof document.queryCommandState === 'function') {
    for (const [id, cmd] of [['bold', 'bold'], ['italic', 'italic'], ['underline', 'underline'], ['strike', 'strikeThrough']] as const) {
      try {
        if (document.queryCommandState(cmd)) h.marks.add(id);
      } catch {
        /* not supported here */
      }
    }
  }
  h.block ||= 'div';
  return h;
}

/** Characters before a point, counted from the start of `root` (for putting the caret back after a re-paste). */
function offsetOf(root: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange();
  r.selectNodeContents(root);
  r.setEnd(node, offset);
  return r.toString().length;
}

function pointAt(root: HTMLElement, n: number): [Node, number] {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let left = n;
  let last: Text | null = null;
  for (let t = walk.nextNode() as Text | null; t; t = walk.nextNode() as Text | null) {
    if (left <= t.data.length) return [t, left];
    left -= t.data.length;
    last = t;
  }
  return last ? [last, last.data.length] : [root, root.childNodes.length];
}

/** `<font face="ws|prop|value">` — how a font or size is put on with the browser's command — as a styled span. */
export function settleFonts(box: HTMLElement): void {
  box.querySelectorAll<HTMLElement>('font[face^="ws|"]').forEach((f) => {
    const [, prop = '', value = ''] = (f.getAttribute('face') ?? '').split('|');
    f.querySelectorAll<HTMLElement>('[style]').forEach((inner) => setStyle(inner, { [prop]: null }));
    if (!value) {
      f.replaceWith(...f.childNodes);
      return;
    }
    const span = f.ownerDocument.createElement('span');
    span.style.setProperty(prop, value);
    while (f.firstChild) span.appendChild(f.firstChild);
    f.replaceWith(span);
  });
}

/** Where a picture is, in the editor's frame (for its outline and corner handle). */
function frameOf(img: HTMLImageElement): { left: number; top: number; width: number; height: number } | null {
  const frame = img.closest('[data-editor-frame]');
  if (!frame) return null;
  const a = img.getBoundingClientRect();
  const b = frame.getBoundingClientRect();
  return { left: a.left - b.left, top: a.top - b.top, width: a.width, height: a.height };
}

export interface MailEditorProps {
  value: string;
  onChange: (html: string) => void;
  onBusyChange?: (busy: boolean) => void;
  clean: (html: string) => string;
  label: string;
  placeholder?: string;
  editorRef?: React.MutableRefObject<HTMLDivElement | null>;
  autoFocus?: boolean;
  /** Files that are not pictures, dropped or pasted: attachments. */
  onFiles?: (files: File[]) => void;
  /** The AI tools, for the ✨ button and Mod+J. */
  aiSections?: MenuSection[];
  /** Mail merge fields in the Insert menu. */
  mergeFields?: boolean;
  /** Makes a WorkSuite Meet link and gives back the HTML to insert. */
  onMeetingLink?: () => Promise<string | null>;
  /** A picture to send as an attachment instead. */
  onAttachInstead?: (file: File) => void;
  offline?: boolean;
  minHeight?: number;
  className?: string;
  /** Below the text. */
  footer?: ReactNode;
  /**
   * `signature`: the smaller toolbar a signature needs (worksuite-desktop#166) —
   * font, size, bold, italic, underline, colour, clear; alignment and line
   * spacing; links (tel: too), pictures, tables and dividers.
   */
  variant?: 'compose' | 'signature' | 'support';
  /** How big a picture may be once made smaller (a signature's: about 500 KB). */
  imageMaxBytes?: number;
  /** More tool groups after the editor's own. */
  extraGroups?: ToolGroup[];
  /** Tool groups before the editor's own (the composer's actions, in one row on a wide screen). */
  leadingGroups?: () => ToolGroup[];
  /**
   * The editor takes all the height it is given (worksuite-desktop#213): the
   * toolbar stays put and the text scrolls inside, with `below` (the quoted
   * email) scrolling with it. Drawn flat, without the card's border.
   */
  fill?: boolean;
  below?: ReactNode;
  /** Puts HTML in at the caret (or at the end), for tools outside the editor. */
  insertRef?: React.MutableRefObject<((html: string) => void) | null>;
}

/** The tools a signature keeps. */
const SUPPORT_TOOLS = new Set(['bold', 'italic', 'underline', 'strike', 'bullets', 'numbers', 'checklist', 'link', 'image', 'ai']);
const SIGNATURE_TOOLS = new Set(['undo', 'redo', 'font', 'size', 'bold', 'italic', 'underline', 'colour', 'clear', 'align', 'spacing', 'link', 'image', 'table', 'divider']);

type Panel = 'link' | 'colour' | 'highlight' | 'table' | 'emoji' | 'chars' | 'image-url' | null;
type Dialog = 'table' | 'button' | 'crop' | 'drive' | null;

export function MailEditor({ value, onChange, onBusyChange, clean, label, placeholder, editorRef, autoFocus, onFiles, aiSections, mergeFields, onMeetingLink, onAttachInstead, offline, minHeight = 260, className, footer, variant = 'compose', imageMaxBytes, extraGroups, leadingGroups, fill, below, insertRef }: MailEditorProps) {
  const signature = variant === 'signature';
  const box = useRef<HTMLDivElement | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const last = useRef<string | null>(null);
  const history = useRef<string[]>([]);
  const cursor = useRef(-1);
  const typedAt = useRef(0);
  const range = useRef<Range | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [empty, setEmpty] = useState(!value);
  const [here, setHere] = useState<Here>(NOWHERE);
  const [panel, setPanel] = useState<Panel>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [linkError, setLinkError] = useState('');
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [, setTick] = useState(0);
  const [request, setRequest] = useState<ToolRequest | null>(null);
  const [painter, setPainter] = useState<Here | null>(null);
  const [pasted, setPasted] = useState<{ before: string; start: number; end: number; data: { html: string; text: string }; mode: PasteMode } | null>(null);
  const [busy, setBusy] = useState(0);
  useEffect(() => { onBusyChange?.(busy > 0); }, [busy, onBusyChange]);
  const rerender = () => setTick((n) => n + 1);

  const isEmpty = (el: HTMLElement) => !(el.textContent ?? '').trim() && !el.querySelector('li, img, hr, blockquote, table');

  const record = (html: string, typing: boolean) => {
    const now = Date.now();
    if (html === history.current[cursor.current]) return;
    const coalesce = typing && now - typedAt.current < 1000 && cursor.current > 0;
    history.current = [...history.current.slice(0, cursor.current + (coalesce ? 0 : 1)), html].slice(-200);
    cursor.current = history.current.length - 1;
    typedAt.current = typing ? now : 0;
  };

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || value === last.current) return;
    el.innerHTML = value;
    last.current = value;
    record(value, false);
    setEmpty(isEmpty(el));
    setImg(null);
  }, [value]);

  const remember = () => {
    const s = window.getSelection();
    if (s?.rangeCount && box.current?.contains(s.anchorNode)) range.current = s.getRangeAt(0).cloneRange();
    setHere(hereIn(box.current));
  };

  useEffect(() => {
    if (autoFocus) box.current?.focus();
    const onSelection = () => {
      const s = window.getSelection();
      if (s?.rangeCount && box.current?.contains(s.anchorNode)) {
        range.current = s.getRangeAt(0).cloneRange();
        setHere(hereIn(box.current));
      }
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    settleFonts(el);
    const html = clean(el.innerHTML);
    record(html, typing);
    last.current = html;
    setEmpty(isEmpty(el));
    onChange(html);
    remember();
    if (img && !el.contains(img)) setImg(null);
  };

  const caretTo = (node: Node, atStart = true) => {
    const r = document.createRange();
    r.selectNodeContents(node);
    r.collapse(atStart);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
    range.current = r.cloneRange();
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
    setImg(null);
    onChange(html);
    box.current.focus();
    caretTo(box.current, false);
  };

  const selection = (): Range | null => {
    const s = window.getSelection();
    return s?.rangeCount && box.current?.contains(s.anchorNode) ? s.getRangeAt(0) : null;
  };

  const exec = (cmd: string, arg?: string) => {
    restore();
    document.execCommand(cmd, false, arg);
    changed();
  };

  const insert = (html: string) => {
    restore();
    if (!selection() && box.current) caretTo(box.current, false);
    document.execCommand('insertHTML', false, html);
    changed();
  };

  useEffect(() => {
    if (insertRef) insertRef.current = insert;
  });

  /** A font family or size on the selection (or on what is typed next). */
  const inline = (prop: 'font-family' | 'font-size', v: string) => {
    restore();
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand('fontName', false, `ws|${prop}|${v}`);
    changed();
  };

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
        const v = el.style.getPropertyValue(prop).replace(/\s/g, '').toLowerCase();
        if (v === 'rgb(1,2,3)' || v === SENTINEL) el.style.removeProperty(prop);
        if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
        if ((el.tagName === 'SPAN' || el.tagName === 'FONT') && !el.attributes.length) el.replaceWith(...el.childNodes);
      });
    }
    setPanel(null);
    changed();
  };

  /** The paragraphs the selection touches (making one when the text is loose). */
  const leafBlocks = (): HTMLElement[] => {
    const r = selection();
    if (!r || !box.current) return [];
    const all = [...box.current.querySelectorAll<HTMLElement>(LEAF)].filter((el) => r.intersectsNode(el) && !el.querySelector(LEAF));
    if (all.length) return all;
    document.execCommand('formatBlock', false, 'div');
    const again = selection();
    return again ? [...box.current.querySelectorAll<HTMLElement>(LEAF)].filter((el) => again.intersectsNode(el) && !el.querySelector(LEAF)) : [];
  };

  const lineSpacing = (v: string) => {
    restore();
    for (const b of leafBlocks()) setStyle(b, { 'line-height': v });
    changed();
  };

  const align = (a: Align) => exec(a === 'left' ? 'justifyLeft' : a === 'center' ? 'justifyCenter' : a === 'right' ? 'justifyRight' : 'justifyFull');

  const checklist = () => {
    restore();
    const li = (selection()?.startContainer.parentElement ?? null)?.closest('li');
    const ul = li?.closest('ul') ?? null;
    if (ul && isChecklist(ul)) {
      for (const item of [...ul.children]) {
        const t = item.firstChild;
        if (t?.nodeType === Node.TEXT_NODE) t.textContent = (t.textContent ?? '').replace(/^[☐☑]\s?/, '');
      }
      ul.removeAttribute('style');
      document.execCommand('insertUnorderedList');
    } else {
      if (!ul) document.execCommand('insertUnorderedList');
      const list = (selection()?.startContainer.parentElement ?? null)?.closest('ul') ?? box.current?.querySelector('ul:last-of-type') ?? null;
      if (list) {
        list.setAttribute('style', 'list-style-type: none; padding-left: 4px; margin-left: 0');
        for (const item of [...list.children]) if (!/^[☐☑]/.test((item.textContent ?? '').trim())) item.insertBefore(document.createTextNode(`${CHECK_OFF} `), item.firstChild);
      }
    }
    changed();
  };

  const clearFormatting = () => {
    restore();
    const r = selection();
    if (r && r.collapsed) {
      const block = r.startContainer.parentElement?.closest(LEAF);
      if (block && box.current?.contains(block)) {
        const all = document.createRange();
        all.selectNodeContents(block);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(all);
      }
    }
    document.execCommand('removeFormat');
    document.execCommand('unlink');
    document.execCommand('formatBlock', false, 'div');
    changed();
  };

  /** The format painter: what is on here goes onto the next selection. */
  const paint = (from: Here) => {
    for (const [id, cmd] of [['bold', 'bold'], ['italic', 'italic'], ['underline', 'underline'], ['strike', 'strikeThrough']] as const) {
      let on = false;
      try {
        on = document.queryCommandState(cmd);
      } catch {
        /* not supported here */
      }
      if (on !== from.marks.has(id)) document.execCommand(cmd);
    }
    if (from.colour) {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('foreColor', false, from.colour);
      document.execCommand('styleWithCSS', false, 'false');
    }
    document.execCommand('fontName', false, `ws|font-family|${from.font}`);
    settleFonts(box.current!);
    document.execCommand('fontName', false, `ws|font-size|${from.size}`);
    changed();
  };

  const openLink = () => {
    remember();
    setLinkError('');
    setPanel(panel === 'link' ? null : 'link');
  };

  const applyLink = (input: string) => {
    const url = normalizeLink(input, signature);
    if (!url) return setLinkError(signature ? text('Use an https, http, mailto or tel address.') : text('Use an https, http or mailto address (for example https://example.com).'));
    restore();
    const existing = hereIn(box.current).link;
    if (existing) existing.setAttribute('href', url);
    else {
      const r = selection();
      if (!r || r.collapsed) document.execCommand('insertHTML', false, `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/^mailto:/i, '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</a>`);
      else document.execCommand('createLink', false, url);
    }
    setPanel(null);
    changed();
  };

  const removeLink = () => {
    restore();
    const a = hereIn(box.current).link;
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

  /** Pictures go inside the message, made small enough first; anything unreadable becomes an attachment. */
  const insertImages = async (files: File[]) => {
    const rest: File[] = [];
    setBusy((b) => b + 1);
    try {
      for (const f of files) {
        try {
          const p = await prepareImage(f, imageMaxBytes);
          insert(imageHtml({ src: p.src, alt: f.name.replace(/\.[a-z0-9]+$/i, ''), width: p.width }));
          if (p.shrunk) toast('info', text('“{name}” was made smaller to send ({size} KB).', { name: f.name, size: Math.round(p.bytes / 1024) }));
        } catch {
          rest.push(f);
        }
      }
    } finally {
      setBusy((b) => b - 1);
    }
    if (rest.length) {
      if (onFiles) {
        toast('info', text('That picture could not go inside the message, so it is attached instead.'));
        onFiles(rest);
      } else toast('error', text('That picture could not be added.'));
    }
  };

  const filesIn = (files: File[]) => {
    const pics = files.filter((f) => (/^image\/(png|jpeg|gif|webp|bmp|heic|heif|svg\+xml)$/i.test(f.type) || /\.(heic|heif)$/i.test(f.name)));
    const others = files.filter((f) => !pics.includes(f));
    if (pics.length) void insertImages(pics);
    if (others.length) onFiles?.(others);
  };

  const fromDrive = async (files: DriveFileRow[]) => {
    setDialog(null);
    for (const f of files) {
      try {
        const res = await fetch(apiUrl(`/api/files/${f.id}/download`));
        if (!res.ok) throw new Error(text('The file could not be read ({status}).', { status: res.status }));
        const blob = await res.blob();
        await insertImages([new File([blob], f.name, { type: blob.type || 'image/png' })]);
      } catch (e) {
        toast('error', text('“{name}” was not added: {reason}', { name: f.name, reason: errorMessage(e) }));
      }
    }
  };

  const fromUrl = (input: string) => {
    const url = normalizeLink(input);
    if (!url || !/^https:\/\//i.test(url)) return setLinkError(text('Use an https address of a picture.'));
    setPanel(null);
    insert(imageHtml({ src: url, alt: '' }));
  };

  const doPaste = (data: { html: string; text: string }, mode: PasteMode) => {
    document.execCommand('insertHTML', false, pastedHtml(data, mode, clean));
    changed();
  };

  const repaste = (mode: PasteMode) => {
    if (!pasted || !box.current) return;
    box.current.innerHTML = pasted.before;
    box.current.focus();
    const [sn, so] = pointAt(box.current, pasted.start);
    const [en, eo] = pointAt(box.current, pasted.end);
    const r = document.createRange();
    r.setStart(sn, so);
    r.setEnd(en, eo);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
    doPaste(pasted.data, mode);
    setPasted({ ...pasted, mode });
  };

  // The selected picture's corner handle follows the window's size.
  useEffect(() => {
    if (!img) return;
    const again = () => setTick((n) => n + 1);
    window.addEventListener('resize', again);
    return () => window.removeEventListener('resize', again);
  }, [img]);

  const resizeFrom = (e: React.PointerEvent) => {
    if (!img) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = img.getBoundingClientRect().width || Number(img.getAttribute('width')) || 300;
    const move = (ev: PointerEvent) => {
      sizeImage(img, Math.max(24, startW + ev.clientX - startX));
      rerender();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      changed();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Dragging a table cell's right edge sets its column's width.
  const columnDrag = useRef<{ table: HTMLTableElement; col: number; x: number; w: number } | null>(null);
  const edgeCell = (e: React.MouseEvent): HTMLTableCellElement | null => {
    const cell = (e.target as Element).closest?.('td, th') as HTMLTableCellElement | null;
    if (!cell || !box.current?.contains(cell)) return null;
    const r = cell.getBoundingClientRect();
    return r.width && e.clientX >= r.right - 5 && e.clientX <= r.right + 2 ? cell : null;
  };

  const tableCmd = (caret?: HTMLTableCellElement | null) => {
    if (caret?.isConnected) caretTo(caret);
    changed();
  };

  const aiAvailable = !!aiSections?.some((s) => s.items.length);
  const blockLabel = STYLES().find(([v]) => v === here.block)?.[1] ?? text('Normal text');
  const fontName = FONTS.find(([v]) => v && here.font && here.font.replace(/["']/g, '').toLowerCase().startsWith(v.split(',')[0]!.toLowerCase()))?.[1] ?? text('Default');
  const sizeName = SIZES.find(([v]) => v && v === here.size)?.[1] ?? text('Normal');
  const alignIcon = here.align === 'center' ? 'align-center' : here.align === 'right' ? 'align-right' : here.align === 'justify' ? 'align-justify' : 'align-left';

  const insertMenu = (): MenuSection[] => [
    {
      id: 'blocks',
      items: [
        { id: 'hr', label: text('Horizontal line'), icon: 'separator', onSelect: () => insert(HR_HTML) },
        { id: 'quote', label: text('Quote block'), icon: 'quote', shortcut: `${MOD}Shift+9`, onSelect: () => exec('formatBlock', 'blockquote') },
        { id: 'code-block', label: text('Code block'), icon: 'square-code', onSelect: () => insert(codeBlockHtml(selection()?.toString() ?? '')) },
        { id: 'code', label: text('Inline code'), icon: 'code', onSelect: () => insert(inlineCodeHtml(selection()?.toString() ?? '')) },
        { id: 'button', label: text('Button'), icon: 'square', description: text('A link styled as a button'), onSelect: () => (remember(), setDialog('button')) },
      ],
    },
    {
      id: 'more',
      items: [
        {
          id: 'date',
          label: text('Date and time'),
          icon: 'calendar',
          submenu: [
            {
              id: 'date',
              items: [
                { id: 'd-date', label: dateTimeHtml(new Date(), 'date'), onSelect: () => insert(dateTimeHtml(new Date(), 'date')) },
                { id: 'd-time', label: dateTimeHtml(new Date(), 'time'), onSelect: () => insert(dateTimeHtml(new Date(), 'time')) },
                { id: 'd-both', label: dateTimeHtml(new Date(), 'both'), onSelect: () => insert(dateTimeHtml(new Date(), 'both')) },
              ],
            },
          ],
        },
        { id: 'chars', label: text('Special character'), icon: 'omega', onSelect: () => (remember(), setPanel('chars')) },
        ...(onMeetingLink
          ? [
              {
                id: 'meet',
                label: text('Meeting link'),
                icon: 'video',
                description: text('A WorkSuite Meet link'),
                disabled: offline,
                reason: text('Making a meeting needs WorkSuite.'),
                onSelect: () => {
                  remember();
                  void onMeetingLink().then((html) => html && insert(html), (e) => toast('error', errorMessage(e)));
                },
              },
            ]
          : []),
        ...(mergeFields
          ? [
              {
                id: 'merge',
                label: text('Mail merge field'),
                icon: 'users',
                submenu: [{ id: 'fields', label: text('Filled in for each person by Mail merge'), items: MERGE_FIELDS.map((f) => ({ id: `f-${f}`, label: `{{${f}}}`, onSelect: () => insert(mergeFieldHtml(f)) })) }],
              },
            ]
          : []),
      ],
    },
  ];

  const allGroups: ToolGroup[] = [
    {
      id: 'history',
      label: text('History'),
      items: [
        { id: 'undo', label: text('Undo'), icon: 'undo-edit', keys: `${MOD}Z`, run: () => travel(-1) },
        { id: 'redo', label: text('Redo'), icon: 'redo-edit', keys: mac ? '⌘Shift+Z' : 'Ctrl+Y', run: () => travel(1) },
      ],
    },
    {
      id: 'text',
      label: text('Text'),
      items: [
        { id: 'style', label: text('Paragraph style'), icon: 'pilcrow', caption: blockLabel, menu: () => [{ id: 'styles', items: STYLES().map(([v, l]) => ({ id: `st-${v}`, label: l, radio: true, checked: here.block === v, onSelect: () => exec('formatBlock', v) })) }] },
        { id: 'font', label: text('Font'), icon: 'type', caption: fontName, menu: () => [{ id: 'fonts', items: FONTS.map(([v, l]) => ({ id: `font-${l}`, label: text(l), radio: true, checked: fontName === l, onSelect: () => inline('font-family', v) })) }] },
        { id: 'size', label: text('Size'), icon: 'text-size', caption: sizeName, menu: () => [{ id: 'sizes', items: SIZES.map(([v, l]) => ({ id: `size-${l}`, label: text(l), radio: true, checked: sizeName === l, onSelect: () => inline('font-size', v) })) }] },
      ],
    },
    {
      id: 'format',
      label: text('Format'),
      items: [
        { id: 'bold', label: text('Bold'), icon: 'bold', keys: `${MOD}B`, active: here.marks.has('bold'), run: () => exec('bold') },
        { id: 'italic', label: text('Italic'), icon: 'italic', keys: `${MOD}I`, active: here.marks.has('italic'), run: () => exec('italic') },
        { id: 'underline', label: text('Underline'), icon: 'underline', keys: `${MOD}U`, active: here.marks.has('underline'), run: () => exec('underline') },
        { id: 'strike', label: text('Strikethrough'), icon: 'strikethrough', keys: `${MOD}Shift+X`, active: here.marks.has('strike'), run: () => exec('strikeThrough') },
        { id: 'colour', label: text('Text colour'), icon: 'text-colour', expanded: panel === 'colour', run: () => (remember(), setPanel(panel === 'colour' ? null : 'colour')) },
        { id: 'highlight', label: text('Highlight'), icon: 'highlighter', expanded: panel === 'highlight', run: () => (remember(), setPanel(panel === 'highlight' ? null : 'highlight')) },
        { id: 'clear', label: text('Clear formatting'), icon: 'clear-format', keys: `${MOD}\\`, run: clearFormatting },
        { id: 'painter', label: text('Format painter'), icon: 'paintbrush', active: !!painter, run: () => (painter ? setPainter(null) : (remember(), setPainter(hereIn(box.current)))) },
      ],
    },
    {
      id: 'paragraph',
      label: text('Paragraph'),
      items: [
        {
          id: 'align',
          label: text('Align'),
          icon: alignIcon,
          menu: () => [
            {
              id: 'align',
              items: (
                [
                  ['left', text('Align left'), 'align-left'],
                  ['center', text('Centre'), 'align-center'],
                  ['right', text('Align right'), 'align-right'],
                  ['justify', text('Justify'), 'align-justify'],
                ] as const
              ).map(([a, l, icon]) => ({ id: `al-${a}`, label: l, icon, radio: true, checked: here.align === a, onSelect: () => align(a) })),
            },
          ],
        },
        { id: 'bullets', label: text('Bulleted list'), icon: 'list', keys: `${MOD}Shift+8`, active: here.marks.has('bullets'), run: () => exec('insertUnorderedList') },
        { id: 'numbers', label: text('Numbered list'), icon: 'list-ordered', keys: `${MOD}Shift+7`, active: here.marks.has('numbers'), run: () => exec('insertOrderedList') },
        { id: 'checklist', label: text('Checklist'), icon: 'list-checks', active: here.checklist, run: checklist },
        { id: 'outdent', label: text('Decrease indent'), icon: 'outdent', keys: 'Shift+Tab', run: () => exec('outdent') },
        { id: 'indent', label: text('Increase indent'), icon: 'indent', keys: 'Tab', run: () => exec('indent') },
        { id: 'spacing', label: text('Line spacing'), icon: 'line-spacing', menu: () => [{ id: 'sp', items: LINE_SPACINGS.map((v) => ({ id: `sp-${v}`, label: v, radio: true, checked: (here.spacing || '1.5') === v, onSelect: () => lineSpacing(v) })) }] },
      ],
    },
    {
      id: 'insert',
      label: text('Insert'),
      items: [
        { id: 'link', label: text('Link'), icon: 'link', keys: `${MOD}K`, active: !!here.link, expanded: panel === 'link', run: openLink },
        {
          id: 'image',
          label: text('Image'),
          icon: 'image',
          keys: `${MOD}Shift+I`,
          menu: () => [
            {
              id: 'image',
              items: [
                { id: 'img-upload', label: text('Upload from computer'), icon: 'upload', onSelect: () => (remember(), imageInput.current?.click()) },
                { id: 'img-drive', label: text('From WorkSuite Files'), icon: 'folder', disabled: offline, reason: text('Files needs WorkSuite.'), onSelect: () => (remember(), setDialog('drive')) },
                { id: 'img-url', label: text('From an address (URL)'), icon: 'globe', onSelect: () => (remember(), setLinkError(''), setPanel('image-url')) },
              ],
            },
            { id: 'image-hint', items: [{ id: 'img-paste', label: text('Or paste or drop a picture into the message'), icon: 'clipboard-paste', disabled: true, reason: text('Pictures go inside the message, made smaller when they are big.') }] },
          ],
        },
        { id: 'table', label: text('Table'), icon: 'table', keys: `${MOD}${ALT}T`, expanded: panel === 'table', run: () => (remember(), setPanel(panel === 'table' ? null : 'table')) },
        { id: 'divider', label: text('Divider'), icon: 'separator', run: () => insert(HR_HTML) },
        { id: 'emoji', label: text('Emoji'), icon: 'smile', expanded: panel === 'emoji', run: () => (remember(), setPanel(panel === 'emoji' ? null : 'emoji')) },
        { id: 'insert-more', label: text('More to insert'), icon: 'plus', menu: insertMenu },
      ],
    },
    ...(aiSections
      ? [
          {
            id: 'ai',
            label: text('AI'),
            items: [{ id: 'ai', label: text('Write with AI'), icon: 'sparkles', caption: text('AI'), accent: true, keys: `${MOD}J`, disabled: !aiAvailable, reason: text('AI is not available.'), menu: () => aiSections }],
          },
        ]
      : []),
  ];

  const leading = leadingGroups?.() ?? [];
  const groups: ToolGroup[] = [...leading, ...allGroups, ...(extraGroups ?? [])];
  const extraIds = new Set([...(extraGroups ?? []), ...leading].flatMap((g) => g.items.map((i) => i.id)));
  const keepTool = (id: string) => (variant === 'support' ? SUPPORT_TOOLS.has(id) || extraIds.has(id) : signature ? SIGNATURE_TOOLS.has(id) || extraIds.has(id) : id !== 'divider');

  /** The keys (worksuite-desktop#188); they stop here so the app's own (Mod+K is Search) do not also run. */
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    const done = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (pasted) setPasted(null);
    if (e.key === 'Escape' && (panel || painter)) {
      done();
      setPanel(null);
      setPainter(null);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && img && box.current?.contains(img)) {
      done();
      (img.parentElement?.tagName === 'A' ? img.parentElement : img).remove();
      setImg(null);
      changed();
      return;
    }
    if (e.key === 'Tab' && !mod && !e.altKey) {
      if (here.cell && box.current?.contains(here.cell)) {
        done();
        let next = nextCell(here.cell, e.shiftKey);
        if (!next && !e.shiftKey) {
          const tr = insertRow(here.cell, 'below');
          next = tr.cells[0] ?? null;
        }
        if (next) caretTo(next);
        changed();
        return;
      }
      if (here.marks.has('bullets') || here.marks.has('numbers') || here.checklist) {
        done();
        exec(e.shiftKey ? 'outdent' : 'indent');
        return;
      }
    }
    if (e.key === ' ' && !mod && !e.altKey && shortcut()) return done();
    if (e.key === '*' && !mod && boldShortcut()) return done();
    if (variant === 'support' && e.key === '`' && !mod && codeShortcut()) return done();
    if (e.key === 'Enter' && !mod && here.checklist && checkNewLine()) return done();
    if (!mod) return;
    const key = e.key.toLowerCase();
    const code = e.code;
    if (e.altKey) {
      if (code === 'KeyT') {
        done();
        remember();
        setPanel(panel === 'table' ? null : 'table');
      }
      return;
    }
    const act = (fn: () => void) => {
      done();
      fn();
    };
    if (key === 'z') return act(() => travel(e.shiftKey ? 1 : -1));
    if (key === 'y') return act(() => travel(1));
    if (key === 'k' && !e.shiftKey) return act(openLink);
    if (key === 'j' && !e.shiftKey) return act(() => (remember(), setRequest({ id: 'ai', n: Date.now() })));
    if (key === 'b' && !e.shiftKey) return act(() => exec('bold'));
    if (key === 'i' && e.shiftKey) return act(() => (remember(), setRequest({ id: 'image', n: Date.now() })));
    if (key === 'i') return act(() => exec('italic'));
    if (key === 'u' && !e.shiftKey) return act(() => exec('underline'));
    if (key === 'x' && e.shiftKey) return act(() => exec('strikeThrough'));
    if (key === '\\') return act(clearFormatting);
    if (e.shiftKey && (code === 'Digit8' || key === '*' || key === '8')) return act(() => exec('insertUnorderedList'));
    if (e.shiftKey && (code === 'Digit7' || key === '&' || key === '7')) return act(() => exec('insertOrderedList'));
    if (e.shiftKey && (code === 'Digit9' || key === '(' || key === '9')) return act(() => exec('formatBlock', here.block === 'blockquote' ? 'div' : 'blockquote'));
  };

  /** Enter on a checklist line: the next line gets its own box. */
  const checkNewLine = (): boolean => {
    const li = selection()?.startContainer.parentElement?.closest('li');
    if (!li || !(li.textContent ?? '').replace(/^[☐☑]\s?/, '').trim()) return false;
    document.execCommand('insertParagraph');
    const now = selection()?.startContainer;
    const item = (now?.nodeType === Node.ELEMENT_NODE ? (now as Element) : now?.parentElement)?.closest('li');
    if (item && item !== li && !/^[☐☑]/.test((item.textContent ?? '').trim())) {
      item.innerHTML = `${CHECK_OFF}&nbsp;`;
      caretTo(item, false);
    }
    changed();
    return true;
  };

  /** "- ", "* ", "1. " or "> " typed at the start of a line. */
  const shortcut = (): boolean => {
    const s = window.getSelection();
    if (!s?.rangeCount || !s.isCollapsed || !box.current?.contains(s.anchorNode)) return false;
    const node = s.anchorNode!;
    const start = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const blockEl = start?.closest('div, p, h1, h2, h3, h4, li, blockquote, td, th') ?? null;
    const scope = blockEl && box.current.contains(blockEl) && blockEl !== box.current ? blockEl : box.current;
    if (scope.closest('li, blockquote, td, th') && scope !== box.current) return false;
    const before = document.createRange();
    before.setStart(scope, 0);
    before.setEnd(s.anchorNode!, s.anchorOffset);
    const typed = before.toString().split('\n').pop() ?? '';
    const cmd = typed === '-' || typed === '*' ? 'insertUnorderedList' : typed === '1.' ? 'insertOrderedList' : typed === '>' ? 'quote' : variant === 'support' && typed === '```' ? 'code' : null;
    if (!cmd || before.cloneContents().querySelector?.('br')) return false;
    s.removeAllRanges();
    s.addRange(before);
    document.execCommand('delete');
    if (cmd === 'quote') document.execCommand('formatBlock', false, 'blockquote');
    else if (cmd === 'code') document.execCommand('formatBlock', false, 'pre');
    else document.execCommand(cmd);
    changed();
    return true;
  };

  /** "**words*" and then "*": the words in bold. */
  const boldShortcut = (): boolean => {
    const s = window.getSelection();
    if (!s?.rangeCount || !s.isCollapsed || s.anchorNode?.nodeType !== Node.TEXT_NODE || !box.current?.contains(s.anchorNode)) return false;
    const t = s.anchorNode as Text;
    const m = /\*\*([^*\s][^*]*?)\*$/.exec(t.data.slice(0, s.anchorOffset));
    if (!m) return false;
    const r = document.createRange();
    r.setStart(t, s.anchorOffset - m[0].length);
    r.setEnd(t, s.anchorOffset);
    s.removeAllRanges();
    s.addRange(r);
    document.execCommand('insertHTML', false, `<b>${m[1]!.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</b>&nbsp;`);
    changed();
    return true;
  };

  const codeShortcut = (): boolean => {
    const s = window.getSelection();
    if (!s?.rangeCount || !s.isCollapsed || s.anchorNode?.nodeType !== Node.TEXT_NODE || !box.current?.contains(s.anchorNode)) return false;
    const t = s.anchorNode as Text;
    if (t.parentElement?.closest('code, pre')) return false;
    const m = /`([^`\n]+)$/.exec(t.data.slice(0, s.anchorOffset));
    if (!m) return false;
    const r = document.createRange();
    r.setStart(t, s.anchorOffset - m[0].length); r.setEnd(t, s.anchorOffset);
    s.removeAllRanges(); s.addRange(r);
    document.execCommand('insertHTML', false, inlineCodeHtml(m[1]!) + '&nbsp;');
    changed(); return true;
  };

  const fileList = (list: FileList | null | undefined): File[] => (list ? [...list] : []);
  const cellNow = here.cell?.isConnected ? here.cell : null;
  const picked = img?.isConnected ? img : null;
  const handle = picked ? frameOf(picked) : null;

  return (
    <div data-editor-fill={fill || undefined} className={cx(fill ? 'relative flex min-h-0 flex-1 flex-col bg-surface' : 'relative flex flex-col rounded-[10px] border border-line bg-surface transition-shadow focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25', className)}>
      <div className={cx('z-10 flex shrink-0 flex-col border-b border-line bg-surface', fill ? '' : 'sticky top-0 rounded-t-[10px]')}>
        <div className="flex min-w-0 items-center px-1.5 py-1">
          <ToolbarRow groups={groups} keep={keepTool} label={text('{label} formatting', { label })} size={variant === 'support' ? 'sm' : 'md'} request={request} className="min-w-0 flex-1" />
        </div>
        {panel === 'link' ? (
          <FieldStrip
            label={text('Link address')}
            icon="link"
            placeholder="https://"
            initial={here.link?.getAttribute('href') ?? ''}
            action={here.link ? text('Update link') : text('Add link')}
            error={linkError}
            onSubmit={applyLink}
            onClose={() => (setPanel(null), restore())}
            extra={
              here.link ? (
                <button type="button" onClick={removeLink} className="h-7 rounded-[6px] px-2 font-semibold text-ink-2 hover:bg-surface">
                  {text('Remove link')}
                </button>
              ) : null
            }
          />
        ) : null}
        {panel === 'image-url' ? <FieldStrip label={text('Picture address')} icon="image" placeholder="https://" action={text('Insert picture')} error={linkError} onSubmit={fromUrl} onClose={() => (setPanel(null), restore())} /> : null}
        {panel === 'colour' || panel === 'highlight' ? (
          <Strip label={panel === 'colour' ? text('Text colour') : text('Highlight')} onClose={() => (setPanel(null), restore())}>
            {(panel === 'colour' ? TEXT_COLOURS : HIGHLIGHTS).map((c) => (
              <button key={c} type="button" aria-label={text('{tool} {colour}', { tool: panel === 'colour' ? text('Text colour') : text('Highlight'), colour: c })} title={c} onMouseDown={(e) => e.preventDefault()} onClick={() => colour(panel, c)} className="h-6 w-6 rounded-full border border-line hover:scale-110" style={{ background: c }} />
            ))}
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => colour(panel, null)} className="h-6 rounded-[6px] px-2 text-[12px] font-semibold text-ink-2 hover:bg-surface">
              {panel === 'colour' ? text('Default colour') : text('No highlight')}
            </button>
          </Strip>
        ) : null}
        {panel === 'table' ? (
          <TableGrid
            onPick={(rows, cols) => {
              setPanel(null);
              insert(tableHtml({ rows, cols, header: false }));
            }}
            onMore={() => (setPanel(null), setDialog('table'))}
            onClose={() => (setPanel(null), restore())}
          />
        ) : null}
        {panel === 'emoji' ? <EmojiPanel onPick={(e) => insert(e)} onClose={() => (setPanel(null), restore())} /> : null}
        {panel === 'chars' ? <SpecialCharsPanel onPick={(c) => insert(c)} onClose={() => (setPanel(null), restore())} /> : null}
        {picked ? (
          <ImageTools
            img={picked}
            onChanged={() => (changed(), rerender())}
            onReplace={() => replaceInput.current?.click()}
            onCrop={() => setDialog('crop')}
            onAsAttachment={() => {
              const src = picked.getAttribute('src') ?? '';
              const name = picked.getAttribute('alt') || 'picture';
              (picked.parentElement?.tagName === 'A' ? picked.parentElement : picked).remove();
              setImg(null);
              changed();
              onAttachInstead?.(dataUrlToFile(src, name));
            }}
            onRemove={() => {
              (picked.parentElement?.tagName === 'A' ? picked.parentElement : picked).remove();
              setImg(null);
              changed();
            }}
          />
        ) : cellNow ? (
          <TableTools key={cellNow.closest('table')?.rows.length} cell={cellNow} onChanged={tableCmd} />
        ) : null}
        {pasted ? (
          <Strip label={text('Paste options')} onClose={() => setPasted(null)}>
            <span className="font-semibold text-ink-3">{text('Pasted:')}</span>
            {(
              [
                ['keep', text('Keep formatting')],
                ['plain', text('Plain text')],
                ['match', text('Match style')],
              ] as Array<[PasteMode, string]>
            ).map(([m, l]) => (
              <button key={m} type="button" aria-pressed={pasted.mode === m} onMouseDown={(e) => e.preventDefault()} onClick={() => repaste(m)} className={cx('h-7 rounded-[6px] px-2 font-semibold', pasted.mode === m ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-surface')}>
                {l}
              </button>
            ))}
            <button type="button" onClick={() => setPasted(null)} aria-label={text('Close paste options')} className="ml-auto h-7 rounded-[6px] px-2 text-ink-3 hover:bg-surface">
              ×
            </button>
          </Strip>
        ) : null}
        {painter ? (
          <div role="status" className="border-b border-line bg-selection px-3 py-1 text-[12px] text-primary">
            {text('Format painter: select the text to format. Esc to stop.')}
          </div>
        ) : null}
        {busy ? (
          <div role="status" className="border-b border-line px-3 py-1 text-[12px] text-ink-3">
            {text('Adding the picture…')}
          </div>
        ) : null}
      </div>
      <ScrollIf fill={fill} below={below}>
      <div ref={wrap} data-editor-frame className={cx('relative flex flex-1 flex-col', fill && 'shrink-0')}>
        {empty && placeholder ? <span aria-hidden className="pointer-events-none absolute top-4 left-5 text-[14.5px] text-ink-3">{placeholder}</span> : null}
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
          onInput={() => {
            if (pasted) setPasted(null);
            changed(true);
          }}
          onMouseUp={() => {
            remember();
            if (painter && selection() && !selection()!.collapsed) {
              const from = painter;
              setPainter(null);
              paint(from);
            }
          }}
          onKeyUp={remember}
          onFocus={remember}
          onClick={(e) => {
            const t = e.target as HTMLElement;
            if (t.tagName === 'IMG' && box.current?.contains(t)) {
              const r = document.createRange();
              r.selectNode(t);
              const s = window.getSelection();
              s?.removeAllRanges();
              s?.addRange(r);
              setImg(t as HTMLImageElement);
              return;
            }
            if (img) setImg(null);
            // A checklist's box ticks and unticks.
            const li = t.closest?.('li');
            if (li && isChecklist(li.parentElement) && e.clientX - li.getBoundingClientRect().left < 22) {
              const first = li.firstChild;
              if (first?.nodeType === Node.TEXT_NODE && /^[☐☑]/.test(first.textContent ?? '')) {
                first.textContent = (first.textContent!.startsWith(CHECK_OFF) ? CHECK_ON : CHECK_OFF) + first.textContent!.slice(1);
                changed();
              }
            }
          }}
          onMouseMove={(e) => {
            if (columnDrag.current || !box.current) return;
            box.current.style.cursor = edgeCell(e) ? 'col-resize' : '';
          }}
          onMouseDown={(e) => {
            const cell = edgeCell(e);
            if (!cell) return;
            e.preventDefault();
            const table = cell.closest('table') as HTMLTableElement;
            const grid = gridOf(table);
            const col = placeOf(grid, cell).c + Math.max(1, cell.colSpan) - 1;
            columnDrag.current = { table, col, x: e.clientX, w: cell.getBoundingClientRect().width };
            const move = (ev: MouseEvent) => {
              const d = columnDrag.current;
              if (d) setColumnWidth(d.table, d.col, d.w + ev.clientX - d.x);
            };
            const up = () => {
              columnDrag.current = null;
              window.removeEventListener('mousemove', move);
              window.removeEventListener('mouseup', up);
              changed();
            };
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
          }}
          onPaste={(e) => {
            const cd = e.clipboardData;
            const files = fileList(cd?.files);
            e.preventDefault();
            if (files.length) return filesIn(files);
            const data = { html: cd?.getData('text/html') ?? '', text: cd?.getData('text/plain') ?? '' };
            const r = selection();
            const before = box.current?.innerHTML ?? '';
            const start = r && box.current ? offsetOf(box.current, r.startContainer, r.startOffset) : 0;
            const end = r && box.current ? offsetOf(box.current, r.endContainer, r.endOffset) : 0;
            doPaste(data, 'keep');
            setPasted(data.html.trim() ? { before, start, end, data, mode: 'keep' } : null);
          }}
          onDragOver={(e) => {
            if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
          }}
          onDrop={(e) => {
            const dropped = fileList(e.dataTransfer?.files);
            if (!dropped.length) return;
            e.preventDefault();
            filesIn(dropped);
          }}
          onKeyDown={onKey}
          className={cx('bare-focus flex-1 px-5 py-4 text-[14.5px] leading-[1.5] outline-none', RICH_CONTENT_CLASS, '[&_img]:inline-block [&_img]:max-w-full [&_hr]:my-3 [&_hr]:border-line')}
          style={{ minHeight, paddingBottom: 48 }}
        />
        {picked && handle ? (
          <>
            <span aria-hidden className="pointer-events-none absolute rounded-[2px] outline-2 outline-primary" style={{ left: handle.left, top: handle.top, width: handle.width, height: handle.height, outlineStyle: 'solid' }} />
            <span
              role="slider"
              aria-label={text('Picture width')}
              aria-valuenow={Math.round(handle.width)}
              tabIndex={-1}
              onPointerDown={resizeFrom}
              className="absolute h-3 w-3 cursor-nwse-resize rounded-[2px] border-2 border-surface bg-primary"
              style={{ left: handle.left + handle.width - 6, top: handle.top + handle.height - 6 }}
            />
          </>
        ) : null}
      </div>
      </ScrollIf>
      {footer}
      <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/heic,image/heif,.heic,.heif" multiple hidden aria-hidden onChange={(e) => void insertImages(fileList(e.target.files)).then(() => (e.target.value = ''))} />
      <input
        ref={replaceInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        hidden
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f || !img) return;
          void prepareImage(f, imageMaxBytes).then(
            (p) => {
              img.setAttribute('src', p.src);
              changed();
              rerender();
            },
            (err) => toast('error', errorMessage(err)),
          );
        }}
      />
      {dialog === 'table' ? (
        <InsertTableDialog
          onInsert={(o) => {
            setDialog(null);
            insert(tableHtml(o));
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'button' ? (
        <ButtonDialog
          check={(h) => normalizeLink(h)}
          onInsert={(l, h) => {
            setDialog(null);
            insert(buttonHtml(l, h));
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'crop' && img ? (
        <CropDialog
          src={img.getAttribute('src') ?? ''}
          onCrop={(b) => {
            setDialog(null);
            void cropImage(img.getAttribute('src') ?? '', b).then(
              (src) => {
                img.setAttribute('src', src);
                changed();
                rerender();
              },
              (err) => toast('error', errorMessage(err)),
            );
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'drive' ? <DriveFilePicker title={text('Insert a picture from Files')} confirmLabel={text('Insert')} onChoose={(f) => void fromDrive(f)} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

/** The text's own scroll area when the editor fills its space; otherwise the text as it is, with `below` after it. */
function ScrollIf({ fill, below, children }: { fill?: boolean; below?: ReactNode; children: ReactNode }) {
  if (!fill) {
    return (
      <>
        {children}
        {below}
      </>
    );
  }
  return (
    <div data-editor-scroll className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-thin">
      {children}
      {below}
    </div>
  );
}
