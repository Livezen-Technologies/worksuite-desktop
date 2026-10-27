import type { HttpClient } from '../../services/http';
import type { LockService } from '../../services/lock';
import type { WindowManager } from '../../windows/manager';
import type { ClockExtra } from '../context';
import { isDesktopError } from '../errors';
import { broadcast } from '../events';
import type { SessionController } from '../session';
import type { UpdateActivity } from '@shared/types';
import { powerMonitor } from 'electron';
import type { TrayService } from '../../tray/tray';

/**
 * Attendance for the tray (FR-TRAY-01 Clock In) and chat presence (FR-COM-02): clocking in and out, breaks and the
 * presence heartbeat. Moved out of the composition root (electron/main/index.ts) unchanged (audit D-G13).
 */
/** What wirePresence reads from the composition root (electron/main/index.ts), live: getters, so a value set later is seen. */
export interface WirePresenceDeps {
  readonly http: HttpClient;
  readonly lock: LockService;
  presenceTimer: NodeJS.Timeout | null;
  readonly sessionCtl: SessionController;
  readonly tray: TrayService;
  readonly updateActivity: () => UpdateActivity;
  readonly windows: WindowManager;
}

export function wirePresence(root: WirePresenceDeps) {
  const heartbeatPresence = async (): Promise<void> => {
    if (!root.sessionCtl.isReady() || root.lock.isLocked()) return;
    try {
      // In a meeting or on a call, the server counts me busy: a visitor writing again in my chat goes straight to the
      // team, and no new chat is given to me (worksuite-desktop#230). An older server ignores the field.
      const doing = root.updateActivity();
      await root.http.post('/api/chat/presence', { active: powerMonitor.getSystemIdleTime() < 300, busy_reason: doing.meeting ? 'meeting' : doing.call ? 'call' : null });
    } catch (e) {
      // No chat for this person (or no such endpoint): stop asking.
      if (isDesktopError(e) && (e.code === 'PERMISSION_DENIED' || e.code === 'APP_ACCESS_DENIED' || e.code === 'NOT_FOUND')) stopPresence();
    }
  };
  const stopPresence = (): void => {
    if (root.presenceTimer) clearInterval(root.presenceTimer);
    root.presenceTimer = null;
  };
  const refreshAttendance = async (): Promise<void> => {
    try {
      const a = await root.http.get<{ linked?: boolean; today?: { check_in?: string | null; check_out?: string | null } | null }>('/api/hr/attendance/me');
      const clockedIn = !!(a.today?.check_in && !a.today?.check_out);
      // Attendance stamps are wall-clock times on the company's clock, not UTC:
      // shown as the digits they are, never converted.
      const m = clockedIn && a.today?.check_in ? /[T ](\d{2}):(\d{2})/.exec(a.today.check_in) : null;
      const since = m ? new Date(Date.UTC(2000, 0, 1, +m[1]!, +m[2]!)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) : null;
      root.tray.update({ attendance: { linked: !!a.linked, clockedIn, since } });
    } catch {
      root.tray.update({ attendance: null });
    }
  };
  /**
   * Clocking in or out, from anywhere in the app: the tray, the title bar or
   * the HR page. One implementation, so all three show the same state — the
   * tray menu, and every screen through the `hr.attendance.changed` event.
   * Errors are the caller's to show.
   */
  const clockAttendance = async (direction: 'in' | 'out', extra: ClockExtra = {}): Promise<void> => {
    try {
      await root.http.post(`/api/hr/attendance/check-${direction}`, {
        source: 'desktop',
        note: extra.note || undefined,
        work_location: direction === 'in' ? extra.workLocation || undefined : undefined,
        note_type: direction === 'out' ? extra.noteType || undefined : undefined,
        geo_note: extra.geoNote || undefined,
      });
      broadcast('realtime:event', { type: 'hr.attendance.changed' });
    } finally {
      void refreshAttendance();
    }
  };
  const attendanceBreak = async (action: 'start' | 'end'): Promise<void> => {
    try {
      await root.http.post('/api/hr/attendance/break', { action });
      broadcast('realtime:event', { type: 'hr.attendance.changed' });
    } finally {
      void refreshAttendance();
    }
  };
  const clock = async (direction: 'in' | 'out'): Promise<void> => {
    try {
      await clockAttendance(direction);
      broadcast('toast', { kind: 'success', text: direction === 'in' ? 'Clocked in. Have a good day.' : 'Clocked out.' });
    } catch (e) {
      broadcast('toast', { kind: 'error', text: (e as Error).message });
      root.windows.showMain();
    }
  };
  return { attendanceBreak, clock, clockAttendance, heartbeatPresence, refreshAttendance, stopPresence };
}
