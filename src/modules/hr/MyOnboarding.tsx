import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, request } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner } from '../../components/ui';
import { BankCard } from './Bank';
import MyDocuments from './MyDocuments';
import { ProgressBar, RequiredDocs, StepList, type ObState } from './onboardingParts';
import { btn, btnPrimary, Field, input, PageHead, Panel, SidePanel } from '../../components/PageKit';
import { dayLong } from './dates';
import { Icon } from '../../components/Icon';
import { useTab } from '../../core/tab-context';

/**
 * My onboarding (HrSelfService "My onboarding"; the web's MyOnboarding):
 * where I am, the documents HR needs from me, my own details (only the
 * fields the server lets a new hire fill in, saved one at a time as the
 * server takes them), my documents and my bank details.
 */
const GROUPS: Array<[string, Array<[string, string, string?]>]> = [
  ['About you', [['first_name', 'First name'], ['middle_name', 'Middle name'], ['last_name', 'Last name'], ['preferred_name', 'Preferred name'], ['date_of_birth', 'Date of birth', 'date'], ['gender', 'Gender'], ['nationality', 'Nationality'], ['marital_status', 'Marital status']]],
  ['How to reach you', [['personal_email', 'Personal email', 'email'], ['mobile', 'Mobile'], ['telephone', 'Telephone']]],
  ['In an emergency', [['emergency_name', 'Contact name'], ['emergency_relation', 'Relationship'], ['emergency_phone', 'Contact phone']]],
  ['Where you live', [['address_1', 'Address line 1'], ['address_2', 'Address line 2'], ['city', 'City'], ['province', 'Province / State'], ['postal_code', 'Postal code'], ['country', 'Country']]],
];

export default function MyOnboarding() {
  const qc = useQueryClient();
  const { go } = useTab();
  const [docs, setDocs] = useState(false);
  const q = useQuery({ queryKey: ['hr', 'my-onboarding'], queryFn: ({ signal }) => apiGet<ObState>('/api/hr/me/onboarding', undefined, signal), retry: false });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hr'] });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data!;
  if (s.linked === false) return <Nothing icon="link" title="Not linked to an employee record" text="Your login is not linked to an employee record yet, so there is nothing to complete. HR can link it." />;
  if (!s.onboarding) return <Nothing icon="check-circle" title="You’re all set up" text="You are not going through onboarding — your employment record is already set up." action={{ label: 'Open My HR', run: () => go('/hr?tab=myhr') }} />;
  if (s.onboarding.status === 'cancelled') return <Nothing icon="info" title="Onboarding is paused" text="Your onboarding is not currently active. Please speak to HR." />;
  const done = s.onboarding.status === 'completed';
  const first = (s.profile?.preferred_name || s.profile?.first_name || s.employee.name.split(/\s+/)[0]) ?? '';
  const when = s.onboarding.target_start_date ?? s.employee.joined_at;

  return (
    <div className="@container flex flex-col gap-3.5">
      <PageHead title="My onboarding" sub={done ? 'Everything is done. Welcome aboard.' : 'A few things to complete before your first day. Anything you enter here goes straight onto your HR record.'} />
      <section className="flex flex-wrap items-center gap-4 rounded-[14px] border border-line bg-[linear-gradient(120deg,var(--ws-info-soft),var(--color-surface))] px-5 py-4 dark:bg-[linear-gradient(120deg,var(--color-selection),var(--color-surface))]">
        <span className="flex min-w-[220px] flex-1 flex-col">
          <b className="text-[18px] text-ink">{done ? `Welcome aboard, ${first}` : `Welcome, ${first}`}</b>
          <span className="text-[12.5px] text-ink-3">
            {s.employee.employee_no}
            {when ? ` · ${done ? 'joined' : 'joining'} ${dayLong(when)}` : ''}
            {!done && s.next ? ` · next: ${s.steps.find((x) => x.step === s.next)?.label ?? ''}` : ''}
          </span>
        </span>
        <span className="flex w-[220px] items-center gap-2.5">
          <ProgressBar percent={done ? 100 : s.percent} className="flex-1" />
          <b className="text-[15px] text-ink tabular-nums">{done ? 100 : s.percent}%</b>
        </span>
      </section>
      <div className="grid items-start gap-3.5 @min-[900px]:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <Panel title="Where you are" bodyClassName="">
            <div className="flex items-center gap-2.5 border-b border-line/70 px-3.5 py-2.5">
              <ProgressBar percent={done ? 100 : s.percent} className="flex-1" />
              <b className="text-ink tabular-nums">{done ? 100 : s.percent}%</b>
            </div>
            <StepList
              state={s}
              actions={(st) =>
                done || st.status === 'done'
                  ? []
                  : st.step === 'required_documents'
                    ? [{ label: 'Upload', run: () => setDocs(true) }]
                    : st.step === 'bank_details'
                      ? [{ label: 'Open', run: () => document.getElementById('my-bank')?.scrollIntoView({ behavior: 'smooth' }) }]
                      : []
              }
            />
          </Panel>
          {s.required_documents?.length ? (
            <Panel title="Documents we need from you">
              <RequiredDocs docs={s.required_documents} uploadTo="/api/hr/me/documents" onChanged={refresh} />
            </Panel>
          ) : null}
        </div>
        <div className="flex flex-col gap-3">
          {!done ? <Details employeeId={s.employee.id} profile={s.profile ?? {}} allowed={s.self_fields ?? []} onSaved={refresh} /> : null}
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={() => setDocs(true)}>
              Upload your documents
            </button>
            <button type="button" className={btn} onClick={() => document.getElementById('my-bank')?.scrollIntoView({ behavior: 'smooth' })}>
              Your bank details
            </button>
          </div>
          <div id="my-bank" className="max-w-[560px]">
            <BankCard employeeId={s.employee.id} />
          </div>
        </div>
      </div>
      {docs ? (
        <SidePanel label="My documents" width={760} onClose={() => setDocs(false)} head={<b className="text-ink">Upload your documents</b>}>
          <MyDocuments />
        </SidePanel>
      ) : null}
    </div>
  );
}

