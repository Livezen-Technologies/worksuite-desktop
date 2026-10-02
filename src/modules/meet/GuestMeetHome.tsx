import { useQuery } from '@tanstack/react-query';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { text } from '../../core/i18n';
import { startSignIn } from '../../core/session';
import { useStore } from '../../core/store';
import { useTabTitle } from '../../core/tab-context';
import { Spinner } from '../../components/ui';
import { useOnline } from '../guest/GuestProfileMenu';
import { GuestJoinForm } from './GuestJoinForm';

/**
 * Meet in guest mode (#149): join by link or code with the Local Profile's name and no account token, where the
 * meeting server lets guests in. The last link or code is kept on this device, so it is there offline too.
 * Starting a meeting needs an account: no WorkSuite server lets a guest host one.
 */
export function GuestMeetHome() {
  useTabTitle('Meet');
  const name = useStore(app, (s) => s.local?.profile?.name ?? '');
  const online = useOnline();
  const saved = useQuery({ queryKey: ['local', 'overview'], queryFn: () => call('local:overview'), staleTime: Infinity });
  if (saved.isLoading) return <Spinner />;
  const keep = (input: string, server: string) => void call('local:meeting', { input, server }).catch(() => undefined);
  return (
    <div className="flex h-full justify-center overflow-y-auto p-8 scroll-thin">
      <div className="h-fit w-full max-w-[480px] rounded-[14px] border border-line bg-surface p-6">
        <GuestJoinForm
          initialInput={saved.data?.meetingInput}
          server={saved.data?.meetingServer}
          offline={!online}
          onChange={keep}
          join={(input, server) => call('local:joinMeeting', { input, server })}
          intro={
            <p className="text-ink-2">
              {text('You join as a guest named “{name}”, and can change the name before joining.', { name })} The host decides guest access, passcodes and admission.
            </p>
          }
        />
        {!online ? (
          <p role="status" className="mt-3 rounded-[8px] bg-subtle px-3 py-2 text-[13px] text-ink-2">
            Live meetings need internet access. Your link or code is saved on this device.
          </p>
        ) : null}
        <p className="mt-4 border-t border-line pt-3 text-[12.5px] text-ink-3">
          Starting a meeting needs a WorkSuite account.{' '}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={startSignIn}>
            Sign in / Create account
          </button>
        </p>
      </div>
    </div>
  );
}
