/**
 * W02 / D02 Create post — "Post to" (SMM-CMP-001, SMM-ACC-011, WF-03 step 1): the chosen accounts as chips and the
 * picker, grouped by brand so a whole brand is one click. An account needing reconnect can be chosen; its post is
 * held until it is reconnected (WF-06).
 */
import { useState } from 'react';
import { Button, cx, Modal } from '../../../components/ui';
import type { Account, Brand } from '../api';
import { NetChip, Panel } from '../parts';

function needsReconnect(a: Account): boolean {
  return a.status === 'needs_reconnect' || a.status === 'error';
}

export function PostTo({ chosen, usable, brands, offered, disabled, onChange }: { chosen: Account[]; usable: Account[]; brands: Brand[]; offered: boolean; disabled?: boolean; onChange: (ids: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const ids = chosen.map((a) => a.id);
  return (
    <Panel title="Post to">
      <div className="flex flex-wrap items-center gap-2">
        {chosen.map((a) => (
          <span key={a.id} className={cx('inline-flex h-8 items-center gap-1.5 rounded-full border bg-subtle pr-1 pl-1.5 text-[12.5px] font-semibold text-ink', needsReconnect(a) ? 'border-danger/40' : 'border-line')} title={needsReconnect(a) ? 'Needs reconnect: posts will be held until reconnected' : undefined}>
            <NetChip network={a.network} size={20} />
            <span className="max-w-[160px] truncate">{a.handle?.startsWith('@') ? a.handle : a.display_name}</span>
            {!disabled ? (
              <button type="button" aria-label={`Remove ${a.display_name}`} onClick={() => onChange(ids.filter((x) => x !== a.id))} className="inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-3 hover:bg-line hover:text-ink">
                ×
              </button>
            ) : null}
          </span>
        ))}
        {!disabled ? (
          <Button size="sm" variant="ghost" icon="plus" onClick={() => setOpen(true)} disabled={!offered || usable.length === 0}>
            Choose accounts or a group
          </Button>
        ) : null}
      </div>
      {!offered || usable.length === 0 ? (
        <p className="mt-2 text-[12px] text-ink-3">{offered ? 'Connect an account first: Social Media › Accounts.' : 'Connect an account first — this WorkSuite server doesn’t offer social accounts yet. You can still write the post; it is kept on this computer.'}</p>
      ) : null}
      {open ? <Picker usable={usable} brands={brands} initial={ids} onClose={() => setOpen(false)} onDone={(v) => { onChange(v); setOpen(false); }} /> : null}
    </Panel>
  );
}

function Picker({ usable, brands, initial, onClose, onDone }: { usable: Account[]; brands: Brand[]; initial: number[]; onClose: () => void; onDone: (ids: number[]) => void }) {
  const [sel, setSel] = useState<number[]>(initial);
  const groups = [...brands.map((b) => ({ id: b.id as number | null, name: b.name })), { id: null, name: 'No brand' }]
    .map((g) => ({ ...g, accounts: usable.filter((a) => (a.brand_id ?? null) === g.id || (g.id === null && !brands.some((b) => b.id === a.brand_id))) }))
    .filter((g) => g.accounts.length > 0);
  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Modal
      title="Choose accounts"
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onDone(sel)}>
            Use {sel.length} account{sel.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto scroll-thin">
        {groups.map((g) => {
          const all = g.accounts.every((a) => sel.includes(a.id));
          return (
            <section key={g.id ?? 'none'}>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <h3 className="text-[12px] font-bold tracking-[.04em] text-ink-3 uppercase">{g.name}</h3>
                <button
                  type="button"
                  className="text-[12.5px] font-semibold text-primary hover:underline"
                  onClick={() => setSel((s) => (all ? s.filter((id) => !g.accounts.some((a) => a.id === id)) : [...new Set([...s, ...g.accounts.map((a) => a.id)])]))}
                >
                  {all ? `Clear ${g.name}` : `All of ${g.name}`}
                </button>
              </div>
              <ul className="flex flex-col gap-1">
                {g.accounts.map((a) => (
                  <li key={a.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-[8px] px-2 py-1.5 hover:bg-subtle">
                      <input type="checkbox" checked={sel.includes(a.id)} onChange={() => toggle(a.id)} className="h-4 w-4 accent-[var(--ws-indigo)]" />
                      <NetChip network={a.network} />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[13px] font-semibold text-ink">{a.display_name}</span>
                        <span className={cx('truncate text-[11.5px]', needsReconnect(a) ? 'text-danger' : 'text-ink-3')}>
                          {needsReconnect(a) ? 'Needs reconnect — posts will be held until reconnected' : [a.handle, a.account_type].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
