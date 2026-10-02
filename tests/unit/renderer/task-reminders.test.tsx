// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../../../src/components/Select', () => ({ Select: (props: ComponentProps<'select'>) => <select {...props} /> }));
vi.mock('../../../src/core/app-state', () => ({ app: {} }));
vi.mock('../../../src/core/store', () => ({
  useStore: (_store: unknown, select: (s: unknown) => unknown) =>
    select({ prefs: { notificationsEnabled: false, backgroundServices: { notifications: true }, moduleNotifications: {} }, status: {} }),
}));
vi.mock('../../../src/core/tabs', () => ({ navigate: vi.fn() }));
import { ReminderDrafts, schedulePreview } from '../../../src/modules/tasks/Reminders';
describe('configurable reminder editor', () => {
  it('previews date-only, timed and custom reminders on the WorkSuite timezone', () => {
    expect(schedulePreview({ offset_minutes: 0, recipients: [3] }, '2027-03-14', 'America/New_York')).toBe('2027-03-14T13:00:00.000Z');
    expect(schedulePreview({ offset_minutes: 15, recipients: [3] }, '2027-03-14T16:00:00Z', 'America/New_York')).toBe('2027-03-14T15:45:00.000Z');
    expect(schedulePreview({ offset_minutes: null, custom_at: '2027-03-15T07:15', recipients: [3] }, null, 'Asia/Colombo')).toBe('2027-03-15T01:45:00.000Z');
    expect(schedulePreview({ offset_minutes: 60, recipients: [3] }, null)).toBeNull();
  });
  it('offers multiple reminders, recipients and settings with a timezone-labelled schedule', () => {
    const html = renderToStaticMarkup(
      <ReminderDrafts
        value={[
          { offset_minutes: 15, recipients: [3] },
          { offset_minutes: null, custom_at: '2027-04-01T12:00', recipients: [7] },
        ]}
        onChange={() => undefined}
        due="2027-04-01"
        zone="Asia/Colombo"
        recipients={[
          { id: 3, name: 'Me' },
          { id: 7, name: 'Assignee' },
        ]}
      />,
    );
    for (const label of [
      'At due time',
      '15 minutes before',
      '1 hour before',
      '1 day before',
      'Custom date/time',
      'Asia/Colombo',
      'Date-only tasks use 9:00 AM',
      'Desktop reminders are disabled',
      'Notification settings',
      'Remove reminder 2',
      'Assignee',
    ])
      expect(html).toContain(label);
  });
  it('keeps custom reminders available without a due date', () => {
    const html = renderToStaticMarkup(
      <ReminderDrafts value={[{ offset_minutes: null, recipients: [3] }]} onChange={() => undefined} due={null} recipients={[{ id: 3, name: 'Me' }]} />,
    );
    const root = document.createElement('div');
    root.innerHTML = html;
    expect(root.querySelector('option[value="15"]')?.hasAttribute('disabled')).toBe(true);
    expect(html).toContain('datetime-local');
  });
});
