/**
 * Receipt printers the till knows by model, with the settings each is set up with when chosen (Till settings ›
 * Receipt & printing). Xprinter's receipt range: every model speaks ESC/POS; the desktop models print 72 mm of an
 * 80 mm roll (576 dots, 48 characters) or 48 mm of a 58 mm roll (384 dots, 32 characters) at 203 dpi.
 *
 * `cutter` and `drawer` are what the model usually ships with: some are sold with and without an auto-cutter, so the
 * screen keeps both editable after a model is chosen. Label printers (XP-365B, XP-420B, …) are not receipt printers
 * and are not listed.
 */
import type { PosPrintSettings } from './pos';

export type PrinterInterface = 'USB' | 'LAN' | 'Serial' | 'Bluetooth' | 'Wi-Fi';

export interface ReceiptPrinterModel {
  id: string;
  brand: 'Xprinter';
  name: string;
  paper: PosPrintSettings['paper'];
  /** An auto-cutter. */
  cutter: boolean;
  /** An RJ-11 cash drawer port. */
  drawer: boolean;
  interfaces: PrinterInterface[];
  /** A portable (battery) printer: no cutter, no drawer port. */
  portable?: boolean;
}

const desk80 = (name: string, interfaces: PrinterInterface[] = ['USB']): ReceiptPrinterModel => ({ id: name.toLowerCase(), brand: 'Xprinter', name, paper: '80mm', cutter: true, drawer: true, interfaces });
const desk58 = (name: string, interfaces: PrinterInterface[] = ['USB'], cutter = false): ReceiptPrinterModel => ({ id: name.toLowerCase(), brand: 'Xprinter', name, paper: '58mm', cutter, drawer: true, interfaces });
const portable = (name: string, paper: PosPrintSettings['paper'], interfaces: PrinterInterface[] = ['USB', 'Bluetooth']): ReceiptPrinterModel => ({ id: name.toLowerCase(), brand: 'Xprinter', name, paper, cutter: false, drawer: false, interfaces, portable: true });

export const RECEIPT_PRINTER_MODELS: readonly ReceiptPrinterModel[] = [
  // 80 mm desktop, with an auto-cutter and a drawer port
  desk80('XP-80C', ['USB', 'LAN', 'Serial']),
  desk80('XP-80T', ['USB', 'LAN']),
  desk80('XP-A160H', ['USB', 'LAN']),
  desk80('XP-C230H', ['USB', 'LAN', 'Serial']),
  desk80('XP-C260H', ['USB', 'LAN', 'Serial']),
  desk80('XP-C260K', ['USB', 'LAN', 'Serial']),
  desk80('XP-C300H', ['USB', 'LAN', 'Serial']),
  desk80('XP-D200N', ['USB', 'LAN']),
  desk80('XP-D230H', ['USB', 'LAN', 'Serial']),
  desk80('XP-D300H', ['USB', 'LAN', 'Serial']),
  desk80('XP-E200L', ['USB', 'LAN']),
  desk80('XP-E260L', ['USB', 'LAN']),
  desk80('XP-E300L', ['USB', 'LAN']),
  desk80('XP-N160I', ['USB', 'LAN', 'Serial']),
  desk80('XP-N160II', ['USB', 'LAN', 'Serial']),
  desk80('XP-N200H', ['USB', 'LAN', 'Serial']),
  desk80('XP-N260H', ['USB', 'LAN', 'Serial']),
  desk80('XP-N300H', ['USB', 'LAN', 'Serial']),
  desk80('XP-Q200', ['USB', 'LAN', 'Serial']),
  desk80('XP-Q200H', ['USB', 'LAN', 'Serial']),
  desk80('XP-Q260H', ['USB', 'LAN', 'Serial']),
  desk80('XP-Q300', ['USB', 'LAN', 'Serial']),
  desk80('XP-Q800', ['USB', 'LAN', 'Serial']),
  desk80('XP-Q801K', ['USB', 'LAN', 'Serial']),
  desk80('XP-Q805K', ['USB', 'LAN', 'Serial']),
  desk80('XP-Q838L', ['USB', 'LAN', 'Serial']),
  desk80('XP-Q900', ['USB', 'LAN', 'Serial']),
  desk80('XP-S200M', ['USB', 'LAN']),
  desk80('XP-S260M', ['USB', 'LAN']),
  desk80('XP-S300M', ['USB', 'LAN']),
  desk80('XP-T80A', ['USB', 'LAN', 'Serial']),
  desk80('XP-T80Q', ['USB', 'LAN', 'Serial']),
  desk80('XP-T260H', ['USB', 'LAN', 'Serial']),
  desk80('XP-T271U', ['USB']),
  desk80('XP-T300H', ['USB', 'LAN', 'Serial']),
  desk80('XP-T890H', ['USB', 'LAN', 'Serial']),
  desk80('XP-V320N', ['USB', 'LAN', 'Wi-Fi', 'Bluetooth']),
  desk80('XP-V330N', ['USB', 'LAN', 'Wi-Fi', 'Bluetooth']),
  // 58 mm desktop: most tear off by hand; the ones with a cutter say so
  desk58('XP-58IIH', ['USB']),
  desk58('XP-58IIL', ['USB']),
  desk58('XP-58IIN', ['USB', 'LAN']),
  desk58('XP-58IIQ', ['USB']),
  desk58('XP-58IIK', ['USB']),
  desk58('XP-58IIB', ['USB', 'Bluetooth']),
  desk58('XP-58IIIL', ['USB']),
  desk58('XP-58C', ['USB'], true),
  desk58('XP-T58H', ['USB'], true),
  desk58('XP-T58K', ['USB'], true),
  // portable (battery): no cutter, no drawer port
  portable('XP-P200', '58mm'),
  portable('XP-P210', '58mm'),
  portable('XP-P300', '58mm'),
  portable('XP-P323B', '58mm'),
  portable('XP-P800', '80mm'),
  portable('XP-P810', '80mm'),
];

export function printerModel(id: string | null | undefined): ReceiptPrinterModel | null {
  return (id && RECEIPT_PRINTER_MODELS.find((m) => m.id === id)) || null;
}

/**
 * The settings a model is set up with: its roll, ESC/POS straight to it, a partial cut and four lines of feed where it
 * cuts (none, and three lines to tear off, where it does not), the drawer on pin 2 where it has a port (off where it
 * has none). What the person set that the model does not decide (the printer chosen, copies, the design) stays.
 */
export function presetFor(m: ReceiptPrinterModel, current: Pick<PosPrintSettings, 'drawer'>): Partial<PosPrintSettings> {
  return {
    printer_model: m.id,
    paper: m.paper,
    mode: 'escpos',
    cut: m.cutter ? 'partial' : 'none',
    feed: m.cutter ? 4 : 3,
    drawer: m.drawer ? current.drawer : 'off',
    drawer_pin: 2,
  };
}

/** A printer this computer has, matched to a model by its name ("XP-80C", "Xprinter XP-Q200H", "XP-58IIH (copy 1)"). */
export function modelOfPrinterName(name: string): ReceiptPrinterModel | null {
  const n = name.toUpperCase().replace(/[\s_]+/g, '-');
  let best: ReceiptPrinterModel | null = null;
  for (const m of RECEIPT_PRINTER_MODELS) {
    if (n.includes(m.name.toUpperCase()) && (!best || m.name.length > best.name.length)) best = m;
  }
  return best;
}
