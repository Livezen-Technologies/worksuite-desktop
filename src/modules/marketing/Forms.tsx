import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { cx, ErrorNote, Spinner } from '../../components/ui';
import { send, withOrg } from './api';
import { useLists } from './audience-parts';
import { BlockEditor } from './email-BlockEditor';
import { useNames } from './automation-parts';
import { btn, btnPrimary, btnSmall, Card, Empty, Field, input, n, PageHeader, Pill, Sheet } from './parts';
import { companiesWhere, refusal, type Options } from './types';

interface FormField { key: string; label: string; type: string; required: boolean; options: string[] | null }
interface Rates { views: number; submissions: number; conversion: number | null }
interface MarketingForm {
  id: number; org_id: number; name: string; status: 'draft' | 'published' | 'archived'; fields: FormField[]; list_id: number | null; list_name: string | null;
  topic_ids: number[]; tags: string[]; consent_wording: string | null; double_opt_in: boolean | null; submit_label: string | null; success_message: string | null;
  redirect_url: string | null; stats: Rates; embed: { script: string; iframe: string; url: string }; updated_at: string | null;
}
interface FormDetail extends MarketingForm {
  may_manage: boolean;
  report: { stats: Rates & { spam: number }; days: Array<{ date: string; views: number; submissions: number }>; submissions: Array<{ id: number; status: string; contact: { name: string } | null; data: Record<string, unknown>; utm: Record<string, string>; at: string | null }> };
}
interface LandingPage {
  id: number; org_id: number; name: string; slug: string; status: 'draft' | 'published' | 'archived'; title: string | null; meta_description: string | null;
  form_id: number | null; form_name: string | null; custom_domain: string | null; url: string; stats: Rates; updated_at: string | null; body_html?: string;
}

const TONE = { draft: 'slate', published: 'green', archived: 'slate' } as const;
const TARGETS: Array<{ value: string; label: string }> = ([['email', 'Email'], ['first_name', 'First name'], ['last_name', 'Last name'], ['phone', 'Telephone'], ['whatsapp', 'WhatsApp'],
  ['company', 'Company'], ['job_title', 'Job title'], ['industry', 'Industry'], ['city', 'City'], ['country', 'Country'], ['language', 'Language']] as const).map(([value, label]) => ({ value, label }));

/**
 * Forms and landing pages (MKT-FRM-01..05), as on the web: sign-ups straight
 * into Marketing on a list and in topics, consent kept in the exact words
 * shown, embedded by script, iframe or hosted address; landing pages built
 * from the email block editor's blocks around one form. What a sign-up does,
 * and whether it is a robot, is the server's.
 */
export default function Forms({ org, options }: { org: string; options: Options }) {
  const [tab, setTab] = useState<'forms' | 'pages'>('forms');
  const [open, setOpen] = useState<{ kind: 'forms' | 'pages'; id: number } | null>(null);
  if (open?.kind === 'forms') return <FormEditor id={open.id} options={options} onBack={() => setOpen(null)} />;
  if (open?.kind === 'pages') return <PageEditor id={open.id} org={org} options={options} onBack={() => setOpen(null)} />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader crumbs={['Automation']} title="Forms & landing pages" sub="Sign-ups straight into Marketing, with consent recorded word for word" />
      <div className="flex gap-1.5" role="tablist" aria-label="Forms or pages">
        {(['forms', 'pages'] as const).map((t) => <button key={t} role="tab" type="button" aria-selected={tab === t} className={cx(btnSmall, tab === t && 'border-primary text-primary')} onClick={() => setTab(t)}>{t === 'forms' ? 'Forms' : 'Landing pages'}</button>)}
      </div>
      {tab === 'forms' ? <FormList org={org} options={options} onOpen={(id) => setOpen({ kind: 'forms', id })} /> : <PageList org={org} options={options} onOpen={(id) => setOpen({ kind: 'pages', id })} />}
    </div>
  );
}

