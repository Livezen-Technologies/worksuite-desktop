import { stampDayLabel, timeLabel, bytes } from '../../../core/time';
import { useTab } from '../../../core/tab-context';
import { text } from '../../../core/i18n';
import { FileBadge, cx } from '../../../components/ui';
import { openChatAttachment, previewKind, useAttachmentGallery, type Attachment } from '../AttachmentViewer';
import { chatOfficeDoc, mediaUrl } from '../types';
import { officeOpenKind } from '@shared/office-open';
import { OpenWithButton } from '../../office/open-with';
import type { KitFile } from './model';
import { isVoiceFile } from './voice';
import { VoiceMessage, type VoiceOf } from './VoiceMessage';

/**
 * A message's attachments (C-02, RDC-13; worksuite-desktop#229): a picture as a thumbnail, several in a grid, a video
 * or voice note that plays inline, anything else as a file card. What a file is comes from its type — the server's
 * preview kind or its MIME — never its extension, so `invoice.png` that is really a PDF is a file card and a photo
 * named `IMG_2231` is still a picture. Files arrive through the server's file route, which keeps nosniff and only
 * serves safe pictures inline (SEC-06). A voice message is the voice player alone: no name, no size, no video's
 * picture, and no "processing" line while the server finishes it (#285).
 */

export type Look = 'page' | 'drawer';

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
};

/**
 * A name nobody chose: empty, a UUID, a hash, a random upload token, a bare timestamp, or a placeholder like "blob".
 * A camera's own "IMG_2231" is left alone — people recognise those.
 */
export function isMachineName(filename: string | null | undefined): boolean {
  const stem = (filename ?? '').trim().replace(/\.[A-Za-z0-9]{1,8}$/, '');
  if (!stem) return true;
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(stem)) return true;
  if (/^[0-9a-f]{16,}$/i.test(stem) || /^\d{10,}$/.test(stem)) return true;
  if (/^(?:image|blob|upload|download|untitled|attachment)$/i.test(stem)) return true;
  // A long run of letters and digits with no separator, a quarter of it digits: a token, not words.
  return /^[A-Za-z0-9]{24,}$/.test(stem) && (stem.match(/\d/g)?.length ?? 0) >= stem.length / 4;
}

/**
 * The name a person sees for a file (C-02): its own, unless that is a machine's — then "Photo – Oct 4, 11:31.jpg" or
 * "File – Oct 4, 11:31.pdf" from when it was sent and what it is.
 */
export function readableName(f: Pick<Attachment, 'filename' | 'mime'> & Partial<Pick<Attachment, 'preview' | 'is_image'>>, at: string | null | undefined): string {
  const name = (f.filename ?? '').trim();
  if (name && !isMachineName(name)) return name;
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1]?.toLowerCase() ?? MIME_EXT[(f.mime ?? '').toLowerCase()] ?? ((f.mime ?? '').split('/')[1]?.replace(/[^a-z0-9].*$/i, '') || 'bin');
  const when = at ? `${stampDayLabel(at, 'short')}, ${timeLabel(at)}` : '';
  const kind = previewKind({ filename: name, mime: f.mime, preview: f.preview ?? null, is_image: f.is_image });
  const word = kind === 'image' ? text('Photo') : kind === 'video' ? text('Video') : kind === 'audio' ? text('Audio') : text('File');
  return `${word}${when ? ` – ${when}` : ''}.${ext}`;
}

const isImage = (f: KitFile) => previewKind(f) === 'image';

/** Opens a file in the attachment preview; a picture with the conversation's others around it for ‹ ›. */
export function openKitFile(f: KitFile, link: (url: string) => void, gallery: Attachment[]): void {
  if (isImage(f) && gallery.length) openChatAttachment(f, link, gallery);
  else openChatAttachment(f, link);
}

/** How big a thumbnail is drawn: its own shape, at most `maxW` wide and `maxH` tall. */
export function thumbSize(f: Pick<KitFile, 'width' | 'height'>, maxW: number, maxH: number): { width: number; height: number } | null {
  if (!f.width || !f.height) return null;
  const scale = Math.min(1, maxW / f.width, maxH / f.height);
  return { width: Math.max(1, Math.round(f.width * scale)), height: Math.max(1, Math.round(f.height * scale)) };
}

function Processing() {
  return (
    <span role="status" className="flex items-center gap-2 p-2 text-[12px] text-ink-2">
      <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      Media processing…
    </span>
  );
}

