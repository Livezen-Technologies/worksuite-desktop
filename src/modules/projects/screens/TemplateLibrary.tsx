import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from '../../../core/toasts';
import { Checkbox } from '../../../components/Checkbox';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Button, Modal, cx } from '../../../components/ui';
import { CompanySelect, useOrgParam, useProjectCompany } from '../company';
import { errorText, fmtDay, projectPath } from '../portfolio';
import { downloadJson, searchTemplates, tk, treads, twrites, type LibraryItem, type TemplateScope } from '../templates';
import { NewProjectButton } from './Register';
import { Chip, ErrorLine, Failed, Field, Loading, MenuButton, Mono, Nothing, PageHead, Tabs, areaClass, inputClass, needsConnection, useAsk } from './kit';

/**
 * Projects · Templates (worksuite-desktop#337): every template this person may use — the built-in packs, the
 * company's and organisation-wide ones, their own, and projects marked as templates — to start a project from,
 * duplicate, edit, archive, export, and read the version history and how often each was used. A JSON file exported
 * here (or from the web) imports back.
 *
 * Built-in packs are never edited in place: Duplicate makes a copy to customise. Company and organisation-wide
 * templates are changed by the module's administrators (`project.settings`); the server decides, and a card shows
 * Edit only where it said `editable`.
 */

type Filter = 'all' | 'company' | 'mine' | 'pack' | 'archived';

const SCOPE_WORD: Record<string, string> = { builtin: 'Built-in', personal: 'Personal', company: 'Company', organisation: 'Organisation-wide' };

