import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../core/api';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { send, withOrg } from './api';
import { Card, Cell, Empty, Field, PageHeader, Pill, Sheet, THead, btn, btnPrimary, btnSmall, input, row } from './parts';
import { companiesWhere, fieldErrors, refusal, type Options } from './types';
import type { Webhook, WebhookDelivery } from './wsd';

type Events = Array<{ value: string; label: string }>;

/**
 * Outbound webhooks on the desktop (MKT-API-02): add, test, switch off,
 * replace the secret, see deliveries and retry one. The secret is shown once.
 */
export default function Webhooks({ org, options }: { org: string; options: Options }) {
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [log, setLog] = useState<Webhook | null>(null);
  const q = useQuery({ queryKey: ['marketing', 'webhooks', org], queryFn: ({ signal }) => apiGet<{ items: Webhook[]; events: Events }>('/api/marketing/webhooks', withOrg(org), signal) });
  const events = q.data?.events ?? [];
  const word = (e: string) => events.find((x) => x.value === e)?.label ?? e;

  const act = async (method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) => {
    try {
      const r = await send<{ secret?: string }>(method, path, body);
      if (r.data?.secret) setSecret(r.data.secret);
      toast('success', r.message ?? 'Done.');
      void q.refetch();
    } catch (e) {
      toast('error', refusal(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader crumbs={['Settings']} title="Webhooks" sub="Tell your own systems when something happens to a contact. Each request is signed and retried."
        actions={<button type="button" className={btnPrimary} onClick={() => setAdding(true)}><Icon name="plus" size={15} /> Webhook</button>} />
      {secret ? (
        <Card tone="warning" title="Copy the signing secret now">
          <p className="m-0 text-[12.5px] text-ink-2">It is not shown again. Your receiver checks each request’s <code>X-WorkSuite-Signature</code> with it.</p>
          <pre className="mt-2 overflow-x-auto rounded-[8px] bg-ground p-2 text-[11.5px]">{secret}</pre>
          <div className="mt-2 flex gap-2"><button type="button" className={btnSmall} onClick={() => { void navigator.clipboard?.writeText(secret); toast('success', 'Copied.'); }}>Copy</button><button type="button" className={btnSmall} onClick={() => setSecret(null)}>Done</button></div>
        </Card>
      ) : null}
      <Card padded={false}>
        {q.isLoading ? <Spinner label="Loading webhooks…" /> : q.error ? <div className="p-4"><ErrorNote error={new Error(refusal(q.error, 'Webhooks could not be loaded.'))} onRetry={() => void q.refetch()} /></div> : (
          <>
            {(q.data?.items ?? []).map((w) => (
              <div key={w.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-line/70 px-4 py-3 last:border-b-0">
                <div className="min-w-0">
                  <p className="m-0 flex items-center gap-2 text-[13px] font-bold text-ink">{w.name} {w.active ? <Pill tone="green">On</Pill> : <Pill tone="slate">Off</Pill>}{w.failures > 0 ? <Pill tone="amber">{w.failures} failing</Pill> : null}</p>
                  <p className="m-0 truncate text-[11.5px] text-ink-3">{w.url}</p>
                  <p className="m-0 mt-1 text-[11.5px] text-ink-2">{w.events.map(word).join(' · ')}</p>
                  <p className="m-0 text-[11.5px] text-ink-3">This week: {w.week.delivered} delivered, {w.week.failed} given up, {w.week.pending} waiting</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className={btnSmall} onClick={() => void act('POST', `/api/marketing/webhooks/${w.id}/test`)}>Test</button>
                  <button type="button" className={btnSmall} onClick={() => setLog(w)}>Deliveries</button>
                  <button type="button" className={btnSmall} onClick={() => void act('PUT', `/api/marketing/webhooks/${w.id}`, { active: !w.active })}>{w.active ? 'Turn off' : 'Turn on'}</button>
                  <button type="button" className={btnSmall} onClick={() => void act('POST', `/api/marketing/webhooks/${w.id}/rotate`)}>New secret</button>
                  <button type="button" className={btnSmall} onClick={() => void act('DELETE', `/api/marketing/webhooks/${w.id}`)}>Remove</button>
                </div>
              </div>
            ))}
            {(q.data?.items ?? []).length === 0 ? <Empty text="No webhooks yet. Add an https address and choose what it hears about." /> : null}
          </>
        )}
      </Card>
      {adding ? <WebhookSheet options={options} events={events} onClose={() => setAdding(false)} onSaved={(s) => { setSecret(s); setAdding(false); void q.refetch(); }} /> : null}
      {log ? <DeliveriesSheet hook={log} onClose={() => setLog(null)} /> : null}
    </div>
  );
}

function WebhookSheet({ options, events, onClose, onSaved }: { options: Options; events: Events; onClose: () => void; onSaved: (secret: string) => void }) {
  const companies = companiesWhere(options, 'webhooks');
  const [orgId, setOrgId] = useState(String(companies[0]?.id ?? ''));
  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://');
  const [chosen, setChosen] = useState<string[]>(['contact.unsubscribed']);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = async () => {
    setErrors({});
    try {
      const r = await send<{ secret: string }>('POST', '/api/marketing/webhooks', { org_id: Number(orgId), name, url, events: chosen });
      onSaved(r.data?.secret ?? '');
    } catch (e) {
      setErrors(fieldErrors(e));
      toast('error', refusal(e));
    }
  };

  return (
    <Sheet title="Add a webhook" onClose={onClose} footer={<><button type="button" className={btn} onClick={onClose}>Cancel</button><button type="button" className={btnPrimary} onClick={() => void save()}>Add</button></>}>
      {companies.length > 1 ? <Field label="Company"><Select aria-label="Company" value={orgId} onValueChange={setOrgId} options={companies.map((c) => ({ value: String(c.id), label: c.name }))} /></Field> : null}
      <Field label="Name"><input className={input} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Address" hint={errors.url ?? 'An https address on the internet'}><input className={input} value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-1 text-[12.5px] font-semibold text-ink">Events</legend>
        {events.map((e) => (
          <label key={e.value} className="flex items-center gap-2 py-0.5 text-[12.5px] text-ink">
            <input type="checkbox" checked={chosen.includes(e.value)} onChange={(x) => setChosen(x.target.checked ? [...chosen, e.value] : chosen.filter((c) => c !== e.value))} /> {e.label}
          </label>
        ))}
        {errors.events ? <span className="text-[11.5px] text-danger">{errors.events}</span> : null}
      </fieldset>
    </Sheet>
  );
}

function DeliveriesSheet({ hook, onClose }: { hook: Webhook; onClose: () => void }) {
  const q = useQuery({ queryKey: ['marketing', 'webhook-deliveries', hook.id], queryFn: ({ signal }) => apiGet<{ items: WebhookDelivery[] }>(`/api/marketing/webhooks/${hook.id}/deliveries`, {}, signal) });

  const retry = async (d: WebhookDelivery) => {
    try {
      const r = await send('POST', `/api/marketing/webhooks/${hook.id}/deliveries/${d.id}/retry`);
      toast('success', r.message ?? 'Queued.');
      void q.refetch();
    } catch (e) {
      toast('error', refusal(e));
    }
  };

  return (
    <Sheet title={`Deliveries — ${hook.name}`} width={680} onClose={onClose} footer={<button type="button" className={btn} onClick={onClose}>Close</button>}>
      <THead cols={[['Event', null], ['Status', 100], ['Tries', 50], ['Answer', 160], ['', 70]]} />
      {(q.data?.items ?? []).map((d) => (
        <div key={d.id} className={row}>
          <Cell w={null}><code>{d.event}</code></Cell>
          <Cell w={100} className="!overflow-visible"><Pill tone={d.status === 'delivered' ? 'green' : d.status === 'failed' ? 'red' : 'blue'}>{d.status}</Pill></Cell>
          <Cell w={50} className="tabular-nums">{d.attempts}</Cell>
          <Cell w={160} className="text-ink-3">{d.response_code ?? '—'} {d.response ?? ''}</Cell>
          <Cell w={70}>{d.status === 'failed' ? <button type="button" className={btnSmall} onClick={() => void retry(d)}>Retry</button> : null}</Cell>
        </div>
      ))}
      {q.isLoading ? <Spinner label="Loading…" /> : (q.data?.items ?? []).length === 0 ? <Empty text="Nothing has been sent yet." /> : null}
    </Sheet>
  );
}
