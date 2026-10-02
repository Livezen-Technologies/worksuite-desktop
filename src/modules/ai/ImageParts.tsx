import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { cx, Modal } from '../../components/ui';
import type { AskImage } from './images';
import type { ImageMode, ImageRead } from './session';
import { LANGUAGE_NAMES, sizeLabel, stepLabel, stepsFor, type ImageRoute, type VisionStep } from './vision';

/**
 * The assistant's image pieces (worksuite-desktop#59): thumbnails in the composer and in a question, the preview, the
 * progress of a question with images, what was read from an image with Copy Text, and the card that says why no model
 * could look at one.
 */

/** Thumbnails of the images about to be sent, each with Preview and Remove. */
export function ComposerImages({ images, onRemove, disabled }: { images: AskImage[]; onRemove: (id: string) => void; disabled?: boolean }) {
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  if (!images.length) return null;
  return (
    <>
      <ul className="flex flex-wrap gap-2" aria-label="Attached images">
        {images.map((img) => (
          <li key={img.id} className="group relative">
            <button
              type="button"
              onClick={() => setPreview(img)}
              className="block h-14 w-14 overflow-hidden rounded-[8px] border border-line bg-subtle hover:border-primary focus-visible:border-primary"
              aria-label={`Preview ${img.name}`}
              title={`${img.name} · ${img.width} × ${img.height} · ${sizeLabel(img.size)}`}
            >
              <img src={img.url} alt="" className="h-full w-full object-cover" draggable={false} />
            </button>
            <button
              type="button"
              onClick={() => onRemove(img.id)}
              disabled={disabled}
              className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface text-ink-2 shadow-sm hover:bg-subtle hover:text-ink disabled:opacity-50"
              aria-label={`Remove ${img.name}`}
              title="Remove"
            >
              <Icon name="x" size={11} />
            </button>
          </li>
        ))}
      </ul>
      {preview ? <ImagePreview image={preview} onClose={() => setPreview(null)} /> : null}
    </>
  );
}

export function ImagePreview({ image, onClose }: { image: { name: string; url: string }; onClose: () => void }) {
  return (
    <Modal title={image.name} onClose={onClose} width={860} labelledBy="ai-image-preview">
      <img src={image.url} alt={image.name} className="mx-auto max-h-[70vh] max-w-full rounded-[8px] object-contain" />
    </Modal>
  );
}

/** The images that went with a question, small, above it. */
export function SentImages({ images }: { images: Array<{ name: string; url: string }> }) {
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  return (
    <>
      <div className="flex flex-wrap justify-end gap-1.5">
        {images.map((img, i) => (
          <button key={`${img.url}-${i}`} type="button" onClick={() => setPreview(img)} className="h-16 w-16 overflow-hidden rounded-[8px] border border-line bg-subtle" aria-label={`Preview ${img.name}`} title={img.name}>
            <img src={img.url} alt="" className="h-full w-full object-cover" draggable={false} />
          </button>
        ))}
      </div>
      {preview ? <ImagePreview image={preview} onClose={() => setPreview(null)} /> : null}
    </>
  );
}

/** Reading image → Extracting text → Preparing reply, the current one marked; read out as it changes. */
export function ImageSteps({ step, mode }: { step: VisionStep; mode: ImageMode }) {
  const steps = stepsFor(mode);
  const at = steps.indexOf(step.kind);
  return (
    <div data-testid="ai-image-steps" className="space-y-1.5 text-[13px]">
      <ol className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s} aria-current={i === at ? 'step' : undefined} className={cx('flex items-center gap-1.5', i < at ? 'text-ink-3' : i === at ? 'font-semibold text-ink' : 'text-ink-3/70')}>
            <Icon name={i < at ? 'check' : i === at ? 'spinner' : 'clock'} size={13} aria-hidden className={cx('shrink-0', i === at ? 'text-teal motion-safe:animate-spin' : '')} />
            {stepLabel({ kind: s, progress: null })}
          </li>
        ))}
      </ol>
      <p role="status" className="text-[12px] text-ink-2">
        {stepLabel(step)}
        {step.progress !== null && !step.downloading && step.kind === 'extracting' ? ` ${Math.round(step.progress * 100)}%` : ''}
      </p>
    </div>
  );
}

