import { useEffect, useRef, useState } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { sanitizeHtml } from '../../core/rich';
import { toast } from '../../core/toasts';
import { uploadBlob } from '../../core/upload';
import { cx } from '../../components/ui';
import { saveBody, showBody } from './api';

const PICTURES = 'image/png,image/jpeg,image/gif,image/webp';
const TOOLS: Array<[string, React.ReactNode]> = [
  ['Bold', <b key="b">B</b>],
  ['Italic', <i key="i">I</i>],
  ['Underline', <u key="u">U</u>],
  ['Heading 1', 'H1'],
  ['Heading 2', 'H2'],
  ['Bulleted list', '• List'],
  ['Numbered list', '1. List'],
  ['To-do', '☐ To-do'],
  ['Quote', 'Quote'],
  ['Code', 'Code'],
  ['Link', 'Link'],
  ['Picture', 'Image'],
  ['Table', 'Table'],
];
const BOX = 'rich selectable leading-[1.65] text-ink outline-none [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-[3px] [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-2 [&_code]:rounded [&_code]:bg-subtle [&_code]:px-1 [&_h1]:mt-3 [&_h1]:text-[22px] [&_h1]:font-bold [&_h2]:mt-2 [&_h2]:text-[16px] [&_h2]:font-bold [&_h3]:font-bold [&_hr]:my-3 [&_hr]:border-line [&_img]:my-2 [&_img]:max-h-[420px] [&_img]:max-w-full [&_img]:rounded-[8px] [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded-[8px] [&_pre]:bg-subtle [&_pre]:p-2.5 [&_pre]:font-mono [&_pre]:text-[12.5px] [&_table]:my-2 [&_table]:border-collapse [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-line [&_th]:bg-subtle [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-6';

/** Opens a link in the browser: a click inside the app must never navigate the app itself. */
function openLink(ev: React.MouseEvent): boolean {
  const a = (ev.target as HTMLElement).closest('a');
  if (!a) return false;
  ev.preventDefault();
  const href = a.getAttribute('href');
  if (href && /^(https?:|mailto:|tel:)/i.test(href)) void call('app:openExternal', { url: href });
  return true;
}

/** A read-only note (a viewer's, or a version in the history). */
export function NoteView({ html, noteId, className }: { html: string; noteId: number; className?: string }) {
  return <div className={cx(BOX, className)} onClick={(e) => void openLink(e)} dangerouslySetInnerHTML={{ __html: showBody(html, noteId) }} />;
}

/**
 * A note's body, edited in place (NotesMain's toolbar). The box keeps its own
 * text while you type and reports it cleaned for saving; a new note (or a
 * restored version) is a new box — give it a key.
 */
