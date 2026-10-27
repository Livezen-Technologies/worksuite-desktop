import type { Preferences } from '@shared/types';
import { useTab } from '../../../core/tab-context';
import { updatePrefs } from '../../../core/app-state';
import { Switch, cx, Button, Spinner } from '../../../components/ui';
import { Select } from '../../../components/Select';
import { useQuery } from '@tanstack/react-query';
import { call } from '../../../core/bridge';
import { permissionsMissing, permissionLabel } from '@shared/meet-permissions';
import { RecordingSettings } from '../../meet/RecordingSettings';
import { LivestreamDestinations } from '../../meet/Livestreaming';
import { SpeechModelSettings } from '../../meet/SpeechModel';
import { Row, H } from './parts';

/** Settings › Meet: behaviour and permissions. */

/** Settings › Meet (worksuite-desktop#68): how meetings are recorded from this computer. */
/**
 * Settings › Meet › Behaviour and System permissions (WS-MEET-ENH-01 D05).
 *
 * Three of the six switches that artboard draws are deliberately not here,
 * because WorkSuite already has them and two settings for one thing is how
 * they come to disagree: **hardware acceleration** is in General, and
 * **opening WorkSuite links in the app** — meetings among them — is in Links.
 * Each is named below with where it lives, rather than left to be hunted for.
 */
function MeetBehaviour({ prefs }: { prefs: Preferences }) {
  const { navigate } = useTab();
  const b = prefs.meetBehaviour;
  const set = (patch: Partial<Preferences['meetBehaviour']>) => void updatePrefs({ meetBehaviour: { ...b, ...patch } });

  return (
    <>
      <Row label="Pop out the call when I switch apps" hint="Shrinks the meeting to a small window that floats over whatever you move to, and puts it back when you come back.">
        <Switch label="Pop out the call when I switch apps" checked={b.popOutOnSwitch} onChange={(v) => set({ popOutOnSwitch: v })} />
      </Row>
      <Row label="Global mute and camera shortcuts" hint="Work even when WorkSuite is in the background. Off, the keys still work while a WorkSuite window is in front.">
        <Switch label="Global mute and camera shortcuts" checked={b.globalKeys} onChange={(v) => set({ globalKeys: v })} />
      </Row>
      <Row label="Share computer sound when presenting" hint="Includes audio from videos you play. The share picker can still change it for one share.">
        <Switch label="Share computer sound when presenting" checked={b.shareComputerSound} onChange={(v) => set({ shareComputerSound: v })} />
      </Row>
      <Row label="Video quality on battery" hint="Lower resolution to save power. Auto follows the connection, as it does on mains.">
        <Select
          label="Video quality on battery"
          value={b.qualityOnBattery}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: '720p', label: '720p' },
            { value: '360p', label: '360p' },
          ]}
          onValueChange={(v) => set({ qualityOnBattery: v as Preferences['meetBehaviour']['qualityOnBattery'] })}
        />
      </Row>
      <p className="mt-2 text-[12px] text-ink-3">
        <button type="button" className="font-semibold text-primary hover:underline" onClick={() => navigate('/settings?section=general')}>
          Hardware acceleration
        </button>{' '}
        is in General, and{' '}
        <button type="button" className="font-semibold text-primary hover:underline" onClick={() => navigate('/settings?section=links')}>
          opening meeting links here instead of the browser
        </button>{' '}
        is in Links — both apply to the whole app, so they are kept in one place.
      </p>
    </>
  );
}

/**
 * What the operating system lets a meeting do (D05).
 *
 * Read, never asked for: opening a settings page must not pop an OS prompt,
 * and on macOS the asking happens once per app, so a page that asked would
 * spend the one chance there is. Each row that can be granted somewhere opens
 * that pane instead.
 */
function MeetPermissions() {
  const q = useQuery({
    queryKey: ['meet-permissions'],
    queryFn: () => call('media:permissions'),
    refetchOnWindowFocus: true,
    staleTime: 2_000,
  });
  const rows = q.data?.rows ?? [];
  const missing = permissionsMissing(rows);

  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[14px] font-bold text-ink">System permissions</h3>
        {rows.length ? (
          <span className={cx('rounded-[5px] px-1.5 py-px text-[11.5px] font-semibold', missing ? 'bg-warning-bg text-warning' : 'bg-success-bg text-success')}>
            {missing === 0 ? 'All allowed' : missing === 1 ? '1 permission missing' : `${missing} permissions missing`}
          </span>
        ) : null}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => void q.refetch()}>
          Check again
        </Button>
      </div>
      {q.isLoading ? <Spinner /> : null}
      {rows.map((r) => (
        <Row key={r.id} label={r.label} hint={r.detail || undefined}>
          <div className="flex items-center gap-2">
            <span
              className={cx(
                'rounded-[5px] px-1.5 py-px text-[11.5px] font-semibold',
                r.state === 'granted' ? 'bg-success-bg text-success' : r.state === 'denied' ? 'bg-warning-bg text-warning' : 'bg-surface-2 text-ink-3',
              )}
            >
              {permissionLabel(r.state)}
            </span>
            {r.pane && r.state !== 'granted' ? (
              <Button size="sm" variant="ghost" onClick={() => void call('media:privacySettings', { pane: r.pane! }).catch(() => undefined)}>
                Open System Settings
              </Button>
            ) : null}
          </div>
        </Row>
      ))}
      {rows.some((r) => r.id === 'accessibility' && r.state !== 'granted') ? (
        <p className="mt-2 text-[12px] text-ink-3">Remote control also follows your organisation’s Meet policy, and Settings › Remote control checks it in full.</p>
      ) : null}
    </>
  );
}

export function MeetSection({ prefs }: { prefs: Preferences }) {
  return (
    <>
      <H title="Meet" hint="Meetings on this computer." />
      <h3 className="mt-2 mb-3 text-[14px] font-bold text-ink">Behaviour</h3>
      <MeetBehaviour prefs={prefs} />
      <h3 className="mt-6 mb-3 text-[14px] font-bold text-ink">Recording</h3>
      <RecordingSettings />
      <h3 className="mt-6 mb-3 text-[14px] font-bold text-ink">Livestreaming</h3>
      <LivestreamDestinations />
      <h3 className="mt-6 mb-3 text-[14px] font-bold text-ink">Transcription</h3>
      <SpeechModelSettings />
      <div className="mt-6" />
      <MeetPermissions />
    </>
  );
}
