import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { RingTestStep } from '@shared/types';
import { call, errorMessage, isMac } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, cx } from '../../components/ui';
import { SettingRowFrame } from '../../components/SettingsKit';
import { playTone, type RingOn } from '../calls/tones';

/**
 * Whether this computer can show WorkSuite's notifications, said plainly where it can be told (worksuite-desktop#251):
 * Electron cannot read the operating system's per-app permission, so this is the system refusing the last one (macOS
 * and Windows say so) or not supporting them at all. "Open System Settings" goes to the system's own page.
 */
export function NotificationsOffBanner() {
  const q = useQuery({ queryKey: ['notifications', 'permission'], queryFn: () => call('notifications:permission'), refetchInterval: 60_000, retry: false });
  const s = q.data;
  if (!s || s.state === 'unknown') return null;
  const open = () =>
    void call('notifications:openSettings')
      .then((ok) => !ok && toast('info', 'Open your desktop’s notification settings and allow WorkSuite.'))
      .catch((e) => toast('error', errorMessage(e)));
  return (
    <div role="alert" data-notifications-off className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[12px] border border-danger/30 bg-danger-bg px-4 py-3 text-[13px] text-danger">
      <Icon name="bell-off" size={18} className="shrink-0" />
      <b className="font-semibold">{s.state === 'unsupported' ? 'This computer cannot show notifications' : 'Desktop notifications are off for WorkSuite'}</b>
      <span aria-hidden>·</span>
      <button type="button" onClick={open} className="font-semibold underline underline-offset-2">
        {isMac ? 'Open System Settings' : 'Open notification settings'}
      </button>
      <span className="basis-full text-[12px] text-ink-2">New website chats still ring in the call window, but no notification appears while WorkSuite is in the background.</span>
    </div>
  );
}

/** The sound step (#251): whether this window can play the ring at all, and then it plays it. */
export async function soundStep(volume: number, muted: boolean, opts: { ringtone?: string | null; ringOn?: RingOn } = {}): Promise<RingTestStep> {
  const label = 'Sound played';
  if (muted) return { id: 'sound', label, state: 'fail', detail: 'Notification sounds are off in Settings › Notifications & calls.' };
  if (volume <= 0) return { id: 'sound', label, state: 'fail', detail: 'The ringing volume is at 0. Turn it up above.' };
  let running = false;
  try {
    const ctx = new AudioContext();
    await ctx.resume();
    running = ctx.state === 'running';
    void ctx.close();
  } catch {
    running = false;
  }
  if (!running) return { id: 'sound', label, state: 'fail', detail: 'This computer would not start the sound. Check its sound output.' };
  const tone = playTone('webchat', volume / 100, opts);
  setTimeout(() => tone.stop(), 2_500);
  return { id: 'sound', label, state: 'ok', detail: 'The ringtone played on this computer. If you heard nothing, check its volume and output.' };
}

const MARK: Record<RingTestStep['state'], { icon: string; className: string; said: string }> = {
  ok: { icon: 'check', className: 'text-success', said: 'Done' },
  warn: { icon: 'warning', className: 'text-warning', said: 'Partly' },
  fail: { icon: 'x', className: 'text-danger', said: 'Failed' },
  pending: { icon: 'clock', className: 'text-ink-3', said: 'Waiting' },
};

const PENDING: RingTestStep[] = [
  { id: 'routed', label: 'Routed to you', state: 'pending', detail: null },
  { id: 'received', label: 'Received by this computer', state: 'pending', detail: null },
  { id: 'notification', label: 'Desktop notification shown', state: 'pending', detail: null },
  { id: 'sound', label: 'Sound played', state: 'pending', detail: null },
];

/**
 * "Send a test chat notification" (worksuite-desktop#251): a test ring to my own devices — no conversation, nobody
 * else hears it — and each step it took: routed to you ✓ · received by this computer ✓ · desktop notification
 * shown ✓ · sound played ✓, with what to do about any that did not.
 */
export function TestChatNotification({ volume, muted, ringtone, ringOn }: { volume: number; muted: boolean; ringtone?: string | null; ringOn?: RingOn }) {
  const qc = useQueryClient();
  const [steps, setSteps] = useState<RingTestStep[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setSteps(PENDING);
    try {
      const three = await call('ring:test');
      setSteps([...three, PENDING[3]!]);
      const sound = await soundStep(volume, muted, { ringtone, ringOn });
      setSteps([...three, sound]);
    } catch (e) {
      setSteps([{ ...PENDING[0]!, state: 'fail', detail: errorMessage(e) }, ...PENDING.slice(1)]);
    } finally {
      setBusy(false);
      // A refused notification is remembered: the banner above says so now.
      void qc.invalidateQueries({ queryKey: ['notifications', 'permission'] });
    }
  };
  return (
    <SettingRowFrame className="flex flex-col gap-2" data-testid="ring-test">
      <div className="flex flex-wrap items-center gap-3">
        <Button icon="bell" onClick={() => void run()} disabled={busy}>
          {busy ? 'Testing…' : 'Send a test chat notification'}
        </Button>
        <span className="text-[12px] text-ink-3">Only you get it. No chat is made.</span>
      </div>
      {steps ? (
        <ol aria-label="Test chat notification" className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-subtle px-3 py-2.5">
          {steps.map((s) => (
            <li key={s.id} data-step={s.id} data-state={s.state} className="flex items-start gap-2 text-[13px]">
              <Icon name={MARK[s.state].icon} size={15} className={cx('mt-px shrink-0', MARK[s.state].className)} label={MARK[s.state].said} />
              <span className="min-w-0">
                <b className="font-semibold text-ink">{s.label}</b>
                {s.detail ? <span className="block text-[12px] text-ink-2">{s.detail}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </SettingRowFrame>
  );
}
