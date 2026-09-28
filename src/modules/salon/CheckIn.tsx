import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Button, Chip, Modal, Spinner } from '../../components/ui';
import { toast } from '../../core/toasts';
import { answered, attemptKey, atLeast, checkIn, fetchVisit, K, refusal, shortDay, STATEMENT, type Allergy, type CheckInExtra, type Gate, type PatchTest, type Visit } from './api';
import { firstName, SEVERITY_TONE, servicesOf, severityLabel, stylistsOf } from './parts';

/**
 * Checking a client in (D05), and the allergy panel in front of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DESK READS THE ALLERGY OUT BEFORE IT CAN PRESS CHECK IN (SAFE-02)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A client with an allergy at or above the company's threshold opens this
 * panel first: what is on file, how severe, the reaction, the patch test that
 * covers today, and the statement the receptionist confirms with a box they
 * tick themselves. Anybody else is checked in on the press; if the server
 * still finds something (an allergy added a minute ago, a colour service with
 * no valid patch test) its 409 opens the same panel with what it found.
 */
interface Open {
  visit: Visit;
  gate: Gate | null;
}

export function useCheckIn(ackSeverity: string) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(visit: Visit, extra: CheckInExtra) {
    setBusy(true);
    try {
      /* A new attempt, a new key: a refusal is kept against the last one. */
      const r = await checkIn(visit.id, extra, attemptKey());
      toast('success', r.message || `${visit.client.name} is checked in.`);
      setOpen(null);
      void qc.invalidateQueries({ queryKey: K.all });
    } catch (e) {
      const d = refusal(e);
      if (answered(e) && d.gate && (d.code === 'ack_required' || d.code === 'patch_test_required' || d.code === 'patch_test_override')) {
        setOpen({ visit, gate: d.gate });
      } else {
        toast('error', e instanceof Error ? e.message : 'The check-in did not go through.');
      }
    } finally {
      setBusy(false);
    }
  }

  function start(visit: Visit) {
    const a = visit.client.allergy;
    if (a && atLeast(a.severity, ackSeverity)) setOpen({ visit, gate: null });
    else void send(visit, {});
  }

  const panel = open ? <CheckInPanel visit={open.visit} gate={open.gate} busy={busy} onSubmit={(x) => void send(open.visit, x)} onClose={() => setOpen(null)} /> : null;

  return { start, panel, busy };
}

function CheckInPanel({ visit, gate, busy, onSubmit, onClose }: { visit: Visit; gate: Gate | null; busy: boolean; onSubmit: (x: CheckInExtra) => void; onClose: () => void }) {
  const detail = useQuery({ queryKey: K.visit(visit.id), queryFn: ({ signal }) => fetchVisit(visit.id, signal) });
  const onFile = visit.client.allergy;
  const allergies: Allergy[] = gate?.allergies?.length
    ? gate.allergies
    : detail.data
      ? detail.data.allergies.filter((a) => !a.withdrawn_at)
      : onFile
        ? [{ id: 0, substance: onFile.substance, severity: onFile.severity, reaction: null, withdrawn_at: null }]
        : [];
  const stylists = stylistsOf(visit);

  return (
    <AllergyGate
      title={allergies.length > 0 ? `${visit.client.name} has an allergy on file` : `Check in ${visit.client.name}`}
      sub={`Read before checking in · ${servicesOf(visit)}${stylists ? ` with ${stylists}` : ''} · ${visit.start}`}
      allergies={allergies}
      patchTests={detail.data?.patch_tests ?? []}
      missing={gate?.missing_patch ?? detail.data?.missing_patch ?? []}
      statement={detail.data?.ack_statement || STATEMENT}
      gate={gate}
      loading={detail.isLoading && !gate}
      busy={busy}
      confirmLabel={`Check in ${firstName(visit.client.name)}`}
      onConfirm={onSubmit}
      onClose={onClose}
    />
  );
}

/**
 * The gate itself, shared by check-in and starting a walk-in now: the
 * allergies, the patch test, the reason when going ahead without one, and the
 * statement ticked by hand.
 */
