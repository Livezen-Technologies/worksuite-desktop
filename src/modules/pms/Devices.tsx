import { useEffect, useReducer, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { Field, input, Section } from '../garage/parts';
import { PageHead } from '../hr/parts';
import { errorText } from './api';
import { DEVICE_KINDS, DEVICE_LABEL, device, onDevicesChanged } from './devices';
import { LockServerSection } from './LockServer';
import { deskName, keepDeskName } from './money';
import { usePms } from './parts';
import { esc, printPage } from './print';

/**
 * This desk's devices (PMS-DSK-002): what the device agent drives for each
 * kind — a vendor's driver when one is registered, the computer's own
 * printing for cards and receipts, "no device" otherwise — and the desk's
 * name that its payments carry.
 */
export default function Devices() {
  const pms = usePms();
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [name, setName] = useState(() => deskName(null));
  useEffect(() => onDevicesChanged(redraw), []);
  const test = async () => {
    try {
      await printPage({ title: 'Test page', kind: 'receipt', html: `<h1>${esc(pms.property.name)}</h1><p>A test page from ${esc(name)}.</p>` });
    } catch (e) {
      toast('error', errorText(e, 'Nothing was printed.'));
    }
  };
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Desk devices" sub="What this computer drives at the front desk" />
      <Section title="Devices">
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {DEVICE_KINDS.map((k) => {
            const d = device(k);
            const on = d.available();
            return (
              <li key={k} className="flex items-start gap-3 rounded-[10px] border border-line px-3 py-2 text-[13px]">
                <Icon name={on ? 'check-circle' : 'minus'} size={16} className={cx('mt-0.5', on ? 'text-success' : 'text-ink-3')} />
                <span className="min-w-0 flex-1">
                  <b className="block">{DEVICE_LABEL[k]}</b>
                  <span className="text-ink-2">{d.label}</span>
                </span>
                {k === 'printer' ? (
                  <Button size="sm" icon="printer" onClick={() => void test()}>
                    Test page
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 mb-0 text-[12px] text-ink-3">
          The key encoder is the property’s on-site lock server (Salto, Vingcard, dormakaba), set up below; TTLock is done by WorkSuite. No other vendor driver ships with WorkSuite Desktop: card payments from a standalone terminal are recorded with the slip’s reference and the last four digits.
        </p>
      </Section>
      <LockServerSection />
      <Section title="This desk">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            keepDeskName(name);
            toast('success', 'Kept on this computer.');
          }}
        >
          <Field label="Terminal name" hint="Payments taken here carry it; an open cashier shift names its own." className="w-72">
            <input aria-label="Terminal name" className={input} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button type="submit" disabled={!name.trim()}>
            Keep
          </Button>
        </form>
      </Section>
    </div>
  );
}
