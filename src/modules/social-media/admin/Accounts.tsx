import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { errorMessage } from '../../../core/bridge';
import { toast } from '../../../core/toasts';
import { Menu, type MenuItem } from '../../../components/Menu';
import { Icon } from '../../../components/Icon';
import { Button, cx } from '../../../components/ui';
import { brandById, dataOf, rowsOf, SK, socialApi, useAccounts, useBrands, useInvalidate, useModuleStatus, type Account, type Brand } from '../api';
import { hasLevel, useSocialAccess, type SocialAccess } from '../access';
import { needsAttention } from '../lib/status';
import { ageLabel } from '../lib/time';
import { AccountLabel, AccountStatusPill, OptionalView, PageBody, PageHeader, Panel, Table, TD, TR, UnderlineTabs, useBrandScope } from '../parts';
import { ConnectPanel } from './accounts/ConnectPanel';
import { AccessModal, AddBrandModal, BrandModal, DisconnectModal } from './accounts/dialogs';
import { useReconnect } from './accounts/flows';

/**
 * A01 · Accounts (SMM-ACC-001…013, WF-01, WF-02, WF-18, AC-01, AC-07). Every connected account with its brand,
 * status, what it was granted, the provider quota where the network exposes one (ACC-012) and its last sync; the
 * fixes in reach — reconnect or renew access, the access list (ACC-011), move brand, pause (PUB-010) and
 * disconnect — and the connect panel beside it. Tokens never reach the desktop.
 */

type Tab = 'all' | 'attention' | 'disconnected' | `brand:${number}`;
type Dialog = { kind: 'access' | 'brand' | 'disconnect'; account: Account } | { kind: 'add-brand' } | null;

function sinceLabel(stamp: string | null, now: number): string {
  if (!stamp) return 'Never';
  const a = ageLabel(stamp, now);
  return a === 'now' ? 'Just now' : a ? `${a} ago` : '';
}

/** "Reconnect" for a broken account, "Renew access" for one about to expire (design A01). */
function fixLabel(a: Account): string | null {
  if (a.status === 'expiring') return 'Renew access';
  if (a.status === 'needs_reconnect' || a.status === 'error' || a.status === 'limited') return 'Reconnect';
  return null;
}

