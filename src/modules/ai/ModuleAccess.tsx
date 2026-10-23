import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AiEngine, AiModuleAccessPrefs, AiModuleToggle } from '@shared/types';
import { Checkbox } from '../../components/Checkbox';
import { ErrorNote, Spinner, cx } from '../../components/ui';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { effective, ORG_ACCESS_KEY, personal, saveOrgAccess, useOrgAccess, type OrgAccess, type OrgModule } from './tools';

/**
 * Settings › AI Assistant › Module Access (worksuite-desktop#51): which modules WorkSuite AI and Local AI may use,
 * to read data and to prepare changes (which are always previewed and confirmed). "For me" is this person's choice;
 * "For everyone" is the organization's ceiling, which only administrators change. Neither ever grants more than
 * the person's own role and record permissions allow. A change applies to the next question.
 */

/** The modules shown when this server has no Module Access yet: the choices are kept and apply once it does. */
export const FALLBACK_MODULES: OrgModule[] = [
  ['sales', 'Sales'],
  ['billing', 'Invoices'],
  ['crm', 'CRM'],
  ['tasks', 'Tasks'],
  ['files', 'Drive'],
  ['chat', 'Chat'],
  ['tenders', 'Tenders'],
].map(([key, label]) => ({ key: key!, label: label!, supports: { read: true, write: true }, worksuite: { read: true, write: true }, local: { read: true, write: true } }));

const COLUMNS: Array<{ engine: AiEngine; kind: keyof AiModuleToggle; label: string }> = [
  { engine: 'worksuite', kind: 'read', label: 'Read data' },
  { engine: 'worksuite', kind: 'write', label: 'Create or update' },
  { engine: 'local', kind: 'read', label: 'Read data' },
  { engine: 'local', kind: 'write', label: 'Create or update' },
];
const ENGINE_LABEL: Record<AiEngine, string> = { worksuite: 'WorkSuite AI', local: 'Local AI' };

/**
 * Why a module's boxes cannot be ticked, as a sentence on the row (board D05,
 * which gives every module an "Available" or "Server update needed" of its
 * own).
 *
 * THIS USED TO BE A TOOLTIP ONLY. The reason was on the cell's `title`, which
 * a keyboard or touch user never sees and a screen reader does not announce,
 * so a module whose boxes simply would not tick looked broken rather than
 * unsupported. It is plain text beside the module's name now, and the cells
 * carry it as `aria-description` as well.
 *
 * Nothing is said for a module that works, deliberately: the table is dense
 * and four columns wide, and an "Available" on every row would be the same
 * word repeated down the page instead of the exception standing out.
 */
function supportNote(m: OrgModule): string | null {
  if (!m.supports.read && !m.supports.write) return 'Server update needed — this module offers the assistants nothing yet.';
  if (!m.supports.write) return 'Server update needed before the assistants can create or update here.';
  if (!m.supports.read) return 'Server update needed before the assistants can read here.';
  return null;
}

