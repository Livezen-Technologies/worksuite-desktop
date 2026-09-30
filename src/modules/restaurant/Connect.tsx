import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '../../components/Select';
import { Button, Card, Spinner } from '../../components/ui';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { get, type Options, type Structure } from './api';
import { useT } from './i18n';
import { Failed, Heading, Note } from './parts';

/**
 * Pairing this computer as one of a branch's terminals (RM-PLT-003): the
 * company, the branch, and the terminal the back office set up for this
 * computer — a till, a kitchen screen, the pass or a printer host. Somebody
 * with `restaurant.device.manage` pairs it; the key the server hands over goes
 * straight into this computer's credential store (the main process asks for
 * it), and the staff then use it signed in as themselves.
 */
export default function Connect({ onPaired }: { onPaired: () => void }) {
  const t = useT();
  const [org, setOrgId] = useState<number | null>(null);
  const [branch, setBranch] = useState<number | null>(null);
  const [terminal, setTerminal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useQuery({ queryKey: ['restaurant', 'connect', 'options', org], queryFn: ({ signal }) => get<Options>('/options', org ? { org } : {}, signal) });
  const o = options.data;
  const company = org ?? o?.org ?? null;
  const structure = useQuery({
    queryKey: ['restaurant', 'connect', 'structure', company, branch],
    queryFn: ({ signal }) => get<Structure>('/structure', { org: company!, branch_id: branch! }, signal),
    enabled: !!company && !!branch,
  });

  async function pair() {
    if (!company || !branch || !terminal) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call('restaurant:pair', { org_id: company, branch_id: branch, terminal_id: terminal });
      toast('success', r.message);
      onPaired();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('connect.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (options.isError) return <div className="p-6"><Failed text={options.error instanceof Error ? options.error.message : t('connect.optionsFailed')} onRetry={() => void options.refetch()} /></div>;
  if (!o) return <Spinner label={t('shell.opening')} />;

  const mayPair = o.can.device_manage === true;
  const terminals = (structure.data?.terminals ?? []).filter((x) => x.branch_id === branch && x.active !== false);
  const modeLabel = (m: string) => t(`mode.${m}` as never) || m;

  return (
    <div className="flex max-w-[720px] flex-col gap-4 p-6">
      <Heading title={t('connect.title')} hint={t('connect.hint')} />
      {!mayPair ? <Note tone="warning">{t('connect.needsManager')}</Note> : null}
      <Card>
        <div className="flex flex-col gap-4">
          {o.companies.length > 1 ? (
            <Field label={t('connect.company')}>
              <Select
                label={t('connect.company')}
                value={String(company ?? '')}
                options={o.companies.map((c) => ({ value: String(c.id), label: c.name }))}
                onValueChange={(v) => {
                  setOrgId(Number(v) || null);
                  setBranch(null);
                  setTerminal(null);
                }}
              />
            </Field>
          ) : null}
          <Field label={t('connect.branch')}>
            {o.branches.length === 0 ? (
              <Note tone="muted">{t('connect.noBranches')}</Note>
            ) : (
              <Select
                label={t('connect.branch')}
                value={String(branch ?? '')}
                placeholder={t('connect.chooseBranch')}
                options={o.branches.map((b) => ({ value: String(b.branch_id), label: b.name }))}
                onValueChange={(v) => {
                  setBranch(Number(v) || null);
                  setTerminal(null);
                }}
              />
            )}
          </Field>
          {branch ? (
            <Field label={t('connect.terminal')}>
              {structure.isLoading ? (
                <Spinner />
              ) : structure.isError ? (
                <Failed text={structure.error instanceof Error ? structure.error.message : t('connect.optionsFailed')} onRetry={() => void structure.refetch()} />
              ) : terminals.length === 0 ? (
                <Note tone="muted">{t('connect.noTerminals')}</Note>
              ) : (
                <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={t('connect.terminal')}>
                  {terminals.map((x) => (
                    <label key={x.id} className="flex cursor-pointer items-center gap-3 rounded-[8px] border border-line px-3 py-2 hover:bg-subtle">
                      <input type="radio" name="terminal" checked={terminal === x.id} onChange={() => setTerminal(x.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold text-ink">{x.name}</span> <span className="text-ink-3">· {x.code} · {modeLabel(x.mode)}</span>
                      </span>
                      {x.paired ? <span className="text-[12px] text-warning">{t('connect.alreadyPaired')}</span> : null}
                    </label>
                  ))}
                </div>
              )}
            </Field>
          ) : null}
          {error ? <Note tone="danger">{error}</Note> : null}
          <div>
            <Button variant="primary" icon="link" loading={busy} disabled={!mayPair || !terminal} onClick={() => void pair()}>
              {t('connect.pair')}
            </Button>
            <p className="mt-1.5 text-[12px] text-ink-3">{t('connect.keyNote')}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-semibold text-ink-2">{label}</span>
      {children}
    </div>
  );
}