function Quota({ quota }: { quota: NonNullable<Account['quota']> }) {
  const share = quota.limit > 0 ? Math.min(1, quota.used / quota.limit) : 0;
  const warn = share >= 0.8;
  return (
    <div className="mt-1.5 w-36" title={`${quota.label}: ${quota.used} of ${quota.limit}`}>
      <div className="h-1.5 overflow-hidden rounded-full bg-subtle" role="meter" aria-label={quota.label} aria-valuemin={0} aria-valuemax={quota.limit} aria-valuenow={quota.used}>
        <div className={cx('h-full rounded-full', warn ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      <span className={cx('mt-0.5 block text-[11px] tabular-nums', warn ? 'font-semibold text-warning' : 'text-ink-3')}>
        {quota.used.toLocaleString('en-US')} / {quota.limit.toLocaleString('en-US')} {quota.label.toLowerCase()}
      </span>
    </div>
  );
}

function RowActions({ account, access, onDialog, onReconnect, reconnecting }: { account: Account; access: SocialAccess; onDialog: (d: Dialog) => void; onReconnect: () => void; reconnecting: boolean }) {
  const invalidate = useInvalidate();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const manage = access.manageAccounts || hasLevel(account, 'manage', access);
  const pause = useMutation({
    mutationFn: () => socialApi.updateAccount(account.id, { paused: !account.paused }),
    onSuccess: () => {
      invalidate(SK.accounts, SK.queueAll);
      toast('success', account.paused ? 'Publishing resumed for this account.' : 'Publishing paused for this account.');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const fix = fixLabel(account);
  const why = manage ? undefined : 'Needs Manage on this account';
  const items: MenuItem[] = [
    { id: 'reconnect', label: fix ?? 'Reconnect', icon: 'refresh', disabled: !manage || account.status === 'disconnected', reason: why, onSelect: onReconnect },
    { id: 'access', label: 'Access list…', icon: 'user-plus', disabled: !manage, reason: why, onSelect: () => onDialog({ kind: 'access', account }) },
    { id: 'brand', label: 'Move to brand…', icon: 'folder-input', disabled: !manage, reason: why, onSelect: () => onDialog({ kind: 'brand', account }) },
    { id: 'pause', label: account.paused ? 'Resume publishing' : 'Pause publishing', icon: account.paused ? 'play' : 'pause', disabled: !manage, reason: why, onSelect: () => pause.mutate() },
    { id: 'disconnect', label: 'Disconnect…', icon: 'unlink', danger: true, disabled: !manage || account.status === 'disconnected', reason: why, onSelect: () => onDialog({ kind: 'disconnect', account }) },
  ];
  return (
    <span className="flex items-center justify-end gap-1.5">
      {fix && manage ? (
        <Button size="sm" variant={account.status === 'expiring' ? 'secondary' : 'primary'} loading={reconnecting} onClick={onReconnect}>
          {fix}
        </Button>
      ) : null}
      <button
        ref={anchor}
        type="button"
        aria-label={`More for ${account.display_name}`}
        title="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
      >
        <Icon name="more" size={18} />
      </button>
      {open ? <Menu label={`Actions for ${account.display_name}`} anchor={anchor} prefer="bottom" align="end" sections={[{ id: 'a', items }]} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}

function AccountsTable({ accounts, brands, access, onDialog }: { accounts: Account[]; brands: Brand[]; access: SocialAccess; onDialog: (d: Dialog) => void }) {
  const [now] = useState(() => Date.now());
  const reconnect = useReconnect();
  if (!accounts.length) return <p className="px-2 py-8 text-center text-[13px] text-ink-3">No accounts here.</p>;
  return (
    <>
      <Table head={['Account', 'Brand', 'Status', 'Granted', 'Last sync', 'Connected by', <span key="a" className="sr-only">Actions</span>]} minWidth={980}>
        {accounts.map((a) => (
          <tr key={a.id} className={TR}>
            <td className={TD}>
              <AccountLabel account={a} />
            </td>
            <td className={cx(TD, 'text-ink-2')}>{brandById(brands, a.brand_id)?.name ?? '—'}</td>
            <td className={TD}>
              <span className="flex flex-wrap items-center gap-1.5">
                <AccountStatusPill account={a} />
                {a.paused ? <span className="text-[11.5px] font-semibold text-warning">Paused</span> : null}
              </span>
              {a.quota ? <Quota quota={a.quota} /> : null}
            </td>
            <td className={TD}>
              <span className="flex max-w-[220px] flex-wrap gap-1">
                {a.granted.map((g) => (
                  <span key={g} className="rounded-[5px] bg-subtle px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">
                    {g}
                  </span>
                ))}
                {a.missing?.length ? <span className="text-[11px] text-warning" title={`Not granted: ${a.missing.join(', ')}`}>Missing {a.missing.length}</span> : null}
              </span>
            </td>
            <td className={cx(TD, 'whitespace-nowrap')}>
              {a.last_error_code ? (
                <span className="font-semibold text-danger" title={a.last_error_code}>
                  {a.last_error_message || 'Failed'}
                </span>
              ) : (
                <span className="text-ink-2">{sinceLabel(a.last_sync_at, now)}</span>
              )}
            </td>
            <td className={cx(TD, 'text-ink-2')}>{a.connected_by?.name ?? '—'}</td>
            <td className={TD}>
              <RowActions account={a} access={access} onDialog={onDialog} onReconnect={() => reconnect.start(a)} reconnecting={reconnect.pendingId === a.id} />
            </td>
          </tr>
        ))}
      </Table>
      {reconnect.modal}
    </>
  );
}

export default function Accounts() {
  const status = useModuleStatus();
  const access = useSocialAccess(dataOf(status.data)?.permissions);
  const q = useAccounts();
  const brands = rowsOf(useBrands().data);
  const [scope] = useBrandScope();
  const [tab, setTab] = useState<Tab>('all');
  const [dialog, setDialog] = useState<Dialog>(null);
  const connectRef = useRef<HTMLElement>(null);

  const all = rowsOf(q.data).filter((a) => !scope || a.brand_id === scope);
  const filter = (t: Tab) => (a: Account) =>
    t === 'all' ? a.status !== 'disconnected' : t === 'attention' ? needsAttention(a.status) : t === 'disconnected' ? a.status === 'disconnected' : a.brand_id === Number(t.slice(6)) && a.status !== 'disconnected';
  const offered = !!q.data?.offered;
  const count = (t: Tab) => (offered ? all.filter(filter(t)).length : null);
  const tabs: Array<{ id: Tab; label: string; count: number | null }> = [
    { id: 'all', label: 'All accounts', count: count('all') },
    ...brands.filter((b) => !scope || b.id === scope).map((b) => ({ id: `brand:${b.id}` as Tab, label: b.name, count: count(`brand:${b.id}`) })),
    { id: 'attention', label: 'Needs attention', count: count('attention') },
    { id: 'disconnected', label: 'Disconnected', count: count('disconnected') },
  ];

  return (
    <>
      <PageHeader
        crumb="Administer"
        title="Accounts"
        actions={
          <>
            {access.settings ? (
              <Button icon="plus" onClick={() => setDialog({ kind: 'add-brand' })}>
                Add brand
              </Button>
            ) : null}
            {access.connect ? (
              <Button
                variant="primary"
                icon="link"
                onClick={() => {
                  connectRef.current?.focus();
                  connectRef.current?.scrollIntoView?.({ block: 'nearest' });
                }}
              >
                Connect account
              </Button>
            ) : null}
          </>
        }
      />
      <PageBody>
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-w-0 flex-col gap-3">
            <UnderlineTabs label="Accounts" value={tab} onChange={setTab} tabs={tabs} />
            <Panel bodyClassName="px-2 pb-2 pt-1">
              <OptionalView q={q} what="Social accounts" compact>
                {() => <AccountsTable accounts={all.filter(filter(tab))} brands={brands} access={access} onDialog={setDialog} />}
              </OptionalView>
            </Panel>
            <p className="text-[11.5px] text-ink-3">WorkSuite never sees your social password. Tokens are sealed in the WorkSuite secret vault.</p>
          </div>
          <ConnectPanel brands={brands} defaultBrand={scope} canConnect={access.connect && offered} focusRef={connectRef} />
        </div>
      </PageBody>
      {dialog?.kind === 'add-brand' ? <AddBrandModal onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'access' ? <AccessModal account={dialog.account} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'brand' ? <BrandModal account={dialog.account} brands={brands} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'disconnect' ? <DisconnectModal account={dialog.account} onClose={() => setDialog(null)} /> : null}
    </>
  );
}
