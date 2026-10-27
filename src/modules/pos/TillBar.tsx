import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Menu, type MenuSection } from '../../components/Menu';
import { Button, Modal, initials } from '../../components/ui';
import { app } from '../../core/app-state';
import { call } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { useNow } from '../../core/use-now';
import { forgetTill, PK } from './api';
import { displayWindow, toggleCustomerDisplay } from './display';
import { useT, type PosKey } from './i18n';
import { Mark, type PosView, type Till } from './parts';
import { clockOf, tillPill } from './syncstate';

/**
 * The till bar (64px, navy): which till and register this is, whether WorkSuite answers, the time, the cashier,
 * Lock, and the till's menu — its screens, the customer display, full screen, changing cashier, the web's screens
 * and forgetting the till (what the side rail used to hold).
 */
export const MENU_VIEWS: Array<{ view: PosView; label: PosKey; icon: string }> = [
  { view: 'register', label: 'pos.register', icon: 'cart' },
  { view: 'shift', label: 'pos.shift', icon: 'banknote' },
  { view: 'sales', label: 'pos.sales', icon: 'receipt' },
  { view: 'printers', label: 'pos.settings', icon: 'printer' },
];

export default function TillBar({ till, view, full, onFull, onSync }: { till: Till; view: PosView; full: boolean; onFull: () => void; onSync: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const now = useNow(15_000);
  const cashier = useStore(app, (s) => s.bootstrap?.user.name ?? null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLElement>(null);
  const [menu, setMenu] = useState(false);
  const display = useStore(displayWindow, (x) => x.open);
  const [confirming, setConfirming] = useState(false);
  const s = till.status;
  const terminal = s.till!.terminal;
  const pending = s.waiting + s.refused;
  const place = [till.company?.name ?? terminal.org_name, terminal.branch_name].filter(Boolean).join(' · ');
  // Online, offline, sending, the catalogue syncing or out of date (worksuite-desktop#296): sales and catalogue both.
  const pill = tillPill(s, till.offline);
  const online = pill.tone !== 'offline';
  const net = t(pill.key, pill.vars);
  const when = t('pos.bar.title', { sales: clockOf(s.last_sync) ?? t('pos.bar.never'), cat: clockOf(s.catalogue?.fetched_at) ?? t('pos.bar.never') });

  async function forget(discard: boolean) {
    try {
      // Phase 2 (`capabilities.device_unpair`): handed back on WorkSuite too, so the till is free to pair at once.
      await forgetTill(discard, !!till.caps.device_unpair && !till.offline);
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: PK.all });
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'The till could not be forgotten.');
    }
  }

  const sections: MenuSection[] = [
    {
      id: 'views',
      items: MENU_VIEWS.map((v) => ({
        id: v.view,
        label: t(v.label),
        icon: v.icon,
        checked: view === v.view || (v.view === 'printers' && view === 'till'),
        radio: true,
        meta: v.view === 'sales' && pending ? String(pending) : undefined,
        metaLabel: v.view === 'sales' && pending ? t('pos.waiting', { n: pending }) : undefined,
        onSelect: () => till.go(v.view),
      })),
    },
    {
      id: 'counter',
      items: [
        { id: 'display', label: t('pos.display'), icon: 'monitor', checked: display, onSelect: () => void toggleCustomerDisplay() },
        { id: 'full', label: t(full ? 'pos.bar.leaveFull' : 'pos.bar.full'), icon: full ? 'fullscreen-exit' : 'fullscreen', onSelect: onFull },
      ],
    },
    {
      id: 'person',
      items: [
        { id: 'cashier', label: t('pos.switchCashier'), icon: 'logout', description: 'The next cashier signs in. The till and its unsent sales stay.', onSelect: () => void call('auth:signOut', {}) },
        { id: 'web', label: t('pos.webScreens'), icon: 'external', onSelect: () => void call('app:openInBrowser', { path: '/pos' }) },
        { id: 'forget', label: t('pos.forget'), icon: 'trash', danger: true, onSelect: () => setConfirming(true) },
      ],
    },
  ];

  const glass = 'flex h-touch w-touch shrink-0 items-center justify-center rounded-[10px] bg-white/[.08] text-white hover:bg-white/[.14]';
  return (
    <header ref={bar} aria-label={t('pos.bar.label')} className="flex h-16 shrink-0 items-center gap-4 bg-pos-bar px-5 text-white">
      <div className="flex min-w-0 items-center gap-2.5">
        <Mark />
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-[-.01em]">{t('pos.bar.brand')}</div>
          <div className="truncate text-[11px] text-pos-bar-ink">{place}</div>
        </div>
      </div>
      <span className="h-8 w-px shrink-0 bg-white/[.14]" />
      <div className="flex min-w-0 items-center gap-2 text-[13px]">
        <span className="rounded-[6px] bg-pos-bar-chip px-2 py-[3px] font-mono font-bold">{terminal.code}</span>
        <span className="truncate text-stage-gray-ink">{till.session?.register ?? t('pos.bar.noRegister')}</span>
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onSync}
        title={when}
        className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-semibold ${online ? 'bg-pos-online text-pos-online-ink' : 'bg-pos-offline text-pos-offline-ink'}`}
      >
        <span className={`h-2 w-2 rounded-full ${pill.tone === 'online' ? 'bg-green-bright' : pill.tone === 'busy' ? 'bg-indigo-bright' : 'bg-amber'}`} />
        {net}
        {s.refused ? <span className="rounded-full bg-danger px-1.5 text-[11px] text-white">{s.refused}</span> : null}
      </button>
      <span className="shrink-0 font-mono text-[14px] text-stage-ink tabular-nums">{now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
      <span className="h-8 w-px shrink-0 bg-white/[.14]" />
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-bold text-white">{initials(cashier)}</span>
        <div className="min-w-0 max-sm:hidden">
          <div className="truncate text-[13px] font-semibold">{cashier ?? '—'}</div>
          <div className="text-[11px] text-pos-bar-ink">{t('pos.bar.cashier')}</div>
        </div>
      </div>
      <button type="button" aria-label={t('pos.lock')} title={t('pos.lock')} onClick={() => void call('security:lock')} className={glass}>
        <Icon name="lock" size={20} />
      </button>
      <button ref={menuBtn} type="button" aria-label={t('pos.bar.menu')} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} className={glass}>
        <Icon name="list" size={20} />
      </button>
      {menu ? <Menu sections={sections} label={t('pos.bar.menu')} anchor={menuBtn} avoid={bar} prefer="bottom" align="end" width={300} onClose={() => setMenu(false)} /> : null}
      {confirming ? (
        <Modal
          title="Forget this till?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button onClick={() => setConfirming(false)}>Keep it</Button>
              <Button variant="danger" onClick={() => void forget(pending > 0)}>
                Forget the till
              </Button>
            </>
          }
        >
          <p className="text-[13.5px] text-ink">This computer stops being {terminal.name}: its credential, its catalogue copy and its record of sales are removed. To sell here again it is paired anew.</p>
          {till.caps.device_unpair && !till.offline ? <p className="mt-2 text-[13.5px] text-ink-2">{t('pos.dev.unpairNote', { code: terminal.code })}</p> : null}
          {pending > 0 ? <p className="mt-2 text-[13.5px] font-semibold text-danger">{pending} sale(s) have not reached WorkSuite, and will be lost.</p> : null}
        </Modal>
      ) : null}
    </header>
  );
}
