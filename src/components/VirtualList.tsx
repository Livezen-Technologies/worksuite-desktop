import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';

/**
 * Virtualized list (FR-DIAG-06, NFR-PERF-04): only the visible rows are
 * rendered, so 100k rows scroll as smoothly as 100.
 */
export function VirtualList<T>({ items, estimate = 64, render, getKey, className, onEndReached, scrollRef }: { items: T[]; estimate?: number; render: (item: T, index: number) => ReactNode; getKey: (item: T, index: number) => string | number; className?: string; onEndReached?: () => void; /** The scroller, for pull to refresh and keeping the place (#236). */ scrollRef?: (el: HTMLDivElement | null) => (() => void) | undefined }) {
  const parent = useRef<HTMLDivElement | null>(null);
  const setParent = useCallback(
    (el: HTMLDivElement | null) => {
      parent.current = el;
      const off = scrollRef?.(el);
      return () => {
        off?.();
        parent.current = null;
      };
    },
    [scrollRef],
  );
  // TanStack Virtual returns a mutable instance; React Compiler skips this component on purpose.
  // eslint-disable-next-line react-hooks/incompatible-library
  const v = useVirtualizer({ count: items.length, getScrollElement: () => parent.current, estimateSize: () => estimate, overscan: 8, getItemKey: (i) => getKey(items[i]!, i) });
  const virtual = v.getVirtualItems();
  const lastIndex = virtual[virtual.length - 1]?.index ?? -1;
  // Paging is a side effect: it runs after the render that reached the end.
  useEffect(() => {
    if (onEndReached && lastIndex >= 0 && lastIndex >= items.length - 5) onEndReached();
  }, [lastIndex, items.length, onEndReached]);
  return (
    <div ref={setParent} className={className ?? 'h-full overflow-y-auto scroll-thin'}>
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {virtual.map((row) => (
          <div key={row.key} data-index={row.index} ref={v.measureElement} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${row.start}px)` }}>
            {render(items[row.index]!, row.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
