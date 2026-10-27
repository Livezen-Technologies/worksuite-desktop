import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { ApiError, apiGet } from '../../core/api';
import { call, errorMessage } from '../../core/bridge';
import { useTab } from '../../core/tab-context';
import { queryClient } from '../../core/query';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import type { FieldDef, ModuleSettings } from '../../components/ModuleSettingsForm';
import { Select } from '../../components/Select';
import { cx, Spinner, Switch } from '../../components/ui';
import { refreshMarketing, send } from './api';
import { Refused } from './audience-parts';
import { btn, btnPrimary, btnSmall, Card, input, Line, PageHeader, Pill } from './parts';
import { companiesWhere, refusal, type Options } from './types';

type Section = 'general' | 'access' | 'permissions' | 'organization' | 'sending' | 'calls' | 'consent' | 'notifications' | 'advanced';

/** The standard sections in the standard order, with Marketing's own three among them (W13). Some live in the browser. */
const NAV: Array<{ id: Section; label: string; web?: string }> = [
  { id: 'general', label: 'General' },
  { id: 'access', label: 'User access', web: 'Who sees whose contacts and campaigns — their own, their team’s, the company’s or everything — is set per role.' },
  { id: 'permissions', label: 'Permissions', web: 'Which roles may view, edit, import, export, hand over, send and call is set in roles and permissions.' },
  { id: 'organization', label: 'Organization', web: 'Which companies use Marketing, and each one’s own values, are set in the organization settings.' },
  { id: 'sending', label: 'Sending' },
  { id: 'calls', label: 'Calls' },
  { id: 'consent', label: 'Consent' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'advanced', label: 'Advanced', web: 'Installation-wide values, for administrators of the whole installation.' },
];

/** Where a field belongs on a server that predates the Sending, Calls and Consent sections (it filed them under General). */
const KEY_SECTION: Record<string, Section> = {
  marketing_pace_per_hour: 'sending', marketing_bounce_pause_percent: 'sending', marketing_test_limit: 'sending',
  marketing_calling_from: 'calls', marketing_calling_until: 'calls', marketing_call_attempts: 'calls', marketing_call_retry_hours: 'calls',
  marketing_calls_need_consent: 'consent',
};

const OWN: Section[] = ['sending', 'calls', 'consent'];

/** A field's section: the one the server names when it is one of Marketing's own, else where the key is known to go, else General. */
function sectionOf(f: FieldDef): Section {
  const named = (f.section ?? '').toLowerCase() as Section;
  return OWN.includes(named) ? named : (KEY_SECTION[f.key] ?? 'general');
}

/** A stored value as the form holds it: booleans as '1'/'0', the rest as text. */
function asText(f: FieldDef, v: unknown): string {
  if (f.type === 'bool') return v === true || v === 1 || v === '1' || v === 'true' ? '1' : '0';
  return v == null ? '' : String(v);
}

const openWeb = (path: string) => void call('app:openInBrowser', { path }).catch((e) => toast('error', errorMessage(e)));

/**
 * Settings (DK13, the web's W13; MKT-SET-01, MKT-SET-02): the standard module
 * settings in the desktop — General, then Marketing's own Sending, Calls and
 * Consent — each company's own, read from the server's field list so a new
 * setting appears without a desktop release, and saved with only what changed.
 *
 * Where mail leaves (the relay route and its priority) is the Mail relay's,
 * not Marketing's: it is shown here as a fact, with the way to the place it is
 * changed. User access, permissions, the organization and the advanced values
 * are the installation's settings shell, which opens in the browser; the
 * notifications this computer shows are the desktop's own Settings.
 */
