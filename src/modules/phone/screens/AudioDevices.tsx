import { useEffect, useState } from 'react';
import { call, hasDesktop } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { Button, cx } from '../../../components/ui';
import { runPhone, usePhoneState } from '../softphone/client';

/**
 * Audio device choice and an echo test (VOIP-SP-10, W02 "Audio", D01 headset picker). The echo test dials the
 * switch's own `*43`, which plays back what it hears — the honest way to check a headset and the network together.
 */
export function useAudioDevices(): { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[]; denied: boolean } {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    let gone = false;
    const list = async () => {
      try {
        if (hasDesktop()) {
          const r = await call('media:access', { kind: 'microphone' });
          if (!r.granted) {
            if (!gone) setDenied(true);
            return;
          }
        }
        const all = await navigator.mediaDevices.enumerateDevices();
        if (gone) return;
        setInputs(all.filter((d) => d.kind === 'audioinput'));
        setOutputs(all.filter((d) => d.kind === 'audiooutput'));
      } catch {
        if (!gone) setDenied(true);
      }
    };
    void list();
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    md?.addEventListener?.('devicechange', list);
    return () => {
      gone = true;
      md?.removeEventListener?.('devicechange', list);
    };
  }, []);
  return { inputs, outputs, denied };
}

export function AudioDevices({ dark, compact }: { dark?: boolean; compact?: boolean }) {
  const media = usePhoneState((s) => s.media);
  const registered = usePhoneState((s) => s.phase === 'registered');
  const { inputs, outputs, denied } = useAudioDevices();
  const select = cx('h-9 min-w-0 rounded-[8px] border px-2 text-[12.5px]', dark ? 'border-white/15 bg-white/5 text-white' : 'border-line bg-surface text-ink');
  const label = cx('text-[11.5px] font-semibold', dark ? 'text-white/60' : 'text-ink-3');
  if (denied) {
    return (
      <div className={cx('flex flex-wrap items-center gap-2 text-[12.5px]', dark ? 'text-white/80' : 'text-ink-2')}>
        WorkSuite is not allowed to use the microphone.
        {hasDesktop() ? (
          <Button size="sm" onClick={() => void call('media:privacySettings', { pane: 'microphone' })}>
            Open settings
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className={cx('grid gap-2', compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2')}>
      <label className="flex min-w-0 flex-col gap-1">
        <span className={label}>Microphone</span>
        <select aria-label="Microphone" value={media.mic} onChange={(e) => void runPhone({ cmd: 'media', patch: { mic: e.target.value } })} className={select}>
          <option value="">System default</option>
          {inputs
            .filter((d) => d.deviceId && d.deviceId !== 'default')
            .map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Microphone'}
              </option>
            ))}
        </select>
      </label>
      <label className="flex min-w-0 flex-col gap-1">
        <span className={label}>Speaker or headset</span>
        <select aria-label="Speaker" value={media.speaker} onChange={(e) => void runPhone({ cmd: 'media', patch: { speaker: e.target.value } })} className={select}>
          <option value="">System default</option>
          {outputs
            .filter((d) => d.deviceId && d.deviceId !== 'default')
            .map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Speaker'}
              </option>
            ))}
        </select>
      </label>
      {!compact ? (
        <div className="flex items-center gap-2 sm:col-span-2">
          <Button
            size="sm"
            icon="ear"
            disabled={!registered}
            onClick={() =>
              void runPhone({ cmd: 'dial', number: '*43', name: 'Echo test' }).then((r) => {
                if (!r.ok) toast('error', r.message);
              })
            }
          >
            Echo test
          </Button>
          <span className={cx('text-[11.5px]', dark ? 'text-white/50' : 'text-ink-3')}>Speak after the beep: you should hear yourself back. Hang up to finish.</span>
        </div>
      ) : null}
    </div>
  );
}
