import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ApiError } from '../../../../core/api';
import { call, errorMessage } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { toast } from '../../../../core/toasts';
import { Select } from '../../../../components/Select';
import { Empty, ErrorNote, Spinner, Switch } from '../../../../components/ui';
import { Note, Pill, SettingRow } from '../../../account/parts';
import { VOICE_OFFERS, callSettingsOf, changedFields, saveCallSettings, waitOptions, type CallSettings, type CallSettingsPayload } from './callSettings';
import { Group, SaveBar } from './parts';

/**
 * Widget settings › Live status & calls (V-05, VOICE-UI-04), a tab of the desktop's widget settings beside the design
 * (#199): WHAT THE VISITOR SEES — the team's typing and Delivered / Read on the visitor's messages (LIVE-09, LIVE-10) —
 * and VOICE CALLS — letting visitors call, when the button shows, when a call back is offered, who can take calls
 * and recording (VOICE-01, VOICE-04, VOICE-11, VOICE-20…22).
 *
 * Saving sends only what was changed (`PUT widgets/{id}/calls`). Recording is shown as Off and cannot be turned on:
 * nothing records yet (VOICE-22), and a visitor must never be promised a notice nobody gives.
 */
export function LiveStatusCalls({ id, onManageStaff }: { id: number; onManageStaff?: () => void }) {
  const qc = useQueryClient();
  const key = ['website', 'widget-calls', id];
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => callSettingsOf(id, signal), retry: false });
  const [draft, setDraft] = useState<CallSettings | null>(null);
  const [busy, setBusy] = useState(false);

  if (q.isLoading) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  if (q.error instanceof ApiError && q.error.status === 404) {
    return <div className="flex flex-1"><Empty icon="phone" title="Not on this server yet" hint="Update WorkSuite's Communication module to set live status and calls here." /></div>;
  }
  if (q.error || !q.data) return <div className="flex-1 p-6"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div>;

  const p = q.data;
  const saved = p.settings;
  const s = draft ?? saved;
  const changes = changedFields(saved, s);
  const dirty = Object.keys(changes).length > 0;
  const can = p.can_manage;
  const set = <K extends keyof CallSettings>(k: K, v: CallSettings[K]) => setDraft((d) => ({ ...(d ?? saved), [k]: v }));

  const save = async () => {
    if (!dirty) return;
    setBusy(true);
    try {
      const fresh = await saveCallSettings(id, changes);
      qc.setQueryData<CallSettingsPayload>(key, fresh);
      setDraft(null);
      toast('success', text('Widget saved — visitors see it on their next page'));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const people = p.takers.people;

  return (
    <form
      aria-label="Live status and calls"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex min-w-[360px] flex-1 flex-col gap-4 overflow-y-auto px-6 py-5 scroll-thin"
    >
      {!can ? <Note tone="indigo">You can look at these settings. Changing them needs the “Create and configure chat widgets” permission.</Note> : null}
      <fieldset disabled={!can || busy} className="flex max-w-[860px] flex-col gap-4">
        <Group title="What the visitor sees">
          {!p.installed.live_status ? <Note tone="amber" className="my-2">The server has not been updated for live status yet: visitors see typing and read receipts, and they cannot be turned off.</Note> : null}
          <SwitchRow label="Show when staff are typing" hint="“Nuwan is typing…” in the widget." checked={s.show_typing_to_visitor} disabled={!p.installed.live_status} onChange={(v) => set('show_typing_to_visitor', v)} />
          <SwitchRow label="Show delivered and read to the visitor" hint="“Read by Nuwan”. Staff always see the visitor's status." checked={s.show_receipts_to_visitor} disabled={!p.installed.live_status} onChange={(v) => set('show_receipts_to_visitor', v)} />
        </Group>

        <Group title="Voice calls">
          {!p.installed.voice ? <Note tone="amber" className="my-2">The server has not been updated for voice calls yet.</Note> : null}
          {p.installed.voice && s.voice_enabled && !p.media_ready ? (
            <Note tone="amber" className="my-2">The voice server is not set up on WorkSuite yet, so visitors do not see the call button. Ask whoever runs your WorkSuite server to set it up.</Note>
          ) : null}
          <SwitchRow label="Let visitors call from the widget" hint="Audio only, in the browser. Off until you turn it on." checked={s.voice_enabled} disabled={!p.installed.voice} onChange={(v) => set('voice_enabled', v)} />
          <SettingRow label="Show the call button">
            <Select aria-label="Show the call button" className="w-[340px]" disabled={!p.installed.voice} value={s.voice_offer} onValueChange={(v) => set('voice_offer', v)} options={VOICE_OFFERS} />
          </SettingRow>
          <SettingRow label="Offer a call back after" hint="Nobody has picked up by then: the visitor can ask for a call back or keep chatting.">
            <Select aria-label="Offer a call back after" className="w-[150px]" disabled={!p.installed.voice} value={s.voice_max_wait_seconds} onValueChange={(v) => set('voice_max_wait_seconds', v)} options={waitOptions(s.voice_max_wait_seconds)} />
          </SettingRow>
          <SettingRow
            label="Who can take calls"
            hint={
              <>
                {p.takers.assigned ? 'This widget\'s staff with “Take website voice calls”.' : 'Nobody is assigned to this widget, so everybody covering it with “Take website voice calls”.'}
                <TakersLine people={people} />
              </>
            }
          >
            {/* The editor's own Staff tab (S-04); on its own, this page still sends people to the web. */}
            <button type="button" onClick={onManageStaff ?? (() => void call('app:openInBrowser', { path: '/website-chats?tab=widgets' }))} title={onManageStaff ? undefined : 'Opens on the web'} className="text-[13px] font-bold text-primary hover:underline disabled:opacity-60">
              Manage staff
            </button>
          </SettingRow>
          <SettingRow label="Record calls" hint={<>When on, the visitor is told first and sees a Recording badge. <span className="text-ink-2">Recording is not available yet.</span></>}>
            <Select
              aria-label="Record calls"
              className="w-[190px]"
              disabled={!p.recording_available}
              value={s.voice_record ? 'on' : 'off'}
              onValueChange={(v) => set('voice_record', v === 'on')}
              options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On, with notice', disabled: !p.recording_available }]}
            />
          </SettingRow>
        </Group>
      </fieldset>
      <SaveBar can={can} busy={busy} dirty={dirty} undoLabel="Cancel" onUndo={() => setDraft(null)} />
    </form>
  );
}

function SwitchRow({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  const hid = useId();
  return (
    <SettingRow label={label} hint={<span id={hid}>{hint}</span>}>
      <Switch label={label} describedBy={hid} checked={checked} disabled={disabled} onChange={onChange} />
    </SettingRow>
  );
}

/** Who those are, and who could be rung now; or that nobody can, which leaves the call button hidden (VOICE-11). */
function TakersLine({ people }: { people: CallSettingsPayload['takers']['people'] }) {
  if (!people.length) {
    return <span className="mt-1 block text-warning">Nobody can take calls yet, so the call button stays hidden. Give someone “Take website voice calls” in Roles.</span>;
  }
  return (
    <span role="group" aria-label="People who take calls" className="mt-1.5 flex flex-wrap gap-1.5">
      {people.map((m) => (
        <Pill key={m.user_id} tone={m.available ? 'green' : 'grey'} dot={m.available ? '#1F7A4D' : undefined}>
          {m.available ? text('{name} · available now', { name: m.name }) : m.name}
        </Pill>
      ))}
    </span>
  );
}
