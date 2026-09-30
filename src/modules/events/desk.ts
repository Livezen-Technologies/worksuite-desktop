import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { call, on } from '../../core/bridge';
import type { DeskPrintPatch, DeskPrintSettings, DeskQueueItem, DeskRegistration, DeskScanMode, DeskScanOutcome, DeskSearchHit, DeskStatus, DeskWalkIn } from '@shared/event-desk';

/**
 * This computer as a check-in device (the main process's event-desk.ts): its
 * registration at an event, its offline copy, the scans it keeps for
 * WorkSuite, and its badge printer. The key the server gave it never comes
 * here; a scan goes to the main process, which asks the server or — when the
 * server does not answer — its copy.
 */

export const DK = {
  all: ['events', 'desk'] as const,
  list: ['events', 'desk', 'list'] as const,
  status: (id: number) => ['events', 'desk', 'status', id] as const,
  queue: (id: number) => ['events', 'desk', 'queue', id] as const,
  print: ['events', 'desk', 'print'] as const,
};

/* IPC, not the network: these answer with the line down, so they never wait for it. */
const LOCAL = { networkMode: 'always' as const, retry: false as const };

export const deskList = (): Promise<DeskRegistration[]> => call('eventdesk:list');
export const deskStatus = (eventId: number): Promise<DeskStatus> => call('eventdesk:status', { event_id: eventId });
export const deskRegister = (eventId: number, gateId: number | null, name: string) => call('eventdesk:register', { event_id: eventId, gate_id: gateId, name });
export const deskRotateKey = (eventId: number) => call('eventdesk:rotateKey', { event_id: eventId });
export const deskForget = (eventId: number, discard = false) => call('eventdesk:forget', { event_id: eventId, discard });
export const deskSync = (eventId: number): Promise<DeskStatus> => call('eventdesk:sync', { event_id: eventId });
export const deskQueue = (eventId: number): Promise<DeskQueueItem[]> => call('eventdesk:queue', { event_id: eventId });
export const deskQueueResolve = (eventId: number, clientUuid: string, action: 'retry' | 'drop') => call('eventdesk:queueResolve', { event_id: eventId, client_uuid: clientUuid, action });
export const deskWalkIn = (input: DeskWalkIn) => call('eventdesk:walkIn', input);
export const deskSearch = (eventId: number, q: string, limit = 20): Promise<DeskSearchHit[]> => call('eventdesk:search', { event_id: eventId, q, limit });
export const printSettings = (): Promise<DeskPrintSettings> => call('eventdesk:printSettings');
export const setPrintSettings = (patch: DeskPrintPatch): Promise<DeskPrintSettings> => call('eventdesk:printSettingsSet', patch);
export const printJobs = (eventId: number, jobIds: number[]) => call('eventdesk:printJobs', { event_id: eventId, job_ids: jobIds });

export function deskScan(eventId: number, what: { code: string } | { registration_id: number }, mode: DeskScanMode): Promise<DeskScanOutcome> {
  return call('eventdesk:scan', { event_id: eventId, ...what, mode });
}

export function useDesks() {
  return useQuery({ queryKey: DK.list, queryFn: deskList, ...LOCAL });
}

export function useDeskStatus(eventId: number, enabled = true) {
  return useQuery({ queryKey: DK.status(eventId), queryFn: () => deskStatus(eventId), ...LOCAL, enabled, refetchInterval: 15_000 });
}

export function useDeskQueue(eventId: number, enabled = true) {
  return useQuery({ queryKey: DK.queue(eventId), queryFn: () => deskQueue(eventId), ...LOCAL, enabled });
}

export function usePrintSettings() {
  return useQuery({ queryKey: DK.print, queryFn: printSettings, ...LOCAL });
}

/** The main process says when a desk's copy, queue or registration changed. */
export function useDeskChanged(): void {
  const qc = useQueryClient();
  useEffect(() => on('eventdesk:changed', () => void qc.invalidateQueries({ queryKey: DK.all })), [qc]);
}