function NameSheet({ title, onClose, onMake }: { title: string; onClose: () => void; onMake: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <Sheet title={title} onClose={onClose} footer={<><button type="button" className={btn} onClick={onClose}>Cancel</button><button type="button" className={btnPrimary} disabled={!name.trim()} onClick={() => onMake(name.trim())}>Create</button></>}>
      <Field label="Name"><input className={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
    </Sheet>
  );
}

function FormList({ org, options, onOpen }: { org: string; options: Options; onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const [naming, setNaming] = useState(false);
  const q = useQuery({ queryKey: ['marketing', 'forms', org], queryFn: ({ signal }) => apiGet<{ items: MarketingForm[] }>('/api/marketing/forms', withOrg(org), signal), retry: false });
  const makers = companiesWhere(options, 'forms');
  const make = async (name: string) => {
    try {
      const r = await send<{ id?: number }>('POST', '/api/marketing/forms', { org_id: Number(org.split(',')[0]) || makers[0]?.id, name });
      setNaming(false);
      await qc.invalidateQueries({ queryKey: ['marketing', 'forms'] });
      onOpen(Number(r.data?.id ?? 0));
    } catch (e) {
      toast('error', refusal(e));
    }
  };
  return (
    <>
      {makers.length ? <div className="flex justify-end"><button type="button" className={btnPrimary} onClick={() => setNaming(true)}><Icon name="plus" size={15} /> New form</button></div> : null}
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : !q.data?.items.length ? <Card><Empty text="No forms yet. Put a sign-up form on your website: it adds people here, on a list, with their consent." /></Card> : (
        <Card padded={false}>
          <table className="w-full text-left text-[12.5px]">
            <thead className="text-[11px] text-ink-3 uppercase"><tr><th scope="col" className="px-4 py-2">Form</th><th scope="col">Status</th><th scope="col">List</th><th scope="col" className="text-right">Views</th><th scope="col" className="text-right">Sign-ups</th><th scope="col" className="pr-4 text-right">Conversion</th></tr></thead>
            <tbody>
              {q.data.items.map((f) => (
                <tr key={f.id} className="border-t border-line">
                  <td className="px-4 py-2"><button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpen(f.id)}>{f.name}</button></td>
                  <td><Pill tone={TONE[f.status]}>{f.status}</Pill></td>
                  <td className="text-ink-2">{f.list_name ?? '—'}</td>
                  <td className="text-right tabular-nums">{n(f.stats.views)}</td>
                  <td className="text-right tabular-nums">{n(f.stats.submissions)}</td>
                  <td className="pr-4 text-right tabular-nums">{f.stats.conversion === null ? '—' : `${f.stats.conversion}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {naming ? <NameSheet title="New form" onClose={() => setNaming(false)} onMake={(x) => void make(x)} /> : null}
    </>
  );
}

function Copy({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px] font-semibold text-ink-3">
        {label}
        <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => { void navigator.clipboard?.writeText(text).then(() => toast('success', 'Copied.')); }}><Icon name="copy" size={12} /> Copy</button>
      </div>
      <pre className="m-0 overflow-x-auto rounded-[8px] bg-subtle p-2 text-[11.5px] break-all whitespace-pre-wrap text-ink-2">{text}</pre>
    </div>
  );
}

function FormEditor({ id, options, onBack }: { id: number; options: Options; onBack: () => void }) {
  const q = useQuery({ queryKey: ['marketing', 'form', id], queryFn: ({ signal }) => apiGet<FormDetail>(`/api/marketing/forms/${id}`, undefined, signal), retry: false });
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorNote error={q.error ?? new Error('That form could not be loaded.')} />;
  return <FormBody key={`${q.data.id}-${q.data.updated_at ?? ''}`} form={q.data} options={options} onBack={onBack} />;
}

function FormBody({ form, options, onBack }: { form: FormDetail; options: Options; onBack: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState(form);
  const [busy, setBusy] = useState(false);
  const lists = useLists(String(form.org_id));
  const custom = (options.import_targets ?? []).filter((p) => p.value.startsWith('custom:')).map((p) => ({ value: `custom.${p.value.slice(7)}`, label: p.label }));
  const targets = [...TARGETS, ...custom];
  const may = form.may_manage;
  const setField = (i: number, patch: Partial<FormField>) => setF({ ...f, fields: f.fields.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const save = async (status?: MarketingForm['status']) => {
    setBusy(true);
    try {
      const r = await send('PUT', `/api/marketing/forms/${form.id}`, { name: f.name, fields: f.fields, list_id: f.list_id, topic_ids: f.topic_ids, tags: f.tags, consent_wording: f.consent_wording,
        double_opt_in: f.double_opt_in, submit_label: f.submit_label, success_message: f.success_message, redirect_url: f.redirect_url, ...(status ? { status } : {}) });
      toast('success', r.message ?? 'Saved.');
      await qc.invalidateQueries({ queryKey: ['marketing'] });
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader crumbs={['Automation', 'Forms']} onCrumb={onBack} title={f.name} sub={<Pill tone={TONE[form.status]}>{form.status}</Pill>}
        actions={may ? (
          <>
            <button type="button" className={btn} onClick={onBack}>Back</button>
            <button type="button" className={btn} disabled={busy} onClick={() => void save()}>Save</button>
            {form.status !== 'published' ? <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save('published')}>Publish</button> : <button type="button" className={btn} disabled={busy} onClick={() => void save('draft')}>Unpublish</button>}
          </>
        ) : <button type="button" className={btn} onClick={onBack}>Back</button>} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Fields">
            <Field label="Name"><input className={input} disabled={!may} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <ol className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
              {f.fields.map((x, i) => (
                <li key={`${x.key}-${i}`} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line p-2">
                  <Select<string> aria-label={`Field ${i + 1}: fills in`} value={x.key} disabled={!may} className="w-[160px]" onValueChange={(v) => setField(i, { key: v, label: targets.find((t) => t.value === v)?.label ?? v })} options={targets} />
                  <input aria-label={`Field ${i + 1}: label`} className={cx(input, '!w-40')} disabled={!may} value={x.label} onChange={(e) => setField(i, { label: e.target.value })} />
                  <input aria-label={`Field ${i + 1}: options`} className={cx(input, '!w-48')} disabled={!may} value={(x.options ?? []).join(', ')} placeholder="Options, with commas" onChange={(e) => setField(i, { options: e.target.value.trim() ? e.target.value.split(',').map((o) => o.trim()).filter(Boolean) : null })} />
                  <label className="flex items-center gap-1 text-[12px] text-ink-2"><input type="checkbox" disabled={!may} checked={x.required} onChange={(e) => setField(i, { required: e.target.checked })} /> Required</label>
                  {may ? <button type="button" aria-label={`Remove field ${i + 1}`} className="ml-auto text-ink-3 hover:text-danger" onClick={() => setF({ ...f, fields: f.fields.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button> : null}
                </li>
              ))}
            </ol>
            {may ? <button type="button" className={cx(btnSmall, 'mt-2 gap-1')} disabled={f.fields.length >= 20} onClick={() => setF({ ...f, fields: [...f.fields, { key: 'last_name', label: 'Last name', type: 'text', required: false, options: null }] })}><Icon name="plus" size={13} /> Add field</button> : null}
          </Card>
          <Card title="What a sign-up does">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Put them on the list"><Select<string> aria-label="List" value={f.list_id ? String(f.list_id) : ''} disabled={!may} onValueChange={(v) => setF({ ...f, list_id: v ? Number(v) : null })} options={[{ value: '', label: 'No list' }, ...(lists.data?.items ?? []).filter((l) => l.org_id === form.org_id).map((l) => ({ value: String(l.id), label: l.name }))]} /></Field>
              <Field label="Tags (with commas)"><input className={input} disabled={!may} value={f.tags.join(', ')} onChange={(e) => setF({ ...f, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} /></Field>
              <Field label="Consent wording (kept word for word)" className="sm:col-span-2"><textarea className={cx(input, '!h-auto py-1.5')} rows={2} disabled={!may} value={f.consent_wording ?? ''} onChange={(e) => setF({ ...f, consent_wording: e.target.value })} /></Field>
              <Field label="Double opt-in"><Select<string> aria-label="Double opt-in" value={f.double_opt_in === null ? '' : f.double_opt_in ? '1' : '0'} disabled={!may} onValueChange={(v) => setF({ ...f, double_opt_in: v === '' ? null : v === '1' })} options={[{ value: '', label: 'As the company’s setting' }, { value: '1', label: 'Always ask to confirm' }, { value: '0', label: 'Never for this form' }]} /></Field>
              <Field label="Button"><input className={input} disabled={!may} value={f.submit_label ?? ''} placeholder="Sign up" onChange={(e) => setF({ ...f, submit_label: e.target.value })} /></Field>
              <Field label="Thank-you message"><input className={input} disabled={!may} value={f.success_message ?? ''} onChange={(e) => setF({ ...f, success_message: e.target.value })} /></Field>
              <Field label="…or go to this page"><input className={input} disabled={!may} value={f.redirect_url ?? ''} placeholder="https://" onChange={(e) => setF({ ...f, redirect_url: e.target.value })} /></Field>
            </div>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card title="Put it on a website">
            {form.status !== 'published' ? <p className="m-0 mb-2 text-[12px] text-warning">Publish the form first: a draft takes no sign-ups.</p> : null}
            <div className="flex flex-col gap-3"><Copy label="Script (recommended)" text={form.embed.script} /><Copy label="Iframe" text={form.embed.iframe} /><Copy label="Hosted page" text={form.embed.url} /></div>
          </Card>
          <Card title="Last 30 days">
            <p className="m-0 text-[12.5px] text-ink-2">{n(form.report.stats.views)} views · {n(form.report.stats.submissions)} sign-ups · {form.report.stats.conversion === null ? '—' : `${form.report.stats.conversion}%`} · {n(form.report.stats.spam)} spam</p>
          </Card>
          <Card title="Latest sign-ups">
            {!form.report.submissions.length ? <Empty text="None yet." /> : (
              <ul className="m-0 list-none p-0 text-[12.5px]">
                {form.report.submissions.slice(0, 12).map((s) => <li key={s.id} className="border-b border-line/70 py-1 last:border-b-0"><b className="text-ink">{s.contact?.name ?? String(s.data.email ?? '—')}</b> <span className="text-ink-3">{s.at ? dateLabel(s.at) : ''}{s.utm.utm_source ? ` · ${s.utm.utm_source}` : ''}</span></li>)}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function PageList({ org, options, onOpen }: { org: string; options: Options; onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const [naming, setNaming] = useState(false);
  const q = useQuery({ queryKey: ['marketing', 'pages', org], queryFn: ({ signal }) => apiGet<{ items: LandingPage[] }>('/api/marketing/pages', withOrg(org), signal), retry: false });
  const makers = companiesWhere(options, 'forms');
  const make = async (name: string) => {
    try {
      const r = await send<{ id?: number }>('POST', '/api/marketing/pages', { org_id: Number(org.split(',')[0]) || makers[0]?.id, name, slug: `${name}-${Date.now().toString(36).slice(-4)}`, body_html: `<h1>${name.replace(/</g, '')}</h1><p>Tell people why to sign up.</p>` });
      setNaming(false);
      await qc.invalidateQueries({ queryKey: ['marketing', 'pages'] });
      onOpen(Number(r.data?.id ?? 0));
    } catch (e) {
      toast('error', refusal(e));
    }
  };
  return (
    <>
      {makers.length ? <div className="flex justify-end"><button type="button" className={btnPrimary} onClick={() => setNaming(true)}><Icon name="plus" size={15} /> New landing page</button></div> : null}
      {q.isLoading ? <Spinner /> : !q.data?.items.length ? <Card><Empty text="No landing pages yet: a page of its own around a sign-up form, for an advert or a QR code." /></Card> : (
        <ul className="m-0 grid list-none gap-3 p-0 lg:grid-cols-2">
          {q.data.items.map((p) => (
            <li key={p.id} className="rounded-[12px] border border-line bg-surface p-3.5">
              <div className="flex items-start gap-2"><button type="button" className="min-w-0 flex-1 truncate text-left font-semibold text-primary hover:underline" onClick={() => onOpen(p.id)}>{p.name}</button><Pill tone={TONE[p.status]}>{p.status}</Pill></div>
              <p className="m-0 truncate text-[12px] text-ink-3">{p.url}{p.form_name ? ` · form: ${p.form_name}` : ''}</p>
              <p className="m-0 mt-1 text-[12.5px] text-ink-2">{n(p.stats.views)} views · {n(p.stats.submissions)} sign-ups · {p.stats.conversion === null ? '—' : `${p.stats.conversion}%`}</p>
            </li>
          ))}
        </ul>
      )}
      {naming ? <NameSheet title="New landing page" onClose={() => setNaming(false)} onMake={(x) => void make(x)} /> : null}
    </>
  );
}

function PageEditor({ id, org, options, onBack }: { id: number; org: string; options: Options; onBack: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['marketing', 'page', id], queryFn: ({ signal }) => apiGet<LandingPage>(`/api/marketing/pages/${id}`, undefined, signal), retry: false });
  const forms = useNames('forms', org || String(q.data?.org_id ?? ''));
  const [p, setP] = useState<LandingPage | null>(null);
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (!q.data) return <ErrorNote error={q.error ?? new Error('That page could not be loaded.')} />;
  const page = p ?? q.data;
  const may = companiesWhere(options, 'forms').some((c) => c.id === page.org_id);
  const save = async (status?: LandingPage['status']) => {
    setBusy(true);
    try {
      const r = await send('PUT', `/api/marketing/pages/${page.id}`, { name: page.name, slug: page.slug, title: page.title, meta_description: page.meta_description, form_id: page.form_id, custom_domain: page.custom_domain, body_html: page.body_html ?? '', ...(status ? { status } : {}) });
      toast('success', r.message ?? 'Saved.');
      setP(null);
      await qc.invalidateQueries({ queryKey: ['marketing', 'page', id] });
      await qc.invalidateQueries({ queryKey: ['marketing', 'pages'] });
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader crumbs={['Automation', 'Landing pages']} onCrumb={onBack} title={page.name} sub={<span className="inline-flex items-center gap-2"><Pill tone={TONE[q.data.status]}>{q.data.status}</Pill>{page.url}</span>}
        actions={<><button type="button" className={btn} onClick={onBack}>Back</button>{may ? <button type="button" className={btn} disabled={busy} onClick={() => void save()}>Save</button> : null}{may && q.data.status !== 'published' ? <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save('published')}>Publish</button> : null}</>} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0"><BlockEditor initial={q.data.body_html ?? ''} onChange={(html) => setP({ ...page, body_html: html })} orgId={page.org_id} mergeTags={[]} readOnly={!may} /></div>
        <Card title="Page">
          <div className="flex flex-col gap-3">
            <Field label="Name"><input className={input} disabled={!may} value={page.name} onChange={(e) => setP({ ...page, name: e.target.value })} /></Field>
            <Field label="Address (/m/l/…)"><input className={input} disabled={!may} value={page.slug} onChange={(e) => setP({ ...page, slug: e.target.value })} /></Field>
            <Field label="Title in the browser"><input className={input} disabled={!may} value={page.title ?? ''} onChange={(e) => setP({ ...page, title: e.target.value })} /></Field>
            <Field label="Description for search engines"><textarea className={cx(input, '!h-auto py-1.5')} rows={2} disabled={!may} value={page.meta_description ?? ''} onChange={(e) => setP({ ...page, meta_description: e.target.value })} /></Field>
            <Field label="Sign-up form under the content"><Select<string> aria-label="Form" value={page.form_id ? String(page.form_id) : ''} disabled={!may} onValueChange={(v) => setP({ ...page, form_id: v ? Number(v) : null })} options={[{ value: '', label: 'No form' }, ...forms.map((x) => ({ value: String(x.id), label: x.name }))]} /></Field>
            <Field label="Own domain (optional)" hint="Point it at this server in your website’s CMS."><input className={input} disabled={!may} value={page.custom_domain ?? ''} placeholder="offers.example.com" onChange={(e) => setP({ ...page, custom_domain: e.target.value })} /></Field>
            <p className="m-0 text-[12px] text-ink-3">{n(page.stats.views)} views · {n(page.stats.submissions)} sign-ups. The UTM parameters of each visit go with its sign-up.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
