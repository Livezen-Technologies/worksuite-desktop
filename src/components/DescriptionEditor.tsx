import { useState } from 'react';
import { call } from '../core/bridge';
import { cleanDescription, descriptionHtml } from '../core/description';
import { RichTextEditor } from './RichTextEditor';

const richClass = 'break-words whitespace-pre-wrap text-[13px] leading-[1.6] text-ink [&_a]:text-primary [&_a]:underline [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_h4]:font-bold [&_h5]:font-bold [&_h6]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5';
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

/**
 * A product description: the shared editor with the portable formatting a
 * description keeps (`cleanDescription`). Uncontrolled — it preserves the
 * caret and multilingual IME composition; remount for a new record.
 */
export function DescriptionEditor({ initial, onChange, label = 'Description' }: { initial: string; onChange: (html: string) => void; label?: string }) {
  const [value] = useState(() => descriptionHtml(initial));
  const [expanded, setExpanded] = useState(false);
  return (
    <RichTextEditor
      value={value}
      onChange={onChange}
      clean={cleanDescription}
      label={label}
      tools={['undo', 'redo', 'block', 'bold', 'italic', 'underline', 'link', 'bullets', 'numbers', 'clear']}
      toolLabels={{ bullets: 'Bullet list', link: 'Insert link', block: 'Heading' }}
      blocks={[{ value: 'p', label: 'Paragraph' }, { value: 'h1', label: 'Heading 1' }, { value: 'h2', label: 'Heading 2' }, { value: 'h3', label: 'Heading 3' }]}
      allowTel
      minHeight={expanded ? 360 : 120}
      maxHeight={expanded ? '65vh' : 260}
      boxClassName="whitespace-pre-wrap p-2.5 text-[13px] scroll-thin overflow-y-auto"
      toolbarEnd={<button type="button" aria-expanded={expanded} className="rounded px-2 py-1 text-[12px] text-ink-2 hover:bg-subtle" onClick={() => setExpanded(!expanded)}>{expanded ? 'Collapse editor' : 'Expand editor'}</button>}
      footer={<p className="m-0 border-t border-line px-2.5 py-1 text-[11px] text-ink-3">Ctrl/Cmd + B, I, U: format · K: link · Z: undo · Shift+Z: redo</p>}
    />
  );
}
