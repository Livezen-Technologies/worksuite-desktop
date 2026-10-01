import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { currentZone } from '../../core/time';
import { toast } from '../../core/toasts';
import { Avatar, Button, Modal, cx } from '../../components/ui';
import { TYPES } from './api';
import { Select } from '../../components/Select';
import { Checkbox } from '../../components/Checkbox';
import { DEFAULT_ROOM_SETTINGS, type RoomSettings } from '../meet/api';
import { RoomSettingsFields } from '../meet/RoomRoles';

/** A person's part in the meeting, as the record keeps it: co-hosts run the Meet room with the organiser (#82). */
const PART: Array<['required' | 'host' | 'presenter', string]> = [
  ['required', 'Attendee'],
  ['host', 'Co-host'],
  ['presenter', 'Presenter'],
];

const WHERE: Array<[string, string]> = [
  ['online', 'Online'],
  ['hybrid', 'Hybrid'],
  ['room', 'Meeting room'],
  ['customer', 'Customer site'],
  ['external', 'Somewhere else'],
];

const PROVIDERS: Array<[string, string, boolean]> = [
  ['builtin', 'Built-in Meet', false],
  ['jitsi', 'Jitsi Meet (link made for you)', false],
  ['google', 'Google Meet (paste the link)', true],
  ['teams', 'Microsoft Teams (paste the link)', true],
  ['zoom', 'Zoom (paste the link)', true],
];

/**
 * A date-time input's value `mins` from now, on the next quarter hour — as
 * digits on the person's WorkSuite clock, which is the zone sent with them.
 */
