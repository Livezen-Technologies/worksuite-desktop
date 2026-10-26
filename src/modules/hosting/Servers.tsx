import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { confirmsName, fetchServers, K, serverAction, type PowerAction, type Server } from './api';
import type { Nav } from './HostingShell';
import { Btn, Field, PageHead, input, statusTone, useReadOnly } from './parts';

/**
 * Servers (D-04, HDM-SRV-01/02/04): a grid of cards — provider, address, plan, CPU and disk where the provider
 * reports them, the domains served — with the monthly total per currency as the server sums it. Power on, reboot and
 * power off where the adapter supports them; power off asks for the server's name to be typed (SRV-04).
 */
export default function Servers({ org, nav }: { org: number; nav: Nav; active: boolean }) {
  const q = useQuery({ queryKey: K.servers({ org }), queryFn: ({ signal }) => fetchServers({ org: org || undefined, per_page: 200 }, signal) });
  const [power, setPower] = useState<{ s: Server; action: PowerAction } | null>(null);
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const items = q.data.items;
  const totals = monthlyTotals(items);
  return (
    <div className="flex flex-col gap-3">
      <PageHead title="Servers" sub={[text('{n} servers', { n: q.data.total }), totals ? text('{totals} a month', { totals }) : null].filter(Boolean).join(' · ')} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {items.map((s) => (
          <ServerCard key={s.id} s={s} nav={nav} onPower={(action) => setPower({ s, action })} />
        ))}
      </div>
      {!items.length ? <p className="m-0 text-[12.5px] text-ink-3">No servers in the register yet.</p> : null}
      {power ? <PowerDialog s={power.s} action={power.action} onClose={() => setPower(null)} /> : null}
    </div>
  );
}

/** "€214.60 + $71.08": the server's monthly figures summed per currency (display only; amounts as sent). */
export function monthlyTotals(items: Array<Pick<Server, 'monthly' | 'cost_currency'>>): string {
  const by = new Map<string, number>();
  for (const s of items) {
    const n = Number(s.monthly ?? '');
    if (!s.monthly || !Number.isFinite(n)) continue;
    const c = s.cost_currency ?? '';
    by.set(c, (by.get(c) ?? 0) + n);
  }
  return [...by.entries()].map(([c, n]) => `${c} ${n.toFixed(2)}`.trim()).join(' + ');
}

export const supports = (s: Pick<Server, 'supports'>, a: PowerAction) => !s.supports || s.supports.includes(a) || s.supports.includes('power');

function ServerCard({ s, nav, onPower }: { s: Server; nav: Nav; onPower: (a: PowerAction) => void }) {
  const ro = useReadOnly();
  const tone = statusTone(s.status);
  const off = ro ? 'Needs a connection' : undefined;
  const running = (s.status ?? '').toLowerCase() === 'running' || (s.status ?? '').toLowerCase() === 'active';
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-surface px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className={cx('size-2 shrink-0 rounded-full', tone === 'green' ? 'bg-[#1F7A4D]' : tone === 'red' ? 'bg-[#B42318]' : 'bg-[#8A90A2]')} title={s.status ?? undefined} />
        <button type="button" className="min-w-0 flex-1 truncate text-left text-[13.5px] font-bold text-ink hover:underline" onClick={(e) => nav.openServer(s.id, e.metaKey || e.ctrlKey ? 'tab' : 'here', s.name)}>
          {s.name}
        </button>
        <span className="text-[11.5px] text-ink-3">{s.provider ?? ''}</span>
      </div>
      <div className="font-mono text-[11.5px] text-ink-2">{s.ipv4 ?? s.ipv6 ?? '—'}</div>
      <div className="truncate text-[12px] text-ink-2">{s.plan ?? ([s.cpu ? `${s.cpu} vCPU` : null, s.ram ? `${s.ram} GB` : null].filter(Boolean).join(' · ') || '—')}</div>
      <div className="flex gap-3 text-[11.5px] text-ink-3">
        <span>{text('CPU {v}', { v: typeof s.cpu_pct === 'number' ? `${s.cpu_pct}%` : '—' })}</span>
        <span>{text('Disk {v}', { v: typeof s.disk_pct === 'number' ? `${s.disk_pct}%` : '—' })}</span>
        <span>{text('{n} domains', { n: s.domains_count ?? s.domains?.length ?? 0 })}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <Btn onClick={() => nav.openServer(s.id, 'window', s.name)}>Pop out</Btn>
        {running ? (
          <>
            {supports(s, 'reboot') ? (
              <Btn disabled={ro} title={off} onClick={() => onPower('reboot')}>
                Reboot
              </Btn>
            ) : null}
            {supports(s, 'power_off') ? (
              <Btn danger disabled={ro} title={off} onClick={() => onPower('power_off')}>
                Power off
              </Btn>
            ) : null}
          </>
        ) : supports(s, 'power_on') ? (
          <Btn disabled={ro} title={off} onClick={() => onPower('power_on')}>
            Power on
          </Btn>
        ) : null}
      </div>
    </div>
  );
}

export function PowerDialog({ s, action, onClose }: { s: Server; action: PowerAction; onClose: () => void }) {
  const qc = useQueryClient();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const typedOk = action !== 'power_off' || confirmsName(typed, s.name);
  const served = (s.domains ?? []).map((d) => d.name);
  const go = async () => {
    if (!typedOk) return;
    setBusy(true);
    try {
      const r = await serverAction(s.id, action, action === 'power_off' ? typed.trim() : undefined);
      if (r === null) toast('info', text('Power actions need a server update.'));
      else toast('success', action === 'power_off' ? text('Powering off {name}.', { name: s.name }) : action === 'reboot' ? text('Rebooting {name}.', { name: s.name }) : text('Starting {name}.', { name: s.name }));
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
              {served.length ? text('{domains} stop answering until the server is started again.', { domains: served.join(', ') }) : text('Whatever it serves stops answering until the server is started again.')}{' '}
              {text('{provider} keeps billing while it is off.', { provider: s.provider ?? text('The provider') })}
            </p>
            <Field label="Type the server name to confirm">
              <input aria-label="Type the server name to confirm" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void go()} placeholder={s.name} className={cx(input, 'font-mono')} />
            </Field>
          </>
        ) : action === 'reboot' ? (
          <p className="m-0">It stops answering for the minute or two a restart takes.</p>
        ) : (
          <p className="m-0">The provider starts it again.</p>
        )}
      </div>
    </Modal>
  );
}
