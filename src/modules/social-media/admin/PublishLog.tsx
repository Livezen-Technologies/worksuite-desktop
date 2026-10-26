import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { call, errorMessage, hasDesktop } from '../../../core/bridge';
import { useTab } from '../../../core/tab-context';
import { parseTs } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Button, Modal } from '../../../components/ui';
import { dataOf, rowsOf, SK, socialApi, useAccounts, useInvalidate, useLog, useModuleStatus, type Attempt, type PublishLog as Log } from '../api';
import { useSocialAccess } from '../access';
import { networkInfo } from '../lib/networks';
import { ATTEMPT_OUTCOME, ERROR_CLASS } from '../lib/status';
import { logStamp } from '../lib/time';
import { Field, INPUT, Kpi, NetChip, OptionalView, PageBody, PageHeader, Panel, Pill, pct, full, Table, TD, TR, UnderlineTabs, useBrandScope } from '../parts';
import { useReconnect } from './accounts/flows';
import { StatGrid } from '../../../components/StatCard';

/**
 * A03 · Publishing log (SMM-PUB-003, PUB-011, WF-06, AC-03). Every publish attempt with its time, account, post,
 * outcome, the redacted error class and the attempt count; the fix beside each failure — reconnect and retry for
 * revoked access or a missing permission, retry for the rest — and "Mark as posted" for a manual reminder. The CSV
 * export is built from what is loaded.
 */

type Tab = 'all' | 'failed' | 'manual_reminder' | 'retrying';
const TABS: Tab[] = ['all', 'failed', 'manual_reminder', 'retrying'];

const LOG_KEY = ['social', 'log'] as const;
const FORMULA = /^[=+\-@\t\r]/;

/** A bare handle ("@techhubiz.lk") cannot run as a formula, so it is left readable. */
const HANDLE = /^@[\w.]+$/;