export function NoteBody({ html, noteId, onChange, autoFocus, bar, top }: { html: string; noteId: number; onChange: (html: string) => void; autoFocus?: boolean; bar?: React.ReactNode; top?: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [block, setBlock] = useState('p');
  const [uploading, setUploading] = useState(0);

  useEffect(() => {
    if (!box.current) return;
    box.current.innerHTML = showBody(html, noteId) || '<p><br></p>';
    if (autoFocus) box.current.focus();
    // A new body is a new editor (the caller keys it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changed = () => {
    if (box.current) onChange(saveBody(box.current.innerHTML));
  };
  const run = (cmd: string, value?: string) => {
    box.current?.focus();
    document.execCommand(cmd, false, value);
    changed();
  };
  const heading = (tag: string) => {
    setBlock(tag);
    run('formatBlock', tag === 'p' ? 'P' : tag.toUpperCase());
  };
  const link = () => {
    const url = window.prompt('Link address (https://…)');
    if (url && /^(https?:|mailto:|tel:)/i.test(url)) run('createLink', url);
  };
  const todo = () => {
    const sel = window.getSelection();
    const li = sel?.anchorNode ? (sel.anchorNode.nodeType === Node.ELEMENT_NODE ? (sel.anchorNode as Element) : sel.anchorNode.parentElement)?.closest('li') : null;
    if (li && box.current?.contains(li)) {
      const first = li.firstChild;
      if (first && first.nodeType === Node.TEXT_NODE && /^[☐☑]/.test(first.textContent ?? '')) first.textContent = (first.textContent ?? '').replace(/^[☐☑]\s?/, '');
      else li.insertBefore(document.createTextNode('☐ '), li.firstChild);
      changed();
    } else run('insertHTML', '<ul><li>☐ </li></ul>');
  };
  const table = () => run('insertHTML', '<table><thead><tr><th>Column</th><th>Column</th><th>Column</th></tr></thead><tbody><tr><td><br></td><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td><td><br></td></tr></tbody></table><p><br></p>');

  /** A picture: into your Drive, then into the note by its file id (shown from the upload until the note is saved). */
  const picture = async (file: File) => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return toast('error', 'Pictures can be PNG, JPEG, GIF or WebP.');
    setUploading((n) => n + 1);
    try {
      const { fileId } = await uploadBlob(file, file.name || `Picture ${new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.')}.png`, { kind: 'files', folderId: null });
      if (!fileId) throw new Error('WorkSuite kept the picture but did not say where.');
      const local = URL.createObjectURL(file);
      box.current?.focus();
      document.execCommand('insertHTML', false, `<img data-file-id="${fileId}" alt="${(file.name || 'picture').replace(/["<>&]/g, '')}" src="${local}"><p><br></p>`);
      changed();
    } catch (e) {
      toast('error', `The picture was not added: ${errorMessage(e)}`);
    } finally {
      setUploading((n) => n - 1);
    }
  };

  const onTool = (label: string) => {
    if (label === 'Bold') run('bold');
    else if (label === 'Italic') run('italic');
    else if (label === 'Underline') run('underline');
    else if (label === 'Heading 1') heading('h1');
    else if (label === 'Heading 2') heading('h2');
    else if (label === 'Bulleted list') run('insertUnorderedList');
    else if (label === 'Numbered list') run('insertOrderedList');
    else if (label === 'To-do') todo();
    else if (label === 'Quote') heading('blockquote');
    else if (label === 'Code') heading('pre');
    else if (label === 'Link') link();
    else if (label === 'Picture') picker.current?.click();
    else if (label === 'Table') table();
  };

  const tool = 'rounded-[5px] px-2 py-1 hover:bg-subtle hover:text-ink';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="toolbar" aria-label="Formatting" className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-line px-[18px] py-1.5 text-[12.5px] text-ink-2">
        <select aria-label="Text style" value={block} onChange={(e) => heading(e.target.value)} onMouseDown={() => box.current?.focus()} className="mr-1 h-7 rounded-[6px] border border-line bg-surface px-1 text-[12.5px] text-ink">
          <option value="p">Normal text</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="blockquote">Quote</option>
          <option value="pre">Code</option>
        </select>
        {TOOLS.map(([label, show]) => (
          <button key={label} type="button" aria-label={label} title={label} onMouseDown={(e) => e.preventDefault()} onClick={() => onTool(label)} className={tool}>
            {label === 'Picture' && uploading ? 'Adding…' : show}
          </button>
        ))}
        <input
          ref={picker}
          type="file"
          accept={PICTURES}
          aria-label="Choose a picture"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void picture(f);
          }}
        />
      </div>
      {bar}
      <div className="min-h-0 flex-1 overflow-y-auto px-10 pt-5 pb-10 scroll-thin">
        {top}
        <div
          ref={box}
          role="textbox"
          aria-multiline="true"
          aria-label="Note"
          contentEditable
          suppressContentEditableWarning
          onInput={changed}
          onClick={(e) => {
            if (openLink(e)) return;
            // A to-do's box ticks when clicked.
            const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
            const node = r?.startContainer;
            if (!r || !node || node.nodeType !== Node.TEXT_NODE || r.startOffset > 1) return;
            const li = node.parentElement?.closest('li');
            if (!li || li.firstChild !== node) return;
            const t = node.textContent ?? '';
            if (!/^[☐☑]/.test(t)) return;
            node.textContent = (t[0] === '☐' ? '☑' : '☐') + t.slice(1);
            changed();
          }}
          onPaste={(e) => {
            const pics = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
            e.preventDefault();
            if (pics.length) {
              for (const p of pics) void picture(p);
              return;
            }
            const html = e.clipboardData.getData('text/html');
            if (html) document.execCommand('insertHTML', false, sanitizeHtml(html, { profile: 'rich' }));
            else document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
            changed();
          }}
          onDrop={(e) => {
            const pics = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
            if (!pics.length) return;
            e.preventDefault();
            for (const p of pics) void picture(p);
          }}
          onKeyUp={() => {
            const el = window.getSelection()?.anchorNode;
            const blockEl = (el?.nodeType === Node.ELEMENT_NODE ? (el as Element) : el?.parentElement)?.closest('h1,h2,h3,blockquote,pre,p');
            setBlock(blockEl ? blockEl.tagName.toLowerCase() : 'p');
          }}
          className={cx(BOX, 'bare-focus min-h-[300px] text-[14px]')}
        />
      </div>
    </div>
  );
}