export default function Settings({ org, options, section, onSection }: { org: string; options: Options; section: string | null; onSection: (s: string) => void }) {
  const { navigate } = useTab();
  const current: Section = NAV.some((s) => s.id === section) ? (section as Section) : 'general';
  const settable = companiesWhere(options, 'settings');
  const readable = settable.length ? settable : options.companies;
  const scoped = org.split(',').filter(Boolean);
  const [picked, setPicked] = useState('');
  const orgId = picked || (scoped.length === 1 && readable.some((c) => String(c.id) === scoped[0]) ? scoped[0]! : String(readable[0]?.id ?? ''));
  const company = options.companies.find((c) => String(c.id) === orgId);
  const q = useQuery({
    queryKey: ['marketing', 'module-settings', orgId],
    queryFn: ({ signal }) => apiGet<ModuleSettings & { spec: { events?: string[] } }>('/api/module-settings/marketing', { org: orgId }, signal),
    enabled: orgId !== '',
    retry: false,
  });
  const [draft, setDraft] = useState<{ org: string; values: Record<string, string> }>({ org: '', values: {} });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fields = useMemo(() => q.data?.spec?.general ?? [], [q.data]);
  const initial = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, asText(f, q.data?.general?.[f.key]?.value)])), [fields, q.data]);
  // An edit belongs to the company it was typed for: switching company starts clean.
  const values = draft.org === orgId ? draft.values : {};
  const changed = fields.filter((f) => f.key in values && values[f.key] !== initial[f.key]);
  const editable = Boolean(q.data?.can_edit);
  const set = (k: string, v: string) => setDraft({ org: orgId, values: { ...values, [k]: v } });

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const r = await send('PUT', `/api/module-settings/marketing/general?org=${encodeURIComponent(orgId)}`, Object.fromEntries(changed.map((f) => [f.key, values[f.key]])));
      toast('success', r.message ?? (changed.length === 1 ? 'Setting saved.' : `${changed.length} settings saved.`));
      setDraft({ org: '', values: {} });
      // The pace and the bounce guard are also in the vocabulary the rail's "Sending via relay" line reads.
      await Promise.all([refreshMarketing(), queryClient.invalidateQueries({ queryKey: ['marketing', 'options'] })]);
    } catch (e) {
      const errs = e instanceof ApiError ? e.data : null;
      if (errs && typeof errs === 'object' && !Array.isArray(errs)) setErrors(errs as Record<string, string>);
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  const nav = NAV.find((s) => s.id === current)!;
  const mine = fields.filter((f) => sectionOf(f) === current);
  const form = (empty: string) => (
    <FieldList fields={mine} initial={initial} values={values} errors={errors} disabled={!editable || busy} onChange={set} empty={empty} />
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Settings"
        sub={`Standard WorkSuite module settings${company ? ` · applies to ${company.name}` : ''}`}
        actions={
          <>
            {readable.length > 1 ? (
              <Select<string> aria-label="Company" value={orgId} onValueChange={(v) => (setPicked(v), setErrors({}))} options={readable.map((c) => ({ value: String(c.id), label: c.name }))} className="w-[220px]" />
            ) : null}
            {editable ? (
              <>
                <button type="button" className={btn} disabled={!changed.length || busy} onClick={() => (setDraft({ org: '', values: {} }), setErrors({}))}>
                  Discard
                </button>
                <button type="button" className={btnPrimary} disabled={!changed.length || busy} onClick={() => void save()}>
                  <Icon name="check" size={15} /> {busy ? 'Saving…' : 'Save changes'}
                </button>
              </>
            ) : null}
          </>
        }
      />

      <div className="flex flex-col items-start gap-4 md:flex-row">
        <nav aria-label="Settings sections" className="flex w-full shrink-0 flex-row flex-wrap gap-0.5 md:w-[190px] md:flex-col">
          {NAV.map((s) => {
            const on = s.id === current;
            const dirty = changed.some((f) => sectionOf(f) === s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-current={on ? 'page' : undefined}
                onClick={() => onSection(s.id)}
                className={cx('flex h-8 items-center gap-2 rounded-[8px] px-2.5 text-left text-[13px]', on ? 'bg-info-bg font-bold text-info-ink dark:bg-selection dark:text-primary' : 'font-semibold text-ink hover:bg-subtle')}
              >
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                {dirty ? <span className="size-1.5 shrink-0 rounded-full bg-primary" title="Unsaved changes" /> : null}
                {s.web ? <Icon name="external" size={12} className="shrink-0 text-ink-3" /> : null}
              </button>
            );
          })}
        </nav>

        <div className="flex w-full min-w-0 flex-1 flex-col gap-4">
          {orgId === '' ? <p className="m-0 text-[13px] text-ink-2">There is no company whose Marketing settings you may read.</p> : null}
          {nav.web ? (
            <Card title={nav.label}>
              <div className="flex flex-wrap items-center gap-3">
                <p className="m-0 min-w-0 flex-1 text-[13px] text-ink-2">{nav.web} It opens in WorkSuite on the web.</p>
                <button type="button" className={btnSmall} onClick={() => openWeb('/marketing?view=settings')}>
                  <Icon name="external" size={13} />
                  <span className="ml-1">Open in browser</span>
                </button>
              </div>
            </Card>
          ) : null}

          {!nav.web && current !== 'notifications' && orgId !== '' ? (
            q.isLoading ? (
              <Spinner />
            ) : q.error ? (
              <Refused error={q.error} fallback="The settings could not be loaded." onRetry={() => void q.refetch()} />
            ) : (
              <>
                {current === 'general' ? <Card title="General">{form('Nothing else here to choose.')}</Card> : null}
                {current === 'sending' ? (
                  <>
                    <SendingFacts options={options} />
                    <Card title="Sending">{form('This server has no sending settings yet.')}</Card>
                    <Policies onConsent={() => onSection('consent')} onNotifications={() => onSection('notifications')} />
                  </>
                ) : null}
                {current === 'calls' ? (
                  <Card title="Calls">
                    <p className="m-0 mb-2 text-[12.5px] text-ink-3">The calling hours and retries a new call campaign starts with; each campaign can set its own.</p>
                    {form('This server has no call settings yet.')}
                  </Card>
                ) : null}
                {current === 'consent' ? <Card title="Consent">{form('This server has no consent settings yet.')}</Card> : null}
                {!editable ? <p className="m-0 text-[12px] text-ink-3">You can read these settings; changing them needs Marketing&apos;s settings permission.</p> : null}
              </>
            )
          ) : null}

          {current === 'notifications' ? (
            <Card title="Notifications">
              <p className="m-0 text-[13px] leading-[1.55] text-ink-2">
                Marketing tells a campaign&apos;s owner when it starts, when it has gone to everybody, when it pauses (by hand or because the bounce guard stopped it) and when an A/B test chooses its winner, and tells an agent when a callback is due. Whether this computer shows them — and how — is set in the desktop&apos;s Settings › Notifications; which ones the server sends you is set in your notification preferences.
              </p>
              {q.data?.spec?.events?.length ? (
                <ul className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0" aria-label="What Marketing notifies about">
                  {q.data.spec.events.map((e) => (
                    <li key={e}>
                      <Pill tone="blue" dot={false}>
                        {e.replace(/^marketing\./, '').replace(/[._]/g, ' ')}
                      </Pill>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={btn} onClick={() => navigate('/settings/notifications')}>
                  <Icon name="bell" size={15} /> Open Settings › Notifications
                </button>
                <button type="button" className={btn} onClick={() => openWeb('/account/settings')}>
                  <Icon name="external" size={14} /> Notification preferences on the web
                </button>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Where bulk mail leaves, as the server resolved it: the Mail relay's to change, so a fact here. */
function SendingFacts({ options }: { options: Options }) {
  const s = options.sending;
  return (
    <Card title="Mail route" action={<button type="button" className="text-[12.5px] font-bold text-primary hover:underline" onClick={() => openWeb('/admin/mail-relay')}>Change in Outgoing mail</button>}>
      {s ? (
        <>
          <Line label="Route">{s.route === 'none' ? <Pill tone="red">No mail route</Pill> : s.route_label}</Line>
          <Line label="Relay priority">{s.priority}</Line>
          <p className="m-0 mt-2 text-[12px] text-ink-3">Bulk mail never uses the transactional route; at priority {s.priority} it always gives way to transactional mail (1–5). The route is chosen in the Admin Centre&apos;s Outgoing mail, where every module&apos;s sending is configured.</p>
        </>
      ) : (
        <p className="m-0 text-[12.5px] text-ink-3">This server does not say which route Marketing&apos;s mail takes. It is set in the Admin Centre&apos;s Outgoing mail.</p>
      )}
    </Card>
  );
}

/** What every campaign does whatever is set — said so, not offered as a switch that changes nothing. */
function Policies({ onConsent, onNotifications }: { onConsent: () => void; onNotifications: () => void }) {
  const row = (title: string, sub: string, right: ReactNode) => (
    <div className="flex items-center gap-3 border-b border-line/70 py-2.5 last:border-b-0">
      <span className="min-w-0 flex-1">
        <b className="block text-[13px] text-ink">{title}</b>
        <span className="block text-[12px] text-ink-3">{sub}</span>
      </span>
      {right}
    </div>
  );
  const link = (label: string, onClick: () => void) => (
    <button type="button" className="shrink-0 text-[12.5px] font-bold text-primary hover:underline" onClick={onClick}>
      {label}
    </button>
  );
  return (
    <Card title="Policies">
      {row('Detect machine opens', 'Apple Mail privacy, scanners and image caches are excluded from rates and A/B decisions.', <Pill tone="green">Always on</Pill>)}
      {row('One-click unsubscribe header (RFC 8058)', 'Every campaign email carries List-Unsubscribe and List-Unsubscribe-Post.', <Pill tone="green">Always on</Pill>)}
      {row('Require phone consent before calling', 'Set in Consent.', link('Consent', onConsent))}
      {row('Notify owner when a campaign finishes or pauses', 'Set in Notifications.', link('Notifications', onNotifications))}
    </Card>
  );
}

/** The fields of one section, each with its help, its error and a dot when changed. */
function FieldList({ fields, initial, values, errors, disabled, onChange, empty }: {
  fields: FieldDef[];
  initial: Record<string, string>;
  values: Record<string, string>;
  errors: Record<string, string>;
  disabled: boolean;
  onChange: (k: string, v: string) => void;
  empty: string;
}) {
  if (fields.length === 0) return <p className="m-0 text-[12.5px] text-ink-3">{empty}</p>;
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-3.5 lg:grid-cols-2">
      {fields.map((f) => {
        const value = f.key in values ? values[f.key]! : (initial[f.key] ?? '');
        const changed = f.key in values && values[f.key] !== initial[f.key];
        const id = `mkt-setting-${f.key}`;
        const help = errors[f.key] ? <span className="text-danger">{errors[f.key]}</span> : f.help;
        const label = (
          <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
            {f.label}
            {changed ? <span className="size-1.5 rounded-full bg-primary" title="Changed" /> : null}
          </span>
        );
        if (f.type === 'bool') {
          return (
            <div key={f.key} className="flex items-start gap-3 lg:col-span-2">
              <span className="min-w-0 flex-1">
                {label}
                {help ? (
                  <span id={`${id}-help`} className="mt-0.5 block text-[12px] text-ink-3">
                    {help}
                  </span>
                ) : null}
              </span>
              <Switch checked={value === '1'} disabled={disabled} label={f.label} describedBy={help ? `${id}-help` : undefined} onChange={(v) => onChange(f.key, v ? '1' : '0')} />
            </div>
          );
        }
        return (
          <label key={f.key} htmlFor={id} className={cx('flex flex-col gap-1', f.type === 'text' && 'lg:col-span-2')}>
            {label}
            {f.type === 'select' ? (
              <Select<string> id={id} aria-label={f.label} value={value} disabled={disabled} onValueChange={(v) => onChange(f.key, v)} options={f.options ?? []} className={input} />
            ) : f.type === 'text' ? (
              <textarea id={id} rows={3} value={value} disabled={disabled} placeholder={f.placeholder ?? undefined} onChange={(e) => onChange(f.key, e.target.value)} className={cx(input, '!h-auto resize-none py-2')} />
            ) : (
              <input
                id={id}
                type={f.type === 'int' ? 'number' : f.type === 'time' ? 'time' : 'text'}
                min={f.min ?? undefined}
                max={f.max ?? undefined}
                value={value}
                disabled={disabled}
                placeholder={f.placeholder ?? f.default ?? undefined}
                onChange={(e) => onChange(f.key, e.target.value)}
                className={input}
              />
            )}
            {help ? <span className="text-[12px] text-ink-3">{help}</span> : null}
          </label>
        );
      })}
    </div>
  );
}
