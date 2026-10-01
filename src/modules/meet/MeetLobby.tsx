import { useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { timeLabel } from '../../core/time';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { DeviceSettings, Preview, useMeetDevices } from './devices';
import { useMeetT } from './i18n';
import { meet } from './session';
import { useTab } from '../../core/tab-context';

/**
 * Ready to join? (worksuite-desktop#69): the camera's picture on the left with the microphone and camera switches,
 * the devices grouped under it (with the microphone's level and Test speaker); the meeting on the right — its title,
 * organizer, who is in it, whether you host — and Join now. What is chosen here is remembered on this computer and
 * used when joining; joining shows its progress and cannot be sent twice.
 */
export function MeetLobby() {
  const t = useMeetT();
  const info = meet.info!;
  const name = useStore(app, (s) => s.auth?.user?.name ?? '');
  const waiting = meet.phase === 'waiting';
  const joining = meet.phase === 'joining';
  // The devices are let go while joining, so the meeting can take them.
  // Joining from an accepted invitation (`?quiet=1`, worksuite-desktop#79): nothing switches on by itself.
  const quiet = useTab().query.get('quiet') === '1';
  const d = useMeetDevices(!waiting && !joining, { camAllowed: info.mode !== 'audio', startOff: quiet });
  const [passcode, setPasscode] = useState('');
  const [sent, setSent] = useState(false);
  const others = info.joined_count;
  const busy = joining || sent;
  const blocked = busy || waiting || (info.needs_passcode && !passcode.trim());

  const join = () => {
    if (blocked) return;
    setSent(true);
    void meet
      .join({ mic: d.prefs.mic, cam: d.prefs.cam, micId: d.prefs.micId || undefined, camId: d.prefs.camId || undefined, speakerId: d.prefs.speakerId || undefined, passcode: passcode.trim() || undefined })
      .finally(() => setSent(false));
  };

  return (
    <div className="h-full overflow-y-auto bg-ground scroll-thin">
      <div className="mx-auto grid min-h-full max-w-[1180px] items-center gap-6 px-5 py-6 text-[13px] sm:px-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,1fr)] lg:gap-10">
        <div className="flex min-w-0 flex-col gap-3">
          <Preview d={d} name={name} />
          <DeviceSettings d={d} />
        </div>

        <form
          className="flex min-w-0 flex-col gap-3 lg:border-s lg:border-line lg:ps-10"
          onSubmit={(e) => {
            e.preventDefault();
            join();
          }}
        >
          <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-selection text-primary">
            <Icon name="video" size={24} />
          </span>
          <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.4px] text-ink">{waiting ? t('lobby.asking') : t('lobby.ready')}</h1>
          <div className="flex flex-col gap-1">
            <b className="text-[17px] text-ink">{info.title || 'Meeting'}</b>
            {info.host_name ? <span className="text-ink-2">{t('lobby.organizedBy', { name: info.host_name })}</span> : null}
            {info.scheduled_at ? <span className="text-[12.5px] text-ink-3">{t('lobby.scheduled', { time: timeLabel(info.scheduled_at) })}</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {info.is_host ? <span className="rounded-full border border-primary px-2.5 py-0.5 text-[12px] font-semibold text-primary">{t('lobby.host')}</span> : null}
            <span className="flex items-center gap-1.5 text-ink-2">
              <Icon name="users" size={14} className="text-ink-3" />
              {others <= 0 ? t('lobby.first') : others === 1 ? t('lobby.other') : t('lobby.others', { n: others })}
            </span>
          </div>

          <label className="mt-1 flex flex-col gap-1.5 font-semibold text-ink">
            {t('lobby.yourName')}
            <input value={name} readOnly aria-describedby="meet-name-note" className="h-11 rounded-[10px] border border-line bg-subtle px-3 text-[14px] font-medium text-ink" />
            <span id="meet-name-note" className="text-[11.5px] font-normal text-ink-3">{t('lobby.nameFromAccount')}</span>
          </label>
          {info.needs_passcode ? (
            <label className="flex flex-col gap-1.5 font-semibold text-ink">
              {t('lobby.passcode')}
              <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoFocus disabled={busy || waiting} className="h-11 rounded-[10px] border border-line bg-surface px-3 text-ink outline-none focus:border-primary" />
            </label>
          ) : null}

          {waiting ? (
            <div role="status" className="flex items-center gap-2 rounded-[10px] border border-[#F1D9B5] bg-[#FFF9EC] px-3.5 py-3 font-semibold text-[#7A3B05] dark:border-transparent dark:bg-warning-bg dark:text-warning">
              <Icon name="spinner" size={15} className="animate-spin" /> {meet.door === 'no_host' ? t('lobby.waitingForHost') : t('lobby.waiting')}
            </div>
          ) : null}
          {meet.error && !busy ? (
            <div role="alert" className="flex items-start gap-2 rounded-[10px] bg-danger-bg px-3.5 py-2.5 text-danger">
              <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1">{meet.error}</span>
              {!info.needs_passcode ? (
                <button type="submit" className="shrink-0 font-bold underline">
                  {t('lobby.retry')}
                </button>
              ) : null}
            </div>
          ) : null}

          {waiting ? (
            <button type="button" onClick={() => void meet.leave()} className="h-12 rounded-[12px] border border-line bg-surface text-[14.5px] font-bold text-ink hover:bg-subtle">
              {t('lobby.cancel')}
            </button>
          ) : (
            <button type="submit" disabled={blocked} aria-busy={busy} className={cx('flex h-12 items-center justify-center gap-2 rounded-[12px] bg-primary text-[15px] font-bold text-white hover:bg-primary-hover', blocked && 'opacity-70')}>
              {busy ? <Icon name="spinner" size={17} className="animate-spin" /> : null}
              {busy ? t('lobby.joining') : info.is_host ? t('lobby.joinNow') : t('lobby.askToJoin')}
              {!busy ? <Icon name="arrow-right" size={17} /> : null}
            </button>
          )}
          <span className="text-[12px] text-ink-3">{t('lobby.settingsUsed')} {info.is_host ? t('lobby.hostNote') : t('lobby.guestNote')}</span>
          {info.is_host ? (
            <span className="mt-1 flex items-center justify-center gap-1.5 border-t border-line pt-3 text-[12.5px] text-primary">
              <Icon name="link" size={14} /> {t('lobby.inviteAfter')}
            </span>
          ) : null}
        </form>
      </div>
    </div>
  );
}
