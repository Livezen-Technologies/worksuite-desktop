import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useCanOpen } from '../../core/access';
import { app } from '../../core/app-state';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Avatar, Button, ErrorNote, Spinner, Switch, avatarTone, cx, initials } from '../../components/ui';
import type { ItemAccess, Level } from './api';
import type { Item } from './ctx';
import { PopMenu, below, type MenuAt, type MenuItem } from './Menu';
import {
  KIND,
  LEVEL_LABEL,
  generalAction,
  generalOf,
  generalOptions,
  grantRequests,
  nextActive,
  offered,
  resultsOf,
  sharedSummary,
  type General,
  type PType,
  type Principal,
  type Results,
  type ShareResult,
} from './sharing';

interface Grant {
  id: number;
  principal: Principal;
  level: Level;
  effect: 'allow' | 'deny';
  can_download: boolean;
  expires_at: string | null;
  editable: boolean;
}
interface Inherited {
  id: number | null;
  via: 'folder' | 'folder_owner';
  from: { id: number; name: string };
  principal: Principal;
  level: Level;
  effect: 'allow' | 'deny';
}
interface AccessInfo {
  item: { type: 'file' | 'folder'; id: number; name: string; owner: { id: number; name: string; detail: string | null } | null; company: { id: number; name: string } | null; inherits: boolean; shareable: boolean };
  my_access: ItemAccess;
  may: { share: boolean; manage: boolean };
  grants: Grant[] | null;
  inherited: Inherited[] | null;
  public_links: { active: number; shares: number; download_links: number; protected: number; never_expire: number; next_expiry: string | null } | null;
  /** What Chat and Email start as: the organisation's Drive settings (worksuite-desktop#164). */
  notify_defaults?: { chat: boolean; email: boolean };
  /** Restricted, anyone at the company with the link, or anyone with the link (worksuite-desktop#329). */
  general?: { access: General; level: Level | null; grant_id: number | null } | null;
  /** The levels this server knows, lowest first. */
  levels?: Level[];
}
interface Effective {
  person: { id: number; name: string; detail: string | null };
  level: Level;
  via: string;
  can_download: boolean;
  because: Array<{ text: string }>;
}

type Menu =
  | { kind: 'level'; at: MenuAt }
  | { kind: 'row'; at: MenuAt; grant: Grant }
  | { kind: 'general'; at: MenuAt }
  | { kind: 'org-level'; at: MenuAt };

