/**
 * The reference deployment's outbound routes for Sri Lanka (WS-VOIP-SRS-001 §14.11, VOIP-DEP-05): first match wins,
 * emergency first and never blocked; mobiles on the GSM gateway (on-net by operator prefix) with the landline as
 * failover; landlines on the FXO line with GSM as overflow; short service numbers on the landline; international
 * never through the GSM gateway (SIM-box bypass is unlawful — §14.13).
 *
 * Patterns are Asterisk's (`_` + X/Z/N/[…]/`.`). One route row per pattern, since a route row holds one pattern.
 */
export interface RouteSeed {
  name: string;
  pattern: string;
  kind: 'emergency' | 'mobile' | 'local' | 'other' | 'international';
  primary: 'landline' | 'gsm' | 'carrier' | 'none';
  failover: 'landline' | 'gsm' | null;
  priority: number;
  note: string;
}

export const LK_ROUTES: readonly RouteSeed[] = [
  { name: 'EMERGENCY 119', pattern: '119', kind: 'emergency', primary: 'landline', failover: 'gsm', priority: 1, note: 'Police — landline first: it carries the office location' },
  { name: 'EMERGENCY 110', pattern: '110', kind: 'emergency', primary: 'landline', failover: 'gsm', priority: 2, note: 'Fire and ambulance' },
  { name: 'EMERGENCY 1990', pattern: '1990', kind: 'emergency', primary: 'landline', failover: 'gsm', priority: 3, note: 'Suwa Seriya ambulance' },
  { name: 'EMERGENCY 1919', pattern: '1919', kind: 'emergency', primary: 'landline', failover: 'gsm', priority: 4, note: 'Government information' },
  { name: 'LK-MOBILE', pattern: '_07XXXXXXXX', kind: 'mobile', primary: 'gsm', failover: 'landline', priority: 10, note: 'The gateway picks the SIM by operator prefix (on-net)' },
  { name: 'LK-LANDLINE', pattern: '_0[1-689]XXXXXXXX', kind: 'local', primary: 'landline', failover: 'gsm', priority: 20, note: 'The FXO line carries one call; overflow to GSM' },
  { name: 'LK-SHORT', pattern: '_1XXX', kind: 'other', primary: 'landline', failover: null, priority: 30, note: 'Service numbers such as 1212 — review the list' },
  { name: 'LK-SHORT-3', pattern: '_1XX', kind: 'other', primary: 'landline', failover: null, priority: 31, note: 'Three-digit service numbers' },
  { name: 'INTERNATIONAL', pattern: '_00.', kind: 'international', primary: 'carrier', failover: null, priority: 40, note: 'Through a SIP carrier with a spend cap, or blocked — never the GSM gateway' },
];

/** Which SIM port a mobile number goes to (§14.10's operator prefix map); null when no prefix matches. */
export const LK_OPERATORS: ReadonlyArray<{ port: number; operator: string; prefixes: string[] }> = [
  { port: 1, operator: 'Dialog', prefixes: ['077', '076', '074'] },
  { port: 2, operator: 'Mobitel', prefixes: ['071', '070'] },
  { port: 3, operator: 'Hutch', prefixes: ['078', '072'] },
  { port: 4, operator: 'Airtel', prefixes: ['075'] },
];

/** A dialled Sri Lankan mobile in national form (`0771234567`), from `+9477…`, `009477…` or `77…`. */
export function nationalMobile(raw: string): string | null {
  let d = raw.replace(/[^0-9+]/g, '');
  if (d.startsWith('+94')) d = `0${d.slice(3)}`;
  else if (d.startsWith('0094')) d = `0${d.slice(4)}`;
  else if (/^7\d{8}$/.test(d)) d = `0${d}`;
  return /^07\d{8}$/.test(d) ? d : null;
}

export function operatorOf(raw: string): { port: number; operator: string } | null {
  const n = nationalMobile(raw);
  if (!n) return null;
  const hit = LK_OPERATORS.find((o) => o.prefixes.includes(n.slice(0, 3)));
  return hit ? { port: hit.port, operator: hit.operator } : null;
}
