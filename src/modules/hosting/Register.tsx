import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNote, Modal, Spinner, cx } from '../../components/ui';
import { ApiError } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { money, registerDomain, searchDomain, type Org, type SearchResult } from './api';
import type { Nav } from './HostingShell';
import { Btn, Card, Chip, Note, PageHead, Table, input, td, useReadOnly } from './parts';
import { withStepUp } from './StepUp';

/**
 * Find and register a domain (HDM-DOM-09): `GET register/search?name=&org=` asks every registrar account of the
 * company whose API can search, and each answers whether the name is free and what it costs there. Registering
 * (`POST register {account_id, name, years}`) spends money at that registrar: it is behind `hosting.register`, asks
 * first with the price, and asks the person to confirm it is them. The new domain is in the register at once.
 */
export const DOMAIN_NAME = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const searchable = (v: string) => DOMAIN_NAME.test(v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
const tidy = (v: string) => v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

export default function Register({ companies, org, nav, initial }: { companies: Org[]; org: number; nav: Nav; initial: string }) {
  const ro = useReadOnly();
  const [name, setName] = useState(initial);
  const [asked, setAsked] = useState(searchable(initial) ? tidy(initial) : '');
  const [pick, setPick] = useState<SearchResult | null>(null);
  const q = useQuery({ queryKey: ['hosting', 'register', asked, org], queryFn: () => searchDomain(asked, org || undefined), enabled: !!asked && !ro, staleTime: 0, gcTime: 0, retry: false });
  const go = () => searchable(name) && setAsked(tidy(name));
  const forbidden = q.error instanceof ApiError && q.error.status === 403;
  return (
    <div className="flex max-w-[860px] flex-col gap-4">
      <PageHead title="Register a domain" sub="Searched at your connected registrars; registering is charged there." />
      {ro ? <Note tone="warn">Searching and registering need a connection.</Note> : null}
      <div className="flex gap-2">
        <input
          aria-label="Domain to look for"
          autoFocus
          placeholder="example.lk"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go();
          }}
          className={cx(input, 'max-w-[420px] font-mono')}
        />
        <Btn primary disabled={ro || !searchable(name) || q.isFetching} onClick={go}>
          {q.isFetching ? 'Searching…' : 'Search'}
        </Btn>
      </div>
      {name && !searchable(name) ? <p className="m-0 text-[12px] text-ink-3">Give the whole name, such as example.com.</p> : null}
      {q.isFetching ? <Spinner /> : forbidden ? (
        <Note tone="warn">Registering domains is given to particular people because it spends money. Ask an administrator for Hosting register.</Note>
      ) : q.isError ? (
        <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data ? (
        <Card title={text('{name} at your registrars', { name: q.data.name })}>
          {q.data.results.length ? (
            <Table head={['Registrar', 'Account', 'Available', ['Price', 'r'], '']} label="Search results">
              {q.data.results.map((r) => (
                <tr key={r.account_id}>
                  <td className={cx(td, 'font-semibold')}>{r.provider}</td>
                  <td className={td}>{r.account}{companies.length > 1 && r.org_id ? <span className="text-ink-3">{` · ${companies.find((c) => c.id === r.org_id)?.name ?? ''}`}</span> : null}</td>
                  <td className={td}>{r.available ? <Chip tone="green">{text('Available')}</Chip> : <Chip tone="grey">{r.why || text('Taken')}</Chip>}</td>
                  <td className={cx(td, 'text-right tabular-nums')}>{r.price ? money(r.price, r.currency) : '—'}</td>
                  <td className={cx(td, 'text-right')}>
                    {r.available ? (
                      <Btn primary={r.can_register} disabled={ro || !r.can_register} title={!r.can_register ? text('{provider} does not register through its API.', { provider: r.provider }) : undefined} onClick={() => setPick(r)}>
                        Register…
                      </Btn>
                    ) : null}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="m-0 px-3.5 pb-3 text-[12.5px] text-ink-3">{q.data.why || text('No connected registrar offers domain search.')}</p>
          )}
        </Card>
      ) : null}
      {pick && q.data ? <RegisterDialog r={pick} name={q.data.name} onClose={() => setPick(null)} onDone={(id) => (setPick(null), id ? nav.openDomain(id, 'here', q.data?.name) : nav.to('domains'))} /> : null}
    </div>
  );
}

function RegisterDialog({ r, name, onClose, onDone }: { r: SearchResult; name: string; onClose: () => void; onDone: (id: number | null) => void }) {
  const qc = useQueryClient();
  const [years, setYears] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const total = r.price && Number.isFinite(Number(r.price)) ? money(Number(r.price) * years, r.currency) : null;
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await withStepUp(text('Registering {name}', { name }), (p) => registerDomain(r.account_id, name, years, p));
      toast('success', res.message || text('{name} is registered.', { name }));
      void qc.invalidateQueries({ queryKey: ['hosting'] });
      onDone(res.id);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={text('Register {name}', { name })}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary disabled={busy} onClick={() => void go()}>
            {busy ? 'Registering…' : total ? text('Confirm and register for {price}', { price: total }) : text('Confirm and register')}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px] text-ink-2">
        <p className="m-0">{text('At {provider}, account “{account}”.', { provider: r.provider, account: r.account })}</p>
        <label className="flex items-center gap-2">
          {text('Years')}
          <input aria-label={text('Years')} type="number" min={1} max={10} value={years} onChange={(e) => setYears(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} className="h-8 w-20 rounded-[7px] border border-line bg-surface px-2" />
          {r.price ? <span className="text-ink-3">{text('{price} a year', { price: money(r.price, r.currency) })}</span> : null}
        </label>
        <p className="m-0">{text('This spends money at {provider} and cannot be undone here. You will be asked to confirm it is you.', { provider: r.provider })}</p>
        {err ? <Note tone="error">{err}</Note> : null}
      </div>
    </Modal>
  );
}
