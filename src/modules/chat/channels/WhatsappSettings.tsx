import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { call, errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, Modal, Spinner, cx } from '../../../components/ui';
import { checkWa, isConnected, makeDefaultWa, unlinkWa, type WaAccount } from './whatsapp';

const ROLES: Record<string, string> = { owner: 'Owner', admin: 'Admin', agent: 'Agent', viewer: 'Viewer' };

/**
 * WhatsApp's channel settings in Chat (worksuite-desktop#35), what the separate WhatsApp module's numbers screen did:
 * the numbers shared with you and where each stands, checking a connection, linking a number again by QR code or
 * unlinking it from the phone (its conversations stay), the default number, and connecting another. Each action is
 * offered only where the server says this person may (`can_connect`) and it checks again. Sharing a number,
 * broadcasts, editing templates and business hours are on the web.
 */
export function WhatsappSettings({ accounts, loading, onConnect, onRelink, onClose }: {
  accounts: WaAccount[];
  loading: boolean;
  onConnect: (() => void) | null;
  onRelink: (a: WaAccount) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState<number | null>(null);
  const web = (path: string) => void call('app:openInBrowser', { path });

  const act = async (key: string, run: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      const r = (await run()) as { ok?: boolean; error?: string | null } | null;
      if (r && r.ok === false) toast('error', r.error ?? text('That did not work.'));
      else toast('success', done);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
      setUnlinking(null);
      void qc.invalidateQueries({ queryKey: ['whatsapp'] });
    }
  };

  return (
    <Modal
      title={text('WhatsApp settings')}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button icon="external" onClick={() => web('/whatsapp')}>{text('More on the web')}</Button>
          <Button variant="primary" onClick={onClose}>{text('Done')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[12.5px]">
        <div className="flex items-center gap-2">
          <b className="flex-1 text-[13px] text-ink">{text('Your numbers')}</b>
          {onConnect ? <Button size="sm" variant="primary" icon="plus" onClick={onConnect}>{text('Connect a number')}</Button> : null}
        </div>
        {loading ? <Spinner /> : null}
        {!loading && !accounts.length ? (
          <p className="rounded-[10px] border border-dashed border-line p-3 text-ink-3">
            {onConnect ? text('No number yet. Connect one to answer customers from Chat.') : text('No number is shared with you yet. Ask whoever manages WhatsApp numbers to share one with you.')}
          </p>
        ) : null}
        <ul className="flex flex-col gap-2" aria-label={text('Your numbers')}>
          {accounts.map((a) => {
            const up = isConnected(a);
            const may = a.can_connect === true;
            return (
              <li key={a.id} aria-label={a.name} className="flex flex-col gap-2 rounded-[10px] border border-line p-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-subtle text-ink-2"><Icon name="phone" size={17} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <b className="text-[13.5px] text-ink">{a.name}</b>
                      <span className={cx('rounded-full px-2 py-px text-[11px] font-semibold', up ? 'bg-success-bg text-success' : 'bg-warning-bg text-[#9A4A06] dark:text-warning')}>{up ? text('Connected') : text('Not connected')}</span>
                      {a.is_default ? <span className="rounded-full bg-subtle px-2 py-px text-[11px] font-semibold text-ink-2">{text('Default')}</span> : null}
                    </span>
                    <span className="block text-ink-3">
                      {[a.phone ? `+${a.phone.replace(/^\+/, '')}` : null, a.provider_label ?? null, a.role ? text(ROLES[a.role] ?? a.role) : null].filter(Boolean).join(' · ')}
                    </span>
                    {!up && a.status_note ? <span className="mt-0.5 block text-ink-2">{a.status_note}</span> : null}
                  </span>
                </div>
                {may ? (
                  unlinking === a.id ? (
                    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[8px] bg-danger-bg p-2 text-danger">
                      <span className="flex-1">{text('Unlink {name} from the phone? Its conversations stay here.', { name: a.name })}</span>
                      <Button size="sm" onClick={() => setUnlinking(null)}>{text('Cancel')}</Button>
                      <Button size="sm" variant="danger" loading={busy === `unlink:${a.id}`} onClick={() => void act(`unlink:${a.id}`, () => unlinkWa(a.id), text('{name} is unlinked.', { name: a.name }))}>{text('Unlink')}</Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" icon="refresh" loading={busy === `check:${a.id}`} onClick={() => void act(`check:${a.id}`, () => checkWa(a.id), text('{name} was checked.', { name: a.name }))}>{text('Check connection')}</Button>
                      {a.provider === 'web_js' && !up ? <Button size="sm" onClick={() => onRelink(a)}>{text('Link again')}</Button> : null}
                      {!a.is_default ? <Button size="sm" loading={busy === `default:${a.id}`} onClick={() => void act(`default:${a.id}`, () => makeDefaultWa(a.id), text('{name} is the default number now.', { name: a.name }))}>{text('Make default')}</Button> : null}
                      {a.provider === 'web_js' && up ? <Button size="sm" onClick={() => setUnlinking(a.id)}>{text('Unlink from phone')}</Button> : null}
                    </div>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="text-ink-3">{text('Sharing a number, broadcasts, templates, labels and business hours are set on the web.')}</p>
      </div>
    </Modal>
  );
}
