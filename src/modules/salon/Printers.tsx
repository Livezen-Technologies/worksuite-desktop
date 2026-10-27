import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { SalonPaper, SalonPrintPatch, SalonPrintSettings } from '@shared/types';
import { Icon } from '../../components/Icon';
import { Spinner, Switch, cx } from '../../components/ui';
import { Select } from '../../components/Select';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { clockAt, fetchDesks, forgetDesk, K, todayAt, type DeskList } from './api';
import { listPrinters, MK, openDrawer, printTest, saveDeskSettings, saveDeskTill, setPrintSettings } from './money';
import { DeskDialog, Failed, Label, Note, Page, Panel, Segmented, Stepper, TouchButton, useDesk, useNow, usePrintSettings } from './parts';

/**
 * Settings at the desk (D10, PRN-01…07): this computer's printers for
 * SalonMate — the receipt printer, the paper, copies, printing after each
 * payment and without the dialog, the cash drawer plugged into the receipt
 * printer — a test receipt in the three scripts, and this desk itself: which
 * it is, the owners' screens on the web, and pairing it again.
 *
 * The printers are kept on this computer — which printers are plugged in is
 * a fact about it — and told to WorkSuite too, so owners see how each desk
 * prints.
 */
const PAPERS: Array<{ value: SalonPaper; label: string }> = [
  { value: '80mm', label: '80 mm roll' },
  { value: '58mm', label: '58 mm roll' },
  { value: 'a4', label: 'A4' },
  { value: 'letter', label: 'Letter' },
];

const COLUMNS: Record<SalonPaper, string> = { '80mm': '48 columns', '58mm': '32 columns', a4: 'full page', letter: 'full page' };

export default function Printers() {
  const settings = usePrintSettings();
  if (settings.isError)
    return (
      <div className="px-5 py-4">
        <Failed text="This computer’s printer settings could not be read." onRetry={() => void settings.refetch()} />
      </div>
    );
  if (!settings.data) return <Spinner label="Loading printers…" />;
  return <PrinterSettings saved={settings.data} />;
}

