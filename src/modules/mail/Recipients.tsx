import { useEffect, useRef, useState } from 'react';
import { apiDelete, apiGet } from '../../core/api';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { UserPicture } from '../../components/UserPicture';
import { cx } from '../../components/ui';
import { parseAddresses } from './sanitize';

/**
 * To, Cc and Bcc as chips: each address a chip with its initials and name
 * (× takes it off), and what is being typed below, with suggestions from the
 * one recipient lookup the product has (`/contacts/lookup`: contacts,
 * colleagues, customers, vendors), your contact groups and the
 * organisation's distribution lists (ENH-MAIL-03 DMO-PPL-02). A contact
 * group is a personal list with no address of its own, so choosing it puts
 * its members in the field; a distribution list is an address and goes in
 * as one. The value stays the plain comma list the draft and the send
 * already use, so nothing downstream changes.
 *
 * worksuite-desktop#213: a chip carries the person's photo when the lookup
 * had one (initials otherwise), an address that is not one has a red
 * outline, and one outside the sender's own domains an amber outline and a
 * warning in its tooltip.
 */

export interface Suggestion {
  kind: string;
  id: string | number;
  name: string | null;
  email: string | null;
  subtitle?: string | null;
  /** A contact group's size (kind `group`). */
  members?: number;
  /** The person's picture, as the server hands it out (`/avatars/…`). */
  avatar?: string | null;
  photo_url?: string | null;
}

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export function isValidAddress(a: string): boolean {
  return EMAIL.test(a);
}

/** The address's domain, lower case ('' when it has none). */
export function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at < 0 ? '' : address.slice(at + 1).trim().toLowerCase();
}

/** Outside the sender's own domains: a valid address whose domain is none of `internal` (nothing is external when there are none). */
export function isExternal(address: string, internal: string[]): boolean {
  if (!internal.length || !EMAIL.test(address)) return false;
  const d = domainOf(address);
  return !internal.some((x) => x.toLowerCase() === d);
}

/** Pictures of people chosen from the suggestions, by address, for their chips (this window only). */
const pictures = new Map<string, string>();

export function initials(nameOrEmail: string): string {
  const base = nameOrEmail.includes('@') && !nameOrEmail.includes(' ') ? nameOrEmail.split('@')[0]!.replace(/[._-]+/g, ' ') : nameOrEmail;
  const words = base.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? (words[words.length - 1]![0] ?? '') : (words[0]?.[1] ?? ''))).toUpperCase() || '?';
}

/** "Name <a@b>" or a bare address → the address alone (the send endpoint takes addresses). */
export function addressOf(entry: string): string {
  const m = /<([^>]+)>/.exec(entry);
  return (m ? m[1]! : entry).trim();
}

