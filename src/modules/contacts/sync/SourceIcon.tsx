import { Icon } from '../../../components/Icon';
import { cx } from '../../../components/ui';
import { providerLabel } from './api';

/**
 * Where a contact is synced, as a small mark: a letter or a symbol on the provider's colour. Plain marks, not the
 * providers' logos.
 */
const MARKS: Record<string, { bg: string; letter?: string; icon?: string }> = {
  google: { bg: '#4285F4', letter: 'G' },
  microsoft: { bg: '#0A64AD', letter: 'O' },
  icloud: { bg: '#3693F3', icon: 'cloud' },
  carddav: { bg: '#64748B', icon: 'server' },
  macos: { bg: '#475569', icon: 'laptop' },
};

export function SourceIcon({ provider, size = 16, className, title }: { provider: string; size?: number; className?: string; title?: string }) {
  const m = MARKS[provider] ?? { bg: '#94A3B8', icon: 'link' };
  const label = title ?? providerLabel(provider);
  return (
    <span role="img" aria-label={label} title={label} className={cx('inline-flex shrink-0 items-center justify-center rounded-[5px] font-bold text-white', className)} style={{ width: size, height: size, background: m.bg, fontSize: Math.round(size * 0.62) }}>
      {m.letter ?? <Icon name={m.icon ?? 'link'} size={Math.round(size * 0.7)} strokeWidth={2.2} />}
    </span>
  );
}

/** A row of them, one per provider. */
export function SourceIcons({ sources, size = 14 }: { sources: string[] | undefined; size?: number }) {
  if (!sources?.length) return null;
  return (
    <span className="inline-flex items-center gap-[3px]">
      {[...new Set(sources)].map((s) => (
        <SourceIcon key={s} provider={s} size={size} title={`Synced with ${providerLabel(s)}`} />
      ))}
    </span>
  );
}
