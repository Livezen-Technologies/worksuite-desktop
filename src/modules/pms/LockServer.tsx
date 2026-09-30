import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, ErrorNote, Spinner } from '../../components/ui';
import { call, DesktopError } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { type LockConnection, type LockOutcome, type LockServer as Server, type LockServerView, LOCK_CONNECTIONS, type LockVendor, lockServerProblem } from '@shared/pms-locks';
import { Field, input, Section } from '../garage/parts';
import { errorText } from './api';
import { doorLocks, lockServer, readCard, syncKeyEncoder, type KeyDone } from './locks';
import { usePms } from './parts';

const ENCODER_VENDORS = ['salto', 'vingcard', 'dormakaba'];
const SECRET_LABEL: Record<LockConnection, string> = {
  ship: 'Password (if the SHIP link asks for one)',
  saflok: 'Password (if the Saflok link asks for one)',
  visionline: 'Interface password',
  vostio: 'Vostio API key',
  ambiance: 'Ambiance API key',
};

/**
 * This computer's door-lock server for the property (PMS-DSK-002): where the on-site Salto, Vingcard or dormakaba
 * server is, whether the link is TLS (and its pinned certificate), this desk's encoder, and the interface account.
 * The password or API key goes to the OS keystore and never comes back to this screen. The vendor and connection
 * are the property's, from WorkSuite; each is off until set up here and switched on there.
 */
export function LockServerSection() {
  const pms = usePms();
  const pid = pms.property.id;
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ['pms', 'door-locks', pid], queryFn: ({ signal }) => doorLocks(pid, signal), enabled: pms.online });
  const here = useQuery({ queryKey: ['pms', 'lock-server', pid], queryFn: () => lockServer(pid) });
  const lock = cfg.data?.door_locks;
  const vendor = (lock && ENCODER_VENDORS.includes(lock.vendor) ? lock.vendor : null) as LockVendor | null;
  const connection = (lock?.connection ?? '') as LockConnection;
  const spec = vendor ? (LOCK_CONNECTIONS[vendor] as Record<string, Spec>)[connection] : undefined;

  if (cfg.isLoading || here.isLoading) return <Spinner />;
  if (cfg.error) return <ErrorNote error={cfg.error} onRetry={() => void cfg.refetch()} />;
  if (!lock || !lock.enabled || lock.vendor === 'none') {
    return (
      <Section title="Door-lock server">
        <p className="m-0 text-[13px] text-ink-2">No door-lock system is switched on for {pms.property.name}. It is chosen on the web (Hotel PMS → Settings → Door locks); keys are handed over by hand until then.</p>
      </Section>
    );
  }
  if (!vendor || !spec) {
    return (
      <Section title="Door-lock server">
        <p className="m-0 text-[13px] text-ink-2">{lock.vendor_label} is done by WorkSuite in the cloud: nothing is set up on this computer. Passcodes and app keys come back on the stay’s Keys.</p>
      </Section>
    );
  }

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['pms', 'lock-server', pid] });
    await syncKeyEncoder(pid);
  };

  return <LockServerForm key={JSON.stringify(here.data ?? null)} pid={pid} label={lock.vendor_label} vendor={vendor} connection={connection} spec={spec} here={here.data ?? null} onSaved={refresh} />;
}

interface Spec {
  label: string;
  link: 'tcp' | 'http';
  port: number;
}

