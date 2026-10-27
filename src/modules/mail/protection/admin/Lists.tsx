import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { errorMessage } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { dateLabel } from '../../../../core/time';
import { toast } from '../../../../core/toasts';
import { Icon } from '../../../../components/Icon';
import { Select } from '../../../../components/Select';
import { Button, ErrorNote, Spinner, cx } from '../../../../components/ui';
import { ApiError } from '../../../../core/api';
import { ADMIN, addListEntry, adminKeys, importListCsv, removeListEntry, saveServerCsv, useAdminLists } from './api';
import { Dot, NO_MANAGE, ProtTop, Segmented, useAdminPerms } from './parts';
import type { ListEntry } from '../types';

/**
 * Admin Center › Protection › Allow & block lists (D24, P-UI-04, MPR-LST, AC-MPR-08): the organisation's, a domain's
 * or a group's allowed and blocked senders; add with type, value, reason and expiry; CSV import and export. An allow
 * for a domain that publishes DMARC p=reject is refused by the server with its explanation, shown as it is; an allow
 * never skips virus or phishing checks. Personal entries moved from the old mail rules are marked as such.
 */

type Scope = 'org' | 'domain' | 'group';
type ValueType = 'address' | 'domain' | 'ip';

/** What the value looks like: an address, a domain, or an IP address or range. */
export function valueTypeOf(v: string): ValueType | null {
  const s = v.trim().toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(s) || /^[0-9a-f:]+(\/\d{1,3})?$/.test(s) && s.includes(':')) return 'ip';
  if (/^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return 'address';
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(s)) return 'domain';
  return null;
}

