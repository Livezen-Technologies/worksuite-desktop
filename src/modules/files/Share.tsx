import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useCanOpen } from '../../core/access';
import { app } from '../../core/app-state';
import { apiDelete, apiGet, apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import type { ItemAccess, Level } from './api';
import type { Item } from './ctx';
import { Select } from '../../components/Select';
import { Checkbox } from '../../components/Checkbox';

type PType = 'user' | 'group' | 'department' | 'role' | 'organization';
interface Principal {
  type: PType;
  id: number;
  name: string;
  detail: string | null;
}
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
}
interface Effective {
  person: { id: number; name: string; detail: string | null };
  level: Level;
  via: string;
  can_download: boolean;
  because: Array<{ text: string }>;
}

const TABS: Array<[string, PType, keyof Results]> = [
  ['People', 'user', 'people'],
  ['Teams', 'group', 'teams'],
  ['Departments', 'department', 'departments'],
  ['Roles', 'role', 'roles'],
  ['Companies', 'organization', 'companies'],
];
interface Results {
  people: Principal[];
  teams: Principal[];
  departments: Principal[];
  roles: Principal[];
  companies: Principal[];
  shareable: boolean;
}
const LEVELS: Array<[Level, string]> = [
  ['view', 'Can view — open and read it'],
  ['edit', 'Can edit — change it and add files'],
  ['full', 'Full access — edit, share and manage'],
];
const SHORT: Record<Level, string> = { view: 'Can view', edit: 'Can edit', full: 'Full access' };
const WORD: Record<PType, string> = { user: 'Shared directly', group: 'Team', department: 'Department', role: 'Role', organization: 'Company' };
const TINTS = ['bg-selection text-primary', 'bg-[#E3F4F5] text-[#0B6770] dark:bg-subtle dark:text-[#5CC6CF]', 'bg-[#FDF0E1] text-[#9A4A06] dark:bg-warning-bg dark:text-warning', 'bg-[#F1EAFB] text-[#6B3FB5] dark:bg-subtle dark:text-[#B69CF0]'];
const ini = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

function Avatar({ name, i }: { name: string; i: number }) {
  return <span className={cx('flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold', TINTS[i % TINTS.length])}>{ini(name)}</span>;
}

/**
 * Share (DriveShare): find people, teams, departments, roles or companies and
 * give them a level; change or remove what is there; see what comes from the
 * folders above and what is refused; and the links. The server decides
 * everything; this shows what it answers.
 */
