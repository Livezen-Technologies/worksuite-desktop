import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { toast } from '../../../core/toasts';
import { Checkbox } from '../../../components/Checkbox';
import { Select } from '../../../components/Select';
import { Button, Modal } from '../../../components/ui';
import { errorText, type FullDetail } from '../portfolio';
import { tk, treads, twrites, type TemplateScope } from '../templates';
import { ErrorLine, Field, inputClass } from './kit';

/**
 * Save as template (worksuite-desktop#337), from any project: the parts to keep, who may use it, and a name. The
 * server reads the plan off the project — dates become working-day offsets from its start, the team becomes roles
 * with their rates, milestones become phases, checklists come across unticked — and keeps it as version 1 of a
 * library template (POST /projects/{id}/save-as-library-template). Nobody's name and nothing that happened is copied.
 */

const PARTS: Array<{ key: string; label: string }> = [
  { key: 'phases', label: 'Phases (from the milestones)' },
  { key: 'tasks', label: 'Tasks, sub-tasks, checklists and dependencies' },
  { key: 'roles', label: 'Team roles and rates, not the people' },
  { key: 'budget', label: 'Budget lines' },
  { key: 'folders', label: 'Folders in Files' },
  { key: 'automations', label: 'Automations' },
  { key: 'risks', label: 'Open risks' },
];

export function SaveAsTemplate({ d, onClose, onDone }: { d: FullDetail; onClose: () => void; onDone: () => void }) {
  const p = d.project;
  // The library says whether this person may share with the company.
  const lib = useQuery({ queryKey: tk.library({ org: p.org_id }), queryFn: ({ signal }) => treads.library({ org: p.org_id }, { signal }), staleTime: 60_000 });
  const can = lib.data?.data.can ?? {};
  const [name, setName] = useState(`${p.name} template`);
  const [summary, setSummary] = useState('');
  const [scope, setScope] = useState<TemplateScope>('personal');
  const [include, setInclude] = useState<Record<string, boolean>>(Object.fromEntries(PARTS.map((x) => [x.key, true])));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const titleId = useId();

  const save = async () => {
    setError('');
    if (!name.trim()) return setError('Name the template.');
    setBusy(true);
    try {
      const r = await twrites.saveFromProject(p.id, { name: name.trim(), scope, include, ...(summary.trim() ? { summary: summary.trim() } : {}) });
      toast('success', `Template “${r.template.name}” saved: ${r.template.line}`);
      onDone();
    } catch (e) {
      setError(errorText(e, 'The template could not be saved.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Save as template"
      labelledBy={titleId}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save template
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px] text-ink-2">
        <p>Dates become offsets from the project’s start, in working days, so the plan fits any new dates. People become roles.</p>
        <Field label="Template name" required>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Summary" hint="One line on the template’s card.">
          <input value={summary} onChange={(e) => setSummary(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Who can use it">
          <Select
            aria-label="Who can use it"
            value={scope as string}
            onChange={(e) => setScope(e.target.value as TemplateScope)}
            options={[{ value: 'personal', label: 'Only me (My templates)' }, ...(can.company ? [{ value: 'company', label: `${p.org_name ?? 'My company'} (Company templates)` }] : [])]}
            className={inputClass}
          />
        </Field>
        <fieldset className="flex flex-col gap-1.5 rounded-[10px] border border-line px-3 py-2">
          <legend className="px-1 text-[12.5px] font-semibold text-ink">Include</legend>
          {PARTS.map((x) => (
            <label key={x.key} className="flex items-center gap-2">
              <Checkbox checked={include[x.key] ?? true} onChange={(e) => setInclude((i) => ({ ...i, [x.key]: e.target.checked }))} />
              {x.label}
            </label>
          ))}
        </fieldset>
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </div>
    </Modal>
  );
}
