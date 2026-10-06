import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Button, cx, Empty } from '../../../components/ui';
import { fetchJourneys, MK, type Journey } from '../api';
import { count } from '../lib/format';
import { useMarketingOrg } from '../org';
import { Notice, OptionalView, PageBody, PageHeader, Panel, Status } from '../parts';

/**
 * DK14 / R01 · Automation (MKT-AUT-01…03; WF-15; constraint C6). Event-driven journeys across email, WhatsApp, SMS and
 * calls are Target, phase 4. A server that offers them (`GET /journeys`) lists its journeys with the chosen one's
 * steps as a flow. Today's servers do not: the screen then draws the design's welcome journey, captioned as an example
 * that nothing runs, and holds Test with a contact and Activate back.
 */
type Tone = 'indigo' | 'muted' | 'violet' | 'success' | 'warning';

interface Step {
  icon: string;
  tone: Tone;
  title: string;
  detail: string | null;
}

const TONES: Record<Tone, string> = {
  indigo: 'bg-selection text-primary',
  muted: 'bg-subtle text-ink-2',
  violet: 'bg-[#F3E8FF] text-[#6D28D9] dark:bg-[#2E1D4A] dark:text-[#D2B4FE]',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
};

const PLANNED = 'Planned for phase 4';

// The design's example (R01): drawn, never run.
const EXAMPLE: Step[] = [
  { icon: 'zap', tone: 'indigo', title: 'Trigger · joins list', detail: 'Web sign-up (Forms) → Newsletter' },
  { icon: 'mail', tone: 'indigo', title: 'Send email', detail: 'Welcome · template “Welcome v2”' },
  { icon: 'clock', tone: 'muted', title: 'Wait', detail: '3 days' },
  { icon: 'filter', tone: 'violet', title: 'Branch · opened welcome?', detail: 'Human opens only' },
];
const EXAMPLE_YES: Step[] = [
  { icon: 'star', tone: 'success', title: 'Add score +10 · tag engaged', detail: 'Lead scoring' },
  { icon: 'handshake', tone: 'success', title: 'Hand over to CRM', detail: 'LeadWriter · owner round-robin' },
];
const EXAMPLE_NO: Step[] = [
  { icon: 'message-circle', tone: 'warning', title: 'Send WhatsApp', detail: 'Approved template · consent required' },
  { icon: 'phone', tone: 'warning', title: 'Create call task', detail: 'Queue: Nurture calls' },
];

const STEP_KINDS: Array<{ icon: string; label: string }> = [
  { icon: 'zap', label: 'Triggers · list, segment, form, tag, CRM stage, date' },
  { icon: 'mail', label: 'Send email' },
  { icon: 'message-circle', label: 'Send WhatsApp (CoreWhatsAppService)' },
  { icon: 'chat', label: 'Send SMS (VoIP gateway)' },
  { icon: 'phone', label: 'Create call task' },
  { icon: 'clock', label: 'Wait / wait until' },
  { icon: 'filter', label: 'Branch · split test' },
  { icon: 'star', label: 'Score · tag · list' },
  { icon: 'handshake', label: 'Hand over to CRM' },
];

