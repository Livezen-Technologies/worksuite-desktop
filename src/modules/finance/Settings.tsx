import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { todayInZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Spinner, cx } from '../../components/ui';
import { Empty, input, Kpi, Seg } from '../../components/PageKit';
import { StatGrid, type StatTone } from '../../components/StatCard';
import { Pill } from '../../components/ListKit';
import { can, longDate, MONTHS, refusal, shortDate, type Company } from './api';
import { ConfirmSheet, LoadFailed, Notice } from '../../components/RecordKit';
import type { FinanceView, ScreenProps } from './Rail';
import { applyPreset, calendarDay, endOfDay, expandPreset, fetchMembers, fetchSettings, forbiddenWhy, KS, levelChoices, reachesNothing, setArea, type AccessCell, type Area, type Member, type Preset, type ProfileField } from './setup';
import { SectionHeader, SettingRowFrame, SettingsGroup } from '../../components/SettingsKit';

/**
 * Finance's settings: the company's accounting profile, and — for those who
 * decide it — how far each person reaches into each area of its books.
 *
 * There is no General form. Finance keeps nothing in the settings table: the
 * base currency and the year's first month are on the company, fixed when its
 * books were opened, and the account roles are nominated on the chart. The
 * web's settings shell shows the same sentence in place of a form, because a
 * control that changes nothing is worse than none.
 *
 * Both sections follow the company in the rail. The web's access grid once
 * carried its own company picker, which let the rail say one company while the
 * grid edited another; here the company is named in the section instead.
 */
type Tab = 'profile' | 'access';

export default function Settings({ company, onGo }: ScreenProps) {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const mayGrant = can(perms, 'finance.access.manage');
  const [tab, setTab] = useState<Tab>('profile');
  const shown: Tab = mayGrant ? tab : 'profile';
  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <SectionHeader
        level={1}
        title="Settings"
        hint="Finance keeps no installation-wide settings. A company's base currency and financial year are set once when its books are opened, and its account roles on the chart of accounts."
        actions={
          mayGrant ? (
            <Seg<Tab>
              label="Settings"
              value={shown}
              onChange={setTab}
              options={[
                { id: 'profile', label: 'Accounting profile' },
                { id: 'access', label: 'Area access' },
              ]}
            />
          ) : null
        }
      />
      {shown === 'access' ? <AreaAccess company={company} /> : <Profile company={company} onGo={onGo} />}
    </div>
  );
}

// ── the accounting profile ───────────────────────────────────────────────

/** A profile value in words: the month by name, the opening date as a date. */
function profileValue(f: ProfileField): string | null {
  if (f.value === null || f.value === undefined || f.value === '') return null;
  if (f.key === 'fiscal_year_start_month') {
    const n = Number(f.value);
    return MONTHS[n - 1] ?? String(f.value);
  }
  if (f.key === 'books_opened_at') return longDate(String(f.value));
  return String(f.value);
}

/**
 * The profile shows what each field is and says what cannot change and why,
 * rather than offering inputs that would save and quietly misstate the ledger:
 * a new base currency would restate every figure against a unit it was never
 * recorded in. The server marks the base currency changeable only while
 * nothing is posted — but it has no route that changes it, so nothing here
 * pretends to.
 *
 * The settings that can safely change have their own screens, and the counts
 * and the roles go there rather than duplicating them: two screens writing
 * one setting is how they start disagreeing.
 */