export function Lists() {
  const perms = useAdminPerms();
  const qc = useQueryClient();
  const [scope, setScope] = useState<Scope>('org');
  const q = useAdminLists(scope);
  const file = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<'allow' | 'block'>('allow');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [expires, setExpires] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const type = valueTypeOf(value);
  const refresh = () => void qc.invalidateQueries({ queryKey: adminKeys.lists(scope) });
  const add = async () => {
    if (!type) return;
    setBusy(true);
    setRefusal(null);
    try {
      await addListEntry({ scope, kind, value_type: type, value: value.trim().toLowerCase(), ...(reason.trim() ? { reason: reason.trim() } : {}), expires_at: expires || null });
      setValue('');
      setReason('');
      setExpires('');
      refresh();
    } catch (e) {
      // The DMARC refusal (and any other) in the server's own words, beside the form (AC-MPR-08).
      if (e instanceof ApiError && e.status === 422) setRefusal(e.message);
      else toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const importCsv = async (f: File) => {
    try {
      const r = await importListCsv(scope, f);
      toast('success', text('{n} entries added, {m} skipped.', { n: r.added, m: r.skipped }));
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const remove = async (e: ListEntry) => {
    try {
      await removeListEntry(e.id);
      refresh();
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };
  const entries = q.data ?? [];
  const migrated = entries.filter((e) => e.migrated).length;
  const noManage = perms.manage ? undefined : text(NO_MANAGE);
  return (
    <div className="flex flex-col gap-3.5">
      <ProtTop
        tab="lists"
        actions={
          <>
            <input ref={file} type="file" accept=".csv,text/csv" hidden aria-hidden onChange={(e) => (e.target.files?.[0] ? void importCsv(e.target.files[0]).then(() => (e.target.value = '')) : undefined)} />
            <Button disabled={!perms.manage} title={noManage} onClick={() => file.current?.click()}>{text('Import CSV')}</Button>
            <Button onClick={() => void saveServerCsv(`${ADMIN}/lists/export`, { scope }, `WorkSuite ${scope} allow and block list`).catch((e) => toast('error', errorMessage(e)))}>{text('Export')}</Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label={text('Scope')} value={scope} options={[['org', text('Organisation')], ['domain', text('Domains')], ['group', text('Groups')]]} onChange={setScope} />
        <span className="text-[12px] text-ink-3">{text('Order: organisation block › organisation allow › user block › user allow › filter. Allow never skips virus or phishing checks.')}</span>
      </div>
      <section aria-labelledby="add-entry" className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface px-4 py-3.5">
        <h2 id="add-entry" className="text-[14px] font-bold text-ink">{text('Add entry')}</h2>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Select aria-label={text('Allow or block')} value={kind} options={[{ value: 'allow', label: text('Allow') }, { value: 'block', label: text('Block') }]} onValueChange={(v) => setKind(v as 'allow' | 'block')} disabled={!perms.manage} className="h-8 w-[100px]" />
          <input aria-label={text('Address, domain or IP')} aria-invalid={!!value && !type} placeholder={text('name@company.com, company.com or 203.0.113.0/24')} value={value} onChange={(e) => (setValue(e.target.value), setRefusal(null))} disabled={!perms.manage} className={cx('h-8 min-w-[220px] flex-1 rounded-[8px] border bg-surface px-2.5 text-[12.5px] text-ink', refusal || (value && !type) ? 'border-danger' : 'border-line')} />
          <span className="w-[70px] text-[12px] text-ink-3">{type === 'ip' ? text('IP') : type === 'domain' ? text('Domain') : type === 'address' ? text('Address') : ''}</span>
          <input aria-label={text('Reason')} placeholder={text('Reason')} value={reason} onChange={(e) => setReason(e.target.value)} disabled={!perms.manage} className="h-8 w-[200px] rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] text-ink" />
          <input type="date" aria-label={text('Expires')} value={expires} onChange={(e) => setExpires(e.target.value)} disabled={!perms.manage} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12.5px] text-ink" />
          <Button type="submit" variant="primary" loading={busy} disabled={!perms.manage || !type} title={noManage}>{text('Add')}</Button>
        </form>
        {refusal ? (
          <div role="alert" data-list-refusal className="flex gap-2.5 rounded-[10px] bg-danger-bg px-3 py-2.5 text-[12.5px] leading-[1.45] text-danger-ink">
            <Icon name="shield-alert" size={16} className="mt-px shrink-0" />
            <span>
              <b>{text('Can’t {kind} {value}.', { kind: kind === 'allow' ? text('allow') : text('block'), value: value.trim() })}</b> {refusal}
            </span>
          </div>
        ) : null}
      </section>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : (
        <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
          {(['allow', 'block'] as const).map((k) => {
            const rows = entries.filter((e) => e.kind === k);
            return (
              <section key={k} aria-label={k === 'allow' ? text('Allowed senders') : text('Blocked senders')} className="flex flex-col rounded-[12px] border border-line bg-surface">
                <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                  <Dot tone={k === 'allow' ? 'ok' : 'danger'} />
                  <b className="flex-1 text-[14px] text-ink">{k === 'allow' ? text('Allowed senders') : text('Blocked senders')}</b>
                  <span className="text-[12px] text-ink-3">{text('{n} entries', { n: rows.length })}</span>
                </div>
                <div role="table" className="flex flex-col text-[12.5px]">
                  <div role="row" className="grid grid-cols-[minmax(0,1.4fr)_80px_minmax(0,1fr)_80px_28px] gap-2 px-4 py-1.5 text-[11.5px] font-semibold text-ink-3">
                    {['Entry', 'Type', 'Reason', 'Expires', ''].map((h, i) => <span key={i} role="columnheader">{h ? text(h) : ''}</span>)}
                  </div>
                  {rows.length === 0 ? <p className="px-4 py-2 text-ink-3">{text('None.')}</p> : null}
                  {rows.map((e) => (
                    <div key={e.id} role="row" className="grid grid-cols-[minmax(0,1.4fr)_80px_minmax(0,1fr)_80px_28px] items-center gap-2 border-t border-line px-4 py-1.5">
                      <span role="cell" className="flex min-w-0 flex-col">
                        <b className="truncate text-ink">{e.value}</b>
                        <span className="truncate text-[11.5px] text-ink-3">{e.migrated ? text('From the old mail rules') : [e.created_by, e.created_at ? dateLabel(e.created_at) : null].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span role="cell" className="text-ink-2">{e.value_type === 'ip' ? text('IP range') : e.value_type === 'domain' ? text('Domain') : text('Address')}</span>
                      <span role="cell" className="truncate text-ink-2">{e.reason ?? ''}</span>
                      <span role="cell" className="text-ink-3">{e.expires_at ? dateLabel(e.expires_at) : '—'}</span>
                      <span role="cell">
                        {perms.manage ? (
                          <button type="button" aria-label={text('Remove {value}', { value: e.value })} onClick={() => void remove(e)} className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-danger">
                            <Icon name="x" size={13} />
                          </button>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {migrated ? (
        <p className="flex gap-2 rounded-[10px] bg-info-bg px-3 py-2.5 text-[12px] text-blue-ink dark:bg-blue-bg dark:text-indigo-bright">
          <Icon name="info" size={14} className="mt-px shrink-0" />
          {text('{n} safe and blocked senders from the old mail rules were moved here. WorkSuite mail server rules still apply them.', { n: migrated })}
        </p>
      ) : null}
    </div>
  );
}
