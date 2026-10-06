import { useState } from 'react';
import { useCanOpen } from '../../core/access';
import { Button, IconButton } from '../../components/ui';
import { placeCall } from './dial';
import { isDialable, prettyNumber } from './lib/format';

/**
 * The one Call button every module uses (G-07): CRM contacts, accounts and leads, Contacts, HR, vendors. It places
 * the call through the Phone with the record's context; nothing shows when there is no number or no Phone.
 */
export function CallButton({
  number,
  contactId,
  name,
  variant = 'icon',
  className,
}: {
  number: string | null | undefined;
  contactId?: number | null;
  name?: string | null;
  variant?: 'icon' | 'button';
  className?: string;
}) {
  const allowed = useCanOpen('phone');
  const [busy, setBusy] = useState(false);
  if (!allowed || !number || !isDialable(number)) return null;
  const label = `Call ${name ? `${name} on ` : ''}${prettyNumber(number)}`;
  const go = async () => {
    setBusy(true);
    try {
      await placeCall(number, { contactId, name });
    } finally {
      setBusy(false);
    }
  };
  if (variant === 'button') {
    return (
      <Button icon="phone" loading={busy} onClick={() => void go()} className={className} title={label}>
        Call
      </Button>
    );
  }
  return <IconButton icon="phone" label={label} disabled={busy} onClick={() => void go()} className={className} />;
}
