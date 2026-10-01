import { useLayoutEffect, useRef } from 'react';
import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';

/**
 * Formatted text for the minutes (worksuite-desktop#80): bold, italic,
 * underline, lists, a heading and a quote — what the server keeps
 * (`MinutesDoc::sanitize`), and nothing it would throw away. Pasting brings
 * the words without another program's formatting.
 */

const KEEP = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'UL', 'OL', 'LI', 'H3', 'H4', 'BLOCKQUOTE', 'A']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH']);

function cleanNode(node: Node, doc: Document): Node[] {
  if (node.nodeType === Node.TEXT_NODE) return [doc.createTextNode(node.textContent ?? '')];
  if (!(node instanceof Element) || DROP.has(node.tagName)) return [];
  const kids = Array.from(node.childNodes).flatMap((c) => cleanNode(c, doc));
  if (!KEEP.has(node.tagName)) {
    if (node.tagName !== 'DIV') return kids;
    const p = doc.createElement('p');
    p.append(...kids);
    return [p];
  }
  const tag = node.tagName === 'B' ? 'strong' : node.tagName === 'I' ? 'em' : node.tagName.toLowerCase();
  const el = doc.createElement(tag);
  if (tag === 'a') {
    const href = (node.getAttribute('href') ?? '').trim();
    if (!/^(https?:\/\/|mailto:)/i.test(href)) return kids;
    el.setAttribute('href', href);
  }
  el.append(...kids);
  return [el];
}

/** The same small set of formatting the server keeps; everything else goes, its words stay. */
export function cleanHtml(html: string): string {
  if (!html.trim()) return '';
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';
  const out = doc.createElement('div');
  out.append(...Array.from(root.childNodes).flatMap((c) => cleanNode(c, doc)));
  return out.innerHTML;
}

/** The text of formatted minutes, for copying and for the AI: lists as "- " lines. */
export function plainText(html: string): string {
  if (!html.trim()) return '';
  const doc = new DOMParser().parseFromString(`<div>${cleanHtml(html)}</div>`, 'text/html');
  const lines: string[] = [];
  const walk = (n: Node, prefix = '') => {
    for (const c of Array.from(n.childNodes)) {
      if (c instanceof Element && (c.tagName === 'UL' || c.tagName === 'OL')) {
        Array.from(c.children).forEach((li, i) => lines.push(`${c.tagName === 'OL' ? `${i + 1}.` : '-'} ${(li.textContent ?? '').trim()}`));
      } else if (c instanceof Element && ['P', 'H3', 'H4', 'BLOCKQUOTE'].includes(c.tagName)) {
        lines.push(prefix + (c.textContent ?? '').trim());
      } else if (c.nodeType === Node.TEXT_NODE && c.textContent?.trim()) {
        lines.push(c.textContent.trim());
      } else if (c instanceof Element) walk(c, prefix);
    }
  };
  walk(doc.body.firstElementChild ?? doc.body);
  return lines.filter((l, i) => l || lines[i - 1]).join('\n').trim();
}

/** Plain lines as formatted text: a list when every line is one. */
export function htmlOf(lines: string[], asList = true): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const kept = lines.map((l) => l.trim()).filter(Boolean);
  if (!kept.length) return '';
  return asList ? `<ul>${kept.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : kept.map((l) => `<p>${esc(l)}</p>`).join('');
}

const TOOLS: Array<{ cmd: string; arg?: string; icon?: string; text?: string; label: string }> = [
  { cmd: 'bold', text: 'B', label: 'Bold (Ctrl+B)' },
  { cmd: 'italic', text: 'I', label: 'Italic (Ctrl+I)' },
  { cmd: 'underline', text: 'U', label: 'Underline (Ctrl+U)' },
  { cmd: 'insertUnorderedList', icon: 'list', label: 'Bulleted list' },
  { cmd: 'insertOrderedList', text: '1.', label: 'Numbered list' },
  { cmd: 'formatBlock', arg: 'h3', text: 'H', label: 'Heading' },
  { cmd: 'formatBlock', arg: 'blockquote', text: '“', label: 'Quote' },
];

export function RichText({ value, onChange, disabled, label, placeholder }: { value: string; onChange: (html: string) => void; disabled?: boolean; label: string; placeholder?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // What this editor last handed out: a value that comes back unchanged is not written over the person's typing.
  const last = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || value === last.current) return;
    el.innerHTML = cleanHtml(value);
    last.current = value;
  }, [value]);

  const emit = () => {
    const html = ref.current?.innerHTML ?? '';
    last.current = html;
    onChange(html);
  };
  const run = (cmd: string, arg?: string) => {
    if (disabled) return;
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };

  return (
    <div className={cx('rounded-[9px] border border-line bg-surface', disabled ? 'bg-subtle' : 'focus-within:border-primary')}>
      {!disabled ? (
        <div role="toolbar" aria-label={`Formatting for ${label}`} className="flex gap-0.5 border-b border-line px-1.5 py-1">
          {TOOLS.map((t) => (
            <button
              key={t.label}
              type="button"
              title={t.label}
              aria-label={t.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(t.cmd, t.arg)}
              className={cx('flex h-7 min-w-7 items-center justify-center rounded-[6px] px-1 text-[12.5px] text-ink-2 hover:bg-subtle hover:text-ink', t.text === 'B' && 'font-bold', t.text === 'I' && 'italic', t.text === 'U' && 'underline')}
            >
              {t.icon ? <Icon name={t.icon} size={14} /> : t.text}
            </button>
          ))}
        </div>
      ) : null}
      <div
        ref={ref}
        role="textbox"
        aria-multiline
        aria-label={label}
        aria-readonly={disabled || undefined}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emit}
        onPaste={(e) => {
          // Words, not another program's formatting.
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
          emit();
        }}
        className="rich-text min-h-[72px] px-3 py-2 text-[13px] leading-[1.55] text-ink outline-none selectable empty:before:text-ink-3 empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
