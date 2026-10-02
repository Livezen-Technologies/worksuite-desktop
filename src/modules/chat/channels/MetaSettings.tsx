import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { listStamp } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, Modal, Spinner, cx } from '../../../components/ui';
import { checkMeta, disconnectMeta, isMetaConnected, PLATFORM_ICON, PLATFORM_LABEL, statusLabel, type MetaAccount, type MetaPlatform } from './meta';

const ROLES: Record<string, string> = { owner: 'Owner', admin: 'Admin', agent: 'Agent', viewer: 'Viewer' };

/**
 * Messenger's or Instagram's channel settings in Chat (worksuite-desktop#36): the accounts shared with you and where
 * each stands — connected, or why not (the sign-in expired, a permission was removed, Meta is not sending its
 * messages) — checking a connection, reconnecting and disconnecting it (its conversations stay), and connecting
 * another. Each action is offered only where the server says this person may (`can_connect`), and it checks again.
 */
export function MetaSettings({ platform, accounts, loading, onConnect, onReconnect, onClose }: {
  platform: MetaPlatform;
  accounts: MetaAccount[];
  loading: boolean;
  onConnect: (() => void) | null;
  onReconnect: (a: MetaAccount) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<number | null>(null);
  const label = PLATFORM_LABEL[platform];

  const act = async (key: string, run: () => Promise<{ ok: boolean; account: MetaAccount }>, done: (a: MetaAccount) => string) => {
    setBusy(key);
    try {
      const r = await run();
      if (r.ok) toast('success', done(r.account));
      else toast('error', `${r.account.name}: ${r.account.status_note ?? statusLabel(r.account.status)}`);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
      setLeaving(null);
      void qc.invalidateQueries({ queryKey: ['meta'] });
    }
  };

  return (
    <Modal title={text('{platform} settings', { platform: label })} onClose={onClose} width={560} footer={<Button variant="primary" onClick={onClose}>{text('Done')}</Button>}>
      <div className="flex flex-col gap-3 text-[12.5px]">
        <div className="flex items-center gap-2">
          <b className="flex-1 text-[13px] text-ink">{platform === 'messenger' ? text('Your Pages') : text('Your Instagram accounts')}</b>
          {onConnect ? <Button size="sm" variant="primary" icon="plus" onClick={onConnect}>{platform === 'messenger' ? text('Connect a Page') : text('Connect Instagram')}</Button> : null}
        </div>
        {loading ? <Spinner /> : null}
        {!loading && !accounts.length ? (
          <p className="rounded-[10px] border border-dashed border-line p-3 text-ink-3">
            {onConnect ? text('Nothing is connected yet. Connect one to answer its messages from Chat.') : text('Nothing is shared with you yet. Ask whoever manages your Pages to share one with you.')}
          </p>
        ) : null}
        <ul className="flex flex-col gap-2" aria-label={platform === 'messenger' ? text('Your Pages') : text('Your Instagram accounts')}>
          {accounts.map((a) => {
            const up = isMetaConnected(a);
            const off = a.status === 'disconnected';
            return (
              <li key={a.id} aria-label={a.name} className="flex flex-col gap-2 rounded-[10px] border border-line p-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-subtle text-ink-2"><Icon name={PLATFORM_ICON[platform]} size={17} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <b className="text-[13.5px] text-ink">{platform === 'instagram' && a.username ? `@${a.username}` : a.name}</b>
                      <span className={cx('rounded-full px-2 py-px text-[11px] font-semibold', up ? 'bg-success-bg text-success' : off ? 'bg-subtle text-ink-3' : 'bg-warning-bg text-[#9A4A06] dark:text-warning')}>{statusLabel(a.status)}</span>
                    </span>
                    <span className="block text-ink-3">
                      {[platform === 'instagram' ? text('Linked to {page}', { page: a.page_name }) : text('Facebook Page'), a.role ? text(ROLES[a.role] ?? a.role) : null, a.human_agent ? text('Human Agent replies to 7 days') : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {!up && a.status_note ? <span role="status" className="mt-0.5 block text-ink-2">{a.status_note}</span> : null}
                    {a.last_checked_at ? <span className="mt-0.5 block text-[11.5px] text-ink-3">{text('Checked {when}', { when: listStamp(a.last_checked_at) })}</span> : null}
                  </span>
                </div>
                {a.can_connect ? (
                  leaving === a.id ? (
                    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[8px] bg-danger-bg p-2 text-danger">
                      <span className="flex-1">{text('Disconnect {name}? Its messages stop arriving here; its conversations stay.', { name: a.name })}</span>
                      <Button size="sm" onClick={() => setLeaving(null)}>{text('Cancel')}</Button>
                      <Button size="sm" variant="danger" loading={busy === `off:${a.id}`} onClick={() => void act(`off:${a.id}`, () => disconnectMeta(a.id), (x) => text('{name} is disconnected.', { name: x.name }))}>{text('Disconnect')}</Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {!off ? <Button size="sm" icon="refresh" loading={busy === `check:${a.id}`} onClick={() => void act(`check:${a.id}`, () => checkMeta(a.id), (x) => text('{name} is connected.', { name: x.name }))}>{text('Check connection')}</Button> : null}
                      <Button size="sm" variant={up ? undefined : 'primary'} onClick={() => onReconnect(a)}>{text('Reconnect')}</Button>
                      {!off ? <Button size="sm" onClick={() => setLeaving(a.id)}>{text('Disconnect')}</Button> : null}
                    </div>
                  )
                ) : !up ? (
                  <p className="text-[11.5px] text-ink-3">{text('Whoever manages this account can reconnect it.')}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="text-ink-3">{text('Replies follow {platform}’s rules: within 24 hours of the person’s last message, and only after they have written.', { platform: label })}</p>
      </div>
    </Modal>
  );
}
