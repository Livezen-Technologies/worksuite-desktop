import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { Card, PageHeader, Planned, btn, btnPrimary } from './parts';

/**
 * Automation journeys (R01): event-driven journeys across email, WhatsApp,
 * SMS and calls. Planned for phase 4 and NOT in the current code — so this
 * screen draws the example journey the SRS describes and says plainly that it
 * is planned; nothing on it runs, and its two buttons are switched off.
 *
 * The journey is drawn as boxes for the eye and kept as an ordered list for a
 * screen reader, which reads the same steps in order, branch by branch.
 */
type Tone = 'blue' | 'slate' | 'violet' | 'green' | 'amber';

interface Step { title: string; detail: string; icon: string; tone: Tone }

const TONE: Record<Tone, string> = {
  blue: 'bg-selection text-primary',
  slate: 'bg-subtle text-ink-2',
  violet: 'bg-[#F1EAFB] text-[#5B2FA0] dark:bg-[#2A1F45] dark:text-[#C4A8F0]',
  green: 'bg-success-bg text-success',
  amber: 'bg-warning-bg text-[#9A4A06] dark:text-warning',
};

const TRUNK: Step[] = [
  { title: 'Trigger · joins list', detail: 'Web sign-up (Forms) → Newsletter', icon: 'zap', tone: 'blue' },
  { title: 'Send email', detail: 'Welcome · template “Welcome v2”', icon: 'mail', tone: 'blue' },
  { title: 'Wait', detail: '3 days', icon: 'clock', tone: 'slate' },
  { title: 'Branch · opened welcome?', detail: 'Human opens only', icon: 'filter', tone: 'violet' },
];

const YES: Step[] = [
  { title: 'Add score +10 · tag engaged', detail: 'Lead scoring', icon: 'star', tone: 'green' },
  { title: 'Hand over to CRM', detail: 'LeadWriter · owner round-robin', icon: 'zap', tone: 'green' },
];

const NO: Step[] = [
  { title: 'Send WhatsApp', detail: 'Approved template · consent required', icon: 'message-circle', tone: 'amber' },
  { title: 'Create call task', detail: 'Queue: Nurture calls', icon: 'phone', tone: 'amber' },
];

const STEP_KINDS: Array<[string, string]> = [
  ['zap', 'Triggers · list, segment, form, tag, CRM stage, date'],
  ['mail', 'Send email'],
  ['message-circle', 'Send WhatsApp (CoreWhatsAppService)'],
  ['chat', 'Send SMS (VoIP gateway)'],
  ['phone', 'Create call task'],
  ['clock', 'Wait / wait until'],
  ['filter', 'Branch · split test'],
  ['star', 'Score · tag · list'],
  ['zap', 'Hand over to CRM'],
];

function Box({ s }: { s: Step }) {
  return (
    <div className="flex w-[300px] max-w-full items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3.5">
      <span className={cx('flex size-9 shrink-0 items-center justify-center rounded-[9px]', TONE[s.tone])}>
        <Icon name={s.icon} size={17} />
      </span>
      <span className="min-w-0">
        <b className="block text-[14px] text-ink">{s.title}</b>
        <span className="block text-[12.5px] text-ink-3">{s.detail}</span>
      </span>
    </div>
  );
}

const Wire = () => <span className="block h-[26px] w-0.5 bg-line" />;

function Branch({ word, tone, steps }: { word: string; tone: string; steps: Step[] }) {
  return (
    <div className="flex flex-col items-center">
      <Wire />
      <span className={cx('text-[12px] font-bold', tone)}>{word}</span>
      {steps.map((s) => (
        <div key={s.title} className="flex flex-col items-center">
          <Wire />
          <Box s={s} />
        </div>
      ))}
    </div>
  );
}

export default function Automation() {
  return (
    <div className="flex flex-col">
      <PageHeader
        crumbs={['Automation']}
        title="Welcome journey"
        sub="Event-driven journeys across email, WhatsApp, SMS and calls — not in the current code"
        actions={
          <>
            <Planned phase="phase 4" />
            <button type="button" className={btn} disabled title="Planned for phase 4: not in the current code">
              <Icon name="eye" size={15} /> Test with a contact
            </button>
            <button type="button" className={btnPrimary} disabled title="Planned for phase 4: not in the current code">
              <Icon name="zap" size={15} /> Activate
            </button>
          </>
        }
      />

      <div className="flex flex-wrap items-start gap-4">
        <section aria-labelledby="journey-title" className="min-w-0 flex-[999_1_560px] rounded-[12px] border border-line bg-ground p-5">
          <h2 id="journey-title" className="sr-only">
            The example journey, step by step
          </h2>
          {/* For a screen reader: the same journey, in order. */}
          <ol className="sr-only">
            {TRUNK.map((s) => (
              <li key={s.title}>
                {s.title}: {s.detail}
              </li>
            ))}
            <li>
              If yes:
              <ol>
                {YES.map((s) => (
                  <li key={s.title}>
                    {s.title}: {s.detail}
                  </li>
                ))}
              </ol>
            </li>
            <li>
              If no:
              <ol>
                {NO.map((s) => (
                  <li key={s.title}>
                    {s.title}: {s.detail}
                  </li>
                ))}
              </ol>
            </li>
          </ol>
          {/* For the eye: boxes and wires. */}
          <div aria-hidden="true" className="flex flex-col items-center py-5">
            {TRUNK.map((s, i) => (
              <div key={s.title} className="flex flex-col items-center">
                {i > 0 ? <Wire /> : null}
                <Box s={s} />
              </div>
            ))}
            <div className="flex flex-wrap justify-center gap-x-10">
              <Branch word="YES" tone="text-success" steps={YES} />
              <Branch word="NO" tone="text-[#9A4A06] dark:text-warning" steps={NO} />
            </div>
          </div>
        </section>

        <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-4">
          <Card title="Steps">
            <ul className="m-0 flex list-none flex-col p-0">
              {STEP_KINDS.map(([icon, label]) => (
                <li key={label} className="flex items-start gap-2.5 border-b border-line/70 py-2 text-[13px] text-ink last:border-b-0">
                  <Icon name={icon} size={15} className="mt-0.5 shrink-0 text-ink-3" />
                  {label}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Guardrails">
            <p className="m-0 text-[13px] text-ink-2">Every send step re-checks consent, topic and suppression at the moment it runs. Contacts leave the journey on unsubscribe.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
