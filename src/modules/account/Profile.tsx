import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { apiGet } from '../../core/api';
import { app } from '../../core/app-state';
import { currentZone } from '../../core/time';
import { useStore } from '../../core/store';
import { openOverlay } from '../../core/ui';
import { Icon } from '../../components/Icon';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { useMe, UserPicture } from '../../components/UserPicture';
import { attendanceTime, useAttendance, useNow } from '../hr/attendance';
import type { Profile as HrProfile } from '../hr/api';
import { btnPrimary } from '../hr/parts';
import type { OpenEditor } from './AccountPage';
import { useHasApp, useMfa, usePasskeys, usePictures, useProfile, useSessions, useSignIns, type Section } from './api';
import { Card, daysAgo, KeyValues, Pill, weekdays } from './parts';

/**
 * My profile (AcctProfile): who I am to everybody else — my picture and
 * name, what I do and where, how to reach me, what my organisation set, how
 * complete my profile is, and how well my account is protected. Read-only:
 * Edit profile goes to Profile settings. Working hours and "reports to" come
 * from HR when the People app is available and my login is linked to an
 * employee record; otherwise they are not shown.
 */

/** "Asia/Colombo" → "Colombo"; its time now, and "UTC+5:30". */
export function zoneFacts(zone: string, now = new Date()): { city: string; time: string; offset: string } {
  const city = (zone.split('/').pop() ?? zone).replace(/_/g, ' ');
  try {
    const time = new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(now);
    const off = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? '';
    return { city, time, offset: off === 'GMT' || off === 'GMT+0' ? 'UTC' : off.replace('GMT', 'UTC') };
  } catch {
    return { city, time: '', offset: '' };
  }
}

