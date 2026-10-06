import { SUPPORT_NOTICE_EVENTS, supportNoticePrefs, type SupportNoticeKind, type SupportNoticePrefs } from '@shared/support';
import type { Preferences } from '@shared/types';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Switch } from '../../components/ui';
import { Card, SettingRow } from '../account/parts';
import type { EventChoices } from './FilesPrefs';

type Categories = Record<string, EventChoices>;

/** The rows: what each kind of support banner is about, and how it shows (WS-SUPPORT-SRS-001 D-03). */
export const SUPPORT_ROWS: Array<{ kind: SupportNoticeKind; label: string; hint: string }> = [
  { kind: 'assigned', label: 'Assigned to me', hint: 'Open, or Take later: it comes back in an hour if still unread' },
  { kind: 'reply', label: 'A requester replied', hint: 'On a ticket of mine; reply from the banner on macOS and Windows' },
  { kind: 'mention', label: 'Mentioned in a note', hint: 'Answer from the banner with a note' },
  { kind: 'sla', label: 'SLA warning or breach', hint: 'Open, or Snooze 10 min' },
];

const key = (event: string) => `event:${event}`;

/** Whether the bell gets a kind's notifications: the server's choice for its events (on unless turned off). */
export function inApp(cats: Categories, kind: SupportNoticeKind): boolean | null {
  const events = SUPPORT_NOTICE_EVENTS[kind];
  if (!events.length) return null;
  const v = cats[key(events[0]!)]?.in_app;
  return !(v === false || v === 0 || v === '0');
}

/**
 * Notification settings › Support (D-03, FR-NTF-03/06): per kind of support notification, whether it reaches the
 * bell (the server's choice, for every device: off, there is no banner either) and, on this computer, a banner and
 * its sound. An SLA's banner can stay until it is acted on; a low-priority ticket's banners can wait for one at the
 * top of the hour. Quiet hours above silence these too, except an urgent ticket's.
 */
export function SupportNotifications({ categories, commit, prefs, local }: { categories: Categories; commit: (patch: { categories: Categories }) => void; prefs: Preferences; local: (patch: Partial<Preferences>) => void }) {
  const p = supportNoticePrefs(prefs.supportNotices);
  const set = (patch: Partial<SupportNoticePrefs>) => local({ supportNotices: { ...p, ...patch } });
  const setInApp = (kind: SupportNoticeKind, v: boolean) => {
    const next = { ...categories };
    for (const e of SUPPORT_NOTICE_EVENTS[kind]) next[key(e)] = { ...(next[key(e)] ?? {}), in_app: v };
    commit({ categories: next });
  };
  const banners = prefs.notificationsEnabled;
  return (
    <Card title={<span className="flex items-center gap-2"><Icon name="life-buoy" size={16} className="text-ink-3" /> Support</span>} action={<span className="text-[12px] text-ink-3">Within what the grid above allows</span>}>
      <table data-support-notifications className="w-full table-fixed border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-[11.5px] font-bold tracking-[.3px] text-ink-3 uppercase">
            <th className="py-2 pr-3">When</th>
            <th className="w-[96px] px-1.5 py-2 text-center">In app</th>
            <th className="w-[112px] px-1.5 py-2 text-center">Banner here</th>
            <th className="w-[96px] px-1.5 py-2 text-center">Sound</th>
          </tr>
        </thead>
        <tbody>
          {SUPPORT_ROWS.map((row) => {
            const bell = inApp(categories, row.kind);
            const choice = p[row.kind];
            return (
              <tr key={row.kind} className="border-b border-line/70 last:border-b-0">
                <td className="py-2.5 pr-3">
                  <b className="block truncate text-ink">{row.label}</b>
                  <span className="block truncate text-[11.5px] text-ink-3">{row.hint}</span>
                </td>
                <td className="px-2 py-2.5 text-center">
                  {bell === null ? <span className="text-ink-3" title="Made on this computer from the ticket's update">—</span> : <Checkbox aria-label={`${row.label}: In app`} checked={bell} onChange={(e) => setInApp(row.kind, e.target.checked)} />}
                </td>
                <td className="px-2 py-2.5 text-center">
                  <Checkbox aria-label={`${row.label}: Banner here`} checked={banners && choice.banner} disabled={!banners} onChange={(e) => set({ [row.kind]: { ...choice, banner: e.target.checked } })} />
                </td>
                <td className="px-2 py-2.5 text-center">
                  <Checkbox aria-label={`${row.label}: Sound`} checked={banners && choice.banner && choice.sound} disabled={!banners || !choice.banner} onChange={(e) => set({ [row.kind]: { ...choice, sound: e.target.checked } })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <SettingRow label="SLA banners stay until acted on" hint="A warning or a breach stays on screen until you open it or snooze it.">
        <Switch label="SLA banners stay until acted on" checked={p.slaPersistent} onChange={(v) => set({ slaPersistent: v })} />
      </SettingRow>
      <SettingRow label="Low-priority tickets" hint="Their banners one by one, or one at the top of each hour. SLA banners always come at once.">
        <Select
          label="Low-priority tickets"
          value={p.lowPriority}
          options={[
            { value: 'digest', label: 'Hourly digest' },
            { value: 'banner', label: 'A banner each' },
          ]}
          onValueChange={(v) => set({ lowPriority: v as SupportNoticePrefs['lowPriority'] })}
        />
      </SettingRow>
      <SettingRow label="Urgent tickets ring" hint="A new urgent ticket nobody has taken pops up in the middle of the screen, with Take it, Assign and Dismiss.">
        <Switch label="Urgent tickets ring" checked={p.urgentPopup} onChange={(v) => set({ urgentPopup: v })} />
      </SettingRow>
      <SettingRow label="Quick reply shortcut" hint="Ctrl+Alt+R (⌃⌥R on a Mac) from any app opens a quick reply on your latest ticket.">
        <Switch label="Quick reply shortcut" checked={p.quickShortcut} onChange={(v) => set({ quickShortcut: v })} />
      </SettingRow>
    </Card>
  );
}
