import { updatePrefs } from '../../core/app-state';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
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
    <section aria-label={text('Welcome to WorkSuite Mail')} className="m-3 mb-0 flex flex-wrap items-center gap-3 rounded-[12px] border border-line bg-selection px-4 py-3 text-[13px] text-ink">
      <Icon name="mail" size={18} className="text-primary" />
      <span className="min-w-0 flex-1">
        <b>{text('Coming from Outlook?')}</b> {text('WorkSuite can use Outlook’s shortcuts and layout, so nothing needs relearning.')}
      </span>
      <Button variant="primary" onClick={outlook}>
        {text('Yes, set it up like Outlook')}
      </Button>
      <Button onClick={() => onPrefs({ firstRun: 'skipped' })}>{text('No, thanks')}</Button>
    </section>
  );
}

/** After "Yes": the three offers, each one click (WF-DO12 step 2). */
export function FirstRunOffers({ onImport, onSignatures, onDone }: { onImport: () => void; onSignatures: () => void; onDone: () => void }) {
  return (
    <section aria-label={text('Bring your Outlook mail over')} className="m-3 mb-0 flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-surface px-4 py-3 text-[13px] text-ink">
      <span className="min-w-0 flex-1 font-semibold">{text('Done — Outlook shortcuts are on. Bring the rest over?')}</span>
      <Button icon="upload" onClick={onImport}>
        {text('Import a .pst or .mbox')}
      </Button>
      <Button icon="pen" onClick={onSignatures}>
        {text('Add your signature')}
      </Button>
      <Button icon="mail" onClick={() => void updatePrefs({ mailtoHandler: true })}>
        {text('Make WorkSuite my mail app')}
      </Button>
      <Button variant="ghost" onClick={onDone}>
        {text('Close')}
      </Button>
    </section>
  );
}
