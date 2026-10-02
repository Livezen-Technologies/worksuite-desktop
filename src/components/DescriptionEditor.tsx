import { useEffect, useRef, useState } from 'react';
import { call } from '../core/bridge';
import { cleanDescription, descriptionHtml, descriptionText, textDescriptionHtml } from '../core/description';

const richClass = 'break-words whitespace-pre-wrap text-[13px] leading-[1.6] text-ink [&_a]:text-primary [&_a]:underline [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_h4]:font-bold [&_h5]:font-bold [&_h6]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5';
const tools = [
  ['bold', 'Bold', 'B'], ['italic', 'Italic', 'I'], ['underline', 'Underline', 'U'],
  ['insertUnorderedList', 'Bullet list', '• List'], ['insertOrderedList', 'Numbered list', '1. List'],
  ['link', 'Insert link', 'Link'], ['undo', 'Undo', 'Undo'], ['redo', 'Redo', 'Redo'], ['clear', 'Clear formatting', 'Clear'],
];

export function DescriptionView({ value }: { value: string }) {
  return <div className={richClass} onClick={(e) => {
    const link = (e.target as HTMLElement).closest('a');
    if (link) {
      e.preventDefault();
      const url = link.getAttribute('href');
      if (url) void call('app:openExternal', { url });
    }
  }} dangerouslySetInnerHTML={{ __html: descriptionHtml(value) }} />;
}

/** Uncontrolled content preserves the caret and multilingual IME composition. Remount for a new record. */
export function DescriptionEditor({ initial, onChange, label = 'Description' }: { initial: string; onChange: (html: string) => void; label?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const history = useRef<string[]>([descriptionHtml(initial)]);
  const cursor = useRef(0);
  const selection = useRef<Range | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [linkError, setLinkError] = useState('');
  useEffect(() => { if (box.current) box.current.innerHTML = history.current[0]!; }, []);
  const remember = () => {
    const s = window.getSelection();
    if (s?.rangeCount && box.current?.contains(s.anchorNode)) selection.current = s.getRangeAt(0).cloneRange();
  };
  const restore = () => {
    box.current?.focus();
    if (selection.current) {
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(selection.current);
    }
  };
  const changed = () => {
    const html = cleanDescription(box.current?.innerHTML ?? '');
    if (html !== history.current[cursor.current]) {
      history.current = [...history.current.slice(0, cursor.current + 1), html];
      cursor.current++;
    }
    onChange(html);
    remember();
  };
  const command = (cmd: string, value?: string) => {
    if (cmd === 'link') { remember(); setLink(''); setLinkError(''); return; }
    restore();
    if (cmd === 'undo' || cmd === 'redo') {
      cursor.current = Math.max(0, Math.min(history.current.length - 1, cursor.current + (cmd === 'undo' ? -1 : 1)));
      if (box.current) box.current.innerHTML = history.current[cursor.current]!;
      selection.current = null;
      onChange(history.current[cursor.current]!);
      return;
    }
    if (cmd === 'clear') {
      const range = document.createRange();
      if (box.current) range.selectNodeContents(box.current);
      const s = window.getSelection();
      s?.removeAllRanges(); s?.addRange(range);
      document.execCommand('insertText', false, descriptionText(box.current?.innerHTML));
    } else document.execCommand(cmd, false, value);
    changed();
  };
  return <div className="rounded-[9px] border border-line bg-surface focus-within:border-primary">
    <div role="toolbar" aria-label={`${label} formatting`} className="flex flex-wrap gap-1 border-b border-line p-1 text-[12px] text-ink-2">
      {tools.map(([cmd, name, text]) => <button key={cmd} type="button" aria-label={name} title={name} className="rounded px-2 py-1 hover:bg-subtle" onMouseDown={(e) => e.preventDefault()} onClick={() => command(cmd!)}>{text}</button>)}
      <select aria-label="Heading" defaultValue="p" className="rounded bg-surface text-ink" onFocus={remember} onChange={(e) => command('formatBlock', e.target.value)}>
        <option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option>
      </select>
      <button type="button" aria-expanded={expanded} className="rounded px-2 py-1 hover:bg-subtle" onClick={() => setExpanded(!expanded)}>{expanded ? 'Collapse editor' : 'Expand editor'}</button>
    </div>
    {link !== null ? <div className="flex flex-wrap gap-2 border-b border-line p-2 text-[12px]" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setLink(null); restore(); } }}>
      <input autoFocus aria-label="Link address" className="min-w-0 flex-1 rounded border border-line bg-surface p-1 text-ink" value={link} onChange={(e) => setLink(e.target.value)} />
      <button type="button" onClick={() => {
        if (!/^(https?:|mailto:|tel:)/i.test(link.trim())) { setLinkError('Use an https, http, mailto or tel address.'); return; }
        command('createLink', link.trim()); setLink(null);
      }}>Add link</button><button type="button" onClick={() => { setLink(null); restore(); }}>Cancel link</button>
      {linkError ? <span role="alert" className="text-danger">{linkError}</span> : null}
    </div> : null}
    <div ref={box} role="textbox" aria-label={label} aria-multiline="true" contentEditable suppressContentEditableWarning
      className={`${richClass} overflow-y-auto p-2.5 outline-none scroll-thin`} style={{ minHeight: expanded ? 360 : 120, maxHeight: expanded ? '65vh' : 260 }}
      onInput={changed} onMouseUp={remember} onKeyUp={remember}
      onPaste={(e) => {
        e.preventDefault();
        const html = e.clipboardData.getData('text/html');
        document.execCommand('insertHTML', false, html ? cleanDescription(html) : textDescriptionHtml(e.clipboardData.getData('text/plain')));
        changed();
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || !(e.ctrlKey || e.metaKey)) return;
        const key = e.key.toLowerCase();
        const cmd = key === 'z' ? (e.shiftKey ? 'redo' : 'undo') : key === 'y' ? 'redo' : key === 'k' ? 'link' : ['b', 'i', 'u'].includes(key) ? ({ b: 'bold', i: 'italic', u: 'underline' } as Record<string, string>)[key] : null;
        if (cmd) { e.preventDefault(); command(cmd); }
      }} />
    <p className="m-0 border-t border-line px-2.5 py-1 text-[11px] text-ink-3">Ctrl/Cmd + B, I, U: format · K: link · Z: undo · Shift+Z: redo</p>
  </div>;
}