export function ModuleAccess({ prefs, onChange }: { prefs: AiModuleAccessPrefs; onChange: (next: AiModuleAccessPrefs) => void }) {
  const qc = useQueryClient();
  const org = useOrgAccess();
  const [scope, setScope] = useState<'me' | 'org'>('me');
  const [saving, setSaving] = useState(false);
  const data: OrgAccess | null = org.data ?? null;
  const modules = data?.modules ?? FALLBACK_MODULES;
  const manage = !!data?.can_manage;
  const asOrg = manage && scope === 'org';

  const setMine = (m: OrgModule, engine: AiEngine, kind: keyof AiModuleToggle, on: boolean) => {
    const cur = personal(prefs, engine, m.key);
    // Reading off takes changes with it; changes on bring reading back.
    const next = kind === 'read' ? { read: on, write: on ? cur.write : false } : { read: on ? true : cur.read, write: on };
    onChange({ ...prefs, [engine]: { ...prefs[engine], [m.key]: next } });
  };

  const setOrg = async (m: OrgModule, engine: AiEngine, kind: keyof AiModuleToggle, on: boolean) => {
    if (!data) return;
    const cur = m[engine];
    const next = kind === 'read' ? { read: on, write: on ? cur.write : false } : { read: on ? true : cur.read, write: on };
    const modulesNext = data.modules.map((x) => (x.key === m.key ? { ...x, [engine]: next } : x));
    setSaving(true);
    qc.setQueryData(ORG_ACCESS_KEY, { ...data, modules: modulesNext });
    try {
      qc.setQueryData(ORG_ACCESS_KEY, await saveOrgAccess(modulesNext.map((x) => ({ key: x.key, worksuite: x.worksuite, local: x.local }))));
    } catch (e) {
      qc.setQueryData(ORG_ACCESS_KEY, data);
      toast('error', `Not saved. ${errorMessage(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="module-access-title" className="mt-8">
      <h3 id="module-access-title" className="text-[16px] font-bold text-ink">Module Access</h3>
      <p className="mt-1 text-[13px] text-ink-3">
        What the assistants may use from each module. They only ever see and change what you can, as you; turning a module on never gives you more
        access. Changes are always shown to you first and happen only when you confirm them. Local AI answers on this computer, but the data it reads
        and the changes it prepares come from WorkSuite, so they need a connection.
      </p>

      {manage ? (
        <div role="radiogroup" aria-label="Whose settings" className="mt-3 inline-flex rounded-[9px] bg-subtle p-0.5 text-[12.5px] font-semibold">
          {(['me', 'org'] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={scope === v} onClick={() => setScope(v)} className={cx('h-7 rounded-[7px] px-3', scope === v ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}>
              {v === 'me' ? 'For me' : 'For everyone'}
            </button>
          ))}
        </div>
      ) : null}
      {asOrg ? <p className="mt-2 text-[12.5px] text-ink-3">The most anyone in your organization may use. People can turn modules off for themselves, never on beyond this.</p> : null}

      {org.isLoading ? (
        <Spinner />
      ) : org.error ? (
        <div className="mt-3"><ErrorNote error={org.error} onRetry={() => void org.refetch()} /></div>
      ) : (
        <>
          {!data ? <p className="mt-3 rounded-[10px] bg-subtle px-3 py-2 text-[12.5px] text-ink-2">Your WorkSuite server does not offer module functions to the assistants yet. Your choices are kept and apply as soon as it does.</p> : null}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[13px]" aria-busy={saving}>
              <thead>
                <tr className="text-[11px] font-bold tracking-[0.4px] text-ink-3 uppercase">
                  <th rowSpan={2} className="border-b border-line py-1.5 text-left">Module</th>
                  <th colSpan={2} className="border-b border-line py-1.5">{ENGINE_LABEL.worksuite}</th>
                  <th colSpan={2} className="border-b border-line py-1.5">{ENGINE_LABEL.local}</th>
                </tr>
                <tr className="text-[11px] text-ink-3">
                  {COLUMNS.map((c) => <th key={`${c.engine}-${c.kind}`} className="border-b border-line px-2 py-1 font-semibold">{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {modules.map((m) => (
                  <tr key={m.key} className="border-b border-line/70">
                    <th scope="row" className="py-2 pr-3 text-left font-semibold text-ink">
                      {m.label}
                      {m.denied ? <span className="block text-[11.5px] font-normal text-ink-3">{m.denied}</span> : null}
                      {supportNote(m) ? <span className="block text-[11.5px] font-normal text-ink-3">{supportNote(m)}</span> : null}
                    </th>
                    {COLUMNS.map((c) => {
                      const label = `${m.label}: ${c.label} with ${ENGINE_LABEL[c.engine]}`;
                      if (asOrg) {
                        const why = m.supports[c.kind] ? null : 'Not supported by this module yet.';
                        return (
                          <td key={`${c.engine}-${c.kind}`} className="px-2 py-2 text-center" title={why ?? undefined}>
                            <Checkbox aria-label={label} aria-description={why ?? undefined} checked={m.supports[c.kind] && m[c.engine][c.kind]} disabled={!m.supports[c.kind] || saving} onChange={(e) => void setOrg(m, c.engine, c.kind, e.target.checked)} />
                          </td>
                        );
                      }
                      const e = effective(m, c.engine, prefs);
                      const on = c.kind === 'read' ? e.read : e.write;
                      const why = c.kind === 'read' ? e.readWhy : e.writeWhy;
                      // Off for a reason the person cannot change here: shown off and disabled, with the reason.
                      const fixed = !!why && !why.includes('Module Access') && !why.startsWith('Changes need');
                      return (
                        <td key={`${c.engine}-${c.kind}`} className="px-2 py-2 text-center" title={why ?? undefined}>
                          <Checkbox aria-label={label} aria-description={why ?? undefined} checked={on} disabled={fixed} onChange={(ev) => setMine(m, c.engine, c.kind, ev.target.checked)} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
