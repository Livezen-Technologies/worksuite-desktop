import { text } from '../../../core/i18n';
import { Icon } from '../../../components/Icon';
import { Button } from '../../../components/ui';
import type { SendBlock } from './types';

/**
 * Compose's word on a send that protection refused (P-UI-15, AC-MPR-11, AC-MPR-12): a file with malware — not sent,
 * the draft kept, remove the file and send again; or this mailbox's sending paused for review — nothing goes until an
 * administrator resumes it, and the draft waits here. Icon and words, announced as an alert.
 */
export function SendBlockedNote({ block, attachmentPresent, onRemove, onDismiss }: { block: SendBlock; attachmentPresent: boolean; onRemove?: () => void; onDismiss: () => void }) {
  const malware = block.kind === 'malware';
  return (
    <div role="alert" data-send-blocked={block.kind} className="mx-4 mt-2 flex shrink-0 items-start gap-2.5 rounded-[10px] border border-danger-line bg-danger-bg px-3 py-2.5 text-[12.5px] leading-[1.45] text-danger-ink">
      <Icon name={malware ? 'shield-alert' : 'lock'} size={18} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-bold">{malware ? text('Not sent — an attachment contains a virus') : text('Sending is paused for this mailbox')}</p>
        <p>
          {malware
            ? block.attachment
              ? text('{name} was found to contain {threat}. Remove it and send again. Your draft is kept.', { name: block.attachment, threat: block.threat ?? text('malware') })
              : text('A file in this message was found to contain {threat}. Remove it and send again. Your draft is kept.', { threat: block.threat ?? text('malware') })
            : text('Your organisation paused sending from this mailbox because it may be compromised. An administrator has to review it before mail can go. Your draft is kept.')}
        </p>
        {!malware && block.reason ? <p className="mt-0.5 opacity-80">{block.reason}</p> : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {malware && block.attachment && attachmentPresent && onRemove ? (
            <Button size="sm" variant="danger" icon="trash" onClick={onRemove}>
              {text('Remove {name}', { name: block.attachment })}
            </Button>
          ) : null}
          <Button size="sm" onClick={onDismiss}>
            {text('Dismiss')}
          </Button>
        </div>
      </div>
    </div>
  );
}
