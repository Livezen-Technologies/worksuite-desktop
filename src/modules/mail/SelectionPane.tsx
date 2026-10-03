import { useRef, useState } from 'react';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { Menu, type MenuSection } from '../../components/Menu';
import { Button } from '../../components/ui';
import { placeOf } from './listActions';
import type { Target } from './MessageMenus';

/**
 * Several messages selected (DMO-INB-15): what can be done to all of them at
 * once — each in its own account and folder, even across accounts in All
 * Accounts (DMO-ALL-10). The buttons are the list's own actions
 * (worksuite-desktop#161): Archive and Delete leave the list at once with
 * Undo; in Deleted Items, Delete is Delete permanently and asks first.
 */
export function SelectionPane({ targets, sections, onAction, onClear }: { targets: Target[]; sections: MenuSection[]; onAction: (command: 'archive' | 'delete' | 'read' | 'unread') => void; onClear: () => void }) {
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLSpanElement>(null);
  const place = placeOf(targets);
  return (
    <section aria-label={text('{n} selected', { n: targets.length })} className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 bg-surface p-6 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-selection text-primary">
        <Icon name="check-check" size={22} />
      </span>
      <h2 className="text-[17px] font-bold text-ink">{text('{n} messages selected', { n: targets.length })}</h2>
      <div className="flex flex-wrap justify-center gap-2">
        {place === 'other' ? (
          <Button icon="archive" onClick={() => onAction('archive')}>
            {text('Archive')}
          </Button>
        ) : null}
        <Button icon="trash" onClick={() => onAction('delete')}>
          {place === 'trash' ? text('Delete permanently') : text('Delete')}
        </Button>
        <Button icon="mail-open" onClick={() => onAction('read')}>
          {text('Mark read')}
        </Button>
        <Button icon="mail" onClick={() => onAction('unread')}>
          {text('Mark unread')}
        </Button>
        <span ref={more} className="inline-flex">
          <Button icon="more" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            {text('More…')}
          </Button>
        </span>
        <Button variant="ghost" onClick={onClear}>
          {text('Clear selection')}
        </Button>
      </div>
      {menu ? <Menu sections={sections} label={text('More actions')} anchor={more} prefer="bottom" onClose={() => setMenu(false)} /> : null}
    </section>
  );
}
