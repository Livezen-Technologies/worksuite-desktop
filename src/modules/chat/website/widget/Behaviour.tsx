import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { ApiError } from '../../../../core/api';
import { errorMessage } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { toast } from '../../../../core/toasts';
import { Select } from '../../../../components/Select';
import { Empty, ErrorNote, Spinner, Switch, TextField, cx } from '../../../../components/ui';
import { Note, SettingRow } from '../../../account/parts';
import {
  GUIDES,
  MAX_MINUTES,
  PAGES,
  RULES,
  STALE_SECONDS,
  behaviourOf,
  behaviourProblems,
  changedBehaviour,
  domainOf,
  notADomain,
  saveBehaviour,
  seenText,
  snippetLines,
  type BehaviourPayload,
  type BehaviourSettings,
  type Seen,
} from './behaviourSettings';
import { Group } from './parts';
import { IdentitySection } from './IdentitySettings';

/**
 * Widget settings › Behaviour and Embed code (S-03; WS-WCHAT X-UI-16, UX-SET-04, UX-SET-05).
 *
 * BEHAVIOUR is the design's two cards and the domains — NEW CHATS (who gets a new chat, ask for contact details after,
 * count as missed after, go inactive after), VISITOR ALERTS (tell agents when somebody is browsing, and the pages
 * before they count as reading) and Allowed domains — beside the EMBED CODE card with Copy and the install check, and
 * the Install guides. The Embed code tab is that right-hand column on its own.
 *
 * Behaviour saves from the editor's header (Cancel and Save), so its state lives in `useBehaviour()`, which the editor
 * holds; only what was changed is sent (`PUT widgets/{id}/behaviour`).
 */

export type BehaviourState = ReturnType<typeof useBehaviour>;

export function useBehaviour(id: number) {
  const qc = useQueryClient();
  const key = ['website', 'widget-behaviour', id];
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => behaviourOf(id, signal), retry: false });
  const [draft, setDraft] = useState<BehaviourSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = q.data?.settings ?? null;
  const settings = draft ?? saved;
  const changes = saved && settings ? changedBehaviour(saved, settings) : {};
  const issues = settings ? behaviourProblems(settings) : {};
  const dirty = Object.keys(changes).length > 0;
  const blocked = Object.keys(issues).length > 0;
  // A server from before S-03 has no such page: the tab says so, and Embed code keeps the widgets list's snippet.
  const missing = q.error instanceof ApiError && q.error.status === 404;

  const set = <K extends keyof BehaviourSettings>(k: K, v: BehaviourSettings[K]) =>
    setDraft((d) => {
      const base = d ?? saved;
      return base ? { ...base, [k]: v } : d;
    });
  const undo = () => setDraft(null);
  const save = async () => {
    if (!dirty || blocked) return;
    setBusy(true);
    try {
      const fresh = await saveBehaviour(id, changes);
      qc.setQueryData<BehaviourPayload>(key, fresh);
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['website', 'widgets'] });
      void qc.invalidateQueries({ queryKey: ['website', 'widget-design', id] });
      toast('success', text('Widget saved — visitors see it on their next page'));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return { q, settings, set, undo, save, dirty, blocked, busy, issues, missing, can: Boolean(q.data?.can_manage) };
}

/** A settings row whose hint carries the field's problem under the design's words. */
function Row({ label, hint, problem, children }: { label: string; hint?: string; problem?: string; children: ReactNode }) {
  return (
    <SettingRow
      label={label}
      hint={
        hint || problem ? (
          <>
            {hint}
            {problem ? <span role="alert" className={cx('block text-danger', hint && 'mt-0.5')}>{problem}</span> : null}
          </>
        ) : undefined
      }
    >
      {children}
    </SettingRow>
  );
}

