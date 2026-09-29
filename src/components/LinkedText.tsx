import { Fragment } from 'react';
import { canOpen, refuse } from '../core/access';
import { app } from '../core/app-state';
import { call } from '../core/bridge';
import { openWebLink } from '../core/tab-context';
import { openMeeting } from '../modules/meet/api';
import { cx } from './ui';

/**
 * Message text with its web addresses made into links. A chat message is plain
 * text, so an invitation's "Join: https://…/meet/<id>" used to be words you
 * could only select and copy.
 *
 * Where a link goes:
 *   - a meeting on this server (or on app.worksuite.lk, where the server's
 *     own invitations point) opens that meeting's window here;
 *   - any other address on this server opens in its tab, or in the browser
 *     for an app the desktop does not draw (openWebLink);
 *   - anything else goes to the browser. The main process asks first before
 *     opening a site it does not know.
 */
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
/** Punctuation that ends a sentence, not an address: "see https://x.lk/a." */
const TRAIL = /[.,;:!?)\]}'"»”’]+$/;
const MEETING = /^\/meet\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

export interface TextPart {
  text: string;
  href?: string;
}

export function splitLinks(text: string): TextPart[] {
  const out: TextPart[] = [];
  let at = 0;
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0];
    const url = raw.replace(TRAIL, '');
    const start = m.index ?? 0;
    if (start > at) out.push({ text: text.slice(at, start) });
    out.push({ text: url, href: url });
    at = start + url.length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** Where a link opens. Exported for the tests. */
export function linkTarget(href: string, serverOrigin: string | null | undefined): { kind: 'meeting'; uuid: string } | { kind: 'app'; path: string } | { kind: 'external'; url: string } | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  let server = '';
  try {
    server = serverOrigin ? new URL(serverOrigin).host : '';
  } catch {
    server = '';
  }
  const ours = server !== '' && u.host === server;
  const meeting = MEETING.exec(u.pathname);
  if (meeting && (ours || u.hostname === 'app.worksuite.lk')) return { kind: 'meeting', uuid: meeting[1]!.toLowerCase() };
  if (ours) return { kind: 'app', path: `${u.pathname}${u.search}` };
  return { kind: 'external', url: u.toString() };
}

export function openAnyLink(href: string): void {
  const t = linkTarget(href, app.get().auth?.server?.origin);
  if (!t) return;
  if (t.kind === 'meeting') {
    // A meeting is Meet's: not opened for somebody without it.
    if (canOpen('meet')) void openMeeting(t.uuid);
    else refuse();
  } else if (t.kind === 'app') openWebLink(t.path);
  else void call('app:openExternal', { url: t.url });
}

export function LinkedText({ text, className }: { text: string; className?: string }) {
  const parts = splitLinks(text);
  return (
    <>
      {parts.map((p, i) =>
        p.href ? (
          <a
            key={i}
            href={p.href}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openAnyLink(p.href!);
            }}
            className={cx('break-all underline decoration-1 underline-offset-2 hover:decoration-2', className)}
          >
            {p.text}
          </a>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}
