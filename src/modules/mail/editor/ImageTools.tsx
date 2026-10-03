import { useState } from 'react';
import { text } from '../../../core/i18n';
import { normalizeLink } from '../../../components/RichTextEditor';
import { setStyle } from './emailHtml';
import { alignImage, alignOf, sizeImage, type ImageAlign, type ImageSize } from './images';
import { FieldStrip } from './panels';
import { ToolbarRow, type ToolGroup } from './Toolbar';

/**
 * A picture's own tools, shown while one is selected (worksuite-desktop#188):
 * size presets, where it sits (in the line, left or right with text around
 * it, centred), alt text, a link, rounded corners, a border, replace, crop,
 * send as an attachment instead, and remove. Dragging the corner handle
 * sizes it freely (in the editor).
 */

export function ImageTools({ img, onChanged, onReplace, onCrop, onAsAttachment, onRemove }: { img: HTMLImageElement; onChanged: () => void; onReplace: () => void; onCrop: () => void; onAsAttachment: () => void; onRemove: () => void }) {
  const [field, setField] = useState<'alt' | 'link' | null>(null);
  const [error, setError] = useState('');
  const link = img.parentElement?.tagName === 'A' ? (img.parentElement as HTMLAnchorElement) : null;
  const align = alignOf(img);
  const width = img.getAttribute('width') ?? '';
  const embedded = /^data:image\//.test(img.getAttribute('src') ?? '');
  const rounded = !!img.style.borderRadius && img.style.borderRadius !== '0px';
  const bordered = !!img.style.border && !/none/.test(img.style.border);
  const size = (s: ImageSize) => () => {
    sizeImage(img, s);
    onChanged();
  };
  const place = (a: ImageAlign) => () => {
    alignImage(img, a);
    onChanged();
  };
  const sized = (s: ImageSize) => (s === 'full' ? width === '100%' : s === 'small' ? width === '200' : s === 'medium' ? width === '400' : false);

  const groups: ToolGroup[] = [
    {
      id: 'size',
      label: text('Size'),
      items: [
        { id: 'i-small', label: text('Small'), caption: text('S'), active: sized('small'), run: size('small') },
        { id: 'i-medium', label: text('Medium'), caption: text('M'), active: sized('medium'), run: size('medium') },
        { id: 'i-original', label: text('Original size'), caption: text('Original'), run: size('original') },
        { id: 'i-full', label: text('Full width'), caption: text('Full'), active: sized('full'), run: size('full') },
      ],
    },
    {
      id: 'place',
      label: text('Position'),
      items: [
        { id: 'i-inline', label: text('In line with text'), icon: 'type', active: align === 'inline', run: place('inline') },
        { id: 'i-left', label: text('Left, text wraps'), icon: 'align-left', active: align === 'left', run: place('left') },
        { id: 'i-center', label: text('Centred'), icon: 'align-center', active: align === 'center', run: place('center') },
        { id: 'i-right', label: text('Right, text wraps'), icon: 'align-right', active: align === 'right', run: place('right') },
      ],
    },
    {
      id: 'look',
      label: text('Look'),
      items: [
        { id: 'i-alt', label: text('Alt text'), icon: 'text-cursor', expanded: field === 'alt', active: !!img.getAttribute('alt'), run: () => setField(field === 'alt' ? null : 'alt') },
        { id: 'i-link', label: text('Link on picture'), icon: 'link', expanded: field === 'link', active: !!link, run: () => setField(field === 'link' ? null : 'link') },
        {
          id: 'i-rounded',
          label: text('Rounded corners'),
          icon: 'rounded',
          active: rounded,
          run: () => {
            setStyle(img, { 'border-radius': rounded ? null : '8px' });
            onChanged();
          },
        },
        {
          id: 'i-border',
          label: text('Border'),
          icon: 'frame',
          active: bordered,
          run: () => {
            setStyle(img, { border: bordered ? null : '1px solid #dddddd' });
            onChanged();
          },
        },
      ],
    },
    {
      id: 'edit',
      label: text('Picture'),
      items: [
        { id: 'i-replace', label: text('Replace picture'), icon: 'refresh', run: onReplace },
        { id: 'i-crop', label: text('Crop'), icon: 'crop', disabled: !embedded, reason: text('Only a picture inside the message can be cropped.'), run: onCrop },
        { id: 'i-attach', label: text('Send as attachment instead'), icon: 'paperclip', disabled: !embedded, reason: text('A picture from an address is not inside the message.'), run: onAsAttachment },
        { id: 'i-remove', label: text('Remove picture'), icon: 'trash', run: onRemove },
      ],
    },
  ];

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-subtle/60 px-2 py-1">
        <span className="shrink-0 pl-1 text-[12px] font-semibold text-ink-3">{text('Picture')}</span>
        <ToolbarRow groups={groups} label={text('Picture tools')} size="sm" className="min-w-0 flex-1" />
      </div>
      {field === 'alt' ? (
        <FieldStrip
          key="alt"
          label={text('Alt text')}
          icon="text-cursor"
          placeholder={text('What the picture shows, for people who cannot see it')}
          initial={img.getAttribute('alt') ?? ''}
          action={text('Save')}
          onSubmit={(v) => {
            img.setAttribute('alt', v.trim());
            setField(null);
            onChanged();
          }}
          onClose={() => setField(null)}
        />
      ) : null}
      {field === 'link' ? (
        <FieldStrip
          key="link"
          label={text('Picture link')}
          icon="link"
          placeholder="https://"
          initial={link?.getAttribute('href') ?? ''}
          action={link ? text('Update link') : text('Add link')}
          error={error}
          extra={
            link ? (
              <button
                type="button"
                onClick={() => {
                  link.replaceWith(img);
                  setField(null);
                  onChanged();
                }}
                className="h-7 rounded-[6px] px-2 font-semibold text-ink-2 hover:bg-surface"
              >
                {text('Remove link')}
              </button>
            ) : null
          }
          onSubmit={(v) => {
            const url = normalizeLink(v);
            if (!url) return setError(text('Use an https, http or mailto address (for example https://example.com).'));
            setError('');
            if (link) link.setAttribute('href', url);
            else {
              const a = img.ownerDocument.createElement('a');
              a.setAttribute('href', url);
              img.replaceWith(a);
              a.appendChild(img);
            }
            setField(null);
            onChanged();
          }}
          onClose={() => setField(null)}
        />
      ) : null}
    </>
  );
}
