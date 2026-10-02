import { isMac } from '../../core/bridge';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { leaveGuestMode, setLocalProfile } from '../../core/session';
import { Button } from '../../components/ui';
import { LocalProfileForm, LocalUnlock } from './LocalProfileForms';

/**
 * Guest mode's first step, in the main window (#149): set up the Local Profile on first use, or enter its PIN.
 * The same card and colours as sign-in; no second window. Then the shell opens with guest mode's apps.
 */
export function GuestGate() {
  const local = useStore(app, (s) => s.local);
  if (!local) return null;
  return (
    <div className="drag flex h-full items-center justify-center overflow-y-auto bg-navy p-6">
      <div className="no-drag relative w-[460px] rounded-[16px] bg-surface p-8 shadow-2xl">
        <Button className="absolute top-3 right-3" variant="ghost" size="sm" icon="chevron-left" onClick={() => void leaveGuestMode()}>
          Back to sign in
        </Button>
        {!local.profile ? <LocalProfileForm profile={null} onSaved={setLocalProfile} /> : <LocalUnlock profile={local.profile} onUnlocked={() => setLocalProfile(local.profile!)} />}
      </div>
      {isMac ? null : <div className="drag absolute top-0 right-0 left-0 h-10" />}
    </div>
  );
}
