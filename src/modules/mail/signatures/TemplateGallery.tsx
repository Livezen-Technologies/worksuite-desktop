import { useId } from 'react';
import { text } from '../../../core/i18n';
import { Button, Chip, Modal } from '../../../components/ui';
import type { SignatureTemplate } from '../types';
import { fillSignature, type SignatureValues } from './signatureHtml';
import { SignatureFrame } from './SignaturePreview';
import { SIGNATURE_TEMPLATES, brandOf, renderTemplate } from './templates';

/**
 * Starting a signature (worksuite-desktop#166): blank, one of the
 * ready-made templates, one of the organisation's templates or one saved
 * earlier — each shown filled with the person's details and the company's
 * logo and colour. `keepFields`: an organisation signature keeps its {fields},
 * so each person's own details go in when they write.
 */
export function TemplateGallery({ values, socialBase, saved, keepFields, onChoose, onDeleteSaved, onClose }: { values: SignatureValues; socialBase: string; saved: SignatureTemplate[]; keepFields?: boolean; onChoose: (t: { name: string; html: string }) => void; onDeleteSaved: (t: SignatureTemplate) => void; onClose: () => void }) {
  const cards: Array<{ key: string; name: string; description: string; html: string; raw: string; chip?: string; saved?: SignatureTemplate }> = [
    ...SIGNATURE_TEMPLATES.map((t) => ({ key: t.id, name: text(t.name), description: text(t.description), html: renderTemplate(t.id, { values, socialBase }), raw: t.html(brandOf(values), { values, socialBase }) })),
    ...(keepFields ? [] : saved).map((t) => ({ key: `saved-${t.id}`, name: t.name, description: t.scope === 'company' ? text('From your organisation') : text('Saved by you'), html: fillSignature(t.html, values), raw: t.html, chip: t.scope === 'company' ? text('Organisation') : text('Mine'), saved: t })),
  ];
  const titleId = useId();
  return (
    <Modal title={text('Start a signature')} labelledBy={titleId} onClose={onClose} width={980}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button type="button" onClick={() => onChoose({ name: '', html: '' })} className="flex min-h-[180px] flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed border-line text-ink-2 hover:border-primary hover:text-primary">
          <span className="text-[14px] font-bold">{text('Blank')}</span>
          <span className="text-[12px]">{text('Write your own')}</span>
        </button>
        {cards.map((c) => (
          <div key={c.key} className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-ink">{c.name}</span>
              {c.chip ? <Chip tone="indigo">{c.chip}</Chip> : null}
            </div>
            <span className="text-[12px] text-ink-3">{c.description}</span>
            <div aria-hidden className="pointer-events-none overflow-hidden">
              <SignatureFrame title={c.name} html={c.html} height={150} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" aria-label={text('Use {name}', { name: c.name })} onClick={() => onChoose({ name: c.saved ? c.name : text('{name} signature', { name: c.name }), html: keepFields ? c.raw : c.html })}>
                {text('Use')}
              </Button>
              {c.saved?.editable ? (
                <Button size="sm" variant="ghost" className="!text-danger" aria-label={text('Delete {name}', { name: c.name })} onClick={() => onDeleteSaved(c.saved!)}>
                  {text('Delete')}
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
