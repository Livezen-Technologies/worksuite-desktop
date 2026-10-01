import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { RestaurantPrinterMap, RestaurantPrintPatch, RestaurantPrintSettings } from '@shared/restaurant';
import { Select } from '../../components/Select';
import { Button, Card, Spinner, Switch, cx } from '../../components/ui';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { bridge, get, K, refusal, write, type PrintJob, type Structure } from './api';
import { useT } from './i18n';
import { Failed, Heading, Note, useTill } from './parts';
import { Checkbox } from '../../components/Checkbox';

/**
 * The printers this computer hosts (RM-DSK-003, §4.4): which printer on this
 * computer each of the server's printers is — printed raw (ESC/POS) to a
 * thermal printer, or through the OS driver — the print agent on or off, the
 * cash drawer behind the receipt printer, a test print, what the agent
 * printed lately, and the branch's print queue with reprints.
 *
 * The mapping is kept on this computer (which printers are plugged in is a
 * fact about it); the agent claims jobs only for the printers mapped here.
 */
const NONE = '';

export default function Printers() {
  const t = useT();
  const till = useTill();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const settings = useQuery({ queryKey: ['restaurant', 'print-settings'], queryFn: bridge.printSettings });
  const installed = useQuery({ queryKey: ['restaurant', 'os-printers'], queryFn: () => call('print:printers', undefined) });
  const structure = useQuery({ queryKey: K.structure(till.org, till.branch), queryFn: ({ signal }) => get<Structure>('/structure', { branch_id: till.branch }, signal), enabled: !till.offline });
  const log = useQuery({ queryKey: ['restaurant', 'print-log'], queryFn: bridge.printJobs, refetchInterval: 5_000 });
  const queue = useQuery({
    queryKey: K.printJobs(till.branch),
    queryFn: ({ signal }) => get<{ jobs: PrintJob[] }>('/print-jobs', { branch_id: till.branch, limit: 30 }, signal).then((d) => d.jobs),
    enabled: !till.offline,
    refetchInterval: 10_000,
  });

  async function save(patch: RestaurantPrintPatch) {
    setBusy('save');
    try {
      const next = await call('restaurant:printSettingsSet', patch);
      qc.setQueryData<RestaurantPrintSettings>(['restaurant', 'print-settings'], next);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : t('printers.notSaved'));
    } finally {
      setBusy(null);
    }
  }

  async function run(what: string, fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(what);
    try {
      const o = await fn();
      toast(o.ok ? 'success' : 'warning', o.message);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function reprint(j: PrintJob) {
    setBusy(`reprint-${j.id}`);
    try {
      const r = await write(`/print-jobs/${j.id}/reprint`, {});
      toast('success', r.message ?? t('printers.reprinted'));
      void qc.invalidateQueries({ queryKey: K.printJobs(till.branch) });
      void call('restaurant:printNow');
    } catch (e) {
      toast('error', refusal(e).message);
    } finally {
      setBusy(null);
    }
  }

  if (settings.isError) return <div className="p-6"><Failed text={t('printers.unreadable')} onRetry={() => void settings.refetch()} /></div>;
  if (!settings.data) return <Spinner />;
  const s = settings.data;
  const names = (installed.data ?? []).map((p) => ({ value: p.name, label: p.displayName || p.name }));
  const server = (structure.data?.printers ?? []).filter((p) => p.active !== false && p.branch_id === till.branch);
  const mine = server.filter((p) => p.host_terminal_id === till.pairing.terminal_id || (till.pairing.mode === 'print_host' && p.host_terminal_id === null));
  const others = server.filter((p) => !mine.includes(p));
  const mapOf = (id: number): RestaurantPrinterMap => s.printers[String(id)] ?? { device: null, mode: 'escpos', paper: p80(server.find((x) => x.id === id)?.paper), cut: true };
  const setMap = (id: number, m: Partial<RestaurantPrinterMap>) => {
    const next = { ...mapOf(id), ...m };
    void save({ printers: { [String(id)]: next.device ? next : null } });
  };

  return (
    <div className="flex max-w-[900px] flex-col gap-4 p-6">
      <Heading title={t('printers.title')} hint={t('printers.hint')} />
      {installed.isSuccess && names.length === 0 ? <Note tone="warning">{t('printers.noneInstalled')}</Note> : null}
      {till.status?.agent.problem ? <Note tone="danger">{till.status.agent.problem}</Note> : null}

      <Card title={t('printers.agent')}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-ink">{t('printers.agentOn')}</div>
            <div className="text-[12px] text-ink-3">{t('printers.agentHint')}</div>
            {till.status?.agent.last_claim_at ? <div className="mt-1 text-[12px] text-ink-3">{t('printers.lastClaim', { at: new Date(till.status.agent.last_claim_at).toLocaleTimeString() })}</div> : null}
          </div>
          <Switch checked={s.agent} onChange={(agent) => void save({ agent })} label={t('printers.agentOn')} />
        </div>
      </Card>

      <Card title={t('printers.hosted')}>
        {till.offline ? <Note tone="muted">{t('printers.offline')}</Note> : null}
        {structure.isLoading ? <Spinner /> : null}
        {structure.isSuccess && mine.length === 0 ? <p className="text-[13px] text-ink-3">{t('printers.noneHosted')}</p> : null}
        <div className="flex flex-col divide-y divide-line">
          {[...mine, ...others].map((p) => {
            const m = mapOf(p.id);
            const gone = !!m.device && installed.isSuccess && !names.some((n) => n.value === m.device);
            return (
              <div key={p.id} className={cx('flex flex-col gap-2 py-3', !mine.includes(p) && 'opacity-80')}>
                <div className="flex items-baseline gap-2">
                  <span className="font-bold text-ink">{p.name}</span>
                  <span className="text-[12px] text-ink-3">
                    {t(`printers.kind.${p.kind}` as never)} · {p.connection}
                    {p.address ? ` · ${p.address}` : ''} · {p.paper}
                  </span>
                  {!mine.includes(p) ? <span className="ms-auto text-[11.5px] text-ink-3">{t('printers.notHosted')}</span> : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                  <Select label={t('printers.device')} value={m.device ?? NONE} loading={installed.isLoading} options={[{ value: NONE, label: t('printers.notHere') }, ...names]} onValueChange={(v) => setMap(p.id, { device: v || null })} />
                  <Select
                    label={t('printers.mode')}
                    value={m.mode}
                    options={[
                      { value: 'escpos', label: t('printers.escpos') },
                      { value: 'page', label: t('printers.page') },
                    ]}
                    onValueChange={(v) => setMap(p.id, { mode: v === 'page' ? 'page' : 'escpos' })}
                  />
                  <Select
                    label={t('printers.paper')}
                    value={m.paper}
                    options={[
                      { value: '80mm', label: '80 mm' },
                      { value: '58mm', label: '58 mm' },
                    ]}
                    onValueChange={(v) => setMap(p.id, { paper: v === '58mm' ? '58mm' : '80mm' })}
                  />
                  <Button icon="printer" disabled={!m.device} loading={busy === `test-${p.id}`} onClick={() => void run(`test-${p.id}`, () => call('restaurant:printTest', { printer_id: p.id }))}>
                    {t('printers.test')}
                  </Button>
                </div>
                {m.mode === 'escpos' ? (
                  <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
                    <Checkbox checked={m.cut} disabled={!m.device} onChange={(e) => setMap(p.id, { cut: e.target.checked })} /> {t('printers.cut')}
                  </label>
                ) : null}
                {gone ? <span className="text-[12px] font-semibold text-warning">{t('printers.gone', { name: m.device ?? '' })}</span> : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card title={t('printers.drawer')}>
        <div className="flex flex-col gap-3">
          <Select
            label={t('printers.drawerPrinter')}
            value={s.drawer_printer_id ? String(s.drawer_printer_id) : NONE}
            options={[{ value: NONE, label: t('printers.noDrawer') }, ...server.filter((p) => s.printers[String(p.id)]).map((p) => ({ value: String(p.id), label: p.name }))]}
            onValueChange={(v) => void save({ drawer_printer_id: v ? Number(v) : null })}
          />
          <Select
            label={t('printers.drawerPin')}
            value={String(s.drawer_pin)}
            options={[
              { value: '2', label: t('printers.pin', { n: 2 }) },
              { value: '5', label: t('printers.pin', { n: 5 }) },
            ]}
            onValueChange={(v) => void save({ drawer_pin: v === '5' ? 5 : 2 })}
          />
          <div>
            <Button icon="banknote" disabled={!s.drawer_printer_id} loading={busy === 'drawer'} onClick={() => void run('drawer', () => call('restaurant:openDrawer'))}>
              {t('printers.openDrawer')}
            </Button>
          </div>
        </div>
      </Card>

      <Card title={t('printers.recent')} action={<Button size="sm" icon="refresh" loading={busy === 'now'} onClick={() => void run('now', async () => ({ ok: true, message: t('printers.printedN', { n: await call('restaurant:printNow') }) }))}>{t('printers.printNow')}</Button>}>
        {(log.data ?? []).length === 0 ? <p className="text-[13px] text-ink-3">{t('printers.nothingYet')}</p> : null}
        <ul className="flex flex-col gap-1 text-[12.5px]">
          {(log.data ?? []).slice(0, 15).map((j) => (
            <li key={`${j.job_id}-${j.at}`} className="flex gap-2">
              <span className={cx('w-2 shrink-0 self-center rounded-full', j.ok ? 'h-2 bg-success' : 'h-2 bg-danger')} />
              <span className="w-16 shrink-0 text-ink-3 tabular-nums">{new Date(j.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="min-w-0 flex-1 text-ink">
                {j.document} #{j.job_id}
                {j.reprint ? ` · ${t('printers.reprint')}` : ''} · {j.printer_name ?? j.device ?? ''}
              </span>
              <span className={j.ok ? 'text-ink-2' : 'text-danger'}>{j.message}</span>
            </li>
          ))}
        </ul>
      </Card>

      {!till.offline ? (
        <Card title={t('printers.queue')}>
          {queue.isError ? <Failed text={refusal(queue.error).message} onRetry={() => void queue.refetch()} /> : null}
          <ul className="flex flex-col divide-y divide-line text-[12.5px]">
            {(queue.data ?? []).map((j) => (
              <li key={j.id} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1">
                  {j.document} #{j.id} · {j.ref_type} {j.ref_id}
                  {j.last_error ? <span className="block text-danger">{j.last_error}</span> : null}
                </span>
                <span className="text-ink-2">{j.status_label}</span>
                <Button size="sm" loading={busy === `reprint-${j.id}`} onClick={() => void reprint(j)}>
                  {t('printers.reprint')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function p80(paper: string | undefined): '80mm' | '58mm' {
  return paper === '58mm' ? '58mm' : '80mm';
}
