import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { errorMessage } from '../../../../core/bridge';
import { toast } from '../../../../core/toasts';
import { Button, cx, Modal, Spinner } from '../../../../components/ui';
import { dataOf, SK, socialApi, useAccess, useInvalidate, type AccessEntry, type AccessLevel, type Account, type Brand } from '../../api';
import { Field, INPUT, NativeSelect, NotOffered, Refused } from '../../parts';
import { zonesWith } from '../settings/zones';

/**
 * A01 dialogs: a new brand (SMM-ACC-010), an account's access list (ACC-011), moving it to another brand, and
 * disconnecting it (WF-18) — which asks what happens to its future posts before anything is revoked.
 */

const LEVELS: Array<{ id: AccessLevel; label: string }> = [
  { id: 'use', label: 'Use — draft for it' },
  { id: 'publish', label: 'Publish — schedule on it' },
  { id: 'manage', label: 'Manage — reconnect, access' },
];

function onError(e: unknown) {
  toast('error', errorMessage(e));
}

export function AddBrandModal({ onClose }: { onClose: () => void }) {
  const invalidate = useInvalidate();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#1d4ed8');
  const [timezone, setTimezone] = useState('Asia/Colombo');
  const save = useMutation({
    mutationFn: () => socialApi.saveBrand({ name: name.trim(), color, timezone }),
    onSuccess: () => {
      invalidate(SK.brands, SK.status);
      toast('success', `Brand “${name.trim()}” added.`);
      onClose();
    },
    onError,
  });
  return (
    <Modal
      title="Add brand"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
            Add brand
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Colour" hint="Marks the brand on the calendar and in the header.">
          <input type="color" className="h-9 w-16 cursor-pointer rounded-[8px] border border-line bg-surface p-1" value={color} onChange={(e) => setColor(e.target.value)} />
        </Field>
        <Field label="Time zone" hint="Slots and the queue run on this clock.">
          <NativeSelect label="Time zone" value={timezone} onChange={setTimezone}>
            {zonesWith(timezone).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
    </Modal>
  );
}

function AccessEditor({ account, initial, onClose }: { account: Account; initial: AccessEntry[]; onClose: () => void }) {
  const invalidate = useInvalidate();
  const [entries, setEntries] = useState(initial);
  const [type, setType] = useState<AccessEntry['principal_type']>('user');
  const [name, setName] = useState('');
  const [pid, setPid] = useState('');
  const save = useMutation({
    mutationFn: () => socialApi.saveAccess(account.id, entries),
    onSuccess: () => {
      invalidate(SK.access(account.id), SK.accounts);
      toast('success', 'Access list saved.');
      onClose();
    },
    onError,
  });
  const id = Number(pid);
  const canAdd = name.trim() !== '' && Number.isInteger(id) && id > 0 && !entries.some((e) => e.principal_type === type && e.principal_id === id);
  const add = () => {
    setEntries([...entries, { principal_type: type, principal_id: id, name: name.trim(), level: 'use' }]);
    setName('');
    setPid('');
  };
  return (
    <Modal
      title={`Access · ${account.display_name}`}
      width={600}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save access
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[12.5px] text-ink-3">Use lets someone draft for the account, Publish lets them schedule on it, Manage lets them reconnect it and change this list. Social Admins always manage every account.</p>
      {entries.length ? (
        <ul className="mb-4 flex flex-col divide-y divide-line rounded-[10px] border border-line">
          {entries.map((e, i) => (
            <li key={`${e.principal_type}-${e.principal_id}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-ink">{e.name}</span>
                <span className="text-[11.5px] text-ink-3 capitalize">{e.principal_type}</span>
              </span>
              <NativeSelect label={`Level for ${e.name}`} className="w-56" value={e.level} onChange={(v) => setEntries(entries.map((x, j) => (j === i ? { ...x, level: v as AccessLevel } : x)))}>
                {LEVELS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </NativeSelect>
              <Button size="sm" variant="ghost" onClick={() => setEntries(entries.filter((_, j) => j !== i))} aria-label={`Remove ${e.name}`}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-[13px] text-ink-3">Nobody has been given access yet.</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Type" className="w-28">
          <NativeSelect label="Type" value={type} onChange={(v) => setType(v as AccessEntry['principal_type'])}>
            <option value="user">User</option>
            <option value="team">Team</option>
            <option value="role">Role</option>
          </NativeSelect>
        </Field>
        <Field label="Name" className="min-w-40 flex-1">
          <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="ID" className="w-24">
          <input className={INPUT} inputMode="numeric" value={pid} onChange={(e) => setPid(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Button icon="plus" disabled={!canAdd} onClick={add}>
          Add
        </Button>
      </div>
    </Modal>
  );
}

export function AccessModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const q = useAccess(account.id);
  if (q.isLoading)
    return (
      <Modal title={`Access · ${account.display_name}`} onClose={onClose}>
        <Spinner />
      </Modal>
    );
  if (q.error || (q.data && !q.data.offered))
    return (
      <Modal title={`Access · ${account.display_name}`} onClose={onClose}>
        {q.error ? <Refused error={q.error} /> : <NotOffered what="Account access lists" compact />}
      </Modal>
    );
  return <AccessEditor account={account} initial={dataOf(q.data) ?? []} onClose={onClose} />;
}

export function BrandModal({ account, brands, onClose }: { account: Account; brands: Brand[]; onClose: () => void }) {
  const invalidate = useInvalidate();
  const [brand, setBrand] = useState(account.brand_id ? String(account.brand_id) : '');
  const save = useMutation({
    mutationFn: () => socialApi.updateAccount(account.id, { brand_id: brand ? Number(brand) : null }),
    onSuccess: () => {
      invalidate(SK.accounts, SK.brands);
      toast('success', 'Account moved.');
      onClose();
    },
    onError,
  });
  return (
    <Modal
      title={`Brand · ${account.display_name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={brand === String(account.brand_id ?? '')} onClick={() => save.mutate()}>
            Move
          </Button>
        </>
      }
    >
      <Field label="Brand" hint="Scheduled posts keep their time; the queue and slots of the new brand apply to new ones.">
        <NativeSelect label="Brand" value={brand} onChange={setBrand}>
          <option value="">No brand</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </Modal>
  );
}

export function DisconnectModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const invalidate = useInvalidate();
  const name = useId();
  const [choice, setChoice] = useState<'cancel' | 'hold' | null>(null);
  const go = useMutation({
    mutationFn: (c: 'cancel' | 'hold') => socialApi.disconnect(account.id, c),
    onSuccess: () => {
      invalidate(SK.accounts, SK.status, SK.postsAll, SK.queueAll);
      toast('success', `${account.display_name} disconnected.`);
      onClose();
    },
    onError,
  });
  const options = [
    { id: 'cancel' as const, label: 'Cancel its future posts', hint: 'Scheduled and queued posts for this account are cancelled. Other accounts on the same posts still go out.' },
    { id: 'hold' as const, label: 'Hold its future posts', hint: 'They stay on hold until the account is connected again, or you move them.' },
  ];
  return (
    <Modal
      title={`Disconnect ${account.display_name}?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep connected
          </Button>
          <Button variant="danger" loading={go.isPending} disabled={!choice} onClick={() => choice && go.mutate(choice)}>
            Disconnect
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-ink">Its history stays, read-only: published posts, inbox threads and analytics are kept. WorkSuite revokes its access token at the network.</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[12px] font-semibold text-ink-2">What happens to its future posts? (required)</legend>
        {options.map((o) => (
          <label key={o.id} className={cx('flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2.5', choice === o.id ? 'border-primary bg-selection' : 'border-line')}>
            <input type="radio" name={name} className="mt-0.5 accent-[var(--ws-indigo)]" checked={choice === o.id} onChange={() => setChoice(o.id)} />
            <span>
              <span className="block text-[13px] font-semibold text-ink">{o.label}</span>
              <span className="block text-[12px] text-ink-3">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </Modal>
  );
}