function Profile({ company, onGo }: { company: Company; onGo: (v: FinanceView, extra?: string) => void }) {
  const q = useQuery({ queryKey: KS.settings(company.id), queryFn: ({ signal }) => fetchSettings(company.id, signal), retry: false });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) {
    const why = forbiddenWhy(q.error);
    return why ? <Notice tone="grey">{why}</Notice> : <LoadFailed what="These settings" onRetry={() => void q.refetch()} />;
  }
  const d = q.data;
  if (!d.company?.has_books) {
    return (
      <Notice tone="amber">
        <b>The books are not open for {company.name}.</b> There is no accounting profile until they are. Open them from the Overview — that is where the base currency and financial year get decided, and both are hard to change afterwards.
      </Notice>
    );
  }
  const counts: Array<[string, number | undefined, FinanceView, string, StatTone]> = [
    ['Accounts', d.counts?.accounts, 'accounts', 'list', 'blue'],
    ['Journals', d.counts?.journals, 'journals', 'notebook', 'violet'],
    ['Posted', d.counts?.posted, 'journals', 'check-check', 'green'],
    ['Tax codes', d.counts?.tax_codes, 'tax', 'percent', 'amber'],
    ['Financial years', d.counts?.years, 'periods', 'calendar-days', 'cyan'],
  ];
  return (
    <>
      <SettingsGroup title={`Accounting profile · ${d.company.name}`} className="!mb-0">
        {(d.profile ?? []).map((f) => (
          <SettingRowFrame key={f.key} className="flex items-start gap-3 !py-2.5 text-[13px]">
            <span className="w-[190px] shrink-0 text-ink-3">{f.label}</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <b className={profileValue(f) === null ? 'font-medium text-ink-3' : 'text-ink'}>{profileValue(f) ?? 'Not set'}</b>
              {/* The reason travels with the field: a padlock alone sends somebody looking for the setting elsewhere. */}
              {f.why ? <span className="text-[12px] text-ink-3">{f.why}</span> : f.editable ? <span className="text-[12px] text-ink-3">Nothing is posted yet, so this is not fixed — but there is no screen that changes it.</span> : null}
            </span>
            {f.editable ? null : (
              <span className="flex shrink-0 items-center gap-1 rounded-[6px] bg-subtle px-1.5 py-0.5 text-[11px] font-semibold text-ink-3">
                <Icon name="lock" size={11} /> Fixed
              </span>
            )}
          </SettingRowFrame>
        ))}
      </SettingsGroup>

      <StatGrid min={180}>
        {counts.map(([label, n, go, icon, tone]) => (
          <Kpi key={label} label={label} value={n ?? 0} icon={icon} tone={tone} onClick={() => onGo(go)} />
        ))}
      </StatGrid>

      <SettingsGroup
        title="Default accounts"
        className="!mb-0"
        description="The accounts the posting engine reaches for by name. An unmapped one is not cosmetic — it is a posting that will refuse later. Nominate them on the chart of accounts."
        actions={
          <button type="button" className="text-[12.5px] font-semibold text-primary hover:underline" onClick={() => onGo('accounts')}>
            Chart of accounts
          </button>
        }
      >
        {(d.roles ?? []).map((r) => (
          <SettingRowFrame key={r.role} className="flex items-center gap-3 !py-2 text-[13px]">
            <span className="w-[190px] shrink-0 text-ink-3">{r.label}</span>
            <span className="min-w-0 flex-1 truncate">
              {r.mapped ? (
                <>
                  <span className="font-mono text-[12px] text-ink-3">{r.code}</span> {r.name}
                </>
              ) : (
                <span className="text-warning-ink">Not mapped</span>
              )}
            </span>
            <Icon name={r.mapped ? 'check-circle' : 'warning'} size={15} className={cx('shrink-0', r.mapped ? 'text-success' : 'text-warning-ink')} />
          </SettingRowFrame>
        ))}
      </SettingsGroup>
    </>
  );
}

// ── area access ──────────────────────────────────────────────────────────

const LEVEL_TONE: Record<string, 'grey' | 'blue' | 'amber' | 'green'> = { none: 'grey', view: 'blue', edit: 'amber', manage: 'green' };
const word = (l: string) => l.charAt(0).toUpperCase() + l.slice(1);
const AREA_W = 150;