/** A person's avatar, or a team's, department's, role's or company's tile. */
function Who({ p, size = 34 }: { p: Pick<Principal, 'type' | 'name'>; size?: number }) {
  if (p.type === 'user') return <Avatar name={p.name} size={size} />;
  return (
    <span aria-hidden className={cx('inline-flex shrink-0 items-center justify-center rounded-[9px] font-bold', avatarTone(p.name))} style={{ width: size, height: size, fontSize: Math.max(10, size * 0.34) }}>
      {p.type === 'organization' ? <Icon name="building" size={Math.round(size * 0.5)} /> : initials(p.name)}
    </span>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const SECTION = 'text-[11.5px] font-bold tracking-[0.06em] text-ink-3 uppercase';

/**
 * Share (worksuite-desktop#329): one search box for people, teams, departments,
 * roles and companies; the chosen ones as chips, given one level and told by
 * chat and/or email; who has access in one list, with the inherited access as a
 * switch; and General access. The server decides everything; this shows what it
 * answers.
 *
 * Opened as before — `item`, `onClose`, `onSecureLink`, `onPublicLink`,
 * `onSendToChat` — so Files, its sidebar and Office open it unchanged.
 */
export function ShareDialog({ item, onClose, onSecureLink, onPublicLink, onSendToChat }: { item: Item; onClose: () => void; onSecureLink: () => void; onPublicLink: () => void; onSendToChat: () => void }) {
  const qc = useQueryClient();
  const chat = useCanOpen('chat');
  const origin = app.get().auth?.server?.origin ?? '';
  const base = `/api/drive/access/${item.type}/${item.f.id}`;
  const key = ['files', 'access', item.type, item.f.id];
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => apiGet<AccessInfo>(base, undefined, signal) });
  const a = q.data;

  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [chosen, setChosen] = useState<ShareResult[]>([]);
  const [level, setLevel] = useState<Level>('edit');
  const [byChat, setByChat] = useState<boolean | null>(null);
  const [byEmail, setByEmail] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [justShared, setJustShared] = useState('');
  const [copied, setCopied] = useState(false);
  const [effective, setEffective] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);

  const search = useDebounced(term.trim(), 180);
  const found = useQuery({
    queryKey: ['files', 'principals', item.type, item.f.id, search],
    queryFn: ({ signal }) => apiGet<Results>(`${base}/principals`, { q: search }, signal),
    enabled: search.length >= 2,
  });
  const eff = useQuery({ queryKey: ['files', 'effective', item.type, item.f.id], queryFn: ({ signal }) => apiGet<{ people: Effective[]; refused: Effective[]; truncated: boolean }>(`${base}/effective`, undefined, signal), enabled: effective });

  const results = resultsOf(found.data, chosen);
  const showList = open && term.trim().length >= 2 && (search === term.trim() || !!found.data);
  const levels = offered(item.type, a?.levels);
  const chatOn = chat && (byChat ?? a?.notify_defaults?.chat ?? true);
  const emailOn = byEmail ?? a?.notify_defaults?.email ?? true;
  const general = a ? generalOf(a) : { access: 'restricted' as General, level: null, grantId: null };
  const company = a?.item.company?.name ?? null;

  const ids = useId();
  const listId = `${ids}-list`;
  const optId = (r: ShareResult) => `${ids}-opt-${r.key.replace(':', '-')}`;
  const input = useRef<HTMLInputElement>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['files', 'list'] });
  };
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast('success', done);
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const add = (r: ShareResult | undefined) => {
    if (!r || !r.can_share) return;
    setChosen((c) => (c.some((x) => x.key === r.key) ? c : [...c, r]));
    setTerm('');
    setActive(-1);
    setJustShared('');
    input.current?.focus();
  };
  const remove = (k: string) => setChosen((c) => c.filter((x) => x.key !== k));

  const share = async () => {
    if (!chosen.length || busy) return;
    setBusy(true);
    const notify = { chat: chatOn, email: emailOn, message: note };
    const bodies = grantRequests(chosen, level, notify);
    const done: ShareResult[] = [];
    const failed: ShareResult[] = [];
    for (let i = 0; i < bodies.length; i++) {
      try {
        await apiPost(`${base}/grants`, bodies[i]);
        done.push(chosen[i]!);
      } catch (e) {
        failed.push(chosen[i]!);
        toast('error', `${chosen[i]!.name}: ${errorMessage(e)}`);
      }
    }
    setBusy(false);
    setChosen(failed);
    if (done.length) {
      setJustShared(sharedSummary(done, level, notify));
      if (!failed.length) setNote('');
      refresh();
    }
  };

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => nextActive(results.length, i, e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter') {
      if (showList && active >= 0) {
        e.preventDefault();
        add(results[active]);
      }
    } else if (e.key === 'Backspace') {
      if (term === '' && chosen.length) {
        e.preventDefault();
        remove(chosen[chosen.length - 1]!.key);
      }
    } else if (e.key === 'Escape') {
      // The list closes first; the dialog on the next Esc.
      if (showList || term) {
        e.preventDefault();
        e.stopPropagation();
        if (showList) setOpen(false);
        else setTerm('');
        setActive(-1);
      }
    }
  };

  const setGeneral = (to: General, lvl?: Level) => {
    const act = generalAction(general.access, to, lvl ?? general.level ?? 'view');
    if (act.kind === 'link') return onPublicLink();
    if (act.kind === 'none' && !lvl) return;
    const body = act.kind === 'put' ? act.body : { access: 'org' as const, level: lvl };
    void run(async () => {
      const r = await apiPut<{ links_closed?: number; links_left?: number }>(`${base}/general`, body);
      const left = r?.links_left ?? 0;
      toast(
        'success',
        body.access === 'restricted'
          ? `Only people and groups added can open it${left ? ` · ${left} public link${left === 1 ? '' : 's'} made by others still work` : ''}`
          : `Anyone at ${company ?? 'the company'} with the link ${LEVEL_LABEL[body.level ?? 'view'].toLowerCase()}`,
      );
    });
  };

  const copy = () =>
    void navigator.clipboard.writeText(webLink).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      (e: unknown) => toast('error', errorMessage(e)),
    );

  const allowed = (a?.grants ?? []).filter((g) => g.effect === 'allow' && !(general.access === 'org' && g.id === general.grantId));
  const refused = (a?.grants ?? []).filter((g) => g.effect === 'deny');
  const inherited = (a?.inherited ?? []).filter((g) => g.effect === 'allow');
  const inheritedRefused = (a?.inherited ?? []).filter((g) => g.effect === 'deny');
  const above = item.type === 'file' ? (item.f.folder_id ? item.f.folder_name : 'My Drive') : item.f.parent_id ? (inherited[0]?.from.name ?? 'the folder above') : 'My Drive';
  const showInherit = !!a && (item.type === 'folder' || inherited.length > 0 || !a.item.inherits);
  const count = (a?.item.owner ? 1 : 0) + allowed.length + inherited.length;
  const noun = item.type === 'folder' ? `Folder · ${item.f.file_count} file${item.f.file_count === 1 ? '' : 's'}` : 'File';
  const webLink = `${origin}/files?${item.type === 'folder' ? `folder=${item.f.id}` : `file=${item.f.id}`}`;
  const gOpts = generalOptions(company);
  const g = gOpts.find((o) => o.id === general.access)!;
  const owner = !!a?.my_access.owner;

  // Escape closes it wherever the keyboard is (over a document, it was in the editor until a moment ago), and the
  // dialog takes the keyboard when it opens (worksuite-desktop#42).
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!box.current?.contains(document.activeElement)) box.current?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close.current();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  const levelItems = (current: Level, pick: (l: Level) => void, only = levels): MenuItem[] => only.map((l) => ({ label: l.label, hint: l.help, checked: l.id === current, run: () => pick(l.id) }));

  return (
    <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-stage/50 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="shTitle" className="animate-in flex max-h-full w-[720px] max-w-full flex-col rounded-[16px] border border-line bg-surface text-[13px] text-ink shadow-2xl outline-none">
        <div className="flex items-center gap-3.5 px-6 pt-5 pb-4">
          <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]', item.type === 'folder' ? 'bg-warning-bg text-warning' : 'bg-selection text-primary')}>
            <Icon name={item.type === 'folder' ? 'folder' : 'file'} size={20} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h1 id="shTitle" className="truncate text-[18px] font-bold text-ink">Share “{item.f.name}”</h1>
            <span className="truncate text-[13px] text-ink-3">{noun}{company ? ` · ${company}` : ''}</span>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] text-ink-2 hover:bg-subtle">
            <Icon name="x" size={16} />
          </button>
        </div>

        {q.isLoading ? <Spinner /> : null}
        {q.error ? <div className="px-6 pb-5"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : null}
        {a && !a.may.share ? (
          <p className="px-6 pb-5 text-ink-2">You can’t share this. Your access: {a.my_access.owner ? 'owner' : LEVEL_LABEL[a.my_access.level ?? 'view']}.{a.my_access.reason ? ` ${a.my_access.reason}` : ''}</p>
        ) : null}

        {a && a.may.share && effective ? (
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-6 py-4 scroll-thin">
            <div className="mb-2 flex items-center justify-between">
              <h2 className={SECTION}>Who can open it, and why</h2>
              <button type="button" onClick={() => setEffective(false)} className="text-[13px] font-semibold text-primary hover:underline">Back to sharing</button>
            </div>
            {eff.isLoading ? <Spinner /> : null}
            {(eff.data?.people ?? []).map((p) => (
              <div key={p.person.id} className="flex items-start gap-3 border-b border-line/70 py-2">
                <Avatar name={p.person.name} size={30} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="text-ink">{p.person.name}</b>
                  <span className="text-[12px] text-ink-3">{p.because.map((b) => b.text).join(' · ')}</span>
                </span>
                <span className="font-semibold text-ink-2">{LEVEL_LABEL[p.level]}{p.can_download ? '' : ' · no download'}</span>
              </div>
            ))}
            {eff.data?.refused.length ? <h2 className={cx(SECTION, 'mt-3 mb-2 text-danger')}>Refused</h2> : null}
            {(eff.data?.refused ?? []).map((p) => (
              <div key={p.person.id} className="flex items-center gap-3 py-1.5">
                <Avatar name={p.person.name} size={30} />
                <b className="flex-1 text-ink">{p.person.name}</b>
                <span className="text-[12px] text-ink-3">{p.because.map((b) => b.text).join(' · ')}</span>
              </div>
            ))}
            {eff.data?.truncated ? <p className="mt-2 text-[12px] text-ink-3">The first 150 people are shown.</p> : null}
          </div>
        ) : null}

        {a && a.may.share && !effective ? (
          <>
            <div className="flex flex-col gap-3 px-6 pb-[18px]">
              <div className="flex items-start gap-2">
                <div className="relative min-w-0 flex-1">
                  <div
                    onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), input.current?.focus())}
                    className={cx(
                      'flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-[11px] border bg-well py-[5px] pr-2 pl-3 focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/20',
                      chosen.length || term ? 'border-primary' : 'border-line',
                    )}
                  >
                    <Icon name="search" size={16} className="shrink-0 text-ink-3" />
                    {chosen.map((c) => (
                      <span key={c.key} className="flex h-[30px] items-center gap-1.5 rounded-full border border-primary/35 bg-selection pr-1.5 pl-1 text-[13px] font-semibold text-ink">
                        <Who p={c} size={22} />
                        <span className="max-w-[180px] truncate">{c.name}</span>
                        <button type="button" aria-label={`Remove ${c.name}`} onClick={() => remove(c.key)} className="flex h-5 w-5 items-center justify-center rounded-full text-ink-2 hover:bg-subtle hover:text-ink">
                          <Icon name="x" size={12} strokeWidth={2.6} />
                        </button>
                      </span>
                    ))}
                    <input
                      ref={input}
                      autoFocus
                      role="combobox"
                      aria-label="Add people, teams, departments or companies"
                      aria-autocomplete="list"
                      aria-expanded={showList}
                      aria-controls={listId}
                      aria-activedescendant={showList && results[active] ? optId(results[active]) : undefined}
                      value={term}
                      onChange={(e) => (setTerm(e.target.value), setOpen(true), setActive(-1), setJustShared(''))}
                      onKeyDown={onKey}
                      onBlur={() => setOpen(false)}
                      onFocus={() => setOpen(true)}
                      placeholder={chosen.length ? 'Add more…' : 'Add people, teams, departments or companies'}
                      className="h-8 min-w-[160px] flex-1 bg-transparent text-[14px] text-ink outline-none bare-focus placeholder:text-ink-3"
                    />
                  </div>
                  {showList ? (
                    <div className="absolute top-[50px] right-0 left-0 z-20 flex max-h-[320px] flex-col gap-0.5 overflow-y-auto rounded-[12px] border border-line bg-surface p-1.5 shadow-[0_20px_44px_-12px_rgb(var(--ws-shadow-rgb)/.35)] scroll-thin">
                      <div id={listId} role="listbox" aria-label="People, teams, departments and companies" className="flex flex-col gap-0.5">
                        {results.map((r, i) => (
                          <div
                            key={r.key}
                            id={optId(r)}
                            role="option"
                            aria-selected={i === active}
                            aria-disabled={!r.can_share || undefined}
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => add(r)}
                            className={cx('flex min-h-[52px] items-center gap-3 rounded-[9px] px-2.5 py-1.5', r.can_share ? 'cursor-pointer' : 'cursor-not-allowed opacity-55', i === active && 'bg-ground')}
                          >
                            <Who p={r} />
                            <span className="flex min-w-0 flex-1 flex-col gap-px">
                              <span className="truncate text-[14px] font-semibold text-ink">{r.name}</span>
                              <span className="truncate text-[12px] text-ink-3">{[r.detail ?? KIND[r.type], r.can_share ? r.has : null].filter(Boolean).join(' · ')}</span>
                            </span>
                            <span className={cx('shrink-0 rounded-full px-2 py-[3px] text-[11px] font-semibold', r.can_share ? 'bg-selection text-primary' : 'bg-subtle text-ink-3')}>{r.can_share ? r.kind : r.why}</span>
                          </div>
                        ))}
                      </div>
                      {found.isLoading && !found.data ? <Spinner className="p-3" /> : null}
                      {found.isSuccess && !results.length ? (
                        <div className="px-2.5 py-3.5 text-[13px] text-ink-3">No one matches “{term.trim()}”.{found.data.shareable ? '' : ' This item has no company yet, so it can’t be shared.'}</div>
                      ) : null}
                      {found.error ? <div className="px-2.5 py-3 text-[13px] text-danger">{errorMessage(found.error)}</div> : null}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={menu?.kind === 'level'}
                  aria-label={`Permission: ${LEVEL_LABEL[level]}`}
                  onClick={(e) => setMenu({ kind: 'level', at: below(e.currentTarget, 'right', 280) })}
                  className="flex h-11 shrink-0 items-center gap-2 rounded-[11px] border border-line px-3 text-[14px] font-semibold whitespace-nowrap text-ink hover:bg-ground"
                >
                  {LEVEL_LABEL[level]}
                  <Icon name="chevron-down" size={14} strokeWidth={2.4} />
                </button>
                <Button variant="primary" className="h-11 rounded-[11px] px-[18px] text-[14px] font-bold" disabled={!chosen.length || busy} onClick={() => void share()}>
                  Share
                </Button>
              </div>

              {chosen.length ? (
                <div data-share-notify className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-ground/60 p-3">
                  <div role="group" aria-label="Notify by" className="flex flex-wrap items-center gap-2.5">
                    <span className="text-[13px] font-semibold text-ink-2">Notify by</span>
                    {chat ? (
                      <button type="button" aria-pressed={chatOn} onClick={() => setByChat(!chatOn)} className={cx('flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold', chatOn ? 'border-primary/45 bg-selection text-primary' : 'border-line text-ink-3 hover:text-ink')}>
                        <Icon name="chat" size={13} strokeWidth={2.2} />
                        Chat
                      </button>
                    ) : null}
                    <button type="button" aria-pressed={emailOn} onClick={() => setByEmail(!emailOn)} className={cx('flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold', emailOn ? 'border-primary/45 bg-selection text-primary' : 'border-line text-ink-3 hover:text-ink')}>
                      <Icon name="mail" size={13} strokeWidth={2.2} />
                      Email
                    </button>
                    <span className="text-[12px] text-ink-3">{chatOn || emailOn ? `Turn ${chat ? 'both' : 'it'} off to share quietly` : 'They’ll find it in Shared with me, without being told'}</span>
                  </div>
                  {chatOn || emailOn ? (
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={500}
                      rows={2}
                      aria-label="Message"
                      placeholder="Add a message (optional)"
                      className="w-full resize-none rounded-[10px] border border-line bg-well px-3 py-2.5 text-[14px] text-ink outline-none focus:border-primary"
                    />
                  ) : null}
                </div>
              ) : null}

              {justShared ? (
                <div role="status" className="flex items-center gap-2 rounded-[10px] border border-success/25 bg-success-bg px-3 py-2.5 text-[13px] text-ink">
                  <Icon name="check" size={15} strokeWidth={2.6} className="shrink-0 text-success" />
                  {justShared}
                </div>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto border-t border-line scroll-thin">
              <section aria-labelledby="shWho" className="flex flex-col gap-1 px-6 pt-4 pb-1">
                <div className="flex items-center justify-between pb-1.5">
                  <h2 id="shWho" className={SECTION}>Who has access · {count}</h2>
                  <button type="button" onClick={() => setEffective(true)} className="text-[13px] font-semibold text-primary hover:underline">Check effective access</button>
                </div>
                {a.item.owner ? (
                  <div className="flex min-h-[52px] items-center gap-3">
                    <Avatar name={a.item.owner.name} size={34} />
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate text-[14px] font-semibold">{a.item.owner.name}{owner ? ' (you)' : ''}</span>
                      {a.item.owner.detail ? <span className="truncate text-[12px] text-ink-3">{a.item.owner.detail}</span> : null}
                    </span>
                    <span className="pr-3 text-[13px] text-ink-3">Owner</span>
                  </div>
                ) : null}
                {allowed.map((gr) => (
                  <div key={gr.id} className="flex min-h-[52px] items-center gap-3">
                    <Who p={gr.principal} />
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate text-[14px] font-semibold">{gr.principal.name}</span>
                      <span className="truncate text-[12px] text-ink-3">
                        {gr.principal.type === 'user' ? (gr.principal.detail ?? 'Shared directly') : `${KIND[gr.principal.type as PType]}${gr.principal.detail ? ` · ${gr.principal.detail}` : ''}`}
                        {gr.can_download ? '' : ' · No download'}
                      </span>
                    </span>
                    {gr.editable ? (
                      <button
                        type="button"
                        aria-haspopup="menu"
                        aria-label={`Access for ${gr.principal.name}: ${LEVEL_LABEL[gr.level]}`}
                        disabled={busy}
                        onClick={(e) => setMenu({ kind: 'row', at: below(e.currentTarget, 'right', 280), grant: gr })}
                        className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-[9px] px-2.5 text-[13px] font-semibold text-ink hover:bg-ground disabled:opacity-50"
                      >
                        {LEVEL_LABEL[gr.level]}
                        <Icon name="chevron-down" size={12} strokeWidth={2.6} />
                      </button>
                    ) : (
                      <span className="pr-3 text-[13px] text-ink-3">{LEVEL_LABEL[gr.level]}</span>
                    )}
                  </div>
                ))}
                {inherited.map((gr) => (
                  <div key={`${gr.from.id}-${gr.principal.type}-${gr.principal.id}`} className="flex min-h-[52px] items-center gap-3">
                    <Who p={gr.principal} />
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate text-[14px] font-semibold">{gr.principal.name}{gr.principal.type !== 'user' ? ` (${KIND[gr.principal.type as PType].toLowerCase()})` : ''}</span>
                      <span className="truncate text-[12px] text-ink-3">Inherited from “{gr.from.name}”</span>
                    </span>
                    <span className="pr-3 text-[13px] text-ink-3">{LEVEL_LABEL[gr.level]}</span>
                  </div>
                ))}
                {refused.map((gr) => (
                  <div key={gr.id} className="flex min-h-[52px] items-center gap-3">
                    <Who p={gr.principal} />
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate text-[14px] font-semibold">{gr.principal.name}</span>
                      <span className="text-[12px] text-danger">Refused here</span>
                    </span>
                    {gr.editable ? <button type="button" disabled={busy} onClick={() => void run(() => apiDelete(`${base}/grants/${gr.id}`), 'Refusal lifted')} className="pr-1 text-[13px] font-semibold text-primary hover:underline">Lift the refusal</button> : null}
                  </div>
                ))}
                {inheritedRefused.map((gr, i) => (
                  <div key={`r${i}`} className="flex min-h-[52px] items-center gap-3">
                    <Who p={gr.principal} />
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate text-[14px] font-semibold">{gr.principal.name}</span>
                      <span className="text-[12px] text-danger">Refused in “{gr.from.name}”</span>
                    </span>
                  </div>
                ))}
                {showInherit ? (
                  <div className="flex items-center gap-2.5 pt-2.5 pb-1 text-[13px] text-ink-3">
                    <Icon name="folder-up" size={15} className="shrink-0" />
                    <span id="shInherit" className="flex-1">
                      {a.item.inherits ? (
                        <>
                          Inherits access from <b className="font-semibold text-ink">{above}</b> · {inherited.length ? `${inherited.length} from above` : 'nothing extra comes from above'}
                        </>
                      ) : (
                        <>Doesn’t inherit access from <b className="font-semibold text-ink">{above}</b> · only the access set here applies</>
                      )}
                    </span>
                    <Switch
                      checked={a.item.inherits}
                      disabled={!a.may.manage || busy}
                      label="Inherit access from the folder above"
                      describedBy="shInherit"
                      onChange={(on) => void run(() => apiPut(`${base}/inheritance`, { inherit: on, copy: !on }), on ? 'Access from the folder above applies again' : 'Access from above stopped; it was copied here')}
                    />
                  </div>
                ) : null}
              </section>

              <section aria-labelledby="shGeneral" className="px-6 pt-3 pb-5">
                <h2 id="shGeneral" className={cx(SECTION, 'pb-2')}>General access</h2>
                <div className="flex items-center gap-3 rounded-[12px] border border-line bg-ground/60 p-3">
                  <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]', general.access === 'restricted' ? 'bg-subtle text-ink-2' : general.access === 'org' ? 'bg-selection text-primary' : 'bg-warning-bg text-warning')}>
                    <Icon name={g.icon} size={18} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <button
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={menu?.kind === 'general'}
                      aria-label={`General access: ${g.label}`}
                      disabled={busy}
                      onClick={(e) => setMenu({ kind: 'general', at: below(e.currentTarget, 'left', 340) })}
                      className="flex items-center gap-1.5 self-start text-left text-[14px] font-semibold text-ink hover:underline disabled:opacity-60"
                    >
                      {g.label}
                      <Icon name="chevron-down" size={12} strokeWidth={2.6} />
                    </button>
                    <span className="text-[12px] text-ink-3">
                      {g.help}
                      {general.access === 'anyone' && a.public_links?.shares ? ` · ${a.public_links.shares} live link${a.public_links.shares === 1 ? '' : 's'}` : ''}
                    </span>
                  </span>
                  {general.access === 'org' ? (
                    <button
                      type="button"
                      aria-haspopup="menu"
                      aria-label={`Company access: ${LEVEL_LABEL[general.level ?? 'view']}`}
                      disabled={busy}
                      onClick={(e) => setMenu({ kind: 'org-level', at: below(e.currentTarget, 'right', 280) })}
                      className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-[9px] px-2.5 text-[13px] font-semibold text-ink hover:bg-subtle disabled:opacity-50"
                    >
                      {LEVEL_LABEL[general.level ?? 'view']}
                      <Icon name="chevron-down" size={12} strokeWidth={2.6} />
                    </button>
                  ) : general.access === 'anyone' ? (
                    <span className="flex shrink-0 items-center gap-3 pr-1">
                      <span className="text-[13px] font-semibold text-ink">Can view</span>
                      {owner ? <button type="button" onClick={onPublicLink} className="text-[13px] font-semibold text-primary hover:underline">Link settings…</button> : null}
                    </span>
                  ) : null}
                </div>
                {item.type === 'file' ? (
                  <p className="pt-2 text-[12px] text-ink-3">
                    Need an expiring, download-limited link?{' '}
                    <button type="button" onClick={onSecureLink} className="font-semibold text-primary hover:underline">Create a secure link…</button>
                    {a.public_links?.download_links ? ` ${a.public_links.download_links} active.` : ''}
                  </p>
                ) : null}
              </section>
            </div>
          </>
        ) : null}

        <div className="flex items-center gap-2 border-t border-line px-6 py-3.5">
          <Button icon={copied ? 'check' : 'link'} onClick={copy} className="h-10 rounded-[10px]">
            {copied ? 'Link copied' : 'Copy link'}
          </Button>
          {chat && a?.my_access.capabilities.includes('chat_share') ? (
            <Button icon="chat" onClick={onSendToChat} className="h-10 rounded-[10px]">
              Send in chat
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button variant="primary" onClick={onClose} className="h-10 rounded-[10px] px-5 text-[14px] font-bold">
            Done
          </Button>
        </div>
      </div>

      {menu?.kind === 'level' ? <PopMenu at={menu.at} stacked width={280} label="Permission" items={levelItems(level, setLevel)} onClose={() => setMenu(null)} /> : null}
      {menu?.kind === 'row' ? (
        <PopMenu
          at={menu.at}
          stacked
          width={280}
          label={`Access for ${menu.grant.principal.name}`}
          onClose={() => setMenu(null)}
          items={[
            ...levelItems(menu.grant.level, (l) => {
              const gr = menu.grant;
              if (l !== gr.level) void run(() => apiPut(`${base}/grants/${gr.id}`, { principal_type: gr.principal.type, principal_id: gr.principal.id, level: l, can_download: gr.can_download, effect: 'allow' }), `${gr.principal.name}: ${LEVEL_LABEL[l].toLowerCase()}`);
            }),
            { sep: true },
            { label: 'Remove access', danger: true, run: () => void run(() => apiDelete(`${base}/grants/${menu.grant.id}`), `${menu.grant.principal.name} no longer has access`) },
          ]}
        />
      ) : null}
      {menu?.kind === 'general' ? (
        <PopMenu
          at={menu.at}
          stacked
          width={340}
          label="General access"
          onClose={() => setMenu(null)}
          items={gOpts.map((o) => ({
            label: o.label,
            icon: o.icon,
            checked: o.id === general.access,
            disabled: (o.id === 'org' && !a?.item.company) || (o.id === 'anyone' && !owner && general.access !== 'anyone'),
            hint: o.id === 'anyone' && !owner ? 'Only the owner can make a public link' : general.access === 'anyone' && o.id !== 'anyone' && owner ? `${o.help} · turns off the public link you made` : o.help,
            run: () => setGeneral(o.id),
          }))}
        />
      ) : null}
      {menu?.kind === 'org-level' ? (
        <PopMenu at={menu.at} stacked width={280} label="Company access" onClose={() => setMenu(null)} items={levelItems(general.level ?? 'view', (l) => l !== general.level && setGeneral('org', l), levels.filter((l) => l.id !== 'full'))} />
      ) : null}
    </div>
  );
}

