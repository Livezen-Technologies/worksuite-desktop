import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Avatar, Empty, Modal, Spinner, cx } from '../../components/ui';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { addAllergy, amount, answered, attemptKey, dayMonth, fetchClient, fetchClients, K, todayAt, whatsAppUrl, type Allergy, type ClientCard, type ClientRow, type PatchTest, type Reliability, type Severity } from './api';
import { NewClient } from './ClientPick';
import { unreachable, useCopyClient, useCopyClients } from './offline';
import { Choice, DeskDialog, Failed, Figure, firstName, Label, Note, Page, Panel, ReliabilityTag, severityLabel, TierTag, TouchButton, useDesk, useNow } from './parts';

/**
 * Clients at the counter (D08, CLI-05, CTR-02): find somebody by any part of
 * their name, mobile or email, and see what the desk needs — the allergy
 * first, points, store credit, what they owe, their last visits — with Book
 * again one press away, WhatsApp beside it, and each visit's service record
 * (D17). The full record opens in WorkSuite on the web.
 *
 * With WorkSuite out of reach the search runs over the day's copy — the
 * clients seen in the last year, with the allergy on file.
 */
export default function Clients() {
  const desk = useDesk();
  const [term, setTerm] = useState('');
  const [adding, setAdding] = useState(false);
  const selected = Number(desk.params.get('client') ?? 0) || null;
  const t = term.trim();
  const live = useQuery({ queryKey: K.clients(desk.org, t), queryFn: ({ signal }) => fetchClients(desk.org, t, 20, signal), retry: desk.offline ? false : undefined });
  const offline = desk.offline || unreachable(live);
  const copied = useCopyClients(t, 20, offline && !!desk.copy);
  const q =
    offline && desk.copy
      ? { data: copied.data ? { items: copied.data.map((c) => ({ ...c, tier: c.tier ?? null, points: c.points ?? 0, reliability: (c.reliability ?? 'reliable') as Reliability, visits: -1, store_credit: 0, allergy: (c.allergy ?? null) as ClientRow['allergy'] })) } : undefined, isError: copied.isError, refetch: copied.refetch }
      : live;
  const rows = q.data?.items ?? [];

  return (
    <Page title="Clients">
      <div className="flex flex-col gap-3.5 xl:flex-row xl:items-start">
        <div className="flex w-full flex-col gap-3 xl:w-[420px] xl:shrink-0">
          <label className="flex min-h-[52px] items-center gap-2.5 rounded-[14px] border-2 border-line bg-surface px-4 focus-within:border-primary">
            <Icon name="search" size={20} className="text-ink-2" />
            <input aria-label="Name, mobile or email" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus className="bare-focus min-w-0 flex-1 bg-transparent text-[18px] text-ink outline-none" />
            <span className="shrink-0 text-[12px] text-ink-2">name, mobile or email</span>
          </label>
          {q.isError ? (
            <Failed text="Clients could not be searched." onRetry={() => void q.refetch()} />
          ) : !q.data ? (
            <Spinner label="Searching clients…" />
          ) : rows.length === 0 ? (
            <p className="text-[13px] text-ink-2">{t ? `Nobody matches “${t}”.` : 'No clients yet.'}</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {rows.map((c) => {
                const on = selected === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-current={on ? 'true' : undefined}
                      onClick={() => desk.go('clients', { client: c.id })}
                      className={cx('flex w-full items-center gap-3 rounded-[14px] px-3.5 py-3 text-left', on ? 'border-2 border-primary bg-selection' : 'border border-line bg-surface hover:bg-subtle')}
                    >
                      <Avatar name={c.name} size={40} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[16px] font-bold text-ink">{c.name}</div>
                        <div className="truncate text-[13px] text-ink-2">{c.phone ?? c.email ?? ''}</div>
                      </div>
                      {c.allergy ? <Icon name="warning" size={16} className="shrink-0 text-danger" label={`Allergy: ${c.allergy.substance}`} /> : null}
                      <TierTag tier={c.tier} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {q.data ? (
            <p className="text-[13px] text-ink-2">
              {t ? `${rows.length} match${rows.length === 1 ? '' : 'es'}` : `${rows.length} shown`}
              {offline && desk.copy ? ' · searched this desk’s copy: the clients seen in the last year' : desk.copy ? ' · searchable offline too, from this desk’s copy' : ''}
            </p>
          ) : null}
          <TouchButton icon="plus" disabled={!desk.may('salon.client.edit')} onClick={() => setAdding(true)}>
            New client
          </TouchButton>
        </div>

        <div className="min-w-0 flex-1">
          {selected ? (
            offline && desk.copy ? (
              <CopiedClient key={selected} id={selected} />
            ) : (
              <ClientCardView key={selected} id={selected} />
            )
          ) : (
            <Panel>
              <Empty icon="users" title="Choose a client" hint="Their allergy, points, store credit and last visits show here." />
            </Panel>
          )}
        </div>
      </div>

      {adding ? (
        <Modal width={520} onClose={() => setAdding(false)}>
          <NewClient
            initial={t}
            onBack={() => setAdding(false)}
            onChosen={(c) => {
              setAdding(false);
              if (c.id) desk.go('clients', { client: c.id });
              else if (desk.may('salon.visit.book')) desk.walkIn({ local: { id: c.local!, name: c.name, mobile: c.mobile } }, true);
            }}
          />
        </Modal>
      ) : null}
    </Page>
  );
}

/** The client's allergies as one red line: the worst first, then the patch test that covers them (D08). */
export function AllergyLine({ allergies, test, onUpdate }: { allergies: Array<Pick<Allergy, 'severity' | 'substance' | 'reaction'>>; test?: PatchTest | null; onUpdate?: () => void }) {
  if (allergies.length === 0) return null;
  const sorted = [...allergies].sort((a, b) => ['mild', 'moderate', 'severe'].indexOf(b.severity) - ['mild', 'moderate', 'severe'].indexOf(a.severity));
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-[10px] border border-[#FECDD3] bg-[#FFF1F2] px-3 py-2.5 text-[14px] text-[#9F1239] dark:border-danger/40 dark:bg-danger-bg dark:text-danger">
      <Icon name="warning" size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {sorted.map((a, i) => (
          <span key={i}>
            {i > 0 ? ' ' : ''}
            <b>
              {severityLabel(a.severity)} · {a.substance}.
            </b>{' '}
            {a.reaction ? `${a.reaction.replace(/\.$/, '')}.` : ''}
            {i === 0 && test ? ` Patch test ${dayMonth(test.tested_at, false)} — no reaction.` : ''}
          </span>
        ))}
      </div>
      {onUpdate ? (
        <button type="button" onClick={onUpdate} className="shrink-0 text-[12.5px] font-bold underline">
          Update
        </button>
      ) : null}
    </div>
  );
}

/** A client as the day's copy has them: enough to recognise them, read the allergy out and book them in. */
function CopiedClient({ id }: { id: number }) {
  const desk = useDesk();
  const q = useCopyClient(id);
  if (q.isLoading) return <Spinner label="Loading the client…" />;
  const c = q.data;
  if (!c) return <Note tone="warning">This client is not in the desk’s copy. Their card opens when WorkSuite answers.</Note>;
  return (
    <Panel className="flex flex-col gap-3.5">
      <Header name={c.name} tier={c.tier} reliability={c.reliability} sub={[c.phone, c.email].filter(Boolean).join(' · ')} />
      {c.allergy ? <AllergyLine allergies={[{ severity: c.allergy.severity as Severity, substance: c.allergy.substance, reaction: 'The worst on file. Every allergy, patch tests and past visits show when WorkSuite answers' }]} /> : null}
      <div className="grid grid-cols-3 gap-3">
        <Figure label="Points" value={(c.points ?? 0).toLocaleString()} />
        <Figure label="Store credit" value="—" />
        <Figure label="Owes" value="—" />
      </div>
      {desk.may('salon.visit.book') ? (
        <TouchButton variant="primary" icon="plus" onClick={() => desk.walkIn({ client_id: c.id }, true)}>
          Book them in
        </TouchButton>
      ) : null}
    </Panel>
  );
}

function Header({ name, tier, reliability, sub }: { name: string; tier: string | null | undefined; reliability: string | null | undefined; sub: string }) {
  return (
    <div className="flex items-center gap-3.5">
      <Avatar name={name} size={60} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-[22px] font-extrabold text-ink">{name}</h2>
          <TierTag tier={tier} />
          <ReliabilityTag reliability={reliability} />
        </div>
        {sub ? <div className="text-[14px] text-ink-2">{sub}</div> : null}
      </div>
    </div>
  );
}

function ClientCardView({ id }: { id: number }) {
  const desk = useDesk();
  const [recording, setRecording] = useState(() => desk.params.get('allergy') === '1');
  const now = useNow(60_000);
  const q = useQuery({ queryKey: K.client(id), queryFn: ({ signal }) => fetchClient(id, signal) });

  if (q.isError) return <Failed text={q.error instanceof Error ? q.error.message : 'The client could not be loaded.'} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Spinner label="Loading the client…" />;

  const d: ClientCard = q.data;
  const live = d.allergies.filter((a) => !a.withdrawn_at);
  const test = d.patch_tests.find((p) => p.result === 'negative' && p.valid_until);
  const owing = (d.invoices ?? []).filter((i) => i.owed > 0);
  const last = d.visits.find((v) => v.status !== 'cancelled' && v.status !== 'no_show');
  const today = todayAt(desk.location.timezone, new Date(now));
  const wa = whatsAppUrl(d.client.mobile);
  const prefs = Object.values(d.preferences ?? {}).filter(Boolean);
  const formula = (d.records ?? []).find((r) => r.formula);
  const sub = [
    d.client.phone,
    `${d.profile.visits} visit${d.profile.visits === 1 ? '' : 's'}`,
    d.profile.preferred ? `${firstName(d.profile.preferred)} usually` : null,
    ...prefs,
  ]
    .filter(Boolean)
    .join(' · ');
  const canRecord = desk.may('salon.visit.service');

  return (
    <Panel className="flex flex-col gap-3.5">
      <Header name={d.client.name} tier={d.profile.tier} reliability={d.profile.reliability} sub={sub} />
      <AllergyLine allergies={live} test={test} onUpdate={d.may.edit ? () => setRecording(true) : undefined} />

      <div className="grid grid-cols-3 gap-3">
        <Figure label="Points" value={(d.loyalty?.points ?? d.profile.points).toLocaleString()} />
        <Figure label="Store credit" value={d.credit ? amount(d.credit.balance, d.credit.currency) : '—'} />
        <Figure label="Owes" value={d.invoices === null ? '—' : owing.length === 0 ? 'Nothing' : owing.map((i) => amount(i.owed, i.currency)).join(' + ')} />
      </div>

      <div>
        <Label className="tracking-[.06em]">Recent visits</Label>
        {d.visits.length === 0 ? (
          <p className="py-2 text-[14px] text-ink-2">No visits yet.</p>
        ) : (
          <ul>
            {d.visits.slice(0, 5).map((v) => {
              const done = ['checked_in', 'in_service', 'completed'].includes(v.status);
              return (
                <li key={v.id} className="flex items-center gap-3 border-b border-line py-2.5 text-[14px] last:border-b-0">
                  <span className={cx('min-w-0 flex-1 truncate text-ink', (v.status === 'cancelled' || v.status === 'no_show') && 'text-ink-3 line-through')}>
                    <b>{v.date === today ? 'Today' : dayMonth(v.date, false)}</b> · {v.items.map((i) => i.service).join(', ')}
                  </span>
                  <span className="shrink-0 text-ink-2">{[...new Set(v.items.map((i) => firstName(i.provider)))].join(', ')}</span>
                  {done && canRecord && !desk.offline ? (
                    <button type="button" onClick={() => desk.go('record', { visit: v.id })} title="Formula & photos" aria-label={`Service record for ${dayMonth(v.date, false)}`} className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-ink-2 hover:bg-subtle hover:text-primary">
                      <Icon name="file-text" size={17} />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {formula ? (
        <div className="rounded-[12px] bg-ground px-3.5 py-2.5 text-[13.5px] text-ink">
          <span className="font-bold">Last formula</span>
          <span className="text-ink-2">
            {' '}
            · {formula.service}
            {formula.date ? ` · ${dayMonth(formula.date, false)}` : ''}
            {formula.provider ? ` · ${firstName(formula.provider)}` : ''}
          </span>
          <div className="mt-0.5 font-mono text-[13px]">{formula.formula}</div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2.5">
        <TouchButton icon="external" onClick={() => void call('app:openInBrowser', { path: `/salon?view=clients&client=${d.client.id}` })}>
          Open full record
        </TouchButton>
        {wa ? (
          <TouchButton icon="message-circle" onClick={() => void call('app:openExternal', { url: wa }).catch(() => toast('error', 'WhatsApp could not be opened.'))}>
            WhatsApp
          </TouchButton>
        ) : null}
        {desk.may('salon.visit.book') ? (
          <TouchButton
            variant="primary"
            icon="plus"
            className="min-w-[200px] flex-1"
            onClick={() =>
              desk.walkIn(
                {
                  client_id: d.client.id,
                  service_ids: last ? [...new Set(last.items.map((i) => i.service_id))] : [],
                  provider_id: last?.items[0]?.provider_id,
                },
                true,
              )
            }
          >
            Book again
          </TouchButton>
        ) : null}
      </div>
      {recording && d.may.edit ? <RecordAllergy clientId={d.client.id} name={d.client.name} onClose={() => setRecording(false)} /> : null}
    </Panel>
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

  const field = 'h-12 rounded-[12px] border border-line bg-surface px-3.5 text-[15px] text-ink outline-none focus:border-primary';
  return (
    <DeskDialog
      tone="danger"
      icon="warning"
      title={`An allergy for ${name}`}
      sub="As the client tells it. It is read out at every check-in from now on."
      labelledBy="salon-record-allergy"
      width={560}
      onClose={onClose}
      footer={
        <>
          <TouchButton onClick={onClose}>Cancel</TouchButton>
          <TouchButton variant="primary" icon="check" loading={busy} disabled={substance.trim() === ''} onClick={() => void save()}>
            Record it
          </TouchButton>
        </>
      }
    >
      <label className="flex flex-col gap-1">
        <span className="text-[12.5px] font-semibold text-ink-2">What to</span>
        <input className={field} placeholder="PPD, latex, fragrance…" value={substance} onChange={(e) => setSubstance(e.target.value)} autoFocus />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[12.5px] font-semibold text-ink-2">What happened</span>
        <input className={field} placeholder="Swelling of the scalp" value={reaction} onChange={(e) => setReaction(e.target.value)} />
      </label>
      <div className="flex flex-col gap-1.5">
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
    </DeskDialog>
  );
}
