import { useState } from 'react';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { refreshMarketing, send } from './api';
import { BlockEditor } from './email-BlockEditor';
import { Confirm, useTemplates } from './email-kit';
import { TemplateGallery } from './email-gallery';
import { Card, Field, PageHeader, Pill, btn, btnPrimary, btnSmall, input } from './parts';
import { companiesWhere, fieldErrors, refusal, type Options, type Starter, type Template } from './types';

/**
 * Email templates: the starters and the 100-template gallery that come with
 * Marketing, and whatever each
 * company saves — written in the same block editor as a campaign.
 *
 * A template is only a starting point. A campaign made from one keeps its own
 * copy, so changing or deleting a template changes no campaign — least of all
 * one already sent.
 */
type Editing = { template: Template | null; from: Starter | null };

export default function Templates({ org, options }: { org: string; options: Options }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useTemplates();
  const writers = companiesWhere(options, 'templates');
  const scoped = org.split(',').filter(Boolean).map(Number);
  const items = (q.data?.items ?? []).filter((t) => scoped.length === 0 || scoped.includes(t.org_id));
  const mayWrite = (orgId: number) => writers.some((c) => c.id === orgId);
  const several = (options.companies ?? []).length > 1;

  if (editing) return <TemplateEditor key={editing.template?.id ?? `new-${editing.from?.key ?? ''}`} editing={editing} options={options} org={org} onDone={() => setEditing(null)} />;

  const remove = async (t: Template) => {
    setBusy(true);
    try {
      const r = await send('DELETE', `/api/marketing/templates/${t.id}`);
      toast('success', r.message ?? 'Deleted.');
      setDeleting(null);
      void refreshMarketing();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        crumbs={['Email']}
        title="Templates"
        sub="What campaigns start from. A campaign made from a template keeps its own copy."
        actions={
          writers.length > 0 ? (
            <button type="button" className={btnPrimary} onClick={() => setEditing({ template: null, from: null })}>
              <Icon name="plus" size={15} /> New template
            </button>
          ) : null
        }
      />

      {q.isLoading ? (
        <Spinner label="Loading templates…" />
      ) : q.error ? (
        <ErrorNote error={new Error(refusal(q.error, 'The templates could not be loaded.'))} onRetry={() => void q.refetch()} />
      ) : (
        <div className="flex flex-col gap-6">
          <section aria-labelledby="tpl-saved">
            <h2 id="tpl-saved" className="m-0 mb-2 text-[11px] font-bold tracking-[.5px] text-ink-3 uppercase">Saved</h2>
            {items.length === 0 ? (
              <Card>
                <p className="m-0 text-[13px] text-ink-2">No saved templates yet. Save a campaign as a template, or make one here from a starter.</p>
              </Card>
            ) : (
              <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((t) => (
                  <li key={t.id} className="flex min-w-0 flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="m-0 truncate text-[14px] font-bold text-ink">{t.name}</p>
                        <p className="m-0 truncate text-[12px] text-ink-3">{t.subject || 'No subject'}</p>
                      </div>
                      <Pill tone="slate" dot={false}>{t.category_label}</Pill>
                    </div>
                    <p className="m-0 text-[11.5px] text-ink-3">
                      {several ? `${options.companies.find((c) => c.id === t.org_id)?.name ?? ''} · ` : ''}Changed {dateLabel(t.updated_at) || '—'}
                    </p>
                    {mayWrite(t.org_id) ? (
                      <div className="flex gap-2">
                        <button type="button" className={btnSmall} onClick={() => setEditing({ template: t, from: null })}>
                          Edit
                        </button>
                        <button type="button" className={btnSmall} onClick={() => setDeleting(t)}>
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <TemplateGallery starters={q.data?.starters ?? []} onUse={writers.length > 0 ? (s) => setEditing({ template: null, from: s }) : undefined} />
        </div>
      )}

      {deleting ? (
        <Confirm title={`Delete ${deleting.name}?`} yes="Delete" danger busy={busy} onClose={() => setDeleting(null)} onYes={() => void remove(deleting)}>
          Campaigns made from it keep their own copy.
        </Confirm>
      ) : null}
    </div>
  );
}

/** One template being written: its name, kind, subject and preview text, and its content in the block editor. */
function TemplateEditor({ editing, options, org, onDone }: { editing: Editing; options: Options; org: string; onDone: () => void }) {
  const t = editing.template;
  const writers = companiesWhere(options, 'templates');
  const scoped = org.split(',').filter(Boolean).map(Number);
  const [orgId, setOrgId] = useState(String(t?.org_id ?? (scoped.length === 1 && writers.some((w) => w.id === scoped[0]) ? scoped[0] : writers.length === 1 ? writers[0]!.id : '')));
  const [name, setName] = useState(t?.name ?? editing.from?.name ?? '');
  const [category, setCategory] = useState(t?.category ?? editing.from?.category ?? 'custom');
  const [subject, setSubject] = useState(t?.subject ?? editing.from?.subject ?? '');
  const [preheader, setPreheader] = useState(t?.preheader ?? editing.from?.preheader ?? '');
  const [body, setBody] = useState(t?.body_html ?? editing.from?.body_html ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const company = options.companies.find((c) => String(c.id) === orgId);

  const save = async () => {
    setBusy(true);
    setErrors({});
    const payload = { name: name.trim(), category, subject, preheader, body_html: body };
    try {
      const r = t ? await send('PUT', `/api/marketing/templates/${t.id}`, payload) : await send('POST', '/api/marketing/templates', { ...payload, org_id: Number(orgId) });
      toast('success', r.message ?? 'Saved.');
      void refreshMarketing();
      onDone();
    } catch (e) {
      setErrors(fieldErrors(e));
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        crumbs={['Email', 'Templates', t ? 'Edit' : 'New']}
        onCrumb={(i) => i === 2 && onDone()}
        title={t ? t.name : editing.from ? `New template from ${editing.from.name}` : 'New template'}
        sub="Saving it changes no campaign: each one made from it has its own copy."
        actions={
          <>
            <button type="button" className={btn} onClick={onDone}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} disabled={busy || name.trim() === '' || orgId === ''} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save template'}
            </button>
          </>
        }
      />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {!t && writers.length > 1 ? (
            <Field label="Company">
              <Select aria-label="Company" value={orgId} onValueChange={setOrgId} placeholder="Choose a company" options={writers.map((c) => ({ value: String(c.id), label: c.name }))} />
            </Field>
          ) : null}
          <Field label="Name">
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={150} />
          </Field>
          <Field label="Kind">
            <Select aria-label="Kind" value={category} onValueChange={setCategory} options={options.template_categories ?? [{ value: 'custom', label: 'Custom' }]} />
          </Field>
          <Field label="Subject">
            <input className={input} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={255} />
          </Field>
          <Field label="Preview text">
            <input className={input} value={preheader} onChange={(e) => setPreheader(e.target.value)} maxLength={255} />
          </Field>
        </div>
        {errors.name ? <p role="alert" className="m-0 mt-2 text-[12px] text-danger">{errors.name}</p> : null}
      </Card>
      {errors.body_html ? <p role="alert" className="m-0 rounded-[10px] bg-danger-bg px-3.5 py-2.5 text-[12.5px] text-danger">{errors.body_html}</p> : null}
      <BlockEditor initial={body} onChange={setBody} orgId={Number(orgId) || 0} mergeTags={options.merge_tags ?? []} companyName={company?.name} alsoText={[subject, preheader]} />
    </div>
  );
}
