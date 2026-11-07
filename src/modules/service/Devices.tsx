import { useState } from 'react';
import { clickOnKey } from '../../components/press';
import { ErrorNote, Spinner } from '../../components/ui';
import { useDeviceHistory, useDeviceSearch } from './api';
import { deviceName, input, StatusChip, when } from './parts';

/** The device registry (blueprint §4): find a device by IMEI, serial, asset tag or customer and see its repairs. */
export default function Devices({ onJob }: { onJob: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const found = useDeviceSearch(q);
  const history = useDeviceHistory(picked);
  return (
    <div className="flex h-full min-h-0 gap-4 p-4 text-[13px]">
      <div className="flex w-[340px] shrink-0 flex-col gap-2">
        <h1 className="text-[18px] font-bold">Devices</h1>
        <input aria-label="Find a device" placeholder="IMEI, serial, asset tag or customer" value={q} onChange={(e) => setQ(e.target.value)} className={input} />
        {q.trim().length < 3 ? <p className="text-ink-3">Type at least 3 characters.</p> : found.isPending ? <Spinner /> : found.isError ? <ErrorNote error={found.error} /> : (
          <ul className="min-h-0 flex-1 overflow-y-auto scroll-thin">
            {found.data.data.items.map((d) => (
              <li key={d.id} tabIndex={0} onKeyDown={clickOnKey} onClick={() => setPicked(d.id)} className={`cursor-pointer rounded-[7px] p-2 hover:bg-subtle ${picked === d.id ? 'bg-selection' : ''}`}>
                <div className="font-semibold">{deviceName(d)}</div>
                <div className="text-ink-3">{d.imei ?? d.serial ?? '—'} · {d.customer?.name ?? '—'}</div>
              </li>
            ))}
            {!found.data.data.items.length ? <li className="text-ink-3">No device matches.</li> : null}
          </ul>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!picked ? <p className="text-ink-3">Pick a device to see its service history.</p> : history.isPending ? <Spinner /> : history.isError ? <ErrorNote error={history.error} /> : (
          <div className="flex flex-col gap-2">
            <h2 className="text-[16px] font-bold">{deviceName(history.data.data.device)}</h2>
            <p className="text-ink-2">{history.data.data.device.imei ? `IMEI ${history.data.data.device.imei}` : ''} {history.data.data.device.serial ? `Serial ${history.data.data.device.serial}` : ''}</p>
            <h3 className="font-bold">Repairs</h3>
            {history.data.data.jobs.map((j) => (
              <button key={j.id} type="button" onClick={() => onJob(j.id)} className="flex items-center gap-2 rounded-[7px] border border-line p-2 text-left hover:bg-subtle">
                <b>{j.number}</b><StatusChip status={j.status} /><span className="flex-1 truncate">{j.problem}</span><span className="text-ink-3">{when(j.created_at)}</span>
              </button>
            ))}
            {!history.data.data.jobs.length ? <p className="text-ink-3">No repairs yet.</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}