export function ShareDialog({ item, onClose, onSecureLink, onPublicLink, onSendToChat }: { item: Item; onClose: () => void; onSecureLink: () => void; onPublicLink: () => void; onSendToChat: () => void }) {
  const qc = useQueryClient();
  const chat = useCanOpen('chat');
  const origin = app.get().auth?.server?.origin ?? '';
  const base = `/api/drive/access/${item.type}/${item.f.id}`;
  const key = ['files', 'access', item.type, item.f.id];
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => apiGet<AccessInfo>(base, undefined, signal) });
  const [tab, setTab] = useState(0);
  const [term, setTerm] = useState('');
  const [level, setLevel] = useState<Level>('edit');
  const [picked, setPicked] = useState<Principal | null>(null);
  const [noDownload, setNoDownload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [effective, setEffective] = useState(false);
  const field = TABS[tab]![2];
  const found = useQuery({
    queryKey: ['files', 'principals', item.type, item.f.id, term.trim()],
    queryFn: ({ signal }) => apiGet<Results>(`${base}/principals`, { q: term.trim() }, signal),
    enabled: term.trim().length >= 2,
  });
  const eff = useQuery({ queryKey: ['files', 'effective', item.type, item.f.id], queryFn: ({ signal }) => apiGet<{ people: Effective[]; refused: Effective[]; truncated: boolean }>(`${base}/effective`, undefined, signal), enabled: effective });
  const a = q.data;
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
  const share = () =>
    picked &&
    void run(async () => {
      await apiPost(`${base}/grants`, { principal_type: picked.type, principal_id: picked.id, level, can_download: !noDownload, notify: true });
      setPicked(null);
      setTerm('');
      setNoDownload(false);
    }, `Shared with ${picked.name}`);
  const results = (found.data?.[field] as Principal[] | undefined) ?? [];
  const allowed = (a?.grants ?? []).filter((g) => g.effect === 'allow');
  const refused = (a?.grants ?? []).filter((g) => g.effect === 'deny');
  const inherited = (a?.inherited ?? []).filter((g) => g.effect === 'allow');
  const inheritedRefused = (a?.inherited ?? []).filter((g) => g.effect === 'deny');
  const noun = item.type === 'folder' ? 'Folder · everything inside inherits this access' : 'File';
  const webLink = `${origin}/files?${item.type === 'folder' ? `folder=${item.f.id}` : `file=${item.f.id}`}`;
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

  return (
    <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-[#0B1020]/50 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="shTitle" className="animate-in outline-none flex max-h-full w-[820px] flex-col rounded-[14px] border border-line bg-surface text-[13px] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-selection text-primary"><Icon name={item.type === 'folder' ? 'folder' : 'file'} size={18} /></span>
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 id="shTitle" className="truncate text-[16px] font-bold text-ink">Share “{item.f.name}”</h1>
            <span className="text-[12px] text-ink-3">{noun}{a?.item.company ? ` · ${a.item.company.name}` : ''}</span>
          </div>
          {a?.may.share ? <Button size="sm" onClick={() => setEffective(!effective)}>{effective ? 'Back to sharing' : 'Effective access'}</Button> : null}
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[18px] text-ink-2 hover:bg-subtle">×</button>
        </div>
        {q.isLoading ? <Spinner /> : null}
        {q.error ? <div className="p-5"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div> : null}
        {a && !a.may.share ? (
          <p className="p-5 text-ink-2">You can’t share this. Your access: {a.my_access.owner ? 'owner' : SHORT[a.my_access.level ?? 'view']}.{a.my_access.reason ? ` ${a.my_access.reason}` : ''}</p>
        ) : null}
        {a && a.may.share && effective ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scroll-thin">
            <h2 className="mb-2 text-[11px] font-bold tracking-[0.5px] text-ink-2">WHO CAN OPEN IT, AND WHY</h2>
            {eff.isLoading ? <Spinner /> : null}
            {(eff.data?.people ?? []).map((p, i) => (
              <div key={p.person.id} className="flex items-start gap-2.5 border-b border-line/70 py-2">
                <Avatar name={p.person.name} i={i} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="text-ink">{p.person.name}</b>
                  <span className="text-[11.5px] text-ink-3">{p.because.map((b) => b.text).join(' · ')}</span>
                </span>
                <span className="font-semibold text-ink-2">{SHORT[p.level]}{p.can_download ? '' : ' · no download'}</span>
              </div>
            ))}
            {eff.data?.refused.length ? <h2 className="mt-3 mb-2 text-[11px] font-bold tracking-[0.5px] text-danger">REFUSED</h2> : null}
            {(eff.data?.refused ?? []).map((p, i) => (
              <div key={p.person.id} className="flex items-center gap-2.5 py-1.5">
                <Avatar name={p.person.name} i={i} />
                <b className="flex-1 text-ink">{p.person.name}</b>
                <span className="text-[11.5px] text-ink-3">{p.because.map((b) => b.text).join(' · ')}</span>
              </div>
            ))}
            {eff.data?.truncated ? <p className="mt-2 text-[12px] text-ink-3">The first 150 people are shown.</p> : null}
          </div>
        ) : null}
        {a && a.may.share && !effective ? (
          <>
            <div role="tablist" aria-label="Share with" className="flex gap-1 border-b border-line px-4">
              {TABS.map(([l], i) => (
                <button key={l} type="button" role="tab" aria-selected={tab === i} onClick={() => (setTab(i), setPicked(null))} className={cx('h-[38px] px-3', tab === i ? 'font-bold text-primary shadow-[inset_0_-2px_0_var(--color-primary)]' : 'font-medium text-ink-2 hover:text-ink')}>
                  {l}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 px-5 pt-3.5">
              <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[8px] border border-line px-2.5 text-ink-3 focus-within:border-primary">
                <Icon name="search" size={15} />
                <input autoFocus value={term} onChange={(e) => (setTerm(e.target.value), setPicked(null))} aria-label={`Search ${TABS[tab]![0].toLowerCase()}`} placeholder={`Search ${TABS[tab]![0].toLowerCase()}`} className="min-w-0 flex-1 bg-transparent text-ink outline-none bare-focus" />
              </label>
              <Select aria-label="Access level" value={level} onChange={(e) => setLevel(e.target.value as Level)} className="h-9 rounded-[8px] border border-line bg-surface px-2 text-ink">
                {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              <Button variant="primary" disabled={!picked || busy} onClick={share}>Share</Button>
            </div>
            {term.trim().length >= 2 ? (
              <div className="flex max-h-[140px] flex-col gap-0.5 overflow-y-auto px-5 pt-2 scroll-thin">
                {found.isLoading ? <Spinner /> : null}
                {results.map((r, i) => (
                  <div key={`${r.type}${r.id}`} className={cx('flex items-center gap-2.5 rounded-[9px] px-2.5 py-1.5', picked?.id === r.id && picked.type === r.type ? 'bg-selection' : 'hover:bg-ground')}>
                    <button type="button" onClick={() => setPicked(r)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                      <Avatar name={r.name} i={i} />
                      <span className="flex min-w-0 flex-col">
                        <b className="truncate text-ink">{r.name}</b>
                        <span className="truncate text-[11.5px] text-ink-3">{r.detail ?? WORD[r.type]}</span>
                      </span>
                    </button>
                    {picked?.id === r.id && picked.type === r.type ? (
                      <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-2">
                        <Checkbox checked={noDownload} onChange={(e) => setNoDownload(e.target.checked)} />
                        No download
                      </label>
                    ) : null}
                  </div>
                ))}
                {found.isSuccess && !results.length ? <span className="px-2.5 py-1.5 text-ink-3">No {TABS[tab]![0].toLowerCase()} match.{found.data.shareable ? '' : ' This item cannot be shared outside its company.'}</span> : null}
              </div>
            ) : null}
            <div className="grid min-h-0 flex-1 grid-cols-[1.25fr_1fr] gap-5 overflow-y-auto px-5 py-4 scroll-thin">
              <section className="flex flex-col gap-2">
                <h2 className="text-[11px] font-bold tracking-[0.5px] text-ink-2">PEOPLE WITH ACCESS</h2>
                {a.item.owner ? (
                  <div className="flex items-center gap-2.5">
                    <Avatar name={a.item.owner.name} i={0} />
                    <span className="flex min-w-0 flex-1 flex-col"><b className="truncate text-ink">{a.item.owner.name}{a.my_access.owner ? ' (you)' : ''}</b><span className="text-[11.5px] text-ink-3">Owner</span></span>
                    <span className="font-semibold text-ink-2">Owner</span>
                  </div>
                ) : null}
                {allowed.map((g, i) => (
                  <div key={g.id} className="flex items-center gap-2.5">
                    <Avatar name={g.principal.name} i={i + 1} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <b className="truncate text-ink">{g.principal.name}</b>
                      <span className="truncate text-[11.5px] text-ink-3">{g.principal.type === 'user' ? 'Shared directly' : `${WORD[g.principal.type]}${g.principal.detail ? ` · ${g.principal.detail}` : ''}`}{g.can_download ? '' : ' · No download'}</span>
                    </span>
                    <Select
                      aria-label={`Access for ${g.principal.name}`}
                      value={g.level}
                      disabled={!g.editable || busy}
                      onChange={(e) =>
                        e.target.value === 'remove'
                          ? void run(() => apiDelete(`${base}/grants/${g.id}`), `${g.principal.name} no longer has access`)
                          : void run(() => apiPut(`${base}/grants/${g.id}`, { principal_type: g.principal.type, principal_id: g.principal.id, level: e.target.value, can_download: g.can_download, effect: 'allow' }))
                      }
                      className="h-8 rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink"
                    >
                      {LEVELS.map(([v]) => <option key={v} value={v}>{SHORT[v]}</option>)}
                      <option value="remove">Remove access</option>
                    </Select>
                  </div>
                ))}
                {!allowed.length ? <span className="text-ink-3">Nobody else has been given it directly.</span> : null}
                {item.type === 'folder' || inherited.length || a.item.inherits === false ? (
                  <>
                    <h2 className="mt-2 text-[11px] font-bold tracking-[0.5px] text-ink-2">FROM FOLDERS ABOVE</h2>
                    {inherited.map((g, i) => (
                      <div key={`${g.from.id}-${g.principal.type}-${g.principal.id}`} className="flex items-center gap-2.5">
                        <Avatar name={g.principal.name} i={i + 2} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <b className="truncate text-ink">{g.principal.name}{g.principal.type !== 'user' ? ` (${WORD[g.principal.type].toLowerCase()})` : ''}</b>
                          <span className="truncate text-[11.5px] text-ink-3">Inherited from “{g.from.name}”</span>
                        </span>
                        <span className="font-semibold text-ink-2">{SHORT[g.level]}</span>
                      </div>
                    ))}
                    {!inherited.length ? <span className="text-ink-3">Nothing comes from above.</span> : null}
                    <label className="flex items-center gap-2 text-ink">
                      <Checkbox checked={a.item.inherits} disabled={!a.may.manage || busy} onChange={(e) => void run(() => apiPut(`${base}/inheritance`, { inherit: e.target.checked, copy: !e.target.checked }), e.target.checked ? 'Access from the folder above applies again' : 'Access from above stopped; it was copied here')} />
                      Inherit access from the folder above
                    </label>
                  </>
                ) : null}
                {refused.length || inheritedRefused.length ? (
                  <>
                    <h2 className="mt-2 text-[11px] font-bold tracking-[0.5px] text-danger">REFUSED</h2>
                    {refused.map((g, i) => (
                      <div key={g.id} className="flex items-center gap-2.5">
                        <Avatar name={g.principal.name} i={i} />
                        <span className="flex min-w-0 flex-1 flex-col"><b className="truncate text-ink">{g.principal.name}</b><span className="text-[11.5px] text-ink-3">Refused here</span></span>
                        {g.editable ? <button type="button" onClick={() => void run(() => apiDelete(`${base}/grants/${g.id}`), 'Refusal lifted')} className="font-semibold text-primary hover:underline">Lift the refusal</button> : null}
                      </div>
                    ))}
                    {inheritedRefused.map((g, i) => (
                      <div key={`r${i}`} className="flex items-center gap-2.5">
                        <Avatar name={g.principal.name} i={i} />
                        <span className="flex min-w-0 flex-1 flex-col"><b className="truncate text-ink">{g.principal.name}</b><span className="text-[11.5px] text-ink-3">Refused in “{g.from.name}”</span></span>
                      </div>
                    ))}
                  </>
                ) : null}
              </section>
              <section className="flex flex-col gap-2.5">
                <h2 className="text-[11px] font-bold tracking-[0.5px] text-ink-2">LINKS</h2>
                <div className="flex flex-col gap-1 rounded-[10px] border border-line p-3">
                  <b className="text-ink">Public link</b>
                  <span className="text-[12px] text-ink-3">
                    {a.public_links?.shares ? `${a.public_links.shares} active — anybody with the link can open it.` : 'Off — only people above can open it.'}
                  </span>
                  {a.my_access.owner ? <button type="button" onClick={onPublicLink} className="self-start font-semibold text-primary hover:underline">{item.type === 'folder' ? 'Get a link…' : 'Make a public link…'}</button> : <span className="text-[12px] text-ink-3">Only the owner can make one.</span>}
                </div>
                {item.type === 'file' ? (
                  <div className="flex flex-col gap-1 rounded-[10px] border border-line p-3">
                    <b className="text-ink">Secure link</b>
                    <span className="text-[12px] text-ink-3">Expiring, download-limited, optional password and IP lock.{a.public_links?.download_links ? ` ${a.public_links.download_links} active.` : ''}</span>
                    <button type="button" onClick={onSecureLink} className="self-start font-semibold text-primary hover:underline">Create secure link…</button>
                  </div>
                ) : null}
              </section>
            </div>
          </>
        ) : null}
        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          <Button onClick={() => void navigator.clipboard.writeText(webLink).then(() => toast('success', 'WorkSuite link copied — it opens for people with access'))}>Copy WorkSuite link</Button>
          {chat && a?.my_access.capabilities.includes('chat_share') ? <Button onClick={onSendToChat}>Send to Chat…</Button> : null}
          <span className="flex-1" />
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}
