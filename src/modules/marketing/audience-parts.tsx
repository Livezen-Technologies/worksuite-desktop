import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { apiGet } from '../../core/api';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Menu, type MenuItem } from '../../components/Menu';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import { COUNTRIES } from '../chat/website/live/countries';
import { refreshMarketing, withOrg } from './api';
import { btn, btnPrimary, btnSmall, input, n, Sheet, type PillTone } from './parts';
import { companiesWhere, refusal, type Can, type Channel, type Contact, type MarketingList, type Options, type Pair, type Segment } from './types';

/**
 * The Audience screens' shared pieces (Dashboard, Contacts, a contact,
 * organisations, lists, segments, import, consent, settings): the lists and
 * segments every picker offers, the consent words a contact is shown with, a
 * table's look, a pager, the confirm and reason sheets, the tabs, and the
 * search box. Everything here shows what the server said; nothing decides who
 * may be marketed to.
 */

/** The company's lists, in use or archived: for a filter, a picker, or the Lists screen itself. */
export function useLists(org: string, archived = false) {
  return useQuery({
    queryKey: ['marketing', 'lists', org, archived],
    queryFn: ({ signal }) => apiGet<{ items: MarketingList[] }>('/api/marketing/lists', withOrg(org, { archived: archived ? 1 : null }), signal),
  });
}

/** The segments' names, uncounted: counting each is a query over every contact, and a picker needs none of it. */
export function useSegmentNames(org: string) {
  return useQuery({
    queryKey: ['marketing', 'segments', org, 'brief'],
    queryFn: ({ signal }) => apiGet<{ items: Segment[] }>('/api/marketing/segments', withOrg(org, { brief: 1 }), signal),
  });
}

/** A value once it has stopped changing for a moment: a search per keystroke is a list that flickers. */
export function useDebounced<T extends string | number | boolean>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** The signed-in person's id, for "Me" in an owner picker. */
export function useMeId(): number | null {
  return useStore(app, (s) => (s.auth?.user?.id ? Number(s.auth.user.id) : null));
}

/**
 * The company a new record goes to before anybody chooses: the one the screen
 * is filtered to, or the only one the reader may do this in. Empty when there
 * is a real choice to make.
 */
export function firstCompany(options: Options, can: keyof Can, org: string): string {
  const makers = companiesWhere(options, can);
  const scoped = org.split(',').filter(Boolean).map(Number);
  const hit = scoped.length === 1 ? makers.find((c) => c.id === scoped[0]) : undefined;
  return String(hit?.id ?? (makers.length === 1 ? makers[0]!.id : ''));
}

/** Whether the reader may do this in one company, or (without one) in any. */
export function may(options: Options, can: keyof Can, orgId?: number): boolean {
  return options.companies.some((c) => Boolean(c.can[can]) && (orgId === undefined || c.id === orgId));
}

/** Everybody who may own a record in any of the reader's companies, once each, by name. */
export function everybody(options: Options): Pair[] {
  const seen = new Map<number, string>();
  options.companies.forEach((c) => c.people.forEach((p) => seen.set(p.id, p.name)));
  return [...seen].map(([id, name]) => ({ value: String(id), label: name })).sort((a, b) => a.label.localeCompare(b.label));
}

/** The company's name, for a Scope column across several. */
export function companyName(options: Options, orgId: number): string {
  return options.companies.find((c) => c.id === orgId)?.name ?? '—';
}

