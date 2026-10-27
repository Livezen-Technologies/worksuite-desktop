import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError } from '../../../core/api';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Button, Chip, cx, Empty, Spinner } from '../../../components/ui';
import { phoneApi, PK, useSettings, useSyncRun, useSyncRuns, type Settings as S } from '../api';
import { stamp } from '../lib/format';
import { INPUT, Mono, PageBody, PageHeader, Panel, StatusChip, Tabs } from '../parts';
import { SettingRow, SettingRowFrame, SettingsGroup } from '../../../components/SettingsKit';

/**
 * A12 · Settings & sync runs (VOIP-ADM-02/03, VOIP-SYN-01…03). Provisioning, calls and media, recording and
 * intelligence, notifications, and the legacy single-switch connection; beside them every sync run with its state
 * and, for a partial one, its conflict log.
 *
 * On today's server the settings live in `voip_settings`, readable and writable only with admin.manage (G-09), and
 * only some keys are saved; after saving, anything the server did not keep is named.
 */
type Tab = 'general' | 'recording' | 'notifications' | 'permissions' | 'advanced';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'recording', label: 'Recording' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'advanced', label: 'Advanced' },
];

export default function Settings() {
  const q = useSettings();
  // The form starts from the server's answer: drawn again once it arrives.
  return <SettingsView key={q.data ? 'loaded' : 'waiting'} q={q} />;
}

