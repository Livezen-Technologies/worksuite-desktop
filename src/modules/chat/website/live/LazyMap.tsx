import { forwardRef, lazy, Suspense, useEffect, useRef, useState, type ComponentProps } from 'react';
import { cx } from '../../../../components/ui';
import { text } from '../../../../core/i18n';
import type * as WorldMapView from './WorldMapView';

/*
 * The live map, loaded last (worksuite-desktop#248). Its code and the world's outlines (worldMap.ts, 128 KB of paths
 * drawn as one SVG) are a chunk of their own, asked for only when a map is about to be seen — the dashboard's map card
 * scrolled into view, Full map, Wall mode, the Live map window or the tray — so the figures and the list never wait
 * for them. Until it arrives the map's frame holds a placeholder of the same size.
 */

type View = typeof WorldMapView;
let loading: Promise<View> | null = null;
/** Start loading the map's code (once); a hover on Full map or Wall mode may ask early. */
export const loadMap = (): Promise<View> => (loading ??= import('./WorldMapView'));
const Lazy = lazy(() => loadMap().then((m) => ({ default: m.LiveMap })));

type Props = ComponentProps<View['LiveMap']>;

/** The map's frame while it loads: its size and ground, shimmering where motion is welcome. */
export const MapPlaceholder = forwardRef<HTMLDivElement, { className?: string; dark?: boolean }>(function MapPlaceholder({ className, dark }, ref) {
  return (
    <div ref={ref} role="img" aria-busy="true" aria-label={text('Loading the map')} data-testid="map-placeholder"
      className={cx('relative overflow-hidden', dark ? 'bg-[#0b1430]' : 'bg-[#f8f9fc] dark:bg-subtle', className)}>
      <span aria-hidden className={cx('absolute inset-[12%_8%] rounded-[40%] motion-safe:animate-pulse', dark ? 'bg-[#1a2550]' : 'bg-subtle dark:bg-ground')} />
    </div>
  );
});

/**
 * LiveMap, its code loaded on demand. With `whenVisible` it waits, too, until its frame is on screen (or within a
 * couple of hundred pixels of it); where the app cannot tell, it loads at once.
 */
export function LiveMap({ whenVisible = false, ...props }: Props & { whenVisible?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(() => !whenVisible || typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (seen || !ref.current) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setSeen(true);
    }, { rootMargin: '200px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  const dark = props.theme === 'dark';
  if (!seen) return <MapPlaceholder ref={ref} className={props.className} dark={dark} />;
  return (
    <Suspense fallback={<MapPlaceholder className={props.className} dark={dark} />}>
      <Lazy {...props} />
    </Suspense>
  );
}
