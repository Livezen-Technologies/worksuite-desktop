// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_CATALOGUE } from '@shared/apps';
import { SUPPORT_NOTICE_DEFAULTS } from '@shared/support';
import type { Preferences } from '@shared/types';
import { SupportNotifications, inApp } from '../../../src/modules/notifications/SupportPrefs';

/**
 * Notification settings › Support (WS-SUPPORT-SRS-001 D-03, FR-NTF-03/06): per kind, the bell (the server's choice
 * for its events) and this computer's banner and sound; SLA banners that stay; low priority in an hourly digest.
 * And the Support app's badge on the rail (FR-DSK-04).
 */
afterEach(cleanup);

const prefs = (over: Partial<Preferences> = {}) => ({ notificationsEnabled: true, ...over }) as Preferences;

describe('the Support card', () => {
  it('sets the bell per event on the server, and the banner and sound here', () => {
    const commit = vi.fn();
    const local = vi.fn();
    render(<SupportNotifications categories={{ 'event:support.customer_replied': { in_app: false } }} commit={commit} prefs={prefs()} local={local} />);
    expect((screen.getByRole('checkbox', { name: 'Assigned to me: In app' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'A requester replied: In app' }) as HTMLInputElement).checked).toBe(false);
    // A mention is the ticket's own update, made into a banner here: no bell choice.
    expect(screen.queryByRole('checkbox', { name: 'Mentioned in a note: In app' })).toBeNull();
    expect((screen.getByRole('checkbox', { name: 'Mentioned in a note: Sound' }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: 'SLA warning or breach: In app' }));
    expect(commit).toHaveBeenCalledWith({ categories: { 'event:support.customer_replied': { in_app: false }, 'event:support.sla_warning': { in_app: false }, 'event:support.sla_breach': { in_app: false } } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Assigned to me: Banner here' }));
    expect(local).toHaveBeenCalledWith({ supportNotices: { ...SUPPORT_NOTICE_DEFAULTS, assigned: { banner: false, sound: true } } });
    fireEvent.click(screen.getByRole('switch', { name: 'SLA banners stay until acted on' }));
    expect(local).toHaveBeenLastCalledWith({ supportNotices: { ...SUPPORT_NOTICE_DEFAULTS, slaPersistent: false } });
    // The quick-reply shortcut from any app (D-05): on unless turned off.
    fireEvent.click(screen.getByRole('switch', { name: 'Quick reply shortcut' }));
    expect(local).toHaveBeenLastCalledWith({ supportNotices: { ...SUPPORT_NOTICE_DEFAULTS, quickShortcut: false } });
    // The urgent ticket pop-up (D-07): on unless turned off.
    fireEvent.click(screen.getByRole('switch', { name: 'Urgent tickets ring' }));
    expect(local).toHaveBeenLastCalledWith({ supportNotices: { ...SUPPORT_NOTICE_DEFAULTS, urgentPopup: false } });
  });

  it('greys out banners and sounds while this computer shows none', () => {
    render(<SupportNotifications categories={{}} commit={vi.fn()} prefs={prefs({ notificationsEnabled: false })} local={vi.fn()} />);
    expect((screen.getByRole('checkbox', { name: 'Assigned to me: Banner here' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Assigned to me: Sound' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('reads the bell choice the server keeps, on unless turned off', () => {
    expect(inApp({}, 'assigned')).toBe(true);
    expect(inApp({ 'event:support.sla_warning': { in_app: 0 } }, 'sla')).toBe(false);
    expect(inApp({}, 'mention')).toBeNull();
  });
});

describe('the rail', () => {
  it('counts Support’s tickets on its icon', () => {
    expect(APP_CATALOGUE.find((a) => a.id === 'support')?.badge).toBe('support');
  });
});