/** What was read from each image on this computer: the text as it is laid out, doubtful words marked, and Copy Text. */
export function ReadCard({ reads, text: all }: { reads: ImageRead[]; text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);
  const uncertain = reads.reduce((n, r) => n + (r.read?.uncertain ?? 0), 0);
  const unreadable = reads.reduce((n, r) => n + (r.read?.unreadable ?? 0), 0);
  const languages = [...new Set(reads.flatMap((r) => r.languages))].map((l) => LANGUAGE_NAMES[l]).join(', ');
  const found = reads.some((r) => r.read?.text.trim());
  return (
    <div className="space-y-2" data-testid="ai-read-card">
      <span className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-[11px] text-ink-2">
        <Icon name="scan" size={11} /> Text read on this computer{languages ? ` · ${languages}` : ''}
      </span>
      {reads.map((r, i) => (
        <section key={i} className="space-y-1">
          {reads.length > 1 ? <h3 className="text-[12px] font-semibold text-ink-2">{r.name}</h3> : null}
          {r.error ? (
            <p className="text-[12.5px] text-danger">{r.error}</p>
          ) : r.read && r.read.lines.length ? (
            <div className="rounded-[10px] border border-line bg-subtle/60 px-3 py-2 text-[13.5px] leading-[1.6] text-ink selectable">
              {r.read.lines.map((line, j) =>
                line.length ? (
                  <p key={j} className="whitespace-pre-wrap">
                    {line.map((tok, k) => (
                      <span key={k}>
                        {k > 0 ? ' ' : ''}
                        {tok.kind === 'ok' ? (
                          tok.text
                        ) : tok.kind === 'uncertain' ? (
                          <span className="underline decoration-warning decoration-dotted decoration-2 underline-offset-2" title="Uncertain — check this word against the image">
                            {tok.text}
                          </span>
                        ) : (
                          <span className="rounded-[4px] bg-warning-bg px-1 text-[12px] text-[#7A4308] italic dark:text-warning" title="This text could not be read">
                            {tok.text}
                          </span>
                        )}
                      </span>
                    ))}
                  </p>
                ) : (
                  <p key={j} aria-hidden className="h-3" />
                ),
              )}
            </div>
          ) : (
            <p className="text-[12.5px] text-ink-3">No text was found in this image.</p>
          )}
        </section>
      ))}
      {uncertain || unreadable ? (
        <p className="flex items-start gap-1.5 text-[12px] text-ink-2">
          <Icon name="info" size={13} className="mt-0.5 shrink-0" />
          <span>
            {uncertain === 1 ? '1 word may be misread (underlined). ' : uncertain > 1 ? `${uncertain} words may be misread (underlined). ` : ''}
            {unreadable ? 'Text that could not be read is marked [unreadable] — nothing was filled in.' : 'Check them against the image.'}
          </span>
        </p>
      ) : null}
      {found ? (
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(all).then(() => setCopied(true))}
          className="flex h-8 items-center gap-1.5 rounded-[8px] border border-line px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle"
        >
          <Icon name={copied ? 'check' : 'copy'} size={14} /> <span aria-live="polite">{copied ? 'Copied' : 'Copy Text'}</span>
        </button>
      ) : null}
    </div>
  );
}

/** No model can look at the image: why, and what can be done with the images still in the composer. */
export function NoVisionCard({
  route,
  hasImages,
  busy,
  onExtract,
  onLocalText,
  onSettings,
  onSetup,
}: {
  route: Extract<ImageRoute, { engine: null }>;
  hasImages: boolean;
  busy: boolean;
  onExtract: () => void;
  onLocalText: () => void;
  onSettings: () => void;
  onSetup?: () => void;
}) {
  const btn = 'flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink hover:bg-subtle disabled:opacity-50';
  return (
    <div role="status" data-testid="ai-no-vision" className="space-y-2 rounded-[10px] bg-warning-bg px-3 py-2 text-[12.5px] text-[#7A4308] dark:text-warning">
      <p className="flex items-start gap-1.5">
        <Icon name="image" size={15} className="mt-0.5 shrink-0" />
        <span>{route.why}</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={btn} onClick={onExtract} disabled={busy || !hasImages}>
          <Icon name="scan" size={14} /> Extract Text
        </button>
        {route.localText ? (
          <button type="button" className={btn} onClick={onLocalText} disabled={busy || !hasImages}>
            <Icon name="cpu" size={14} /> Answer from its text on this computer
          </button>
        ) : null}
        {route.settings ? (
          <button type="button" className={btn} onClick={onSettings}>
            <Icon name="settings" size={14} /> AI Assistant settings
          </button>
        ) : null}
        {route.setup && onSetup ? (
          <button type="button" className={btn} onClick={onSetup}>
            <Icon name="cpu" size={14} /> Set up Local AI
          </button>
        ) : null}
      </div>
      {!hasImages ? <p className="text-[11.5px]">Attach the image again to use these.</p> : null}
    </div>
  );
}
