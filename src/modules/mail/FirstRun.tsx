import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { apiGet } from '../../core/api';
import { app, updatePrefs } from '../../core/app-state';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { InfoBanner } from '../../components/InfoBanner';
import { useSignatures } from './api';
import type { MailPrefs } from './types';

/**
 * First run (WF-DO12): "Coming from Outlook?" Yes sets the Outlook keyboard
 * scheme, the Classic command bar, conversations off, the reading pane on the
 * right and Focused Inbox on — then offers importing a .pst, bringing the
 * signature over, and making WorkSuite the computer's mail app. Asked once.
 */
export function FirstRun({ onPrefs }: { onPrefs: (p: Partial<MailPrefs>) => void }) {
  const outlook = () => {
    onPrefs({ firstRun: 'outlook', keyScheme: 'outlook', commandBar: 'classic', pane: 'right', focused: true, conversations: {} });
  };
  return (
    <InfoBanner
      label={text('Welcome to WorkSuite Mail')}
      title={text('Coming from Outlook?')}
      description={text('WorkSuite can use Outlook’s shortcuts and layout, so nothing needs relearning.')}
      icon="mail"
      primary={{ id: 'outlook', label: text('Yes, set it up like Outlook'), onClick: outlook }}
      secondary={[{ id: 'skip', label: text('No, thanks'), onClick: () => onPrefs({ firstRun: 'skipped' }) }]}
    />
  );
}

/** Any import of mail into WorkSuite that finished counts as the Import step done. */
function useImportDone(enabled: boolean): boolean {
  const q = useQuery({
    queryKey: ['mail', 'imports', 'any-done'],
    queryFn: async () => {
      try {
        const r = await apiGet<{ imports: Array<{ stage: string }> }>('/api/mail/imports');
        return (r.imports ?? []).some((i) => i.stage === 'done');
      } catch {
        return false;
      }
    },
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return q.data === true;
}

/**
 * After "Yes" (WF-DO12 step 2, worksuite-desktop#187, #210): what was done, then what is worth doing next —
 * Import email first, Add signature and Make default mail app second — in the shared InfoBanner. A step
 * already done shows a tick; when all three are done the banner goes by itself. Dismissing is saved in
 * Mail's preferences (per person, every computer) with Undo for five seconds; Settings › Mail › Appearance
 * & reading › Show setup tips brings it back.
 */
export function FirstRunOffers({ outlook = true, onImport, onSignatures, onDone, onRestore }: { outlook?: boolean; onImport: () => void; onSignatures: () => void; onDone: () => void; onRestore?: () => void }) {
  const signatures = useSignatures(true);
  const defaultApp = useStore(app, (s) => s.prefs?.mailtoHandler === true);
  const imported = useImportDone(true);
  const signed = (signatures.data?.signatures?.length ?? 0) > 0;
  const allDone = signed && defaultApp && imported;
  const done = useRef(false);
  useEffect(() => {
    if (allDone && !done.current) {
      done.current = true;
      onDone();
    }
  }, [allDone, onDone]);
  if (allDone) return null;
  const dismiss = () => {
    onDone();
    if (onRestore) toast('info', text('Setup tips hidden.'), { label: text('Undo'), run: onRestore }, 5000);
  };
  return (
    <InfoBanner
      title={outlook ? text('Outlook shortcuts are on') : text('Finish setting up Mail')}
      description={outlook ? text('Finish setting up Mail') : text('Bring your email and preferences into WorkSuite.')}
      icon="check"
      tone="success"
      primary={{ id: 'import', label: text('Import email'), icon: 'upload', onClick: onImport, done: imported, title: text('Import Outlook .pst or .mbox files, or .eml/.msg messages') }}
      secondary={[
        { id: 'signature', label: text('Add signature'), icon: 'pen', onClick: onSignatures, done: signed },
        { id: 'default', label: text('Make default mail app'), icon: 'mail', onClick: () => void updatePrefs({ mailtoHandler: true }), done: defaultApp },
      ]}
      moreLabel={text('More setup actions')}
      onDismiss={dismiss}
    />
  );
}
