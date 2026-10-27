import { useMemo } from 'react';
import { call } from '../core/bridge';
import { cleanComposeHtml } from '../modules/mail/composeHtml';
import { sanitizeMailHtml } from '../modules/mail/sanitize';
import { RICH_CONTENT_CLASS } from './RichTextEditor';
import { cx } from './ui';

/** Mail's message sanitation and tracking-image policy, for compact conversation viewers. */
export function FormattedMessage({ html, className }: { html: string; className?: string }) {
  const safe = useMemo(() => cleanComposeHtml(sanitizeMailHtml(html, { safeLinks: false }).html), [html]);
  return (
    <div
      className={cx(RICH_CONTENT_CLASS, 'break-words [&_a]:text-primary [&_a]:underline [&_img]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-subtle [&_pre]:p-2', className)}
      dangerouslySetInnerHTML={{ __html: safe }}
      // Links are <a> elements: Tab reaches them and Enter's click bubbles here.
      role="presentation"
      onClick={(event) => {
        const link = (event.target as Element).closest('a');
        if (!link) return;
        event.preventDefault();
        const href = link.getAttribute('href');
        if (href && /^(https?:\/\/|mailto:|tel:)/i.test(href)) void call('app:openExternal', { url: href }).catch(() => undefined);
      }}
    />
  );
}
