import { useState } from 'react';
import { Select } from '../../components/Select';
import { toast } from '../../core/toasts';
import { refreshMarketing, send } from './api';
import { SECTIONS, type CallScript, type Section } from './calls';
import { FieldError } from './calls-parts';
import { btn, btnPrimary, Field, input, Sheet } from './parts';
import { fieldErrors, refusal, type Company } from './types';

/**
 * One call script, written or changed (MKT-CAL-07): its name, its language and the six parts an agent reads down
 * beside every contact — introduction, the questions that qualify, the pitch, answers to objections, the close, and
 * what happens next. Shared by Scripts and the campaign's "Edit script".
 *
 * A script belongs to one company; a campaign picks one of its own company's. Saving changes it for every campaign
 * that uses it, from the next contact on.
 */
export const LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'si', label: 'Sinhala' },
  { value: 'ta', label: 'Tamil' },
];

const EMPTY: Record<Section, string> = { introduction: '', qualification: '', pitch: '', objections: '', closing: '', next_action: '' };

export function ScriptSheet({ script, companies, onClose, onSaved }: { script: CallScript | null; companies: Company[]; onClose: () => void; onSaved?: (id: number) => void }) {
  const [name, setName] = useState(script?.name ?? '');
  const [org, setOrg] = useState(String(script?.org_id ?? companies[0]?.id ?? ''));
  const [language, setLanguage] = useState(script?.language ?? 'en');
  const [sections, setSections] = useState<Record<Section, string>>({ ...EMPTY, ...(script?.sections ?? {}) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const languages = LANGUAGES.some((l) => l.value === language) ? LANGUAGES : [...LANGUAGES, { value: language, label: language.toUpperCase() }];

  async function save() {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const r = script
        ? await send<{ id?: number }>('PUT', `/api/marketing/calls/scripts/${script.id}`, { name, language, sections })
        : await send<{ id?: number }>('POST', '/api/marketing/calls/scripts', { name, language, sections, org_id: Number(org) });
      toast('success', r.message ?? 'Script saved');
      void refreshMarketing();
      onSaved?.(r.data?.id ?? script?.id ?? 0);
      onClose();
    } catch (e) {
      setErrors(fieldErrors(e));
      setError(refusal(e, 'The script could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={script ? `Edit “${script.name}”` : 'New call script'}
      onClose={onClose}
      width={620}
      footer={
        <>
          <button type="button" className={btn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy || !name.trim()}>
            Save script
          </button>
        </>
      }
    >
      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_150px]">
        <Field label="Name">
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Website care follow-up" />
          <FieldError text={errors.name} />
        </Field>
        <Field label="Language">
          <Select value={language} onValueChange={setLanguage} options={languages} aria-label="Language" searchable={false} />
        </Field>
      </div>
      {!script && companies.length > 1 ? (
        <Field label="Company">
          <Select value={org} onValueChange={setOrg} options={companies.map((c) => ({ value: String(c.id), label: c.name }))} aria-label="Company" />
        </Field>
      ) : null}
      {SECTIONS.map(([k, label], i) => (
        <Field key={k} label={`${i + 1}. ${label}`}>
          <textarea
            className={`${input} h-auto min-h-[64px] py-2 leading-snug`}
            rows={k === 'pitch' || k === 'objections' ? 4 : 2}
            value={sections[k]}
            onChange={(e) => setSections({ ...sections, [k]: e.target.value })}
          />
        </Field>
      ))}
      {error ? (
        <p role="alert" className="m-0 text-[12.5px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
