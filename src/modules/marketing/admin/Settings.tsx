import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { NEXT_CONTACT_KEYS } from '@shared/marketing';
import { apiGet } from '../../../core/api';
import { app } from '../../../core/app-state';
import { prettyAccelerator } from '../../../core/commands';
import { useStore } from '../../../core/store';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { ModuleSettingsForm } from '../../../components/ModuleSettingsForm';
import { Select } from '../../../components/Select';
import { Button, cx, Empty, Kbd, Switch } from '../../../components/ui';
import { MK, saveSettings, useSettings, type MarketingSettings } from '../api';
import { CALL_PERMISSION, can } from '../access';
import { count } from '../lib/format';
import { setMarketingOrg, useCompanies, useMarketingOrg } from '../org';
import { Field, Input, Loaded, Mono, Notice, PageBody, PageHeader, Panel, Planned, Status, Table, TD, TextArea, TH, useAction } from '../parts';

/**
 * DK13 / W13 · Settings (MKT-SET-01/02, MKT-CON-03; constraint C2). The standard WorkSuite module settings — General
 * and Advanced from the server's own field list, User access, Permissions, Organization, Notifications — with
 * Marketing's own Sending, Calls and Consent, which belong to the company the rail shows (`/marketing/settings/<tab>`).
 *
 * Bulk mail never takes the transactional route (C2), and its relay priority stays below transactional mail's 1–5.
 * Sending, Calls, Consent and the policies are one form: Save sends only what changed, and stays off while a number
 * is out of range. Anything the server did not keep is named after saving — double opt-in (MKT-CON-09) is planned,
 * and a server that has not built it answers without it.
 */
type Tab = 'general' | 'user-access' | 'permissions' | 'organization' | 'sending' | 'calls' | 'consent' | 'notifications' | 'advanced';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'user-access', label: 'User access' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'organization', label: 'Organization' },
  { id: 'sending', label: 'Sending' },
  { id: 'calls', label: 'Calls' },
  { id: 'consent', label: 'Consent' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'advanced', label: 'Advanced' },
];

const READ_ONLY = 'You can read these settings; changing them needs the settings permission.';

export default function Settings({ tab }: { tab: string | null }) {
  const org = useMarketingOrg();
  const current = TABS.find((t) => t.id === tab)?.id ?? 'sending';
  // A draft belongs to one company's settings: another company starts clean.
  return <SettingsView key={org} org={org} tab={current} />;
}

/* ------------------------------------------------------------------------ *
 * The form, and its pure helpers
 * ------------------------------------------------------------------------ */

/** Sending, Calls, Consent and the policies as they are edited: numbers as typed. */
export interface SettingsForm {
  route: string;
  hourly_pace: string;
  relay_priority: string;
  bounce_guard_percent: string;
  max_test_recipients: string;
  default_time_zone: string;
  postal_address: string;
  hours_from: string;
  hours_to: string;
  contact_local: boolean;
  max_attempts: string;
  retry_delay_hours: string;
  claim_release_minutes: string;
  require_phone_consent: boolean;
  double_opt_in: boolean;
  detect_machine_opens: boolean;
  one_click_unsubscribe: boolean;
  notify_owner: boolean;
}

export type SettingsPatch = Parameters<typeof saveSettings>[1];

/** The Sending values a check needs; `postal_address` undefined means the server does not report it, so it is not asked for. */
export interface SendingValues {
  route?: string;
  hourly_pace: number | string;
  relay_priority: number | string;
  bounce_guard_percent: number | string;
  max_test_recipients: number | string;
  postal_address?: string | null;
}

export type SendingErrors = Partial<Record<'route' | 'hourly_pace' | 'relay_priority' | 'bounce_guard_percent' | 'max_test_recipients' | 'postal_address', string>>;

export interface CallValues {
  hours_from: string;
  hours_to: string;
  max_attempts: number | string;
  retry_delay_hours: number | string;
  claim_release_minutes: number | string;
}

export type CallErrors = Partial<Record<keyof CallValues, string>>;

/** A whole number as typed, or null. */
function whole(v: number | string | null | undefined): number | null {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  return typeof v === 'string' && /^\s*-?\d+\s*$/.test(v) ? Number(v) : null;
}

/** A number as typed (a decimal point allowed), or null. */
function decimal(v: number | string | null | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : null;
}

