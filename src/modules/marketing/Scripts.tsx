import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { cx, Spinner } from '../../components/ui';
import { listStamp } from '../../core/time';
import { toast } from '../../core/toasts';
import { refreshMarketing, send } from './api';
import { SECTIONS, type CallScript } from './calls';
import { Caption, ConfirmSheet, useCallScripts } from './calls-parts';
import { LANGUAGES, ScriptSheet } from './calls-scripts';
import { btnPrimary, btnSmall, Card, Empty, PageHeader, Pill, Seg } from './parts';
import { companiesWhere, refusal, type Options } from './types';
import { ScriptVersions } from './email-governance';

/**
 * Call scripts (MKT-CAL-07): what an agent reads beside every contact — the introduction, the questions that qualify,
 * the pitch, answers to objections, the close and the next action. Whoever runs call campaigns in a company writes,
 * changes and archives its scripts; an agent reads them here and in the workspace.
 *
 * Archiving keeps a script for the campaigns already using it (the server never deletes one); an archived script is
 * listed under Archived, to read.
 */
export default function Scripts({ options }: { options: Options }) {
  const where = companiesWhere(options, 'call_manage');
  const [archived, setArchived] = useState<'current' | 'archived'>('current');
  const q = useCallScripts(archived === 'archived');
  const [editing, setEditing] = useState<CallScript | 'new' | null>(null);
  const [versions, setVersions] = useState<CallScript | null>(null);
  const [archiving, setArchiving] = useState<CallScript | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const many = options.companies.length > 1;
  const items = (q.data?.items ?? []).filter((s) => (archived === 'archived' ? s.archived : !s.archived));

  async function archive(s: CallScript) {
    setBusy(true);
    try {
      const r = await send('DELETE', `/api/marketing/calls/scripts/${s.id}`);
      toast('success', r.message ?? 'Archived');
      void refreshMarketing();
      setArchiving(null);
    } catch (e) {
      toast('error', refusal(e, 'The script could not be archived.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <PageHeader
        crumbs={['Calls']}
        title="Scripts"
        sub="What agents read on a call: six parts, from the introduction to the next action."
        actions={
          where.length > 0 ? (
            <button type="button" className={btnPrimary} onClick={() => setEditing('new')}>
              <Icon name="plus" size={15} /> New script
            </button>
          ) : null
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Seg
          label="Which scripts"
          value={archived}
          onChange={setArchived}
          options={[
            { id: 'current', label: 'In use' },
            { id: 'archived', label: 'Archived' },
          ]}
        />
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <Card>
          <Empty text={refusal(q.error, 'Scripts could not be loaded.')} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <Empty text={archived === 'archived' ? 'No archived scripts.' : 'No scripts yet. A campaign shows its script beside every contact in the queue.'} />
        </Card>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((s) => {
            const mine = where.some((c) => c.id === s.org_id);
            const shown = open === s.id;
            const company = options.companies.find((c) => c.id === s.org_id)?.name;
            const language = LANGUAGES.find((l) => l.value === s.language)?.label ?? s.language.toUpperCase();
            return (
              <li key={s.id} className="rounded-[12px] border border-line bg-surface">
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <button type="button" aria-expanded={shown} onClick={() => setOpen(shown ? null : s.id)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                    <Icon name={shown ? 'chevron-down' : 'chevron-right'} size={15} className="mt-0.5 shrink-0 text-ink-3" />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 text-[13.5px] font-bold text-ink">
                        {s.name}
                        <Pill dot={false}>{language}</Pill>
                        {s.archived ? <Pill tone="amber">Archived</Pill> : null}
                      </span>
                      <span className="block truncate text-[12px] text-ink-3">
                        {[many ? company : null, s.updated_at ? `Changed ${listStamp(s.updated_at)}` : null].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </span>
                  </button>
                  <button type="button" className={btnSmall} onClick={() => setVersions(s)}>
                    Versions{s.version ? ` · v${s.version}` : ''}
                  </button>
                  {mine && !s.archived ? (
                    <div className="flex gap-1.5">
                      <button type="button" className={btnSmall} onClick={() => setEditing(s)}>
                        Edit
                      </button>
                      <button type="button" className={btnSmall} onClick={() => setArchiving(s)}>
                        Archive
                      </button>
                    </div>
                  ) : null}
                </div>
                {shown ? (
                  <div className="grid gap-3 border-t border-line px-4 py-3 sm:grid-cols-2">
                    {SECTIONS.map(([k, label], i) => (
                      <div key={k} className="min-w-0">
                        <Caption>{`${i + 1}. ${label}`}</Caption>
                        <p className={cx('m-0 text-[13px] leading-snug whitespace-pre-line', s.sections[k]?.trim() ? 'text-ink' : 'text-ink-3')}>{s.sections[k]?.trim() || 'Nothing written for this part.'}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {editing ? <ScriptSheet script={editing === 'new' ? null : editing} companies={where} onClose={() => setEditing(null)} /> : null}
      {versions ? (
        <ScriptVersions scriptId={versions.id} name={versions.name} canManage={where.some((c) => c.id === versions.org_id)} words={Object.fromEntries(SECTIONS)}
          onClose={() => setVersions(null)} onRestored={() => void refreshMarketing()} />
      ) : null}
      {archiving ? (
        <ConfirmSheet
          title={`Archive “${archiving.name}”?`}
          body="Campaigns already using it keep showing it to their agents. It can no longer be chosen for a campaign."
          action="Archive"
          busy={busy}
          onClose={() => setArchiving(null)}
          onYes={() => void archive(archiving)}
        />
      ) : null}
    </div>
  );
}
