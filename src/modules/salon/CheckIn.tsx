import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Spinner, cx } from '../../components/ui';
import { ApiError } from '../../core/api';
import { toast } from '../../core/toasts';
import { answered, attemptKey, atLeast, checkIn, fetchVisit, K, refusal, dayMonth, STATEMENT, type Allergy, type CheckInExtra, type Gate, type PatchTest, type Visit } from './api';
import { keep, SK, syncNow } from './offline';
import { DeskDialog, firstName, SEVERITY_TONE, servicesOf, severityLabel, stylistsOf, Tag, TouchButton } from './parts';
import { Checkbox } from '../../components/Checkbox';

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
 *
 * With WorkSuite out of reach the panel reads the allergy from the day's copy,
 * and the check-in — with the statement ticked — is kept to send. WorkSuite
 * judges it again then: a patch test it wants comes back as a change that
 * needs a person.
 */
interface Open {
  visit: Visit;
  gate: Gate | null;
}

export function useCheckIn(ackSeverity: string, offline = false, onUpdate?: (clientId: number) => void) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(visit: Visit, extra: CheckInExtra) {
    setBusy(true);
    try {
      if (offline) {
        await keep([{ kind: 'visit.check_in', payload: { visit_id: visit.id, ...extra }, label: `Check-in: ${visit.client.name}`, detail: `${servicesOf(visit)} · ${visit.start}` }]);
        toast('success', `${visit.client.name}’s check-in is kept, and goes to WorkSuite when it answers.`);
        setOpen(null);
        void qc.invalidateQueries({ queryKey: SK.all });
        return;
      }
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
        /* No answer: the desk asks WorkSuite again now, and works from its copy if it is down. */
        if (e instanceof ApiError && e.offline) void syncNow().catch(() => undefined);
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

  const panel = open ? (
    <CheckInPanel
      visit={open.visit}
      gate={open.gate}
      busy={busy}
      offline={offline}
      onSubmit={(x) => void send(open.visit, x)}
      onClose={() => setOpen(null)}
      onUpdate={
        onUpdate && !offline
          ? () => {
              setOpen(null);
              onUpdate(open.visit.client.id);
            }
          : undefined
      }
    />
  ) : null;

  return { start, panel, busy };
}

function CheckInPanel({ visit, gate, busy, offline, onSubmit, onClose, onUpdate }: { visit: Visit; gate: Gate | null; busy: boolean; offline: boolean; onSubmit: (x: CheckInExtra) => void; onClose: () => void; onUpdate?: () => void }) {
  const detail = useQuery({ queryKey: K.visit(visit.id), queryFn: ({ signal }) => fetchVisit(visit.id, signal), enabled: !offline });
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
      loading={detail.isLoading && !gate && !offline}
      busy={busy}
      confirmLabel={offline ? `Keep ${firstName(visit.client.name)}’s check-in` : `Check in ${firstName(visit.client.name)}`}
      onConfirm={onSubmit}
      onClose={onClose}
      onUpdate={allergies.length > 0 ? onUpdate : undefined}
    />
  );
}

/**
 * The gate itself, shared by check-in and starting a walk-in now (D05): the
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
  onUpdate,
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
  /** "Update allergies": the client's card, to record what they say has changed. */
  onUpdate?: () => void;
  extra?: ReactNode;
}) {
  const [ticked, setTicked] = useState(false);
  const [reason, setReason] = useState('');
  const needsAck = allergies.length > 0;
  const needsReason = missing.length > 0 || gate?.code === 'patch_test_required' || gate?.code === 'patch_test_override';
  const covering = patchTests.find((t) => t.result === 'negative' && t.valid_until);
  const ready = (!needsAck || ticked) && (!needsReason || reason.trim() !== '');

  return (
    <DeskDialog
      tone={needsAck ? 'danger' : needsReason ? 'warning' : 'indigo'}
      icon={needsAck || needsReason ? 'warning' : 'check'}
      title={title}
      sub={sub}
      labelledBy="salon-allergy-gate"
      onClose={onClose}
      footer={
        <>
          {extra}
          {onUpdate ? (
            <TouchButton icon="pen" onClick={onUpdate}>
              Update allergies
            </TouchButton>
          ) : (
            <TouchButton onClick={onClose}>Not now</TouchButton>
          )}
          <TouchButton variant="primary" icon="check" loading={busy} disabled={!ready || loading} onClick={() => onConfirm({ ...(needsAck ? { ack: true, statement } : {}), ...(needsReason ? { patch_override: reason.trim() } : {}) })}>
            {confirmLabel}
          </TouchButton>
        </>
      }
    >
      {gate?.code ? <div className={gate.code === 'patch_test_override' ? 'rounded-[12px] bg-danger-bg px-3.5 py-2.5 text-[14px] font-medium text-danger' : 'rounded-[12px] bg-warning-bg px-3.5 py-2.5 text-[14px] font-medium text-warning-ink'}>{gate.message}</div> : null}

      {loading ? (
        <Spinner label="Reading the allergies on file…" />
      ) : allergies.length === 0 ? (
        <p className="text-[15px] text-ink-2">No allergy on file.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {allergies.map((a, i) => (
            <li key={a.id || i} className="flex items-start gap-3">
              <Tag tone={SEVERITY_TONE[a.severity]} className="mt-0.5 text-[13px]">
                {severityLabel(a.severity)}
              </Tag>
              <div className="text-[15px] text-ink">
                <b>{a.substance}</b>
                {a.reaction ? <span> — {a.reaction}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {covering ? (
        <div className="flex items-start gap-2 rounded-[12px] bg-rail px-3.5 py-3 text-[14px] text-success-ink dark:bg-success-bg dark:text-success">
          <Icon name="check" size={16} className="mt-0.5 shrink-0" />
          <span>
            Patch test {dayMonth(covering.tested_at)}
            {covering.product ? ` · ${covering.product}` : ''} · no reaction · valid until {dayMonth(covering.valid_until)}
          </span>
        </div>
      ) : null}

      {needsReason ? (
        <label className="flex flex-col gap-1.5 rounded-[12px] border border-[var(--ws-note-line)] bg-warning-bg px-3.5 py-3">
          <span className="text-[14px] font-semibold text-warning-ink">{missing.length > 0 ? `${missing.join(', ')} needs a valid patch test, and there is none on file.` : 'A valid patch test is needed.'}</span>
          <span className="text-[13px] font-semibold text-ink">Why are you going ahead?</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={300}
            className="rounded-[10px] border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-primary"
          />
        </label>
      ) : null}

      {needsAck ? (
        <label className={cx('flex cursor-pointer items-center gap-3 rounded-[12px] border-2 px-3.5 py-3', ticked ? 'border-primary bg-selection' : 'border-line bg-surface')}>
          <Checkbox size="lg" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
          <span className="text-[15px] font-bold text-ink">{statement}</span>
        </label>
      ) : null}
    </DeskDialog>
  );
}