/** One CSV field (RFC 4180), inert in a spreadsheet: a text that starts like a formula gets a leading `'`. */
export function csvField(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (FORMULA.test(s) && !HANDLE.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The loaded attempts as CSV: UTC times, so the file reads the same everywhere. */
export function attemptsCsv(rows: Attempt[]): string {
  const head = ['Time (UTC)', 'Account', 'Network', 'Post', 'Result', 'Error class', 'Provider code', 'Attempts', 'Permalink'];
  const lines = rows.map((a) => {
    const d = parseTs(a.started_at);
    return [
      Number.isNaN(d.getTime()) ? a.started_at : d.toISOString(),
      a.account,
      networkInfo(a.network).label,
      a.post_excerpt,
      ATTEMPT_OUTCOME[a.outcome]?.label ?? a.outcome,
      a.error_class ?? '',
      a.provider_code ?? '',
      `${a.attempt}/${a.max_attempts}`,
      a.permalink ?? '',
    ];
  });
  return [head, ...lines].map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

function MarkPostedModal({ attempt, onClose }: { attempt: Attempt; onClose: () => void }) {
  const invalidate = useInvalidate();
  const [link, setLink] = useState('');
  const m = useMutation({
    mutationFn: () => socialApi.markPosted(attempt.target_id, link.trim() || null),
    onSuccess: () => {
      invalidate(LOG_KEY, SK.postsAll, SK.status);
      toast('success', 'Marked as posted.');
      onClose();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <Modal
      title="Mark as posted"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Mark as posted
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-ink">
        “{attempt.post_excerpt}” on {attempt.account}. Paste the link to the post if you have it, so its results can be read.
      </p>
      <Field label="Link to the post (optional)">
        <input className={INPUT} type="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

function Detail({ a }: { a: Attempt }) {
  if (a.error_class)
    return (
      <span className="font-mono text-[12px] text-danger" title={ERROR_CLASS[a.error_class]?.label ?? a.detail ?? undefined}>
        {a.provider_code ?? a.error_class}
      </span>
    );
  if (a.permalink)
    return (
      <button type="button" onClick={() => void call('app:openExternal', { url: a.permalink! }).catch((e: unknown) => toast('error', errorMessage(e)))} className="text-[12.5px] font-semibold text-primary hover:underline">
        View on {networkInfo(a.network).label}
      </button>
    );
  if (a.outcome === 'manual_reminder') return <span className="text-[12.5px] text-ink-2">{a.reminder_to ? `Reminder sent to ${a.reminder_to.name}` : 'Reminder due'}</span>;
  return a.detail ? <span className="font-mono text-[12px] text-ink-3">{a.detail}</span> : <span className="text-ink-3">—</span>;
}

function LogTable({ log, scopeIds, canAct }: { log: Log; scopeIds: Set<number> | null; canAct: boolean }) {
  const invalidate = useInvalidate();
  const [marking, setMarking] = useState<Attempt | null>(null);
  const [pendingRetry, setPendingRetry] = useState<number | null>(null);
  const retry = useMutation({
    mutationFn: (targetId: number) => socialApi.retry(targetId),
    onMutate: (id) => setPendingRetry(id),
    onSettled: () => setPendingRetry(null),
    onSuccess: () => {
      invalidate(LOG_KEY, SK.postsAll);
      toast('success', 'Retry queued.');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const reconnect = useReconnect(() => {
    if (retryAfter) retry.mutate(retryAfter);
    setRetryAfter(null);
  }, 'I’ve finished — retry now');
  const rows = log.attempts.filter((a) => !scopeIds || scopeIds.has(a.account_id));
  if (!rows.length) return <p className="px-2 py-8 text-center text-[13px] text-ink-3">No publish attempts here.</p>;
  return (
    <>
      <Table head={['Time', 'Account', 'Post', 'Result', 'Detail', 'Attempts', <span key="a" className="sr-only">Action</span>]} minWidth={940}>
        {rows.map((a) => {
          const o = ATTEMPT_OUTCOME[a.outcome] ?? { label: a.outcome, tone: 'muted' as const };
          const needsAuth = a.outcome === 'failed' && (a.error_class === 'auth_revoked' || a.error_class === 'permission_missing');
          return (
            <tr key={a.id} className={TR}>
              <td className={`${TD} font-mono text-[12px] whitespace-nowrap text-ink-2`}>{logStamp(a.started_at)}</td>
              <td className={TD}>
                <span className="flex items-center gap-2">
                  <NetChip network={a.network} size={20} />
                  <span className="truncate text-ink">{a.account}</span>
                </span>
              </td>
              <td className={`${TD} max-w-[280px] truncate text-ink`} title={a.post_excerpt}>
                {a.post_excerpt}
              </td>
              <td className={TD}>
                <Pill tone={o.tone}>{o.label}</Pill>
              </td>
              <td className={TD}>
                <Detail a={a} />
              </td>
              <td className={`${TD} tabular-nums text-ink-2`}>{a.outcome === 'manual_reminder' ? '—' : `${a.attempt} / ${a.max_attempts}`}</td>
              <td className={`${TD} text-right`}>
                {canAct && needsAuth ? (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={reconnect.pendingId === a.account_id || pendingRetry === a.target_id}
                    onClick={() => {
                      setRetryAfter(a.target_id);
                      reconnect.start({ id: a.account_id, display_name: a.account, network: a.network });
                    }}
                  >
                    Reconnect & retry
                  </Button>
                ) : canAct && a.outcome === 'failed' ? (
                  <Button size="sm" loading={pendingRetry === a.target_id} onClick={() => retry.mutate(a.target_id)}>
                    Retry
                  </Button>
                ) : canAct && a.outcome === 'manual_reminder' ? (
                  <Button size="sm" onClick={() => setMarking(a)}>
                    Mark as posted
                  </Button>
                ) : null}
              </td>
            </tr>
          );
        })}
      </Table>
      {reconnect.modal}
      {marking ? <MarkPostedModal attempt={marking} onClose={() => setMarking(null)} /> : null}
    </>
  );
}

export default function PublishLog() {
  const { query } = useTab();
  const status = useModuleStatus();
  const access = useSocialAccess(dataOf(status.data)?.permissions);
  const [tab, setTab] = useState<Tab>(() => {
    const o = query.get('outcome');
    return o && (TABS as string[]).includes(o) ? (o as Tab) : o === 'manual' ? 'manual_reminder' : 'all';
  });
  const q = useLog({ outcome: tab === 'all' ? null : tab });
  const log = dataOf(q.data);
  const accounts = rowsOf(useAccounts().data);
  const [scope] = useBrandScope();
  const scopeIds = scope ? new Set(accounts.filter((a) => a.brand_id === scope).map((a) => a.id)) : null;
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    if (!log) return;
    if (!hasDesktop()) {
      toast('error', 'Saving a file needs WorkSuite Desktop.');
      return;
    }
    setExporting(true);
    try {
      const rows = log.attempts.filter((a) => !scopeIds || scopeIds.has(a.account_id));
      const day = new Date().toISOString().slice(0, 10);
      const where = await call('files:saveText', { name: `publishing-log-${day}.csv`, text: attemptsCsv(rows) });
      if (where) toast('success', `${rows.length} attempts exported.`);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const c = log?.counts;
  const t = log?.totals;
  return (
    <>
      <PageHeader
        crumb="Administer"
        title="Publishing log"
        actions={
          <Button icon="download" loading={exporting} disabled={!log?.attempts.length} onClick={() => void exportCsv()}>
            Export CSV
          </Button>
        }
      />
      <PageBody>
        <div className="flex min-w-0 flex-col gap-4">
          {log && t ? (
            <StatGrid>
              <Kpi icon="send" accent="blue" label="Publish jobs · 30 days" value={full(t.jobs)} />
              <Kpi icon="check-circle" accent="green" label="Succeeded first try" value={t.first_try_rate === null ? null : pct(t.first_try_rate)} />
              <Kpi icon="refresh" accent="amber" label="Retried then succeeded" value={full(t.retried_then_succeeded)} />
              <Kpi icon="x-circle" accent="red" label="Failed" value={full(t.failed)} sub={t.failed_note ?? undefined} tone="danger" />
            </StatGrid>
          ) : null}
          <UnderlineTabs
            label="Outcome"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'all', label: 'All' },
              { id: 'failed', label: 'Failed', count: c?.failed ?? null },
              { id: 'manual_reminder', label: 'Manual reminders', count: c?.manual ?? null },
              { id: 'retrying', label: 'Retrying', count: c?.retrying ?? null },
            ]}
          />
          <Panel bodyClassName="px-2 pb-2 pt-1">
            <OptionalView q={q} what="The publishing log" compact>
              {(data) => <LogTable log={data} scopeIds={scopeIds} canAct={access.publish} />}
            </OptionalView>
          </Panel>
          <div className="rounded-[12px] border border-line bg-surface px-4 py-3 text-[12.5px] text-ink-2">
            <strong className="text-ink">How retries work.</strong> Temporary errors (rate limit, network, 5xx) retry after 1, 5 and 15 minutes. Permanent errors (revoked access, rejected media, policy) stop at once, keep the post on hold and notify its owner and the account owner.
          </div>
        </div>
      </PageBody>
    </>
  );
}
