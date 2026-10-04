import { openAnyLink } from '../../../components/LinkedText';
import { cx } from '../../../components/ui';

/**
 * Links in messages (C-02; worksuite-desktop#229). A long address is drawn as its site and path, cut with an
 * ellipsis — `https://techubiz.com/shop/adobe-creative-cloud?utm_source=…` reads as `techubiz.com/shop/adobe-creat…` —
 * while the link and its tooltip keep the whole address.
 */
export const SHORT_URL_MAX = 48;

export function shortUrl(href: string, max = SHORT_URL_MAX): string {
  if (href.length <= max) return href;
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return `${href.slice(0, max - 1)}…`;
  }
  const host = u.host.replace(/^www\./, '');
  const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
  const shown = `${host}${path}`;
  const cut = shown.length > max || u.search || u.hash;
  if (!cut) return shown;
  return shown.length > max - 1 ? `${shown.slice(0, max - 1)}…` : `${shown}…`;
}

/** What a site says about a link (its Open Graph card), once the server reads it for the client. */
export interface LinkPreviewData {
  url: string;
  title?: string | null;
  description?: string | null;
  image?: string | null;
  site?: string | null;
}

/**
 * A link's card under a message. The desktop never fetches a page itself: it draws what it is given, and nothing
 * without it — the preview data comes from the server with the message.
 */
export function LinkPreview({ preview, own = false, className }: { preview?: LinkPreviewData | null; own?: boolean; className?: string }) {
  if (!preview?.url || (!preview.title && !preview.description)) return null;
  let site = preview.site ?? '';
  if (!site) {
    try {
      site = new URL(preview.url).host.replace(/^www\./, '');
    } catch {
      site = '';
    }
  }
  return (
    <a
      href={preview.url}
      title={preview.url}
      onClick={(e) => {
        e.preventDefault();
        openAnyLink(preview.url);
      }}
      className={cx('flex max-w-[320px] overflow-hidden rounded-[10px] border text-left no-underline', own ? 'border-white/30 bg-white/10' : 'border-line bg-surface hover:bg-subtle', className)}
    >
      {preview.image ? <img src={preview.image} alt="" loading="lazy" className="h-[72px] w-[72px] shrink-0 object-cover" /> : null}
      <span className="flex min-w-0 flex-col gap-0.5 px-2.5 py-2">
        {site ? <span className={cx('truncate text-[11px]', own ? 'text-white/80' : 'text-ink-3')}>{site}</span> : null}
        {preview.title ? <b className={cx('line-clamp-2 text-[12.5px]', own ? 'text-white' : 'text-ink')}>{preview.title}</b> : null}
        {preview.description ? <span className={cx('line-clamp-2 text-[12px]', own ? 'text-white/85' : 'text-ink-2')}>{preview.description}</span> : null}
      </span>
    </a>
  );
}
