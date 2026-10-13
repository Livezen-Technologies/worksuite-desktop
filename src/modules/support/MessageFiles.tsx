import { useEffect, useState } from 'react';
import type { Attachment } from '@shared/support';
import { bytes } from '../../core/time';
import { text } from '../../core/i18n';
import { openWebLink } from '../../core/tab-context';
import { Icon } from '../../components/Icon';
import { FileBadge, cx } from '../../components/ui';
import { openPreview, type Attachment as ViewerFile } from '../chat/AttachmentViewer';
import { mediaUrl } from '../chat/types';
import { keptMediaPath, mediaPath, openAttachment } from './files';

/**
 * A message's files (#332): pictures drawn in the thread — one up to 240px, several as a grid — that open in the
 * picture viewer over the conversation (‹ › through the thread's pictures, Esc, Download, Open in app); every other
 * file a chip with its type, name and size, opened on this computer as before. A picture is read through the file's
 * own signed link (`GET attachments/{id}`, the one Open uses): the server makes no thumbnails, so a picture past
 * PREVIEW_LIMIT, or one the browser cannot draw (HEIC), stays a chip.
 */

const PICTURE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const PICTURE_MIME = /^image\/(png|jpe?g|pjpeg|gif|webp)$/i;
/** Past this a picture is not read into the thread just to be drawn small. */
export const PREVIEW_LIMIT = 15 * 1024 * 1024;

/** Whether a file is drawn as a picture in the thread. */
export function isPicture(a: Pick<Attachment, 'name' | 'mime' | 'size' | 'scan_status'>): boolean {
  if (a.scan_status === 'infected' || a.size > PREVIEW_LIMIT) return false;
  return a.mime ? PICTURE_MIME.test(a.mime) : PICTURE_EXT.test(a.name);
}

/**
 * Whether a message's words are only its files' names — `[photo.png, invoice.pdf]`, what the server writes for a
 * chat message that carried nothing else — or nothing at all: then the files alone are shown, not the names twice.
 */
export function onlyFileNames(body: string, files: Pick<Attachment, 'name'>[]): boolean {
  const said = body.trim();
  if (!said) return true;
  if (!files.length) return false;
  // A chat line with no words, as the server keeps it.
  if (said === '…') return true;
  if (!said.startsWith('[') || !said.endsWith(']')) return false;
  const inner = said.slice(1, -1);
  const names = files.map((f) => f.name);
  // The names as the server joined them, or the same names in another order.
  return inner === names.join(', ') || inner.split(', ').sort().join(', ') === [...names].sort().join(', ');
}

/** Opens a picture in the viewer, with the others it is shown among; a picture with no link opens as a file. */
export async function viewPicture(a: Attachment, pictures: Attachment[]): Promise<void> {
  const list = pictures.some((p) => p.id === a.id) ? pictures : [a];
  const paths = await Promise.all(list.map((p) => mediaPath(p.id).catch(() => null)));
  const items: ViewerFile[] = [];
  list.forEach((p, i) => {
    const path = paths[i];
    if (path) items.push({ id: p.id, filename: p.name, mime: p.mime ?? '', size: p.size, url: path, download_url: path, is_image: true });
  });
  const at = items.findIndex((it) => it.id === a.id);
  if (at < 0) return openAttachment(a);
  openPreview(items, at, openWebLink);
}

function FileChip({ a, onOpen }: { a: Attachment; onOpen?: (a: Attachment) => void }) {
  return (
    <button
      type="button"
      disabled={!onOpen}
      onClick={() => onOpen?.(a)}
      title={a.scan_status === 'unscanned' ? text('Not scanned for viruses') : undefined}
      className="flex max-w-[260px] items-center gap-2 rounded-[8px] border border-line bg-surface px-2 py-1 text-left text-[12px] hover:bg-subtle disabled:cursor-default"
    >
      <FileBadge name={a.name} size={24} />
      <span className="min-w-0">
        <span className="block truncate font-semibold text-ink">{a.name}</span>
        <span className="block text-[11px] text-ink-3">{bytes(a.size)}</span>
      </span>
    </button>
  );
}

function Picture({ a, single, onView, onOpen }: { a: Attachment; single: boolean; onView: (a: Attachment) => void; onOpen?: (a: Attachment) => void }) {
  const [path, setPath] = useState<string | null | undefined>(() => keptMediaPath(a.id));
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (path !== undefined) return;
    let live = true;
    mediaPath(a.id).then(
      (p) => live && setPath(p),
      () => live && setPath(null),
    );
    return () => {
      live = false;
    };
  }, [a.id, path]);
  const src = path ? mediaUrl(path) : null;
  // No link, or a picture that would not draw: the file's chip, which still opens it.
  if (path === null || broken || (path && !src)) return <FileChip a={a} onOpen={onOpen} />;
  return (
    <button
      type="button"
      data-picture={a.id}
      aria-label={text('View {name}', { name: a.name })}
      title={a.scan_status === 'unscanned' ? text('{name} · Not scanned for viruses', { name: a.name }) : a.name}
      onClick={() => onView(a)}
      className={cx(
        'group relative flex items-center justify-center overflow-hidden rounded-[10px] border border-line bg-subtle focus-visible:outline-2 focus-visible:outline-primary',
        single ? 'max-h-[240px] max-w-[240px] min-h-[64px] min-w-[64px]' : 'aspect-square w-full',
      )}
    >
      {src ? (
        <img src={src} alt={a.name} loading="lazy" draggable={false} onError={() => setBroken(true)} className={cx('block', single ? 'max-h-[240px] max-w-[240px] object-contain' : 'h-full w-full object-cover')} />
      ) : (
        // Its name until the picture's link is in.
        <span className={cx('flex min-w-0 flex-col items-center justify-center gap-1 px-2 text-ink-3', single ? 'h-[120px] w-[160px]' : 'h-full w-full')}>
          <Icon name="image" size={20} />
          <span className="max-w-full truncate text-[11px]">{a.name}</span>
        </span>
      )}
      <span className="pointer-events-none absolute inset-0 rounded-[10px] ring-primary/40 group-hover:ring-2" />
    </button>
  );
}

export function MessageFiles({
  files,
  pictures,
  onOpen,
  className,
}: {
  files: Attachment[];
  /** The thread's pictures, in order, for ‹ › in the viewer. */
  pictures: Attachment[];
  onOpen?: (a: Attachment) => void;
  className?: string;
}) {
  const shown = files.filter(isPicture);
  const others = files.filter((a) => !isPicture(a));
  const view = (a: Attachment) => void viewPicture(a, pictures);
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {shown.length ? (
        <ul aria-label={text('Pictures')} className={cx(shown.length === 1 ? 'flex' : 'grid max-w-[360px] gap-1.5', shown.length === 2 || shown.length === 4 ? 'grid-cols-2' : shown.length > 2 && 'grid-cols-3')}>
          {shown.map((a) => (
            <li key={a.id} className="min-w-0">
              <Picture a={a} single={shown.length === 1} onView={view} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      ) : null}
      {others.length ? (
        <ul aria-label={text('Files')} className="flex flex-wrap gap-1.5">
          {others.map((a) => (
            <li key={a.id}>
              <FileChip a={a} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
