import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { useScannerSeen, useWedge } from '../../core/scanner';
import { ErrorNote, Spinner } from '../../components/ui';
import { refusal } from '../finance/api';
import { BASE, saveSettings, type Can, type Company } from './api';
import { labelPrefs, saveLabelPrefs } from './labelSheets';
import { Btn, Field, Note, input, useReadOnly } from './parts';
import { SectionHeader, SettingsGroup } from '../../components/SettingsKit';

/**
 * Settings (D24): the module's settings as the server keeps them (code series, currency, default life, warranty
 * warning) for those with "Change asset module settings", and This computer — the scanner (heard or not: a
 * keyboard-wedge scanner is known only once it scans; Test scanner listens for one), the label printer and what is
 * kept here for working offline.
 */
const LABELS: Record<string, string> = {
  asset_prefix: 'Asset code prefix', request_prefix: 'Request prefix', number_pad: 'Digits in a code', default_currency: 'Currency',
  warranty_warn_days: 'Warn before warranty ends (days)', default_life_months: 'Default life (months)',
};

export default function Settings({ can }: { can: Can; companies: Company[] }) {
  const ro = useReadOnly() || !(can.settings || can.manage);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['assets', 'settings'], queryFn: ({ signal }) => apiGet<{ settings: Record<string, string> }>(`${BASE}/settings`, undefined, signal) });
  const printers = useQuery({ queryKey: ['assets', 'printers'], queryFn: () => call('print:printers'), staleTime: 60_000 });
  const [edits, setF] = useState<Record<string, string> | null>(null);
  const f = edits ?? q.data?.settings ?? {};
  const [prefs, setPrefs] = useState(labelPrefs);
  const [testing, setTesting] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const seen = useScannerSeen();
  const [busy, setBusy] = useState(false);
  useWedge((c) => (setHeard(c), setTesting(false)), testing);

  const save = async () => {
    setBusy(true);
    try {
      await saveSettings(f);
      toast('success', 'Settings saved.');
      void qc.invalidateQueries({ queryKey: ['assets'] });
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(false);
    }
  };
  const setPrinter = (printer: string) => {
    const p = { ...prefs, printer: printer || null };
    setPrefs(p);
    saveLabelPrefs(p);
  };

  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex min-w-0 flex-[2_1_480px] flex-col gap-3">
        <SectionHeader
          level={1}
          title="Settings"
          actions={
            <>
              <Btn disabled={ro} onClick={() => setF(null)}>Revert</Btn>
              <Btn primary disabled={ro || busy} onClick={() => void save()}>Save</Btn>
            </>
          }
        />
        <SettingsGroup title="Assets" className="!mb-0">
          {q.isPending ? <Spinner /> : q.error ? <div className="p-3"><ErrorNote error={q.error} /></div> : null}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 px-[18px] py-3.5">
            {Object.keys(f).map((k) => (
              <Field key={k} label={LABELS[k] ?? k.replace(/_/g, ' ')}>
                <input className={input} value={f[k] ?? ''} disabled={ro} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
              </Field>
            ))}
          </div>
        </SettingsGroup>
        <Note>A new prefix starts a new series; printed labels keep their codes.</Note>
      </div>
      <SettingsGroup title="This computer" className="!mb-0 min-w-0 flex-[1_1_300px] self-start">
        <div className="flex flex-col gap-2.5 px-[18px] py-3.5">
        <dl className="m-0 grid grid-cols-[100px_1fr] gap-x-2 gap-y-1.5 text-[12.5px]">
          <dt className="text-ink-3">Scanner</dt>
          <dd className="m-0">{heard ? `Heard: ${heard}` : seen ? 'Keyboard mode · ready' : 'Not heard yet'}</dd>
          <dt className="text-ink-3">Offline</dt>
          <dd className="m-0">The register, your assets and the dashboard last opened, encrypted — read-only offline.</dd>
        </dl>
        <Btn disabled={testing} onClick={() => (setHeard(null), setTesting(true))}>{testing ? 'Scan anything now…' : 'Test scanner'}</Btn>
        <Field label="Label printer">
          <select className={input} value={prefs.printer ?? ''} onChange={(e) => setPrinter(e.target.value)}>
            <option value="">The default printer</option>
            {(printers.data ?? []).map((p) => (
              <option key={p.name} value={p.name}>{p.displayName}</option>
            ))}
          </select>
        </Field>
        </div>
      </SettingsGroup>
    </div>
  );
}
