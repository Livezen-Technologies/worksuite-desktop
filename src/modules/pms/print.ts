import { day, money, nice, pGet, stamp, type Audit, type FolioView, type Shift } from './api';
import { device, type PrintJob } from './devices';

/**
 * The desk's printed pages — a registration card, a folio's receipt, invoice
 * or statement, a cashier shift's report, a night audit's report — laid out
 * here from what the server answered (`GET stays/{id}/registration-card`,
 * `GET folios/{id}/document`, the shift, the audit). Every figure is the
 * server's, written as it came; every value is escaped. They are printed
 * through the device agent's printer (the OS print dialog by default), in a
 * window with no script and no network.
 */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).replace(/[&<>"']/g, (c) => ESC[c]!);

const STYLE = `<style>
  * { box-sizing: border-box; }
  body { font: 12px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  h2 { font-size: 13px; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: .04em; color: #444; }
  .muted { color: #555; }
  .head { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { font-size: 10.5px; text-transform: uppercase; color: #555; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .void td { color: #888; text-decoration: line-through; }
  .total td { font-weight: 700; border-top: 2px solid #111; border-bottom: 0; }
  .grid { display: grid; grid-template-columns: max-content 1fr; gap: 3px 16px; }
  .sign { margin-top: 28px; display: flex; gap: 32px; }
  .sign > div { flex: 1; border-top: 1px solid #111; padding-top: 4px; min-height: 60px; }
  .sign img { max-height: 80px; display: block; }
</style>`;

const grid = (rows: Array<[string, unknown]>) => `<div class="grid">${rows.map(([k, v]) => `<span class="muted">${esc(k)}</span><span>${esc(v ?? '—')}</span>`).join('')}</div>`;

export interface RegistrationCard {
  property: { name: string | null; address: string | null; phone: string | null; check_in_time: string | null; check_out_time: string | null };
  guest: { name: string | null; email: string | null; phone: string | null; address: string | null; nationality: string | null };
  confirmation_no: string | null;
  room_number: string | null;
  arrival_date: string;
  departure_date: string;
  adults: number;
  children: number;
  rate_plan: string | null;
  total: string | null;
  currency: string | null;
  signed: boolean;
}

/** A registration card (PMS-CKI-004); with the guest's signature when one was captured. */
export function registrationCardHtml(c: RegistrationCard, signature?: string | null): string {
  const sig = signature && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) ? `<img alt="Signature" src="${signature}">` : '';
  return `${STYLE}
<div class="head"><div><h1>${esc(c.property.name)}</h1><div class="muted">${esc(c.property.address)}${c.property.phone ? ` · ${esc(c.property.phone)}` : ''}</div></div>
<div><b>Registration card</b><div class="muted">${esc(c.confirmation_no)}</div></div></div>
<h2>Guest</h2>${grid([['Name', c.guest.name], ['Email', c.guest.email], ['Phone', c.guest.phone], ['Address', c.guest.address], ['Nationality', c.guest.nationality]])}
<h2>Stay</h2>${grid([
    ['Room', c.room_number],
    ['Arrival', day(c.arrival_date, true)],
    ['Departure', day(c.departure_date, true)],
    ['Guests', `${c.adults} adult(s)${c.children ? `, ${c.children} child(ren)` : ''}`],
    ['Rate', c.rate_plan],
    ['Room total', c.total !== null ? money(c.total, c.currency) : '—'],
    ['Check-in / check-out', `${c.property.check_in_time ?? '—'} / ${c.property.check_out_time ?? '—'}`],
  ])}
<div class="sign"><div>${sig}<span class="muted">Guest’s signature</span></div><div><span class="muted">Date</span></div></div>`;
}

export interface FolioDocument {
  kind: 'invoice' | 'receipt' | 'statement';
  number: string | null;
  property: { name: string | null; legal_name: string | null; address: string | null; tax_registration: string | null };
  billing_present: boolean;
  folio: FolioView;
}

const DOC_TITLE: Record<FolioDocument['kind'], string> = { invoice: 'Invoice', receipt: 'Receipt', statement: 'Statement' };

/** A folio's printed invoice, receipt or statement (`GET folios/{id}/document`). */
export function folioDocumentHtml(d: FolioDocument): string {
  const f = d.folio;
  const cur = f.currency;
  const lines = f.items
    .filter((i) => i.item_type !== 'tax' || !i.is_void)
    .map(
      (i) =>
        `<tr class="${i.is_void ? 'void' : ''}"><td>${esc(day(i.business_date))}</td><td>${esc(i.description)}${i.is_void && i.void_reason ? ` <span class="muted">(void: ${esc(i.void_reason)})</span>` : ''}</td><td class="n">${esc(i.quantity)}</td><td class="n">${esc(money(i.amount))}</td><td class="n">${esc(money(i.tax_amount))}</td><td class="n">${esc(money(i.total))}</td></tr>`,
    )
    .join('');
  const pays = (f.payments ?? [])
    .map((p) => `<tr><td>${esc(day(p.business_date))}</td><td>${esc(p.kind_label)} · ${esc(p.method_label)}${p.card_last4 ? ` ·••• ${esc(p.card_last4)}` : ''}</td><td>${esc(p.status_label)}</td><td class="n">${esc(money(p.amount, p.currency))}</td></tr>`)
    .join('');
  const taxes = f.tax_summary.map((t) => `<tr><td>${esc(t.name)}</td><td class="n">${esc(money(t.amount, cur))}</td></tr>`).join('');
  return `${STYLE}
<div class="head"><div><h1>${esc(d.property.legal_name || d.property.name)}</h1><div class="muted">${esc(d.property.address)}</div>${d.property.tax_registration ? `<div class="muted">Tax registration ${esc(d.property.tax_registration)}</div>` : ''}</div>
<div><b>${esc(DOC_TITLE[d.kind])}${d.number ? ` ${esc(d.number)}` : ''}</b><div class="muted">Folio ${esc(f.folio_no)} · ${esc(f.label)}</div><div class="muted">${esc(f.payee_name)}</div></div></div>
<table><thead><tr><th>Date</th><th>Description</th><th class="n">Qty</th><th class="n">Net</th><th class="n">Tax</th><th class="n">Total</th></tr></thead><tbody>${lines || '<tr><td colspan="6" class="muted">No charges.</td></tr>'}</tbody></table>
${taxes ? `<h2>Taxes</h2><table><tbody>${taxes}</tbody></table>` : ''}
${pays ? `<h2>Payments</h2><table><tbody>${pays}</tbody></table>` : ''}
<h2>Totals</h2><table><tbody>
<tr><td>Charges</td><td class="n">${esc(money(f.totals.charges, cur))}</td></tr>
<tr><td>Taxes</td><td class="n">${esc(money(f.totals.taxes, cur))}</td></tr>
${f.totals.payments !== null ? `<tr><td>Paid</td><td class="n">${esc(money(f.totals.payments, cur))}</td></tr>` : ''}
${f.totals.refunds !== null && f.totals.refunds !== '0.00' ? `<tr><td>Refunded</td><td class="n">${esc(money(f.totals.refunds, cur))}</td></tr>` : ''}
<tr class="total"><td>Balance</td><td class="n">${esc(money(f.totals.balance, cur))}</td></tr>
</tbody></table>
${d.kind === 'statement' ? '<p class="muted">A statement of the folio as it stands; not a tax invoice.</p>' : ''}`;
}

/** A cashier shift as the server counted it (PMS-CSH-001/002). */
export function shiftReportHtml(s: Shift, propertyName: string): string {
  const cur = s.currency;
  const methods = (s.totals?.methods ?? []).map((m) => `<tr><td>${esc(m.label)}</td><td class="n">${esc(m.count)}</td><td class="n">${esc(money(m.in, cur))}</td><td class="n">${esc(money(m.out, cur))}</td></tr>`).join('');
  return `${STYLE}
<div class="head"><div><h1>${esc(propertyName)}</h1><div class="muted">Cashier shift</div></div><div><b>${esc(s.cashier)}</b><div class="muted">${esc(s.terminal)} · ${esc(day(s.business_date, true))}</div></div></div>
${grid([
    ['Status', s.status_label],
    ['Opened', stamp(s.opened_at)],
    ['Closed', s.closed_at ? stamp(s.closed_at) : '—'],
    ['Opening cash', money(s.opening_cash, cur)],
    ['Cash taken', money(s.totals?.cash_in ?? null, cur)],
    ['Cash paid out', money(s.totals?.cash_out ?? null, cur)],
    ['Expected in the drawer', money(s.expected_cash, cur)],
    ['Counted', money(s.counted_cash, cur)],
    ['Variance', money(s.variance, cur)],
    ['Variance reason', s.variance_reason],
    ['Approved by', s.approved_by],
  ])}
${methods ? `<h2>By method</h2><table><thead><tr><th>Method</th><th class="n">Count</th><th class="n">In</th><th class="n">Out</th></tr></thead><tbody>${methods}</tbody></table>` : ''}
<div class="sign"><div><span class="muted">Cashier</span></div><div><span class="muted">Checked by</span></div></div>`;
}

/** The night audit's report for its business date (the server's `report`). */
export function auditReportHtml(a: Audit, propertyName: string): string {
  const r = a.report;
  if (!r) return `${STYLE}<h1>${esc(propertyName)}</h1><p>No report yet for ${esc(day(a.business_date, true))}.</p>`;
  const cur = r.currency;
  const rows = (o: Record<string, unknown> | undefined) =>
    Object.entries(o ?? {})
      .map(([k, v]) => `<tr><td>${esc(nice(k))}</td><td class="n">${esc(typeof v === 'string' ? money(v, cur) : typeof v === 'object' && v ? Object.entries(v as Record<string, string>).map(([m, x]) => `${nice(m)} ${money(x, cur)}`).join(', ') : v)}</td></tr>`)
      .join('');
  const count = (o: Record<string, unknown> | undefined) => Object.entries(o ?? {}).map(([k, v]) => `<tr><td>${esc(nice(k))}</td><td class="n">${esc(v)}</td></tr>`).join('');
  return `${STYLE}
<div class="head"><div><h1>${esc(propertyName)}</h1><div class="muted">Night audit report</div></div><div><b>${esc(day(r.business_date, true))}</b><div class="muted">${esc(stamp(r.generated_at))}</div></div></div>
<h2>Rooms</h2><table><tbody>
<tr><td>Rooms</td><td class="n">${esc(r.rooms.total)}</td></tr><tr><td>Out of inventory</td><td class="n">${esc(r.rooms.out_of_inventory)}</td></tr>
<tr><td>Available</td><td class="n">${esc(r.rooms.available)}</td></tr><tr><td>Sold</td><td class="n">${esc(r.rooms.sold)}</td></tr>
<tr><td>Complimentary</td><td class="n">${esc(r.rooms.complimentary)}</td></tr><tr><td>Occupancy</td><td class="n">${esc(r.rooms.occupancy_pct)} %</td></tr>
<tr><td>ADR</td><td class="n">${esc(money(r.rooms.adr, cur))}</td></tr><tr><td>RevPAR</td><td class="n">${esc(money(r.rooms.revpar, cur))}</td></tr>
</tbody></table>
<h2>Revenue</h2><table><tbody>${rows(r.revenue)}</tbody></table>
${r.revenue_by_department ? `<h2>By department</h2><table><tbody>${rows(r.revenue_by_department)}</tbody></table>` : ''}
<h2>Taxes</h2><table><tbody>${rows(r.taxes)}<tr class="total"><td>Total</td><td class="n">${esc(money(r.tax_total, cur))}</td></tr></tbody></table>
<h2>Payments</h2><table><tbody>${rows(r.payments as Record<string, unknown>)}</tbody></table>
<h2>Movements</h2><table><tbody>${count(r.movements)}</tbody></table>
${(r.overrides ?? []).length ? `<h2>Overrides</h2><table><tbody>${(r.overrides ?? []).map((o) => `<tr><td>${esc(o.text)}</td><td>${esc(o.reason)}</td><td>${esc(o.by)}</td></tr>`).join('')}</tbody></table>` : ''}`;
}

/** Print through the desk's printer (the device agent); true when the dialog was confirmed. */
export async function printPage(job: PrintJob): Promise<boolean> {
  return device('printer').print(job);
}

/** Registration cards for these stays, one page each, in one print (PMS-FD-005, PMS-CKI-004). */
export async function printCards(stayIds: number[]): Promise<boolean> {
  const cards = await Promise.all(stayIds.map((id) => pGet<{ card: RegistrationCard }>(`/stays/${id}/registration-card`).then((r) => r.card)));
  const html = cards.map((c, i) => `<div style="${i < cards.length - 1 ? 'page-break-after: always;' : ''}">${registrationCardHtml(c)}</div>`).join('');
  return printPage({ title: cards.length === 1 ? `Registration card ${cards[0]!.confirmation_no ?? ''}` : 'Registration cards', html, kind: 'registration_card' });
}
