import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SalesPrintPatch } from '@shared/sales';
import { useCanOpen } from '../../core/access';
import { errorMessage } from '../../core/bridge';
import { useTab } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { Field, input, Panel } from '../hr/parts';
import { printers, printSettings, setPrintSettings } from './print';

/**
 * Printers on this computer for Sales (FR-DSK-06, FR-LBL-06): one for delivery notes and manifests (A4), one for
 * shipping labels (4×6 in), and how labels reach it — raw ZPL straight to a thermal printer, or the server's PDF.
 * Remembered on this computer, for the server it is signed in to; nothing here goes to WorkSuite.
 *
 * Superseded by Label Studio's printers where the organisation has Label Studio (WS-LABEL-SRS-001 §2.1): label
 * printers are then this computer's registered Label Studio printers (D04), and this screen says so and links there.
 * It is kept as it is for installs without Label Studio.
 */
export default function Printers() {
  const qc = useQueryClient();
  const studio = useCanOpen('label');
  const { go } = useTab();
  const s = useQuery({ queryKey: ['sales', 'print-settings'], queryFn: printSettings });
  const list = useQuery({ queryKey: ['sales', 'printers'], queryFn: printers });
  const set = (patch: SalesPrintPatch) =>
    void setPrintSettings(patch).then(
      (next) => (qc.setQueryData(['sales', 'print-settings'], next), toast('success', 'Saved on this computer.')),
      (e) => toast('error', errorMessage(e)),
    );
  if (s.isLoading || list.isLoading) return <Spinner />;
  if (s.error) return <ErrorNote error={s.error} onRetry={() => void s.refetch()} />;
  const v = s.data!;
  const options = (none: string) => [{ value: '', label: none }, ...(list.data ?? []).map((p) => ({ value: p.name, label: p.displayName, hint: p.isDefault ? 'default' : undefined }))];
  return (
    <Panel title="Printers on this computer" sub="Kept on this computer for this server. Labels and delivery notes print here without the browser." bodyClassName="flex flex-col gap-3 px-3.5 py-3">
      {studio ? (
        <p className="m-0 rounded-[8px] bg-info-bg px-3 py-2 text-[12.5px] text-primary dark:bg-primary/15 dark:text-primary">
          Label printers are set up in Label Studio on this computer now.{' '}
          <button type="button" className="font-bold underline" onClick={() => go('/label?tab=printers')}>
            Open Label Studio printers
          </button>
        </p>
      ) : null}
      {list.error ? <ErrorNote error={list.error} /> : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Delivery notes and manifests (A4)">
          <Select<string> aria-label="Delivery-note printer" value={v.note_printer ?? ''} onValueChange={(p) => set({ note_printer: p || null })} options={options('The system’s default (with its dialog)')} className={input} />
        </Field>
        <Field label="Shipping labels (4×6 in)">
          <Select<string> aria-label="Label printer" value={v.label_printer ?? ''} onValueChange={(p) => set({ label_printer: p || null })} options={options('None chosen')} className={input} />
        </Field>
        <Field label="Labels go to the printer as" hint={v.label_format === 'zpl' ? 'Raw ZPL, through the system’s raw print path: a Zebra or any printer that speaks ZPL.' : 'The server’s PDF, through the printer’s driver. On Windows it opens to print.'}>
          <Select<string> aria-label="Label format" value={v.label_format} onValueChange={(f) => set({ label_format: f as 'zpl' | 'pdf' })} options={[{ value: 'zpl', label: 'ZPL (thermal)' }, { value: 'pdf', label: 'PDF' }]} className={input} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
        <Checkbox checked={v.silent} onChange={(e) => set({ silent: e.target.checked })} />
        Print silently to the printer chosen — no dialog
      </label>
      <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
        <Checkbox checked={v.auto_label} onChange={(e) => set({ auto_label: e.target.checked })} />
        Print the label by itself when a shipment is booked at the Shipping desk
      </label>
    </Panel>
  );
}
