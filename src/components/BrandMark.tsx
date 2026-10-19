import { useId } from 'react';
import { LOGO_VIEWBOX, MARK_PATHS, MARK_VIEWBOX, WORDMARK_GRADIENT, WORDMARK_PATH } from '@shared/brand';

/** The WorkSuite mark (the four squares), `size` px square. Decorative: the name always sits beside it in text or a label. */
export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden viewBox={MARK_VIEWBOX} width={size} height={size} className={className} style={{ flexShrink: 0 }}>
      {MARK_PATHS.map((p) => (
        <path key={p.fill} fill={p.fill} fillRule="evenodd" d={p.d} />
      ))}
    </svg>
  );
}

/**
 * The full WorkSuite logo, `height` px tall. `tone`: `light` for a light background, `dark` for a dark one, or
 * `auto` to follow the app's theme (both drawn, one shown by the `dark:` variant).
 */
export function BrandLogo({ height = 28, tone = 'auto', className }: { height?: number; tone?: 'light' | 'dark' | 'auto'; className?: string }) {
  if (tone === 'auto') {
    return (
      <span className={className} role="img" aria-label="WorkSuite" style={{ display: 'inline-flex' }}>
        <LogoSvg height={height} tone="light" className="dark:hidden" />
        <LogoSvg height={height} tone="dark" className="hidden dark:block" />
      </span>
    );
  }
  return (
    <span className={className} role="img" aria-label="WorkSuite" style={{ display: 'inline-flex' }}>
      <LogoSvg height={height} tone={tone} />
    </span>
  );
}

function LogoSvg({ height, tone, className }: { height: number; tone: 'light' | 'dark'; className?: string }) {
  const id = `ws-wordmark-${useId().replace(/:/g, '')}`;
  const [, , w = 250, h = 48.7] = LOGO_VIEWBOX.split(' ').map(Number);
  return (
    <svg aria-hidden viewBox={LOGO_VIEWBOX} height={height} width={(height * w) / h} className={className}>
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0.717" y1="0" x2="261.35" y2="0">
          {WORDMARK_GRADIENT[tone].map(([o, c]) => (
            <stop key={o} offset={o} stopColor={c} />
          ))}
        </linearGradient>
      </defs>
      {MARK_PATHS.map((p) => (
        <path key={p.fill} fill={p.fill} fillRule="evenodd" d={p.d} />
      ))}
      <path fill={`url(#${id})`} fillRule="evenodd" d={WORDMARK_PATH} />
    </svg>
  );
}
