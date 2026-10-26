import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../../components/ui';
import { isMac } from '../../core/bridge';
import { macBarInsetFor } from '@shared/window-chrome';

/**
 * The window frame of the connect screens (Connection & Startup screens 2–9): a title bar with the window's title
 * ("WorkSuite — Personal · WorkSuite Cloud", "WorkSuite — Enterprise · Livezen Technologies"), an optional accent
 * stripe in the server's colour (screen 8), and the screen below it — centred cards, or a hero panel on the left
 * (screen 2). Theme tokens only, so it follows Light, Dark and the colour profiles.
 *
 * The title bar is the window's drag region and is as tall as the main window's own controls (the macOS traffic
 * lights, the Windows / Linux title-bar overlay), so nothing sits under them.
 */
export interface ConnectFrameProps {
  /** The window's title, in the title bar. */
  title: string;
  /** The server's accent (`#rrggbb`): a stripe under the title bar. */
  accent?: string | null;
  /** A panel on the left (screen 2's WorkSuite Cloud hero); the screen's content is centred beside it. */
  aside?: ReactNode;
  children: ReactNode;
  /** Small print at the bottom of the window (the guest-mode links on screen 1). */
  footer?: ReactNode;
  className?: string;
}

export function ConnectFrame({ title, accent, aside, children, footer, className }: ConnectFrameProps) {
  return (
    <div className={cx('flex h-full flex-col bg-ground text-ink', className)} data-testid="connect-frame">
      <div className={cx('drag flex h-[52px] shrink-0 items-center border-b border-line bg-subtle px-4', isMac ? undefined : 'pr-[140px]')} style={isMac ? { paddingLeft: macBarInsetFor('main') } : undefined}>
        <span className="flex-1 truncate text-center text-[13px] font-semibold text-ink-3">{title}</span>
      </div>
      {accent ? <div className="h-1.5 shrink-0" style={{ background: accent }} data-testid="connect-accent" /> : null}
      <div className="flex min-h-0 flex-1">
        {aside ? <aside className="no-drag hidden w-[520px] shrink-0 flex-col justify-between bg-navy p-14 text-white lg:flex">{aside}</aside> : null}
        <main className="no-drag flex min-w-0 flex-1 items-center justify-center gap-7 overflow-auto p-6">{children}</main>
      </div>
      {footer ? <div className="no-drag shrink-0 px-6 pb-5 text-center text-[12px] text-ink-3">{footer}</div> : null}
    </div>
  );
}

/** A connect screen's card: the surface, its hairline and the design's 18 px corners. */
export function ConnectCard({ children, width = 520, className, style }: { children: ReactNode; width?: number; className?: string; style?: CSSProperties }) {
  return (
    <section className={cx('flex max-w-full flex-col gap-3.5 rounded-[18px] border border-line bg-surface p-10 shadow-sm', className)} style={{ width, ...style }}>
      {children}
    </section>
  );
}

/** What a screen not built yet shows (WP0 placeholders; ConnectRoot never routes to one, see `isPlaceholder`). */
export function ConnectPlaceholder({ title, screen }: { title: string; screen: string }) {
  return (
    <ConnectFrame title={title}>
      <ConnectCard>
        <h1 className="m-0 text-[24px] font-extrabold">{screen}</h1>
        <p className="m-0 text-[14px] text-ink-3">This screen is not available in this version.</p>
      </ConnectCard>
    </ConnectFrame>
  );
}
