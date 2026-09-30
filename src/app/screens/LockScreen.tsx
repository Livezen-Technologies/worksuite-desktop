import { useEffect, useRef, useState } from 'react';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { t } from '../../core/i18n';
import { useStore } from '../../core/store';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/ui';

/**
 * App lock (UI-20, FR-SEC-04/05, WF-30). Replaces every window's content —
 * nothing of the workspace is rendered behind it — and shows what keeps
 * running in the background.
 */
export function LockScreen() {
  const lock = useStore(app, (s) => s.lock);
  const status = useStore(app, (s) => s.status);
  const [password, setPassword] = useState('');
  // With a PIN set, the lock screen asks for it first; the password stays one click away.
  const [usePin, setUsePin] = useState(!!lock?.pin);
  const pinMode = usePin && !!lock?.pin;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), [pinMode]);

  const unlock = async () => {
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      const r = pinMode ? await call('security:unlockPin', { pin: password }) : await call('security:unlockPassword', { password });
      if (!r.ok) setError(r.message);
      setPassword('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const biometric = async () => {
    const r = await call('security:unlockBiometric').catch((e) => ({ ok: false, message: errorMessage(e) }));
    if (!r.ok && r.message) setError(r.message);
  };
  const reason = lock?.reason === 'timeout' ? `locked after ${lock.lockMinutes} minute${lock.lockMinutes === 1 ? '' : 's'}` : lock?.reason === 'system' ? 'locked with your computer' : 'locked';

  return (
    <div className="drag fixed inset-0 z-[80] flex flex-col items-center justify-center bg-navy text-white">
      <div className="mb-6 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-brand text-[15px] font-extrabold">W</span>
        <span className="text-[17px] font-bold text-navy-ink">WorkSuite</span>
      </div>
      <form
        className="no-drag flex w-[380px] flex-col items-center rounded-[16px] border border-white/10 bg-navy-2 px-8 py-8"
        onSubmit={(e) => {
          e.preventDefault();
          void unlock();
        }}
      >
        <Avatar name={lock?.userName} size={64} className="!bg-[#EEF1FD] !text-[#23349E]" />
        <h1 className="mt-4 text-[22px] font-bold">{t('lock.title')}</h1>
        <p className="mt-1 text-[13px] text-navy-ink/80">
          {lock?.userName ?? ''} · {reason}
        </p>
        <label className="mt-6 w-full text-[12.5px] font-semibold text-navy-ink">
          {pinMode ? t('lock.pin') : t('lock.password')}
          {pinMode ? (
            <input
              key="pin"
              ref={input}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value.replace(/\D/g, ''))}
              className="mt-1.5 h-11 w-full rounded-[9px] border border-white/15 bg-navy px-3 text-center text-[20px] tracking-[0.5em] text-white outline-none focus:border-brand"
            />
          ) : (
            <input
              key="password"
              ref={input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-[9px] border border-white/15 bg-navy px-3 text-[14px] text-white outline-none focus:border-brand"
            />
          )}
        </label>
        {error ? <p className="mt-2 w-full text-[12.5px] text-[#F7A39C]">{error}</p> : null}
        <button type="submit" disabled={busy || (pinMode ? password.length < 4 : !password)} className="mt-4 h-11 w-full rounded-[9px] bg-brand text-[14px] font-semibold hover:opacity-90 disabled:opacity-50">
          {busy ? 'Checking…' : t('lock.unlock')}
        </button>
        {lock?.biometric === 'touch-id' ? (
          <button type="button" onClick={() => void biometric()} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-[9px] border border-white/15 text-[14px] font-semibold hover:bg-white/5">
            <Icon name="fingerprint" size={18} /> {t('lock.touchId')}
          </button>
        ) : null}
        {lock?.pin ? (
          <button
            type="button"
            onClick={() => {
              setUsePin(!pinMode);
              setPassword('');
              setError(null);
            }}
            className="mt-4 text-[13px] font-semibold text-navy-ink hover:text-white"
          >
            {pinMode ? t('lock.usePassword') : t('lock.usePin')}
          </button>
        ) : null}
        <button type="button" onClick={() => void call('auth:signOut', { wipe: false })} className="mt-4 text-[13px] font-semibold text-navy-ink underline hover:text-white">
          {t('lock.signOut')}
        </button>
      </form>
      <div className="mt-6 flex gap-5 text-[12.5px] text-navy-ink/80">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#43B581]" /> Notifications running (content hidden)
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${status?.network === 'OFFLINE' ? 'bg-[#8A90A2]' : 'bg-[#43B581]'}`} /> Background services running
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#8A90A2]" /> No work session is being monitored
        </span>
      </div>
    </div>
  );
}