function PrinterSettings({ saved }: { saved: SalonPrintSettings }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const printers = useQuery({ queryKey: ['salon', 'printers'], queryFn: listPrinters });
  const [draft, setDraft] = useState<SalonPrintSettings>(saved);
  const [busy, setBusy] = useState<string | null>(null);
  const dirty = (Object.keys(draft) as Array<keyof SalonPrintSettings>).some((k) => draft[k] !== saved[k]);
  const set = (patch: SalonPrintPatch) => setDraft((d) => ({ ...d, ...patch }));
  const names = printers.data ?? [];
  const gone = (name: string | null) => !!name && printers.isSuccess && !names.some((n) => n.name === name);

  async function save(): Promise<boolean> {
    setBusy('save');
    try {
      const patch: SalonPrintPatch = {};
      for (const k of Object.keys(draft) as Array<keyof SalonPrintSettings>) if (draft[k] !== saved[k]) Object.assign(patch, { [k]: draft[k] });
      const next = await setPrintSettings(patch);
      qc.setQueryData<SalonPrintSettings>(MK.print, next);
      setDraft(next);
      /* Owners see it in the list of desks; the printing itself does not wait for WorkSuite. */
      void saveDeskSettings(desk.desk.id, next).catch(() => undefined);
      toast('success', 'Saved on this computer.');
      return true;
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'That was not saved.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    if (dirty && !(await save())) return;
    setBusy('test');
    try {
      const o = await printTest();
      toast(o.ok ? 'success' : 'warning', o.ok ? `Test receipt ${o.silent ? 'sent to' : 'printed on'} ${o.printer ?? 'the printer chosen'}.` : o.message);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'The test receipt could not be printed.');
    } finally {
      setBusy(null);
    }
  }

  async function drawer() {
    setBusy('drawer');
    try {
      const o = await openDrawer();
      toast(o.ok ? 'success' : 'warning', o.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Page title="Printers & receipts" sub="Kept on this computer. Receipts use the template set in WorkSuite.">
      <div className="flex flex-col gap-3.5 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          <Panel title="Printers this computer can see" className="flex flex-col gap-2.5">
            {printers.isError ? (
              <Failed text="The printers could not be listed." onRetry={() => void printers.refetch()} />
            ) : printers.isLoading ? (
              <Spinner label="Looking for printers…" />
            ) : names.length === 0 ? (
              <Note tone="warning">This computer has no printer installed. Install the receipt printer’s driver, then come back here.</Note>
            ) : (
              <ul role="radiogroup" aria-label="Receipt printer" className="flex flex-col gap-2">
                {names.map((p) => {
                  const on = draft.receipt_printer === p.name;
                  return (
                    <li key={p.name}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => set({ receipt_printer: on ? null : p.name })}
                        className={cx('flex min-h-16 w-full items-center gap-3.5 rounded-[14px] px-4 text-left', on ? 'border-2 border-primary bg-selection' : 'border border-line bg-surface hover:bg-subtle')}
                      >
                        <Icon name="printer" size={22} className={on ? 'text-primary' : 'text-ink-2'} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[17px] font-bold text-ink">{p.displayName || p.name}</div>
                          <div className="truncate text-[13px] text-ink-2">{[p.isDefault ? 'This computer’s default printer' : null, draft.a4_printer === p.name ? 'Full-page copies' : null].filter(Boolean).join(' · ') || 'Installed on this computer'}</div>
                        </div>
                        {on ? <span className="shrink-0 text-[13px] font-semibold text-primary">Default for receipts</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {gone(draft.receipt_printer) ? <Note tone="warning">“{draft.receipt_printer}” is not on this computer any more. Choose the receipt printer again.</Note> : null}

            <Label className="mt-2">Paper</Label>
            <Segmented label="Paper" value={draft.paper} onChange={(paper) => set({ paper })} options={PAPERS} />
            {draft.paper === 'a4' || draft.paper === 'letter' ? (
              <div className="flex flex-col gap-1">
                <span className="text-[12.5px] font-semibold text-ink-2">Full pages print on</span>
                <Select
                  label="Full-page printer"
                  value={draft.a4_printer ?? ''}
                  options={[{ value: '', label: 'The receipt printer' }, ...names.map((p) => ({ value: p.name, label: p.displayName || p.name }))]}
                  loading={printers.isLoading}
                  onValueChange={(v) => set({ a4_printer: v || null })}
                />
              </div>
            ) : null}

            <div className="mt-2 flex flex-col gap-3">
              <Toggle label="Print without asking" hint={draft.receipt_printer ? 'The receipt comes out as soon as payment is taken — no print dialog.' : 'Choose the receipt printer first: without one, the print dialog asks where.'} checked={draft.silent} onChange={(silent) => set({ silent })} />
              <Toggle label="Print a receipt after every payment" hint="Off: print only when someone presses Print." checked={draft.auto_print} onChange={(auto_print) => set({ auto_print })} />
              <Toggle label="Open the cash drawer" hint="A drawer plugged into the receipt printer opens when cash is taken. Leave it off if the printer’s driver opens it." checked={draft.drawer === 'printer'} onChange={(on) => set({ drawer: on ? 'printer' : 'off' })} />
              {draft.drawer === 'printer' ? (
                <div className="ml-12 flex flex-wrap items-center gap-3">
                  <span className="text-[13px] text-ink-2">Drawer connector</span>
                  <div className="w-48">
                    <Segmented
                      label="Drawer connector"
                      value={String(draft.drawer_pin) as '2' | '5'}
                      onChange={(v) => set({ drawer_pin: v === '5' ? 5 : 2 })}
                      options={[
                        { value: '2', label: 'Pin 2' },
                        { value: '5', label: 'Pin 5' },
                      ]}
                    />
                  </div>
                  <TouchButton className="min-h-10 text-[13px]" icon="banknote" loading={busy === 'drawer'} disabled={!saved.receipt_printer || saved.drawer !== 'printer'} onClick={() => void drawer()}>
                    Open it now
                  </TouchButton>
                </div>
              ) : null}
            </div>

            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="text-[16px] font-bold text-ink">Copies</span>
              <Stepper label="Copies" value={draft.copies} min={1} max={3} onChange={(copies) => set({ copies })} />
            </div>

            <div className="mt-1 flex gap-2.5">
              <TouchButton icon="printer" loading={busy === 'test'} disabled={busy !== null} onClick={() => void test()}>
                Print a test receipt
              </TouchButton>
              <TouchButton variant="primary" className="flex-1" loading={busy === 'save'} disabled={!dirty || busy !== null} onClick={() => void save()}>
                {dirty ? 'Save' : 'Saved'}
              </TouchButton>
            </div>
          </Panel>

          <ThisDesk />
        </div>

        <div className="w-full xl:w-[380px] xl:shrink-0">
          <div className="mb-2 text-center text-[12px] font-bold tracking-[.03em] text-ink-2 uppercase">Preview of the test receipt</div>
          <TestPreview s={draft} />
        </div>
      </div>
    </Page>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-3">
      <div className="pt-0.5">
        <Switch checked={checked} onChange={onChange} label={label} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-ink">{label}</div>
        <div className="text-[13px] text-ink-2">{hint}</div>
      </div>
    </div>
  );
}

function Line({ children }: { children: string }) {
  return <div className="truncate">{children}</div>;
}

/** What the test receipt will say, as it is set now: WorkSuite's own test prints all three scripts. */
function TestPreview({ s }: { s: SalonPrintSettings }) {
  const desk = useDesk();
  const now = useNow(60_000);
  const tz = desk.location.timezone;
  const day = todayAt(tz, new Date(now)).split('-').reverse().join('/');
  return (
    <div className="bg-white px-[18px] py-5 font-mono text-[12px] leading-[1.6] text-ink shadow-[0_10px_30px_rgba(15,27,61,.15)]">
      <div className="text-center font-bold">TEST RECEIPT</div>
      <div className="text-center">
        {desk.company || 'SalonMate'} · {desk.desk.name}
      </div>
      <div className="my-2 border-t border-dashed border-primary" />
      <Line>{`Printer ${s.receipt_printer ?? 'asks each time'}`}</Line>
      <Line>{`Paper ${PAPERS.find((p) => p.value === s.paper)?.label.replace(' roll', '') ?? s.paper} · ${COLUMNS[s.paper]}`}</Line>
      <Line>{`Silent ${s.silent ? 'yes' : 'no'} · copies ${s.copies}`}</Line>
      <Line>{`Time ${day} ${clockAt(new Date(now).toISOString(), tz)}`}</Line>
      <div className="my-2 border-t border-dashed border-primary" />
      <div>සිංහල · தமிழ் · English</div>
      <div className="truncate">|....|....|....|....|....|....|....|....|</div>
      <div className="mt-2 text-center">If you can read all three lines, you are ready.</div>
    </div>
  );
}

/** Which desk this computer is, the owners' screens on the web, and pairing it again. */
function ThisDesk() {
  const desk = useDesk();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [changing, setChanging] = useState(false);
  const desks = useQuery({ queryKey: K.desks, queryFn: ({ signal }) => fetchDesks(signal), enabled: !desk.offline });
  const manage = !!desks.data?.may.manage && (desks.data.warehouses?.length ?? 0) + (desks.data.templates?.length ?? 0) > 0;
  const unsent = (desk.sync?.waiting ?? 0) + (desk.sync?.refused ?? 0) + (desk.sync?.others ?? 0);

  async function forget() {
    try {
      await forgetDesk();
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: K.all });
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'The pairing could not be forgotten.');
    }
  }

  return (
    <Panel title="This desk">
      <dl className="text-[15px]">
        <div className="flex justify-between gap-3 py-[3px]">
          <dt className="text-ink-2">Desk</dt>
          <dd className="m-0 font-semibold text-ink">{desk.desk.name}</dd>
        </div>
        <div className="flex justify-between gap-3 py-[3px]">
          <dt className="text-ink-2">Location</dt>
          <dd className="m-0 font-semibold text-ink">{desk.location.name}</dd>
        </div>
        <div className="flex justify-between gap-3 py-[3px]">
          <dt className="text-ink-2">POS register</dt>
          <dd className="m-0 font-semibold text-ink">{desk.desk.register ? `${desk.desk.register.code} · ${desk.desk.register.name}` : 'None — payments are Billing receipts'}</dd>
        </div>
        <div className="flex justify-between gap-3 py-[3px]">
          <dt className="text-ink-2">Stock location</dt>
          <dd className="m-0 font-semibold text-ink">{desk.desk.warehouse?.name ?? `${desk.location.name}’s own store`}</dd>
        </div>
        <div className="flex justify-between gap-3 py-[3px]">
          <dt className="text-ink-2">Receipt template</dt>
          <dd className="m-0 font-semibold text-ink">{desk.desk.receipt_template_name ?? 'Salon receipt'}</dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2.5">
        {manage ? (
          <TouchButton icon="pen" onClick={() => setChanging(true)}>
            Stock and receipt…
          </TouchButton>
        ) : null}
        <TouchButton icon="external" onClick={() => void call('app:openInBrowser', { path: '/salon' })}>
          Owners’ screens on the web
        </TouchButton>
        <TouchButton variant="quiet" className="text-danger" onClick={() => setConfirming(true)}>
          Pair this computer again…
        </TouchButton>
      </div>
      {changing && desks.data ? <TillDialog list={desks.data} onClose={() => setChanging(false)} /> : null}
      {confirming ? (
        <DeskDialog
          tone="danger"
          icon="warning"
          title="Pair this computer again?"
          sub={`This computer forgets that it is ${desk.desk.name}.`}
          labelledBy="salon-forget"
          width={560}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <TouchButton onClick={() => setConfirming(false)}>Keep this desk</TouchButton>
              <TouchButton variant="danger" onClick={() => void forget()}>
                Forget this desk
              </TouchButton>
            </>
          }
        >
          <p className="text-[14px] text-ink">To work as a front desk again it is paired anew, and an owner approves it. The old desk stays on the server until an owner revokes it.</p>
          {unsent > 0 ? (
            <p className="text-[14px] font-semibold text-danger">
              {unsent} change{unsent === 1 ? '' : 's'} made at this desk while WorkSuite was out of reach {unsent === 1 ? 'has' : 'have'} not reached it, and will be dropped.
            </p>
          ) : null}
        </DeskDialog>
      ) : null}
    </Panel>
  );
}

/** Where this desk takes stock from, and the receipt it prints (DSK-02) — for somebody who manages desks. */
function TillDialog({ list, onClose }: { list: DeskList; onClose: () => void }) {
  const desk = useDesk();
  const qc = useQueryClient();
  const stores = (list.warehouses ?? []).filter((w) => w.org_id === null || w.org_id === desk.org);
  const templates = list.templates ?? [];
  const [store, setStore] = useState<number | null>(desk.desk.warehouse?.id ?? null);
  const [template, setTemplate] = useState(desk.desk.receipt_template ?? templates[0]?.id ?? 'salon_80');
  const [busy, setBusy] = useState(false);
  const about = templates.find((t) => t.id === template)?.about;

  async function save() {
    setBusy(true);
    try {
      await saveDeskTill(desk.desk.id, { warehouse_id: store, receipt_template: template });
      toast('success', 'Saved for this desk.');
      void qc.invalidateQueries({ queryKey: K.desks });
      onClose();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'The desk could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <DeskDialog
      tone="indigo"
      icon="settings"
      title="Stock and receipt"
      sub={`What ${desk.desk.name} takes stock from, and the receipt it prints.`}
      labelledBy="salon-till"
      width={560}
      onClose={onClose}
      footer={
        <>
          <TouchButton onClick={onClose}>Cancel</TouchButton>
          <TouchButton variant="primary" loading={busy} onClick={() => void save()}>
            Save
          </TouchButton>
        </>
      }
    >
      {stores.length > 0 ? (
        <div className="flex flex-col gap-1">
          <Label>Stock location</Label>
          <Select
            label="Stock location"
            value={store !== null && stores.some((w) => w.id === store) ? String(store) : 'location'}
            options={[{ value: 'location', label: `${desk.location.name}’s own store` }, ...stores.map((w) => ({ value: String(w.id), label: w.code ? `${w.code} · ${w.name}` : w.name }))]}
            onValueChange={(v) => setStore(v === 'location' ? null : Number(v))}
          />
          <span className="text-[12.5px] text-ink-2">Products used on clients and retail sold here come out of this stock from the next checkout.</span>
        </div>
      ) : null}
      {templates.length > 0 ? (
        <div className="flex flex-col gap-1">
          <Label>Receipt template</Label>
          <Segmented label="Receipt template" value={template} onChange={setTemplate} options={templates.map((t) => ({ value: t.id, label: t.name }))} />
          {about ? <span className="text-[12.5px] text-ink-2">{about}</span> : null}
        </div>
      ) : null}
    </DeskDialog>
  );
}
