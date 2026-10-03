import { useState } from 'react';
import { apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { addDays, dayWords, todayInZone, wallTimeLabel, wallToUtc } from '../../core/time';
import { Checkbox } from '../../components/Checkbox';
import { Select } from '../../components/Select';
import { Button, Modal } from '../../components/ui';
import { createMeeting } from '../meet/api';
import { escapeHtml } from './sanitize';

/**
 * Suggest times (ENH-MAIL-03 DMO-CMP-17): a few times in the next working
 * days when the recipients WorkSuite can see are free — asked of the
 * Calendar's own conflict check, which only answers for people the writer
 * may see — and, if wanted, a WorkSuite Meet link, put into the message for
 * the person to edit. People whose calendars cannot be seen are named, not
 * counted as free.
 */

export interface Slot {
  start: string;
  end: string;
}

/** Candidate times: working days ahead, on the hour from 9 to 16, not already past. */
export function candidateSlots(today: string, minutes: number, nowUtc: number, days = 5, toUtc: (ymd: string, min: number) => string = wallToUtc): Slot[] {
  const out: Slot[] = [];
  let d = today;
  for (let looked = 0; out.length < days * 8 && looked < days + 4; looked++, d = addDays(d, 1)) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (let h = 9; h <= 16; h++) {
      if (h * 60 + minutes > 17 * 60 + 30) continue;
      if (Date.parse(toUtc(d, h * 60)) <= nowUtc + 30 * 60_000) continue;
      const pad = (n: number) => String(n).padStart(2, '0');
      const endMin = h * 60 + minutes;
      out.push({ start: `${d}T${pad(h)}:00`, end: `${d}T${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}` });
    }
  }
  return out;
}

interface CheckAnswer {
  conflicts?: unknown[];
  unknown?: Array<{ id?: number; email?: string }>;
}

/** The first `want` slots nobody visible is busy in; and who could not be seen. */
export async function freeSlots(emails: string[], slots: Slot[], want = 3, check: (s: Slot) => Promise<CheckAnswer> = (s) => apiPost<CheckAnswer>('/api/calendar/conflicts', { start: s.start, end: s.end, emails, include_me: true })): Promise<{ free: Slot[]; unseen: string[] }> {
  const free: Slot[] = [];
  const unseen = new Set<string>();
  for (const s of slots.slice(0, 40)) {
    const r = await check(s);
    for (const u of r.unknown ?? []) if (u.email) unseen.add(u.email);
    if (!(r.conflicts ?? []).length) free.push(s);
    if (free.length >= want) break;
  }
  return { free, unseen: [...unseen] };
}

export function slotWords(s: Slot): string {
  return `${dayWords(s.start.slice(0, 10), { weekday: true })}, ${wallTimeLabel(s.start)}–${wallTimeLabel(s.end)}`;
}

export function SuggestTimes({ recipients, subject, onInsert, onClose }: { recipients: string[]; subject: string; onInsert: (html: string) => void; onClose: () => void }) {
  const [minutes, setMinutes] = useState(60);
  const [meet, setMeet] = useState(true);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ free: Slot[]; unseen: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const look = async () => {
    setBusy(true);
    setError(null);
    try {
      setFound(await freeSlots(recipients, candidateSlots(todayInZone(), minutes, Date.now())));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const insert = async () => {
    if (!found?.free.length) return;
    setBusy(true);
    try {
      const lines = found.free.map((s) => `<li>${escapeHtml(slotWords(s))}</li>`).join('');
      let link = '';
      if (meet) {
        const m = await createMeeting({ title: subject || text('Meeting'), later: true });
        link = `<p>${escapeHtml(text('Join with WorkSuite Meet:'))} <a href="${escapeHtml(m.join_url)}">${escapeHtml(m.join_url)}</a></p>`;
      }
      onInsert(`<p>${escapeHtml(text('Would one of these times work for you?'))}</p><ul>${lines}</ul>${link}`);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={text('Suggest times')}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {found?.free.length ? (
            <Button variant="primary" loading={busy} onClick={() => void insert()}>
              {text('Insert into the message')}
            </Button>
          ) : (
            <Button variant="primary" loading={busy} onClick={() => void look()}>
              {text('Find times')}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13.5px] text-ink">
        <p className="text-[12.5px] text-ink-3">{recipients.length ? text('Free times for you and {n} recipient(s) in the next working days.', { n: recipients.length }) : text('Free times in your calendar in the next working days. Add recipients to include theirs.')}</p>
        <div className="flex items-end gap-3">
          <div className="w-[150px]">
            <Select label={text('Length')} value={minutes} options={[30, 60, 90].map((n) => ({ value: n, label: text('{n} minutes', { n }) }))} onValueChange={(v) => (setMinutes(Number(v)), setFound(null))} />
          </div>
          <label className="flex items-center gap-2 pb-2 text-[13px]">
            <Checkbox checked={meet} onChange={(e) => setMeet(e.target.checked)} />
            {text('Add a WorkSuite Meet link')}
          </label>
        </div>
        {found ? (
          found.free.length ? (
            <ul aria-label={text('Free times')} className="flex flex-col gap-1 rounded-[10px] border border-line p-2">
              {found.free.map((s) => (
                <li key={s.start}>{slotWords(s)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-ink-3">{text('No time in the next working days is free for everyone.')}</p>
          )
        ) : null}
        {found?.unseen.length ? <p className="text-[12px] text-warning">{text('Not checked — their calendars are not visible to you: {people}.', { people: found.unseen.join(', ') })}</p> : null}
        {error ? <p role="alert" className="text-[12.5px] text-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}