/**
 * Who may reach which of the six areas of this company's books, and how far.
 *
 * IT CAN ONLY TAKE ACCESS AWAY. Every cell is capped at the level the person's
 * role already gives (their ceiling), and the server refuses a write above it.
 * Levels above the ceiling are offered disabled with the reason rather than
 * hidden. Giving somebody more is a role change, in Directory.
 *
 * INHERIT IS NOT NONE. Inherit means nobody has said anything and the role
 * decides; none means somebody said no. A two-state control could not put a
 * cell back the way it was found.
 *
 * ONE CELL PER REQUEST, saved on change, so two administrators with the grid
 * open never overwrite each other's whole grid.
 *
 * YOUR OWN ROW IS NOT EDITABLE. The server refuses raising your own access,
 * and narrowing it is a change you could not then undo yourself.
 *
 * NOT A SECURITY CONTROL YET — and the section says so. The API does not check
 * these grants; they decide what the screens show. Presenting them as a lock
 * would be the one claim here that is not true.
 */
function AreaAccess({ company }: { company: Company }) {
  const qc = useQueryClient();
  const uid = useStore(app, (s) => s.auth?.user?.id ?? '');
  const q = useQuery({ queryKey: KS.members(company.id), queryFn: ({ signal }) => fetchMembers(company.id, signal), retry: false });
  const [find, setFind] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [asking, setAsking] = useState<{ m: Member; p: Preset } | null>(null);
  const [today] = useState(() => todayInZone());
  const rows = useMemo(() => {
    const all = q.data?.members ?? [];
    const t = find.trim().toLowerCase();
    return t ? all.filter((m) => m.name.toLowerCase().includes(t) || (m.email ?? '').toLowerCase().includes(t)) : all;
  }, [q.data, find]);

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) {
    const why = forbiddenWhy(q.error);
    return why ? <Notice tone="grey">{why}</Notice> : <LoadFailed what="Who has access to these books" onRetry={() => void q.refetch()} />;
  }

  const areas = q.data.matrix?.modules ?? [];
  const presets = q.data.matrix?.presets ?? [];
  const keys = areas.map((a) => a.key);
  const refresh = () => void qc.invalidateQueries({ queryKey: KS.members(company.id) });

  const save = async (m: Member, area: string, level: string, expires: string | null) => {
    setBusy(m.user_id);
    try {
      const r = await setArea(company.id, m.user_id, { module: area, level, expires_at: expires });
      toast('success', r?.before && r?.after ? `Changed from ${r.before} to ${r.after}.` : 'Access updated.');
      refresh();
    } catch (e) {
      // The server's sentence names the ceiling and where to raise it; rewording it would lose both halves.
      toast('error', refusal(e));
    } finally {
      setBusy(null);
    }
  };
  const preset = async (m: Member, p: Preset) => {
    setBusy(m.user_id);
    try {
      const r = await applyPreset(company.id, m.user_id, p.key);
      const skipped = r?.skipped ?? [];
      toast(skipped.length ? 'error' : 'success', skipped.length ? `${r?.applied?.length ?? 0} area(s) set, ${skipped.length} could not be: ${skipped.map((s) => s.why).join(' ')}` : `${p.label} applied to ${m.name}.`);
      setAsking(null);
      refresh();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Notice tone="amber">
        <b>These levels are not enforced by the server yet.</b> They decide what Finance shows each person — which screens and buttons appear — but the API does not check them, so anything a person asks for another way is still judged by their role alone. Treat this as tidying what somebody sees, not as a security control. To take a permission away for certain, change their role in Directory.
      </Notice>
      <Notice tone="grey">
        This grid only ever <b>narrows</b> access. A level above what somebody’s role already allows is refused, because storing it would not change what they can do. To give somebody more, change their role in Directory. <b>Inherit</b> means no restriction here — the role decides. An <b>end date</b> lifts the restriction when it passes, returning the person to what their role allows; it does not remove their access. A <b>preset</b> sets every area at once and is highlighted only while the cells still match it.
      </Notice>

      <div className="flex items-center gap-2.5">
        <b className="min-w-0 flex-1 text-[14px] text-ink">People in {company.name}</b>
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a person" aria-label="Find a person" className={cx(input, 'w-[240px]')} />
      </div>

      {rows.length === 0 ? (
        <SettingsGroup>
          <Empty text={find.trim() ? 'Nobody matches that.' : 'Nobody has access to this company’s books yet.'} />
        </SettingsGroup>
      ) : (
        <SettingsGroup>
          <div className="overflow-x-auto">
          <div style={{ minWidth: 28 + 240 + areas.length * (AREA_W + 10) }}>
            <div className="flex gap-2.5 border-b border-line bg-ground px-3.5 py-2 text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
              {/* Sticky, or scrolling right loses whose row you are on. */}
              <span className="sticky left-0 z-10 w-[240px] shrink-0 bg-ground">Person</span>
              {areas.map((a) => (
                <span key={a.key} className="shrink-0" style={{ width: AREA_W }} title={a.note ?? undefined}>
                  {a.label}
                </span>
              ))}
            </div>
            {rows.map((m) => (
              <PersonRow
                key={m.user_id}
                m={m}
                areas={areas}
                presets={presets}
                self={String(m.user_id) === uid}
                empty={reachesNothing(m, keys)}
                busy={busy === m.user_id}
                today={today}
                // A restriction that already has an end date keeps it when only its level changes; the web cleared it silently.
                onLevel={(area, cell, level) => void save(m, area, level, level !== 'inherit' && cell.expires_at ? endOfDay(calendarDay(cell.expires_at)) : null)}
                onUntil={(area, cell, day) => void save(m, area, cell.granted ?? 'none', day ? endOfDay(day) : null)}
                onPreset={(p) => setAsking({ m, p })}
              />
            ))}
          </div>
          </div>
        </SettingsGroup>
      )}

      {asking ? <PresetSheet m={asking.m} p={asking.p} areas={areas} busy={busy === asking.m.user_id} onYes={() => void preset(asking.m, asking.p)} onClose={() => setAsking(null)} /> : null}
    </>
  );
}

