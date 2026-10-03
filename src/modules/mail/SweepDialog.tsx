import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { useFolders } from './api';
import { folderName } from './model';

/**
 * Sweep (O-UI-08, DMO-INB-09, WF-DO05): everything from one sender in this
 * folder — moved or deleted, all of it, all but the latest, or only what is
 * older than 3, 10 or 30 days — and, if chosen, their future mail too.
 */
export function SweepDialog({ mailbox, folder, sender, name, onClose }: { mailbox: string; folder: string; sender: string; name: string; onClose: () => void }) {
  const qc = useQueryClient();
  const count = useQuery({ queryKey: ['mail', 'sweep', mailbox, folder, sender], queryFn: () => apiGet<{ count: number; newest: string | null }>('/api/mail/sweep', { mailbox, folder, sender }) });
  const folders = useFolders(Number(mailbox), true);
  const [mode, setMode] = useState<'all' | 'future' | 'keep_latest' | 'older'>('all');
  const [action, setAction] = useState<'trash' | 'move'>('trash');
  const [to, setTo] = useState('');
  const [days, setDays] = useState(10);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ matched: number; done: number; failed: number; rule: string | null }>('/api/mail/sweep', { mailbox: Number(mailbox), folder, sender, mode: mode === 'future' ? 'all' : mode, days, action, ...(action === 'move' ? { to } : {}), future: mode === 'future' });
      void qc.invalidateQueries({ queryKey: ['mail'] });
      if (r.failed) {
        setLeft(r.failed);
        toast('error', text('{n} could not be swept. Try again.', { n: r.failed }));
      } else {
        toast('success', r.rule ? text('Swept {n} — and a rule “{rule}” takes care of future mail.', { n: r.done, rule: r.rule }) : text('Swept {n} messages.', { n: r.done }));
        onClose();
      }
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const targets = (folders.data?.folders ?? []).filter((f) => f.slug !== folder && f.slug !== 'starred' && f.slug !== 'important');
  const n = count.data?.count ?? 0;
  return (
    <Modal
      title={text('Sweep')}
      labelledBy="mail-sweep"
      width={480}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!n || (action === 'move' && !to)} onClick={() => void run()}>
            {left ? text('Retry') : text('Sweep')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 p-5 text-[13.5px]">
        {count.isLoading ? <Spinner /> : count.error ? <ErrorNote error={count.error} onRetry={() => void count.refetch()} /> : <p className="text-ink">{text('{n} messages from {name} in this folder.', { n, name: name || sender })}</p>}
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{text('Which messages')}</legend>
          {(
            [
              ['all', text('All messages from this sender')],
              ['future', text('All of them, and any future messages')],
              ['keep_latest', text('Keep only the latest, sweep the rest')],
              ['older', text('Only those older than')],
            ] as const
          ).map(([id, label]) => (
            <label key={id} className="flex items-center gap-2.5">
              <input type="radio" name="sweep-mode" checked={mode === id} onChange={() => setMode(id)} className="accent-[var(--ws-primary)]" />
              <span>{label}</span>
              {id === 'older' ? (
                <span className={cx('flex gap-1', mode !== 'older' && 'opacity-50')}>
                  {[3, 10, 30].map((d) => (
                    <button key={d} type="button" aria-pressed={days === d} onClick={() => (setDays(d), setMode('older'))} className={cx('h-6 rounded-full border px-2 text-[12px] font-semibold', days === d ? 'border-ink bg-ink text-surface' : 'border-line')}>
                      {text('{n} days', { n: d })}
                    </button>
                  ))}
                </span>
              ) : null}
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2.5">
          <Checkbox checked={action === 'move'} onChange={(e) => setAction(e.target.checked ? 'move' : 'trash')} />
          {text('Move them instead of deleting')}
        </label>
        {action === 'move' ? <Select label={text('Move to')} value={to} options={[{ value: '', label: text('Choose a folder') }, ...targets.map((f) => ({ value: f.slug, label: f.slug.startsWith('label:') ? folderName(f.name) : f.name }))]} onValueChange={(v) => setTo(String(v))} /> : null}
        {mode === 'future' ? <p className="text-[12.5px] text-ink-3">{text('A rule named “Sweep: {sender}” is added to your rules; it runs on the server even when this computer is off.', { sender })}</p> : null}
        {left ? <p role="alert" className="text-[12.5px] font-semibold text-danger">{text('{n} are left. Retry sends just those.', { n: left })}</p> : null}
      </div>
    </Modal>
  );
}
