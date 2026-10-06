import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../../../core/bridge';
import { toast } from '../../../../core/toasts';
import { Icon } from '../../../../components/Icon';
import { Button, Switch } from '../../../../components/ui';
import { SK, socialApi, useInvalidate, useProviderApps, type ProviderApp, type ProviderApps as Apps } from '../../api';
import type { Tone } from '../../lib/status';
import { Field, INPUT, NativeSelect, NetChip, OptionalView, Pill } from '../../parts';

/**
 * A02 · Provider apps (SMM-ADM-002, §19): one developer app per network, Shared (the WorkSuite Cloud relay) or the
 * organisation's own. Secrets go to CoreSecretService and never come back: the field only says when one was set,
 * and typing replaces it. A secret left empty is not sent, so saving the mode or the ID keeps the stored one.
 */

const STATUS: Record<ProviderApp['status'], { label: string; tone: Tone }> = {
  live: { label: 'Live mode', tone: 'success' },
  approved: { label: 'Approved', tone: 'success' },
  limited: { label: 'Limited by tier', tone: 'warning' },
  review_pending: { label: 'Review pending', tone: 'warning' },
  audit_pending: { label: 'Audit pending', tone: 'warning' },
  not_configured: { label: 'Not configured', tone: 'muted' },
};

const WORDS: Partial<Record<ProviderApp['network'], { id: string; secret: string }>> = {
  meta: { id: 'App ID', secret: 'App secret' },
  x: { id: 'API key', secret: 'API key secret' },
  tiktok: { id: 'Client key', secret: 'Client secret' },
};

const X_TIERS = ['Free', 'Basic', 'Pro', 'Enterprise'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "•••••••••••• (set 12 Sep)" — when, never what. */
export function secretPlaceholder(app: Pick<ProviderApp, 'has_secret' | 'secret_set_at'>): string {
  if (!app.has_secret) return 'Not set';
  const d = app.secret_set_at ? new Date(app.secret_set_at.includes('T') ? app.secret_set_at : `${app.secret_set_at.replace(' ', 'T')}Z`) : null;
  const when = d && !Number.isNaN(d.getTime()) ? ` ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : '';
  return `•••••••••••• (set${when})`;
}

function chipFor(n: ProviderApp['network']): string {
  return n === 'meta' ? 'facebook' : n;
}

function AppCard({ app, canEdit }: { app: ProviderApp; canEdit: boolean }) {
  const invalidate = useInvalidate();
  const [mode, setMode] = useState(app.mode);
  const [enabled, setEnabled] = useState(app.enabled);
  const [clientId, setClientId] = useState(app.client_id ?? '');
  const [secret, setSecret] = useState('');
  const [tier, setTier] = useState(app.tier ?? '');
  const words = WORDS[app.network] ?? { id: 'Client ID', secret: 'Client secret' };
  const s = STATUS[app.status] ?? { label: app.status, tone: 'muted' as const };
  const dirty = mode !== app.mode || enabled !== app.enabled || clientId !== (app.client_id ?? '') || secret !== '' || tier !== (app.tier ?? '');
  const save = useMutation({
    mutationFn: () =>
      socialApi.saveProviderApp(app.network, {
        mode,
        enabled,
        ...(mode === 'own' ? { client_id: clientId.trim() || null } : {}),
        ...(secret ? { secret } : {}),
        ...(app.network === 'x' ? { tier: tier || null } : {}),
      }),
    onSuccess: () => {
      setSecret('');
      invalidate(SK.providerApps);
      toast('success', `${app.label} saved.`);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const own = mode === 'own';
  return (
    <section aria-label={app.label} className="rounded-[12px] border border-line bg-surface p-4">
      <header className="flex flex-wrap items-center gap-3">
        <NetChip network={chipFor(app.network)} size={30} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-bold text-ink">{app.label}</h3>
          <p className="truncate text-[12px] text-ink-3">{app.product}</p>
        </div>
        <Pill tone={s.tone} title={app.status_note ?? undefined}>
          {s.label}
        </Pill>
        <Switch label={`${app.label} enabled`} checked={enabled} disabled={!canEdit} onChange={setEnabled} />
      </header>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <Field label="Mode">
          <NativeSelect label={`${app.label} mode`} value={mode} disabled={!canEdit} onChange={(v) => setMode(v as ProviderApp['mode'])}>
            <option value="shared">Shared (WorkSuite Cloud relay)</option>
            <option value="own">Own app</option>
          </NativeSelect>
        </Field>
        <Field label={words.id}>
          <input className={`${INPUT} font-mono`} value={own ? clientId : ''} placeholder={own ? '' : 'Managed by WorkSuite Cloud'} disabled={!canEdit || !own} onChange={(e) => setClientId(e.target.value)} />
        </Field>
        <Field label={words.secret} hint={app.has_secret && own ? 'Type a new one to replace it.' : undefined}>
          <input
            type="password"
            autoComplete="new-password"
            className={`${INPUT} font-mono`}
            value={secret}
            placeholder={own ? secretPlaceholder(app) : 'Managed by WorkSuite Cloud'}
            disabled={!canEdit || !own}
            onChange={(e) => setSecret(e.target.value)}
          />
        </Field>
        {app.network === 'x' ? (
          <Field label="Plan tier">
            <NativeSelect label="Plan tier" value={tier} disabled={!canEdit} onChange={setTier}>
              <option value="">Not set</option>
              {X_TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              {tier && !X_TIERS.includes(tier) ? <option value={tier}>{tier}</option> : null}
            </NativeSelect>
          </Field>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <p className="min-w-0 flex-1 text-[12px] text-ink-3">
          {app.covers}
          {app.status_note ? <span className="block">{app.status_note}</span> : null}
        </p>
        {canEdit ? (
          <Button size="sm" variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function Body({ data, canEdit }: { data: Apps; canEdit: boolean }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.redirect_uri);
      toast('success', 'Redirect URI copied.');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[12px] border border-line bg-subtle px-4 py-3 text-[12.5px] text-ink-2">
        Each network needs a developer app registered by your organisation. Redirect URI for all networks:
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <code className="min-w-0 rounded-[6px] bg-surface px-2 py-1 font-mono text-[12px] break-all text-ink select-all">{data.redirect_uri}</code>
          <Button size="sm" icon="copy" onClick={() => void copy()}>
            Copy
          </Button>
        </div>
      </div>
      {data.apps.map((a) => (
        <AppCard key={`${a.network}-${a.client_id ?? ''}-${a.secret_set_at ?? ''}`} app={a} canEdit={canEdit} />
      ))}
    </div>
  );
}

export function ProviderAppsSection({ canEdit }: { canEdit: boolean }) {
  const q = useProviderApps();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-[16px] font-bold text-ink">Provider apps</h2>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-3">
          <Icon name="lock" size={13} />
          Secrets are sealed in CoreSecretService and never shown again
        </span>
      </div>
      <OptionalView q={q} what="Provider apps" compact>
        {(data) => <Body data={data} canEdit={canEdit} />}
      </OptionalView>
    </div>
  );
}
