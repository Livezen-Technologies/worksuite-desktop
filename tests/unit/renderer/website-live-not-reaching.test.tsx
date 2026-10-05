// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnSiteNow } from '../../../src/modules/chat/website/live/OnSiteNow';
import type { OnlineVisitor } from '../../../src/modules/chat/website/live/liveMap';

/**
 * The Live dashboard's row for a visitor whose message reached no staff device for a minute (WS-WCHAT DLV-09, AC-D09):
 * "Not reaching staff" on that row, and on no other.
 */
const stamp = (agoS: number) => new Date(Date.now() - agoS * 1000).toISOString().slice(0, 19).replace('T', ' ');
const visitor = (id: number, name: string, notReaching: string | null): OnlineVisitor => ({
  id, label: `Visitor ${id}`, name, email: null, widget_id: 1, website_name: 'worksuite.lk', browser: 'Chrome', os: 'Windows', device: 'desktop',
  country: 'Sri Lanka', city: 'Colombo', lat: 6.9, lng: 79.9, current_url: 'https://worksuite.lk/shop', current_title: null, referrer: null, utm_campaign: null,
  pages: 2, visits: 1, on_site_seconds: 240, idle_seconds: 5, conversation_id: 100 + id, conversation_status: 'open',
  chat: { awaiting: true, waiting_since: stamp(90), at_risk: false, agent: 'Samali', not_reaching_staff: notReaching },
} as OnlineVisitor);

afterEach(cleanup);

describe('Not reaching staff on the Live dashboard (DLV-09)', () => {
  it('is said on the row of the visitor it is about', () => {
    render(<OnSiteNow now={Date.now()} onJoin={vi.fn()} onOpen={vi.fn()} onStart={vi.fn()} visitors={[visitor(1, 'Nimali Perera', stamp(20)), visitor(2, 'Kasun Silva', null)]} />);
    expect(screen.getAllByText('Not reaching staff')).toHaveLength(1);
    expect(screen.getByRole('listitem', { name: 'Nimali Perera' }).textContent).toContain('Not reaching staff');
    expect(screen.getByRole('listitem', { name: 'Kasun Silva' }).textContent).not.toContain('Not reaching staff');
  });
});
