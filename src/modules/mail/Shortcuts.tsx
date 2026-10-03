import { useQueries } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { isMac } from '../../core/bridge';
import { text } from '../../core/i18n';
import { searchFold } from '@shared/localization';
import { Button, Kbd, Modal, cx } from '../../components/ui';
import { ALL_FOLDERS } from './allAccounts';
import { bindings, keyConflicts, keyLabel, keyOf, MAIL_COMMANDS, type Scheme } from './keymap';
import { SMART_VIEWS, folderName } from './model';
import type { Folder, MailPrefs, Mailbox } from './types';
import type { Place } from './Sidebar';

/**
 * The shortcut sheet (? or Ctrl+/, DMO-KEY-02): the active scheme's keys,
 * the scheme picker, rebinding any command — and the clashes, flagged.
 */
export function ShortcutSheet({ prefs, onPrefs, onClose }: { prefs: MailPrefs; onPrefs: (p: Partial<MailPrefs>) => void; onClose: () => void }) {
  const scheme: Scheme = prefs.keyScheme ?? 'worksuite';
  const map = bindings(scheme, prefs.keyBindings);
  const clashes = keyConflicts(map);
  const [recording, setRecording] = useState<string | null>(null);
  const clashOf = (key: string) => clashes.find((c) => c.key === key) ?? null;
  return (
    <Modal title={text('Keyboard shortcuts')} labelledBy="mail-shortcuts" width={620} onClose={onClose} footer={<Button onClick={onClose}>{text('Done')}</Button>}>
      <div className="flex flex-col gap-3 p-5 text-[13px]">
        <div role="radiogroup" aria-label={text('Keyboard scheme')} className="flex gap-1 rounded-[10px] bg-subtle p-1">
          {(['worksuite', 'outlook', 'gmail'] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={scheme === s} onClick={() => onPrefs({ keyScheme: s })} className={cx('h-8 flex-1 rounded-[8px] font-semibold', scheme === s ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}>
              {s === 'worksuite' ? 'WorkSuite' : s === 'outlook' ? 'Outlook' : 'Gmail'}
            </button>
          ))}
        </div>
        {scheme === 'outlook' ? <p className="rounded-[8px] bg-[var(--ws-note-bg)] p-2.5 text-[12.5px] text-ink">{text('In the Outlook scheme Ctrl+F forwards, as in Outlook. Find in the message is F4, and the search box is Ctrl+E.')}</p> : null}
        {clashes.length ? <p role="alert" className="text-[12.5px] font-semibold text-danger">{text('{n} keys are used twice — the app’s own shortcut wins. Change one of them.', { n: clashes.length })}</p> : null}
        <ul role="list" className="max-h-[52vh] divide-y divide-line overflow-y-auto rounded-[10px] border border-line scroll-thin">
          {MAIL_COMMANDS.map((c) => {
            const keys = map[c.id] ?? [];
            return (
              <li key={c.id} className="flex items-center gap-3 px-3 py-1.5">
                <span className="min-w-0 flex-1 text-ink">{text(c.label)}</span>
                {keys.map((k) => {
                  const clash = clashOf(k);
                  return (
                    <span key={k} title={clash ? (clash.shell ? text('Also an app shortcut ({id})', { id: clash.shell }) : text('Also: {list}', { list: clash.commands.filter((x) => x !== c.id).join(', ') })) : undefined}>
                      <Kbd className={clash ? 'border-danger text-danger' : undefined}>{keyLabel(k, isMac)}</Kbd>
                    </span>
                  );
                })}
                {keys.length === 0 ? <span className="text-ink-3">—</span> : null}
                <button
                  type="button"
                  className={cx('h-7 rounded-[6px] px-2 text-[12px] font-semibold', recording === c.id ? 'bg-primary text-[var(--ws-on-primary)]' : 'text-primary hover:bg-subtle')}
                  onClick={() => setRecording(recording === c.id ? null : c.id)}
                  onKeyDown={(e) => {
                    if (recording !== c.id) return;
                    const k = keyOf(e.nativeEvent);
                    if (!k || k === 'Tab') return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (k === 'Escape') return setRecording(null);
                    onPrefs({ keyBindings: { ...(prefs.keyBindings ?? {}), [c.id]: k } });
                    setRecording(null);
                  }}
                >
                  {recording === c.id ? text('Press a key…') : text('Change')}
                </button>
              </li>
            );
          })}
        </ul>
        {prefs.keyBindings && Object.keys(prefs.keyBindings).length ? (
          <button type="button" className="self-start text-[12.5px] font-semibold text-primary hover:underline" onClick={() => onPrefs({ keyBindings: {} })}>
            {text('Put back the scheme’s keys')}
          </button>
        ) : null}
      </div>
    </Modal>
  );
}

