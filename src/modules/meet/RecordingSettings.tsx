import { useState } from 'react';
import { useStore } from '../../core/store';
import { app, updatePrefs } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { Button, cx } from '../../components/ui';
import type { MeetRecordingPrefs } from '@shared/types';
import { RadioCards } from '../../components/SettingsKit';

/**
 * Settings › Meet › Recording (worksuite-desktop#68), also offered inside a meeting: how this computer records —
 * on the server, or here and uploaded in the background — the quality and layout, the Drive folder recordings go
 * to, where a local recording is written, and how long its local copy is kept once Drive has it.
 */
export function RecordingSettings({ compact }: { compact?: boolean }) {
  const prefs = useStore(app, (s) => s.prefs?.meetRecording);
  const [folder, setFolder] = useState<string | null>(null);
  if (!prefs) return null;
  const save = (patch: Partial<MeetRecordingPrefs>) => void updatePrefs({ meetRecording: { ...prefs, ...patch } }).catch((e) => toast('error', errorMessage(e)));
  const choose = async () => {
    try {
      const picked = await call('meetrec:chooseFolder');
      if (picked) toast('success', 'Recordings on this computer go there from now.');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const field = 'h-9 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink';
  const label = 'flex flex-col gap-1 text-[12.5px] font-semibold text-ink';
  const driveFolder = folder ?? prefs.folder;
  return (
    <div className={cx('flex flex-col gap-3.5', compact ? 'text-[12.5px]' : 'text-[13px]')}>
      <RadioCards<MeetRecordingPrefs['method']>
        label="How meetings are recorded"
        columns={2}
        value={prefs.method}
        onChange={(method) => save({ method })}
        options={[
          { value: 'cloud', label: 'On the WorkSuite server', description: 'The server records the meeting. Nothing runs on this computer.', icon: 'cloud' },
          { value: 'local', label: 'On this computer', description: 'Recorded here, then uploaded to your Drive in the background — you can keep working or leave the meeting.', icon: 'monitor' },
        ]}
      />
      <div className="grid grid-cols-2 gap-2.5">
        <label className={label}>
          Quality
          <Select<MeetRecordingPrefs['quality']> value={prefs.quality} options={[{ value: '720p', label: 'HD 720p — about 1 GB an hour' }, { value: '1080p', label: 'Full HD 1080p — about 2 GB an hour' }]} onValueChange={(quality) => save({ quality })} className={field} />
        </label>
        <label className={label}>
          Layout
          <Select<MeetRecordingPrefs['layout']>
            value={prefs.layout}
            options={[
              { value: 'grid', label: 'Everyone in a grid' },
              { value: 'speaker', label: 'The person speaking, large' },
              { value: 'screen', label: 'A shared screen, large' },
            ]}
            onValueChange={(layout) => save({ layout })}
            className={field}
          />
        </label>
      </div>
      <label className={label}>
        <span>
          Drive folder <span className="font-normal text-ink-3">In your Drive. Recordings are shared with nobody until you share them.</span>
        </span>
        <input value={driveFolder} maxLength={120} onChange={(e) => setFolder(e.target.value.replace(/[\\/]/g, ''))} onBlur={() => (driveFolder.trim() && driveFolder !== prefs.folder ? save({ folder: driveFolder.trim() }) : setFolder(null))} className={field} />
      </label>
      {prefs.method === 'local' ? (
        <>
          <div className={label}>
            Saved on this computer in
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate rounded-[8px] border border-line bg-subtle px-2.5 py-2 font-normal text-ink-2 selectable" title={prefs.localFolder}>
                {prefs.localFolder}
              </span>
              <Button onClick={() => void choose()}>Choose…</Button>
            </span>
          </div>
          <label className={label}>
            Once it is in Drive, the copy on this computer is
            <Select<MeetRecordingPrefs['keepLocal']>
              value={prefs.keepLocal}
              options={[
                { value: 'delete', label: 'Deleted straight away' },
                { value: '7', label: 'Kept for 7 days' },
                { value: '30', label: 'Kept for 30 days' },
                { value: 'keep', label: 'Kept' },
              ]}
              onValueChange={(keepLocal) => save({ keepLocal })}
              className={field}
            />
          </label>
          <p className="rounded-[9px] bg-subtle px-3 py-2 text-[12px] text-ink-2">
            The recording is saved as it goes, so nothing is lost if WorkSuite closes. Finishing and uploading continue after you leave the meeting or close its window; quitting WorkSuite pauses them, and they carry on from where they were when you open it again. The copy here is only deleted after WorkSuite has checked the one in Drive.
          </p>
        </>
      ) : null}
    </div>
  );
}
