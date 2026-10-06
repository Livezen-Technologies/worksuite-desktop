import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { PosTillStatus } from '@shared/pos';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { app } from '../../core/app-state';
import { call, DesktopError } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { fetchSetup, pairTill, PK, type PosBindable } from './api';
import { useT, type PosKey } from './i18n';
import { Failed, Note, PosButton } from './parts';
import { Mark } from './TillBar';

/**
 * Making this computer a till, on two panes: what pairing is (the person signs in once; the computer gets a
 * credential of its own for the till, kept in its secure storage, that a manager can revoke) and where they are in
 * it; then the tills the signed-in person may pair with (`GET api/pos/setup`, their companies'), each free or in use
 * on another device. A till in use is taken over only when the person says so, on the button. Tills are added, and
 * named, on the web.
 */
export default function Connect({ status, onChange }: { status: PosTillStatus; onChange: () => void }) {
  const t = useT();
  const setup = useQuery({ queryKey: PK.setup, queryFn: ({ signal }) => fetchSetup(signal), retry: false });
  const name = useStore(app, (s) => s.bootstrap?.user.name ?? s.auth?.user?.name ?? null);
  const server = useStore(app, (s) => s.auth?.server?.origin ?? null);
  const info = useStore(app, (s) => s.info);
  const [chosen, setChosen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<{ id: number; message: string } | null>(null);
  const revoked = status.till?.state === 'revoked' ? status.till.terminal : null;
  const list = setup.data?.terminals ?? [];
  const till = list.find((x) => x.id === (chosen ?? revoked?.id ?? (list.length === 1 ? list[0]!.id : null))) ?? null;
  const takeOver = !!till && (till.in_use || conflict?.id === till.id);

  async function pair(x: PosBindable, over: boolean) {
    setBusy(true);
    try {
      const r = await pairTill(x.id, over);
      toast('success', r.message);
      setConflict(null);
      onChange();
    } catch (e) {
      if (e instanceof DesktopError && e.code === 'CONFLICT' && !over) setConflict({ id: x.id, message: e.message });
      else toast('error', e instanceof Error ? e.message : 'The till could not be paired.');
    } finally {
      setBusy(false);
    }
  }

  const steps: Array<{ label: PosKey; state: 'done' | 'now' | 'next' }> = [
    { label: 'pos.pairing.step1', state: 'done' },
    { label: 'pos.pairing.step2', state: 'now' },
    { label: 'pos.pairing.step3', state: 'next' },
  ];

  return (
    <div className="pos-scope flex h-full min-h-[560px] overflow-hidden text-ink">
      <div className="flex w-[560px] shrink-0 flex-col gap-[22px] overflow-y-auto bg-pos-bar p-14 text-white scroll-thin max-xl:w-[420px] max-xl:p-10">
        <div className="flex items-center gap-3">
          <Mark size={32} />
          <span className="text-[24px] font-extrabold">{t('pos.bar.brand')}</span>
        </div>
        <h1 className="text-[38px] leading-[1.15] font-extrabold max-xl:text-[30px]">{t('pos.pairing.headline')}</h1>
        <p className="text-[15px] leading-relaxed text-[#cbd5e1]">{t('pos.pairing.explain')}</p>
        <div className="mt-auto flex flex-col gap-3.5">
          {steps.map((s, i) => (
            <div key={s.label} className="flex items-center gap-3.5">
              <span className={cx('flex h-[34px] w-[34px] items-center justify-center rounded-full text-[14px] font-extrabold', s.state === 'done' ? 'bg-teal-light text-navy' : s.state === 'now' ? 'bg-white text-navy' : 'bg-white/[.12] text-[#cbd5e1]')}>
                {s.state === 'done' ? <Icon name="check" size={16} strokeWidth={2.4} /> : i + 1}
              </span>
              <span className={cx('text-[15px]', s.state === 'now' ? 'font-extrabold' : 'font-medium', s.state === 'next' ? 'text-[#94a3b8]' : 'text-white')}>{t(s.label)}</span>
            </div>
          ))}
        </div>
        <div className="text-[12px] text-[#94a3b8]">{[server ? t('pos.pairing.server', { host: server.replace(/^https?:\/\//, '') }) : null, info ? `WorkSuite Desktop ${info.version}` : null, info?.osVersion].filter(Boolean).join(' · ')}</div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto bg-pos-ground px-[72px] py-14 scroll-thin max-xl:px-10">
        {name ? <div className="text-[13px] text-ink-3">{t('pos.pairing.signedIn', { name })}</div> : null}
        <h2 className="text-[28px] font-extrabold">{t('pos.pairing.which')}</h2>
        <p className="text-[14px] text-ink-2">{t('pos.pairing.only')}</p>
        {revoked ? (
          <Note tone="warning">
            WorkSuite no longer accepts this computer as {revoked.name} (it was revoked, paired elsewhere, or not used for 90 days).{' '}
            {status.waiting + status.refused > 0 ? `${status.waiting + status.refused} sale(s) wait here; pair it with ${revoked.name} again and they are sent.` : 'Pair it again to sell.'}
          </Note>
        ) : null}
        {setup.isLoading ? <Spinner label="Finding your tills…" /> : null}
        {setup.isError ? <Failed text={setup.error instanceof Error ? setup.error.message : 'Your tills could not be listed.'} onRetry={() => void setup.refetch()} /> : null}
        {setup.isSuccess && list.length === 0 ? (
          <Note
            action={
              <PosButton className="h-touch px-3 text-[13px]" onClick={() => void call('app:openInBrowser', { path: '/pos' })}>
                On the web
              </PosButton>
            }
          >
            There is no till you may pair with. A manager adds tills (and their sales channel) on the web.
          </Note>
        ) : null}
        <div role="radiogroup" aria-label={t('pos.pairing.which')} className="flex flex-col gap-3">
          {list.map((x) => {
            const on = till?.id === x.id;
            return (
              <button
                key={x.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setChosen(x.id)}
                className={cx('flex items-center gap-3.5 rounded-pos-lg bg-pos-panel p-4 text-left', on ? 'shadow-[inset_0_0_0_2px_var(--pos-on-ring)]' : 'shadow-[inset_0_0_0_1px_var(--pos-line)]')}
              >
                <span className="rounded-[8px] bg-pos-key px-2.5 py-1.5 font-mono text-[15px] font-bold">{x.code}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[16px] font-bold">{x.name}</span>
                  <span className="truncate text-[13px] text-ink-3">{[x.branch_name, x.warehouse_name, x.org_name].filter(Boolean).join(' · ')}</span>
                </span>
                <span className={cx('shrink-0 rounded-full px-3 py-1 text-[12px] font-bold', x.in_use ? 'bg-warning-bg text-warning-ink' : 'bg-success-bg text-success')}>
                  {x.in_use ? t('pos.pairing.inUse', { device: x.device_name ?? t('pos.pairing.anotherDevice') }) : t('pos.pairing.free')}
                </span>
              </button>
            );
          })}
        </div>
        {till && takeOver ? (
          <div className="rounded-pos bg-warning-bg px-4 py-3.5 text-[14px] text-warning-ink shadow-[inset_0_0_0_1px_var(--ws-note-line)]">
            {conflict?.id === till.id ? `${conflict.message} ` : ''}
            {t('pos.pairing.takeOverNote', { code: till.code, device: till.device_name ?? t('pos.pairing.anotherDevice') })}
          </div>
        ) : null}
        <div className="mt-auto flex gap-2.5 pt-4">
          <PosButton tone="primary" className="h-touch-lg flex-1 text-[17px] font-extrabold" disabled={!till || busy} onClick={() => till && void pair(till, takeOver)}>
            {busy ? <Icon name="spinner" size={18} className="animate-spin" /> : null}
            {!till ? t('pos.pairing.choose') : takeOver ? t('pos.pairing.takeOver', { code: till.code }) : t('pos.pairing.pair', { code: till.code })}
          </PosButton>
        </div>
      </div>
    </div>
  );
}
