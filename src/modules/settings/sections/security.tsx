import type { Preferences } from '@shared/types';
import { useTab } from '../../../core/tab-context';
import { isLocked, app, updatePrefs } from '../../../core/app-state';
import { useStore } from '../../../core/store';
import { useState } from 'react';
import { Switch, Button, Modal, TextField, Chip } from '../../../components/ui';
import { call, errorMessage } from '../../../core/bridge';
import { Select } from '../../../components/Select';
import { CustomTimeoutRow, MAX_LOCK_MINUTES } from '../CustomTimeout';
import { toast } from '../../../core/toasts';
import { useQuery } from '@tanstack/react-query';
import { relative } from '../../../core/time';
import { H, Row, Toggle } from './parts';

/** Settings › Security: the lock, its PIN and this person's devices. */

export function SecuritySection({ prefs }: { prefs: Preferences }) {
  const { navigate } = useTab();
  const lock = isLocked('appLockMinutes');
  const enabled = prefs.appLockEnabled === true;
  const lockState = useStore(app, (s) => s.lock);
  const max = useStore(app, (s) => s.bootstrap?.policy.app_lock_max_minutes ?? 0);
  const [verify, setVerify] = useState<'disable' | null>(null);
  const [custom, setCustom] = useState(![0, 1, 5, 15, 30].includes(prefs.appLockMinutes));
  const options = [0, 1, 5, 15, 30].filter((m) => !max || m <= max).map((m) => ({ value: String(m), label: m === 0 ? 'Immediately' : `${m} minute${m === 1 ? '' : 's'}` }));
  options.push({ value: 'custom', label: 'Custom' });
  return (
    <>
      <H
        title="Security → Lock Screen"
        hint="WorkSuite’s app lock protects its windows. These controls do not change or bypass your operating system’s lock screen. Preferences are saved for your account on this device."
      />
      <Row label="Enable Lock Screen" lock={isLocked('appLockEnabled')}>
        <Switch
          label="Enable Lock Screen"
          checked={enabled}
          disabled={!!isLocked('appLockEnabled')}
          onChange={(v) => (v ? void updatePrefs({ appLockEnabled: true }) : setVerify('disable'))}
        />
      </Row>
      {verify ? (
        <VerifyLockChange
          title="Disable Lock Screen"
          onClose={() => setVerify(null)}
          action={async (password) => {
            const result = await call('settings:set', { appLockEnabled: false, verificationPassword: password });
            app.set({ prefs: result.preferences, locks: result.locks });
          }}
        />
      ) : null}
      <fieldset disabled={!enabled}>
        <Row label="Automatically lock after" hint="Immediately locks when all WorkSuite windows lose focus; other intervals measure inactivity in WorkSuite." lock={lock}>
          <Select
            label="App lock"
            disabled={!enabled}
            value={custom ? 'custom' : String(prefs.appLockMinutes)}
            options={options}
            onValueChange={(v) => {
              setCustom(v === 'custom');
              if (v !== 'custom') void updatePrefs({ appLockMinutes: Number(v) });
            }}
          />
        </Row>
        {custom ? <CustomTimeoutRow minutes={prefs.appLockMinutes} max={max || MAX_LOCK_MINUTES} /> : null}
        <Toggle k="lockOnSystemLock" prefs={prefs} label="Lock after operating-system lock" disabled={!enabled} />
        <Toggle k="lockOnSleep" prefs={prefs} label="Lock after computer sleep" disabled={!enabled} />
      </fieldset>
      <H
        title="Notifications While Locked"
        hint="Message delivery and unread counts keep working when banners are hidden. Message content is hidden by default. Organization privacy policies still apply."
      />
      <Toggle k="lockedChatNotifications" prefs={prefs} label="Chat notifications" />
      <Toggle k="lockedCallNotifications" prefs={prefs} label="Incoming calls and ringing" />
      <Toggle k="lockedShowCallerDetails" prefs={prefs} label="Show caller names" />
      <Toggle k="lockedNotificationSender" prefs={prefs} label="Show sender names" />
      <Toggle k="lockedNotificationPreview" prefs={prefs} label="Message previews" hint="Never shows more than Notifications › What banners show or your organization allows." />
      <Toggle k="lockedNotificationSounds" prefs={prefs} label="Notification sounds while locked" />
      <H title="Access While Locked" hint="Restricted access remains subject to your organization’s policy." />
      <Toggle k="lockedAnswerCalls" prefs={prefs} label="Answer Calls While Locked" />
      <Toggle
        k="lockedAllowChat"
        prefs={prefs}
        label="Allow Chat While Locked"
        hint="Opens a restricted chat window from a notification. Off: unlock before opening the conversation."
      />
      <PinRow set={!!lockState?.pin} />
      <Row
        label="Unlock with"
        hint={`Your WorkSuite password${lockState?.pin ? ', your PIN' : ''}${lockState?.biometric === 'touch-id' ? ' or Touch ID' : ''}.${lockState?.biometric === 'touch-id' ? '' : ' Windows Hello support is planned.'}`}
      >
        <Button icon="lock" onClick={() => void call('security:lock')}>
          Lock now
        </Button>
      </Row>
      <Row label="Your account's security" hint="Password, two-factor, passkeys, and where you're signed in.">
        <Button icon="lock" onClick={() => navigate('/account/security')}>
          Open My account › Security
        </Button>
      </Row>
    </>
  );
}

