import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { listPrinters, openDrawer, PK, printTest, setPrintSettings, usePrintSettings } from './api';
import { useBarcodeScanner } from './barcode';
import { displayWindow, toggleCustomerDisplay } from './display';
import { useT, type PosKey } from './i18n';
import { ON } from './look';
import { useTillContext } from './parts';
import Printers from './Printers';
import TillScreen from './TillScreen';

/**
 * The till's settings on this computer, by section: its devices — the receipt printer, the cash drawer on it, the
 * barcode scanner (a keyboard-mode scanner, tested by scanning), the customer display — each with where it stands
 * and its one action; the receipt and printing; and this till itself. What the till sells, and who may use it, is
 * set in WorkSuite. A card terminal and a scale are not connected to a till yet, so neither is listed.
 */
export type SettingsTab = 'devices' | 'receipt' | 'till';
const TABS: Array<{ id: SettingsTab; label: PosKey }> = [
  { id: 'devices', label: 'pos.hw.devices' },
  { id: 'receipt', label: 'pos.hw.receipt' },
  { id: 'till', label: 'pos.hw.about' },
];

export default function TillSettings({ initial }: { initial: SettingsTab }) {
  const t = useT();
  const till = useTillContext();
  const asked = till.params.get('tab') as SettingsTab | null;
  const tab: SettingsTab = asked && TABS.some((x) => x.id === asked) ? asked : initial;
  return (
    <div className="flex min-h-full gap-5 px-8 py-6 max-lg:flex-col max-lg:px-5">
      <nav aria-label={t('pos.settings')} className="flex w-[260px] shrink-0 flex-col gap-1 max-lg:w-full">
        <h1 className="mb-2.5 text-[22px] font-extrabold">{t('pos.settings')}</h1>
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            aria-current={tab === x.id ? 'page' : undefined}
            onClick={() => till.go('printers', { tab: x.id })}
            className={cx('rounded-[12px] px-3.5 py-3 text-left text-[15px]', tab === x.id ? `${ON} bg-pos-panel font-extrabold text-primary` : 'font-semibold text-ink hover:bg-pos-key')}
          >
            {t(x.label)}
          </button>
        ))}
        <p className="mt-auto pt-4 text-[12px] text-ink-3">{t('pos.hw.foot')}</p>
      </nav>
      <section className="min-w-0 flex-1">{tab === 'devices' ? <Devices /> : tab === 'receipt' ? <Printers /> : <TillScreen />}</section>
    </div>
  );
}

type Tone = 'ok' | 'idle' | 'warn';
const TONE: Record<Tone, string> = { ok: 'bg-success-bg text-success', idle: 'bg-pos-key text-ink-2', warn: 'bg-warning-bg text-warning-ink' };

function Device({ icon, name, meta, state, tone, action, busy, onAction, disabled }: { icon: string; name: string; meta: ReactNode; state: string; tone: Tone; action: string; busy?: boolean; onAction: () => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-4 rounded-[18px] bg-pos-panel px-[18px] py-4 shadow-[inset_0_0_0_1px_var(--pos-line)]">
      <span className={cx('flex h-12 w-12 shrink-0 items-center justify-center rounded-pos', tone === 'ok' ? 'bg-pos-on text-primary' : 'bg-pos-key text-ink-3')}>
        <Icon name={icon} size={24} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[16px] font-bold">{name}</div>
        <div className="text-[13px] text-ink-3">{meta}</div>
      </div>
      <span className={cx('shrink-0 rounded-full px-3 py-1 text-[12px] font-bold', TONE[tone])}>{state}</span>
      <button type="button" disabled={disabled || busy} onClick={onAction} className="flex h-12 shrink-0 items-center gap-2 rounded-[12px] bg-pos-key px-[18px] text-[14px] font-bold text-ink hover:brightness-95 disabled:opacity-40">
        {busy ? <Icon name="spinner" size={16} className="animate-spin" /> : null}
        {action}
      </button>
    </div>
  );
}