/** A file that is not drawn inline: its badge, a readable name, its size, and Open. */
export function FileCard({ file, at, look, accent = 'text-primary', onOpen }: { file: KitFile; at: string; look: Look; accent?: string; onOpen: () => void }) {
  const name = readableName(file, at);
  // Open with ▸ for a Word, Excel or PowerPoint file (#322).
  const office = officeOpenKind(file.filename) ? chatOfficeDoc(file) : null;
  return (
    <div data-file-card className={look === 'drawer' ? 'flex w-[250px] max-w-full items-center gap-2.5 rounded-[8px] bg-surface/70 px-2 py-2 dark:bg-white/5' : 'flex w-[280px] max-w-full items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2.5'}>
      <FileBadge name={/\.[A-Za-z0-9]{1,8}$/.test(name) ? name : file.filename} size={look === 'drawer' ? 32 : 34} />
      <span className="min-w-0 flex-1 selectable">
        <b className="block truncate text-[12px] text-ink" title={file.filename !== name ? file.filename : undefined}>{name}</b>
        <span className={cx('block text-ink-3', look === 'drawer' ? 'text-[11.5px]' : 'text-[12px]')}>
          {bytes(file.size)}
          {file.status && file.status !== 'ready' ? ` · ${file.status}` : ''}
        </span>
      </span>
      <button type="button" onClick={onOpen} className={cx('text-[12px] font-semibold hover:underline', accent)}>
        Open
      </button>
      {office ? <OpenWithButton doc={office} className="-ml-1.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle" /> : null}
    </div>
  );
}

/**
 * One attachment. `voice` plays sound as a voice message (a channel that has them, or a message that is one); `of` is
 * that message, for what is known of its recording and whether this person has played it.
 */
export function MessageAttachment({ file: f, at, look, own, voice = false, of, accent }: { file: KitFile; at: string; look: Look; own: boolean; voice?: boolean; of?: VoiceOf | null; accent?: string }) {
  const gallery = useAttachmentGallery();
  const { openLink } = useTab();
  const kind = previewKind(f);
  const url = mediaUrl(f.url);
  const src = mediaUrl(f.mime === 'image/gif' ? f.url : (f.thumb_url ?? f.url));
  const drawer = look === 'drawer';
  const open = () => openKitFile(f, openLink, gallery);
  if (isVoiceFile(f, voice)) return <VoiceMessage file={f} own={own} look={look} of={of} />;
  if (f.status === 'processing' || (kind === 'video' && !f.url)) return <Processing />;
  if (kind === 'image' && src) {
    const [maxW, maxH] = drawer ? [260, 220] : [280, 320];
    const size = thumbSize(f, maxW, maxH);
    const name = readableName(f, at);
    return (
      <button type="button" data-thumb className={cx('block overflow-hidden', drawer ? 'rounded-[8px]' : 'rounded-[12px] border border-line')} onClick={open} aria-label={`Open ${name}`}>
        <img src={src} alt={name} loading="lazy" style={size ?? undefined} className={cx('object-cover', size ? '' : drawer ? 'max-h-[220px] max-w-[260px]' : 'max-h-[320px] max-w-[280px]')} />
      </button>
    );
  }
  if (kind === 'video' && url) {
    return <video src={url} poster={mediaUrl(f.poster_url) ?? undefined} controls preload="metadata" className={drawer ? 'max-h-[220px] max-w-[280px] rounded-[8px]' : 'max-h-[260px] max-w-[360px] rounded-[12px] border border-line'} />;
  }
  return <FileCard file={f} at={at} look={look} accent={accent} onOpen={open} />;
}

/** Up to four pictures in a grid; past four, the last tile says how many more (C-02). */
export function AttachmentGrid({ files, at, look }: { files: KitFile[]; at: string; look: Look }) {
  const gallery = useAttachmentGallery();
  const { openLink } = useTab();
  const shown = files.slice(0, 4);
  const more = files.length - shown.length;
  const tile = look === 'drawer' ? 'h-[110px] w-[126px]' : 'h-[130px] w-[136px]';
  return (
    <div data-attachment-grid className={cx('grid grid-cols-2 gap-1 overflow-hidden', look === 'drawer' ? 'rounded-[8px]' : 'rounded-[12px]')}>
      {shown.map((f, i) => {
        const src = mediaUrl(f.mime === 'image/gif' ? f.url : (f.thumb_url ?? f.url));
        const name = readableName(f, at);
        const last = i === shown.length - 1 && more > 0;
        return (
          <button
            key={`${f.url ?? ''}-${i}`}
            type="button"
            onClick={() => openKitFile(f, openLink, gallery.length ? gallery : files)}
            aria-label={last ? `Open ${name} and ${more} more` : `Open ${name}`}
            className={cx('relative overflow-hidden bg-subtle', tile, shown.length === 3 && i === 0 && 'col-span-2 !w-full')}
          >
            {src ? <img src={src} alt={name} loading="lazy" className="h-full w-full object-cover" /> : null}
            {last ? <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-[18px] font-bold text-white">+{more}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** A message's files: pictures together in a grid when there are several, each other file on its own. */
export function MessageAttachments({ files, at, look, own, voice, of, accent }: { files: KitFile[]; at: string; look: Look; own: boolean; voice?: boolean; of?: VoiceOf | null; accent?: string }) {
  const pictures = files.filter((f) => isImage(f) && f.status !== 'processing' && mediaUrl(f.url));
  const rest = pictures.length >= 2 ? files.filter((f) => !pictures.includes(f)) : files;
  return (
    <>
      {pictures.length >= 2 ? <AttachmentGrid files={pictures} at={at} look={look} /> : null}
      {rest.map((f, i) => (
        <MessageAttachment key={`${f.url ?? f.filename}-${i}`} file={f} at={at} look={look} own={own} voice={voice} of={of} accent={accent} />
      ))}
    </>
  );
}