function PersonRow({
  m,
  areas,
  presets,
  self,
  empty,
  busy,
  today,
  onLevel,
  onUntil,
  onPreset,
}: {
  m: Member;
  areas: Area[];
  presets: Preset[];
  self: boolean;
  empty: boolean;
  busy: boolean;
  today: string;
  onLevel: (area: string, cell: AccessCell, level: string) => void;
  onUntil: (area: string, cell: AccessCell, day: string) => void;
  onPreset: (p: Preset) => void;
}) {
  const span = (text: string) => (
    <span className="min-w-0 flex-1 self-center text-[12.5px] leading-relaxed text-ink-3" style={{ maxWidth: areas.length * (AREA_W + 10) }}>
      {text}
    </span>
  );
  return (
    <div data-person={m.user_id} className="flex gap-2.5 border-b border-line/70 px-3.5 py-2.5 text-[13px] last:border-b-0">
      <span className="sticky left-0 z-10 flex w-[240px] shrink-0 flex-col bg-surface">
        <b className="truncate text-ink">
          {m.name}
          {self ? <span className="ml-1.5 text-[11.5px] font-semibold text-ink-3">(you)</span> : null}
        </b>
        {m.email ? <span className="truncate text-[11.5px] text-ink-3">{m.email}</span> : null}
        <span className="text-[10.5px] font-bold tracking-[.4px] text-ink-3 uppercase">{m.company_role}</span>
        {/* The preset the rows currently amount to, worked out by the server from the rows; change one cell and it is no longer true. */}
        {!self && !empty && presets.length ? (
          <span className="mt-1.5 flex flex-wrap gap-1">
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                title={p.hint}
                disabled={busy}
                onClick={() => onPreset(p)}
                aria-pressed={m.preset === p.key}
                className={cx('h-[22px] rounded-[6px] px-1.5 text-[11px] font-semibold disabled:opacity-50', m.preset === p.key ? 'bg-primary text-white' : 'border border-line text-ink-2 hover:bg-subtle')}
              >
                {p.label}
              </button>
            ))}
          </span>
        ) : null}
      </span>
      {self
        ? span('This is you. Your own access here is set by somebody else — the server refuses a change that raises it, and narrowing it is a change you could not then undo yourself. My access shows what you hold.')
        : empty
          ? span('Their role gives them no Finance access in this company, so there is nothing to narrow. Change their role in Directory to give them some.')
          : areas.map((a) => {
              const cell = m.modules[a.key];
              if (!cell) return <span key={a.key} className="shrink-0" style={{ width: AREA_W }} />;
              return (
                <span key={a.key} className="flex shrink-0 flex-col gap-1" style={{ width: AREA_W }}>
                  <Select<string>
                    aria-label={`${m.name} · ${a.label}`}
                    value={cell.granted ?? 'inherit'}
                    disabled={busy}
                    options={levelChoices(cell.ceiling)}
                    onValueChange={(v) => v !== (cell.granted ?? 'inherit') && onLevel(a.key, cell, v)}
                    className="h-7 w-full rounded-[7px] border px-2 text-[12px]"
                  />
                  {/* An end date only once a restriction exists: on inherit there is nothing to end. */}
                  {cell.granted !== null ? (
                    <input
                      type="date"
                      aria-label={`${m.name} · ${a.label} until`}
                      title="The restriction lifts at the end of this day"
                      value={calendarDay(cell.expires_at)}
                      min={today}
                      disabled={busy}
                      onChange={(e) => onUntil(a.key, cell, e.target.value)}
                      className={cx(input, '!h-7 text-[12px]')}
                    />
                  ) : null}
                  <span className="flex flex-wrap items-center gap-1 empty:hidden">
                    {cell.granted !== null || cell.via === 'suspended' ? <Pill tone={LEVEL_TONE[cell.level] ?? 'grey'}>{word(cell.level)}</Pill> : null}
                    {cell.via === 'company-grant' ? <span className="text-[11px] font-semibold text-warning-ink dark:text-warning">narrowed</span> : null}
                    {cell.via === 'suspended' ? <span className="text-[11px] font-semibold text-danger">suspended</span> : null}
                    {cell.expires_at ? <Pill tone="amber">until {shortDate(calendarDay(cell.expires_at))}</Pill> : null}
                  </span>
                </span>
              );
            })}
    </div>
  );
}

