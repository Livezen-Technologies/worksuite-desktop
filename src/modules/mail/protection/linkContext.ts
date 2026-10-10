/**
 * Which message a clicked link came from (P-UI-12, MPR-UX-04). Every reader tags its body's links with its frame id
 * (`f=` beside the safe link's `u=` and `t=`); the link guard looks the frame up here at the click, to send the message
 * with the click-time check and to stop on the warning page for every link of a Junk, Phish or Spoof message, whose
 * links are shown as text.
 */

export interface ReaderLinks {
  /** The message's id at the server, for `POST links/check` (`message`). */
  message: string;
  /** Links are shown as text: every click stops on the warning page, whatever the check says. */
  linksAsText: boolean;
  /** The verdict's plain name, for the warning ("This message looks like phishing"). */
  verdict: string | null;
}

const readers = new Map<string, ReaderLinks>();

export function registerReaderLinks(frame: string, links: ReaderLinks): () => void {
  readers.set(frame, links);
  return () => {
    if (readers.get(frame) === links) readers.delete(frame);
  };
}

export function readerLinks(frame: string | null | undefined): ReaderLinks | null {
  return frame ? (readers.get(frame) ?? null) : null;
}

/** Each safe link in the body names its reader's frame (`&f=`), so a click can be traced back to its message. */
export function tagLinkFrames(html: string, frame: string): string {
  if (!/^[a-z0-9]{4,24}$/i.test(frame)) return html;
  return html.replace(/(href="app:\/\/bundle\/__mail-link\?[^"]*)"/g, (_, href: string) => (href.includes('&amp;f=') || href.includes('&f=') ? `${href}"` : `${href}&amp;f=${frame}"`));
}
