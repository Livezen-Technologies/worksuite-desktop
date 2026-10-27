import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { apiPost, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button, cx } from '../../components/ui';
import { COUNTRIES, SOCIAL, TYPES, bodyOf, formOf, type ContactDetail, type ContactForm, type Group } from './api';
import { Select } from '../../components/Select';

type Text = Exclude<keyof ContactForm, 'social' | 'group_ids' | 'type'>;

const input = 'h-[34px] w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-medium text-ink outline-none focus:border-primary';

/** New or edit contact (ContactEdit): every field the web keeps, in its sections. */
export function EditDrawer({ contact, defaults, groups, onClose, onSaved }: { contact: ContactDetail | null; defaults?: Partial<ContactForm>; groups: Group[]; onClose: () => void; onSaved: (id: number) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<ContactForm>(() => formOf(contact, defaults));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const named = !!(f.first_name.trim() || f.last_name.trim() || f.display_name.trim());

  const set = <K extends keyof ContactForm>(k: K, v: ContactForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const text = (k: Text, label: string, opts: { wide?: boolean; type?: string; placeholder?: string; auto?: string } = {}) => (
    <Field label={label} wide={opts.wide}>
      <input type={opts.type ?? 'text'} value={f[k]} autoComplete={opts.auto ?? 'off'} placeholder={opts.placeholder} maxLength={255} onChange={(e) => set(k, e.target.value)} className={input} />
    </Field>
  );

  const save = async () => {
    if (!named) return setError('Give the contact a name.');
    setSaving(true);
    setError(null);
    try {
      const body = bodyOf(f);
      const r = contact ? await apiPut<ContactDetail>(`/api/contacts/${contact.id}`, body) : await apiPost<ContactDetail>('/api/contacts', body);
      toast('success', contact ? 'Contact saved' : 'Contact created');
      void qc.invalidateQueries({ queryKey: ['contacts'] });
      onSaved(r.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="no-drag absolute inset-0 z-20 bg-navy/[.18]" onMouseDown={onClose} />
      <aside
        role="dialog"
        aria-label={contact ? 'Edit contact' : 'New contact'}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save();
        }}
        className="no-drag absolute top-0 right-0 bottom-0 z-30 flex w-[448px] max-w-full flex-col border-l border-line bg-surface text-[13px] shadow-[-20px_0_50px_rgb(var(--ws-shadow-rgb)/.14)]"
      >
        <div className="flex items-center border-b border-line px-4 py-3.5">
          <b className="flex-1 text-[15px] text-ink">{contact ? 'Edit contact' : 'New contact'}</b>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[16px] text-ink-2 hover:bg-subtle">×</button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2.5 overflow-y-auto px-4 py-3.5 scroll-thin">
          <Field label="First name">
            <input autoFocus value={f.first_name} maxLength={100} onChange={(e) => set('first_name', e.target.value)} className={input} />
          </Field>
          {text('last_name', 'Last name')}
          {text('display_name', 'Display name', { wide: true, placeholder: 'Auto from first + last' })}
          <Field label="Type">
            <Select value={f.type} onChange={(e) => set('type', e.target.value as ContactForm['type'])} className={input}>
              {TYPES.filter((t) => t.id !== 'shared' || f.type === 'shared').map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </Select>
          </Field>
          {text('birthday', 'Birthday', { type: 'date' })}
          {text('job_title', 'Job title')}
          {text('department', 'Department')}
          {text('company', 'Company', { wide: true, auto: 'organization' })}
          <Heading>COMMUNICATION</Heading>
          {text('work_email', 'Work email', { type: 'email' })}
          {text('personal_email', 'Personal email', { type: 'email' })}
          {text('mobile', 'Mobile', { type: 'tel' })}
          {text('office_phone', 'Office phone', { type: 'tel' })}
          {text('home_phone', 'Home phone', { type: 'tel' })}
          {text('website', 'Website')}
          <Heading>ADDRESS</Heading>
          {text('street', 'Street', { wide: true })}
          {text('city', 'City')}
          {text('state', 'State')}
          {text('zip', 'ZIP')}
          <Field label="Country">
            <Select value={f.country} onChange={(e) => set('country', e.target.value)} className={input}>
              <option value="">—</option>
              {(f.country && !COUNTRIES.includes(f.country) ? [f.country, ...COUNTRIES] : COUNTRIES).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Heading>BUSINESS</Heading>
          {text('customer_id', 'Customer ID')}
          {text('employee_id', 'Employee ID')}
          {text('vendor_id', 'Vendor ID')}
          {text('tax_number', 'Tax number')}
          <Heading>SOCIAL</Heading>
          {SOCIAL.map((s, i) => (
            <Field key={s.key} label={s.label} wide={i === SOCIAL.length - 1}>
              <input value={f.social[s.key] ?? ''} maxLength={255} onChange={(e) => set('social', { ...f.social, [s.key]: e.target.value })} className={input} />
            </Field>
          ))}
          <Heading>GROUPS</Heading>
          <div className="col-span-2 flex flex-wrap gap-1.5">
            {groups.length ? (
              groups.map((g) => {
                const on = f.group_ids.includes(g.id);
                return (
                  <button key={g.id} type="button" aria-pressed={on} onClick={() => set('group_ids', on ? f.group_ids.filter((x) => x !== g.id) : [...f.group_ids, g.id])} className={cx('h-7 rounded-[14px] px-[11px] text-[12px] font-semibold', on ? 'bg-primary text-white' : 'border border-line bg-surface text-ink hover:bg-subtle')}>
                    {g.name}
                  </button>
                );
              })
            ) : (
              <span className="text-[12px] text-ink-3">No groups yet. Add one from the + beside Groups.</span>
            )}
          </div>
          {text('labels', 'Labels (comma-separated)', { wide: true, placeholder: 'VIP, Prospect' })}
          <Field label="Notes" wide>
            <textarea value={f.notes} maxLength={5000} onChange={(e) => set('notes', e.target.value)} className="h-[70px] w-full resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] font-medium text-ink outline-none focus:border-primary" />
          </Field>
        </div>
        {error ? <p role="alert" className="mx-4 mb-0 rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={saving || !named} onClick={() => void save()}>Save</Button>
        </div>
      </aside>
    </>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={cx('flex min-w-0 flex-col gap-1 text-[12.5px] font-semibold text-ink', wide && 'col-span-2')}>
      {label}
      {children}
    </label>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <div className="col-span-2 mt-2 text-[11px] font-bold tracking-[0.6px] text-ink-2">{children}</div>;
}