export function RecipientField({ label, value, onChange, names, onName, autoFocus, placeholder, internal = [] }: { label: string; value: string; onChange: (v: string) => void; names: Record<string, string>; onName: (email: string, name: string) => void; autoFocus?: boolean; placeholder?: string; internal?: string[] }) {
  const list = parseAddresses(value);
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState<Suggestion[]>([]);
  const [pick, setPick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = `ws-recipients-${label.toLowerCase()}`;
  // Suggestions only while there is something to look up.
  const shown = typed.trim().length < 2 ? [] : found;

  useEffect(() => {
    const q = typed.trim();
    if (q.length < 2) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      // The people this person writes to come first (the server-kept autocomplete list, DMO-PPL-03), then the directory.
      const recent = apiGet<{ suggestions?: Array<{ email: string; name: string | null }> }>('/api/mail/autocomplete', { q, limit: 5 }, ctl.signal)
        .then((r) => (r?.suggestions ?? []).map((x): Suggestion => ({ kind: 'recent', id: x.email, name: x.name, email: x.email, subtitle: text('Recent') })))
        .catch(() => [] as Suggestion[]);
      const directory = apiGet<{ results?: Suggestion[] }>('/api/contacts/lookup', { q, kinds: 'contact,employee,customer,vendor,group,list', limit: 8 }, ctl.signal)
        .then((r) => r?.results ?? [])
        .catch(() => [] as Suggestion[]);
      void Promise.all([recent, directory]).then(([a, b]) => {
        if (ctl.signal.aborted) return;
        const taken = new Set(list.map((x) => x.toLowerCase()));
        const out: Suggestion[] = [];
        for (const s of [...a, ...b]) {
          if (s.kind === 'group') {
            if (s.members) out.push({ ...s, subtitle: text('Contact group · {n} people', { n: s.members }) });
            continue;
          }
          const e = s.email?.toLowerCase();
          if (!e || taken.has(e)) continue;
          taken.add(e);
          out.push(s);
        }
        setFound(out.slice(0, 8));
        setPick(0);
      });
    }, 200);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
    // `list` is read for filtering only; the lookup runs on what is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const add = (entries: string[]) => {
    const next = [...list];
    for (const e of entries) {
      const a = addressOf(e);
      if (a && !next.some((x) => x.toLowerCase() === a.toLowerCase())) next.push(a);
    }
    onChange(next.join(', '));
    setTyped('');
    setFound([]);
  };
  /** A contact group goes in as its members, each with their name. */
  const expandGroup = async (s: Suggestion) => {
    try {
      const r = await apiGet<{ members?: Array<{ name: string | null; email: string }> }>('/api/contacts/expand', { kind: 'group', id: s.id });
      const members = r?.members ?? [];
      for (const m of members) if (m.name) onName(m.email, m.name);
      if (members.length) add(members.map((m) => m.email));
      else setTyped('');
    } catch {
      // Left as typed, so nothing is lost.
    }
    input.current?.focus();
  };
  const choose = (s: Suggestion) => {
    if (s.kind === 'group') {
      void expandGroup(s);
      return;
    }
    if (!s.email) return;
    const picture = s.avatar ?? s.photo_url;
    if (picture) pictures.set(s.email.toLowerCase(), picture);
    if (s.name) onName(s.email, s.name);
    add([s.email]);
    input.current?.focus();
  };
  const remove = (a: string) => onChange(list.filter((x) => x !== a).join(', '));
  /** Out of the suggestions for good (DMO-PPL-03): the server forgets it, on every computer. */
  const forget = (s: Suggestion) => {
    setFound(found.filter((x) => x !== s));
    void apiDelete('/api/mail/autocomplete', { email: s.email }).catch(() => undefined);
  };
  const commit = () => {
    if (typed.trim()) add(parseAddresses(typed));
  };

  return (
    <span className="relative flex min-w-0 flex-1 flex-wrap items-center gap-1.5 py-1.5">
      {list.map((a) => {
        const name = names[a.toLowerCase()];
        const valid = EMAIL.test(a);
        const external = valid && isExternal(a, internal);
        const full = name ? `${name} <${a}>` : a;
        const tip = !valid ? text('{address} is not a valid email address', { address: a }) : external ? text('{who} is outside your organisation', { who: full }) : full;
        return (
          <span
            key={a}
            title={tip}
            data-recipient={a}
            data-invalid={!valid || undefined}
            data-external={external || undefined}
            className={cx('inline-flex h-7 max-w-[280px] items-center gap-1.5 rounded-full border pr-1 pl-0.5 text-[13px] font-semibold', !valid ? 'border-danger bg-danger-bg text-danger' : external ? 'border-warning bg-warning-bg text-ink' : 'border-line bg-subtle text-ink')}
          >
            {valid ? <UserPicture name={name ?? a} src={pictures.get(a.toLowerCase()) ?? null} size={24} className="shrink-0 text-[10px]" /> : <Icon name="warning" size={14} className="ml-1 shrink-0" />}
            <span className="truncate">{name ?? a}</span>
            {external ? <Icon name="globe" size={12} className="shrink-0 text-warning" label={text('Outside your organisation')} /> : null}
            {!valid ? <span className="sr-only">{text('Not a valid address')}</span> : null}
            <button type="button" aria-label={text('Remove {name}', { name: name ?? a })} onClick={() => remove(a)} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-surface hover:text-danger">
              <Icon name="x" size={12} />
            </button>
          </span>
        );
      })}
      <input
        ref={input}
        aria-label={label}
        role="combobox"
        aria-expanded={shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        value={typed}
        autoFocus={autoFocus}
        placeholder={list.length ? '' : placeholder}
        onChange={(e) => {
          const v = e.target.value;
          // A comma, semicolon or pasted list makes chips straight away.
          if (/[,;\n]/.test(v)) {
            const parts = v.split(/[,;\n]/);
            const rest = parts.pop() ?? '';
            add(parts);
            setTyped(rest.trimStart());
          } else setTyped(v);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (shown.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setPick((pick + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length);
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            // Sending with an address still being typed: it becomes a chip first.
            commit();
          } else if (e.key === 'Enter') {
            if (shown.length) {
              e.preventDefault();
              choose(shown[pick]!);
            } else if (typed.trim()) {
              e.preventDefault();
              commit();
            }
          } else if (e.key === 'Tab' && typed.trim()) {
            if (shown.length) choose(shown[pick]!);
            else commit();
          } else if (e.key === 'Escape' && shown.length) {
            e.stopPropagation();
            setFound([]);
          } else if (e.key === 'Backspace' && !typed && list.length) {
            remove(list[list.length - 1]!);
          }
        }}
        aria-invalid={list.some((a) => !EMAIL.test(a)) || undefined}
        className="bare-focus h-7 min-w-[140px] flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-3"
      />
      {shown.length ? (
        <ul id={listId} role="listbox" aria-label={text('Suggestions')} className="absolute top-full left-0 z-30 mt-1 w-[340px] max-w-full rounded-[10px] border border-line bg-surface p-1 shadow-xl">
          {shown.map((s, i) => (
            <li key={`${s.kind}-${s.id}`} role="option" aria-selected={i === pick} className="group relative">
              {s.kind === 'recent' ? (
                <button type="button" tabIndex={-1} aria-label={text('Remove {email} from suggestions', { email: s.email ?? '' })} title={text('Remove from suggestions')} onMouseDown={(e) => e.preventDefault()} onClick={() => forget(s)} className="absolute top-1/2 right-1.5 z-10 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-surface hover:text-danger focus:opacity-100">
                  <Icon name="x" size={12} />
                </button>
              ) : null}
              <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(s)} className={cx('flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left', i === pick ? 'bg-selection' : 'hover:bg-subtle')}>
                {s.kind === 'group' || s.kind === 'list' ? (
                  <span aria-hidden className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[var(--ws-on-primary)]">
                    <Icon name="users" size={13} />
                  </span>
                ) : (
                  <UserPicture name={s.name || s.email || ''} src={s.avatar ?? s.photo_url ?? null} size={28} className="shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">{s.name || s.email}</span>
                  <span className="block truncate text-[11.5px] text-ink-3">{[s.email, s.subtitle].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}
