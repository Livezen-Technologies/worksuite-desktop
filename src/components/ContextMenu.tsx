import { useRef } from 'react';
import { Menu, type MenuSection } from './Menu';

/**
 * A menu at the mouse: a list's right-click menu (Mail's message list and
 * folders, Chat's conversations). The menu itself is `Menu`, anchored to a
 * one-pixel point where the click was.
 */
export function ContextMenu({ x, y, sections, label, onClose, width = 260 }: { x: number; y: number; sections: MenuSection[]; label: string; onClose: () => void; width?: number }) {
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <>
      <span ref={anchor} aria-hidden style={{ position: 'fixed', left: x, top: y, width: 1, height: 1 }} />
      <Menu sections={sections} label={label} anchor={anchor} prefer="bottom" align="start" width={width} gap={0} onClose={onClose} />
    </>
  );
}
