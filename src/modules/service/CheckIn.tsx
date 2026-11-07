import { Checkbox } from '../../components/Checkbox';
import { useState } from 'react';
import { DEVICE_TYPES, INTAKE_CHECKLIST, isImei, type DeviceType } from '@shared/service';
import { Button, cx } from '../../components/ui';
import { useCheckIn, type CheckIn as CheckInBody } from './api';
import { input } from './parts';

const ACCESSORIES = ['Charger', 'Cable', 'Case', 'SIM tray', 'SIM card', 'Memory card', 'Bag', 'Stylus'];

/**
 * Customer check-in (blueprint §2 step 1): customer, device, issue, accessories, the device's intake checklist and
 * the customer's consent. Passwords and PINs are never asked for or stored here: only whether the device is locked.
 */
export default function CheckIn({ offline, onCreated }: { offline: boolean; onCreated: (id: string) => void }) {
  const create = useCheckIn();
  const [customer, setCustomer] = useState({ name: '', phone: '', email: '' });
  const [type, setType] = useState<DeviceType>('mobile');
  const [device, setDevice] = useState({ brand: '', model: '', imei: '', serial: '', condition: '' });
  const [problem, setProblem] = useState('');
  const [accessories, setAccessories] = useState<string[]>([]);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [priority, setPriority] = useState<CheckInBody['priority']>('normal');
  const [locked, setLocked] = useState(false);
  const [consent, setConsent] = useState({ access: false, backup: false, reset: false });
  const [deposit, setDeposit] = useState('');
  const list = INTAKE_CHECKLIST[type];
  const imeiBad = type === 'mobile' && device.imei.trim() !== '' && !isImei(device.imei);
  const ok = customer.name.trim() && (customer.phone.trim() || customer.email.trim()) && problem.trim() && (device.imei.trim() || device.serial.trim()) && !imeiBad;

  const submit = () => {
    const body: CheckInBody = {
      customer: { name: customer.name.trim(), phone: customer.phone.trim() || undefined, email: customer.email.trim() || undefined },
      device: { type, brand: device.brand.trim() || undefined, model: device.model.trim() || undefined, imei: device.imei.replace(/[\s-]/g, '') || undefined, serial: device.serial.trim() || undefined, condition: device.condition.trim() || undefined },
      problem: problem.trim(), accessories, checklist: list.map((label) => ({ label, done: !!done[label] })), priority, consent, device_locked: locked,
      deposit: deposit ? Number(deposit) : undefined,
    };
    create.mutate(body, { onSuccess: (r) => onCreated(r.id) });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ok) submit(); }} className="mx-auto flex max-w-[860px] flex-col gap-4 p-4 text-[13px]">
      <h1 className="text-[18px] font-bold">New repair job</h1>
      <fieldset disabled={offline} className="contents">
        <section className="grid gap-2 md:grid-cols-3">
          <h2 className="font-bold md:col-span-3">Customer</h2>
          <input aria-label="Customer name" placeholder="Name *" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} className={input} />
          <input aria-label="Phone" placeholder="Phone" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} className={input} />
          <input aria-label="Email" placeholder="Email" type="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} className={input} />
        </section>
        <section className="grid gap-2 md:grid-cols-3">
          <h2 className="font-bold md:col-span-3">Device</h2>
          <select aria-label="Device type" value={type} onChange={(e) => { setType(e.target.value as DeviceType); setDone({}); }} className={input}>{DEVICE_TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}</select>
          <input aria-label="Brand" placeholder="Brand" value={device.brand} onChange={(e) => setDevice({ ...device, brand: e.target.value })} className={input} />
          <input aria-label="Model" placeholder="Model" value={device.model} onChange={(e) => setDevice({ ...device, model: e.target.value })} className={input} />
          {type === 'mobile' ? <input aria-label="IMEI" aria-invalid={imeiBad} placeholder="IMEI" value={device.imei} onChange={(e) => setDevice({ ...device, imei: e.target.value })} className={cx(input, imeiBad ? 'border-danger' : '')} /> : null}
          <input aria-label="Serial number" placeholder="Serial number" value={device.serial} onChange={(e) => setDevice({ ...device, serial: e.target.value })} className={input} />
          <input aria-label="Condition" placeholder="Cosmetic condition" value={device.condition} onChange={(e) => setDevice({ ...device, condition: e.target.value })} className={input} />
          {imeiBad ? <p className="text-[12px] text-danger md:col-span-3">That IMEI is not valid (15 digits, check digit).</p> : null}
          <label className="flex items-center gap-2 md:col-span-3"><Checkbox checked={locked} onChange={(e) => setLocked(e.target.checked)} />Device is locked (do not write the PIN or password anywhere here)</label>
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="font-bold">Reported problem *</h2>
          <textarea aria-label="Reported problem" rows={3} value={problem} onChange={(e) => setProblem(e.target.value)} className={input} />
          <div className="flex flex-wrap gap-3">{ACCESSORIES.map((a) => <label key={a} className="flex items-center gap-1"><Checkbox checked={accessories.includes(a)} onChange={(e) => setAccessories(e.target.checked ? [...accessories, a] : accessories.filter((x) => x !== a))} />{a}</label>)}</div>
        </section>
        <section>
          <h2 className="mb-1 font-bold">Intake checklist <span className="font-normal text-ink-3">({list.filter((l) => done[l]).length} of {list.length})</span></h2>
          <div className="grid gap-1 md:grid-cols-2">{list.map((l) => <label key={l} className="flex items-center gap-2"><Checkbox checked={!!done[l]} onChange={(e) => setDone({ ...done, [l]: e.target.checked })} />{l}</label>)}</div>
        </section>
        <section className="grid gap-2 md:grid-cols-3">
          <h2 className="font-bold md:col-span-3">Consent and terms</h2>
          <label className="flex items-center gap-2"><Checkbox checked={consent.access} onChange={(e) => setConsent({ ...consent, access: e.target.checked })} />May access the device to diagnose</label>
          <label className="flex items-center gap-2"><Checkbox checked={consent.backup} onChange={(e) => setConsent({ ...consent, backup: e.target.checked })} />May back up data</label>
          <label className="flex items-center gap-2"><Checkbox checked={consent.reset} onChange={(e) => setConsent({ ...consent, reset: e.target.checked })} />May factory reset if needed</label>
          <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as CheckInBody['priority'])} className={input}><option value="low">Low priority</option><option value="normal">Normal priority</option><option value="high">High priority</option><option value="urgent">Urgent</option></select>
          <input aria-label="Deposit" type="number" min={0} step="0.01" placeholder="Deposit (LKR)" value={deposit} onChange={(e) => setDeposit(e.target.value)} className={input} />
        </section>
      </fieldset>
      {create.isError ? <p className="text-[12px] text-danger">{(create.error as Error).message}</p> : null}
      <div className="flex justify-end gap-2">
        {offline ? <span className="self-center text-[12px] text-warning">Check-in needs the server — you are offline.</span> : null}
        <Button type="submit" variant="primary" disabled={!ok || offline || create.isPending} loading={create.isPending}>Create job card</Button>
      </div>
    </form>
  );
}
