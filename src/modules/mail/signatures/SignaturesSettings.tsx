import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { toast } from '../../../core/toasts';
import { Select } from '../../../components/Select';
import { Button, Chip, Empty, ErrorNote, Spinner, TextField } from '../../../components/ui';
import { useMailboxes, useSignatures } from '../api';
import { prepareImage } from '../editor/images';
import type { Mailbox, Signature, SignatureSetting, SignaturesData } from '../types';
import { FIELD_LABELS, fillSignature, type Field, type SignatureValues } from './signatureHtml';
import { SIGNATURE_IMAGE_BYTES, SignatureEditor, type SignatureDraft, type SignaturePayload } from './SignatureEditor';
import { SignatureFrame, SignaturePreview } from './SignaturePreview';
import { TemplateGallery } from './TemplateGallery';
import { SectionHeader, SettingsGroup } from '../../../components/SettingsKit';

/**
 * Settings › Mail › Signatures (worksuite-desktop#166): the person's
 * signatures (and their organisation's) with a small preview, the accounts
 * each is the default for, and Edit, Duplicate, Set default and Delete;
 * which signature each account uses for new mail and for replies and
 * forwards, and where it goes in a reply; the details the {fields} are
 * filled from; and, for an administrator, the organisation's signatures.
 * Everything is kept on the server, so every device and the web app have it.
 */

const KEY = ['mail', 'signatures'];
const DETAIL_FIELDS: Field[] = ['name', 'job_title', 'department', 'company', 'phone', 'mobile', 'website', 'address'];

interface Editing {
  id: number | null;
  draft: SignatureDraft;
  organisation?: boolean;
}

