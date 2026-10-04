import { useTab } from '../../../core/tab-context';
import { bytes } from '../../../core/time';
import { text } from '../../../core/i18n';
import { FileBadge, cx } from '../../../components/ui';
import { previewKind } from '../AttachmentViewer';
import { mediaUrl } from '../types';
import { openKitFile, readableName } from './MessageAttachment';
import type { KitFile, KitMessage } from './model';

/**
 * Every file shared in a conversation, newest first (C-02 drawer, UX-DRW-01; worksuite-desktop#229): pictures as a
 * grid of thumbnails, other files as a list with their type badge, a readable name, size and who sent them. Each
 * opens in the attachment preview, the pictures with each other for ‹ ›.
 */
export interface SharedFile {
  key: string;
  file: KitFile;
  at: string;
  by: string;
}

/** The files in a conversation's messages, newest first. */
export function sharedFilesOf(messages: KitMessage[]): SharedFile[] {
  return messages
    .filter((m) => !m.deleted && m.kind === 'text')
    .flatMap((m) => (m.files ?? []).map((f, i) => ({ key: `${m.key}-${i}`, file: f, at: m.at, by: f.by ?? m.author.name })))
    .reverse();
}

export function SharedFiles({ files, limit = 12, className }: { files: SharedFile[]; limit?: number; className?: string }) {
  const { openLink } = useTab();
  const pictures = files.filter((s) => previewKind(s.file) === 'image' && mediaUrl(s.file.thumb_url ?? s.file.url));
  const others = files.filter((s) => !pictures.includes(s));
  const gallery = pictures.map((s) => s.file);
  if (!files.length) return null;
  return (
    <div className={cx('flex flex-col gap-2', className)}>
      {pictures.length ? (
        <div data-shared-grid className="grid grid-cols-3 gap-1">
          {pictures.slice(0, limit).map((s) => {
            const name = readableName(s.file, s.at);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => openKitFile(s.file, openLink, gallery)}
                title={`${name} · ${bytes(s.file.size)} · ${s.by}`}
                aria-label={text('Open {name}, sent by {who}', { name, who: s.by })}
                className="aspect-square overflow-hidden rounded-[6px] bg-subtle hover:opacity-90"
              >
                <img src={mediaUrl(s.file.thumb_url ?? s.file.url)!} alt={name} loading="lazy" className="h-full w-full object-cover" />
              </button>
            );
          })}
        </div>
      ) : null}
      {others.slice(0, limit).map((s) => {
        const name = readableName(s.file, s.at);
        return (
          <button key={s.key} type="button" onClick={() => openKitFile(s.file, openLink, [])} className="flex items-center gap-2 rounded-[6px] text-left hover:text-primary">
            <FileBadge name={/\.[A-Za-z0-9]{1,8}$/.test(name) ? name : s.file.filename} size={26} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-ink">{name}</span>
              <span className="block truncate text-[11px] text-ink-3">
                {bytes(s.file.size)} · {s.by}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