function VerifyLockChange({ title, action, onClose }: { title: string; action: (password: string) => Promise<void>; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await action(password);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!password} loading={busy} onClick={() => void save()}>
            Verify and continue
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField
          label="WorkSuite password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="Verify your identity before changing protection on this device."
        />
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

/** A PIN for the app lock on this computer: quicker than the password, and it works offline. */
function PinRow({ set }: { set: boolean }) {
  const [open, setOpen] = useState(false);
  const [remove, setRemove] = useState(false);
  return (
    <Row
      label="PIN"
      hint={set ? 'Unlocks WorkSuite on this computer, also offline. Five wrong tries sign you out.' : 'Set a 4 to 8 digit PIN to unlock WorkSuite on this computer, also offline.'}
    >
      <div className="flex gap-2">
        <Button data-guide="settings.set-pin" icon="lock" onClick={() => setOpen(true)}>
          {set ? 'Change PIN' : 'Set PIN'}
        </Button>
        {set ? (
          <Button variant="ghost" onClick={() => setRemove(true)}>
            Remove
          </Button>
        ) : null}
      </div>
      {remove ? (
        <VerifyLockChange
          title="Remove PIN"
          onClose={() => setRemove(false)}
          action={async (password) => {
            await call('security:clearPin', { password });
            toast('success', 'PIN removed.');
          }}
        />
      ) : null}
      {open ? <PinDialog change={set} onClose={() => setOpen(false)} /> : null}
    </Row>
  );
}

function PinDialog({ change, onClose }: { change: boolean; onClose: () => void }) {
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 8);
  const mismatch = again.length >= pin.length && again !== pin;
  const ready = /^\d{4,8}$/.test(pin) && pin === again && !!password;
  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call('security:setPin', { pin, password });
      if (!r.ok) setError(r.message);
      else {
        toast('success', change ? 'PIN changed.' : 'PIN set. Use it to unlock WorkSuite on this computer.');
        onClose();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={change ? 'Change PIN' : 'Set a PIN'}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void save()}>
            {change ? 'Change PIN' : 'Set PIN'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField label="New PIN (4–8 digits)" type="password" inputMode="numeric" autoComplete="off" autoFocus value={pin} onChange={(e) => setPin(digits(e.target.value))} />
        <TextField
          label="Confirm PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={again}
          onChange={(e) => setAgain(digits(e.target.value))}
          error={mismatch ? 'The PINs do not match.' : null}
        />
        <TextField
          label="WorkSuite password"
          type="password"
          autoComplete="current-password"
          hint="To check it is you."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <p className="text-[12.5px] text-danger">{error}</p> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function Devices() {
  const q = useQuery({ queryKey: ['device'], queryFn: () => call('security:deviceInfo') });
  const d = q.data;
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <H title="This device" hint="Your organization sees each computer you use WorkSuite on, and can sign it out or remove WorkSuite's data from it." />
      {d ? (
        <>
          <Row label="Name">
            <span className="text-[13px] text-ink-2">{d.name}</span>
          </Row>
          <Row label="Device id">
            <span className="font-mono text-[12.5px] text-ink-2 selectable">{d.id ?? 'Not registered'}</span>
          </Row>
          <Row label="System">
            <span className="text-[13px] text-ink-2">
              {d.osVersion} · {d.arch}
            </span>
          </Row>
          <Row label="Trust" hint="Set by your organization. Trusted computers can queue changes while offline.">
            <Chip tone={d.trust === 'TRUSTED' ? 'success' : d.trust === 'STANDARD' ? 'muted' : 'danger'}>{d.trust.toLowerCase()}</Chip>
          </Row>
          <Row label="Credentials stored in" hint={d.secureStorage.persistent ? undefined : 'No system keyring was found, so WorkSuite keeps your sign-in in memory and asks again next time.'}>
            <span className="text-[13px] text-ink-2">{d.secureStorage.persistent ? d.secureStorage.backend : 'Memory only'}</span>
          </Row>
          <Row label="Last check-in">
            <span className="text-[13px] text-ink-2">{d.lastHeartbeatAt ? relative(d.lastHeartbeatAt) : '—'}</span>
          </Row>
        </>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-2">
        <Button icon="external" onClick={() => void call('app:openInBrowser', { path: '/devices' })}>
          My other devices
        </Button>
        {confirm ? (
          <>
            <Button variant="danger" onClick={() => void call('auth:signOut', { wipe: true })}>
              Sign out and remove WorkSuite data
            </Button>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setConfirm(true)}>
            Sign out and remove this computer's data…
          </Button>
        )}
      </div>
      {confirm ? <p className="mt-2 text-[12.5px] text-ink-3">Removes cached data, queued changes, drafts and this computer's registration. Files you saved yourself are not touched.</p> : null}
    </>
  );
}