export function nextSlot(mins: number, now = Date.now()): string {
  const t = Math.ceil((now + mins * 60_000) / 900_000) * 900_000;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: currentZone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
  const g = (k: string) => parts.find((p) => p.type === k)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

/**
 * Schedule a meeting (MeetingSchedule). The times are typed on this
 * computer's clock and sent with its zone; the server stores the instants.
 */
export function ScheduleDialog({ onClose, online, onCreated }: { onClose: () => void; online?: boolean; onCreated?: (id: number) => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [type, setType] = useState('internal');
  const [priority, setPriority] = useState('normal');
  const [start, setStart] = useState(() => nextSlot(30));
  const [end, setEnd] = useState(() => nextSlot(90));
  const [repeat, setRepeat] = useState('none');
  const [where, setWhere] = useState(online ? 'online' : 'room');
  const [provider, setProvider] = useState('builtin');
  const [link, setLink] = useState('');
  const [roomId, setRoomId] = useState<number | ''>('');
  const [address, setAddress] = useState('');
  const [people, setPeople] = useState<Array<{ id: number; name: string; role: 'required' | 'host' | 'presenter' }>>([]);
  const [roomSettings, setRoomSettings] = useState<RoomSettings>(DEFAULT_ROOM_SETTINGS);
  const [passcode, setPasscode] = useState('');
  const [roomOpen, setRoomOpen] = useState(false);
  const [q, setQ] = useState('');
  const [guests, setGuests] = useState('');
  const [agenda, setAgenda] = useState('');
  const [invite, setInvite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOnline = where === 'online' || where === 'hybrid';
  const needsRoom = where === 'room' || where === 'hybrid';
  const paste = PROVIDERS.find(([k]) => k === provider)?.[2] ?? false;
  const builtin = isOnline && provider === 'builtin';
  const directory = useQuery({ queryKey: ['chat', 'directory'], queryFn: ({ signal }) => apiGet<{ users: Array<{ id: number; name: string; email?: string }> }>('/api/chat/directory', undefined, signal), staleTime: 5 * 60_000 });
  const rooms = useQuery({
    queryKey: ['meetings', 'rooms-available', start, end],
    queryFn: ({ signal }) => apiGet<{ rooms: Array<{ id: number; name: string; capacity: number | null; building: string | null; floor: string | null }> }>('/api/meetings/rooms-available', { start_at: start, end_at: end, timezone: currentZone() }, signal),
    enabled: needsRoom && !!start && !!end && end > start,
    retry: false,
  });
  const needle = q.trim().toLowerCase();
  const matches = needle ? (directory.data?.users ?? []).filter((u) => !people.some((p) => p.id === u.id) && (u.name.toLowerCase().includes(needle) || (u.email ?? '').toLowerCase().includes(needle))).slice(0, 6) : [];
  const emails = guests.split(/[\s,;]+/).map((e) => e.trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ id: number }>('/api/meetings', {
        title: title.trim(),
        type,
        priority,
        start_at: start,
        end_at: end,
        timezone: currentZone(),
        recur_freq: repeat,
        recur_interval: 1,
        location_type: where,
        online_provider: isOnline ? provider : undefined,
        online_url: isOnline && paste ? link.trim() : undefined,
        room_id: needsRoom && roomId ? roomId : undefined,
        address: where === 'customer' || where === 'external' ? address.trim() || undefined : undefined,
        participants: [...people.map((p) => ({ user_id: p.id, role: p.role })), ...emails.map((e) => ({ email: e, role: 'required' }))],
        room_settings: builtin ? { ...roomSettings, ...(passcode ? { passcode } : {}) } : undefined,
        agenda: agenda.split('\n').map((l) => l.trim()).filter(Boolean).map((t) => ({ title: t.slice(0, 190) })),
        skip_invitations: !invite,
      });
      toast('success', invite ? 'Meeting scheduled and everyone invited.' : 'Meeting scheduled.');
      void qc.invalidateQueries({ queryKey: ['meetings'] });
      void qc.invalidateQueries({ queryKey: ['meet'] });
      onClose();
      onCreated?.(r.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const field = 'h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-normal text-ink outline-none focus:border-primary';
  const label = 'flex flex-col gap-1 text-[12.5px] font-semibold text-ink';
  return (
    <Modal
      title="Schedule a meeting"
      onClose={onClose}
      width={760}
      footer={
        <>
          <label className="mr-auto flex items-center gap-2 text-[12.5px] text-ink">
            <Checkbox checked={invite} onChange={(e) => setInvite(e.target.checked)} />
            Add to Calendar and send invitations
          </label>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!title.trim() || !start || !end || end <= start || (isOnline && paste && !link.trim())} onClick={() => void save()}>
            {invite ? 'Schedule & invite' : 'Schedule'}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[62vh] flex-col gap-3 overflow-y-auto pr-1 scroll-thin">
        <label className={label}>
          Title
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={190} className={field} />
        </label>
        <div className="grid grid-cols-4 gap-2.5">
          <label className={label}>
            Type
            <Select value={type} onChange={(e) => setType(e.target.value)} className={field}>
              {TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </label>
          <label className={label}>
            Priority
            <Select value={priority} onChange={(e) => setPriority(e.target.value)} className={field}>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
              <option value="low">Low</option>
            </Select>
          </label>
          <label className={label}>
            Starts
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={field} />
          </label>
          <label className={label}>
            Ends
            <input type="datetime-local" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className={field} />
          </label>
        </div>
        <label className={label}>
          Repeats
          <Select value={repeat} onChange={(e) => setRepeat(e.target.value)} className={field}>
            <option value="none">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </Select>
        </label>
        <div className="flex flex-col gap-1.5">
          <b className="text-[12.5px] text-ink">Where</b>
          <div role="radiogroup" aria-label="Where" className="flex flex-wrap gap-1.5">
            {WHERE.map(([k, v]) => (
              <button key={k} type="button" role="radio" aria-checked={where === k} onClick={() => setWhere(k)} className={cx('h-8 rounded-2xl px-3 text-[12.5px] font-semibold', where === k ? 'bg-primary text-white' : 'border border-line bg-surface text-ink')}>
                {v}
              </button>
            ))}
          </div>
        </div>
        {isOnline ? (
          <div className="grid grid-cols-2 gap-2.5">
            <label className={label}>
              Provider
              <Select value={provider} onChange={(e) => setProvider(e.target.value)} className={field}>
                {PROVIDERS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </label>
            {paste ? (
              <label className={label}>
                Meeting link
                <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" className={field} />
              </label>
            ) : null}
          </div>
        ) : null}
        {needsRoom ? (
          <label className={label}>
            Meeting room
            <Select value={roomId} onChange={(e) => setRoomId(e.target.value ? Number(e.target.value) : '')} className={field}>
              <option value="">{rooms.isLoading ? 'Finding free rooms…' : rooms.data?.rooms.length ? 'Choose a free room' : 'No room is free then'}</option>
              {(rooms.data?.rooms ?? []).map((r) => <option key={r.id} value={r.id}>{[r.name, r.floor ? `Floor ${r.floor}` : null, r.capacity ? `${r.capacity} seats` : null, 'free'].filter(Boolean).join(' · ')}</option>)}
            </Select>
          </label>
        ) : null}
        {where === 'customer' || where === 'external' ? (
          <label className={label}>
            Address
            <input value={address} onChange={(e) => setAddress(e.target.value)} className={field} />
          </label>
        ) : null}
        <div className="relative flex flex-col gap-1.5">
          <b className="text-[12.5px] text-ink">People</b>
          <div className="flex flex-wrap items-center gap-1.5 rounded-[8px] border border-line bg-surface p-1.5">
            {people.map((p) => (
              <span key={p.id} className="flex items-center gap-1 rounded-full bg-selection py-0.5 pr-2 pl-1 text-[12px] font-semibold text-primary">
                <Avatar name={p.name} size={18} />
                {p.name}
                {builtin ? (
                  <button
                    type="button"
                    title="Change their part: attendee, co-host or presenter"
                    aria-label={`${p.name}: ${PART.find(([k]) => k === p.role)![1]}. Change`}
                    onClick={() => setPeople(people.map((x) => (x.id === p.id ? { ...x, role: PART[(PART.findIndex(([k]) => k === x.role) + 1) % PART.length]![0] } : x)))}
                    className="rounded-full bg-surface px-1.5 text-[10.5px] font-bold text-ink-2 hover:text-ink"
                  >
                    {PART.find(([k]) => k === p.role)![1]}
                  </button>
                ) : null}
                <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setPeople(people.filter((x) => x.id !== p.id))} className="ml-0.5 text-ink-3 hover:text-ink">×</button>
              </span>
            ))}
            <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Add people" placeholder="Search people…" className="bare-focus h-7 min-w-[160px] flex-1 bg-transparent px-1 text-[13px] text-ink outline-none" />
          </div>
          {matches.length ? (
            <div className="absolute top-full right-0 left-0 z-10 mt-1 rounded-[10px] border border-line bg-surface py-1 shadow-xl">
              {matches.map((u) => (
                <button key={u.id} type="button" onClick={() => (setPeople([...people, { id: u.id, name: u.name, role: 'required' }]), setQ(''))} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink hover:bg-subtle">
                  <Avatar name={u.name} size={22} /> {u.name}
                  {u.email ? <span className="text-[11.5px] text-ink-3">{u.email}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {builtin ? (
          <div className="rounded-[10px] border border-line">
            <button type="button" aria-expanded={roomOpen} onClick={() => setRoomOpen(!roomOpen)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] font-semibold text-ink">
              <span className="flex-1">Meet room settings</span>
              <span className="font-normal text-ink-3">{roomOpen ? 'Hide' : 'Waiting room, passcode, who can present, chat and record'}</span>
            </button>
            {roomOpen ? (
              <div className="flex flex-col gap-3 border-t border-line p-3">
                <label className={label}>
                  <span>
                    Passcode <span className="font-normal text-ink-3">Optional. Letters and numbers, up to 12.</span>
                  </span>
                  <input value={passcode} maxLength={12} onChange={(e) => setPasscode(e.target.value.replace(/[^A-Za-z0-9]/g, ''))} className={field} />
                </label>
                <RoomSettingsFields value={roomSettings} onChange={(patch) => setRoomSettings({ ...roomSettings, ...patch })} />
                <p className="text-[11.5px] text-ink-3">Co-hosts and presenters are chosen on each person above. You can change all of this during the meeting.</p>
              </div>
            ) : null}
          </div>
        ) : null}
        <label className={label}>
          External guests
          <input value={guests} onChange={(e) => setGuests(e.target.value)} placeholder="someone@client.com, …" className={field} />
        </label>
        <label className={label}>
          <span>
            Agenda <span className="font-normal text-ink-3">One item per line.</span>
          </span>
          <textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={4} className="rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] font-normal text-ink outline-none focus:border-primary" />
        </label>
        {error ? <div className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger" role="alert">{error}</div> : null}
      </div>
    </Modal>
  );
}
