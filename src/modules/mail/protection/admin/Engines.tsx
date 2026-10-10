import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { dateLabel, timeLabel } from '../../../../core/time';
import { toast } from '../../../../core/toasts';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../../../components/ui';
import { STATE_CHIP } from '../verdicts';
import { adminKeys, restartEngine, runSelfTest, updateSignatures, useEngines } from './api';
import { Card, Dot, NO_MANAGE, ProtTop, ageWords, useAdminPerms } from './parts';
import { engineState } from './Overview';
import type { SelfTest } from '../types';

/**
 * Admin Center › Protection › Engines (D25, P-UI-06, MPR-ADM-04): per host, each engine's version, state, signature
 * version and age and last update; Update signatures now, Restart antivirus (with a reason) and the self-test (EICAR
 * and GTUBE through every path); and the agent's operation log. Every button needs mail.security.manage.
 */
export function Engines() {
  const q = useEngines();
  const qc = useQueryClient();
  const perms = useAdminPerms();
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<SelfTest | null>(null);
  const [restarting, setRestarting] = useState(false);
  const run = async (what: 'update' | 'test') => {
    setBusy(what);
    try {
      if (what === 'update') {
        await updateSignatures();
        toast('success', text('Signature update started. The antivirus reloads when it is done.'));
      } else setTest(await runSelfTest('all'));
      void qc.invalidateQueries({ queryKey: adminKeys.engines });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const noManage = perms.manage ? undefined : text(NO_MANAGE);
  return (
    <div className="flex flex-col gap-3.5">
      <ProtTop
        tab="engines"
        actions={
          <>
            <Button disabled={!perms.manage} title={noManage} onClick={() => setRestarting(true)}>
              {text('Restart antivirus')}
            </Button>
            <Button loading={busy === 'update'} disabled={!perms.manage || !!busy} title={noManage} onClick={() => void run('update')}>
              {text('Update signatures now')}
            </Button>
            <Button variant="primary" loading={busy === 'test'} disabled={!perms.manage || !!busy} title={noManage} onClick={() => void run('test')}>
              {text('Run self-test')}
            </Button>
          </>
        }
      />
      {test ? <SelfTestResult test={test} onClose={() => setTest(null)} /> : null}
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : q.data ? (
        <>
          {q.data.hosts.length === 0 ? <p className="text-[13px] text-ink-3">{text('No protection host has reported yet. Install the protection engines from the mail server’s page.')}</p> : null}
          {q.data.hosts.map((h) => {
            const worst = h.engines.some((e) => e.state === 'down') ? 'down' : h.engines.some((e) => e.state === 'warn') ? 'warn' : 'ok';
            return (
              <div key={h.id} className="flex flex-col gap-2.5">
                <section className="flex items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-selection text-[12px] font-bold text-primary">{h.name.slice(0, 2).toUpperCase()}</span>
                  <b className="flex-1 text-[13.5px] text-ink">{h.name}</b>
                  <span className={cx('inline-flex h-[22px] items-center gap-1.5 rounded-full px-[9px] text-[11.5px] font-bold', worst === 'ok' ? STATE_CHIP.ok : worst === 'warn' ? STATE_CHIP.warn : STATE_CHIP.bad)}>
                    <Dot tone={worst} />
                    {worst === 'ok' ? text('All engines healthy') : worst === 'warn' ? text('An engine needs attention') : text('An engine is down')}
                  </span>
                </section>
                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 2xl:grid-cols-4">
                  {h.engines.map((e) => (
                    <div key={e.key} className="flex flex-col gap-1 rounded-[12px] border border-line bg-surface px-3.5 py-3">
                      <div className="flex items-center gap-2">
                        <Dot tone={e.state === 'ok' ? 'ok' : e.state === 'warn' ? 'warn' : e.state === 'down' ? 'down' : 'off'} />
                        <b className="text-[13px] text-ink">{e.name}</b>
                        <span className="text-[11.5px] text-ink-3">· {engineState(e.state)}</span>
                      </div>
                      <span className="text-[17px] font-bold text-ink">{e.version ?? '—'}</span>
                      <span className="text-[11.5px] leading-[1.4] text-ink-2">{e.detail}</span>
                      {e.signature_version ? (
                        <span className={cx('text-[11.5px]', (e.signature_age_s ?? 0) > 86_400 ? 'font-semibold text-danger' : 'text-ink-3')}>
                          {text('Signatures {v} · updated {age}', { v: e.signature_version, age: ageWords(e.signature_age_s) })}
                          {(e.signature_age_s ?? 0) > 86_400 ? ` · ${text('older than 24 h')}` : ''}
                        </span>
                      ) : null}
                      {e.last_update_result ? <span className="text-[11.5px] text-ink-3">{text('Last update: {result}', { result: e.last_update_result })}</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <Card title={text('Activity')}>
            {q.data.log.length === 0 ? <p className="text-[12.5px] text-ink-3">{text('Nothing yet.')}</p> : null}
            {q.data.log.slice(0, 40).map((l, i) => (
              <div key={`${l.at}-${i}`} className="flex gap-2.5 text-[12.5px] leading-[1.4]">
                <span className="w-[110px] shrink-0 text-[11.5px] text-ink-3">{`${dateLabel(l.at)} ${timeLabel(l.at)}`}</span>
                <span className="mt-[5px]">
                  <Dot tone={/fail|error|down/i.test(l.result) ? 'danger' : /warn|retry|slow/i.test(l.result) ? 'warn' : /ok|pass|done|success/i.test(l.result) ? 'ok' : 'neutral'} />
                </span>
                <span className="text-ink">
                  <b className="font-semibold">{l.operation}</b> · {l.result}
                  {l.detail ? ` · ${l.detail}` : ''}
                  {l.actor ? <span className="text-ink-3"> · {l.actor}</span> : null}
                </span>
              </div>
            ))}
          </Card>
        </>
      ) : null}
      {restarting ? <RestartDialog onClose={() => setRestarting(false)} /> : null}
    </div>
  );
}

/** The self-test on every path (AC-MPR-01..04): expected against what happened, passed or failed, in words. */
export function SelfTestResult({ test, onClose }: { test: SelfTest; onClose: () => void }) {
  const passed = test.paths.filter((p) => p.passed).length;
  return (
    <Card title={text('Last self-test')} extra={<span className="text-[12px] text-ink-3">{text('{date} · {n} of {total} passed', { date: `${dateLabel(test.ran_at)} ${timeLabel(test.ran_at)}`, n: passed, total: test.paths.length })}</span>}>
      <div role="table" aria-label={text('Self-test')} className="flex flex-col text-[12.5px]">
        <div role="row" className="grid grid-cols-[110px_1fr_1fr_80px] gap-3 py-1 text-[11.5px] font-semibold text-ink-3">
          <span role="columnheader">{text('Sample')}</span>
          <span role="columnheader">{text('Path')}</span>
          <span role="columnheader">{text('Result')}</span>
          <span role="columnheader">{text('Status')}</span>
        </div>
        {test.paths.map((p, i) => (
          <div key={`${p.path}-${p.kind}-${i}`} role="row" data-self-test={p.passed ? 'pass' : 'fail'} className="grid grid-cols-[110px_1fr_1fr_80px] gap-3 border-t border-line py-1.5">
            <b role="cell" className="text-ink">{p.kind}</b>
            <span role="cell" className="text-ink-2">{p.path}</span>
            <span role="cell" className="text-ink-2" title={text('Expected: {e}', { e: p.expected })}>{p.got}</span>
            <span role="cell">
              <span className={cx('inline-flex h-[22px] items-center rounded-full px-[9px] text-[11.5px] font-bold', p.passed ? STATE_CHIP.ok : STATE_CHIP.bad)}>{p.passed ? text('Passed') : text('Failed')}</span>
            </span>
          </div>
        ))}
      </div>
      <Button size="sm" className="self-start" onClick={onClose}>
        {text('Close')}
      </Button>
    </Card>
  );
}

function RestartDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await restartEngine('clamd', reason.trim());
      toast('success', text('The antivirus is restarting. Mail waits and is not reported clean meanwhile.'));
      void qc.invalidateQueries({ queryKey: adminKeys.engines });
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={text('Restart antivirus')}
      labelledBy="restart-av"
      width={440}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>{text('Cancel')}</Button>
          <Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={() => void go()}>{text('Restart')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 p-4 text-[13px] text-ink">
        <p>{text('While it restarts, mail through the WorkSuite mail server is held and retried, and connected accounts show “Not scanned”.')}</p>
        <label htmlFor="restart-reason" className="text-[12.5px] font-semibold text-ink-2">{text('Reason (recorded in the audit log)')}</label>
        <input id="restart-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} className="h-8 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink" />
      </div>
    </Modal>
  );
}
