import { describe, expect, it } from 'vitest';
import { APP_CATALOGUE, visibleApps } from '../../../shared/apps';

describe('Service & Repair in the catalogue', () => {
  it('shows to whoever the server gives the service app, on the web for now', () => {
    const def = APP_CATALOGUE.find((a) => a.id === 'service-repair');
    expect(def).toMatchObject({ app: 'service', webPath: '/service', surface: 'browser' });
    expect(visibleApps({ apps: ['service'], permissions: [] }).map((a) => a.id)).toContain('service-repair');
    expect(visibleApps({ apps: ['amc'], permissions: [] }).map((a) => a.id)).not.toContain('service-repair');
  });
});
