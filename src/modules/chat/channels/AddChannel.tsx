import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { apiPost } from '../../../core/api';
import { call, errorMessage } from '../../../core/bridge';
import { Icon } from '../../../components/Icon';
import { Button, Modal, cx } from '../../../components/ui';
import { LinkPhone } from './LinkPhone';
import { isConnected, WA, type WaAccount } from './whatsapp';

export type AddStep = { at: 'list' } | { at: 'whatsapp' } | { at: 'link'; accountId: number; name: string };

/**
 * "Add a channel" (worksuite-desktop#33): the messaging integrations this server has and where each stands for this
 * person, and the setup that can be done here. A WhatsApp number linked by QR code is set up in the dialog; a
 * Business Platform number (Meta's tokens) and the website chat widget are set up on the web, where their settings
 * are edited. A channel appears in the toolbar once it is connected.
 */
export function AddChannel({ website, whatsapp, initial = { at: 'list' }, onClose, onConnected }: {
  website: { access: boolean; canSetUp: boolean };
  whatsapp: { access: boolean; canConnect: boolean; accounts: WaAccount[] };
  initial?: AddStep;
  onClose: () => void;
  onConnected: (channel: 'whatsapp') => void;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<AddStep>(initial);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const web = (path: string) => void call('app:openInBrowser', { path });

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ id: number; needs_approval?: boolean }>(`${WA}/accounts`, { name: name.trim(), provider: 'web_js' });
      void qc.invalidateQueries({ queryKey: ['whatsapp', 'accounts'] });
      setStep({ at: 'link', accountId: r.id, name: name.trim() });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (step.at === 'link') {
    return (
      <Modal title={`Link ${step.name} to WhatsApp`} onClose={onClose} width={460} footer={<Button onClick={onClose}>Close</Button>}>
        <LinkPhone accountId={step.accountId} onLinked={() => onConnected('whatsapp')} />
      </Modal>
    );
  }

  if (step.at === 'whatsapp') {
    const usable = name.trim().length > 0 && !busy;
    return (
      <Modal
        title="Connect a WhatsApp number"
        onClose={onClose}
        width={460}
        footer={
          <>
            <Button onClick={() => setStep({ at: 'list' })}>Back</Button>
            <Button variant="primary" disabled={!usable} loading={busy} onClick={() => void create()}>Continue</Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-3 text-[12.5px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (usable) void create();
          }}
        >
          <label className="flex flex-col gap-1 font-semibold text-ink">
            Name
            <input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Sales line, Support, Front desk…" className="h-[34px] rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-medium outline-none focus:border-primary" />
            <span className="font-normal text-ink-3">So people know which number they are answering from.</span>
          </label>
          <p className="text-ink-2">Next, scan a QR code with the phone that owns the number, the way you link WhatsApp Web.</p>
          <p className="rounded-[8px] bg-warning-bg p-2.5 text-[12px] text-[#9A4A06] dark:text-warning">
            This links an ordinary WhatsApp number, not the official Business Platform: the link can drop and need scanning again, and bulk sending can get a number banned.{' '}
            <button type="button" className="font-semibold underline" onClick={() => web('/whatsapp')}>Connect a Business Platform number on the web</button> instead.
          </p>
          {error ? <p role="alert" className="rounded-[8px] bg-danger-bg p-2.5 text-danger">{error}</p> : null}
        </form>
      </Modal>
    );
  }

  const connected = whatsapp.accounts.filter(isConnected);
  const waiting = whatsapp.accounts.filter((a) => !isConnected(a));
  return (
    <Modal title="Add a channel" onClose={onClose} width={520} footer={<Button onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-2.5">
        <Integration icon="chat" name="Chat" state="Built in" connected note="Conversations with the people in your organisation." />
        <Integration
          icon="phone"
          name="WhatsApp"
          connected={connected.length > 0}
          state={!whatsapp.access ? 'Not available to you' : connected.length ? `${connected.length} ${connected.length === 1 ? 'number' : 'numbers'} connected` : waiting.length ? 'Not connected' : 'Not set up'}
          note={
            !whatsapp.access
              ? 'Ask an administrator for access to WhatsApp.'
              : waiting.length
                ? `${waiting.map((a) => a.name).join(', ')} ${waiting.length === 1 ? 'needs' : 'need'} linking again.`
                : 'Answer customers on your WhatsApp numbers from Chat.'
          }
          action={
            whatsapp.access && whatsapp.canConnect ? (
              <div className="flex flex-col items-end gap-1">
                {waiting.filter((a) => a.provider === 'web_js' && a.can_connect !== false).map((a) => (
                  <Button key={a.id} size="sm" onClick={() => setStep({ at: 'link', accountId: a.id, name: a.name })}>Link {a.name}</Button>
                ))}
                <Button size="sm" variant="primary" icon="plus" onClick={() => setStep({ at: 'whatsapp' })}>Connect a number</Button>
              </div>
            ) : whatsapp.access && !whatsapp.accounts.length ? (
              <span className="max-w-[160px] text-right text-[11.5px] text-ink-3">Ask whoever manages WhatsApp numbers to share one with you.</span>
            ) : null
          }
        />
        <Integration
          icon="globe"
          name="Web Chat"
          connected={website.access}
          state={website.access ? 'Connected' : 'Not set up for you'}
          note={website.access ? 'Visitors to your website, answered from Chat.' : 'Put the chat widget on your website, then give the people who answer it website chat access.'}
          action={website.canSetUp ? <Button size="sm" icon="external" onClick={() => web('/website-chats?tab=widgets')}>Set up on the web</Button> : null}
        />
      </div>
    </Modal>
  );
}

function Integration({ icon, name, state, note, connected, action }: { icon: string; name: string; state: string; note: string; connected: boolean; action?: ReactNode }) {
  return (
    <section aria-label={name} className="flex items-center gap-3 rounded-[10px] border border-line p-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-subtle text-ink-2">
        <Icon name={icon} size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <b className="text-[13.5px] text-ink">{name}</b>
          <span className={cx('rounded-full px-2 py-px text-[11px] font-semibold', connected ? 'bg-success-bg text-success' : 'bg-subtle text-ink-3')}>{state}</span>
        </span>
        <span className="block text-[12px] text-ink-3">{note}</span>
      </span>
      {action}
    </section>
  );
}
