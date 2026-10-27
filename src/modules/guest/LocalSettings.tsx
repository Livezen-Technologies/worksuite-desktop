import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { RestorePreview } from '@shared/local-workspace';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { setLocalProfile } from '../../core/session';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Button, TextField } from '../../components/ui';
import { LocalProfileForm } from './LocalProfileForms';
import { SectionHeader, SettingsGroup } from '../../components/SettingsKit';

/** Settings › Profile in guest mode (#149): the Local Profile's name, picture and PIN. */
export function LocalProfileSection() {
  const profile = useStore(app, (s) => s.local?.profile ?? null);
  if (!profile) return null;
  return (
    <LocalProfileForm
      profile={profile}
      onSaved={(next) => {
        setLocalProfile(next);
        toast('success', text('Profile saved on this device.'));
      }}
    />
  );
}

/** Settings › Backup & data in guest mode (#149): what is saved, export, restore with a preview, and deleting it all. */
export function LocalDataSection() {
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ['local', 'overview'], queryFn: () => call('local:overview') });
  const [restore, setRestore] = useState<RestorePreview | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const o = overview.data;
  return (
    <section className="flex flex-col text-[13.5px] text-ink-2">
      <SectionHeader title="Backup & data" hint="Your Local Profile is saved in this device's WorkSuite profile and is never uploaded automatically. Anyone using this device profile can reach it unless it has a PIN." />
      <SettingsGroup title="Backup">
      <div className="flex flex-col gap-4 px-[18px] py-3.5">
      {o ? <p className="font-semibold text-ink">{text('{notes} notes, {tasks} tasks, {contacts} contacts and {events} events on this device.', { notes: o.notes, tasks: o.tasks, contacts: o.contacts, events: o.events })}</p> : null}
      <p>Export a readable JSON backup before changing devices, and keep it in a private place. Backups hold your notes, tasks, contacts, events and profile name, never the PIN. Restoring adds what is new and skips identical items; it never overwrites.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon="download" disabled={busy} onClick={() => void act(async () => { if ((await call('local:export')).saved) toast('success', text('Backup exported. Keep it in a private location.')); })}>
          Export backup
        </Button>
        <Button disabled={busy} onClick={() => void act(async () => setRestore(await call('local:restorePreview')))}>
          Restore backup…
        </Button>
      </div>
      {restore ? (
        <div className="rounded-[10px] border border-line bg-surface p-3" role="group" aria-label={text('Restore preview')}>
          <p className="font-semibold text-ink">{text('This backup adds {notes} notes, {tasks} tasks, {contacts} contacts and {events} events.', { notes: restore.notes, tasks: restore.tasks, contacts: restore.contacts, events: restore.events })}</p>
          <p className="text-[13px]">
            {text('{count} identical items are already here and will be skipped. Nothing is overwritten.', { count: restore.duplicates })}
            {restore.profileName ? text(' Backup profile: {name}.', { name: restore.profileName }) : ''}
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void act(async () => {
              const r = await call('local:restore', { token: restore.token });
              setRestore(null);
              void qc.invalidateQueries();
              toast('success', text('Restored {added} items; skipped {skipped} duplicates.', { added: r.added, skipped: r.skipped }));
            })}>
              Restore these items
            </Button>
            <Button variant="ghost" onClick={() => setRestore(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      </div>
      </SettingsGroup>
      <SettingsGroup title="Delete local data" description="Deleting removes your Local Profile, its PIN and every local note, task, contact and event from this device.">
      <div className="flex flex-col gap-2 px-[18px] py-3.5">
        <TextField label="Type DELETE LOCAL DATA to delete everything" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <div>
          <Button variant="danger" disabled={confirm !== 'DELETE LOCAL DATA' || busy} onClick={() => void act(async () => {
            await call('local:deleteAll', { confirmation: 'DELETE LOCAL DATA' });
            qc.clear();
            app.set({ local: { language: app.get().local?.language ?? 'en', profile: null, locked: false } });
          })}>
            Delete all local data
          </Button>
        </div>
      </div>
      </SettingsGroup>
    </section>
  );
}
