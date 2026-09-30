import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { TONE, kindOf, tagOf, thumbUrl, type DriveFile } from './api';
import { coverFor, coverId, coverKind } from './covers';

/** A file's coloured tag (DOCX, PDF…), or its picture when the server has one. */
export function FileIcon({ f, size = 30 }: { f: Pick<DriveFile, 'id' | 'name' | 'extension' | 'has_thumb'> & { kind?: string }; size?: number }) {
  const [broken, setBroken] = useState(false);
  const kind = f.kind && TONE[f.kind] ? f.kind : kindOf(f.name, f.extension);
  if (f.has_thumb && !broken) {
    return <img src={thumbUrl(f.id)} alt="" loading="lazy" onError={() => setBroken(true)} className="shrink-0 rounded-[7px] object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span className={cx('flex shrink-0 items-center justify-center rounded-[7px] font-bold', TONE[kind] ?? TONE.other)} style={{ width: size, height: size, fontSize: Math.max(8.5, Math.round(size * 0.31)) }}>
      {tagOf(f.name, f.extension)}
    </span>
  );
}

export function FolderIcon({ color, locked, size = 30 }: { color?: string | null; locked?: boolean; size?: number }) {
  return (
    <span className={cx('flex shrink-0 items-center justify-center rounded-[7px]', TONE.folder)} style={{ width: size, height: size, ...(color ? { color } : {}) }}>
      <Icon name={locked ? 'lock' : 'folder'} size={Math.round(size * 0.55)} strokeWidth={2} />
    </span>
  );
}

/** The grid's picture area: the server's thumbnail, else the file's first page (covers.ts), else a big tag on the kind's colour. */
export function Tile({ f, height = 112 }: { f: Pick<DriveFile, 'id' | 'name' | 'extension' | 'has_thumb'> & Partial<Pick<DriveFile, 'size' | 'version' | 'updated_at'>> & { kind?: string }; height?: number }) {
  const [broken, setBroken] = useState(false);
  const kind = f.kind && TONE[f.kind] ? f.kind : kindOf(f.name, f.extension);
  const wantsCover = !f.has_thumb && f.size !== undefined && !!coverKind({ name: f.name, extension: f.extension, size: f.size });
  const { attach, url: coverUrl } = useCover(wantsCover ? (f as DriveFile) : null);
  if (f.has_thumb && !broken) {
    return <img src={thumbUrl(f.id)} alt="" loading="lazy" onError={() => setBroken(true)} className="block w-full object-cover" style={{ height }} />;
  }
  if (coverUrl) {
    return (
      <span ref={attach} className="block w-full overflow-hidden bg-white" style={{ height }}>
        <img src={coverUrl} alt="" className="block w-full object-cover object-top" style={{ height }} />
      </span>
    );
  }
  return (
    <span ref={attach} className={cx('flex w-full items-center justify-center text-[13px] font-bold tracking-[0.5px]', TONE[kind] ?? TONE.other)} style={{ height }}>
      {tagOf(f.name, f.extension)}
    </span>
  );
}

/** A file's cover, asked for once its card is on screen. */
function useCover(f: DriveFile | null): { attach: (el: HTMLElement | null) => void; url: string | null } {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const id = f ? coverId(f) : null;
  const file = useRef(f);
  useEffect(() => {
    file.current = f;
  });
  useEffect(() => {
    if (!id || !el) return;
    let live = true;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting) || !file.current) return;
      io.disconnect();
      void coverFor(file.current).then((u) => live && setUrl(u));
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [id, el]);
  return { attach: setEl, url: id ? url : null };
}