function LockServerForm({ pid, label, vendor, connection, spec, here, onSaved }: { pid: number; label: string; vendor: LockVendor; connection: LockConnection; spec: Spec; here: LockServerView | null; onSaved: () => Promise<void> }) {
  const pms = usePms();
  const mayManage = pms.mayAny('pms.keys.manage', 'pms.device.manage');
  const [form, setForm] = useState(() => ({
    host: here?.host ?? '',
    port: String(here?.port ?? spec.port),
    tls: here?.tls ?? spec.link === 'http',
    fingerprint: here?.fingerprint ?? '',
    encoder: here?.encoder ?? '',
    username: here?.username ?? '',
    secret: '',
  }));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LockOutcome | KeyDone | null>(null);
  const refresh = onSaved;

  const draft: Server = {
    vendor,
    connection,
    host: form.host.trim(),
    port: Number(form.port) || spec.port,
    tls: form.tls,
    fingerprint: form.fingerprint.trim(),
    encoder: form.encoder.trim(),
    ...(form.username.trim() ? { username: form.username.trim() } : {}),
  };
  const problem = draft.host === '' ? 'The lock server’s address.' : draft.encoder === '' ? 'This desk’s encoder, as the lock server names it.' : lockServerProblem(draft);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setResult(null);
    try {
      await fn();
    } catch (e) {
      toast('error', e instanceof DesktopError ? e.message : errorText(e, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    guard(async () => {
      await call('pmsLocks:configSet', { propertyId: pid, server: draft, ...(form.secret ? { secret: form.secret } : {}) });
      toast('success', 'Kept on this computer; the password is in its keystore.');
      await refresh();
    });
  const test = () =>
    guard(async () => {
      const out = await call('pmsLocks:test', { propertyId: pid });
      setResult(out);
    });
  const forget = () =>
    guard(async () => {
      await call('pmsLocks:forget', { propertyId: pid });
      toast('success', 'This computer no longer talks to the lock server.');
      await refresh();
    });
  const read = () =>
    guard(async () => {
      setResult(await readCard(pid));
    });

  const set = (k: keyof typeof form, v: string | boolean) => setForm({ ...form, [k]: v });
  const card = result && 'outcome' in result ? result : null;

  return (
    <Section title="Door-lock server">
      <p className="mt-0 text-[12px] text-ink-3">
        {label} — {spec.label}. This desk sends each key WorkSuite makes to the lock server on the hotel’s network and writes the card on its encoder.
        {here ? '' : ' Not set up on this computer yet.'}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Lock server address">
          <input aria-label="Lock server address" className={input} value={form.host} disabled={!mayManage} placeholder="192.168.1.20" onChange={(e) => set('host', e.target.value)} />
        </Field>
        <Field label="Port">
          <input aria-label="Port" type="number" className={input} value={form.port} disabled={!mayManage} onChange={(e) => set('port', e.target.value)} />
        </Field>
        <Field label="This desk’s encoder">
          <input aria-label="This desk’s encoder" className={input} value={form.encoder} disabled={!mayManage} placeholder="ENC1" onChange={(e) => set('encoder', e.target.value)} />
        </Field>
        <Field label="Interface user">
          <input aria-label="Interface user" className={input} value={form.username} disabled={!mayManage} onChange={(e) => set('username', e.target.value)} />
        </Field>
        <Field label={SECRET_LABEL[connection]} hint={here?.hasSecret ? 'Kept in this computer’s keystore; blank keeps it.' : undefined}>
          <input aria-label={SECRET_LABEL[connection]} type="password" autoComplete="off" className={input} value={form.secret} disabled={!mayManage} onChange={(e) => set('secret', e.target.value)} />
        </Field>
        <Field label="Certificate fingerprint (SHA-256)" hint="Pins an on-site server’s own certificate.">
          <input aria-label="Certificate fingerprint" className={input} value={form.fingerprint} disabled={!mayManage || !form.tls} onChange={(e) => set('fingerprint', e.target.value)} />
        </Field>
      </div>
      <label className="mt-2 flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={form.tls} disabled={!mayManage} onChange={(e) => set('tls', e.target.checked)} /> TLS on the link
      </label>
      {here && !here.persistent ? <p className="text-[12px] text-warning">This computer has no keystore: the password is kept until WorkSuite Desktop quits.</p> : null}
      {problem && mayManage ? <p className="text-[12px] text-ink-3">{problem}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {mayManage ? (
          <Button variant="primary" loading={busy} disabled={!!problem} onClick={() => void save()}>
            Keep on this computer
          </Button>
        ) : null}
        <Button disabled={busy || !here} onClick={() => void test()}>
          Test connection
        </Button>
        {pms.may('pms.keys.issue') ? (
          <Button disabled={busy || !here || !pms.online} onClick={() => void read()}>
            Read a card
          </Button>
        ) : null}
        {mayManage && here ? (
          <Button variant="danger" disabled={busy} onClick={() => void forget()}>
            Forget
          </Button>
        ) : null}
      </div>
      {result ? (
        <p role="status" className={`mt-2 mb-0 text-[13px] ${result.ok ? 'text-success' : 'text-danger'}`}>
          {result.message}
          {'ms' in result && result.ms !== undefined ? ` (${result.ms} ms)` : ''}
          {card?.stay ? ` — ${card.stay.guest_name ? `${card.stay.guest_name}, room ${card.stay.room_number}, until ${card.stay.departure_date}` : `room ${card.stay.room_number}: nobody in house`}` : ''}
        </p>
      ) : null}
    </Section>
  );
}
