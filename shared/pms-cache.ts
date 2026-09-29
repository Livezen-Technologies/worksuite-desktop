/**
 * What of Hotel PMS a front desk reads with WorkSuite out of reach
 * (PMS-DSK-003): the property list and its options, the room rack, and the
 * arrivals, departures and in-house lists — each property's own address, so
 * a prefix would not do. Nothing else of the PMS is kept: a folio, a payment
 * or a night audit read from an old copy looks exactly like a current one,
 * and every write waits for the server anyway.
 */
const PMS_CACHED: readonly RegExp[] = [
  /^\/api\/pms\/v1\/options$/,
  /^\/api\/pms\/v1\/properties$/,
  /^\/api\/pms\/v1\/properties\/\d{1,10}\/(rack|arrivals|departures|in-house|business-date)$/,
  /^\/api\/pms\/v1\/properties\/\d{1,10}\/front-desk\/lists$/,
];

/** Whether a GET path (query left out) is one the PMS keeps for offline reading. */
export function pmsCached(path: string): boolean {
  const clean = path.split('?')[0] ?? '';
  return PMS_CACHED.some((re) => re.test(clean));
}