function SettingsView({ q }: { q: ReturnType<typeof useSettings> }) {
  const { query } = useTab();
  const asked = query.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(asked && TABS.some((t) => t.id === asked) ? asked : 'general');
  const qc = useQueryClient();
  const [f, setF] = useState<S>(() => q.data ?? {});
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setSaving(true);
    try {
      const changed = Object.fromEntries(Object.entries(f).filter(([k, v]) => q.data?.[k] !== v));
      const r = await phoneApi.saveSettings(changed);
      const after = await phoneApi.settings();
      const kept = Object.keys(changed).filter((k) => k === 'ami_secret' || after[k] === changed[k]);
      const dropped = Object.keys(changed).filter((k) => !kept.includes(k));
      void qc.invalidateQueries({ queryKey: PK.settings });
      if (dropped.length) toast('info', `Saved, except ${dropped.join(', ')}: this server does not keep ${dropped.length === 1 ? 'that setting' : 'those settings'} yet.`);
      else toast('success', r.pbx.ok ? 'Saved. The phone system answers.' : `Saved. ${r.pbx.message ?? 'The phone system is not reachable.'}`);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const forbidden = q.error instanceof ApiError && q.error.forbidden;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Telephony settings"
        actions={
          <Button variant="primary" loading={saving} disabled={!q.data} onClick={() => void save()}>
            Save
          </Button>
        }
      />
      <PageBody>
        <div className="flex flex-col gap-4">
          <Tabs label="Settings" value={tab} onChange={setTab} tabs={TABS} />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
            <div className="flex flex-col gap-4">
              {q.isLoading ? (
                <Spinner />
              ) : forbidden ? (
                <Panel title="Settings are locked on this server">
                  <p className="text-[12.5px] text-ink-2">{(q.error as ApiError).message} On this WorkSuite server telephony settings and the configuration review need the admin.manage permission, which only a super-admin holds (G-09). Your voip.manage still covers extensions, servers, sync and recordings.</p>
                </Panel>
              ) : q.error ? (
                <Panel>
                  <p className="text-[12.5px] text-danger">{(q.error as Error).message}</p>
                </Panel>
              ) : tab === 'general' ? (
                <>
                  <Group title="Provisioning">
                    <Row label="Create an extension for new hires" hint="From HR onboarding, using the server mapping">
                      <OnOff value={f.auto_provision} onChange={(v) => set('auto_provision', v)} />
                    </Row>
                    <Row label="Disable extension when someone leaves" hint="From HR offboarding; history is kept">
                      <OnOff value={f.auto_disable_on_offboard} onChange={(v) => set('auto_disable_on_offboard', v)} />
                    </Row>
                    <Row label="Extension number length" hint="Minimum digits for new extensions">
                      <input value={f.extension_min_length ?? ''} onChange={(e) => set('extension_min_length', e.target.value.replace(/\D/g, ''))} aria-label="Extension number length" className={cx(INPUT, 'w-24')} />
                    </Row>
                  </Group>
                  <Group title="Calls & media">
                    <Row label="Codec order" hint="Offered to browsers and desk phones">
                      <input value={f.codec_policy ?? ''} onChange={(e) => set('codec_policy', e.target.value)} aria-label="Codec order" className={cx(INPUT, 'w-44 font-mono')} />
                    </Row>
                    <Row label="Registration expiry" hint="Seconds before a device must re-register">
                      <input value={f.registration_timeout ?? ''} onChange={(e) => set('registration_timeout', e.target.value.replace(/\D/g, ''))} aria-label="Registration expiry" className={cx(INPUT, 'w-24')} />
                    </Row>
                    <Row label="Default caller ID" hint="Used when an extension has none">
                      <input value={f.default_caller_id ?? ''} onChange={(e) => set('default_caller_id', e.target.value)} aria-label="Default caller ID" placeholder="+94 11 244 7000" className={cx(INPUT, 'w-44 font-mono')} />
                    </Row>
                  </Group>
                </>
              ) : tab === 'recording' ? (
                <Group title="Recording & intelligence">
                  <Row label="Keep recordings for" hint="Then deleted from Drive automatically (retention, dry run first)">
                    <span className="flex items-center gap-1.5">
                      <input value={f.recording_retention_days ?? ''} onChange={(e) => set('recording_retention_days', e.target.value.replace(/\D/g, ''))} aria-label="Keep recordings for" className={cx(INPUT, 'w-24')} />
                      <span className="text-[12px] text-ink-3">days</span>
                    </span>
                  </Row>
                  <Row label="Record every call" hint="Overrides each extension’s policy">
                    <OnOff value={f.record_all_calls} onChange={(v) => set('record_all_calls', v)} />
                  </Row>
                  <Row label="Encrypt recordings" hint="Drive-level encryption at rest">
                    <OnOff value={f.recording_encrypt} onChange={(v) => set('recording_encrypt', v)} />
                  </Row>
                  <Row label="Announce recording" hint="Callers hear that the call may be recorded (VOIP-REC-07)">
                    <OnOff value={f.recording_announce} onChange={(v) => set('recording_announce', v)} />
                  </Row>
                  <Row label="Call intelligence provider" hint="An on-server engine, or a CoreAIService provider approved for call audio">
                    <select aria-label="Call intelligence provider" value={f.ai_provider ?? 'none'} onChange={(e) => set('ai_provider', e.target.value)} className={cx(INPUT, 'w-48')}>
                      <option value="none">None</option>
                      <option value="whisper">On-server Whisper</option>
                      <option value="vosk">On-server Vosk</option>
                      <option value="core_ai">CoreAIService provider</option>
                    </select>
                  </Row>
                </Group>
              ) : tab === 'notifications' ? (
                <Group title="Telephony notifications">
                  <NotificationRow event="voip.missed_call" label="Missed call" hint="Someone missed a call that rang them" note="Raised today for Chat calls; for phone calls once the server reads the switch’s call records (G-10). This computer shows its own missed calls either way." />
                  <NotificationRow event="voip.voicemail" label="New voicemail" hint="A message was left" note="Raised once the server ingests voicemail (G-10)." />
                  <NotificationRow event="voip.pbx_offline" label="Phone system offline" hint="A switch stopped answering" note="Raised by the health sampler once the server sends it (G-10)." />
                  <NotificationRow event="voip.queue_overflow" label="Queue overflow" hint="Callers overflowed or waited past the SLA" note="Raised by the queue monitor once the server sends it (G-10)." />
                  <p className="text-[11.5px] text-ink-3">Each person chooses how they hear about these in My account › Notifications.</p>
                </Group>
              ) : tab === 'permissions' ? (
                <Group title="Who may do what">
                  <PermRow perm="(none)" who="Anyone with an extension" can="The softphone, their own calls, recordings, voicemail, forwarding and hot desk; the extension directory and short codes." />
                  <PermRow perm="voip.reports" who="Team leads and managers" can="All call history and recordings, reports, live queue depth." />
                  <PermRow perm="voip.supervise" who="Supervisors (new)" can="Listen, whisper and barge on the live board; pause agents. Every use is audited." />
                  <PermRow perm="voip.manage" who="Telephony administrators" can="Extensions and SIP secrets, PBX servers, mappings, sync, short codes, trunks, routes, IVR, queues, recording import and retention." />
                  <p className="text-[11.5px] text-ink-3">Permissions are granted to roles in the Admin Center.</p>
                </Group>
              ) : (
                <Group title="Legacy single-switch connection" sub="Used before PBX servers existed; kept to adopt an existing installation (php spark voip adopt).">
                  <Row label="AMI host and port">
                    <span className="flex gap-1.5">
                      <input value={f.ami_host ?? ''} onChange={(e) => set('ami_host', e.target.value)} aria-label="AMI host" className={cx(INPUT, 'w-40')} />
                      <input value={f.ami_port ?? ''} onChange={(e) => set('ami_port', e.target.value.replace(/\D/g, ''))} aria-label="AMI port" className={cx(INPUT, 'w-20')} />
                    </span>
                  </Row>
                  <Row label="AMI user">
                    <input value={f.ami_user ?? ''} onChange={(e) => set('ami_user', e.target.value)} aria-label="AMI user" className={cx(INPUT, 'w-40')} />
                  </Row>
                  <Row label="AMI secret" hint="Shown masked; leave as it is to keep it">
                    <input type="password" autoComplete="new-password" value={f.ami_secret ?? ''} onChange={(e) => set('ami_secret', e.target.value)} aria-label="AMI secret" className={cx(INPUT, 'w-40')} />
                  </Row>
                  <Row label="SIP domain and WebSocket path" hint="Where browsers register: wss://domain + path">
                    <span className="flex gap-1.5">
                      <input value={f.sip_domain ?? ''} onChange={(e) => set('sip_domain', e.target.value)} aria-label="SIP domain" className={cx(INPUT, 'w-44')} />
                      <input value={f.ws_path ?? ''} onChange={(e) => set('ws_path', e.target.value)} aria-label="WebSocket path" className={cx(INPUT, 'w-20 font-mono')} />
                    </span>
                  </Row>
                  <Row label="Scheduled sync">
                    <OnOff value={f.sync_enabled} onChange={(v) => set('sync_enabled', v)} />
                  </Row>
                </Group>
              )}
            </div>
            <SyncRuns />
          </div>
        </div>
      </PageBody>
    </div>
  );
}

