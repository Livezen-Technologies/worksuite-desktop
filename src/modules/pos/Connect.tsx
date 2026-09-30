import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { PosTillStatus } from '@shared/pos';
import { Icon } from '../../components/Icon';
import { Button, Card, Modal, Spinner, cx } from '../../components/ui';
import { call, DesktopError } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { fetchSetup, pairTill, PK, type PosBindable } from './api';
import { useT } from './i18n';
import { Failed, Note } from './parts';

/**
 * Making this computer a till: the tills the signed-in person may pair with (`GET api/pos/setup`, their companies'),
 * and pairing one. The credential WorkSuite hands over goes straight to the OS keystore in the main process; this
 * screen sees only which till it now is. A till another device holds is taken over only when the person says so.
 */
export default function Connect({ status, onChange }: { status: PosTillStatus; onChange: () => void }) {
  const t = useT();
  const setup = useQuery({ queryKey: PK.setup, queryFn: ({ signal }) => fetchSetup(signal), retry: false });
  const [busy, setBusy] = useState<number | null>(null);
  const [takeOver, setTakeOver] = useState<{ till: PosBindable; message: string } | null>(null);
  const revoked = status.till?.state === 'revoked' ? status.till.terminal : null;

  async function pair(till: PosBindable, over: boolean) {
    setBusy(till.id);
    try {
      const r = await pairTill(till.id, over);
      toast('success', r.message);
      setTakeOver(null);
      onChange();
    } catch (e) {
      if (e instanceof DesktopError && e.code === 'CONFLICT' && !over && till.in_use) setTakeOver({ till, message: e.message });
      else toast('error', e instanceof Error ? e.message : 'The till could not be paired.');
    } finally {
      setBusy(null);
    }
  }

  const list = setup.data?.terminals ?? [];
  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-4 p-6">
      <div>
        <h1 className="text-[22px] font-extrabold text-ink">{t('pos.pairTitle')}</h1>
        <p className="mt-1 text-[13px] text-ink-2">
          Pair this computer with one of your company’s tills. It is given a credential of its own, kept in this computer’s secure storage, so it can keep sending its sales — overnight, after a power cut, whoever is signed in. Tills are added on the web.
        </p>
      </div>
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
            <Button size="sm" icon="external" onClick={() => void call('app:openInBrowser', { path: '/pos' })}>
              On the web
            </Button>
          }
        >
          There is no till you may pair with. A manager adds tills (and their sales channel) on the web.
        </Note>
      ) : null}
      {list.length > 0 ? (
        <Card title="Your tills">
          <ul className="flex flex-col divide-y divide-line">
            {list.map((till) => (
              <li key={till.id} className={cx('flex items-center gap-3 py-2.5', revoked?.id === till.id && 'font-semibold')}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-subtle text-ink-2">
                  <Icon name="store" size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] text-ink">
                    {till.name} <span className="text-ink-3">· {till.code}</span>
                  </div>
                  <div className="truncate text-[12px] text-ink-3">
                    {[till.org_name, till.branch_name, till.warehouse_name].filter(Boolean).join(' · ')}
                    {till.in_use ? ` · in use on ${till.device_name ?? 'another device'}` : ''}
                  </div>
                </div>
                <Button variant={till.in_use ? 'secondary' : 'primary'} loading={busy === till.id} onClick={() => void pair(till, false)}>
                  {t('pos.pair')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {takeOver ? (
        <Modal
          title={`Take over ${takeOver.till.name}?`}
          onClose={() => setTakeOver(null)}
          footer={
            <>
              <Button onClick={() => setTakeOver(null)}>Cancel</Button>
              <Button variant="danger" loading={busy === takeOver.till.id} onClick={() => void pair(takeOver.till, true)}>
                {t('pos.takeOver')}
              </Button>
            </>
          }
        >
          <p className="text-[13.5px] text-ink">{takeOver.message}</p>
          <p className="mt-2 text-[13px] text-ink-2">Sales still waiting on that device reach WorkSuite only if it is paired again.</p>
        </Modal>
      ) : null}
    </div>
  );
}
