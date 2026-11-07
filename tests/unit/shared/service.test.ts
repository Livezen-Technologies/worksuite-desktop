import { describe, expect, it } from 'vitest';
import { APP_CATALOGUE, visibleApps } from '../../../shared/apps';
import { parseDeepLink } from '../../../shared/deeplink';
import { BOARD_COLUMNS, INTAKE_CHECKLIST, isImei, money, needsReason, nextStatuses, SERVICE_STATUSES, statusLabel } from '../../../shared/service';

describe('Service & Repair', () => {
  it('is a native app for whoever the server gives `service`', () => {
    expect(APP_CATALOGUE.find((a) => a.id === 'service')).toMatchObject({ app: 'service', surface: 'native', webPath: '/service' });
    expect(visibleApps({ apps: ['service'], permissions: [] }).map((a) => a.id)).toContain('service');
    expect(visibleApps({ apps: ['amc'], permissions: [] }).map((a) => a.id)).not.toContain('service');
  });

  it('opens its deep links', () => {
    expect(parseDeepLink('worksuite://service/jobs/abc-1')).toMatchObject({ ok: true, link: { module: 'service', route: '/service?view=jobs&job=abc-1' } });
    expect(parseDeepLink('worksuite://service/board')).toMatchObject({ ok: true, link: { route: '/service?view=board' } });
  });

  it('follows the default workflow', () => {
    expect(nextStatuses('new')).toEqual(['received', 'cancelled']);
    expect(nextStatuses('qa_testing')).toEqual(['ready_for_pickup', 'cancelled']);
    expect(nextStatuses('awaiting_approval')).not.toContain('approved');
    expect(nextStatuses('delivered')).toEqual(['closed']);
    expect(nextStatuses('ready_for_pickup')).toEqual(['cancelled']);
    expect(nextStatuses('closed')).toEqual([]);
    expect(nextStatuses('custom_org_status')).toEqual([]);
    for (const s of SERVICE_STATUSES) for (const t of nextStatuses(s)) expect(SERVICE_STATUSES).toContain(t);
    expect(needsReason('cancelled')).toBe(true);
    expect(needsReason('approved')).toBe(false);
    expect(BOARD_COLUMNS).not.toContain('closed');
  });

  it('labels, money, IMEI and checklists', () => {
    expect(statusLabel('waiting_parts')).toBe('Waiting for Parts');
    expect(statusLabel('sent_to_vendor')).toBe('Sent to vendor');
    expect(money(1500)).toBe('LKR 1,500.00');
    expect(money(null)).toBe('—');
    expect(isImei('490154203237518')).toBe(true);
    expect(isImei('490154203237519')).toBe(false);
    expect(isImei('12345')).toBe(false);
    expect(INTAKE_CHECKLIST.mobile).toContain('IMEI recorded');
  });
});