export function Signatures() {
  const qc = useQueryClient();
  const q = useSignatures(true);
  const data: SignaturesData | undefined = q.data;
  const boxes = (useMailboxes().data?.mailboxes ?? []).filter((b) => !b.archived);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [gallery, setGallery] = useState<'personal' | 'organisation' | null>(null);
  const [viewing, setViewing] = useState<Signature | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: KEY });
  const act = async (run: () => Promise<unknown>, done: string) => {
    try {
      await run();
      refresh();
      toast('success', done);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const rows = data?.signatures ?? [];
  const settings = data?.settings ?? [];
  const values: SignatureValues = data?.values ?? {};
  const socialBase = data?.assets?.social_base ?? '';

  /** The accounts a signature is the default for, in words. */
  const defaultFor = (id: number): string[] => {
    const out: string[] = [];
    for (const s of settings) {
      if (s.new_id !== id && s.reply_id !== id) continue;
      const where = s.mailbox === null ? text('Every account') : (boxes.find((b) => b.id === s.mailbox)?.email ?? text('An account'));
      const what = s.new_id === id && s.reply_id === id ? '' : s.new_id === id ? text(' (new mail)') : text(' (replies)');
      out.push(where + what);
    }
    if (!settings.length) {
      const sig = rows.find((r) => r.id === id);
      if (sig?.is_default) out.push(text('Every account'));
    }
    return out;
  };

  const save = async (p: SignaturePayload) => {
    if (!editing) return;
    const r = editing.organisation
      ? editing.id
        ? await apiPut<{ warning?: string | null }>(`/api/mail/admin/signatures/${editing.id}`, p)
        : await apiPost<{ warning?: string | null }>('/api/mail/admin/signatures', p)
      : editing.id
        ? await apiPut<{ warning?: string | null }>(`/api/mail/signatures/${editing.id}`, p)
        : await apiPost<{ warning?: string | null }>('/api/mail/signatures', p);
    refresh();
    if (editing.organisation) void qc.invalidateQueries({ queryKey: ['mail', 'admin-signatures'] });
    toast(r?.warning ? 'info' : 'success', r?.warning ?? text('Signature saved.'));
    setEditing(null);
  };

  return (
    <>
      <SectionHeader
        title={text('Signatures')}
        actions={
          <>
            <Button variant="primary" icon="plus" onClick={() => setGallery('personal')}>
          {text('New signature')}
        </Button>
          </>
        }
      />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isSuccess && rows.length === 0 ? <Empty icon="signature" title={text('No signature yet')} hint={text('A signature goes under every new message and reply you write. Start from a template or a blank one.')} /> : null}
      {rows.length ? (
        <ul role="list" aria-label={text('Your signatures')} className="overflow-hidden rounded-[12px] border border-line bg-surface">
          {rows.map((s) => {
            const where = defaultFor(s.id);
            return (
              <li key={s.id} className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <div aria-hidden className="pointer-events-none w-[220px] shrink-0 overflow-hidden">
                  <SignatureFrame title={s.name} html={fillSignature(s.html, values)} height={90} />
                </div>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-[14px] font-bold text-ink">
                    {s.name}
                    {s.scope === 'company' ? <Chip tone="teal">{s.locked ? text('Organisation · locked') : text('Organisation')}</Chip> : null}
                  </span>
                  <span className="mt-1 block text-[12px] text-ink-3">{where.length ? text('Default for {list}', { list: where.join(', ') }) : text('Not a default')}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  <Button size="sm" onClick={() => (s.locked || s.editable === false ? setViewing(s) : setEditing({ id: s.id, draft: { name: s.name, html: s.html, image_mode: s.image_mode, dark_logo: s.dark_logo } }))}>
                    {s.locked || s.editable === false ? text('View') : text('Edit')}
                  </Button>
                  {!s.locked ? (
                    <Button size="sm" variant="ghost" aria-label={text('Duplicate {name}', { name: s.name })} onClick={() => void act(() => apiPost(`/api/mail/signatures/${s.id}/duplicate`), text('Signature copied.'))}>
                      {text('Duplicate')}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" aria-label={text('Set {name} as default', { name: s.name })} onClick={() => void act(() => apiPost(`/api/mail/signatures/${s.id}/default`), text('Now your default signature.'))}>
                    {text('Set default')}
                  </Button>
                  {s.editable !== false && !s.locked ? (
                    <Button size="sm" variant="ghost" className="!text-danger" aria-label={text('Delete {name}', { name: s.name })} onClick={() => void act(() => apiDelete(`/api/mail/signatures/${s.id}`), text('Signature deleted.'))}>
                      {text('Delete')}
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {data && rows.length ? <AccountChoices signatures={rows} settings={settings} boxes={boxes} onSaved={refresh} legacy={!data.settings} /> : null}
      {data?.values ? <YourDetails values={values} details={data.details ?? {}} onSaved={refresh} /> : null}
      {data?.can_manage_company ? <OrganisationSignatures values={values} onNew={() => setGallery('organisation')} onEdit={(s) => setEditing({ id: s.id, organisation: true, draft: { name: s.name, html: s.html, image_mode: s.image_mode, locked: s.locked } })} /> : null}
      {gallery ? (
        <TemplateGallery
          values={values}
          socialBase={socialBase}
          saved={data?.templates ?? []}
          keepFields={gallery === 'organisation'}
          onClose={() => setGallery(null)}
          onDeleteSaved={(t) => void act(() => apiDelete(`/api/mail/signature-templates/${t.id}`), text('Template deleted.'))}
          onChoose={(t) => {
            setEditing({ id: null, organisation: gallery === 'organisation', draft: { name: t.name, html: t.html } });
            setGallery(null);
          }}
        />
      ) : null}
      {editing ? (
        <SignatureEditor
          title={editing.organisation ? text('Organisation signature') : editing.id ? text('Edit signature') : text('New signature')}
          initial={editing.draft}
          isNew={editing.id === null}
          values={values}
          socialBase={socialBase}
          organisation={editing.organisation}
          onSave={save}
          onSaveTemplate={
            editing.organisation
              ? undefined
              : async (name, html) => {
                  await apiPost('/api/mail/signature-templates', { name, html });
                  refresh();
                  toast('success', text('Saved as a template.'));
                }
          }
          onClose={() => setEditing(null)}
        />
      ) : null}
      {viewing ? <LockedView signature={viewing} values={values} onClose={() => setViewing(null)} /> : null}
    </>
  );
}

function LockedView({ signature, values, onClose }: { signature: Signature; values: SignatureValues; onClose: () => void }) {
  return (
    <SettingsGroup label={signature.name}>
      <div className="px-[18px] py-3.5">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="flex-1 text-[15px] font-bold text-ink">{signature.name}</h3>
        <Button size="sm" onClick={onClose}>
          {text('Close')}
        </Button>
      </div>
      <p className="mb-3 text-[12.5px] text-ink-3">{text('Your organisation’s signature: its layout and logo are set by an administrator. Your own details in it come from your profile and from Your details below.')}</p>
      <SignaturePreview html={signature.html} values={values} darkLogo={signature.dark_logo} />
      </div>
    </SettingsGroup>
  );
}

/** Per account: the signature for new mail, the one for replies and forwards (or none), and where it goes. */
function AccountChoices({ signatures, settings, boxes, onSaved, legacy }: { signatures: Signature[]; settings: SignatureSetting[]; boxes: Mailbox[]; onSaved: () => void; legacy: boolean }) {
  const all = settings.find((s) => s.mailbox === null);
  const fallbackNew = all?.new_id ?? signatures.find((s) => s.is_default)?.id ?? null;
  const base: SignatureSetting = all ?? { mailbox: null, new_id: fallbackNew, reply_id: fallbackNew, placement: 'above_quote' };
  const put = async (row: SignatureSetting) => {
    try {
      await apiPut('/api/mail/signature-settings', row);
      onSaved();
      toast('success', text('Saved.'));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const reset = async (box: number) => {
    try {
      await apiDelete(`/api/mail/signature-settings/${box}`);
      onSaved();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const options = [{ value: '', label: text('None') }, ...signatures.map((s) => ({ value: String(s.id), label: s.name }))];
  const row = (label: string, box: number | null) => {
    const own = settings.find((s) => s.mailbox === box);
    const r = own ?? { ...base, mailbox: box };
    const change = (patch: Partial<SignatureSetting>) => void put({ ...r, ...patch, mailbox: box });
    return (
      <tr key={box ?? 'all'} className="border-b border-line last:border-b-0">
        <th scope="row" className="min-w-0 px-3 py-2 text-left text-[13px] font-semibold text-ink">
          <span className="block truncate" title={label}>{label}</span>
          {box !== null && !own ? <span className="block text-[11.5px] font-normal text-ink-3">{text('Same as every account')}</span> : null}
          {box !== null && own ? (
            // Under the account, not in a column of its own: a fifth column for one button on some rows is what pushed
            // the table past the card's edge.
            <button type="button" onClick={() => void reset(box)} className="mt-0.5 text-[11.5px] font-semibold text-primary hover:underline">
              {text('Use every-account choice')}
            </button>
          ) : null}
        </th>
        <td className="px-2 py-2">
          <Select aria-label={text('New messages for {account}', { account: label })} value={r.new_id === null ? '' : String(r.new_id)} options={options} onValueChange={(v) => change({ new_id: v === '' ? null : Number(v) })} className="h-8 w-full min-w-0" />
        </td>
        <td className="px-2 py-2">
          <Select aria-label={text('Replies and forwards for {account}', { account: label })} value={r.reply_id === null ? '' : String(r.reply_id)} options={options} onValueChange={(v) => change({ reply_id: v === '' ? null : Number(v) })} className="h-8 w-full min-w-0" />
        </td>
        <td className="px-2 py-2">
          <Select
            aria-label={text('Where it goes in a reply for {account}', { account: label })}
            value={r.placement}
            options={[
              // Short enough to read whole in the column; the heading says it is about replies.
              { value: 'above_quote', label: text('Above the quoted message') },
              { value: 'below_quote', label: text('Below the quoted message') },
            ]}
            onValueChange={(v) => change({ placement: v === 'below_quote' ? 'below_quote' : 'above_quote' })}
            className="h-8 w-full min-w-0"
          />
        </td>
      </tr>
    );
  };
  return (
    <SettingsGroup title={text('Signature for each account')}>
      {legacy ? <p className="px-4 py-3 text-[12.5px] text-warning">{text('Choosing per account needs the latest WorkSuite server.')}</p> : null}
      <div className="overflow-x-auto">
        {/*
          * The columns share the card's width (a fixed layout, each dropdown filling its column) rather than adding up
          * fixed widths: 180 + 180 + 260 and a column for the reset button ran past the card's edge, cutting off
          * "Below my reply, above th…". It scrolls sideways only below 640px.
          */}
        <table className="w-full min-w-[640px] table-fixed">
          <colgroup>
            <col className="w-[30%]" />
            <col className="w-[22%]" />
            <col className="w-[22%]" />
            <col className="w-[26%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-line text-left text-[12px] text-ink-3">
              <th className="px-3 py-2 font-semibold">{text('Account')}</th>
              <th className="px-2 py-2 font-semibold">{text('New messages')}</th>
              <th className="px-2 py-2 font-semibold">{text('Replies and forwards')}</th>
              <th className="px-2 py-2 font-semibold">{text('Where it goes in a reply')}</th>
            </tr>
          </thead>
          <tbody>{[row(text('Every account'), null), ...boxes.map((b) => row(b.email, b.id))]}</tbody>
        </table>
      </div>
    </SettingsGroup>
  );
}

/** What the {fields} are filled from, where the profile has nothing (or something else is wanted). */
function YourDetails({ values, details, onSaved }: { values: SignatureValues; details: Record<string, string>; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries([...DETAIL_FIELDS, 'photo'].map((f) => [f, details[f] ?? ''])));
  const [busy, setBusy] = useState(false);
  const changed = Object.entries(form).some(([k, v]) => v !== (details[k] ?? ''));
  const save = async () => {
    setBusy(true);
    try {
      await apiPut('/api/mail/signature-details', { values: form });
      onSaved();
      toast('success', text('Your details are saved.'));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsGroup title={text('Your details')}>
      <div className="px-[18px] py-3.5">
      <p className="mb-3 text-[12.5px] text-ink-3">{text('Signatures fill {name}, {job_title} and the other fields from your WorkSuite profile. Fill in anything it does not have, or what you would rather show; leave a box empty to use the profile.')}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {DETAIL_FIELDS.map((f) => (
          <TextField key={f} label={text(FIELD_LABELS[f])} value={form[f] ?? ''} placeholder={values[f] ?? ''} onChange={(e) => setForm({ ...form, [f]: e.target.value })} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
        <span className="font-semibold">{text('Photo')}</span>
        {form.photo || values.photo ? <img src={form.photo || values.photo} alt={text('Your photo')} className="h-10 w-10 rounded-full object-cover" /> : <span className="text-ink-3">{text('None')}</span>}
        <label className="inline-flex h-8 cursor-pointer items-center rounded-[8px] border border-line px-2.5 font-semibold text-ink hover:bg-subtle">
          {text('Choose a photo…')}
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void prepareImage(file, SIGNATURE_IMAGE_BYTES, 400).then((p) => setForm((f) => ({ ...f, photo: p.src })), (err: unknown) => toast('error', errorMessage(err)));
            }}
          />
        </label>
        {form.photo ? (
          <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, photo: '' })}>
            {text('Remove')}
          </Button>
        ) : null}
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="primary" loading={busy} disabled={!changed} onClick={() => void save()}>
          {text('Save my details')}
        </Button>
      </div>
      </div>
    </SettingsGroup>
  );
}

interface OrgSignature {
  id: number;
  name: string;
  html: string;
  locked: boolean;
  image_mode?: 'hosted' | 'embedded';
}

/** For administrators: the organisation's signatures — locked ones people use, or templates they start from. */
function OrganisationSignatures({ values, onNew, onEdit }: { values: SignatureValues; onNew: () => void; onEdit: (s: OrgSignature) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mail', 'admin-signatures'], queryFn: () => apiGet<{ signatures: OrgSignature[] }>('/api/mail/admin/signatures'), retry: false });
  const remove = async (s: OrgSignature) => {
    try {
      await apiDelete(`/api/mail/admin/signatures/${s.id}`);
      void qc.invalidateQueries({ queryKey: ['mail', 'admin-signatures'] });
      void qc.invalidateQueries({ queryKey: KEY });
      toast('success', text('Organisation signature deleted.'));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <SettingsGroup label={text('Organisation signatures')}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h3 className="flex-1 text-[15px] font-bold text-ink">{text('Organisation signatures')}</h3>
        <Button size="sm" icon="plus" onClick={onNew}>
          {text('New organisation signature')}
        </Button>
      </div>
      <p className="px-4 pt-3 text-[12.5px] text-ink-3">{text('You manage mailboxes, so you can give everyone a signature. A locked one keeps its layout and logo; each person’s details are filled in. An unlocked one is a template people start from.')}</p>
      {q.error ? <ErrorNote error={q.error} /> : null}
      <ul role="list" className="p-2">
        {(q.data?.signatures ?? []).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-[8px] px-2 py-2">
            <div aria-hidden className="pointer-events-none w-[180px] overflow-hidden">
              <SignatureFrame title={s.name} html={fillSignature(s.html, values)} height={70} />
            </div>
            <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-ink">{s.name}</span>
            <Chip tone={s.locked ? 'teal' : 'muted'}>{s.locked ? text('Locked') : text('Template')}</Chip>
            <Button size="sm" onClick={() => onEdit(s)}>
              {text('Edit')}
            </Button>
            <Button size="sm" variant="ghost" className="!text-danger" aria-label={text('Delete {name}', { name: s.name })} onClick={() => void remove(s)}>
              {text('Delete')}
            </Button>
          </li>
        ))}
      </ul>
    </SettingsGroup>
  );
}
