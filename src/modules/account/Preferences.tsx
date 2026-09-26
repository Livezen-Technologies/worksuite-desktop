import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut } from '../../core/api';
import { app, updatePrefs } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, Switch } from '../../components/ui';
import { K, useHasApp } from './api';
import { Card, Head, Note, SettingRow } from './parts';
import { computerZone, FROM, useRegional, useSaveRegional, useZones } from './regional';

/**
 * Preferences: how WorkSuite looks on this computer, how it writes dates and
 * times for me everywhere, and my chat privacy. Appearance is this
 * computer's (Settings keeps the rest of this computer's settings); regional
 * settings are my account's and follow me to the web and other devices.
 */
export default function Preferences() {
  const prefs = useStore(app, (s) => s.prefs);
  const hasChat = useHasApp('chat');
  return (
    <div className="flex max-w-[1080px] flex-col gap-4">
      <Head title="Preferences" sub="How WorkSuite looks, and how it writes dates and times for you." />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Regional />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {prefs ? (
            <Card title="Appearance" action={<span className="text-[12px] text-ink-3">On this computer</span>}>
              <SettingRow label="Theme">
                <Select label="Theme" value={prefs.theme} options={[{ value: 'system', label: 'Match the system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} onValueChange={(v) => void updatePrefs({ theme: v })} />
              </SettingRow>
              <SettingRow label="Density" hint="Compact fits more rows in lists.">
                <Select label="Density" value={prefs.density} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} onValueChange={(v) => void updatePrefs({ density: v })} />
              </SettingRow>
              <button type="button" onClick={() => navigate('/settings/preferences')} className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-primary hover:underline">
                More settings for this computer <Icon name="chevron-right" size={13} />
              </button>
            </Card>
          ) : null}
          {hasChat ? <ChatPrivacy /> : null}
        </div>
      </div>
    </div>
  );
}

function Regional() {
  const q = useRegional();
  const zones = useZones();
  const { save, busy } = useSaveRegional();
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  const { effective: e, mine, organization: org, system, options } = q.data!;
  const locked = !e.may_override;
  const off = busy || locked;
  const company = (v: string | null | undefined) => `Use my company's${v ? ` (${v})` : ''}`;
  const here = computerZone();
  const inherited = org?.timezone ?? system.timezone;
  const label = (list: Array<{ value: string; label: string }>, v: string | null | undefined) => list.find((l) => l.value === v)?.label ?? v ?? null;
  const example = (list: Array<{ value: string; example: string }>, v: string | null | undefined) => list.find((l) => l.value === v)?.example ?? v ?? null;

  return (
    <Card title="Date and time" action={<span className="text-[12px] text-ink-3">Everywhere you sign in</span>}>
      <Note className="mb-2">
        Times are shown in <b>{e.label}</b> — {FROM[e.timezone_source]}.
      </Note>
      {locked ? <Note tone="amber" className="mb-2">{org?.name ?? 'Your company'} sets these for everyone, so they are shown here and cannot be changed.</Note> : null}
      <SettingRow
        label="Detect my time zone"
        hint={mine.timezone_auto ? `This computer is in ${here ?? 'an unknown zone'}. Your company's zone (${inherited}) is used while this is on, and this computer's only when your company has none.` : 'Off: the zone below is used wherever you sign in.'}
      >
        <Switch label="Detect my time zone" checked={mine.timezone_auto} disabled={off} onChange={(on) => void save(on ? { timezone_auto: true, detected: here } : { timezone_auto: false, timezone: e.timezone })} />
      </SettingRow>
      {!mine.timezone_auto ? (
        <SettingRow label="Time zone">
          <Select
            label="Time zone"
            className="w-[260px]"
            value={mine.timezone ?? ''}
            disabled={off}
            searchable
            options={[{ value: '', label: company(inherited) }, ...(zones.data?.zones ?? []).map((z) => ({ value: z.value, label: `${z.label} (UTC${z.offset})`, group: z.group }))]}
            onValueChange={(v) => void save({ timezone_auto: false, timezone: v || null })}
          />
        </SettingRow>
      ) : null}
      <SettingRow label="Language" hint="How dates are written — month names and order.">
        <Select label="Language" className="w-[260px]" value={mine.locale ?? ''} disabled={off} options={[{ value: '', label: company(label(options.locales, org?.locale)) }, ...options.locales]} onValueChange={(v) => void save({ locale: v || null })} />
      </SettingRow>
      <SettingRow label="Date format">
        <Select label="Date format" className="w-[260px]" value={mine.date_format ?? ''} disabled={off} options={[{ value: '', label: company(org?.date_format ? example(options.date_formats, org.date_format) : 'your language’s') }, ...options.date_formats.map((d) => ({ value: d.value, label: d.example }))]} onValueChange={(v) => void save({ date_format: v || null })} />
      </SettingRow>
      <SettingRow label="Time format">
        <Select
          label="Time format"
          className="w-[260px]"
          value={mine.time_format ?? ''}
          disabled={off}
          options={[{ value: '', label: company(example(options.time_formats, org?.time_format ?? e.time_format)) }, ...options.time_formats.map((t) => ({ value: t.value, label: `${t.value === '12h' ? '12-hour' : '24-hour'} (${t.example})` }))]}
          onValueChange={(v) => void save({ time_format: v || null })}
        />
      </SettingRow>
      <SettingRow label="First day of the week" hint="Where calendars and date pickers start a week.">
        <Select
          label="First day of the week"
          className="w-[260px]"
          value={mine.week_start === null ? '' : String(mine.week_start)}
          disabled={off}
          options={[{ value: '', label: company(options.week_starts.find((w) => w.value === (org?.week_start ?? e.week_start))?.label) }, ...options.week_starts.map((w) => ({ value: String(w.value), label: w.label }))]}
          onValueChange={(v) => void save({ week_start: v === '' ? null : Number(v) })}
        />
      </SettingRow>
      <p className="m-0 mt-2 text-[11.5px] text-ink-3">Times are stored in UTC. Changing these changes how they are shown, never what was recorded.</p>
    </Card>
  );
}

interface ChatPrivacyState {
  read_receipts: boolean;
  own_choice: boolean;
  policy: 'choice' | 'always' | 'never';
}

function ChatPrivacy() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.chatPrivacy, queryFn: ({ signal }) => apiGet<ChatPrivacyState>('/api/chat/privacy', undefined, signal) });
  const save = async (on: boolean) => {
    try {
      const r = await apiPut<ChatPrivacyState>('/api/chat/privacy', { read_receipts: on });
      qc.setQueryData(K.chatPrivacy, r);
      toast('success', on ? 'Read receipts are on.' : 'Read receipts are off.');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const locked = q.data ? q.data.policy !== 'choice' : false;
  return (
    <Card title="Chat">
      <SettingRow label="Send read receipts" hint={locked ? `Set by your organisation: read receipts are ${q.data?.policy === 'always' ? 'always shown' : 'never shown'} for everyone.` : 'People you message see when you have read it. Off, they see Delivered instead.'}>
        <Switch label="Send read receipts" checked={!!q.data?.read_receipts} disabled={!q.data || locked} onChange={(v) => void save(v)} />
      </SettingRow>
    </Card>
  );
}