/** "hard_bounce" as the server words it, or as a sentence when it sent no words. */
export function reasonWord(options: Options, reason: string): string {
  return options.reasons.find((r) => r.value === reason)?.label ?? reason.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * What the server's consent and suppression say about emailing a contact, in
 * the design's words: Subscribed is the server's one definition — an address,
 * consent given, and not suppressed — so this pill, the "May be emailed"
 * figure and the segment rule cannot disagree.
 */
export function emailWord(c: Pick<Contact, 'email' | 'consent' | 'suppressed'>, options: Options): { tone: PillTone; label: string } {
  if (!c.email) return { tone: 'slate', label: 'No address' };
  const s = c.suppressed.find((x) => x.channel === 'email');
  if (s) {
    const word: Record<string, string> = { unsubscribed: 'Unsubscribed', hard_bounce: 'Bounced', complaint: 'Complained' };
    return { tone: 'red', label: word[s.reason] ?? reasonWord(options, s.reason) };
  }
  if (c.consent.email === 'granted') return { tone: 'green', label: 'Subscribed' };
  if (c.consent.email === 'withdrawn') return { tone: 'red', label: 'Withdrawn' };
  return { tone: 'amber', label: 'No consent' };
}

/** The same for calling them: a do-not-call outranks any consent. */
export function phoneWord(c: Pick<Contact, 'phone' | 'consent' | 'suppressed'>, options: Options): { tone: PillTone; label: string } {
  if (!c.phone) return { tone: 'slate', label: 'No number' };
  const s = c.suppressed.find((x) => x.channel === 'phone');
  if (s) return { tone: 'red', label: s.reason === 'do_not_call' ? 'Do not call' : reasonWord(options, s.reason) };
  if (c.consent.phone === 'granted') return { tone: 'green', label: 'Consented' };
  if (c.consent.phone === 'withdrawn') return { tone: 'red', label: 'Withdrawn' };
  return { tone: 'amber', label: 'No consent' };
}

export const CHANNELS: Channel[] = ['email', 'phone', 'whatsapp'];

/* A data table in the designs' look: uppercase headings on the ground, hairlines between rows. */
export const TABLE = 'w-full border-collapse text-left text-[13px]';
export const TH = 'border-b border-line bg-ground px-3 py-2 text-[11px] font-bold tracking-[.4px] whitespace-nowrap text-ink-3 uppercase';
export const TD = 'border-b border-line/70 px-3 py-2 align-middle text-ink';
/** A row that opens something: the pointer says so, and the name in it is the keyboard's way in. */
export const ROW_LINK = 'cursor-pointer hover:bg-subtle';

/** "Showing 1–50 of 4,812", and the two buttons that move a page. */
export function Pager({ page, per, total, onPage }: { page: number; per: number; total: number; onPage: (p: number) => void }) {
  const from = total === 0 ? 0 : (page - 1) * per + 1;
  const to = Math.min(total, page * per);
  return (
    <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 text-[12px] text-ink-3">
      <span className="min-w-0 flex-1" role="status">
        Showing {n(from)}–{n(to)} of {n(total)}
      </span>
      <button type="button" className={btnSmall} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <button type="button" className={btnSmall} disabled={to >= total} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  );
}

/** A question before something that cannot be taken back, in the designs' sheet. */
export function ConfirmSheet({ title, children, action, danger, busy, onYes, onClose }: { title: string; children: ReactNode; action: string; danger?: boolean; busy?: boolean; onYes: () => void; onClose: () => void }) {
  return (
    <Sheet
      title={title}
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={cx(btnPrimary, danger && '!bg-danger hover:opacity-90')} disabled={busy} onClick={onYes}>
            {busy ? 'Working…' : action}
          </button>
        </>
      }
    >
      <div className="text-[13px] leading-[1.55] text-ink-2">{children}</div>
    </Sheet>
  );
}

/**
 * An act that is recorded with a reason — lifting a suppression, recording
 * consent. The reason is the record of why, so when it is required the button
 * stays off until there is one of at least `min` characters.
 */
