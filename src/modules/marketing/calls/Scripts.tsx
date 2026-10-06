import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Button, Empty, IconButton, Spinner } from '../../../components/ui';
import { fetchScriptVersions, MK, pageOf, saveScript, useScripts, type Script, type ScriptSection } from '../api';
import { day, plural } from '../lib/format';
import { useMarketingOrg } from '../org';
import { Field, Input, Loaded, Mono, OptionalView, PageBody, PageHeader, Panel, Refused, TD, TH, Table, TextArea, useAction } from '../parts';

/**
 * Call scripts (MKT-CAL-07): six sections — opening, reason for call, qualify, pitch, objections, close — with the
 * tags {{first_name}}, {{organisation}} and {{agent_name}} filled in on the agent's screen (DK11). Saving an existing
 * script makes a new version; a campaign keeps the version it was started with. Earlier versions are listed, read
 * only, where the server offers them (Target).
 */

/** The six sections, in the order an agent reads them. */
export const SECTIONS: ReadonlyArray<{ id: ScriptSection; label: string; hint: string }> = [
  { id: 'opening', label: 'Opening', hint: 'Who is calling, and whether now is a good time.' },
  { id: 'reason', label: 'Reason for call', hint: 'Why this person, why now.' },
  { id: 'qualify', label: 'Qualify', hint: 'The questions that tell whether it fits.' },
  { id: 'pitch', label: 'Pitch', hint: 'What you offer, in a few lines.' },
  { id: 'objections', label: 'Objections', hint: 'Common answers, and how to reply.' },
  { id: 'close', label: 'Close', hint: 'The next step you ask for.' },
];

export const EMPTY_SECTIONS: Record<ScriptSection, string> = { opening: '', reason: '', qualify: '', pitch: '', objections: '', close: '' };

/** A script's sections, whatever the server left out. */
export function sectionsOf(s: Partial<Record<ScriptSection, string | null>> | null | undefined): Record<ScriptSection, string> {
  const out = { ...EMPTY_SECTIONS };
  for (const { id } of SECTIONS) out[id] = s?.[id] ?? '';
  return out;
}

export default function Scripts({ id }: { id: number | 'new' | null }) {
  if (id === null) return <ScriptList />;
  return <ScriptScreen key={String(id)} id={id} />;
}

function ScriptList() {
  const { go } = useTab();
  const q = useScripts();
  const create = () => go('/marketing/scripts/new');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing / Calls"
        title="Scripts"
        sub="Six sections, versioned: a campaign keeps the version it was started with"
        actions={
          <Button variant="primary" icon="plus" onClick={create}>
            New script
          </Button>
        }
      />
      <PageBody>
        <Loaded q={q} what="Call scripts">
          {(rows) =>
            rows.length === 0 ? (
              <Empty
                icon="file-text"
                title="No scripts yet"
                hint="A script walks the agent through the call: opening, reason for call, qualify, pitch, objections and close, with the contact’s name filled in."
                action={
                  <Button variant="primary" icon="plus" className="mt-2" onClick={create}>
                    New script
                  </Button>
                }
              />
            ) : (
              <Table
                label="Scripts"
                head={
                  <tr>
                    <th className={TH}>Script</th>
                    <th className={TH}>Version</th>
                    <th className={TH}>Used by</th>
                    <th className={TH}>Updated</th>
                  </tr>
                }
              >
                {rows.map((s) => (
                  <tr key={s.id} className="cursor-pointer hover:bg-subtle/60" onClick={() => go(`/marketing/scripts/${s.id}`)}>
                    <td className={TD}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          go(`/marketing/scripts/${s.id}`);
                        }}
                        className="max-w-[360px] truncate text-left font-semibold text-ink hover:text-primary hover:underline"
                      >
                        {s.name}
                      </button>
                      {s.sections?.opening ? <span className="block max-w-[420px] truncate text-[11.5px] text-ink-3">{s.sections.opening}</span> : null}
                    </td>
                    <td className={TD}>
                      <Mono>{`v${s.version}`}</Mono>
                    </td>
                    <td className={TD}>{typeof s.campaigns_count === 'number' ? plural(s.campaigns_count, 'campaign') : '—'}</td>
                    <td className={TD}>{day(s.updated_at)}</td>
                  </tr>
                ))}
              </Table>
            )
          }
        </Loaded>
      </PageBody>
    </div>
  );
}

function ScriptScreen({ id }: { id: number | 'new' }) {
  const { go } = useTab();
  const scripts = useScripts();
  if (id === 'new') return <ScriptForm script={null} />;
  const script = scripts.data?.find((s) => s.id === id);
  if (script) return <ScriptForm script={script} />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader crumb="Marketing / Scripts" title="Script" back={<IconButton icon="back" label="Scripts" onClick={() => go('/marketing/scripts')} />} />
      <PageBody>
        {scripts.isPending ? (
          <Spinner />
        ) : scripts.error ? (
          <Refused error={scripts.error} what="Call scripts" onRetry={() => void scripts.refetch()} />
        ) : (
          <Empty icon="file-text" title="This script isn’t here" hint="It may have been removed, or belong to another company." />
        )}
      </PageBody>
    </div>
  );
}

