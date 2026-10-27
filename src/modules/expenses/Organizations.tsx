import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { btnPrimary, Field, input, Panel } from '../../components/PageKit';
import { Pill } from '../../components/ListKit';
import { MONTHS, problemsOf } from '../finance/api';
import { Notice } from '../../components/RecordKit';
import { can, canAct, fetchOrgs, K } from './api';
import { createOrg, KA, orgDraft, orgProblems, type OrgDraft } from './admin';

/**
 * Set up a company: the organization in the shared Directory table, its
 * expense settings, and the person creating it as its administrator.
 *
 * The last part is why this is here rather than only in Directory, which
 * creates companies too: an expense organization with no administrator can
 * only be repaired by a super-admin, because nobody else may set its
 * policies or add its people.
 *
 * Shown in Settings, and by the shell on a fresh installation with no company
 * at all — to people holding `expense.admin`. Anybody else sees the companies
 * they can see and the sentence the server would refuse them with, rather
 * than a form that fails on Create.
 */
export function Organizations({ onCreated }: { onCreated: () => void }) {
  const qc = useQueryClient();
  const uid = useStore(app, (s) => s.auth?.user?.id ?? '');
  const perms = useStore(app, (s) => s.bootstrap?.permissions);
  const mayCreate = can(perms, 'expense.admin');
  // The shell's own key: served from its cache, and refreshed with it.
  const list = useQuery({ queryKey: K.orgs(uid), queryFn: ({ signal }) => fetchOrgs(signal), retry: false, staleTime: 60_000 });
  const [d, setD] = useState<OrgDraft>(orgDraft);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const orgs = list.data?.items ?? [];

  const create = async () => {
    const found = orgProblems(d);
    setProblems(found);
    if (found.length) return;
    setBusy(true);
    try {
      const r = await createOrg(d);
      toast('success', r.message ?? `${d.name.trim()} created. You are its administrator.`);
      setD(orgDraft());
      void qc.invalidateQueries({ queryKey: KA.orgLists });
      onCreated();
    } catch (e) {
      // The server's sentence, unchanged: a refusal names what is missing.
      setProblems(problemsOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5">
      {orgs.length ? (
        <Panel title="Organizations you can see" bodyClassName="flex flex-col">
          {orgs.map((o) => (
            <div key={o.id} data-org={o.id} className="flex items-center gap-3 border-b border-line/60 px-3.5 py-2.5 text-[13px] last:border-b-0">
              <b className="min-w-0 flex-1 truncate text-ink">{o.name}</b>
              <span className="w-[60px] shrink-0 font-mono text-[12px] text-ink-3">{o.currency}</span>
              <span className="w-[300px] shrink-0 text-right text-[12.5px] text-ink-2">
                {o.role ? <Pill tone={o.role === 'admin' ? 'blue' : 'grey'}>{o.role}</Pill> : canAct(o) ? 'Every act, through the super-admin grant' : 'Read only, through consolidated reporting'}
              </span>
            </div>
          ))}
        </Panel>
      ) : null}

      <Panel title={orgs.length ? 'Set up another one' : 'Set up a company'} bodyClassName="flex flex-col gap-3 px-3.5 py-3">
        {mayCreate ? (
          <>
            <div className="grid grid-cols-[1fr_110px_170px_auto] items-end gap-2.5">
              <Field label="Name">
                <input aria-label="Name" value={d.name} maxLength={150} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Livezen Technologies" className={input} />
              </Field>
              <Field label="Currency">
                <input aria-label="Currency" value={d.currency} maxLength={3} onChange={(e) => setD({ ...d, currency: e.target.value.toUpperCase().slice(0, 3) })} className={input + ' font-mono'} />
              </Field>
              <Field label="Year starts">
                <Select<string> aria-label="Year starts" value={d.fiscalStartMonth} onValueChange={(v) => setD({ ...d, fiscalStartMonth: v })} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} className={input} />
              </Field>
              <button type="button" className={btnPrimary} disabled={busy || !d.name.trim()} onClick={() => void create()}>
                {busy ? 'Creating…' : 'Create'}
              </button>
            </div>
            {problems.length ? (
              <Notice tone="red">
                {problems.map((p) => (
                  <div key={p}>{p}</div>
                ))}
              </Notice>
            ) : null}
            <Notice tone="grey">You become its administrator, because an organization created with nobody in that role can only be repaired by a super-admin. Nothing else is set up — add people, then policies and budgets.</Notice>
          </>
        ) : (
          <p className="m-0 text-[13px] text-ink-2">
            Creating an organization needs expense administration rights (<code className="font-mono text-[12px]">expense.admin</code>). Somebody who holds them can set one up, and becomes its administrator.
          </p>
        )}
      </Panel>
    </div>
  );
}