export function ReasonSheet({ title, intro, label, placeholder, action, min = 0, danger, busy, onSubmit, onClose }: {
  title: string;
  intro: ReactNode;
  label: string;
  placeholder?: string;
  action: string;
  min?: number;
  danger?: boolean;
  busy?: boolean;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const short = reason.trim().length < min;
  return (
    <Sheet
      title={title}
      width={460}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={cx(btnPrimary, danger && '!bg-danger hover:opacity-90')} disabled={busy || short} onClick={() => onSubmit(reason.trim())}>
            {busy ? 'Working…' : action}
          </button>
        </>
      }
    >
      <div className="text-[13px] leading-[1.55] text-ink-2">{intro}</div>
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
        {label}
        <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} rows={3} className={cx(input, '!h-auto resize-none py-2')} />
        {min > 0 ? <span className="text-[11.5px] font-medium text-ink-3">Required — at least {min} characters. It is kept with the record.</span> : null}
      </label>
    </Sheet>
  );
}

/**
 * The underlined tabs a page switches between (Timeline · Consent ledger ·
 * Campaigns · Calls). Arrow keys move between them, as the tab pattern asks.
 */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: Array<{ id: T; label: ReactNode }>; value: T; onChange: (t: T) => void; label: string }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + tabs.length) % tabs.length;
    onChange(tabs[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="flex shrink-0 gap-4 overflow-x-auto border-b border-line scroll-thin">
      {tabs.map((t, i) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => onChange(t.id)}
            className={cx('-mb-px h-9 shrink-0 border-b-2 text-[13px] font-semibold whitespace-nowrap', on ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink')}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** The search box of a list: an icon, a label for screen readers, and what to type. */
export function SearchField({ value, onChange, label, placeholder, className }: { value: string; onChange: (v: string) => void; label: string; placeholder: string; className?: string }) {
  return (
    <label className={cx('flex h-[34px] min-w-0 items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 focus-within:border-primary', className)}>
      <Icon name="search" size={14} className="shrink-0 text-ink-3" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} className="bare-focus min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3" />
      {value ? (
        <button type="button" aria-label="Clear the search" onClick={() => onChange('')} className="flex h-5 w-5 items-center justify-center rounded-full text-ink-3 hover:bg-subtle hover:text-ink">
          <Icon name="x" size={12} />
        </button>
      ) : null}
    </label>
  );
}

/** A button that opens a short menu of actions (a list's Rename, Copy, Archive…). */
export function MoreMenu({ label, items, children, className }: { label: string; items: MenuItem[]; children?: ReactNode; className?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={ref} type="button" aria-label={children ? undefined : label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(true)} className={className ?? cx(btnSmall, 'w-[30px] justify-center px-0')}>
        {children ?? <Icon name="more" size={15} />}
      </button>
      {open ? <Menu label={label} anchor={ref} prefer="bottom" align="end" onClose={() => setOpen(false)} sections={[{ id: 'acts', items }]} /> : null}
    </>
  );
}

const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.code, label: c.name, hint: c.code }));

/** A country by its ISO code, chosen by name. */
export function CountrySelect({ value, onChange, label, empty = 'No country' }: { value: string; onChange: (code: string) => void; label: string; empty?: string }) {
  return <Select<string> aria-label={label} searchable value={value} onValueChange={onChange} options={[{ value: '', label: empty }, ...COUNTRY_OPTIONS]} className={input} />;
}

/** The country's name for its code, or the code when it is not one we know. */
export function countryName(code: string): string {
  return COUNTRIES.find((c) => c.code === code.toUpperCase())?.name ?? code;
}

/**
 * Send a change, say what the server said about it, and refresh every
 * Marketing figure it could move. Answers whether it went through.
 */
export async function act(run: () => Promise<{ message: string | null }>, fallback: string): Promise<boolean> {
  try {
    const r = await run();
    toast('success', r.message ?? fallback);
    await refreshMarketing();
    return true;
  } catch (e) {
    toast('error', refusal(e));
    return false;
  }
}

/** A refusal shown where the thing that failed would have been. */
export function Refused({ error, onRetry, fallback }: { error: unknown; onRetry?: () => void; fallback?: string }) {
  return (
    <div role="alert" className="flex items-center gap-2 rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
      <Icon name="alert" size={15} />
      <span className="flex-1">{refusal(error, fallback)}</span>
      {onRetry ? (
        <button type="button" className="font-semibold underline" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
