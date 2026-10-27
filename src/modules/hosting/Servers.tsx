import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ContextMenu } from '../../components/ContextMenu';
import { ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { confirmsName, fetchServers, K, money, offers, serverAction, serverTask, type Org, type PowerAction, type Server, type ServerDetail } from './api';
import type { Nav } from './HostingShell';
import { Btn, Days, ExportButton, Field, PageHead, input, statusTone, useReadOnly } from './parts';
import { ServerForm } from './ServerForm';
import { withStepUp } from './StepUp';

/**
 * Servers (D-04, HDM-SRV-01/02/04) from `GET servers` (Servers::shape): a grid of cards — provider, address, plan,
 * the domains pointing here, paid-until — with the monthly total per currency as the server sums it (`summary.costs`).
 * Add server; right-click a card to open, edit or create a renewal task. Power on, reboot and power off where the
 * provider's API has them (`supports` has `server_actions`); power off asks for the server's name to be typed (SRV-04)
 * and for the person to confirm it is them (HDM-SEC-05).
 */
export default function Servers({ org, nav, add, companies }: { org: number; nav: Nav; active: boolean; add?: boolean; companies: Org[] }) {
  const ro = useReadOnly();
  const [q, setQ] = useState('');
  const params = { org: org || undefined, per_page: 200, q: q.trim() || undefined, sort: 'name' };
  const list = useQuery({ queryKey: K.servers(params), queryFn: ({ signal }) => fetchServers(params, signal) });
  const [power, setPower] = useState<{ s: Server; action: PowerAction } | null>(null);
  const [form, setForm] = useState<{ s?: Server } | null>(add && !ro ? {} : null);
  const [menu, setMenu] = useState<{ x: number; y: number; s: Server } | null>(null);
  if (list.isPending) return <Spinner />;
  if (list.isError) return <ErrorNote error={list.error} onRetry={() => void list.refetch()} />;
  const items = list.data.items;
  const totals = monthlyTotals(list.data.summary.costs ?? []);
  const sum = list.data.summary;
  const task = async (s: Server) => {
    try {
      const m = await serverTask(s.id);
      toast(m === null ? 'info' : 'success', m === null ? text('Renewal tasks need a server update.') : m || text('Renewal task created.'));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const off = ro ? text('Needs a connection') : undefined;
  return (
    <div className="flex flex-col gap-3">
      <PageHead title="Servers" sub={[text('{n} servers', { n: list.data.total }), totals ? text('{totals} a month', { totals }) : null, sum.within_30 ? text('{n} due within 30 days', { n: sum.within_30 }) : null, sum.expired ? text('{n} past their paid date', { n: sum.expired }) : null].filter(Boolean).join(' · ')}>
        <input aria-label="Search servers" placeholder="Search servers" value={q} onChange={(e) => setQ(e.target.value)} className={cx(input, 'w-[200px]')} />
        <ExportButton kind="servers" query={{ org: params.org, q: params.q }} disabled={ro} />
        <Btn primary disabled={ro} title={off} onClick={() => setForm({})}>
          Add server
        </Btn>
      </PageHead>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {items.map((s) => (
          <ServerCard
            key={s.id}
            s={s}
            nav={nav}
            onPower={(action) => setPower({ s, action })}
            onMenu={(x, y) => setMenu({ x, y, s })}
          />
        ))}
      </div>
      {!items.length ? <p className="m-0 text-[12.5px] text-ink-3">{q ? 'No servers match.' : 'No servers in the register yet.'}</p> : null}
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={text('{name} actions', { name: menu.s.name })}
          onClose={() => setMenu(null)}
          sections={[
            {
              id: 'open',
              items: [
                { id: 'open', label: text('Open'), onSelect: () => nav.openServer(menu.s.id, 'here', menu.s.name) },
                { id: 'tab', label: text('Open in new tab'), onSelect: () => nav.openServer(menu.s.id, 'tab', menu.s.name) },
                { id: 'window', label: text('Pop out'), onSelect: () => nav.openServer(menu.s.id, 'window', menu.s.name) },
              ],
            },
            {
              id: 'do',
              items: [
                { id: 'edit', label: text('Edit…'), disabled: ro, reason: off, onSelect: () => setForm({ s: menu.s }) },
                { id: 'task', label: text('Create renewal task'), disabled: ro, reason: off, onSelect: () => void task(menu.s) },
                ...(menu.s.ipv4 ? [{ id: 'copy', label: text('Copy IPv4 address'), onSelect: () => void navigator.clipboard.writeText(menu.s.ipv4!).then(() => toast('success', text('Copied {name}.', { name: menu.s.ipv4! }))) }] : []),
              ],
            },
          ]}
        />
      ) : null}
      {form ? <ServerForm server={form.s} companies={companies} org={org} onClose={() => setForm(null)} onSaved={(s) => !form.s && s?.id && nav.openServer(s.id, 'here', s.name)} /> : null}
      {power ? <PowerDialog s={power.s} action={power.action} onClose={() => setPower(null)} /> : null}
    </div>
  );
}

/** "EUR 214.60 + USD 71.08": the server's own monthly figure per currency (`summary.costs`), only formatted here. */
export function monthlyTotals(costs: Array<{ currency: string; monthly: number }>): string {
  return costs.filter((c) => Number.isFinite(c.monthly)).map((c) => money(c.monthly, c.currency)).join(' + ');
}

/** Power actions are one capability at the provider: `server_actions` (Actions::capability). */
export const supports = (s: Pick<Server, 'supports'>, _a: PowerAction) => offers(s, 'server_actions');
export const isRunning = (s: Pick<Server, 'status'>) => (s.status ?? '').toLowerCase() === 'active' || (s.status ?? '').toLowerCase() === 'running';

function ServerCard({ s, nav, onPower, onMenu }: { s: Server; nav: Nav; onPower: (a: PowerAction) => void; onMenu: (x: number, y: number) => void }) {
  const ro = useReadOnly();
  const tone = statusTone(s.status);
  const off = ro ? 'Needs a connection' : undefined;
  const running = isRunning(s);
  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-surface px-3.5 py-3"
    >
      <div className="flex items-center gap-2">
        <span className={cx('size-2 shrink-0 rounded-full', tone === 'green' ? 'bg-success' : tone === 'red' ? 'bg-danger' : 'bg-muted')} title={s.status_label ?? s.status ?? undefined} />
        <button type="button" className="min-w-0 flex-1 truncate text-left text-[13.5px] font-bold text-ink hover:underline" onClick={(e) => nav.openServer(s.id, e.metaKey || e.ctrlKey ? 'tab' : 'here', s.name)}>
          {s.name}
        </button>
        <span className="text-[11.5px] text-ink-3">{s.provider_label ?? s.provider ?? ''}</span>
      </div>
      <div className="font-mono text-[11.5px] text-ink-2">{s.ipv4 ?? s.ipv6 ?? '—'}</div>
      <div className="truncate text-[12px] text-ink-2">{[s.plan, s.cpu ? text('{v} CPU', { v: s.cpu }) : null, s.ram].filter(Boolean).join(' · ') || s.kind_label || '—'}</div>
      <div className="flex items-center gap-3 text-[11.5px] text-ink-3">
        <span>{text('{n} domains', { n: s.domains ?? 0 })}</span>
        {typeof s.cost_monthly === 'number' ? <span>{text('{v} a month', { v: money(s.cost_monthly, s.cost_currency) })}</span> : null}
        {s.expires_on ? <Days days={s.days_left ?? null} /> : null}
        {!running ? <span>{s.status_label ?? s.status}</span> : null}
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <Btn onClick={() => nav.openServer(s.id, 'window', s.name)}>Pop out</Btn>
        {supports(s, 'reboot') ? (
          running ? (
            <>
              <Btn disabled={ro} title={off} onClick={() => onPower('reboot')}>
                Reboot
              </Btn>
              <Btn danger disabled={ro} title={off} onClick={() => onPower('power_off')}>
                Power off
              </Btn>
            </>
          ) : (s.status ?? '') !== 'cancelled' ? (
            <Btn disabled={ro} title={off} onClick={() => onPower('power_on')}>
              Power on
            </Btn>
          ) : null
        ) : null}
      </div>
    </div>
  );
}