export function AllergyGate({
  title,
  sub,
  allergies,
  patchTests,
  missing,
  statement,
  gate,
  loading = false,
  busy,
  confirmLabel,
  onConfirm,
  onClose,
  extra,
}: {
  title: string;
  sub: string;
  allergies: Allergy[];
  patchTests: PatchTest[];
  missing: string[];
  statement: string;
  gate: Gate | null;
  loading?: boolean;
  busy: boolean;
  confirmLabel: string;
  onConfirm: (extra: CheckInExtra) => void;
  onClose: () => void;
  extra?: ReactNode;
}) {
  const [ticked, setTicked] = useState(false);
  const [reason, setReason] = useState('');
  const needsAck = allergies.length > 0;
  const needsReason = missing.length > 0 || gate?.code === 'patch_test_required' || gate?.code === 'patch_test_override';
  const covering = patchTests.find((t) => t.result === 'negative' && t.valid_until);
  const ready = (!needsAck || ticked) && (!needsReason || reason.trim() !== '');

  return (
    <Modal
      title={title}
      width={640}
      onClose={onClose}
      labelledBy="salon-allergy-gate"
      footer={
        <>
          {extra}
          <Button variant="secondary" onClick={onClose}>
            Not now
          </Button>
          <Button
            variant="primary"
            size="lg"
            icon="shield-check"
            loading={busy}
            disabled={!ready || loading}
            onClick={() => onConfirm({ ...(needsAck ? { ack: true, statement } : {}), ...(needsReason ? { patch_override: reason.trim() } : {}) })}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] text-ink-2">{sub}</p>
        {gate?.code ? <div className={gate.code === 'patch_test_override' ? 'rounded-[10px] bg-danger-bg px-3.5 py-2.5 text-[13px] font-medium text-danger' : 'rounded-[10px] bg-warning-bg px-3.5 py-2.5 text-[13px] font-medium text-warning'}>{gate.message}</div> : null}

        {loading ? (
          <Spinner label="Reading the allergies on file…" />
        ) : allergies.length === 0 ? (
          <p className="text-[14px] text-ink-2">No allergy on file.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {allergies.map((a, i) => (
              <li key={a.id || i} className="flex flex-wrap items-baseline gap-2 rounded-[10px] border border-line px-3.5 py-2.5">
                <Chip tone={SEVERITY_TONE[a.severity]}>
                  <Icon name="warning" size={12} /> {severityLabel(a.severity)}
                </Chip>
                <span className="text-[16px] font-bold text-ink">{a.substance}</span>
                {a.reaction ? <span className="text-[13.5px] text-ink-2">— {a.reaction}</span> : null}
              </li>
            ))}
          </ul>
        )}

        {covering ? (
          <div className="flex items-center gap-2 rounded-[10px] bg-success-bg px-3.5 py-2.5 text-[13px] text-success">
            <Icon name="check-circle" size={16} />
            Patch test {shortDay(covering.tested_at)}
            {covering.product ? ` · ${covering.product}` : ''} · no reaction · valid until {shortDay(covering.valid_until)}
          </div>
        ) : null}

        {needsReason ? (
          <label className="flex flex-col gap-1.5 rounded-[10px] border border-warning/30 bg-warning-bg px-3.5 py-2.5">
            <span className="text-[13px] font-semibold text-warning">{missing.length > 0 ? `${missing.join(', ')} needs a valid patch test, and there is none on file.` : 'A valid patch test is needed.'}</span>
            <span className="text-[12.5px] font-semibold text-ink">Why are you going ahead?</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={300}
              className="rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-primary"
            />
          </label>
        ) : null}

        {needsAck ? (
          <label className="flex cursor-pointer items-start gap-3 rounded-[10px] bg-selection px-3.5 py-3">
            <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-primary)]" />
            <span className="text-[14px] font-bold text-ink">{statement}</span>
          </label>
        ) : null}
      </div>
    </Modal>
  );
}
