import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../core/api';
import { call } from '../../core/bridge';
import { Avatar, cx } from '../../components/ui';
import { sanitizeRich } from './api';

/** Keeps the name and what follows apart without a space the editor would drop. */
const NBSP = String.fromCharCode(160);

const imageOf = (taskId: number) => (fileId: string) => apiUrl(`/api/tasks/${taskId}/images/${fileId}`);

/** Opens a link in the browser: a click inside the app must never navigate the app itself. */
function openLinks(ev: React.MouseEvent) {
  const a = (ev.target as HTMLElement).closest('a');
  if (!a) return;
  ev.preventDefault();
  const href = a.getAttribute('href');
  if (href && /^(https?:|mailto:)/i.test(href)) void call('app:openExternal', { url: href });
}

/** A description or a comment, shown: cleaned, with its inline images from the task. */
export function RichView({ html, taskId, className }: { html: string | null | undefined; taskId: number; className?: string }) {
  return (
    <div
      className={cx('rich selectable break-words leading-[1.6] text-ink [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-2.5 [&_code]:rounded [&_code]:bg-subtle [&_code]:px-1 [&_h3]:font-bold [&_h4]:font-semibold [&_img]:my-1 [&_img]:max-h-72 [&_img]:rounded-[8px] [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-[8px] [&_pre]:bg-subtle [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5', className)}
      onClick={openLinks}
      dangerouslySetInnerHTML={{ __html: sanitizeRich(html, imageOf(taskId)) }}
    />
  );
}

export interface Mentionable {
  id: number;
  name: string;
}

const TOOLS: Array<{ cmd: string; label: string; show: React.ReactNode }> = [
  { cmd: 'bold', label: 'Bold', show: <b>B</b> },
  { cmd: 'italic', label: 'Italic', show: <i>I</i> },
  { cmd: 'underline', label: 'Underline', show: <u>U</u> },
  { cmd: 'insertUnorderedList', label: 'Bulleted list', show: '• List' },
  { cmd: 'createLink', label: 'Link', show: 'Link' },
];

/**
 * A small rich-text box: bold, italic, underline, a list and links, and
 * "@" to mention somebody (their first name is written, as the server reads
 * it). It holds its own text while you type; `onChange` hears it cleaned.
 */
export function RichEditor({ initial, taskId, placeholder, onChange, onSubmit, onBlur, people, autoFocus, minHeight = 70, label, extraTools }: {
  initial: string;
  taskId: number;
  placeholder: string;
  onChange: (html: string) => void;
  onSubmit?: () => void;
  onBlur?: () => void;
  people?: Mentionable[];
  autoFocus?: boolean;
  minHeight?: number;
  label: string;
  extraTools?: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(!initial);
  const [asking, setAsking] = useState<{ word: string } | null>(null);
  const [pick, setPick] = useState(0);
  const options = asking && people ? people.filter((p) => p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(asking.word.toLowerCase()))).slice(0, 6) : [];

  useEffect(() => {
    if (!box.current) return;
    box.current.innerHTML = sanitizeRich(initial, imageOf(taskId));
    if (autoFocus) box.current.focus();
    // The box keeps its own text once it has it; a new `initial` means a new editor (use a key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changed = () => {
    const el = box.current;
    if (!el) return;
    setEmpty(!(el.textContent ?? '').trim() && !el.querySelector('img'));
    onChange(sanitizeRich(el.innerHTML, imageOf(taskId)));
    if (!people) return;
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    const before = node && node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '').slice(0, sel!.anchorOffset) : '';
    const m = /(^|\s)@([\p{L}\p{N}._-]{0,30})$/u.exec(before);
    setAsking(m ? { word: m[2]! } : null);
    setPick(0);
  };

  const mention = (p: Mentionable) => {
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    if (!sel || !node || node.nodeType !== Node.TEXT_NODE || !asking) return;
    const text = node.textContent ?? '';
    const at = sel.anchorOffset;
    const start = at - asking.word.length - 1;
    const first = p.name.split(/\s+/)[0] ?? p.name;
    node.textContent = `${text.slice(0, start)}@${first}${NBSP}${text.slice(at)}`;
    const range = document.createRange();
    range.setStart(node, start + first.length + 2);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    setAsking(null);
    changed();
  };

  const tool = (cmd: string) => {
    box.current?.focus();
    if (cmd === 'createLink') {
      const url = window.prompt('Link address (https://…)');
      if (!url || !/^(https?:|mailto:)/i.test(url)) return;
      document.execCommand('createLink', false, url);
    } else document.execCommand(cmd);
    changed();
  };

  return (
    <div className="relative flex flex-col rounded-[9px] border border-line bg-surface focus-within:border-primary">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-1.5 py-1 text-[12px] text-ink-2" role="toolbar" aria-label={`${label} formatting`}>
        {TOOLS.map((t) => (
          <button key={t.cmd} type="button" aria-label={t.label} title={t.label} onMouseDown={(e) => e.preventDefault()} onClick={() => tool(t.cmd)} className="rounded-[5px] px-[7px] py-[3px] hover:bg-subtle hover:text-ink">
            {t.show}
          </button>
        ))}
        {extraTools}
      </div>
      <div className="relative">
        {empty ? <span className="pointer-events-none absolute top-2 left-2.5 text-[13px] text-ink-3">{placeholder}</span> : null}
        <div
          ref={box}
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          contentEditable
          suppressContentEditableWarning
          onInput={changed}
          onBlur={() => {
            setAsking(null);
            onBlur?.();
          }}
          onClick={openLinks}
          onPaste={(e) => {
            // Text only: pasted markup brings styles and scripts the server would strip anyway.
            e.preventDefault();
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
          }}
          onKeyDown={(e) => {
            if (options.length) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setPick((pick + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                mention(options[pick]!);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setAsking(null);
                return;
              }
            }
            if (onSubmit && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSubmit();
            }
          }}
          className="bare-focus overflow-y-auto px-2.5 py-2 text-[13px] leading-[1.6] text-ink outline-none scroll-thin [&_a]:text-primary [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
          style={{ minHeight, maxHeight: 260 }}
        />
      </div>
      {options.length ? (
        <div role="listbox" aria-label="Mention someone" className="absolute bottom-full left-2 z-30 mb-1 w-[240px] rounded-[10px] border border-line bg-surface p-1 shadow-xl">
          {options.map((p, i) => (
            <button key={p.id} type="button" role="option" aria-selected={i === pick} onMouseDown={(e) => e.preventDefault()} onClick={() => mention(p)} className={cx('flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-[12.5px]', i === pick ? 'bg-selection' : 'hover:bg-subtle')}>
              <Avatar name={p.name} size={22} /> <span className="truncate text-ink">{p.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