export function TemplateLibraryView({ offline, mayCreate, onGo, onUse, onOffline }: { offline: boolean; mayCreate: boolean; onGo: (route: string) => void; onUse: (key: string | null) => void; onOffline: (o: boolean) => void }) {
  const qc = useQueryClient();
  const org = useOrgParam();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const lib = useQuery({ queryKey: tk.library({ org, archived: 1 }), queryFn: ({ signal }) => treads.library({ org, archived: 1 }, { signal }), staleTime: 60_000 });
  const fromCache = !!lib.data?.offline;
  useEffect(() => onOffline(fromCache), [fromCache, onOffline]);
  const { confirm, prompt, dialog } = useAsk();
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const [history, setHistory] = useState<LibraryItem | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const all = lib.data?.data.templates ?? [];
  const can = lib.data?.data.can ?? {};
  const counts = {
    all: all.filter((t) => t.status === 'active').length,
    company: all.filter((t) => t.group === 'company' && t.status === 'active').length,
    mine: all.filter((t) => t.group === 'mine' && t.status === 'active').length,
    pack: all.filter((t) => t.group === 'pack').length,
    archived: all.filter((t) => t.status === 'archived').length,
  };
  const rows = searchTemplates(
    all.filter((t) => (filter === 'archived' ? t.status === 'archived' : t.status === 'active' && (filter === 'all' || t.group === filter))),
    q,
  );
  const refresh = () => void qc.invalidateQueries({ queryKey: ['projects'] });

  const duplicate = async (t: LibraryItem) => {
    const name = await prompt({ title: `Duplicate “${t.name}”`, message: 'A copy in My templates, to change as you need. You can share it with the company afterwards.', confirmLabel: 'Duplicate', input: { label: 'Name', value: `Copy of ${t.name}`, required: true } });
    if (!name?.trim()) return;
    try {
      const r = await twrites.duplicate(t.key, { name: name.trim(), scope: 'personal' });
      toast('success', `“${r.template.name}” is in My templates`);
      refresh();
    } catch (e) {
      toast('error', errorText(e, 'The template could not be duplicated.'));
    }
  };
  const archive = async (t: LibraryItem, archived: boolean) => {
    if (archived && !(await confirm({ title: `Archive “${t.name}”?`, message: 'It leaves New project. Projects made from it keep their link, and you can restore it from Archived.', confirmLabel: 'Archive' }))) return;
    try {
      await twrites.archive(t.id!, archived);
      toast('success', archived ? `“${t.name}” archived` : `“${t.name}” restored`);
      refresh();
    } catch (e) {
      toast('error', errorText(e, 'That could not be changed.'));
    }
  };
  const exportOne = async (t: LibraryItem) => {
    try {
      const r = await treads.export(t.key);
      downloadJson(r.data.file_name, r.data.content);
    } catch (e) {
      toast('error', errorText(e, 'The template could not be exported.'));
    }
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = await twrites.importFile({ json: await f.text() });
      toast('success', `“${r.template.name}” imported into My templates`);
      setFilter('mine');
      refresh();
    } catch (e) {
      toast('error', errorText(e, 'That file could not be imported.'));
    } finally {
      if (file.current) file.current.value = '';
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        title="Templates"
        sub="Start a project with its phases, tasks, roles, budget and files already in place."
        actions={
          <>
            <CompanySelect />
            {mayCreate ? (
              <>
                <input ref={file} type="file" accept=".json,application/json" aria-label="Template file to import" className="hidden" onChange={(e) => void importFile(e.target.files?.[0])} />
                <Button size="sm" icon="upload" disabled={offline} title={offline ? needsConnection('Importing a template') : undefined} onClick={() => file.current?.click()}>
                  Import
                </Button>
              </>
            ) : null}
            <NewProjectButton may={mayCreate} offline={offline} onNew={() => onUse(null)} />
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2 pb-2.5">
          <Tabs
            label="Which templates"
            value={filter}
            onChange={setFilter}
            tabs={[
              { key: 'all', label: 'All', count: counts.all },
              { key: 'company', label: 'Company', count: counts.company },
              { key: 'mine', label: 'Mine', count: counts.mine },
              { key: 'pack', label: 'Built-in packs', count: counts.pack },
              { key: 'archived', label: 'Archived', count: counts.archived },
            ]}
          />
          <span className="ms-auto flex items-center gap-2 rounded-[8px] border border-line bg-surface px-2">
            <Icon name="search" size={14} className="text-ink-3" />
            <input aria-label="Search templates" placeholder="Search templates" value={q} onChange={(e) => setQ(e.target.value)} className="h-[28px] w-56 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3" />
          </span>
        </div>
      </PageHead>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3.5 scroll-thin">
        {lib.isLoading ? (
          <Loading label="Loading templates" />
        ) : lib.error && !lib.data ? (
          <Failed error={lib.error} onRetry={() => void lib.refetch()} />
        ) : rows.length === 0 ? (
          <Nothing text={filter === 'mine' ? 'No templates of your own yet. Duplicate a pack, import a file, or open a project and choose “Save as template”.' : 'No templates here.'} />
        ) : (
          <ul aria-label="Templates" className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2.5">
            {rows.map((t) => {
              const menu = [
                { label: 'Duplicate…', onSelect: () => void duplicate(t) },
                ...(t.kind === 'template' && t.editable ? [{ label: 'Edit…', onSelect: () => setEditing(t) }] : []),
                ...(t.kind === 'template' ? [{ label: 'Version history', onSelect: () => setHistory(t) }] : []),
                { label: 'Export as JSON', onSelect: () => void exportOne(t) },
                ...(t.kind === 'template' && t.editable ? [t.status === 'archived' ? { label: 'Restore', onSelect: () => void archive(t, false) } : { label: 'Archive…', onSelect: () => void archive(t, true), danger: true }] : []),
              ];
              return (
                <li key={t.key} className={cx('flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3.5', t.status === 'archived' && 'opacity-75')}>
                  <div className="flex items-start gap-2">
                    <Icon name={t.icon || 'copy'} size={16} className="mt-0.5 shrink-0 text-ink-3" />
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[13px] font-bold text-ink">
                        {t.kind === 'project' && t.id ? (
                          <button type="button" onClick={() => onGo(projectPath(t.id!))} className="text-start hover:text-primary hover:underline">
                            {t.name}
                          </button>
                        ) : (
                          t.name
                        )}
                      </h2>
                      <span className="text-[11px] text-ink-3">
                        {t.kind === 'project' ? <Mono>{t.code}</Mono> : `v${t.version}`}
                        {t.org_name ? ` · ${t.org_name}` : ''}
                        {t.owner && t.group !== 'mine' ? ` · by ${t.owner}` : ''}
                      </span>
                    </div>
                    <Chip>{t.kind === 'project' ? 'Project' : SCOPE_WORD[t.scope] ?? t.scope}</Chip>
                  </div>
                  {t.summary ? <p className="line-clamp-2 text-[12px] text-ink-2">{t.summary}</p> : null}
                  <p className="text-[11.5px] text-ink-3">
                    {t.line}
                    {t.usage ? ` · used ${t.usage} time${t.usage === 1 ? '' : 's'}` : ' · not used yet'}
                  </p>
                  {t.tags.length ? (
                    <span className="flex flex-wrap gap-1">
                      {t.tags.map((x) => (
                        <span key={x} className="rounded-full bg-subtle px-1.5 py-px text-[10.5px] font-semibold text-ink-2">
                          {x}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <div className="mt-auto flex items-center gap-2 pt-1">
                    {mayCreate && t.status === 'active' ? (
                      <Button size="sm" variant="primary" disabled={offline} title={offline ? needsConnection('A new project') : undefined} aria-label={`Use template ${t.name}`} onClick={() => onUse(t.key)}>
                        Use template
                      </Button>
                    ) : null}
                    {mayCreate ? <MenuButton ariaLabel={`More for ${t.name}`} icon="more" items={menu} disabled={offline} title={offline ? needsConnection('Changing a template') : t.kind === 'pack' ? 'Built-in packs are not edited: duplicate one to customise it' : undefined} /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {editing ? <EditTemplate item={editing} can={can} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), refresh())} /> : null}
      {history ? <History item={history} onClose={() => setHistory(null)} onRestored={refresh} /> : null}
      {dialog}
    </div>
  );
}

/** Name, words, scope and — for those who want it — the plan itself as JSON. A new plan is a new version. */
function EditTemplate({ item, can, onClose, onSaved }: { item: LibraryItem; can: { company?: boolean; organisation?: boolean }; onClose: () => void; onSaved: () => void }) {
  const company = useProjectCompany();
  const one = useQuery({ queryKey: tk.one(item.key), queryFn: ({ signal }) => treads.one(item.key, { signal }) });
  const [f, setF] = useState({ name: item.name, summary: item.summary, category: item.category, tags: item.tags.join(', '), note: '' });
  const [scope, setScope] = useState<TemplateScope>(item.scope);
  const [orgIds, setOrgIds] = useState<number[]>(item.org_ids ?? []);
  const [json, setJson] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const original = one.data ? JSON.stringify(one.data.data.spec, null, 2) : '';
  const titleId = useId();

  const save = async () => {
    setError('');
    if (!f.name.trim()) return setError('A template needs a name.');
    const body: Record<string, unknown> = { name: f.name.trim(), summary: f.summary, category: f.category, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), note: f.note.trim() || undefined };
    if (scope !== item.scope || (scope === 'organisation' && orgIds.join() !== (item.org_ids ?? []).join())) Object.assign(body, { scope, ...(scope === 'organisation' ? { org_ids: orgIds } : {}) });
    if (json !== null && json !== original) {
      try {
        body.spec = JSON.parse(json);
      } catch {
        return setError('The plan is not valid JSON.');
      }
    }
    setBusy(true);
    try {
      const r = await twrites.update(item.id!, body);
      toast('success', `“${r.template.name}” saved${body.spec ? ` as version ${r.version}` : ''}`);
      onSaved();
    } catch (e) {
      setError(errorText(e, 'The template could not be saved.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Edit “${item.name}”`}
      labelledBy={titleId}
      onClose={onClose}
      width={720}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save template
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Category">
          <input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Summary" className="sm:col-span-2">
          <input value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Tags" hint="Separated by commas.">
          <input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} className={inputClass} />
        </Field>
        <Field label="Who can use it">
          <Select
            aria-label="Who can use it"
            value={scope as string}
            onChange={(e) => setScope(e.target.value as TemplateScope)}
            options={[
              { value: 'personal', label: 'Only me' },
              ...(can.company || item.scope === 'company' ? [{ value: 'company', label: 'My company' }] : []),
              ...(can.organisation || item.scope === 'organisation' ? [{ value: 'organisation', label: 'Several companies' }] : []),
            ]}
            className={inputClass}
          />
        </Field>
        {scope === 'organisation' ? (
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1 rounded-[10px] border border-line px-3 py-2 text-[12.5px] text-ink-2 sm:col-span-2">
            <legend className="px-1 font-semibold text-ink">Shared with</legend>
            {company.companies.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5">
                <Checkbox checked={orgIds.includes(c.id)} onChange={(e) => setOrgIds((x) => (e.target.checked ? [...x, c.id] : x.filter((i) => i !== c.id)))} />
                {c.name}
              </label>
            ))}
            <span className="w-full text-[11.5px] text-ink-3">None ticked means every company.</span>
          </fieldset>
        ) : null}
        <Field label="Plan (JSON)" hint="Phases, tasks, roles, budget lines, folders and automations. Saving a changed plan makes a new version; the old one is kept." className="sm:col-span-2">
          {one.isLoading ? <Loading label="Reading the plan" /> : <textarea aria-label="Plan (JSON)" value={json ?? original} onChange={(e) => setJson(e.target.value)} rows={12} spellCheck={false} className={cx(areaClass, 'font-mono text-[11.5px]')} />}
        </Field>
        <Field label="What changed" hint="Kept with the version." className="sm:col-span-2">
          <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className={inputClass} />
        </Field>
        {error ? (
          <div className="sm:col-span-2">
            <ErrorLine>{error}</ErrorLine>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function History({ item, onClose, onRestored }: { item: LibraryItem; onClose: () => void; onRestored: () => void }) {
  const q = useQuery({ queryKey: tk.versions(item.id!), queryFn: ({ signal }) => treads.versions(item.id!, { signal }) });
  const restore = async (v: number) => {
    try {
      const r = await twrites.restore(item.id!, v);
      toast('success', `Version ${v} restored as version ${r.version}`);
      onRestored();
      void q.refetch();
    } catch (e) {
      toast('error', errorText(e, 'That version could not be restored.'));
    }
  };
  const versions = q.data?.data.versions ?? [];
  return (
    <Modal title={`Versions of “${item.name}”`} onClose={onClose} width={560} footer={<Button onClick={onClose}>Close</Button>}>
      {q.isLoading ? (
        <Loading label="Loading versions" />
      ) : q.error && !q.data ? (
        <Failed error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <ol aria-label="Versions" className="flex flex-col divide-y divide-line text-[12.5px]">
          {versions.map((v) => (
            <li key={v.version} className="flex items-center gap-3 py-2">
              <Mono className="w-8 text-ink">v{v.version}</Mono>
              <span className="min-w-0 flex-1">
                <span className="block text-ink">{v.note || '—'}</span>
                <span className="text-[11px] text-ink-3">
                  {v.line}
                  {v.by ? ` · ${v.by}` : ''}
                  {v.at ? ` · ${fmtDay(v.at.slice(0, 10), { year: true })}` : ''}
                </span>
              </span>
              {v.version === q.data?.data.current ? (
                <Chip>Current</Chip>
              ) : item.editable ? (
                <Button size="sm" onClick={() => void restore(v.version)}>
                  Restore
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
