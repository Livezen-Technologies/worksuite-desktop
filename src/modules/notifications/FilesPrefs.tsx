import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Card } from '../account/parts';

/** One kind of notification's own choices, as the server keeps them beside the categories (`event:<key>`). */
export type EventChoices = Record<string, unknown>;
type Categories = Record<string, EventChoices>;

/** A row: what it is about, the events it sets, and each channel's default when nothing was chosen. */
interface Row {
  label: string;
  hint: string;
  events: string[];
  chat?: boolean;
  inApp: boolean;
  email: boolean;
  /** Email can be once a day instead of straight away. */
  daily?: boolean;
}

/**
 * Notification settings › Files (worksuite-desktop#164): per channel, for
 * files shared with me, changes to or removal of my access, and comments and
 * mentions on files. Saved through the same preferences as the grid above
 * (`categories["event:files.shared"]` …), which narrow what each kind of
 * notification may use; the server's defaults are what an unset box shows.
 */
export const FILE_ROWS: Row[] = [
  { label: 'Shared with me', hint: 'A card in your chat with them, the bell, and email', events: ['files.shared'], chat: true, inApp: true, email: true, daily: true },
  { label: 'Access changed or removed', hint: 'Your access to something shared with you changed', events: ['files.access_changed', 'files.access_revoked'], inApp: true, email: false },
  { label: 'Comments and mentions on a file', hint: 'Mentions, replies to your comments, comments on files you follow', events: ['files.mentioned', 'files.comment_replied', 'files.commented'], chat: false, inApp: true, email: true },
];

const key = (event: string) => `event:${event}`;

/** What one row shows for a channel: the first event's choice, else the row's default. */
export function choice(cats: Categories, row: Row, channel: 'chat' | 'in_app' | 'email'): boolean {
  const v = cats[key(row.events[0]!)]?.[channel];
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1') return true;
  if (v === 0 || v === '0') return false;
  return channel === 'chat' ? !!row.chat : channel === 'in_app' ? row.inApp : row.email;
}

/** The categories with one row's events set the same way. */
export function withChoice(cats: Categories, row: Row, patch: EventChoices): Categories {
  const next = { ...cats };
  for (const e of row.events) next[key(e)] = { ...(next[key(e)] ?? {}), ...patch };
  return next;
}

export function FilesNotifications({ categories, commit }: { categories: Categories; commit: (patch: { categories: Categories }) => void }) {
  const set = (row: Row, patch: EventChoices) => commit({ categories: withChoice(categories, row, patch) });
  return (
    <Card title={<span className="flex items-center gap-2"><Icon name="folder" size={16} className="text-ink-3" /> Files</span>} action={<span className="text-[12px] text-ink-3">Within what the grid above allows</span>}>
      <table data-files-notifications className="w-full table-fixed border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-[11.5px] font-bold tracking-[.3px] text-ink-3 uppercase">
            <th className="py-2 pr-3">When</th>
            <th className="w-[96px] px-1.5 py-2 text-center">Chat</th>
            <th className="w-[96px] px-1.5 py-2 text-center">In app</th>
            <th className="w-[168px] px-1.5 py-2 text-center">Email</th>
          </tr>
        </thead>
        <tbody>
          {FILE_ROWS.map((row) => {
            const email = choice(categories, row, 'email');
            const mode = categories[key(row.events[0]!)]?.email_mode === 'daily' ? 'daily' : 'instant';
            return (
              <tr key={row.label} className="border-b border-line/70 last:border-b-0">
                <td className="py-2.5 pr-3">
                  <b className="block truncate text-ink">{row.label}</b>
                  <span className="block truncate text-[11.5px] text-ink-3">{row.hint}</span>
                </td>
                <td className="px-2 py-2.5 text-center">
                  {row.chat !== undefined ? <Checkbox aria-label={`${row.label}: Chat`} checked={choice(categories, row, 'chat')} onChange={(e) => set(row, { chat: e.target.checked })} /> : <span className="text-ink-3">—</span>}
                </td>
                <td className="px-2 py-2.5 text-center">
                  <Checkbox aria-label={`${row.label}: In app`} checked={choice(categories, row, 'in_app')} onChange={(e) => set(row, { in_app: e.target.checked })} />
                </td>
                <td className="px-2 py-2.5 text-center">
                  {row.daily ? (
                    <Select
                      label={`${row.label}: Email`}
                      value={email ? mode : 'off'}
                      options={[
                        { value: 'instant', label: 'Straight away' },
                        { value: 'daily', label: 'Daily summary' },
                        { value: 'off', label: 'Off' },
                      ]}
                      onValueChange={(v) => set(row, v === 'off' ? { email: false } : { email: true, email_mode: v })}
                    />
                  ) : (
                    <Checkbox aria-label={`${row.label}: Email`} checked={email} onChange={(e) => set(row, { email: e.target.checked })} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="m-0 pt-2 text-[11.5px] text-ink-3">You are never told about what you share yourself. Quiet hours hold email; shares a few minutes apart come in one email.</p>
    </Card>
  );
}
