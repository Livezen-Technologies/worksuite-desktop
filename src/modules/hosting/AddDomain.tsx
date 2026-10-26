import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { addDomain, type Org } from './api';
import { Btn, Card, Field, Kbd, Note, PageHead, input, useReadOnly } from './parts';

/**
 * Add a manual domain (HDM-DOM-02). The server validates and normalises the name (IDN to punycode, lowercase) and
 * refuses a duplicate in the company; here the name is only checked for shape. ⌘S saves.
 */
export const plausibleDomain = (v: string) => /^(?=.{3,253}$)([\p{L}\p{N}](?:[\p{L}\p{M}\p{N}-]{0,61}[\p{L}\p{M}\p{N}])?\.)+\p{L}[\p{L}\p{M}]{1,62}$/u.test(v.trim().replace(/\.$/, ''));

export default function AddDomain({ companies, org, onDone, onCancel, onRegister }: { companies: Org[]; org: number; onDone: (id: number) => void; onCancel: () => void; onRegister: () => void }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [company, setCompany] = useState(org || companies[0]?.id || 0);
  const [registrar, setRegistrar] = useState('');
  const [expires, setExpires] = useState('');
  const [auto, setAuto] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = plausibleDomain(name) && !ro && company > 0;
  const save = async () => {
    if (!ok) return;
    setBusy(true);
    setErr(null);
    try {
      const d = await addDomain({ name: name.trim().replace(/\.$/, '').toLowerCase(), org_id: company, registrar: registrar.trim() || null, expires_on: expires || null, auto_renew: auto, notes: notes.trim() || null });
      toast('success', text('Added {name}.', { name: d?.name ?? name.trim() }));
      void qc.invalidateQueries({ queryKey: ['hosting'] });
      if (d?.id) onDone(d.id);
      else onCancel();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="flex max-w-[620px] flex-col gap-4"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          void save();
        }
      }}
    >
      <PageHead title="Add a domain" sub="A domain you keep track of by hand. Domains at a connected registrar arrive with its sync.">
        <Btn disabled={ro} onClick={onRegister}>Register a new one instead…</Btn>
      </PageHead>
      {ro ? <Note tone="warn">Adding a domain needs a connection.</Note> : null}
      <Card>
        <div className="flex flex-col gap-3 p-4">
          <Field label="Domain name">
            <input aria-label="Domain name" autoFocus placeholder="example.lk" value={name} onChange={(e) => setName(e.target.value)} className={input} />
          </Field>
          {companies.length > 1 ? (
            <Field label="Company">
              <Select aria-label="Company" value={company} onChange={(e) => setCompany(Number(e.target.value))} className={input}>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Registrar">
              <input aria-label="Registrar" value={registrar} onChange={(e) => setRegistrar(e.target.value)} className={input} />
            </Field>
            <Field label="Expires on">
              <input aria-label="Expires on" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className={input} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
            <Checkbox checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-renew is on at the registrar
          </label>
          <Field label="Notes">
            <textarea aria-label="Notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${input} h-auto py-1.5`} />
          </Field>
          {err ? <Note tone="error">{err}</Note> : null}
          <div className="flex justify-end gap-2">
            <Btn onClick={onCancel}>Cancel</Btn>
            <Btn primary disabled={!ok || busy} onClick={() => void save()}>
              Add domain <Kbd>⌘S</Kbd>
            </Btn>
          </div>
        </div>
      </Card>
    </div>
  );
}