function ScriptForm({ script }: { script: Script | null }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const { go } = useTab();
  const [name, setName] = useState(script?.name ?? '');
  const [sections, setSections] = useState<Record<ScriptSection, string>>(() => sectionsOf(script?.sections));
  const [tried, setTried] = useState(false);
  const [busy, run] = useAction();
  const nameProblem = tried && !name.trim() ? 'Give the script a name.' : null;

  const save = async () => {
    setTried(true);
    if (!name.trim()) return;
    const out: { saved: Script | null } = { saved: null };
    const ok = await run('save', async () => {
      out.saved = await saveScript(org, script?.id ?? null, { name: name.trim(), sections });
    });
    const saved = out.saved;
    if (!ok || !saved) return;
    // The list is where the editor reads a script from: hold the answer there until the list is read again.
    qc.setQueryData<Script[]>(MK.scripts(org), (rows) => (rows ? (rows.some((r) => r.id === saved.id) ? rows.map((r) => (r.id === saved.id ? { ...r, ...saved } : r)) : [...rows, saved]) : rows));
    void qc.invalidateQueries({ queryKey: MK.scripts(org) });
    if (script) {
      toast('success', typeof saved.version === 'number' ? `Saved as version ${saved.version}.` : 'Saved as a new version.');
    } else {
      toast('success', 'Script created.');
      go(`/marketing/scripts/${saved.id}`);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing / Scripts"
        title={script ? script.name : 'New script'}
        sub={script ? `Version ${script.version} · updated ${day(script.updated_at)}` : 'Six sections; tags are filled in for each call'}
        back={<IconButton icon="back" label="Scripts" onClick={() => go('/marketing/scripts')} />}
        actions={
          <>
            <Button disabled={busy !== null} onClick={() => go('/marketing/scripts')}>
              Cancel
            </Button>
            <Button variant="primary" icon="check" loading={busy === 'save'} onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <Panel title="Script" bodyClassName="flex flex-col gap-3.5">
            <Field label="Name" error={nameProblem}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Website care" autoFocus={!script} />
            </Field>
            <p className="rounded-[8px] bg-subtle px-3 py-2 text-[12px] text-ink-2">
              Tags, filled in on the agent’s screen: <Mono className="text-ink">{'{{first_name}}'}</Mono> the contact’s first name · <Mono className="text-ink">{'{{organisation}}'}</Mono> their organisation ·{' '}
              <Mono className="text-ink">{'{{agent_name}}'}</Mono> the agent’s first name.
            </p>
            {SECTIONS.map((s, i) => (
              <Field key={s.id} label={`${i + 1}. ${s.label}`} hint={s.hint}>
                <TextArea
                  value={sections[s.id]}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSections((x) => ({ ...x, [s.id]: v }));
                  }}
                  rows={3}
                />
              </Field>
            ))}
            <p className="text-[12px] text-ink-3">
              {script
                ? `Saving makes version ${script.version + 1}; campaigns keep the version they were started with.`
                : 'Saving makes version 1. Later saves make new versions; campaigns keep the version they were started with.'}
            </p>
          </Panel>
          {script ? <Versions script={script} /> : null}
        </div>
      </PageBody>
    </div>
  );
}

function Versions({ script }: { script: Script }) {
  const org = useMarketingOrg();
  const q = useQuery({ queryKey: [...MK.scripts(org), script.id, 'versions'], queryFn: ({ signal }) => fetchScriptVersions(script.id, signal) });
  return (
    <Panel title="Versions" sub="Read only">
      <OptionalView
        q={q}
        what="Script versions"
        notOffered={<p className="text-[12px] text-ink-3">This WorkSuite server doesn’t list earlier versions yet. Each save still makes a new one, and campaigns keep theirs.</p>}
      >
        {(answer) => {
          const rows = pageOf<Script>(answer).rows;
          return rows.length === 0 ? (
            <p className="text-[12px] text-ink-3">Only this version so far.</p>
          ) : (
            <ul className="flex flex-col">
              {[...rows]
                .sort((a, b) => b.version - a.version)
                .map((v) => (
                  <li key={v.version} className="border-b border-line py-1.5 last:border-b-0">
                    <details>
                      <summary className="cursor-pointer text-[12.5px] text-ink">
                        <Mono className="font-semibold">{`v${v.version}`}</Mono>
                        <span className="text-ink-3">{` · ${day(v.updated_at)}${v.version === script.version ? ' · current' : ''}`}</span>
                      </summary>
                      <dl className="mt-1.5 flex flex-col gap-1.5 pl-3">
                        {SECTIONS.map((s, i) => (
                          <div key={s.id}>
                            <dt className="text-[11px] font-bold text-ink-3">{`${i + 1}. ${s.label}`}</dt>
                            <dd className="text-[12px] whitespace-pre-wrap text-ink-2">{v.sections?.[s.id] || '—'}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  </li>
                ))}
            </ul>
          );
        }}
      </OptionalView>
    </Panel>
  );
}
