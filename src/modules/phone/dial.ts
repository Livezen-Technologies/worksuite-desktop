import { toast } from '../../core/toasts';
import { runPhone } from './softphone/client';
import { isDialable } from './lib/format';

/**
 * Click-to-call from anywhere in WorkSuite (VOIP-SP-04/08, G-07): a contact, an account, a lead, an employee, a
 * vendor. The phone places it through the switch — this phone rings first, then the number — with the record it
 * came from, so the call is logged against it (VOIP-POP-02). Without a softphone on this computer the person's desk
 * phone rings instead.
 */
export async function placeCall(number: string | null | undefined, opts: { contactId?: number | null; name?: string | null } = {}): Promise<boolean> {
  const n = (number ?? '').trim();
  if (!n || !isDialable(n)) {
    toast('error', 'There is no number to call.');
    return false;
  }
  const r = await runPhone({ cmd: 'dial', number: n, contactId: opts.contactId ?? null, name: opts.name ?? null });
  if (!r.ok) {
    toast('error', r.message);
    return false;
  }
  if (r.message) toast('info', r.message);
  return true;
}