/** A card of settings: the Settings kit's group. */
function Group({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <SettingsGroup title={title} description={sub} className="!mb-0">
      {children}
    </SettingsGroup>
  );
}

/** One setting: the Settings kit's row. */
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <SettingRow label={label} hint={hint}>
      {children}
    </SettingRow>
  );
}

function OnOff({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  const on = value === '1' || value === 'true' || value === 'on';
  return (
    <select aria-label="On or off" value={on ? '1' : '0'} onChange={(e) => onChange(e.target.value)} className={cx(INPUT, 'w-24')}>
      <option value="1">On</option>
      <option value="0">Off</option>
    </select>
  );
}

function NotificationRow({ event, label, hint, note }: { event: string; label: string; hint: string; note: string }) {
  return (
    <SettingRowFrame className="flex flex-col gap-0.5">
      <span className="flex items-center gap-2">
        <b className="text-[13px]">{label}</b>
        <Mono className="text-[11px] text-ink-3">{event}</Mono>
      </span>
      <span className="text-[11.5px] text-ink-2">{hint}</span>
      <span className="text-[11.5px] text-ink-3">{note}</span>
    </SettingRowFrame>
  );
}

function PermRow({ perm, who, can }: { perm: string; who: string; can: string }) {
  return (
    <SettingRowFrame className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 text-[12.5px]">
      <span>
        <Mono className="block font-semibold">{perm}</Mono>
        <span className="text-[11px] text-ink-3">{who}</span>
      </span>
      <span className="text-ink-2">{can}</span>
    </SettingRowFrame>
  );
}

/** Sync runs (VOIP-SYN-01…03): every run, its state, and the conflict log of one. */
function SyncRuns() {
  const qc = useQueryClient();
  const runs = useSyncRuns();
  const [open, setOpen] = useState<number | null>(null);
  const detail = useSyncRun(open);
  const [busy, setBusy] = useState(false);
  const due = async () => {
    setBusy(true);
    try {
      const r = await phoneApi.syncDue();
      toast('success', r.message);
      void qc.invalidateQueries({ queryKey: ['phone', 'sync-runs'] });
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const list = runs.data ?? [];
  const shown = list.find((r) => r.id === open) ?? null;
  return (
    <Panel title="Sync runs" action={<Button size="sm" loading={busy} onClick={() => void due()}>Run due syncs</Button>} bodyClassName="flex flex-col gap-2">
      {runs.isLoading ? (
        <Spinner />
      ) : runs.error ? (
        <p className="text-[12.5px] text-danger">{(runs.error as Error).message}</p>
      ) : list.length === 0 ? (
        <Empty icon="refresh" title="No sync has run yet" />
      ) : (
        <ul className="flex flex-col">
          {list.map((r) => (
            <li key={r.id} className="grid grid-cols-[minmax(0,1.2fr)_auto_minmax(0,1.2fr)_auto] items-center gap-2 border-b border-line py-2 text-[12px] last:border-b-0">
              <span className="min-w-0">
                <b className="block truncate">{r.server ?? `Server ${r.server_id}`}</b>
                <span className="block truncate text-[11px] text-ink-3">
                  {r.kind} · {r.trigger}
                  {r.by ? ` · ${r.by}` : ''}
                </span>
              </span>
              <StatusChip status={r.state} />
              <span className="min-w-0 text-[11.5px] text-ink-2">
                {stamp(r.started_at)}
                <span className="block text-ink-3">
                  {r.examined} examined · {r.updated} updated{r.created ? ` · ${r.created} created` : ''}
                  {r.failed ? ` · ${r.failed} failed` : ''}
                </span>
              </span>
              {r.has_detail ? (
                <button type="button" className="text-[12px] font-semibold text-primary underline" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  {open === r.id ? 'Hide' : 'Details'}
                </button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <div className="rounded-[10px] border border-line bg-subtle p-2.5">
          <div className="mb-1 flex items-center gap-2 text-[12px]">
            <b>
              {shown?.server ?? 'Run'} · {shown ? stamp(shown.started_at) : ''}
            </b>
            {shown ? <Chip tone={shown.state === 'ok' ? 'success' : shown.state === 'partial' ? 'warning' : 'danger'}>{shown.state}</Chip> : null}
          </div>
          {detail.isLoading ? (
            <Spinner />
          ) : (
            <pre className="max-h-[260px] overflow-auto font-mono text-[11px] whitespace-pre-wrap text-ink-2 scroll-thin">{(detail.data?.detail ?? []).join('\n') || 'No detail.'}</pre>
          )}
        </div>
      ) : null}
    </Panel>
  );
}