function Devices() {
  const t = useT();
  const till = useTillContext();
  const settings = usePrintSettings();
  const printers = useQuery({ queryKey: PK.printers, queryFn: listPrinters });
  const display = useStore(displayWindow, (x) => x.open);
  const [busy, setBusy] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [scanned, setScanned] = useState<string | null>(null);
  useBarcodeScanner(testing, (code) => {
    setScanned(code);
    setTesting(false);
  });

  async function run(what: string, fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(what);
    try {
      const o = await fn();
      toast(o.ok ? 'success' : 'warning', o.message);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  const s = settings.data;
  const installed = (printers.data ?? []).map((p) => p.name);
  const printer = s?.receipt_printer ?? null;
  const missing = !!printer && printers.isSuccess && !installed.includes(printer);
  const drawer = s?.drawer === 'printer';
  return (
    <div className="flex flex-col gap-3">
      <Device
        icon="printer"
        name={t('pos.hw.printer')}
        meta={printer ? [printer, s?.mode === 'escpos' ? 'ESC/POS' : t('pos.hw.driver'), s?.paper === '58mm' ? '58 mm' : '80 mm', s?.auto_print ? t('pos.hw.autoPrint') : null].filter(Boolean).join(' · ') : t('pos.hw.noPrinter')}
        state={missing ? t('pos.hw.missing') : printer ? t('pos.hw.ready') : t('pos.hw.notSet')}
        tone={missing ? 'warn' : printer ? 'ok' : 'idle'}
        action={printer ? t('pos.hw.printTest') : t('pos.hw.setUp')}
        busy={busy === 'test'}
        onAction={() => (printer ? void run('test', printTest) : till.go('printers', { tab: 'receipt' }))}
      />
      <Device
        icon="box"
        name={t('pos.hw.drawer')}
        meta={drawer ? t('pos.hw.drawerOn', { pin: s?.drawer_pin ?? 2 }) : t('pos.hw.drawerOff')}
        state={drawer && printer && !missing ? t('pos.hw.ready') : drawer ? t('pos.hw.noPrinterShort') : t('pos.hw.notSet')}
        tone={drawer && printer && !missing ? 'ok' : drawer ? 'warn' : 'idle'}
        action={drawer ? t('pos.openDrawer') : t('pos.hw.setUp')}
        busy={busy === 'drawer'}
        disabled={drawer && !printer}
        onAction={() => (drawer ? void run('drawer', openDrawer) : till.go('printers', { tab: 'receipt' }))}
      />
      <Device
        icon="scan"
        name={t('pos.hw.scanner')}
        meta={testing ? t('pos.hw.scanNow') : scanned ? t('pos.hw.scanned', { code: scanned }) : t('pos.hw.scannerMeta')}
        state={scanned ? t('pos.hw.ready') : t('pos.hw.keyboard')}
        tone={scanned ? 'ok' : 'idle'}
        action={testing ? t('pos.cancel') : t('pos.hw.testScan')}
        onAction={() => {
          setScanned(null);
          setTesting((v) => !v);
        }}
      />
      <Device
        icon="monitor"
        name={t('pos.display')}
        meta={t('pos.hw.displayMeta')}
        state={display ? t('pos.hw.open') : t('pos.hw.closed')}
        tone={display ? 'ok' : 'idle'}
        action={display ? t('pos.close') : t('pos.hw.openIt')}
        onAction={() => void toggleCustomerDisplay()}
      />
      <DisplayTouch value={s?.display_touch ?? 'auto'} />
    </div>
  );
}

const TOUCH: Array<{ id: 'auto' | 'yes' | 'no'; label: PosKey }> = [
  { id: 'auto', label: 'pos.hw.touchAuto' },
  { id: 'yes', label: 'pos.hw.touchYes' },
  { id: 'no', label: 'pos.hw.touchNo' },
];

/**
 * Whether the customer display's screen takes touch (#294): automatic (what the system says of the monitor), yes or
 * no. With touch the customer can give their phone number at the display; without, the button is not shown there.
 */
function DisplayTouch({ value }: { value: 'auto' | 'yes' | 'no' }) {
  const t = useT();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function pick(v: 'auto' | 'yes' | 'no') {
    if (v === value) return;
    setBusy(true);
    try {
      await setPrintSettings({ display_touch: v });
      await qc.invalidateQueries({ queryKey: PK.print });
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-4 rounded-[18px] bg-pos-panel px-[18px] py-4 shadow-[inset_0_0_0_1px_var(--pos-line)]">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-pos bg-pos-key text-ink-3">
        <Icon name="phone" size={24} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[16px] font-bold">{t('pos.hw.touch')}</div>
        <div className="text-[13px] text-ink-3">{t('pos.hw.touchHint')}</div>
      </div>
      <div role="radiogroup" aria-label={t('pos.hw.touch')} className="flex shrink-0 gap-1 rounded-[12px] bg-pos-key p-1">
        {TOUCH.map((x) => (
          <button
            key={x.id}
            type="button"
            role="radio"
            aria-checked={value === x.id}
            disabled={busy}
            onClick={() => void pick(x.id)}
            className={cx('h-10 rounded-[10px] px-3.5 text-[14px] font-bold', value === x.id ? 'bg-pos-panel text-primary shadow-sm' : 'text-ink-2')}
          >
            {t(x.label)}
          </button>
        ))}
      </div>
    </div>
  );
}
