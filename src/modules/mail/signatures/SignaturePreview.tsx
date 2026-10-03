import { useState } from 'react';
import { text } from '../../../core/i18n';
import { cx } from '../../../components/ui';
import { cleanComposeHtml } from '../composeHtml';
import { fillSignature, type SignatureValues } from './signatureHtml';

/**
 * A signature as a recipient sees it (worksuite-desktop#166): the fields
 * filled, in a sandboxed frame (no scripts, no app styles), on a light or a
 * dark background and at a desktop or a phone's width. In dark mode the
 * dark-mode logo, when there is one, stands in for the logo.
 */

/** The logo (the company logo, else the first picture) swapped for the dark-mode one. */
export function withDarkLogo(html: string, darkLogo: string | null | undefined, logo: string | undefined): string {
  if (!darkLogo) return html;
  const doc = new DOMParser().parseFromString(`<!doctype html><body><div>${html}</div></body>`, 'text/html');
  const root = doc.body.firstElementChild!;
  const img = (logo ? [...root.querySelectorAll('img')].find((i) => i.getAttribute('src') === logo) : null) ?? root.querySelector('img');
  if (img) img.setAttribute('src', darkLogo);
  return root.innerHTML;
}

export function previewDocument(html: string, theme: 'light' | 'dark'): string {
  const bg = theme === 'dark' ? '#1e1f22' : '#ffffff';
  const fg = theme === 'dark' ? '#e6e6e6' : '#222222';
  const link = theme === 'dark' ? '#8ab4f8' : '#1a56db';
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:${bg};color:${fg};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4}body{padding:14px}a{color:${link}}img{max-width:100%}</style></head><body>${html}</body></html>`;
}

export function SignatureFrame({ html, theme = 'light', width, height = 160, title, className }: { html: string; theme?: 'light' | 'dark'; width?: number; height?: number; title: string; className?: string }) {
  return <iframe title={title} sandbox="" srcDoc={previewDocument(cleanComposeHtml(html), theme)} className={cx('block rounded-[8px] border border-line bg-white', className)} style={{ width: width ?? '100%', height }} />;
}

export function SignaturePreview({ html, values, darkLogo }: { html: string; values: SignatureValues; darkLogo?: string | null }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [size, setSize] = useState<'desktop' | 'mobile'>('desktop');
  const filled = fillSignature(html, values);
  const shown = theme === 'dark' ? withDarkLogo(filled, darkLogo, values.company_logo) : filled;
  const toggle = (on: boolean, label: string, run: () => void) => (
    <button type="button" aria-pressed={on} onClick={run} className={cx('h-7 rounded-[6px] px-2 text-[12px] font-semibold', on ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle')}>
      {label}
    </button>
  );
  return (
    <section aria-label={text('Preview')} className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-auto text-[12.5px] font-semibold text-ink-2">{text('Preview')}</span>
        {toggle(theme === 'light', text('Light'), () => setTheme('light'))}
        {toggle(theme === 'dark', text('Dark'), () => setTheme('dark'))}
        <span aria-hidden className="mx-1 h-4 w-px bg-line" />
        {toggle(size === 'desktop', text('Desktop'), () => setSize('desktop'))}
        {toggle(size === 'mobile', text('Mobile'), () => setSize('mobile'))}
      </div>
      <div className="overflow-auto rounded-[10px] bg-subtle p-2">
        <SignatureFrame title={text('Signature preview')} html={shown} theme={theme} width={size === 'mobile' ? 360 : undefined} height={260} className="mx-auto max-w-full" />
      </div>
    </section>
  );
}
