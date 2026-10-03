import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Menu, type MenuSection } from '../../components/Menu';
import { Button } from '../../components/ui';
import { messageAction, type MessageActionName, type Outcome } from './api';
import type { Target } from './MessageMenus';

/**
 * Several messages selected (DMO-INB-15): what can be done to all of them at
 * once — each in its own account and folder, even across accounts in All
 * Accounts (DMO-ALL-10) — with one toast for the whole run.
 */
export function SelectionPane({ targets, sections, onClear, onDone }: { targets: Target[]; sections: MenuSection[]; onClear: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLSpanElement>(null);
  const run = async (action: MessageActionName, done: string) => {
    const results = await Promise.allSettled(targets.map((t) => messageAction({ uid: String(t.row.id), folder: t.folder, mailbox: t.mailbox }, action, t.row.subject)));
    void qc.invalidateQueries({ queryKey: ['mail'] });
    void qc.invalidateQueries({ queryKey: ['offline'] });
    const failed = results.filter((r) => r.status === 'rejected');
    const queued = results.some((r) => r.status === 'fulfilled' && (r.value as Outcome) === 'queued');
    if (failed.length) toast('error', text('{n} of {total} could not be changed: {why}', { n: failed.length, total: targets.length, why: errorMessage((failed[0] as PromiseRejectedResult).reason) }));
    else toast(queued ? 'info' : 'success', queued ? text('Offline — this happens when you reconnect. Undo it in Waiting to send.') : done);
    if (action === 'archive' || action === 'trash' || action === 'spam') onDone();
  };
  return (
    <section aria-label={text('{n} selected', { n: targets.length })} className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 bg-surface p-6 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-selection text-primary">
        <Icon name="check-check" size={22} />
      </span>
      <h2 className="text-[17px] font-bold text-ink">{text('{n} messages selected', { n: targets.length })}</h2>
      <div className="flex flex-wrap justify-center gap-2">
        <Button icon="archive" onClick={() => void run('archive', text('Archived {n}.', { n: targets.length }))}>
          {text('Archive')}
        </Button>
        <Button icon="trash" onClick={() => void run('trash', text('Deleted {n}.', { n: targets.length }))}>
          {text('Delete')}
        </Button>
        <Button icon="mail-open" onClick={() => void run('read', text('Marked {n} as read.', { n: targets.length }))}>
          {text('Mark read')}
        </Button>
        <Button icon="mail" onClick={() => void run('unread', text('Marked {n} as unread.', { n: targets.length }))}>
          {text('Mark unread')}
        </Button>
        <span ref={more} className="inline-flex">
          <Button icon="more" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            {text('Pin, flag, snooze…')}
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
