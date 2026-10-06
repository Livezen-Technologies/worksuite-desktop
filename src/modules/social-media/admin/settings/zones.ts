/**
 * A01 / A02 · the time zones offered for a brand and the organisation default (SMM-ACC-010, ADM-003). Asia/Colombo
 * first: the default for Livezen organisations. A zone the server already holds that is not here is still shown.
 */
export const COMMON_ZONES = [
  'Asia/Colombo',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Bangkok',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Africa/Johannesburg',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'UTC',
];

export function zonesWith(current: string | null | undefined): string[] {
  return current && !COMMON_ZONES.includes(current) ? [current, ...COMMON_ZONES] : COMMON_ZONES;
}