const JOURNEY_STATUS: Record<Journey['status'], { label: string; tone: 'success' | 'warning' | 'muted' }> = {
  active: { label: 'Active', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
  draft: { label: 'Draft', tone: 'muted' },
};

/** How a journey step of the server's looks: its icon and colour, by kind. */
export function stepLook(kind: string): { icon: string; tone: Tone } {
  const k = kind.toLowerCase();
  if (/trigger|join|entry|enrol/.test(k)) return { icon: 'zap', tone: 'indigo' };
  if (/whatsapp/.test(k)) return { icon: 'message-circle', tone: 'warning' };
  if (/sms/.test(k)) return { icon: 'chat', tone: 'warning' };
  if (/mail/.test(k)) return { icon: 'mail', tone: 'indigo' };
  if (/call/.test(k)) return { icon: 'phone', tone: 'warning' };
  if (/wait|delay/.test(k)) return { icon: 'clock', tone: 'muted' };
  if (/branch|split|condition/.test(k)) return { icon: 'filter', tone: 'violet' };
  if (/hand|crm|lead/.test(k)) return { icon: 'handshake', tone: 'success' };
  if (/score|tag|list/.test(k)) return { icon: 'star', tone: 'success' };
  return { icon: 'circle-dot', tone: 'muted' };
}

export default function Automation() {
  const org = useMarketingOrg();
  const q = useQuery({ queryKey: MK.journeys(org), queryFn: ({ signal }) => fetchJourneys(org, signal), staleTime: 60_000 });
  const planned = q.data?.offered === false;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing / Automation"
        title="Automation"
        sub={planned ? 'Event-driven journeys across email, WhatsApp, SMS and calls — not in the current code' : 'Event-driven journeys across email, WhatsApp, SMS and calls'}
        actions={
          planned ? (
            <>
              <Status tone="violet">Planned · phase 4</Status>
              <Held icon="eye">Test with a contact</Held>
              <Held icon="zap" primary>
                Activate
              </Held>
            </>
          ) : undefined
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0">
            <OptionalView q={q} what="Automation" notOffered={<Example />}>
              {(journeys) => <Journeys journeys={journeys} />}
            </OptionalView>
          </div>
          <aside className="flex flex-col gap-4">
            <Panel title="Steps" bodyClassName="px-4 pb-3">
              <ul className="m-0 flex list-none flex-col p-0">
                {STEP_KINDS.map((s) => (
                  <li key={s.label} className="flex items-start gap-2.5 border-b border-line py-2 text-[12.5px] text-ink-2 last:border-b-0">
                    <Icon name={s.icon} size={15} className="mt-px shrink-0 text-ink-3" />
                    {s.label}
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Guardrails" bodyClassName="flex flex-col gap-2 px-4 pb-4 text-[12.5px] leading-relaxed text-ink-2">
              <p className="m-0">Every send step re-checks consent, topic and suppression at the moment it runs. Contacts leave the journey on unsubscribe.</p>
              <p className="m-0 text-ink-3">People decide: anything drafted or suggested for a journey is approved by a person before it is sent or written to CRM.</p>
            </Panel>
          </aside>
        </div>
      </PageBody>
    </div>
  );
}

/** A planned action: focusable and announced as unavailable, saying why (a disabled button could not). */
function Held({ icon, primary, children }: { icon: string; primary?: boolean; children: string }) {
  return (
    <Button variant={primary ? 'primary' : 'secondary'} icon={icon} aria-disabled="true" title={PLANNED} className="cursor-not-allowed opacity-50">
      {children}
    </Button>
  );
}

function Example() {
  return (
    <Panel title="Welcome journey" sub="Example of a planned journey — nothing runs" bodyClassName="flex flex-col gap-3">
      <Notice tone="violet" icon="info">
        Example of a planned journey — nothing runs. Journeys are planned for phase 4, and this WorkSuite server has none.
      </Notice>
      <ol aria-label="Example journey" className="m-0 flex list-none flex-col items-center p-0 py-2">
        {EXAMPLE.map((s, i) => (
          <li key={s.title} className="flex w-full flex-col items-center">
            {i > 0 ? <Connector /> : null}
            <StepCard s={s} />
          </li>
        ))}
        <li className="flex w-full flex-col items-center">
          <Connector />
          <div className="relative grid w-full max-w-[660px] grid-cols-2 gap-3 sm:gap-6">
            <span aria-hidden className="absolute top-0 right-1/4 left-1/4 h-px bg-line" />
            <Branch label="Yes" tone="text-success" steps={EXAMPLE_YES} />
            <Branch label="No" tone="text-warning" steps={EXAMPLE_NO} />
          </div>
        </li>
      </ol>
    </Panel>
  );
}

function Branch({ label, tone, steps }: { label: string; tone: string; steps: Step[] }) {
  return (
    <section aria-label={`If ${label.toLowerCase()}`} className="flex min-w-0 flex-col items-center">
      <span aria-hidden className="block h-3 w-px bg-line" />
      <span className={cx('text-[10.5px] font-bold tracking-[.6px] uppercase', tone)}>{label}</span>
      <ol className="m-0 flex w-full list-none flex-col items-center p-0">
        {steps.map((s) => (
          <li key={s.title} className="flex w-full flex-col items-center">
            <Connector />
            <StepCard s={s} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function Connector() {
  return <span aria-hidden className="block h-5 w-px shrink-0 bg-line" />;
}

function StepCard({ s }: { s: Step }) {
  return (
    <div className="flex w-full max-w-[300px] items-center gap-3 rounded-[10px] border border-line bg-surface px-3 py-2.5 shadow-sm">
      <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]', TONES[s.tone])}>
        <Icon name={s.icon} size={16} />
      </span>
      <span className="min-w-0">
        <b className="block text-[12.5px] leading-snug text-ink">{s.title}</b>
        {s.detail ? <span className="block text-[11.5px] leading-snug text-ink-3">{s.detail}</span> : null}
      </span>
    </div>
  );
}

/** A server that offers journeys: its list, and the chosen one's steps in order. */
function Journeys({ journeys }: { journeys: Journey[] }) {
  const [chosen, setChosen] = useState<number | null>(null);
  if (journeys.length === 0) {
    return (
      <div className="rounded-[12px] border border-line bg-surface">
        <Empty icon="git-branch" title="No journeys yet" hint="This WorkSuite server offers journeys, but none has been made for this company." />
      </div>
    );
  }
  const current = journeys.find((j) => j.id === chosen) ?? journeys[0]!;
  const status = JOURNEY_STATUS[current.status] ?? { label: current.status, tone: 'muted' as const };
  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
      <Panel title="Journeys" bodyClassName="px-2 pb-2">
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {journeys.map((j) => {
            const on = j.id === current.id;
            const s = JOURNEY_STATUS[j.status] ?? { label: j.status, tone: 'muted' as const };
            return (
              <li key={j.id}>
                <button type="button" aria-current={on ? 'true' : undefined} onClick={() => setChosen(j.id)} className={cx('flex w-full flex-col items-start gap-1 rounded-[8px] px-2.5 py-2 text-left', on ? 'bg-selection' : 'hover:bg-subtle')}>
                  <span className={cx('w-full truncate text-[13px] font-semibold', on ? 'text-primary' : 'text-ink')}>{j.name}</span>
                  <span className="w-full truncate text-[11.5px] text-ink-3">{j.trigger}</span>
                  <span className="flex items-center gap-2 text-[11.5px] text-ink-3">
                    <Status tone={s.tone}>{s.label}</Status>
                    {typeof j.enrolled === 'number' ? `${count(j.enrolled)} enrolled` : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel title={current.name} sub={`Trigger · ${current.trigger}`} action={<Status tone={status.tone}>{status.label}</Status>}>
        {current.steps.length === 0 ? (
          <Empty icon="git-branch" title="This journey has no steps yet" />
        ) : (
          <ol aria-label={`Steps of ${current.name}`} className="m-0 flex list-none flex-col items-center p-0 py-2">
            {current.steps.map((st, i) => {
              const look = stepLook(st.kind);
              return (
                <li key={st.id} className="flex w-full flex-col items-center">
                  {i > 0 ? <Connector /> : null}
                  <StepCard s={{ icon: look.icon, tone: look.tone, title: st.title, detail: st.detail }} />
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </div>
  );
}
