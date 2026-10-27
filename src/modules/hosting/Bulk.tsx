import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Spinner } from '../../components/ui';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { bulk, BULK_ACTIONS, fetchLookups, K, tagsOf, type BulkAction, type BulkKind } from './api';
import { LookupSelect } from './Links';
import { Btn, Field, NeedsUpdate, Note, input, useReadOnly } from './parts';

/**
 * Bulk changes to the rows ticked in a list (HDM-UI-04, `POST bulk`): link a customer or project, add or remove tags,
 * set the responsible person, re-check certificates, remove. The server narrows each row to the caller's companies and
 * checks a customer or project against EACH row's company: the ones it refuses say why and the rest go ahead.
 */
type Act = BulkAction['action'];
const LABEL: Record<Act, string> = { link: 'Link customer or project…', tag: 'Tags…', owner: 'Responsible…', recheck: 'Check again', remove: 'Remove…' };

/** "3 changed, 1 not: shop.example.com: That customer is not one of this company's." */
export function bulkSummary(r: { done: number; refused: Array<{ id: number; why: string }> }): string {
  const head = r.refused.length ? text('{done} changed, {n} not', { done: r.done, n: r.refused.length }) : text('{done} changed', { done: r.done });
  return r.refused.length ? `${head}: ${r.refused.slice(0, 3).map((x) => x.why).join(' ')}${r.refused.length > 3 ? ' …' : ''}` : `${head}.`;
}

export function BulkBar({ kind, ids, orgs, onClear }: { kind: BulkKind; ids: number[]; orgs: number[]; onClear: () => void }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const [ask, setAsk] = useState<Act | null>(null);
  const [busy, setBusy] = useState(false);
  if (!ids.length) return null;
  const run = async (a: BulkAction) => {
    setBusy(true);
    try {
      const r = await bulk(kind, ids, a);
      toast(r.refused.length ? (r.done ? 'info' : 'error') : 'success', bulkSummary(r));
      void qc.invalidateQueries({ queryKey: ['hosting', kind] });
      void qc.invalidateQueries({ queryKey: ['hosting', kind === 'domains' ? 'domain' : kind === 'servers' ? 'server' : 'certificate'] });
      setAsk(null);
      if (!r.refused.length) onClear();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="toolbar" aria-label={text('Change the selected rows')} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-info-line bg-info-soft px-3 py-2 text-[12.5px] dark:bg-primary/10">
      <span className="font-semibold text-ink">{text('{n} selected', { n: ids.length })}</span>
      <span className="flex-1" />
      {BULK_ACTIONS[kind].map((a) => (
        <Btn key={a} danger={a === 'remove'} disabled={ro || busy} title={ro ? 'Needs a connection' : undefined} onClick={() => (a === 'recheck' ? void run({ action: 'recheck' }) : setAsk(a))}>
          {text(LABEL[a])}
        </Btn>
      ))}
      <Btn onClick={onClear}>Clear</Btn>
      {ask ? <BulkDialog kind={kind} act={ask} n={ids.length} orgs={orgs} busy={busy} onRun={(a) => void run(a)} onClose={() => setAsk(null)} /> : null}
    </div>
  );
}

function BulkDialog({ kind, act, n, orgs, busy, onRun, onClose }: { kind: BulkKind; act: Act; n: number; orgs: number[]; busy: boolean; onRun: (a: BulkAction) => void; onClose: () => void }) {
  // The pickers are one company's; with rows from several, the server refuses the ones from the others and says so.
  const org = orgs[0] ?? 0;
  const lookups = useQuery({ queryKey: K.lookups(`org:${org}`), queryFn: ({ signal }) => fetchLookups({ org_id: org }, signal), enabled: (act === 'link' || act === 'owner') && org > 0, staleTime: 120_000 });
  const [client, setClient] = useState<number | null>(null);
  const [project, setProject] = useState<number | null>(null);
  const [owner, setOwner] = useState<number | null>(null);
  const [add, setAdd] = useState('');
  const [remove, setRemove] = useState('');
  const what = kind === 'domains' ? text('{n} domains', { n }) : kind === 'servers' ? text('{n} servers', { n }) : text('{n} certificates', { n });
  const action: BulkAction | null =
    act === 'link' ? (client || project ? { action: 'link', ...(client ? { client_id: client } : {}), ...(project ? { project_id: project } : {}) } : null)
    : act === 'owner' ? { action: 'owner', owner_user_id: owner }
    : act === 'tag' ? (tagsOf(add).length || tagsOf(remove).length ? { action: 'tag', add: tagsOf(add), remove: tagsOf(remove) } : null)
    : { action: act } as BulkAction;
  const title = act === 'link' ? text('Link {what}', { what }) : act === 'owner' ? text('Who is responsible for {what}', { what }) : act === 'tag' ? text('Tags on {what}', { what }) : text('Remove {what}?', { what });
  const l = lookups.data;
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={500}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary={act !== 'remove'} danger={act === 'remove'} disabled={busy || !action} onClick={() => action && onRun(action)}>
            {act === 'remove' ? 'Remove' : 'Apply'}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px] text-ink-2">
        {act === 'link' || act === 'owner' ? (
          lookups.isPending && org ? (
            <Spinner />
          ) : l === null ? (
            <NeedsUpdate what={text('Linking')} />
          ) : (
            <>
              {act === 'link' ? (
                <div className="grid grid-cols-2 gap-3">
                  <LookupSelect label={text('Customer')} value={client} options={l?.clients ?? []} none={text('Leave as it is')} onChange={setClient} />
                  <LookupSelect label={text('Project')} value={project} options={l?.projects ?? []} none={text('Leave as it is')} onChange={setProject} />
                </div>
              ) : (
                <LookupSelect label={text('Responsible')} value={owner} options={l?.people ?? []} none={text('Nobody in particular')} onChange={setOwner} />
              )}
              {orgs.length > 1 ? <Note tone="warn">The selection spans several companies. These are the first company’s; rows of the others are refused and say so.</Note> : null}
            </>
          )
        ) : act === 'tag' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={text('Add tags')}>
              <input aria-label={text('Add tags')} autoFocus placeholder={text('client, renew')} value={add} onChange={(e) => setAdd(e.target.value)} className={input} />
            </Field>
            <Field label={text('Remove tags')}>
              <input aria-label={text('Remove tags')} value={remove} onChange={(e) => setRemove(e.target.value)} className={input} />
            </Field>
          </div>
        ) : (
          <p className="m-0">{kind === 'domains' ? text('They leave the register and can be restored for 30 days. A domain still at its registrar is only hidden.') : text('WorkSuite stops watching them. Nothing changes on the hosts.')}</p>
        )}
      </div>
    </Modal>
  );
}
