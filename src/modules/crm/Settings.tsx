import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPut } from '../../core/api';
import { app } from '../../core/app-state';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { btnPrimary, Field, input } from '../hr/parts';
import type { CrmSettings } from './api';
import { crmCan } from './parts';
import { PipelinesEditor } from './Pipelines';
import { SectionHeader, SettingsGroup } from '../../components/SettingsKit';

/**
 * CRM settings (CrmAdminSheet · General): quote numbering, the default
 * currency, how long a quote is valid, when a deal counts as stalled, and the
 * company details printed on quotes. They are the installation's, not one
 * company's. Below them, Pipelines and stages (W12) for the company the CRM
 * is showing. Only somebody with CRM settings can change them; everyone else
 * sees them read-only.
 */
export default function Settings() {
  const qc = useQueryClient();
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const canEdit = crmCan(perms, 'crm.settings');
  const q = useQuery({ queryKey: ['crm', 'settings'], queryFn: ({ signal }) => apiGet<{ settings: CrmSettings }>('/api/crm/settings', undefined, signal) });
  const [draft, setDraft] = useState<CrmSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const s = draft ?? q.data?.settings ?? null;
  const set = <K extends keyof CrmSettings>(k: K, v: CrmSettings[K]) => s && setDraft({ ...s, [k]: v });
  const save = async () => {
    if (!s || busy) return;
    setBusy(true);
    try {
      const { letterhead_configured: _ignored, ...body } = s;
      await apiPut('/api/crm/settings', body);
      toast('success', 'CRM settings saved.');
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['crm', 'settings'] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const text = (k: keyof CrmSettings, label: string, hint?: string, className?: string) => (
    <Field label={label} hint={hint} className={className}>
      <input value={String(s?.[k] ?? '')} disabled={!canEdit} onChange={(e) => set(k, e.target.value as never)} aria-label={label} className={input} />
    </Field>
  );
  const num = (k: 'number_pad' | 'quote_valid_days' | 'stale_deal_days', label: string, min: number, max: number, hint?: string) => (
    <Field label={label} hint={hint}>
      <input type="number" min={min} max={max} value={s?.[k] ?? ''} disabled={!canEdit} onChange={(e) => set(k, Math.max(min, Math.min(max, Number(e.target.value) || min)))} aria-label={label} className={input} />
    </Field>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scroll-thin">
      <SectionHeader
        level={1}
        title="CRM settings"
        hint={canEdit ? 'For the whole installation' : 'Read-only — somebody with CRM settings can change these'}
        actions={
          canEdit ? (
            <button type="button" className={btnPrimary} disabled={!draft || busy} onClick={() => void save()}>
              Save
            </button>
          ) : null
        }
      />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {s ? (
        <div className="flex max-w-[760px] flex-col">
          <SettingsGroup title="Quotes">
            <div className="grid grid-cols-3 gap-3 px-[18px] py-3.5">
              {text('quote_prefix', 'Quote prefix', 'Letters and digits')}
              {num('number_pad', 'Number padding', 1, 8, `${s.quote_prefix || 'QUO'}-${'1'.padStart(s.number_pad || 4, '0')}`)}
              <Field label="Default currency">
                <Select label="Default currency" value={s.default_currency} disabled={!canEdit} onValueChange={(v) => set('default_currency', v)} options={[...new Set(['LKR', 'USD', 'EUR', 'GBP', 'AUD', 'INR', s.default_currency])].map((c) => ({ value: c, label: c }))} />
              </Field>
              {num('quote_valid_days', 'Quote valid days', 1, 365)}
              {num('stale_deal_days', 'Stale deal days', 1, 365, 'A deal with no stage change this long counts as stalled')}
            </div>
          </SettingsGroup>
          <SettingsGroup title="Company on quotes">
            <div className="flex flex-col gap-3 px-[18px] py-3.5">
            <div className="grid grid-cols-2 gap-3">
              {text('company_name', 'Company name')}
              {text('company_tax_no', 'Tax no.')}
              {text('company_address', 'Address', undefined, 'col-span-2')}
              {text('company_phone', 'Phone')}
              {text('company_email', 'Email')}
            </div>
            <span className={cx('flex items-center gap-1.5 text-[12px]', s.letterhead_configured ? 'text-success' : 'text-ink-3')}>
              <Icon name={s.letterhead_configured ? 'check' : 'info'} size={13} />
              {s.letterhead_configured ? 'Quotes print with this letterhead.' : 'Quotes print without a letterhead until a company name is set.'}
            </span>
            </div>
          </SettingsGroup>
          <SettingsGroup title="Terms">
            <div className="px-[18px] py-3.5">
            <Field label="Quote terms" hint="Printed on quotes that have none of their own">
              <textarea value={s.quote_terms} disabled={!canEdit} onChange={(e) => set('quote_terms', e.target.value)} rows={4} aria-label="Quote terms" className={cx(input, 'h-auto py-2')} />
            </Field>
            </div>
          </SettingsGroup>
        </div>
      ) : null}
      {q.data || q.error ? (
        <SettingsGroup className="max-w-[760px]">
          <div className="px-[18px] py-3.5 flex flex-col gap-3">
          <PipelinesEditor canEdit={canEdit} />
          </div>
        </SettingsGroup>
      ) : null}
    </div>
  );
}

interface ModuleAccess {
  label: string;
  permissions: Array<{ slug: string; name: string; held: boolean }>;
  held: number;
  of: number;
  why: string;
}

/**
 * My access · CRM: what this person may do here, read-only. `crm.manage`
 * implies every CRM right but viewing, which the server's list does not
 * show, so it is worked out here the way the server checks it.
 */
export function Access() {
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const q = useQuery({ queryKey: ['crm', 'access'], queryFn: ({ signal }) => apiGet<ModuleAccess>('/api/access/module/Crm', undefined, signal) });
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scroll-thin">
      <SectionHeader level={1} title="My access · CRM" hint="Read-only. Ask an administrator to change what you can do." />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <SettingsGroup className="max-w-[640px]">
          <div className="flex flex-col">
          {q.data.why ? <p className="m-0 border-b border-line px-4 py-3 text-[12.5px] text-ink-2">{q.data.why}</p> : null}
          {q.data.permissions.map((p) => {
            const has = crmCan(perms, p.slug);
            return (
              <div key={p.slug} className="flex items-center gap-3 border-b border-line/60 px-4 py-2.5 text-[13px] last:border-b-0">
                <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', has ? 'bg-success-bg text-success-ink dark:bg-success-bg dark:text-success' : 'bg-subtle text-ink-3')}>
                  <Icon name={has ? 'check' : 'minus'} size={13} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="text-ink">{p.name}</b>
                  <span className="font-mono text-[11.5px] text-ink-3">{p.slug}</span>
                </span>
                <span className="text-[12px] text-ink-3">{has ? (p.held ? 'Granted' : 'Through Manage CRM') : 'Not granted'}</span>
              </div>
            );
          })}
          </div>
        </SettingsGroup>
      ) : null}
    </div>
  );
}