export function PowerDialog({ s, action, onClose }: { s: Server | ServerDetail; action: PowerAction; onClose: () => void }) {
  const qc = useQueryClient();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const typedOk = action !== 'power_off' || confirmsName(typed, s.name);
  const served = ('domains_list' in s ? (s.domains_list ?? []) : []).map((d) => d.name);
  const provider = s.provider_label ?? s.provider ?? text('The provider');
  const go = async () => {
    if (!typedOk || busy) return;
    setBusy(true);
    try {
      const r = await withStepUp(text('Powering off {name}', { name: s.name }), (p) => serverAction(s.id, action, action === 'power_off' ? typed.trim() : undefined, p));
      toast('success', r.message || (action === 'power_off' ? text('Powering off {name}.', { name: s.name }) : action === 'reboot' ? text('Rebooting {name}.', { name: s.name }) : text('Starting {name}.', { name: s.name })));
      void qc.invalidateQueries({ queryKey: ['hosting', 'servers'] });
      void qc.invalidateQueries({ queryKey: K.server(s.id) });
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const title = action === 'power_off' ? text('Power off {name}?', { name: s.name }) : action === 'reboot' ? text('Reboot {name}?', { name: s.name }) : text('Power on {name}?', { name: s.name });
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn danger={action !== 'power_on'} primary={action === 'power_on'} disabled={!typedOk || busy} onClick={() => void go()}>
            {action === 'power_off' ? 'Power off' : action === 'reboot' ? 'Reboot' : 'Power on'}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px] text-ink-2">
        {action === 'power_off' ? (
          <>
            <p className="m-0">
              {served.length ? text('{domains} stop answering until the server is started again.', { domains: served.join(', ') }) : text('Whatever it serves stops answering until the server is started again.')} {text('{provider} keeps billing while it is off.', { provider })}
            </p>
            <Field label="Type the server name to confirm">
              <input aria-label="Type the server name to confirm" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void go()} placeholder={s.name} className={cx(input, 'font-mono')} />
            </Field>
            <p className="m-0 text-[11.5px] text-ink-3">You may be asked to confirm it is you.</p>
          </>
        ) : action === 'reboot' ? (
          <p className="m-0">It stops answering for the minute or two a restart takes.</p>
        ) : (
          <p className="m-0">{text('{provider} starts it again.', { provider })}</p>
        )}
      </div>
    </Modal>
  );
}