/** Go to folder (Ctrl+Y / G F, DMO-NAV-05): type-ahead over every account's folders, All Accounts and smart views. */
export function GoToFolder({ boxes, onPick, onClose }: { boxes: Mailbox[]; onPick: (p: Partial<Place>) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const lists = useQueries({ queries: boxes.map((b) => ({ queryKey: ['mail', 'folders', b.id], queryFn: () => apiGet<{ folders: Folder[] }>('/api/mail/folders', { mailbox: b.id }), staleTime: 60_000 })) });
  const all: Array<{ key: string; label: string; hint: string; place: Partial<Place> }> = [
    ...(boxes.length > 1 ? ALL_FOLDERS.map((f) => ({ key: `all:${f.role}`, label: text(f.label), hint: text('All Accounts'), place: { box: 'unified', view: null, folder: f.role === 'junk' ? 'spam' : f.role, label: null } })) : []),
    ...SMART_VIEWS.map((v) => ({ key: `view:${v.id}`, label: text(v.label), hint: text('Smart view'), place: { box: 'unified', view: v.id, folder: v.folder, label: null } as Partial<Place> })),
    ...boxes.flatMap((b, i) => (lists[i]?.data?.folders ?? []).filter((f) => f.slug !== 'starred' && f.slug !== 'important').map((f) => ({ key: `${b.id}:${f.slug}`, label: f.slug.startsWith('label:') ? folderName(f.name) : f.name, hint: b.email, place: { box: String(b.id), view: null, folder: f.slug, label: null } }))),
  ];
  const term = searchFold(q.trim());
  const hits = (term ? all.filter((x) => searchFold(`${x.label} ${x.hint}`).includes(term)) : all).slice(0, 60);
  const go = (i: number) => {
    const h = hits[i];
    if (!h) return;
    onPick(h.place);
    onClose();
  };
  return (
    <Modal title={text('Go to folder')} labelledBy="mail-goto" width={480} onClose={onClose}>
      <div className="flex flex-col gap-2 p-4">
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setAt(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setAt((n) => Math.min(hits.length - 1, n + 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setAt((n) => Math.max(0, n - 1));
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              go(at);
            }
          }}
          role="combobox"
          aria-expanded
          aria-controls="mail-goto-list"
          aria-activedescendant={hits[at] ? `goto-${at}` : undefined}
          aria-label={text('Folder name')}
          placeholder={text('Type a folder name')}
          className="h-10 rounded-[10px] border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-primary"
        />
        <ul id="mail-goto-list" role="listbox" aria-label={text('Folders')} className="max-h-[50vh] overflow-y-auto scroll-thin">
          {hits.map((h, i) => (
            <li key={h.key} id={`goto-${i}`} role="option" aria-selected={i === at} onMouseEnter={() => setAt(i)} onClick={() => go(i)} className={cx('flex cursor-default items-center gap-2 rounded-[8px] px-3 py-1.5 text-[13.5px]', i === at ? 'bg-selection text-primary' : 'text-ink')}>
              <span className="min-w-0 flex-1 truncate font-semibold">{h.label}</span>
              <span className="shrink-0 truncate text-[12px] text-ink-3">{h.hint}</span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
