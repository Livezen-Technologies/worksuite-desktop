import { useEffect, useId, useRef, useState } from 'react';
import { errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { Checkbox } from '../../../components/Checkbox';
import { Button, ErrorNote, Modal, TextField, cx } from '../../../components/ui';
import { MailEditor } from '../editor/MailEditor';
import { darkModeRiskOf, prepareImage } from '../editor/images';
import type { ToolGroup } from '../editor/Toolbar';
import { composeText } from '../composeHtml';
import { FIELDS, FIELD_LABELS, SOCIAL, SOCIAL_LABELS, cleanSignatureHtml, emailSafe, signatureText, socialHref, socialIconHtml, type Social, type SignatureValues } from './signatureHtml';
import { SignaturePreview } from './SignaturePreview';

/**
 * Writing a signature (worksuite-desktop#166): the Mail composer's editor
 * with a signature's smaller toolbar, the {fields}, social icons, an HTML
 * source view for pasting a signature from elsewhere, how its pictures go
 * (hosted or inside the message), a dark-mode check with a separate
 * dark-mode logo, and a live preview. Save is on once there is something
 * to save, and closing with changes asks first.
 */

export const SIGNATURE_IMAGE_BYTES = 500_000;

export interface SignatureDraft {
  name: string;
  html: string;
  image_mode?: 'hosted' | 'embedded';
  dark_logo?: string | null;
  locked?: boolean;
}

export interface SignaturePayload {
  name: string;
  html: string;
  text: string;
  image_mode: 'hosted' | 'embedded';
  dark_logo: string | null;
  locked?: boolean;
}

/** Something to save: words, a picture or a line. */
export const hasContent = (html: string) => !!composeText(html).trim() || /<(img|hr)\b/i.test(html);

export function SignatureEditor({
  title,
  initial,
  isNew,
  values,
  socialBase,
  organisation,
  onSave,
  onSaveTemplate,
  onClose,
}: {
  title: string;
  initial: SignatureDraft;
  /** A new signature can be saved as it is (a template, say); an existing one only once changed. */
  isNew: boolean;
  values: SignatureValues;
  socialBase: string;
  /** An administrator's organisation signature: may be locked. */
  organisation?: boolean;
  onSave: (p: SignaturePayload) => Promise<void>;
  onSaveTemplate?: (name: string, html: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [html, setHtml] = useState(() => cleanSignatureHtml(initial.html));
  const [startHtml] = useState(html);
  const [mode, setMode] = useState<'rich' | 'source'>('rich');
  const [source, setSource] = useState('');
  const [imageMode, setImageMode] = useState<'hosted' | 'embedded'>(initial.image_mode ?? 'hosted');
  const [darkLogo, setDarkLogo] = useState<string | null>(initial.dark_logo ?? null);
  const [locked, setLocked] = useState(initial.locked ?? true);
  const [asking, setAsking] = useState<Social | null>(null);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState('');
  const [risky, setRisky] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const insertRef = useRef<((h: string) => void) | null>(null);
  const editorEl = useRef<HTMLDivElement | null>(null);
  const darkInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const confirmId = useId();

  const current = mode === 'source' ? cleanSignatureHtml(source) : html;
  const dirty = name !== initial.name || current !== startHtml || imageMode !== (initial.image_mode ?? 'hosted') || darkLogo !== (initial.dark_logo ?? null) || (!!organisation && locked !== (initial.locked ?? true));
  const canSave = hasContent(current) && (isNew || dirty);

  // Pictures that vanish on a dark background: see-through, with dark marks.
  useEffect(() => {
    let live = true;
    const srcs = [...new Set([...current.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]!).filter((s) => !s.startsWith('{')))].slice(0, 4);
    void Promise.all(srcs.map(async (s) => ((await darkModeRiskOf(s.replace(/&amp;/g, '&'))) ? s : null))).then((r) => live && setRisky(r.filter((x): x is string => !!x)));
    return () => {
      live = false;
    };
  }, [current]);

  const close = () => (dirty ? setConfirming(true) : onClose());

  const toSource = () => {
    setSource(html);
    setMode('source');
  };
  const toRich = () => {
    setHtml(cleanSignatureHtml(source));
    setMode('rich');
  };

  const addSocial = () => {
    if (!asking) return;
    const href = socialHref(asking, link);
    if (!href) return setLinkError(text('That is not an address that opens in a browser.'));
    insertRef.current?.(socialIconHtml(asking, href, socialBase));
    setAsking(null);
    setLink('');
    setLinkError('');
  };

  /** A white backing behind see-through pictures, which shows on a dark background too. */
  const backRisky = () => {
    const doc = new DOMParser().parseFromString(`<!doctype html><body><div>${current}</div></body>`, 'text/html');
    const root = doc.body.firstElementChild!;
    for (const img of root.querySelectorAll('img')) {
      if (!risky.includes(img.getAttribute('src') ?? '')) continue;
      img.setAttribute('style', `${img.getAttribute('style') ?? ''}; background-color: #ffffff; padding: 4px`.replace(/^;\s*/, ''));
    }
    setHtml(cleanSignatureHtml(root.innerHTML));
    setMode('rich');
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // Each picture's height from its proportions, as it shows in the editor.
      const ratios: Record<string, number> = {};
      for (const img of editorEl.current?.querySelectorAll('img') ?? []) {
        if (img.naturalWidth && img.naturalHeight) ratios[img.getAttribute('src') ?? ''] = img.naturalHeight / img.naturalWidth;
      }
      const out = emailSafe(current, ratios);
      await onSave({ name: name.trim() || text('Signature'), html: out, text: signatureText(out), image_mode: imageMode, dark_logo: darkLogo, ...(organisation ? { locked } : {}) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const extra: ToolGroup[] = [
    {
      id: 'signature',
      label: text('Signature'),
      items: [
        { id: 'fields', label: text('Insert a field'), icon: 'hash', caption: text('Fields'), menu: () => [{ id: 'fields', label: text('Filled from your profile when you write'), items: FIELDS.map((f) => ({ id: `field-${f}`, label: text(FIELD_LABELS[f]), description: `{${f}}`, onSelect: () => insertRef.current?.(`{${f}}`) })) }] },
        { id: 'social', label: text('Social icon'), icon: 'at', caption: text('Social'), menu: () => [{ id: 'social', items: SOCIAL.map((k) => ({ id: `social-${k}`, label: SOCIAL_LABELS[k], onSelect: () => (setAsking(k), setLink(''), setLinkError('')) })) }] },
      ],
    },
  ];

  const pressed = (on: boolean) => cx('h-8 rounded-[8px] px-3 text-[12.5px] font-semibold', on ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle');

  return (
    <Modal
      title={title}
      labelledBy={titleId}
      onClose={close}
      width={1180}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          {onSaveTemplate ? (
            <Button variant="ghost" disabled={!hasContent(current)} onClick={() => void onSaveTemplate(name.trim() || text('My template'), emailSafe(current)).catch((e: unknown) => setError(errorMessage(e)))}>
              {text('Save as template')}
            </Button>
          ) : null}
          <span className="ml-auto" />
          <Button onClick={close}>{text('Cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!canSave} onClick={() => void save()}>
            {text('Save')}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="flex min-w-0 flex-col gap-3">
          <TextField label={text('Name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={text('Work')} autoFocus />
          <div role="group" aria-label={text('Editing view')} className="flex items-center gap-1">
            <button type="button" aria-pressed={mode === 'rich'} className={pressed(mode === 'rich')} onClick={() => mode === 'source' && toRich()}>
              {text('Editor')}
            </button>
            <button type="button" aria-pressed={mode === 'source'} className={pressed(mode === 'source')} onClick={() => mode === 'rich' && toSource()}>
              {text('HTML source')}
            </button>
            <span className="ml-2 text-[12px] text-ink-3">{text('Fields like {f} are filled from your profile for the account you send from.', { f: '{name}' })}</span>
          </div>
          {asking ? (
            <form
              className="flex flex-wrap items-end gap-2 rounded-[10px] border border-line bg-subtle p-2"
              onSubmit={(e) => {
                e.preventDefault();
                addSocial();
              }}
            >
              <div className="min-w-[240px] flex-1">
                <TextField label={text('{site} address', { site: SOCIAL_LABELS[asking] })} value={link} onChange={(e) => setLink(e.target.value)} placeholder={asking === 'whatsapp' ? '+94 77 123 4567' : 'https://'} error={linkError || null} autoFocus />
              </div>
              <Button type="submit" variant="primary">
                {text('Add icon')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAsking(null)}>
                {text('Cancel')}
              </Button>
            </form>
          ) : null}
          {mode === 'rich' ? (
            <MailEditor
              variant="signature"
              label={text('Signature')}
              value={html}
              onChange={setHtml}
              clean={(h) => cleanSignatureHtml(h)}
              editorRef={editorEl}
              insertRef={insertRef}
              extraGroups={extra}
              imageMaxBytes={SIGNATURE_IMAGE_BYTES}
              minHeight={220}
              placeholder={text('Your name, title, how to reach you…')}
            />
          ) : (
            <label className="flex flex-col gap-1">
              <span className="text-[12.5px] font-semibold text-ink-2">{text('HTML source')}</span>
              <textarea aria-label={text('HTML source')} value={source} onChange={(e) => setSource(e.target.value)} rows={14} spellCheck={false} className="rounded-[8px] border border-line bg-surface px-3 py-2 font-mono text-[12.5px] text-ink outline-none focus:border-primary" />
              <span className="text-[12px] text-ink-3">{text('Paste a signature’s HTML here. Scripts, event handlers, classes and outside style sheets are taken out; styles stay inline.')}</span>
            </label>
          )}
          <fieldset className="flex flex-wrap items-center gap-4 text-[13px] text-ink">
            <legend className="mb-1 text-[12.5px] font-semibold text-ink-2">{text('Pictures')}</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="image-mode" checked={imageMode === 'hosted'} onChange={() => setImageMode('hosted')} />
              {text('Hosted — a public, read-only WorkSuite link (smaller messages)')}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="image-mode" checked={imageMode === 'embedded'} onChange={() => setImageMode('embedded')} />
              {text('Embedded — inside each message (shows without downloading pictures)')}
            </label>
          </fieldset>
          {risky.length ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[10px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">
              <span className="min-w-0 flex-1">{text('A picture is see-through with dark marks: in dark mode it may not show. Add a dark-mode logo, or put a white background behind it.')}</span>
              <Button size="sm" onClick={() => darkInput.current?.click()}>
                {text('Add a dark-mode logo')}
              </Button>
              <Button size="sm" onClick={backRisky}>
                {text('White background')}
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
            <span className="font-semibold">{text('Dark-mode logo')}</span>
            {darkLogo ? (
              <>
                <img src={darkLogo} alt={text('Dark-mode logo')} className="h-8 rounded bg-stage-gray p-1" />
                <Button size="sm" variant="ghost" onClick={() => setDarkLogo(null)}>
                  {text('Remove')}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => darkInput.current?.click()}>
                {text('Choose…')}
              </Button>
            )}
            <span className="text-ink-3">{text('Shown in the dark preview; keep it for mail apps that support it.')}</span>
          </div>
          {organisation ? (
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <Checkbox checked={locked} onChange={(e) => setLocked(e.target.checked)} />
              {text('Locked — people use it with their own details and cannot change its layout or logo (otherwise it is a template they start from)')}
            </label>
          ) : null}
          {error ? <ErrorNote error={error} /> : null}
          <input
            ref={darkInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/svg+xml"
            hidden
            aria-hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void prepareImage(f, SIGNATURE_IMAGE_BYTES).then((p) => setDarkLogo(p.src), (err: unknown) => setError(errorMessage(err)));
            }}
          />
        </div>
        <SignaturePreview html={current} values={values} darkLogo={darkLogo} />
      </div>
      {confirming ? (
        <Modal
          title={text('Discard your changes?')}
          labelledBy={confirmId}
          onClose={() => setConfirming(false)}
          width={420}
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button onClick={() => setConfirming(false)}>{text('Keep editing')}</Button>
              <Button variant="danger" onClick={onClose}>
                {text('Discard')}
              </Button>
            </div>
          }
        >
          <p className="text-[13.5px] text-ink-2">{text('This signature has changes that are not saved.')}</p>
        </Modal>
      ) : null}
    </Modal>
  );
}
