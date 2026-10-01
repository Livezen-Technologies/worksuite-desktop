import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { LocalRecording, Transfer } from '@shared/types';
import { app } from '../../core/app-state';
import { call, errorMessage, on } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';

/**
 * Recording status, wherever a recording is listed (worksuite-desktop#89). The main process holds it — the
 * recorder's ledger, the transfer queue and which download is which recording's — so it survives a restart; these
 * read it, follow its changes while shown, and read it again whenever they are shown anew, so leaving Meet for
 * another module and coming back never shows an old step.
 */

export function useLocalRecordings(): LocalRecording[] {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['meet', 'local-recordings'], queryFn: () => call('meetrec:list'), refetchOnMount: 'always' });
  useEffect(
    () =>
      on<LocalRecording[]>('meetrec:changed', (list) => {
        qc.setQueryData(['meet', 'local-recordings'], list);
        if (list.some((r) => r.state === 'ready')) void qc.invalidateQueries({ queryKey: ['meet', 'recordings'] });
      }),
    [qc],
  );
  return q.data ?? [];
}

/** Which transfer has each Meet recording's download, by the recording's id. */
export function useRecordingDownloads(): Record<string, string> {
  const q = useQuery({ queryKey: ['meet', 'recording-downloads'], queryFn: () => call('meetrec:downloads'), refetchOnMount: 'always' });
  return q.data ?? {};
}

/** Every transfer, as the transfer queue last said (kept current app-wide). */
export function useTransfers(): Transfer[] {
  return useStore(app, (s) => s.transfers);
}

/** What a recording's transfer buttons do: the transfer queue's own Pause, Resume, Cancel and Retry. */
export function transferAct(channel: 'transfers:pause' | 'transfers:resume' | 'transfers:cancel' | 'transfers:retry' | 'transfers:open' | 'transfers:reveal', id: string): () => void {
  return () => void call(channel, { id }).catch((e) => toast('error', errorMessage(e)));
}