/** A number of minutes or pages in the design's 90px box; 0 shows as Off where 0 switches it off. */
function Count({ label, value, onChange, off, min, max, invalid, disabled }: { label: string; value: number; onChange: (v: number) => void; off?: boolean; min: number; max: number; invalid: boolean; disabled?: boolean }) {
  return (
    <TextField
      aria-label={label}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      disabled={disabled}
      placeholder={off ? 'Off' : undefined}
      value={off && value === 0 ? '' : Number.isFinite(value) ? String(value) : ''}
      onChange={(e) => onChange(e.target.value === '' ? (off ? 0 : Number.NaN) : Number(e.target.value))}
      error={invalid}
      className="w-[90px]"
    />
  );
}

/** Behaviour (S-03): the rules on the left and, beside them, the embed code and the install guides. */
export function BehaviourTab({ b, site, fallbackCode }: { b: BehaviourState; site: string; fallbackCode: string | null }) {
  if (b.q.isLoading) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  if (b.missing) {
    return (
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex min-w-0 flex-1"><Empty icon="settings" title="Not on this server yet" hint="Update WorkSuite's Communication module to set the widget's behaviour here." /></div>
        <EmbedColumn code={fallbackCode} seen={undefined} site={site} />
      </div>
    );
  }
  if (b.q.error || !b.q.data || !b.settings) return <div className="flex-1 p-6"><ErrorNote error={b.q.error} onRetry={() => void b.q.refetch()} /></div>;

  const s = b.settings;
  const p = b.q.data;
  const rule = RULES.find((r) => r.value === s.assignment_rule) ?? RULES[0]!;
  const alertsOn = s.visitor_alerts !== 'off';

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <form
        aria-label="Behaviour"
        onSubmit={(e) => {
          e.preventDefault();
          void b.save();
        }}
        className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto pb-4 scroll-thin"
      >
        {!b.can ? <Note>You can look at these settings. Changing them needs the “Create and configure chat widgets” permission.</Note> : null}
        <fieldset disabled={!b.can || b.busy} className="flex min-w-0 flex-col gap-3">
          <Group title="New chats">
            <Row label="Who gets a new chat" hint={rule.hint}>
              <Select aria-label="Who gets a new chat" className="w-[260px]" value={s.assignment_rule} onValueChange={(v) => b.set('assignment_rule', v)} options={RULES.map((r) => ({ value: r.value, label: r.label }))} />
            </Row>
            {s.assignment_rule === 'manual' ? (
              <Row label="Who gets every new chat" problem={b.issues.default_agent_id}>
                <Select
                  aria-label="Who gets every new chat"
                  className="w-[260px]"
                  placeholder="Choose a person"
                  value={s.default_agent_id}
                  onValueChange={(v) => b.set('default_agent_id', v)}
                  options={p.people.map((m) => ({ value: m.id, label: m.name }))}
                />
              </Row>
            ) : null}
            <Row label="Ask for contact details after (minutes)" hint="If nobody has replied yet, the widget asks for name and email." problem={b.issues.ask_details_after_minutes}>
              <Count label="Ask for contact details after (minutes)" off min={0} max={MAX_MINUTES} value={s.ask_details_after_minutes} onChange={(v) => b.set('ask_details_after_minutes', v)} invalid={Boolean(b.issues.ask_details_after_minutes)} />
            </Row>
            <Row label="Count as missed after (minutes)" hint="A visitor who leaves unanswered this long goes to Missed chats." problem={b.issues.missed_after_minutes}>
              <Count label="Count as missed after (minutes)" off min={0} max={MAX_MINUTES} value={s.missed_after_minutes} onChange={(v) => b.set('missed_after_minutes', v)} invalid={Boolean(b.issues.missed_after_minutes)} />
            </Row>
            <Row label="Go inactive after (minutes)" hint="Quiet chats close on their own." problem={b.issues.inactive_after_minutes}>
              <Count label="Go inactive after (minutes)" off min={0} max={MAX_MINUTES} value={s.inactive_after_minutes} onChange={(v) => b.set('inactive_after_minutes', v)} invalid={Boolean(b.issues.inactive_after_minutes)} />
            </Row>
          </Group>

          <Group title="Visitor alerts">
            <BrowsingRow on={alertsOn} onChange={(v) => b.set('visitor_alerts', v ? (p.settings.visitor_alerts === 'all' ? 'all' : 'engaged') : 'off')} />
            <Row label="Pages before they count as reading" hint={s.visitor_alerts === 'all' ? 'Every visitor is announced as they arrive, whatever they read.' : undefined} problem={b.issues.visitor_alert_pages}>
              <Count label="Pages before they count as reading" min={PAGES[0]} max={PAGES[1]} value={s.visitor_alert_pages} onChange={(v) => b.set('visitor_alert_pages', v)} invalid={Boolean(b.issues.visitor_alert_pages)} disabled={s.visitor_alerts !== 'engaged'} />
            </Row>
          </Group>

          <Domains value={s.allowed_domains} onChange={(v) => b.set('allowed_domains', v)} />
        </fieldset>
      </form>
      <EmbedColumn code={p.embed_code} seen={p.seen} site={site} />
    </div>
  );
}