export default function Profile({ onPick, onEdit }: { onPick: (s: Section) => void; onEdit: OpenEditor }) {
  const me = useMe();
  const hasHr = useHasApp('hr');
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const orgs = useStore(app, (s) => s.bootstrap?.organizations ?? []);
  const profile = useProfile();
  const pictures = usePictures();
  const mfa = useMfa();
  const passkeys = usePasskeys();
  const sessions = useSessions();
  const signIns = useSignIns();
  const hr = useQuery({ queryKey: ['hr', 'me'], queryFn: ({ signal }) => apiGet<HrProfile>('/api/hr/me/profile', undefined, signal), enabled: hasHr, retry: false });
  const { today, clockedIn } = useAttendance(hasHr);
  const now = useNow(30_000);

  if (profile.isLoading) return <Spinner />;
  if (profile.error) return <ErrorNote error={profile.error} onRetry={() => void profile.refetch()} />;
  const p = profile.data!;
  const zone = me?.timezone || p.timezone || currentZone();
  const z = zoneFacts(zone, new Date(now));
  const vis = pictures.data?.visibility;
  const companies = vis?.companies.length ? vis.companies.map((c) => c.name) : orgs.map((o) => o.name);
  const teams = vis?.teams.map((t) => t.name) ?? [];
  const linked = hr.data && hr.data.linked !== false && hr.data.employee ? hr.data : null;
  const schedule = linked?.attendance?.schedule;
  const hours = schedule ? `${weekdays(schedule.work_days)}${schedule.work_days.length ? ' · ' : ''}${schedule.flexible ? 'flexible' : `${schedule.day_start.slice(0, 5)}–${schedule.day_end.slice(0, 5)}`}` : null;
  const avatar = me?.avatar ?? p.avatar;
  const job = [p.designation, p.department, p.company].filter(Boolean).join(' · ');
  const admin = !!perms?.includes('*');
  const activeKeys = (passkeys.data?.passkeys ?? []).filter((k) => k.active);
  const offerKeys = passkeys.data?.policy.enabled !== false;

  const steps: Array<{ label: string; done: boolean; act?: { label: string; run: () => void } }> = [
    { label: 'Name and work email', done: true },
    { label: 'Add a profile picture', done: !!avatar, act: { label: 'Add', run: () => onEdit('photo') } },
    { label: 'Add a phone number', done: !!p.phone, act: { label: 'Add', run: () => onPick('general') } },
    { label: 'Turn on two-factor authentication', done: !!mfa.data?.enabled, act: { label: 'Turn on', run: () => onPick('security') } },
    ...(offerKeys ? [{ label: 'Add a passkey', done: activeKeys.length > 0, act: { label: 'Add', run: () => onPick('security') } }] : []),
  ];
  const done = steps.filter((s) => s.done).length;

  return (
    <div className="flex max-w-[1180px] flex-col gap-4">
      <section aria-label="Profile header" className="overflow-hidden rounded-[16px] border border-line bg-surface shadow-[0_1px_2px_rgb(var(--ws-shadow-rgb)/.04)]">
        <div className="relative h-[104px] bg-[linear-gradient(120deg,var(--ws-navy-2)_0%,var(--ws-stage-primary)_45%,var(--ws-brand)_100%)]">
          <svg aria-hidden className="absolute inset-0 h-full w-full opacity-[.14]" preserveAspectRatio="none" viewBox="0 0 400 104">
            <circle cx="340" cy="-10" r="90" fill="#fff" />
            <circle cx="60" cy="130" r="70" fill="#fff" />
          </svg>
        </div>
        <div className="relative -mt-[46px] flex items-start gap-5 px-6 pb-5">
          <div className="relative shrink-0">
            <UserPicture name={me?.name ?? p.name} src={avatar} size={108} className="!bg-primary text-[36px] !text-white" ring="shadow-[0_0_0_5px_var(--color-surface),0_8px_24px_rgb(var(--ws-shadow-rgb)/.2)]" />
            <button type="button" aria-label="Change profile picture" title="Change profile picture" onClick={() => onEdit('photo')} className="absolute right-0 bottom-1 flex h-9 w-9 items-center justify-center rounded-full bg-surface text-primary shadow-[0_0_0_1px_var(--color-line),0_4px_12px_rgb(var(--ws-shadow-rgb)/.16)] hover:bg-selection">
              <Icon name="camera" size={16} />
            </button>
          </div>
          <div className="min-w-0 flex-1 pt-[58px]">
            <h1 className="m-0 truncate text-[24px] font-bold tracking-[-0.3px] text-ink">{me?.name ?? p.name}</h1>
            {p.preferred_name && p.preferred_name !== (me?.name ?? p.name) ? <div className="mt-0.5 truncate text-[13.5px] text-ink-2">{`Goes by ${p.preferred_name}`}</div> : null}
            {job ? <div className="mt-0.5 truncate text-[13.5px] text-ink-2">{job}</div> : null}
            <div className="mt-2.5 flex flex-wrap gap-2">
              {hasHr && today?.check_in ? (
                <button type="button" onClick={() => openOverlay('clock')} className="rounded-full">
                  <Pill tone={clockedIn ? 'green' : 'grey'} dot={clockedIn ? (today.on_break ? '#D97706' : '#22A861') : '#8A91A5'}>
                    {clockedIn ? `${today.on_break ? 'On a break' : 'Working'} · since ${attendanceTime(today.check_in)}` : `Finished at ${attendanceTime(today.check_out)}`}
                  </Pill>
                </button>
              ) : null}
              <Pill>
                {z.city} · {z.time} local time
              </Pill>
              {admin ? <Pill tone="indigo">Administrator</Pill> : null}
            </div>
          </div>
          <div className="flex shrink-0 gap-2 pt-[62px]">
            <button type="button" className={btnPrimary} onClick={() => onPick('general')}>
              <Icon name="compose" size={15} /> Edit profile
            </button>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-4" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px' }}>
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Contact" action={<Link onClick={() => onPick('general')}>Edit</Link>}>
            <KeyValues
              rows={[
                ['Work email', p.email],
                ['Phone', p.phone],
                ['Time zone', `${zone.replace(/_/g, ' ')}${z.offset ? ` (${z.offset})` : ''}`],
                ...(hours ? ([['Working hours', hours]] as Array<[string, ReactNode]>) : []),
              ]}
            />
          </Card>
          <Card
            title="Organisation"
            action={
              <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-3">
                <Icon name="lock" size={13} /> Set by your organisation
              </span>
            }
          >
            <KeyValues
              rows={[
                [
                  companies.length > 1 ? 'Companies' : 'Company',
                  companies.length ? (
                    <span className="flex flex-wrap gap-1.5">
                      {companies.map((c, i) => (
                        <Pill key={c} tone={i === 0 ? 'indigo' : 'grey'}>
                          {c}
                        </Pill>
                      ))}
                    </span>
                  ) : null,
                ],
                ['Department', p.department],
                ['Job title', p.designation],
                ...(linked ? ([['Reports to', linked.employment?.manager?.name ?? null]] as Array<[string, ReactNode]>) : []),
                ['Teams', teams.length ? teams.join(', ') : null],
              ]}
            />
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <div className="mb-3.5 flex items-center gap-3.5">
              <Ring value={done / steps.length} />
              <div className="min-w-0">
                <h2 className="m-0 text-[14.5px] font-bold text-ink">{done === steps.length ? 'Your profile is complete' : 'Complete your profile'}</h2>
                <p className="m-0 text-[12.5px] text-ink-3">
                  {done} of {steps.length} done
                </p>
              </div>
            </div>
            <div className="flex flex-col">
              {steps.map((s) => (
                <div key={s.label} className="flex min-h-[34px] items-center gap-2.5 border-t border-line/70 py-1.5 text-[13px]">
                  <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full', s.done ? 'bg-green text-white' : 'border-[1.5px] border-dashed border-ink-3/60')}>{s.done ? <Icon name="check" size={12} strokeWidth={3} /> : null}</span>
                  <span className={cx('min-w-0 flex-1', s.done ? 'text-ink-3 line-through' : 'font-semibold text-ink')}>{s.label}</span>
                  {!s.done && s.act ? <Link onClick={s.act.run}>{s.act.label}</Link> : null}
                </div>
              ))}
            </div>
          </Card>
          <Card title="Security" action={<Link onClick={() => onPick('security')}>Manage</Link>}>
            <div className="flex flex-col">
              <Fact icon="shield-check" label="Two-factor" value={mfa.data ? mfa.data.enabled ? <Pill tone="green">On</Pill> : <Pill tone="amber">Off</Pill> : '…'} />
              {offerKeys ? <Fact icon="fingerprint" label="Passkeys" value={activeKeys.length ? `${activeKeys.length}${activeKeys[0]?.device_name ? ` · ${activeKeys[0].device_name}` : ''}` : 'None'} /> : null}
              <Fact icon="laptop" label="Signed in on" value={sessions.data ? `${sessions.data.rows.length} ${sessions.data.rows.length === 1 ? 'device' : 'devices'}` : '…'} />
              {signIns.data?.password_set_at ? <Fact icon="key" label="Password changed" value={daysAgo(signIns.data.password_set_at)} /> : null}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Link({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-[13px] font-bold text-primary hover:underline">
      {children}
    </button>
  );
}

function Fact({ icon, label, value }: { icon: string; label: string; value: ReactNode }) {
  return (
    <div className="flex min-h-[38px] items-center gap-2.5 border-t border-line/70 py-1.5 text-[13px] first:border-t-0">
      <Icon name={icon} size={16} className="shrink-0 text-ink-3" />
      <span className="flex-1 text-ink-2">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </div>
  );
}

/** How much of the profile is done, as a ring. */
function Ring({ value }: { value: number }) {
  const r = 19;
  const c = 2 * Math.PI * r;
  return (
    <svg width={46} height={46} viewBox="0 0 46 46" aria-hidden className="shrink-0 -rotate-90">
      <circle cx={23} cy={23} r={r} fill="none" stroke="var(--color-line)" strokeWidth={5} />
      <circle cx={23} cy={23} r={r} fill="none" stroke={value >= 1 ? '#22A861' : 'var(--color-primary)'} strokeWidth={5} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, value))} />
    </svg>
  );
}