function Nothing({ icon, title, text, action }: { icon: string; title: string; text: string; action?: { label: string; run: () => void } }) {
  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="My onboarding" />
      <div className="flex flex-col items-center gap-2 rounded-[14px] border border-line bg-surface px-6 py-12 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-selection text-primary">
          <Icon name={icon} size={20} />
        </span>
        <b className="text-[14.5px] text-ink">{title}</b>
        <span className="max-w-[420px] text-[12.5px] text-ink-3">{text}</span>
        {action ? (
          <button type="button" className={`${btn} mt-1`} onClick={action.run}>
            {action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** My details, saved field by field (the server takes one field per call and refuses the rest). */
function Details({ employeeId, profile, allowed, onSaved }: { employeeId: number; profile: Record<string, string | null>; allowed: string[]; onSaved: () => void }) {
  const was = Object.fromEntries(allowed.map((k) => [k, profile[k] ?? '']));
  const [f, setF] = useState<Record<string, string>>(was);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const changed = allowed.filter((k) => (f[k] ?? '') !== (was[k] ?? ''));
  const save = async () => {
    setBusy(true);
    const failed: string[] = [];
    for (const k of changed) {
      try {
        await request('PATCH', `/api/hr/employees/${employeeId}/fields`, { body: { field: k, value: f[k] ?? '' } });
      } catch (e) {
        failed.push(`${k.replace(/_/g, ' ')}: ${errorMessage(e)}`);
      }
    }
    setBusy(false);
    if (failed.length) toast('error', failed.join('; '));
    else {
      toast('success', 'Saved to your HR record.');
      setSaved(true);
    }
    onSaved();
  };
  return (
    <Panel
      title="Your details"
      action={saved && !changed.length ? <span className="text-[12px] font-semibold text-success">Saved</span> : null}
      bodyClassName="flex flex-col gap-3 px-3.5 py-3"
    >
      {GROUPS.map(([title, fields]) => {
        const shown = fields.filter(([k]) => allowed.includes(k));
        if (!shown.length) return null;
        return (
          <div key={title} className="flex flex-col gap-1.5">
            <div className="text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">{title}</div>
            <div className="grid grid-cols-2 gap-2.5 @min-[1100px]:grid-cols-3">
              {shown.map(([k, label, type]) => (
                <Field key={k} label={label}>
                  <input aria-label={label} type={type ?? 'text'} value={f[k] ?? ''} onChange={(e) => (setSaved(false), setF((p) => ({ ...p, [k]: e.target.value })))} className={input} />
                </Field>
              ))}
            </div>
          </div>
        );
      })}
      <div className="flex justify-end">
        <button type="button" disabled={busy || !changed.length} className={btnPrimary} onClick={() => void save()}>
          {busy ? 'Saving…' : changed.length ? `Save ${changed.length} ${changed.length === 1 ? 'change' : 'changes'}` : 'Save'}
        </button>
      </div>
    </Panel>
  );
}
