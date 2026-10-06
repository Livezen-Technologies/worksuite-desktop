import { Checkbox } from '../../../../components/Checkbox';
import { useMutation } from '@tanstack/react-query';
import { useState, type Ref } from 'react';
import { errorMessage } from '../../../../core/bridge';
import { toast } from '../../../../core/toasts';
import { Icon } from '../../../../components/Icon';
import { Button, cx, Modal } from '../../../../components/ui';
import { SK, socialApi, useInvalidate, type Brand, type ConnectableAsset } from '../../api';
import { NETWORKS, networkInfo, type Network } from '../../lib/networks';
import { NativeSelect, NetChip, Panel } from '../../parts';
import { FallbackLink, openInBrowser } from './flows';

/**
 * A01 · "Connect an account" (WF-01, SMM-ACC-001…003, AC-01): the person signs in on the network's own page in the
 * browser, comes back, and picks the pages, profiles, channels or locations to add. Ones already in the
 * organisation cannot be added twice; ones missing a scope are added as Limited, and the list says which.
 */

type Step = { kind: 'waiting'; network: Network; url: string } | { kind: 'choose'; network: Network; assets: ConnectableAsset[] };

export function ConnectPanel({ brands, defaultBrand, canConnect, focusRef }: { brands: Brand[]; defaultBrand: number | null; canConnect: boolean; focusRef?: Ref<HTMLElement> }) {
  const invalidate = useInvalidate();
  const [brand, setBrand] = useState<string>(defaultBrand ? String(defaultBrand) : '');
  const [step, setStep] = useState<Step | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const brandId = brand ? Number(brand) : null;

  const start = useMutation({
    mutationFn: (n: Network) => socialApi.connect(n, brandId),
    onSuccess: async (r, n) => {
      setStep({ kind: 'waiting', network: n, url: r.redirect_url });
      await openInBrowser(r.redirect_url);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const load = useMutation({
    mutationFn: () => socialApi.connectable(),
    onSuccess: (r) => {
      if (!step) return;
      if (!r.offered) {
        toast('error', r.message);
        return;
      }
      setPicked(r.data.filter((a) => !a.already_connected).map((a) => a.external_id));
      setStep({ kind: 'choose', network: step.network, assets: r.data });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const add = useMutation({
    mutationFn: () => socialApi.addAssets(picked, brandId),
    onSuccess: (r) => {
      invalidate(SK.accounts, SK.status, SK.brands, SK.connectable);
      const n = r.accounts?.length ?? picked.length;
      toast('success', n === 1 ? 'Account connected.' : `${n} accounts connected.`);
      setStep(null);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const close = () => setStep(null);
  const label = step ? networkInfo(step.network).label : '';

  return (
    <Panel title="Connect an account" className="h-fit" bodyClassName="flex flex-col gap-3">
      <section ref={focusRef} tabIndex={-1} aria-label="Connect an account" className="flex flex-col gap-3 outline-none">
        <p className="text-[12.5px] leading-relaxed text-ink-2">You sign in on the network's own page and choose what WorkSuite may do. WorkSuite never sees or stores your social password; access tokens are sealed in the WorkSuite secret vault.</p>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-ink-2">Add new accounts to</span>
          <NativeSelect label="Brand for new accounts" value={brand} onChange={setBrand} disabled={!canConnect}>
            <option value="">No brand yet</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <div className="grid grid-cols-2 gap-2">
          {NETWORKS.map((n) => (
            <button
              key={n}
              type="button"
              disabled={!canConnect || start.isPending}
              onClick={() => start.mutate(n)}
              className="flex h-10 min-w-0 items-center gap-2 rounded-[9px] border border-line bg-surface px-2.5 text-left text-[12.5px] font-semibold text-ink hover:bg-subtle focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
            >
              <NetChip network={n} size={22} />
              <span className="truncate">{networkInfo(n).label}</span>
            </button>
          ))}
        </div>
        {!canConnect ? <p className="text-[12px] text-ink-3">Connecting accounts needs social.account.connect.</p> : null}
        <p className="text-[11.5px] text-ink-3">Which networks appear here is set by an administrator in Module settings › Provider apps.</p>
      </section>

      {step?.kind === 'waiting' ? (
        <Modal
          title={`Waiting for you to finish on ${label}…`}
          onClose={close}
          footer={
            <>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button variant="primary" loading={load.isPending} onClick={() => load.mutate()}>
                I’ve signed in
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink">Sign in to {label} in your browser and allow what WorkSuite asks for. Then come back here to choose what to add.</p>
          <FallbackLink url={step.url} />
        </Modal>
      ) : null}

      {step?.kind === 'choose' ? (
        <Modal
          title="Choose pages/profiles to add"
          width={560}
          onClose={close}
          footer={
            <>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button variant="primary" loading={add.isPending} disabled={!picked.length} onClick={() => add.mutate()}>
                Add {picked.length || ''}
              </Button>
            </>
          }
        >
          {step.assets.length ? (
            <ul className="flex flex-col gap-1.5">
              {step.assets.map((a) => {
                const on = picked.includes(a.external_id);
                return (
                  <li key={a.external_id}>
                    <label className={cx('flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5', a.already_connected ? 'border-line opacity-60' : on ? 'cursor-pointer border-primary bg-selection' : 'cursor-pointer border-line')}>
                      <Checkbox
                        disabled={a.already_connected}
                        checked={on}
                        onChange={(e) => setPicked(e.target.checked ? [...picked, a.external_id] : picked.filter((x) => x !== a.external_id))}
                      />
                      <NetChip network={a.network} size={22} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-ink">{a.display_name}</span>
                        <span className="block truncate text-[11.5px] text-ink-3">{[a.handle, a.account_type].filter(Boolean).join(' · ')}</span>
                        {a.already_connected ? <span className="block text-[11.5px] text-ink-3">Already connected in this organisation</span> : null}
                        {!a.already_connected && a.missing?.length ? <span className="block text-[11.5px] font-semibold text-warning">Will be Limited: {a.missing.join(', ')}</span> : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">
              <Icon name="info" size={14} className="mr-1 inline" />
              {label} gave WorkSuite nothing to add. Make sure you are an admin of the page or profile, then try again.
            </p>
          )}
        </Modal>
      ) : null}
    </Panel>
  );
}