/**
 * What is wrong with Sending, field by field (MKT-SET-02): a pace of at least 1 an hour; a relay priority of 6–9, below
 * transactional mail's 1–5 (MKT-SND-03); a bounce guard of 1–20%; 1–5 test recipients (MKT-CHK-03); never the
 * transactional route (C2); and the postal address every footer carries (MKT-CHK-02).
 */
export function validateSending(s: SendingValues, routes: MarketingSettings['sending']['routes'] = []): SendingErrors {
  const e: SendingErrors = {};
  const pace = whole(s.hourly_pace);
  if (pace === null || pace < 1) e.hourly_pace = 'At least 1 email an hour.';
  const priority = whole(s.relay_priority);
  if (priority === null || priority < 6 || priority > 9) e.relay_priority = 'From 6 to 9: 1–5 is kept for transactional mail.';
  const guard = decimal(s.bounce_guard_percent);
  if (guard === null || guard < 1 || guard > 20) e.bounce_guard_percent = 'From 1% to 20%.';
  const tests = whole(s.max_test_recipients);
  if (tests === null || tests < 1 || tests > 5) e.max_test_recipients = 'From 1 to 5.';
  if (s.route !== undefined && routes.some((r) => r.id === s.route && r.transactional)) e.route = 'Bulk mail never uses the transactional route.';
  if (s.postal_address !== undefined && !(s.postal_address ?? '').trim()) e.postal_address = 'Required: every campaign footer carries it.';
  return e;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** What is wrong with the calling defaults: real times, the end after the start, and counts of at least 1. */
export function validateCalls(c: CallValues): CallErrors {
  const e: CallErrors = {};
  if (!TIME.test(c.hours_from)) e.hours_from = 'A time, like 09:00.';
  if (!TIME.test(c.hours_to)) e.hours_to = 'A time, like 18:00.';
  else if (TIME.test(c.hours_from) && c.hours_to <= c.hours_from) e.hours_to = 'After the start of calling hours.';
  const attempts = whole(c.max_attempts);
  if (attempts === null || attempts < 1) e.max_attempts = 'At least 1 attempt.';
  const delay = whole(c.retry_delay_hours);
  if (delay === null || delay < 1) e.retry_delay_hours = 'At least 1 hour.';
  const release = whole(c.claim_release_minutes);
  if (release === null || release < 1) e.claim_release_minutes = 'At least 1 minute.';
  return e;
}

const hhmm = (t: string | null | undefined) => (t ?? '').slice(0, 5);

export function formOf(s: MarketingSettings): SettingsForm {
  return {
    route: s.sending.route,
    hourly_pace: String(s.sending.hourly_pace),
    relay_priority: String(s.sending.relay_priority),
    bounce_guard_percent: String(s.sending.bounce_guard_percent),
    max_test_recipients: String(s.sending.max_test_recipients),
    default_time_zone: s.sending.default_time_zone,
    postal_address: s.sending.postal_address ?? '',
    hours_from: hhmm(s.calls.hours_from),
    hours_to: hhmm(s.calls.hours_to),
    contact_local: s.calls.contact_local,
    max_attempts: String(s.calls.max_attempts),
    retry_delay_hours: String(s.calls.retry_delay_hours),
    claim_release_minutes: String(s.calls.claim_release_minutes),
    require_phone_consent: s.consent.require_phone_consent,
    double_opt_in: s.consent.double_opt_in,
    detect_machine_opens: s.policies.detect_machine_opens,
    one_click_unsubscribe: s.policies.one_click_unsubscribe,
    notify_owner: s.policies.notify_owner,
  };
}

/** Only what changed, by section, numbers as numbers. */
export function settingsPatch(s: MarketingSettings, f: SettingsForm): SettingsPatch {
  const sending: Partial<MarketingSettings['sending']> = {};
  if (f.route !== s.sending.route) sending.route = f.route;
  if (Number(f.hourly_pace) !== s.sending.hourly_pace) sending.hourly_pace = Number(f.hourly_pace);
  if (Number(f.relay_priority) !== s.sending.relay_priority) sending.relay_priority = Number(f.relay_priority);
  if (Number(f.bounce_guard_percent) !== s.sending.bounce_guard_percent) sending.bounce_guard_percent = Number(f.bounce_guard_percent);
  if (Number(f.max_test_recipients) !== s.sending.max_test_recipients) sending.max_test_recipients = Number(f.max_test_recipients);
  if (f.default_time_zone !== s.sending.default_time_zone) sending.default_time_zone = f.default_time_zone;
  if (f.postal_address.trim() !== (s.sending.postal_address ?? '').trim()) sending.postal_address = f.postal_address.trim() || null;

  const calls: Partial<MarketingSettings['calls']> = {};
  if (f.hours_from !== hhmm(s.calls.hours_from)) calls.hours_from = f.hours_from;
  if (f.hours_to !== hhmm(s.calls.hours_to)) calls.hours_to = f.hours_to;
  if (f.contact_local !== s.calls.contact_local) calls.contact_local = f.contact_local;
  if (Number(f.max_attempts) !== s.calls.max_attempts) calls.max_attempts = Number(f.max_attempts);
  if (Number(f.retry_delay_hours) !== s.calls.retry_delay_hours) calls.retry_delay_hours = Number(f.retry_delay_hours);
  if (Number(f.claim_release_minutes) !== s.calls.claim_release_minutes) calls.claim_release_minutes = Number(f.claim_release_minutes);

  const consent: Partial<MarketingSettings['consent']> = {};
  if (f.require_phone_consent !== s.consent.require_phone_consent) consent.require_phone_consent = f.require_phone_consent;
  if (f.double_opt_in !== s.consent.double_opt_in) consent.double_opt_in = f.double_opt_in;

  const policies: Partial<MarketingSettings['policies']> = {};
  if (f.detect_machine_opens !== s.policies.detect_machine_opens) policies.detect_machine_opens = f.detect_machine_opens;
  if (f.one_click_unsubscribe !== s.policies.one_click_unsubscribe) policies.one_click_unsubscribe = f.one_click_unsubscribe;
  if (f.notify_owner !== s.policies.notify_owner) policies.notify_owner = f.notify_owner;

  const patch: SettingsPatch = {};
  if (Object.keys(sending).length) patch.sending = sending;
  if (Object.keys(calls).length) patch.calls = calls;
  if (Object.keys(consent).length) patch.consent = consent;
  if (Object.keys(policies).length) patch.policies = policies;
  return patch;
}

const NAMES: Record<string, string> = {
  route: 'mail route',
  hourly_pace: 'hourly pace',
  relay_priority: 'relay priority',
  bounce_guard_percent: 'bounce guard',
  max_test_recipients: 'max test recipients',
  default_time_zone: 'default time zone',
  postal_address: 'postal address',
  hours_from: 'calling hours',
  hours_to: 'calling hours',
  contact_local: 'contact’s local time',
  max_attempts: 'max attempts',
  retry_delay_hours: 'retry delay',
  claim_release_minutes: 'claim release',
  require_phone_consent: 'phone consent before calling',
  double_opt_in: 'double opt-in',
  detect_machine_opens: 'machine-open detection',
  one_click_unsubscribe: 'one-click unsubscribe header',
  notify_owner: 'owner notices',
};

/** The settings sent that the server's answer does not carry back: it does not keep them (yet). */
export function notKept(sent: SettingsPatch, answer: unknown): string[] {
  if (!answer || typeof answer !== 'object') return [];
  const out = new Set<string>();
  for (const [section, fields] of Object.entries(sent)) {
    const back = (answer as Record<string, unknown>)[section];
    if (!fields || !back || typeof back !== 'object') continue;
    for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
      const got = (back as Record<string, unknown>)[k];
      const same =
        k === 'hours_from' || k === 'hours_to'
          ? typeof got === 'string' && hhmm(got) === v
          : typeof v === 'number'
            ? Number(got) === v
            : typeof v === 'boolean'
              ? got === v
              : String(got ?? '').trim() === String(v ?? '').trim();
      if (!same) out.add(NAMES[k] ?? k.replace(/_/g, ' '));
    }
  }
  return [...out];
}

