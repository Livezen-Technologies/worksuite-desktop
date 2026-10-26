import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { useTabTitle } from '../../core/tab-context';
import { AdminNav } from './AdminNav';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import type { ModuleSettings } from '../../components/ModuleSettingsForm';
import { Select } from '../../components/Select';
import { ErrorNote, NumberField, Spinner, cx } from '../../components/ui';

/**
 * Admin Center › Chat › Ringing (WS-WCHAT design P-03, RING-UI-09; RING-01…08, RING-60, ESC-07): the organisation's
 * rules for who a website chat rings, and when. The design draws it in WorkSuite Desktop's own shell, under the
 * Settings rail and an "Admin Center" tab, so it is this app's screen; the rest of the Admin Center is the web app's,
 * and its other entries open there.
 *
 * The rules are the Chat module's settings (`/api/module-settings/communication`, the keys `Config/Settings.php`
 * declares), read and written as the web's settings screen does, so both always agree. Each person's tone and device are
 * their own, in Settings › Notifications & calls (P-01, P-02).
 */

export { ADMIN_RINGING_ROUTE } from './AdminNav';
const SLUG = 'communication';
const KEY = ['settings', 'admin', 'ringing'] as const;

/** The four ladder timings, in the design's order and words ("WHO IS RUNG, AND WHEN"). */
const LADDER = [
  { key: 'chat_widget_priority_after_seconds', label: 'Ring the rest of the priority agents after', fallback: '30' },
  { key: 'chat_widget_everyone_after_seconds', label: 'Ring everybody covering the widget after', fallback: '60' },
  { key: 'chat_widget_at_risk_after_seconds', label: 'Mark at risk — louder, supervisors told — after', fallback: '180' },
  { key: 'chat_widget_accept_within_seconds', label: "Pass an assigned chat on if its agent hasn't joined within", fallback: '60' },
] as const;
const GONE = 'chat_widget_ring_visitor_gone_seconds';
const OFFLINE = 'chat_widget_offline_ring';
const GONE_OPTIONS = [
  { value: '120', label: '2 minutes' },
  { value: '300', label: '5 minutes' },
  { value: '600', label: '10 minutes' },
];
const OFFLINE_OPTIONS = [
  { value: 'once', label: 'Alert once when someone comes online' },
  { value: 'until_joined', label: 'Ring until someone joins' },
];
const KEYS = [...LADDER.map((l) => l.key), GONE, OFFLINE];

/** A timing as the form holds it: whole seconds, 0–3600, or why not. */
export function secondsProblem(v: string): string | null {
  return /^\d{1,4}$/.test(v.trim()) && Number(v) <= 3600 ? null : 'Enter whole seconds from 0 to 3600.';
}

/**
 * What the server will ring by (ESC-07, `ChatEscalation::settle`): the rest of the priority agents never after
 * everybody, at risk never before everybody (0 still switches it off). Said beside a timing that will not apply as typed.
 */
export function settledNotes(v: Record<string, string>): Record<string, string> {
  const n = (k: string) => Math.max(0, Math.min(3600, Number(v[k]) || 0));
  const everyone = n('chat_widget_everyone_after_seconds');
  const out: Record<string, string> = {};
  if (n('chat_widget_priority_after_seconds') > everyone) out.chat_widget_priority_after_seconds = `Applies as ${everyone} seconds — the priority agents are never rung after everybody.`;
  const risk = n('chat_widget_at_risk_after_seconds');
  if (risk > 0 && risk < everyone) out.chat_widget_at_risk_after_seconds = `Applies as ${everyone} seconds — a chat is never at risk before everybody is rung.`;
  return out;
}

