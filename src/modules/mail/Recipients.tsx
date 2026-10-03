import { useEffect, useRef, useState } from 'react';
import { apiDelete, apiGet } from '../../core/api';
import { text } from '../../core/i18n';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { parseAddresses } from './sanitize';

/**
 * To, Cc and Bcc as chips: each address a chip with its initials and name
 * (× takes it off), and what is being typed below, with suggestions from the
 * one recipient lookup the product has (`/contacts/lookup`: contacts,
 * colleagues, customers, vendors). The value stays the plain comma list the
 * draft and the send already use, so nothing downstream changes.
 */

export interface Suggestion {
  kind: string;
  id: string | number;
  name: string | null;
  email: string | null;
  subtitle?: string | null;
}

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

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

export function RecipientField({ label, value, onChange, names, onName, autoFocus, placeholder }: { label: string; value: string; onChange: (v: string) => void; names: Record<string, string>; onName: (email: string, name: string) => void; autoFocus?: boolean; placeholder?: string }) {
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
      const directory = apiGet<{ results?: Suggestion[] }>('/api/contacts/lookup', { q, kinds: 'contact,employee,customer,vendor', limit: 8 }, ctl.signal)
        .then((r) => r?.results ?? [])
        .catch(() => [] as Suggestion[]);
      void Promise.all([recent, directory]).then(([a, b]) => {
        if (ctl.signal.aborted) return;
        const taken = new Set(list.map((x) => x.toLowerCase()));
        const out: Suggestion[] = [];
        for (const s of [...a, ...b]) {
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
  const choose = (s: Suggestion) => {
    if (!s.email) return;
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
        return (
          <span key={a} title={name ? `${name} <${a}>` : a} className={cx('inline-flex h-7 max-w-[280px] items-center gap-1.5 rounded-full border pr-1 pl-0.5 text-[13px] font-semibold', valid ? 'border-line bg-subtle text-ink' : 'border-danger bg-danger-bg text-danger')}>
            <span aria-hidden className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-[var(--ws-on-primary)]">{initials(name ?? a)}</span>
            <span className="truncate">{name ?? a}</span>
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
                <span aria-hidden className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-[var(--ws-on-primary)]">{initials(s.name || s.email || '')}</span>
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
