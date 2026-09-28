import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Button, Card, Chip, Empty, Modal, Spinner, TextField, cx } from '../../components/ui';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { addAllergy, amount, answered, attemptKey, fetchClient, fetchClients, K, shortDay, todayAt, type ClientCard, type Reliability, type Severity } from './api';
import { AllergyChip, Choice, Failed, Figure, Person, SEVERITY_TONE, servicesOf, severityLabel, useDesk, useNow } from './parts';

/**
 * Clients at the counter (D08, CLI-05, CTR-02): find somebody by any part of
 * their name, mobile or email, and see what the desk needs — the allergy
 * first, points, store credit, what they owe, their last visits — with Book
 * again one press away. The full record opens in WorkSuite on the web.
 */
const RELIABILITY: Record<Reliability, { tone: 'success' | 'warning' | 'danger'; label: string }> = {
  reliable: { tone: 'success', label: 'Reliable' },
  watch: { tone: 'warning', label: 'Watch' },
  unreliable: { tone: 'danger', label: 'Unreliable' },
};

export default function Clients() {
  const desk = useDesk();
  const [term, setTerm] = useState('');
  const selected = Number(desk.params.get('client') ?? 0) || null;
  const t = term.trim();
  const q = useQuery({ queryKey: K.clients(desk.org, t), queryFn: ({ signal }) => fetchClients(desk.org, t, 20, signal) });

  return (
    <div className="flex flex-col gap-4 p-6 xl:flex-row">
      <div className="flex w-full flex-col gap-3 xl:w-[380px]">
        <h1 className="text-[22px] font-extrabold text-ink">Clients</h1>
        <TextField aria-label="Name, mobile or email" placeholder="Name, mobile or email" value={term} onChange={(e) => setTerm(e.target.value)} />
        {q.isError ? (
          <Failed text="Clients could not be searched." onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <Spinner label="Searching clients…" />
        ) : q.data.items.length === 0 ? (
          <p className="text-[13px] text-ink-2">{t ? `Nobody matches “${t}”.` : 'No clients yet.'}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {q.data.items.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={selected === c.id ? 'true' : undefined}
                  onClick={() => desk.go('clients', { client: c.id })}
                  className={cx('w-full rounded-[10px] border px-3 py-2 text-left', selected === c.id ? 'border-primary bg-selection' : 'border-line bg-surface hover:bg-subtle')}
                >
                  <Person name={c.name} sub={[c.phone, c.tier, `${c.visits} visit${c.visits === 1 ? '' : 's'}`].filter(Boolean).join(' · ')} size={30} trailing={c.allergy ? <AllergyChip allergy={c.allergy} /> : null} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="min-w-0 flex-1">{selected ? <ClientCardView key={selected} id={selected} /> : <Empty icon="users" title="Choose a client" hint="Their allergy, points, store credit and last visits show here." />}</div>
    </div>
  );
}

function ClientCardView({ id }: { id: number }) {
  const desk = useDesk();
  const [recording, setRecording] = useState(false);
  const now = useNow(60_000);
  const q = useQuery({ queryKey: K.client(id), queryFn: ({ signal }) => fetchClient(id, signal) });

  if (q.isError) return <Failed text={q.error instanceof Error ? q.error.message : 'The client could not be loaded.'} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Spinner label="Loading the client…" />;

  const d: ClientCard = q.data;
  const live = d.allergies.filter((a) => !a.withdrawn_at);
  const test = d.patch_tests.find((p) => p.result === 'negative' && p.valid_until);
  const owing = (d.invoices ?? []).filter((i) => i.owed > 0);
  const last = d.visits.find((v) => v.status !== 'cancelled' && v.status !== 'no_show');
  const rel = RELIABILITY[d.profile.reliability] ?? RELIABILITY.reliable;
  const today = todayAt(desk.location.timezone, new Date(now));

  return (
    <Card>
      <div className="flex flex-col gap-4 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[19px] font-extrabold text-ink">{d.client.name}</h2>
          {d.profile.tier ? <Chip tone="warning">{d.profile.tier}</Chip> : null}
          <Chip tone={rel.tone}>{rel.label}</Chip>
          <span className="text-[12.5px] text-ink-2">
            {[d.client.phone, `${d.profile.visits} visit${d.profile.visits === 1 ? '' : 's'}`, d.profile.preferred ? `${d.profile.preferred.split(' ')[0]} usually` : null].filter(Boolean).join(' · ')}
          </span>
        </div>

        {live.length > 0 ? (
          <div className="flex flex-col gap-1.5 rounded-[10px] border border-danger/30 bg-danger-bg px-3.5 py-2.5">
            {live.map((a) => (
              <div key={a.id} className="flex flex-wrap items-baseline gap-2 text-[14px] text-ink">
                <Chip tone={SEVERITY_TONE[a.severity]}>
                  <Icon name="warning" size={12} /> {severityLabel(a.severity)}
                </Chip>
                <b>{a.substance}</b>
                {a.reaction ? <span className="text-ink-2">— {a.reaction}</span> : null}
              </div>
            ))}
            {test ? (
              <div className="text-[12.5px] text-success">
                Patch test {shortDay(test.tested_at)}
                {test.product ? ` · ${test.product}` : ''} — no reaction · valid until {shortDay(test.valid_until)}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-3 gap-3">
          <Figure label="Points" value={(d.loyalty?.points ?? d.profile.points).toLocaleString()} />
          <Figure label="Store credit" value={d.credit ? amount(d.credit.balance, d.credit.currency) : '—'} />
          <Figure label="Owes" value={d.invoices === null ? '—' : owing.length === 0 ? 'Nothing' : owing.map((i) => amount(i.owed, i.currency)).join(' + ')} />
        </div>

        <div>
          <h3 className="mb-1 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">Recent visits</h3>
          {d.visits.length === 0 ? (
            <p className="text-[13px] text-ink-2">No visits yet.</p>
          ) : (
            <ul>
              {d.visits.slice(0, 5).map((v) => (
                <li key={v.id} className="flex items-center gap-3 border-t border-line py-2 first:border-t-0">
                  <span className="w-20 text-[13px] font-bold text-ink">{v.date === today ? 'Today' : shortDay(v.date)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] text-ink">{servicesOf(v)}</div>
                    <div className="truncate text-[12px] text-ink-3">
                      {[...new Set(v.items.map((i) => i.provider.split(' ')[0]))].join(', ')} · {v.status_label}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-2.5">
          <Button icon="external" onClick={() => void call('app:openInBrowser', { path: `/salon?view=clients&client=${d.client.id}` })}>
            Open full record
          </Button>
          {d.may.edit ? (
            <Button icon="plus" onClick={() => setRecording(true)}>
              Record an allergy
            </Button>
          ) : null}
          {desk.may('salon.visit.book') ? (
            <Button
              variant="primary"
              className="ml-auto"
              onClick={() =>
                desk.walkIn(
                  {
                    client_id: d.client.id,
                    client_name: d.client.name,
                    service_ids: last ? [...new Set(last.items.map((i) => i.service_id))] : [],
                    provider_id: last?.items[0]?.provider_id,
                  },
                  true,
                )
              }
            >
              Book again
            </Button>
          ) : null}
        </div>
      </div>
      {recording ? <RecordAllergy clientId={d.client.id} name={d.client.name} onClose={() => setRecording(false)} /> : null}
    </Card>
  );
}

/** An allergy recorded at the counter, as the client tells it (SAFE-01). */
function RecordAllergy({ clientId, name, onClose }: { clientId: number; name: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [substance, setSubstance] = useState('');
  const [reaction, setReaction] = useState('');
  const [severity, setSeverity] = useState<Severity>('moderate');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(attemptKey);

  async function save() {
    setBusy(true);
    try {
      const r = await addAllergy(clientId, { substance: substance.trim(), reaction: reaction.trim() || undefined, severity }, key);
      toast('success', r.message || 'Allergy recorded.');
      void qc.invalidateQueries({ queryKey: K.all });
      onClose();
    } catch (e) {
      if (answered(e)) setKey(attemptKey());
      toast('error', e instanceof Error ? e.message : 'The allergy could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`An allergy for ${name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={substance.trim() === ''} onClick={() => void save()}>
            Record it
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField label="What to" placeholder="PPD, latex, fragrance…" value={substance} onChange={(e) => setSubstance(e.target.value)} autoFocus />
        <TextField label="What happened" placeholder="Swelling of the scalp" value={reaction} onChange={(e) => setReaction(e.target.value)} />
        <div className="flex flex-col gap-1">
          <span className="text-[12.5px] font-semibold text-ink-2">How severe</span>
          <Choice
            label="How severe"
            value={severity}
            onChange={setSeverity}
            options={[
              { value: 'mild', label: 'Mild' },
              { value: 'moderate', label: 'Moderate' },
              { value: 'severe', label: 'Severe' },
            ]}
          />
        </div>
      </div>
    </Modal>
  );
}
