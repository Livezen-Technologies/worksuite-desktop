import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { apiDelete, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { dateLabel, timeLabel, todayInZone, wallToUtc } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Menu, type MenuSection } from '../../components/Menu';
import { Button, Modal, TextField, cx } from '../../components/ui';
import { messageAction, stateAction, type StateAction } from './api';
import { accountBg, CategoryDot } from './parts';
import { flagChoices, snoozeChoices, stateItem, type Category } from './states';
import type { MessageRow } from './types';

/**
 * The menus for what WorkSuite keeps on a message (ENH-MAIL-03 P1): Pin,
 * Snooze, Flag with dates, Categories, and Focused / Other — the same
 * sections in the right-click menu, the reader's toolbar and the shortcuts
 * (DMO-SHL-08). Every action applies to all selected messages, each in its
 * own account (DMO-INB-15, DMO-ALL-10).
 */

/** A message the menus act on: the row, and where it lives. */
export interface Target {
  row: MessageRow;
  mailbox: string | null;
  folder: string;
}

/** Every action on a set of messages, with the list updated at once and one toast. */
export function useStateActions() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['mail', 'states'] });
    void qc.invalidateQueries({ queryKey: ['mail', 'all'] });
    void qc.invalidateQueries({ queryKey: ['mail', 'messages'] });
    void qc.invalidateQueries({ queryKey: ['offline'] });
  };
  const run = async (action: StateAction, targets: Target[], extra: Record<string, unknown> = {}, done?: string) => {
    if (targets.length === 0) return;
    try {
      const outcome = await stateAction(action, targets.map((t) => stateItem(t.row, t.mailbox, t.folder)), extra, targets[0]!.row.subject);
      // A flag is the provider's flag too, so other mail apps see it (\Flagged); clearing it clears that.
      if (action === 'flag' || action === 'unflag') {
        await Promise.all(targets.filter((t) => (action === 'flag') !== t.row.is_starred).map((t) => messageAction({ uid: String(t.row.id), folder: t.folder, mailbox: t.mailbox }, action === 'flag' ? 'star' : 'unstar', t.row.subject).catch(() => undefined)));
      }
      refresh();
      if (outcome === 'queued') toast('info', text('Offline — this happens when you reconnect. Undo it in Waiting to send.'));
      else if (done) toast('success', done);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return {
    pin: (t: Target[], on: boolean) => run(on ? 'pin' : 'unpin', t, {}, on ? text('Pinned to the top.') : text('Unpinned.')),
    snooze: (t: Target[], until: string) => run('snooze', t, { until }, text('Snoozed until {when}.', { when: `${dateLabel(until)} ${timeLabel(until)}` })),
    unsnooze: (t: Target[]) => run('unsnooze', t, {}, text('Back in its folder.')),
    flag: (t: Target[], dates: Record<string, string | null>) => run('flag', t, { dates }, text('Flagged — it is in Tasks too.')),
    unflag: (t: Target[]) => run('unflag', t, {}, text('Flag cleared.')),
    complete: (t: Target[]) => run('complete', t, {}, text('Marked complete.')),
    focus: (t: Target[], target: 'focused' | 'other', always: boolean) => run('focus', t, { target, always }, always ? text('Mail from this sender will always go to {tab}.', { tab: target === 'focused' ? text('Focused') : text('Other') }) : text('Moved to {tab}.', { tab: target === 'focused' ? text('Focused') : text('Other') })),
    categorise: (t: Target[], ids: number[], on: boolean) => run(on ? 'categorise' : 'uncategorise', t, { category_ids: ids }),
  };
}

export type StateActions = ReturnType<typeof useStateActions>;

/**
 * The sections: Pin, Snooze, Flag, Categorize, and the Focused move when the
 * list has tabs. `onCustom` opens the date pickers and the categories dialog.
 */
export function stateSections(targets: Target[], a: StateActions, cats: Category[] | null, opts: { focusTabs?: 'focused' | 'other' | null; onCustom: (what: 'snooze' | 'flag' | 'categories' | 'sweep') => void }): MenuSection[] {
  if (targets.length === 0) return [];
  const first = targets[0]!.row;
  const pinned = targets.every((t) => t.row.pinned);
  const flagged = targets.some((t) => t.row.flag && !t.row.flag.completed_at);
  const has = (id: number) => targets.every((t) => t.row.categories?.some((c) => c.id === id));
  const sections: MenuSection[] = [
    {
      id: 'organise',
      items: [
        { id: 'pin', label: pinned ? text('Unpin') : text('Pin to top'), icon: pinned ? 'pin-off' : 'pin', onSelect: () => void a.pin(targets, !pinned) },
        {
          id: 'snooze',
          label: first.snoozed_until ? text('Snoozed until {when}', { when: `${dateLabel(first.snoozed_until)} ${timeLabel(first.snoozed_until)}` }) : text('Snooze'),
          icon: 'snooze',
          submenu: [
            {
              id: 'when',
              items: [
                ...snoozeChoices().map((c) => ({ id: c.id, label: c.label, description: `${dateLabel(c.at)} ${timeLabel(c.at)}`, onSelect: () => void a.snooze(targets, c.at) })),
                { id: 'pick', label: text('Pick a date and time…'), icon: 'calendar', onSelect: () => opts.onCustom('snooze') },
                ...(first.snoozed_until ? [{ id: 'unsnooze', label: text('Unsnooze'), icon: 'undo', onSelect: () => void a.unsnooze(targets) }] : []),
              ],
            },
          ],
        },
        {
          id: 'flag',
          label: text('Flag'),
          icon: 'flag',
          submenu: [
            { id: 'dates', items: flagChoices().map((c) => ({ id: c.id, label: c.label, onSelect: () => void a.flag(targets, c.dates) })) },
            {
              id: 'more',
              items: [
                { id: 'custom', label: text('Custom…'), icon: 'calendar', onSelect: () => opts.onCustom('flag') },
                ...(flagged ? [{ id: 'complete', label: text('Mark complete'), icon: 'check', onSelect: () => void a.complete(targets) }, { id: 'clear', label: text('Clear flag'), icon: 'x', onSelect: () => void a.unflag(targets) }] : []),
              ],
            },
          ],
        },
        {
          id: 'categorise',
          label: text('Categorize'),
          icon: 'tag',
          submenu: [
            {
              id: 'cats',
              items: (cats ?? []).slice(0, 50).map((c) => ({ id: `c${c.id}`, label: c.name, checked: has(c.id), shortcut: c.shortcut ? `Ctrl+F${c.shortcut + 1}` : undefined, onSelect: () => void a.categorise(targets, [c.id], !has(c.id)) })),
            },
            { id: 'manage', items: [{ id: 'manage', label: text('Manage categories…'), icon: 'settings', onSelect: () => opts.onCustom('categories') }] },
          ],
        },
      ],
    },
  ];
  // Sweep is one sender in one account's folder.
  if (targets.length === 1 && targets[0]!.mailbox && first.from_email) {
    sections.push({ id: 'clean', items: [{ id: 'sweep', label: text('Sweep…'), icon: 'eraser', description: first.from_email, onSelect: () => opts.onCustom('sweep') }] });
  }
  if (opts.focusTabs) {
    const to = opts.focusTabs === 'focused' ? 'other' : 'focused';
    const name = to === 'focused' ? text('Focused') : text('Other');
    sections.push({
      id: 'focus',
      items: [
        { id: 'move', label: text('Move to {tab}', { tab: name }), icon: 'inbox', onSelect: () => void a.focus(targets, to, false) },
        { id: 'always', label: text('Always move to {tab}', { tab: name }), description: first.from_email, onSelect: () => void a.focus(targets, to, true) },
      ],
    });
  }
  return sections;
}

/** Pick a date and time (Snooze), or start, due and reminder (Flag › Custom). */
export function DatesDialog({ kind, onSave, onClose }: { kind: 'snooze' | 'flag'; onSave: (v: { at?: string; start_at?: string | null; due_at?: string | null; reminder_at?: string | null }) => void; onClose: () => void }) {
  const today = todayInZone();
  const [day, setDay] = useState(today);
  const [time, setTime] = useState('08:00');
  const [start, setStart] = useState(today);
  const [due, setDue] = useState(today);
  const [remind, setRemind] = useState('');
  const toUtc = (ymd: string, hm: string) => {
    const [h = '0', m = '0'] = hm.split(':');
    return wallToUtc(ymd, Number(h) * 60 + Number(m));
  };
  const save = () => {
    if (kind === 'snooze') onSave({ at: toUtc(day, time) });
    else onSave({ start_at: start ? toUtc(start, '09:00') : null, due_at: due ? toUtc(due, '17:00') : null, reminder_at: remind ? toUtc(remind.slice(0, 10), remind.slice(11, 16) || '09:00') : null });
  };
  return (
    <Modal title={kind === 'snooze' ? text('Snooze until') : text('Custom flag')} labelledBy="mail-dates" width={400} onClose={onClose} footer={<><Button onClick={onClose}>{text('Cancel')}</Button><Button variant="primary" onClick={save}>{text('Save')}</Button></>}>
      <div className="flex flex-col gap-3 p-5">
        {kind === 'snooze' ? (
          <>
            <TextField type="date" label={text('Day')} value={day} min={today} onChange={(e) => setDay(e.target.value)} />
            <TextField type="time" label={text('Time')} value={time} onChange={(e) => setTime(e.target.value)} />
          </>
        ) : (
          <>
            <TextField type="date" label={text('Start')} value={start} onChange={(e) => setStart(e.target.value)} />
            <TextField type="date" label={text('Due')} value={due} onChange={(e) => setDue(e.target.value)} />
            <TextField type="datetime-local" label={text('Reminder')} value={remind} onChange={(e) => setRemind(e.target.value)} hint={text('A desktop notification at this time, even with the app closed on this computer.')} />
          </>
        )}
      </div>
    </Modal>
  );
}

const COLOURS = ['red', 'amber', 'emerald', 'teal', 'sky', 'blue', 'indigo', 'violet', 'slate'];

/** Categories: create, rename, recolour, give a shortcut, delete (O-UI-07). */
export function CategoriesDialog({ cats, onClose }: { cats: Category[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [colour, setColour] = useState('blue');

  const done = () => void qc.invalidateQueries({ queryKey: ['mail', 'categories'] });
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      done();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const used = new Set(cats.map((c) => c.shortcut).filter(Boolean));
  return (
    <Modal title={text('Categories')} labelledBy="mail-categories" width={480} onClose={onClose} footer={<Button onClick={onClose}>{text('Done')}</Button>}>
      <div className="flex flex-col gap-3 p-5 text-[13.5px]">
        <p className="text-ink-3">{text('A category is a coloured name you can put on mail, events and tasks. The first ten have Ctrl+F2…F12.')}</p>
        <ul role="list" className="flex flex-col divide-y divide-line rounded-[10px] border border-line">
          {cats.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-3 py-2">
              <CategoryDot colour={c.colour} />
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{c.name}</span>
              {c.org ? <span className="text-[12px] text-ink-3">{text('Organisation')}</span> : null}
              {c.shortcut ? <span className="font-mono text-[12px] text-ink-3">Ctrl+F{c.shortcut + 1}</span> : null}
              {!c.org ? (
                <>
                  {!c.shortcut ? (
                    <button type="button" className="text-[12px] font-semibold text-primary hover:underline" onClick={() => {
                      const free = Array.from({ length: 11 }, (_, i) => i + 1).find((n) => !used.has(n));
                      if (free) void act(() => apiPut(`/api/categories/${c.id}`, { name: c.name, colour: c.colour, shortcut: free }));
                    }}>
                      {text('Add shortcut')}
                    </button>
                  ) : null}
                  <button type="button" aria-label={text('Delete {name}', { name: c.name })} className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-danger" onClick={() => void act(() => apiDelete(`/api/categories/${c.id}`))}>
                    <Icon name="trash" size={14} />
                  </button>
                </>
              ) : null}
            </li>
          ))}
          {cats.length === 0 ? <li className="px-3 py-2 text-ink-3">{text('No categories yet.')}</li> : null}
        </ul>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            void act(() => apiPost('/api/categories', { name: name.trim(), colour })).then(() => setName(''));

          }}
        >
          <div className="min-w-0 flex-1">
            <TextField label={text('New category')} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div role="radiogroup" aria-label={text('Colour')} className="flex gap-1 pb-2">
            {COLOURS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={colour === c} aria-label={text(c)} onClick={() => setColour(c)} className={cx('h-5 w-5 rounded-full', accountBg(c), colour === c && 'ring-2 ring-primary ring-offset-2')} />
            ))}
          </div>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            {text('Add')}
          </Button>
        </form>
      </div>
    </Modal>
  );
}

/** A menu at the mouse (the list's right-click menu). */
export function ContextMenu({ x, y, sections, label, onClose }: { x: number; y: number; sections: MenuSection[]; label: string; onClose: () => void }) {
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <>
      <span ref={anchor} aria-hidden style={{ position: 'fixed', left: x, top: y, width: 1, height: 1 }} />
      <Menu sections={sections} label={label} anchor={anchor} prefer="bottom" align="start" width={260} onClose={onClose} />
    </>
  );
}