export function AdminRinging() {
  useTabTitle('Admin Center');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: ({ signal }) => apiGet<ModuleSettings>(`/api/module-settings/${SLUG}`, undefined, signal) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const saved = (k: string): string => {
    const v = q.data?.general[k]?.value;
    const field = q.data?.spec.general.find((f) => f.key === k);
    return v === null || v === undefined || v === '' ? String(field?.default ?? LADDER.find((l) => l.key === k)?.fallback ?? (k === GONE ? '120' : 'once')) : String(v);
  };
  const value = (k: string) => draft[k] ?? saved(k);
  const values = Object.fromEntries(KEYS.map((k) => [k, value(k)]));
  const changed = KEYS.filter((k) => k in draft && draft[k] !== saved(k));
  const problems = Object.fromEntries(LADDER.map((l) => [l.key, secondsProblem(value(l.key))]).filter(([, p]) => p !== null)) as Record<string, string>;
  const notes = settledNotes(values);
  const editable = !!q.data?.can_edit;
  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    if (!changed.length || Object.keys(problems).length) return;
    setBusy(true);
    try {
      await apiPut(`/api/module-settings/${SLUG}/general`, Object.fromEntries(changed.map((k) => [k, k === GONE || k === OFFLINE ? value(k) : String(Number(value(k)))])));
      toast('success', 'Ringing saved.');
      setDraft({});
      void qc.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const row = 'flex items-center gap-3 px-[18px] py-3';

  return (
    <div className="flex h-full min-h-0">
      <AdminNav here="ringing" />
      <main className="min-w-0 flex-1 overflow-y-auto px-10 py-6 scroll-thin">
        <div className="flex max-w-[840px] flex-col gap-3.5">
          <div>
            <h2 className="text-[20px] leading-tight font-bold text-ink">Website chat ringing</h2>
            <p className="mt-1.5 text-[14px] text-ink-2">Who is rung, and when. Each person picks their own tone and device.</p>
          </div>
          {/* The fixed rule (RING-01, RING-02): no ring time to set any more. */}
          <div className="flex items-center gap-3 rounded-[12px] border border-[#D5DBF7] bg-selection px-4 py-3 dark:border-primary/30">
            <Icon name="bell" size={22} className="shrink-0 text-primary" />
            <div>
              <div className="text-[14px] font-bold text-[#1B2570] dark:text-primary">Rings until someone joins</div>
              <div className="text-[12px] text-ink-2">Joining is accepting the chat, opening it, or replying. The ring then stops for everyone.</div>
            </div>
          </div>
          {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : (
            <>
              <section aria-labelledby="ring-who" className="rounded-[12px] border border-line bg-surface">
                <h3 id="ring-who" className="border-b border-line px-[18px] py-[11px] text-[11px] font-bold tracking-[1px] text-ink-3">WHO IS RUNG, AND WHEN</h3>
                {LADDER.map((l, i) => (
                  <div key={l.key} className={cx('flex flex-col', i < LADDER.length - 1 && 'border-b border-line')}>
                    <div className={row}>
                      <label htmlFor={l.key} className="flex-1 text-[14px] text-ink">{l.label}</label>
                      <NumberField
                        id={l.key}
                        size="sm"
                        width={70}
                        min={0}
                        max={3600}
                        value={value(l.key)}
                        disabled={!editable}
                        invalid={!!problems[l.key]}
                        aria-describedby={problems[l.key] || notes[l.key] ? `${l.key}-why` : undefined}
                        onValueChange={(v) => set(l.key, v)}
                      />
                      <span className="w-14 text-[13px] text-ink-3">seconds</span>
                    </div>
                    {problems[l.key] || notes[l.key] ? (
                      <p id={`${l.key}-why`} className={cx('-mt-1.5 px-[18px] pb-2.5 text-right text-[12px]', problems[l.key] ? 'text-danger' : 'text-[#9A4A06] dark:text-warning')}>{problems[l.key] ?? notes[l.key]}</p>
                    ) : null}
                  </div>
                ))}
              </section>
              <section aria-labelledby="ring-stop" className="rounded-[12px] border border-line bg-surface">
                <h3 id="ring-stop" className="border-b border-line px-[18px] py-[11px] text-[11px] font-bold tracking-[1px] text-ink-3">WHEN IT STOPS WITHOUT A JOIN</h3>
                <div className={cx(row, 'border-b border-line')}>
                  <div className="flex-1">
                    <div className="text-[14px] text-ink">Stop when the visitor has left the site for</div>
                    <div className="text-[12px] text-ink-3">The chat moves to Missed chats.</div>
                  </div>
                  <Select aria-label="Stop when the visitor has left the site for" value={value(GONE)} options={GONE_OPTIONS} disabled={!editable} onValueChange={(v) => set(GONE, v)} className="w-[140px]" />
                </div>
                <div className={row}>
                  <div className="flex-1">
                    <div className="text-[14px] text-ink">Offline enquiries</div>
                    <div className="text-[12px] text-ink-3">A visitor still on the site always rings until joined.</div>
                  </div>
                  <Select aria-label="Offline enquiries" value={value(OFFLINE)} options={OFFLINE_OPTIONS} disabled={!editable} onValueChange={(v) => set(OFFLINE, v)} className="w-[280px]" />
                </div>
              </section>
              {editable ? (
                <div className="flex justify-end gap-2.5">
                  <button type="button" disabled={busy} onClick={() => setDraft({})} className="h-9 rounded-[8px] border border-line bg-surface px-[18px] text-[13px] font-semibold text-ink hover:bg-subtle disabled:opacity-60">Cancel</button>
                  <button type="button" disabled={busy || !changed.length || Object.keys(problems).length > 0} onClick={() => void save()} className="h-9 rounded-[8px] bg-primary px-[18px] text-[13px] font-bold text-white hover:bg-primary-hover disabled:opacity-60">Save</button>
                </div>
              ) : (
                <p className="text-right text-[12px] text-ink-3">Only somebody who manages website chats can change these.</p>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