/** A preset, spelled out for this person — each area's level after it is capped at what their role reaches. */
function PresetSheet({ m, p, areas, busy, onYes, onClose }: { m: Member; p: Preset; areas: Area[]; busy: boolean; onYes: () => void; onClose: () => void }) {
  const levels = expandPreset(p.key, m, areas.map((a) => a.key));
  return (
    <ConfirmSheet
      title={`${p.label} for ${m.name}?`}
      body={
        <div className="flex flex-col gap-2">
          <span>{p.hint}</span>
          {levels ? (
            <div className="overflow-hidden rounded-[10px] border border-line">
              {areas.map((a) => (
                <div key={a.key} className="flex items-center gap-2 border-b border-line/70 px-3 py-1.5 text-[12.5px] last:border-b-0">
                  <span className="min-w-0 flex-1 text-ink-2">{a.label}</span>
                  <b className="text-ink">{levels[a.key] === 'inherit' ? `Inherit (${m.modules[a.key]?.ceiling ?? 'none'})` : word(levels[a.key] ?? 'inherit')}</b>
                </div>
              ))}
            </div>
          ) : null}
          <span className="text-[12px] text-ink-3">Every area is set at once. A level above what their role reaches is set to the most it reaches instead.</span>
        </div>
      }
      action="Apply"
      busy={busy}
      onYes={onYes}
      onClose={onClose}
    />
  );
}
