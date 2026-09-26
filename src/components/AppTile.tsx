import type { CSSProperties } from 'react';
import { Icon } from './Icon';
import { cx } from './ui';

/**
 * An app's tile (App Launcher, Global Search): its icon in its colour on a
 * faint tile of the same colour. In the dark theme the icon is lifted so it
 * still reads on the navy ground.
 */
export function AppTile({ icon, colour, size, radius, iconSize, className }: { icon: string; colour: string; size: number; radius?: number; iconSize?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'relative flex shrink-0 items-center justify-center border',
        'border-[color-mix(in_srgb,var(--tile)_16%,transparent)] bg-[color-mix(in_srgb,var(--tile)_8%,transparent)] text-[var(--tile)]',
        'dark:border-[color-mix(in_srgb,var(--tile)_40%,transparent)] dark:bg-[color-mix(in_srgb,var(--tile)_24%,transparent)] dark:text-[color-mix(in_srgb,var(--tile)_45%,white)]',
        className,
      )}
      style={{ '--tile': colour, width: size, height: size, borderRadius: radius ?? Math.round(size * 0.3) } as CSSProperties}
    >
      <Icon name={icon} size={iconSize ?? Math.round(size * 0.46)} />
    </span>
  );
}
