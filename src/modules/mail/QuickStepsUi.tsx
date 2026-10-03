import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Modal, Spinner, TextField, cx } from '../../components/ui';
import { useFolders, useQuickParts } from './api';
import { folderName, plainText } from './model';
import { QS_ACTIONS, needsAsking, useQuickSteps, type QuickStep, type QuickStepAction } from './quickSteps';
import { useCategories } from './states';
import { textToHtml } from './sanitize';

/** "Ask on first use" (DMO-QS-04): the folder or the address, once; the answer is kept with the Quick Step. */
export function QuickStepAsk({ step, mailbox, onAnswer, onCancel }: { step: QuickStep; mailbox: string | null; onAnswer: (v: { folder?: string; to?: string }) => void; onCancel: () => void }) {
  const need = needsAsking(step);
  const folders = useFolders(Number(mailbox ?? 0), need.includes('folder') && !!mailbox);
  const [folder, setFolder] = useState('');
  const [to, setTo] = useState('');
  const ok = (!need.includes('folder') || folder) && (!need.includes('to') || /^[^\s@]+@[^\s@]+$/.test(to.trim()));
  return (
    <Modal
      title={text('Set up “{name}”', { name: step.name })}
      labelledBy="mail-qs-ask"
      width={420}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>{text('Cancel')}</Button>
          <Button variant="primary" disabled={!ok} onClick={() => onAnswer({ ...(folder ? { folder } : {}), ...(to.trim() ? { to: to.trim() } : {}) })}>
            {text('Save and run')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 p-5 text-[13.5px]">
        <p className="text-ink-3">{text('Asked once: the answer is kept with this Quick Step.')}</p>
        {need.includes('folder') ? (
          folders.isLoading ? (
            <Spinner />
          ) : (
            <Select label={text('Move to')} value={folder} options={[{ value: '', label: text('Choose a folder') }, ...(folders.data?.folders ?? []).filter((f) => f.slug !== 'starred' && f.slug !== 'important').map((f) => ({ value: f.slug, label: f.slug.startsWith('label:') ? folderName(f.name) : f.name }))]} onValueChange={(v) => setFolder(String(v))} />
          )
        ) : null}
        {need.includes('to') ? <TextField label={text('Send to')} type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" /> : null}
      </div>
    </Modal>
  );
}

const ICONS = ['zap', 'check', 'archive', 'folder-input', 'forward', 'reply', 'users', 'list-todo', 'flag', 'tag', 'trash', 'star'];

/** Settings › Mail › Quick Steps: the list and the editor (O-UI-03). */
export function QuickStepsSettings() {
  const q = useQuickSteps(true);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<QuickStep | 'new' | null>(null);
  const del = async (s: QuickStep) => {
    try {
      await apiDelete(`/api/mail/quick-steps/${s.id}`);
      void qc.invalidateQueries({ queryKey: ['mail', 'quick-steps'] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <section aria-label={text('Quick Steps')}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[20px] font-bold text-ink">{text('Quick Steps')}</h2>
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
          {text('New Quick Step')}
        </Button>
      </div>
      <p className="mb-3 text-[13px] text-ink-3">{text('A Quick Step does several things to the selected messages in one go — from the right-click menu, the command bar or Ctrl+Shift+1…9 — with one Undo.')}</p>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : q.data === null ? <p className="text-[13px] text-ink-3">{text('This WorkSuite server does not keep Quick Steps yet.')}</p> : null}
      <ul role="list" className="overflow-hidden rounded-[12px] border border-line bg-surface">
        {(q.data ?? []).map((s) => (
          <li key={s.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] bg-selection text-primary">
              <Icon name={s.icon} size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold text-ink">{s.name}</span>
              <span className="block truncate text-[12px] text-ink-3">{s.actions.map((a) => text(QS_ACTIONS.find((x) => x.type === a.type)?.label ?? a.type)).join(' → ')}</span>
            </span>
            {s.shortcut ? <span className="font-mono text-[12px] text-ink-3">Ctrl+Shift+{s.shortcut}</span> : null}
            {s.org ? (
              <span className="text-[12px] text-ink-3">{text('Organisation')}</span>
            ) : (
              <>
                <Button size="sm" onClick={() => setEditing(s)}>
                  {text('Edit')}
                </Button>
                <button type="button" aria-label={text('Delete {name}', { name: s.name })} onClick={() => void del(s)} className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-danger">
                  <Icon name="trash" size={14} />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {editing ? <QuickStepEditor step={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      <QuickPartsSettings />
    </section>
  );
}

type QuickPart = { id: number; name: string; html: string; org: boolean };

/** Saved snippets, inserted from the compose window's Quick Parts menu (DMO-CMP-07). */
export function QuickPartsSettings() {
  const q = useQuickParts(true);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<QuickPart | 'new' | null>(null);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['mail', 'quick-parts'] });
  const open = (p: QuickPart | 'new') => {
    setEditing(p);
    setName(p === 'new' ? '' : p.name);
    setBody(p === 'new' ? '' : plainText(p.html));
  };
  const save = async () => {
    setBusy(true);
    try {
      const payload = { name: name.trim(), html: textToHtml(body.trim()) };
      if (editing && editing !== 'new') await apiPut(`/api/mail/quick-parts/${editing.id}`, payload);
      else await apiPost('/api/mail/quick-parts', payload);
      refresh();
      setEditing(null);
      toast('success', text('Quick Part saved.'));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const del = async (p: QuickPart) => {
    try {
      await apiDelete(`/api/mail/quick-parts/${p.id}`);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const rows = q.data ?? [];
  return (
    <section aria-label={text('Quick Parts')} className="mt-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[20px] font-bold text-ink">{text('Quick Parts')}</h2>
        <Button icon="plus" onClick={() => open('new')}>
          {text('New Quick Part')}
        </Button>
      </div>
      <p className="mb-3 text-[13px] text-ink-3">{text('Text you write often — directions, a standard answer — put into a message from the Quick Parts menu while you write.')}</p>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : rows.length === 0 ? <p className="text-[13px] text-ink-3">{text('No Quick Parts yet.')}</p> : null}
      {rows.length ? (
        <ul role="list" className="overflow-hidden rounded-[12px] border border-line bg-surface">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-ink">{p.name}</span>
                <span className="block truncate text-[12px] text-ink-3">{plainText(p.html)}</span>
              </span>
              {p.org ? (
                <span className="text-[12px] text-ink-3">{text('Organisation')}</span>
              ) : (
                <>
                  <Button size="sm" onClick={() => open(p)}>
                    {text('Edit')}
                  </Button>
                  <button type="button" aria-label={text('Delete {name}', { name: p.name })} onClick={() => void del(p)} className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-danger">
                    <Icon name="trash" size={14} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {editing ? (
        <div role="group" aria-label={editing === 'new' ? text('New Quick Part') : text('Edit Quick Part')} className="mt-4 flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4">
          <TextField label={text('Name')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-ink-2">{text('Text')}</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} className="rounded-[8px] border border-line bg-surface px-3 py-2 text-[13.5px] text-ink outline-none focus:border-primary" />
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(null)}>{text('Cancel')}</Button>
            <Button variant="primary" loading={busy} disabled={!name.trim() || !body.trim()} onClick={() => void save()}>
              {text('Save')}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function QuickStepEditor({ step, onClose }: { step: QuickStep | null; onClose: () => void }) {
  const qc = useQueryClient();
  const cats = useCategories(true);
  const [name, setName] = useState(step?.name ?? '');
  const [icon, setIcon] = useState(step?.icon ?? 'zap');
  const [shortcut, setShortcut] = useState<number | ''>(step?.shortcut ?? '');
  const [actions, setActions] = useState<QuickStepAction[]>(step?.actions ?? [{ type: 'read' }]);
  const [busy, setBusy] = useState(false);
  const setAction = (i: number, patch: Partial<QuickStepAction>) => setActions((xs) => xs.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const save = async () => {
    setBusy(true);
    try {
      const body = { name: name.trim(), icon, shortcut: shortcut === '' ? null : shortcut, actions };
      if (step) await apiPut(`/api/mail/quick-steps/${step.id}`, body);
      else await apiPost('/api/mail/quick-steps', body);
      void qc.invalidateQueries({ queryKey: ['mail', 'quick-steps'] });
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={step ? text('Edit Quick Step') : text('New Quick Step')}
      labelledBy="mail-qs-edit"
      width={560}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim() || actions.length === 0} onClick={() => void save()}>
            {text('Save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 p-5 text-[13.5px]">
        <TextField label={text('Name')} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex items-end gap-3">
          <div role="radiogroup" aria-label={text('Icon')} className="flex flex-wrap gap-1">
            {ICONS.map((i) => (
              <button key={i} type="button" role="radio" aria-checked={icon === i} aria-label={i} onClick={() => setIcon(i)} className={cx('inline-flex h-8 w-8 items-center justify-center rounded-[8px] border', icon === i ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2 hover:bg-subtle')}>
                <Icon name={i} size={15} />
              </button>
            ))}
          </div>
          <div className="w-[150px]">
            <Select label={text('Shortcut')} value={shortcut} options={[{ value: '', label: text('None') }, ...Array.from({ length: 9 }, (_, i) => ({ value: i + 1, label: `Ctrl+Shift+${i + 1}` }))]} onValueChange={(v) => setShortcut(v === '' ? '' : Number(v))} />
          </div>
        </div>
        <ol className="flex flex-col gap-2">
          {actions.map((a, i) => {
            const def = QS_ACTIONS.find((x) => x.type === a.type);
            return (
              <li key={i} className="flex flex-wrap items-end gap-2 rounded-[10px] border border-line p-2">
                <div className="w-[200px]">
                  <Select label={text('Action {n}', { n: i + 1 })} value={a.type} options={QS_ACTIONS.map((x) => ({ value: x.type, label: text(x.label) }))} onValueChange={(v) => setAction(i, { type: String(v) })} />
                </div>
                {def?.needs === 'folder' || def?.needs === 'to' ? (
                  <label className="flex items-center gap-1.5 pb-2 text-[12.5px]">
                    <Checkbox checked={!!a.ask} onChange={(e) => setAction(i, { ask: e.target.checked })} />
                    {text('Ask on first use')}
                  </label>
                ) : null}
                {def?.needs === 'folder' && !a.ask ? <TextField label={text('Folder')} value={a.folder ?? ''} onChange={(e) => setAction(i, { folder: e.target.value })} placeholder="label:Clients" /> : null}
                {def?.needs === 'to' && !a.ask ? <TextField label={text('To')} value={a.to ?? ''} onChange={(e) => setAction(i, { to: e.target.value })} /> : null}
                {def?.needs === 'category' ? (
                  <div className="w-[180px]">
                    <Select label={text('Category')} value={a.category_id ?? ''} options={[{ value: '', label: text('Choose') }, ...(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} onValueChange={(v) => setAction(i, { category_id: Number(v) })} />
                  </div>
                ) : null}
                {def?.needs === 'when' || def?.needs === 'snoozeWhen' ? (
                  <div className="w-[160px]">
                    <Select label={text('When')} value={a.when ?? (def.needs === 'when' ? 'today' : 'tomorrow')} options={(def.needs === 'when' ? ['today', 'tomorrow', 'week', 'next-week', 'none'] : ['later', 'tomorrow', 'weekend', 'next-week']).map((w) => ({ value: w, label: text({ today: 'Today', tomorrow: 'Tomorrow', week: 'This week', 'next-week': 'Next week', none: 'No date', later: 'Later today', weekend: 'This weekend' }[w] ?? w) }))} onValueChange={(v) => setAction(i, { when: String(v) })} />
                  </div>
                ) : null}
                <button type="button" aria-label={text('Remove action {n}', { n: i + 1 })} onClick={() => setActions((xs) => xs.filter((_, j) => j !== i))} className="mb-1 ml-auto inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-danger">
                  <Icon name="x" size={14} />
                </button>
              </li>
            );
          })}
        </ol>
        <Button icon="plus" disabled={actions.length >= 12} onClick={() => setActions((xs) => [...xs, { type: 'archive' }])}>
          {text('Add an action')}
        </Button>
      </div>
    </Modal>
  );
}
