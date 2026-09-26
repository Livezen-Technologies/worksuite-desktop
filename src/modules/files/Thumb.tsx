import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { TONE, kindOf, tagOf, thumbUrl, type DriveFile } from './api';

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

/** The grid's picture area: the thumbnail, or a big tag on the kind's colour. */
export function Tile({ f, height = 112 }: { f: Pick<DriveFile, 'id' | 'name' | 'extension' | 'has_thumb'> & { kind?: string }; height?: number }) {
  const [broken, setBroken] = useState(false);
  const kind = f.kind && TONE[f.kind] ? f.kind : kindOf(f.name, f.extension);
  if (f.has_thumb && !broken) {
    return <img src={thumbUrl(f.id)} alt="" loading="lazy" onError={() => setBroken(true)} className="block w-full object-cover" style={{ height }} />;
  }
  return (
    <span className={cx('flex w-full items-center justify-center text-[13px] font-bold tracking-[0.5px]', TONE[kind] ?? TONE.other)} style={{ height }}>
      {tagOf(f.name, f.extension)}
    </span>
  );
}