/** Whether an answer is the whole settings object (a save may answer with it, or with only a message). */
function isSettings(x: unknown): x is MarketingSettings {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  const sending = o.sending as Record<string, unknown> | undefined;
  return !!sending && typeof sending === 'object' && Array.isArray(sending.routes) && ['calls', 'consent', 'policies'].every((k) => !!o[k] && typeof o[k] === 'object');
}

let zones: string[] | null = null;

/** The IANA time zones this computer knows (Intl), read once. */
function timeZones(): string[] {
  if (!zones) {
    try {
      zones = Intl.supportedValuesOf('timeZone');
    } catch {
      zones = [];
    }
  }
  return zones;
}

/* ------------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------------ */

function SettingsView({ org, tab }: { org: string; tab: Tab }) {
  const qc = useQueryClient();
  const { go } = useTab();
  const companies = useCompanies();
  const q = useSettings();
  const [draft, setDraft] = useState<Partial<SettingsForm>>({});
  const [busy, run] = useAction();
  const data = q.data;
  const form: SettingsForm | null = data ? { ...formOf(data), ...draft } : null;
  const patch: SettingsPatch = data && form ? settingsPatch(data, form) : {};
  const dirty = Object.keys(patch).length > 0;
  const errors: SendingErrors & CallErrors =
    data && form
      ? {
          ...validateSending({ ...form, postal_address: data.sending.postal_address === undefined && !form.postal_address ? undefined : form.postal_address }, data.sending.routes),
          ...validateCalls(form),
        }
      : {};
  const valid = Object.keys(errors).length === 0;
  const editable = data?.can_edit !== false;
  const company = companies.find((c) => c.id === org)?.name ?? companies[0]?.name ?? 'this company';
  const set = <K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = () =>
    void run('save', async () => {
      const sent = patch;
      const answer = await saveSettings(org, sent);
      // The saved settings at once, when the server answers with them, so the form never shows the old values.
      if (isSettings(answer)) qc.setQueryData(MK.settings(org), answer);
      setDraft({});
      void qc.invalidateQueries({ queryKey: MK.settings(org) });
      void qc.invalidateQueries({ queryKey: MK.dashboard(org) });
      const missed = notKept(sent, answer);
      if (missed.length) toast('info', `Saved, except the ${missed.join(', ')}: this server does not keep ${missed.length === 1 ? 'it' : 'them'} yet.`);
      else toast('success', 'Marketing settings saved.');
    });

  const ownForm = tab === 'sending' || tab === 'calls' || tab === 'consent' || tab === 'notifications';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing"
        title="Settings"
        sub={`Standard WorkSuite module settings · applies to ${company}`}
        actions={
          editable ? (
            <>
              <Button variant="ghost" disabled={!dirty || busy !== null} onClick={() => setDraft({})}>
                Discard
              </Button>
              <Button variant="primary" icon="check" loading={busy === 'save'} disabled={!dirty || !valid} onClick={save}>
                Save changes
              </Button>
            </>
          ) : undefined
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
          <nav aria-label="Settings sections" className="flex flex-row flex-wrap gap-1 md:sticky md:top-0 md:flex-col">
            {TABS.map((t) => {
              const on = t.id === tab;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-current={on ? 'page' : undefined}
                  onClick={() => go(`/marketing/settings/${t.id}`)}
                  className={cx('flex h-8 items-center rounded-[8px] px-3 text-left text-[13px] font-semibold whitespace-nowrap', on ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle hover:text-ink')}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>
          <div className="flex min-w-0 max-w-[880px] flex-col gap-4">
            {dirty && !ownForm ? (
              <Notice tone="warning" action={<Button size="sm" onClick={() => go('/marketing/settings/sending')}>Review</Button>}>
                Sending, Calls or Consent has unsaved changes.
              </Notice>
            ) : null}
            {tab === 'general' || tab === 'advanced' ? (
              <ModuleSettingsForm slug="marketing" section={tab} queryKey={[...MK.moduleSettings, tab]} note="Changes apply to every company." readOnly={READ_ONLY} />
            ) : tab === 'user-access' ? (
              <UserAccess />
            ) : tab === 'permissions' ? (
              <Permissions />
            ) : tab === 'organization' ? (
              <Organization org={org} locked={dirty} />
            ) : (
              <Loaded q={q} what="Marketing settings">
                {(s) =>
                  form ? (
                    <>
                      {!editable ? <Notice tone="primary">{READ_ONLY}</Notice> : null}
                      {tab === 'sending' ? (
                        <Sending s={s} f={form} errors={errors} set={set} disabled={!editable} />
                      ) : tab === 'calls' ? (
                        <Calls f={form} errors={errors} set={set} disabled={!editable} />
                      ) : tab === 'consent' ? (
                        <Consent s={s} f={form} set={set} disabled={!editable} />
                      ) : (
                        <Notifications f={form} set={set} disabled={!editable} />
                      )}
                    </>
                  ) : null
                }
              </Loaded>
            )}
          </div>
        </div>
      </PageBody>
    </div>
  );
}

type SetField = <K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => void;

/* ------------------------------------------------------------------------ *
 * Sending and policies (MKT-SET-02)
 * ------------------------------------------------------------------------ */

function Sending({ s, f, errors, set, disabled }: { s: MarketingSettings; f: SettingsForm; errors: SendingErrors; set: SetField; disabled: boolean }) {
  const routes = useMemo(() => {
    const list = s.sending.routes.map((r) => ({ value: r.id, label: r.label, disabled: !!r.transactional, hint: r.transactional ? 'Bulk mail never uses the transactional route' : undefined }));
    return list.some((r) => r.value === f.route) ? list : [{ value: f.route, label: f.route }, ...list];
  }, [s.sending.routes, f.route]);
  const zoneOptions = useMemo(() => {
    const list = timeZones();
    const all = !f.default_time_zone || list.includes(f.default_time_zone) ? list : [f.default_time_zone, ...list];
    return all.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }));
  }, [f.default_time_zone]);
  const heldBack = s.consent.held_back ?? 0;

  return (
    <>
      <Panel title="Sending" bodyClassName="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
        <Field label="Mail route" hint="Bulk mail never uses the transactional route" error={errors.route}>
          <Select<string> aria-label="Mail route" value={f.route} onValueChange={(v) => set('route', v)} options={routes} disabled={disabled} />
        </Field>
        <Field label="Hourly pace" hint="Per company; the relay may lower it when busy" error={errors.hourly_pace}>
          <NumInput value={f.hourly_pace} onChange={(v) => set('hourly_pace', v)} unit="/ hour" invalid={!!errors.hourly_pace} disabled={disabled} />
        </Field>
        <Field label="Relay priority" hint="Lower than transactional mail (1–5)" error={errors.relay_priority}>
          <NumInput value={f.relay_priority} onChange={(v) => set('relay_priority', v)} invalid={!!errors.relay_priority} disabled={disabled} />
        </Field>
        <Field label="Bounce guard" hint="Pauses a campaign once reached" error={errors.bounce_guard_percent}>
          <NumInput value={f.bounce_guard_percent} onChange={(v) => set('bounce_guard_percent', v)} unit="%" decimal invalid={!!errors.bounce_guard_percent} disabled={disabled} />
        </Field>
        <Field label="Max test recipients" hint="Test emails per send, with a chosen contact’s merge values" error={errors.max_test_recipients}>
          <NumInput value={f.max_test_recipients} onChange={(v) => set('max_test_recipients', v)} invalid={!!errors.max_test_recipients} disabled={disabled} />
        </Field>
        <Field label="Default time zone" hint="Local-time sending falls back to it when a contact has none">
          <Select<string> aria-label="Default time zone" value={f.default_time_zone} onValueChange={(v) => set('default_time_zone', v)} options={zoneOptions} disabled={disabled} searchable />
        </Field>
        <Field label="Company postal address" hint="Required in every campaign footer" error={errors.postal_address} className="sm:col-span-2">
          <TextArea value={f.postal_address} onChange={(e) => set('postal_address', e.target.value)} disabled={disabled} maxLength={500} className={cx('min-h-[64px]', errors.postal_address && '!border-danger')} aria-invalid={errors.postal_address ? true : undefined} />
        </Field>
      </Panel>
      <Panel title="Policies" bodyClassName="flex flex-col px-4 pb-2">
        <SwitchRow label="Detect machine opens" hint="Apple MPP, scanners and image caches are excluded from rates" checked={f.detect_machine_opens} onChange={(v) => set('detect_machine_opens', v)} disabled={disabled} />
        <SwitchRow label="One-click unsubscribe header (RFC 8058)" hint="List-Unsubscribe and List-Unsubscribe-Post on every marketing email" checked={f.one_click_unsubscribe} onChange={(v) => set('one_click_unsubscribe', v)} disabled={disabled} />
        <SwitchRow
          label="Require phone consent before calling"
          hint={s.consent.require_phone_consent && heldBack > 0 ? `${count(heldBack)} ${heldBack === 1 ? 'contact' : 'contacts'} without phone consent held back` : 'Contacts without phone consent never enter a call queue'}
          checked={f.require_phone_consent}
          onChange={(v) => set('require_phone_consent', v)}
          disabled={disabled}
        />
        <SwitchRow label="Notify owner when a campaign finishes or pauses" checked={f.notify_owner} onChange={(v) => set('notify_owner', v)} disabled={disabled} />
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------------------ *
 * Calls (MKT-CAL-03/05/13)
 * ------------------------------------------------------------------------ */

function Calls({ f, errors, set, disabled }: { f: SettingsForm; errors: CallErrors; set: SetField; disabled: boolean }) {
  return (
    <Panel title="Calls" sub="Defaults for new call campaigns; each campaign keeps its own." bodyClassName="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
      <Field label="Calling hours from" error={errors.hours_from}>
        <Input type="time" value={f.hours_from} onChange={(e) => set('hours_from', e.target.value)} disabled={disabled} aria-invalid={errors.hours_from ? true : undefined} className={cx(errors.hours_from && '!border-danger')} />
      </Field>
      <Field label="Calling hours to" error={errors.hours_to}>
        <Input type="time" value={f.hours_to} onChange={(e) => set('hours_to', e.target.value)} disabled={disabled} aria-invalid={errors.hours_to ? true : undefined} className={cx(errors.hours_to && '!border-danger')} />
      </Field>
      <div className="sm:col-span-2">
        <SwitchRow label="Use the contact’s local time" hint="Calling hours follow the contact’s time zone when it is known" checked={f.contact_local} onChange={(v) => set('contact_local', v)} disabled={disabled} />
      </div>
      <Field label="Max attempts" hint="No answer and busy are tried again up to this many times" error={errors.max_attempts}>
        <NumInput value={f.max_attempts} onChange={(v) => set('max_attempts', v)} invalid={!!errors.max_attempts} disabled={disabled} />
      </Field>
      <Field label="Retry delay" hint="Before a retried contact comes back to the queue" error={errors.retry_delay_hours}>
        <NumInput value={f.retry_delay_hours} onChange={(v) => set('retry_delay_hours', v)} unit="hours" invalid={!!errors.retry_delay_hours} disabled={disabled} />
      </Field>
      <Field label="Claim release" hint="An idle claim goes back to the queue after this long" error={errors.claim_release_minutes}>
        <NumInput value={f.claim_release_minutes} onChange={(v) => set('claim_release_minutes', v)} unit="min" invalid={!!errors.claim_release_minutes} disabled={disabled} />
      </Field>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ *
 * Consent (MKT-CON-03, MKT-CON-09)
 * ------------------------------------------------------------------------ */

function Consent({ s, f, set, disabled }: { s: MarketingSettings; f: SettingsForm; set: SetField; disabled: boolean }) {
  const { go } = useTab();
  const heldBack = s.consent.held_back ?? 0;
  // Planned until the server reports double opt-in on; saving it on tells whether this server keeps it.
  const planned = !s.consent.double_opt_in;
  return (
    <>
      <Panel title="Consent" bodyClassName="flex flex-col px-4 pb-2">
        <SwitchRow
          label="Require phone consent before calling"
          hint={
            s.consent.require_phone_consent && heldBack > 0
              ? `${count(heldBack)} ${heldBack === 1 ? 'contact' : 'contacts'} without phone consent held back from call queues`
              : 'Contacts without recorded phone consent never enter a call queue'
          }
          checked={f.require_phone_consent}
          onChange={(v) => set('require_phone_consent', v)}
          disabled={disabled}
        />
        <SwitchRow
          label="Double opt-in for web sign-ups"
          extra={planned ? <Planned /> : null}
          hint={planned ? 'Planned. Today, form sign-ups are recorded as granted · web form.' : 'Web sign-ups stay pending until the confirmation link is used.'}
          checked={f.double_opt_in}
          onChange={(v) => set('double_opt_in', v)}
          disabled={disabled}
        />
      </Panel>
      <Panel title="Ledger and suppression" bodyClassName="flex flex-wrap items-center justify-between gap-3 px-4 pb-4">
        <p className="m-0 min-w-0 flex-1 text-[12.5px] text-ink-2">Every consent change is a new ledger entry; suppression and do-not-call hold for the whole company.</p>
        <Button size="sm" icon="shield-check" onClick={() => go('/marketing/consent')}>
          Consent & suppression
        </Button>
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------------------ *
 * Notifications (MKT-SND-08, MKT-CAL-12, MKT-DSK-01)
 * ------------------------------------------------------------------------ */

function Notifications({ f, set, disabled }: { f: SettingsForm; set: SetField; disabled: boolean }) {
  const { navigate } = useTab();
  return (
    <>
      <Panel title="Campaign notices" bodyClassName="flex flex-col gap-1 px-4 pb-2">
        <p className="m-0 text-[12.5px] text-ink-2">When a campaign finishes, pauses — by hand or by the bounce guard — or fails, its owner hears through WorkSuite notifications.</p>
        <SwitchRow label="Notify owner when a campaign finishes or pauses" checked={f.notify_owner} onChange={(v) => set('notify_owner', v)} disabled={disabled} />
      </Panel>
      <Panel title="On this computer" bodyClassName="flex flex-col items-start gap-3 px-4 pb-4">
        <p className="m-0 text-[12.5px] leading-relaxed text-ink-2">
          Callback reminders and the next-contact shortcut <Kbd tone="key">{prettyAccelerator(NEXT_CONTACT_KEYS)}</Kbd> follow Settings › Notifications & calls on this computer.
        </p>
        <Button icon="bell" onClick={() => navigate('/settings/notifications')}>
          Open Notifications & calls
        </Button>
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------------------ *
 * User access and Permissions (§2.3)
 * ------------------------------------------------------------------------ */

interface ModuleAccess {
  permissions: Array<{ slug: string; name: string; held: boolean }>;
  why: string | null;
}

const fetchAccess = (signal?: AbortSignal) => apiGet<ModuleAccess>('/api/access/module/Marketing', undefined, signal);

// WS-MKT-SRS-001 §2.3: the baseline role model, by capability.
const ROLES = ['Manager', 'Author', 'Agent', 'Supervisor', 'Admin'] as const;
const MATRIX: Array<{ what: ReactNode; can: [string, string, string, string, string]; call?: boolean }> = [
  { what: 'View dashboard, contacts, lists, segments', can: ['Yes', 'Yes', 'Own queue', 'Yes', 'Yes'] },
  { what: 'Create / edit / import / export contacts', can: ['Yes', 'Yes', '—', '—', 'Yes'] },
  { what: 'Manage consent and suppression', can: ['Yes', 'Record only', 'Do-not-call only', 'Do-not-call only', 'Yes'] },
  { what: 'Create and edit email campaigns, templates', can: ['Yes', 'Yes', '—', '—', '—'] },
  { what: 'Schedule, send, pause, cancel campaigns', can: ['Yes', 'With approval (planned)', '—', '—', '—'] },
  { what: 'Create call campaigns, assign agents, scripts', can: ['Yes', '—', '—', 'Yes', '—'] },
  {
    what: (
      <>
        Make calls (<Mono className="text-[11.5px]">{CALL_PERMISSION}</Mono>)
      </>
    ),
    can: ['Optional', '—', 'Yes', 'Optional', '—'],
    call: true,
  },
  { what: 'Settings (sending, calls, consent)', can: ['Yes', '—', '—', '—', 'Yes'] },
];

function AdminCenter() {
  const { openLink } = useTab();
  return (
    <Button size="sm" icon="external" onClick={() => openLink('/admin/roles')}>
      Roles in Admin Center
    </Button>
  );
}

/** Your own access: every Marketing permission, held or not (the server's list, as Tenders' My access reads it). */
function UserAccess() {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const q = useQuery({ queryKey: MK.access, queryFn: ({ signal }) => fetchAccess(signal), staleTime: 60_000 });
  return (
    <Panel title="Your access in Marketing" sub="Read-only. Roles grant permissions in Admin Center." action={<AdminCenter />} bodyClassName="flex flex-col gap-3">
      <Loaded q={q} what="Your Marketing access">
        {(a) => {
          const held = a.permissions.filter((p) => p.held || can(perms, p.slug)).length;
          const listed = a.permissions.some((p) => p.slug === CALL_PERMISSION);
          return (
            <>
              <p className="m-0 text-[12.5px] text-ink-2">
                You hold <b className="text-ink">{held}</b> of {a.permissions.length} Marketing permissions.{a.why ? ` ${a.why}` : ''}
              </p>
              {a.permissions.length === 0 ? (
                <Empty icon="lock" title="This server lists no Marketing permissions" />
              ) : (
                <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[12px] border border-line p-0">
                  {a.permissions.map((p) => {
                    const yes = p.held || can(perms, p.slug);
                    const call = p.slug === CALL_PERMISSION;
                    return (
                      <li key={p.slug} data-permission={p.slug} className={cx('flex flex-wrap items-center gap-3 border-b border-line px-3.5 py-2.5 text-[12.5px] last:border-b-0', call && 'bg-warning-bg/60')}>
                        <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', yes ? 'bg-success-bg text-success' : 'bg-subtle text-ink-3')}>
                          <Icon name={yes ? 'check' : 'minus'} size={13} />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <b className="text-[13px] text-ink">{p.name}</b>
                          <Mono className="text-[11.5px] text-ink-3">{p.slug}</Mono>
                          {call ? <CallNote held={yes} /> : null}
                        </span>
                        <span className="text-[12px] text-ink-3">{yes ? 'Granted' : 'Not granted'}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {!listed ? (
                <Notice tone="warning">
                  <Mono>{CALL_PERMISSION}</Mono> · <CallNote held={can(perms, CALL_PERMISSION)} />
                </Notice>
              ) : null}
            </>
          );
        }}
      </Loaded>
    </Panel>
  );
}

/** The baseline role model (§2.3): which capability each kind of user gets. */
function Permissions() {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  return (
    <Panel title="Who can do what" sub="The baseline roles. Roles are granted in Admin Center, where the app is also turned on per company." action={<AdminCenter />} bodyClassName="flex flex-col gap-3">
      <Table
        label="Who can do what"
        head={
          <tr>
            <th className={TH}>Capability</th>
            {ROLES.map((r) => (
              <th key={r} className={TH}>
                {r}
              </th>
            ))}
          </tr>
        }
      >
        {MATRIX.map((m, i) => (
          <tr key={i} className={cx(m.call && 'bg-warning-bg/60')}>
            <td className={cx(TD, 'min-w-[220px] font-medium')}>
              {m.what}
              {m.call ? (
                <span className="block">
                  <CallNote held={can(perms, CALL_PERMISSION)} />
                </span>
              ) : null}
            </td>
            {m.can.map((c, j) => (
              <td key={ROLES[j]} className={cx(TD, c === '—' ? 'text-ink-3' : c === 'Yes' ? 'font-semibold text-ink' : 'text-ink-2')}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </Table>
      <p className="m-0 text-[12px] text-ink-3">The server checks each of the Marketing permissions on every request; a refusal is shown in its own words.</p>
    </Panel>
  );
}

/** B-5: until a role grants marketing.call.make, nobody can work a call queue. */
function CallNote({ held }: { held: boolean }) {
  return (
    <span className="mt-0.5 text-[11.5px] text-warning-ink dark:text-warning">
      <Status tone="warning" className="mr-1.5 align-middle">
        Go-live blocker
      </Status>
      {held ? 'You hold it: you may claim contacts from call queues.' : 'Without it no one can work a call queue: grant it to call agents’ roles in Admin Center.'}
    </span>
  );
}

/* ------------------------------------------------------------------------ *
 * Organization (constraint C5)
 * ------------------------------------------------------------------------ */

function Organization({ org, locked }: { org: string; locked: boolean }) {
  const companies = useCompanies();
  return (
    <Panel title="Organization" sub="Sending, Calls and Consent belong to one company; General and Advanced apply to every company." bodyClassName="flex flex-col gap-3">
      {companies.length === 0 ? (
        <Empty icon="building" title="No company to show" hint="Your sign-in lists no company. Ask an administrator to add you to one." />
      ) : (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[12px] border border-line p-0">
          {companies.map((c) => {
            const on = c.id === org;
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-3 border-b border-line px-3.5 py-2.5 text-[13px] last:border-b-0">
                <Icon name="building" size={16} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate font-semibold text-ink">{c.name}</span>
                {on ? (
                  <Status tone="indigo">These settings</Status>
                ) : (
                  <Button size="sm" disabled={locked} title={locked ? 'Save or discard your changes first' : undefined} onClick={() => setMarketingOrg(c.id)}>
                    Show its settings
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="m-0 text-[12px] text-ink-3">Contacts, suppression, campaigns and call queues never mix between companies.</p>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------------ */

function NumInput({ value, onChange, unit, invalid, disabled, decimal: dec }: { value: string; onChange: (v: string) => void; unit?: string; invalid?: boolean; disabled?: boolean; decimal?: boolean }) {
  return (
    <span className="relative block">
      <Input
        inputMode={dec ? 'decimal' : 'numeric'}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={invalid ? true : undefined}
        className={cx('font-mono tabular-nums', unit && 'pr-16', invalid && '!border-danger')}
      />
      {unit ? (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[12px] text-ink-3">
          {unit}
        </span>
      ) : null}
    </span>
  );
}

function SwitchRow({ label, hint, extra, checked, onChange, disabled }: { label: string; hint?: string; extra?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0">
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <b className="text-[13px] text-ink">{label}</b>
          {extra}
        </span>
        {hint ? (
          <span id={id} className="block text-[11.5px] text-ink-3">
            {hint}
          </span>
        ) : null}
      </span>
      <Switch label={label} describedBy={hint ? id : undefined} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}