function BrowsingRow({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const hid = useId();
  return (
    <SettingRow label="Tell agents when somebody is browsing" hint={<span id={hid}>A quiet card for a visitor who is reading closely.</span>}>
      <Switch label="Tell agents when somebody is browsing" describedBy={hid} checked={on} onChange={onChange} />
    </SettingRow>
  );
}

/** Allowed domains (WGT-18): a chip per host, × to take it off, and a field to add one. */
function Domains({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const lid = useId();
  const hid = useId();

  // Everything typed, split as the server splits it; nothing is added while any of it is not a domain.
  const add = () => {
    const parts = typed.split(/[\s,]+/).filter(Boolean);
    if (!parts.length) return;
    const bad = parts.find((x) => domainOf(x) === null);
    if (bad !== undefined) {
      setProblem(notADomain(bad));
      return;
    }
    onChange([...new Set([...value, ...parts.map((x) => domainOf(x)!)])]);
    setTyped('');
    setProblem(null);
  };

  return (
    <div role="group" aria-labelledby={lid} className="flex flex-col gap-1.5 rounded-[12px] border border-line bg-surface px-4 py-3">
      <span id={lid} className="text-[13px] font-semibold text-ink">Allowed domains</span>
      <div className={cx('flex flex-wrap items-center gap-1.5 rounded-[8px] border p-1.5', problem ? 'border-danger' : 'border-line')}>
        {value.map((d) => (
          <span key={d} className="inline-flex items-center gap-1 rounded-[6px] bg-selection px-2 py-[3px] text-[12px] font-semibold text-primary">
            {d}
            <button type="button" aria-label={text('Remove {d}', { d })} onClick={() => onChange(value.filter((x) => x !== d))} className="leading-none hover:text-ink">×</button>
          </span>
        ))}
        <input
          aria-label="Add a domain"
          aria-describedby={hid}
          aria-invalid={problem ? true : undefined}
          value={typed}
          placeholder="Add a domain…"
          onChange={(e) => {
            setTyped(e.target.value);
            setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            } else if (e.key === 'Backspace' && !typed && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={add}
          className="h-6 min-w-[140px] flex-1 bg-transparent px-1 text-[12.5px] text-ink outline-none placeholder:text-ink-3"
        />
      </div>
      {problem ? <span role="alert" className="text-[12px] text-danger">{problem}</span> : null}
      <span id={hid} className="text-[11.5px] text-ink-3">
        The widget refuses to load on any other site.
        {value.length === 0 ? <span className="block text-warning">With no domains, it loads on no site at all.</span> : null}
      </span>
    </div>
  );
}

/**
 * The design's right-hand column: EMBED CODE with Copy, the line to paste it by and the install check, and the
 * Install guides. The Embed code tab is this column on its own; `seen` undefined is a server that cannot tell.
 */
export function EmbedColumn({ code, seen, site, wide }: { code: string | null; seen: Seen | null | undefined; site: string; wide?: boolean }) {
  const copy = () => void navigator.clipboard?.writeText(code ?? '').then(() => toast('success', text('Embed code copied.')));
  const fresh = seen ? seen.seconds_ago < STALE_SECONDS : false;
  return (
    <div className={cx('flex shrink-0 flex-col gap-3 overflow-y-auto pb-4 scroll-thin', wide ? 'w-full max-w-[560px]' : 'w-[400px]')}>
      <section className="flex flex-col gap-2.5 rounded-[12px] bg-[#111b3b] px-4 py-3.5 text-[#f1f4fb]">
        <div className="flex items-center">
          <h2 className="flex-1 text-[14px] font-bold">Embed code</h2>
          <button type="button" disabled={!code} onClick={copy} className="h-7 rounded-[7px] border border-[#3a4468] px-2.5 text-[12px] font-semibold text-[#f1f4fb] hover:bg-white/10 disabled:opacity-50">
            Copy
          </button>
        </div>
        <p className="text-[12px] text-[#9aa3c4]">{text('Paste before </body> on every page of {site}.', { site })}</p>
        <pre aria-label="Embed code" className="rounded-[8px] bg-[#0b1430] px-3 py-2.5 font-mono text-[11.5px] leading-[1.6] break-all whitespace-pre-wrap text-[#dfe3f0]">{code ? snippetLines(code) : '—'}</pre>
        {seen !== undefined ? (
          <p role="status" aria-label="Install check" className={cx('flex items-center gap-2 text-[12px]', fresh ? 'text-[#8fe0b5]' : 'text-[#9aa3c4]')}>
            <span aria-hidden className={cx('h-[7px] w-[7px] shrink-0 rounded-full', fresh ? 'bg-[#2f9e67]' : seen ? 'bg-[#e8a33d]' : 'bg-[#5a6488]')} />
            {seenText(seen, site)}
          </p>
        ) : null}
      </section>
      <InstallGuides />
    </div>
  );
}

/** WordPress, Shopify and Tag Manager (UX-SET-05): each opens to its steps. */
function InstallGuides() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section aria-labelledby="widget-guides-title" className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface px-4 py-3.5 text-[12.5px]">
      <h2 id="widget-guides-title" className="text-[14px] font-bold text-ink">Install guides</h2>
      {GUIDES.map((g) => (
        <div key={g.id} className="flex flex-col gap-1">
          <button type="button" aria-expanded={open === g.id} aria-controls={`guide-${g.id}`} onClick={() => setOpen(open === g.id ? null : g.id)} className="self-start text-left font-semibold text-primary hover:underline">
            {g.title}
          </button>
          {open === g.id ? (
            <ol id={`guide-${g.id}`} className="ml-4 list-decimal text-ink-2">
              {g.steps.map((x) => <li key={x}>{x}</li>)}
            </ol>
          ) : null}
        </div>
      ))}
      <p className="text-ink-3">The script is small, loads after the page, and fails silently if WorkSuite cannot be reached.</p>
    </section>
  );
}

/** Embed code (S-03): the design's column, from the Behaviour page when the server has it, else the widgets list's snippet. */
export function EmbedTab({ b, site, fallbackCode, widgetId }: { b: BehaviourState; site: string; fallbackCode: string | null; widgetId?: number }) {
  if (b.q.isLoading) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  return (
    <div className="flex min-h-0 flex-1 gap-4 overflow-y-auto scroll-thin">
      <EmbedColumn code={b.q.data?.embed_code ?? fallbackCode} seen={b.q.data ? b.q.data.seen : undefined} site={site} wide />
      {/* Returning visitors (#222): their settings and the developer guide for identify(), beside the snippet. */}
      {widgetId ? <div className="w-[420px] shrink-0 pb-4"><IdentitySection widgetId={widgetId} /></div> : null}
    </div>
  );
}
