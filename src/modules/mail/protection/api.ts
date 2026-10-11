import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiDelete, apiGet, apiGetMeta, apiPost, apiPut, withMailbox, type ApiResult } from '../../../core/api';
import { app } from '../../../core/app-state';
import { useStore } from '../../../core/store';
import { useLocalFirst } from '../localFirst';
import type { MessageRef } from '../types';
import type { AttachmentScanResult, ListEntry, MessageProtection, MyLists, ProtectionSettings, QuarantinePage } from './types';

/**
 * The person's side of mail protection (ENH-MAIL-04 §7.1): a message's verdict, its attachments' scans, the
 * quarantine, their own allow and block lists and their settings. Reads go through the API proxy, which keeps
 * `/api/mail/messages/…` answers on this computer (the offline cache), so a verdict already seen is there offline
 * (MPR-UX-07). A server without the protection service answers 404: the app then behaves as it always did.
 */

export const protectionKeys = {
  message: (ref: MessageRef) => ['mail', 'protection', ref.mailbox ?? null, ref.folder, ref.uid] as const,
  quarantine: (state: string, q: string) => ['mail', 'quarantine', state, q] as const,
  quarantineAll: ['mail', 'quarantine'] as const,
  lists: ['mail', 'protection-lists'] as const,
  settings: ['mail', 'protection-settings'] as const,
};

export const protectionPath = (ref: MessageRef) => `/api/mail/messages/${ref.uid}/protection`;
export const protectionQuery = (ref: MessageRef) => withMailbox({ folder: ref.folder }, ref.mailbox);

export type ProtectionAnswer = ApiResult<MessageProtection> | { unavailable: true };

/** Not there at all: an older WorkSuite without the protection service. */
export const isMissing = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 501);

/** One message's protection, from this computer first, then the server; asked again every few seconds while Checking. */
export function useMessageProtection(ref: MessageRef, enabled = true) {
  const key = protectionKeys.message(ref);
  useLocalFirst<MessageProtection>(key, enabled ? { path: protectionPath(ref), query: protectionQuery(ref) } : null, (r) => r);
  const online = useStore(app, (s) => s.status?.network !== 'OFFLINE');
  return useQuery<ProtectionAnswer>({
    queryKey: key,
    queryFn: async ({ signal }) => {
      try {
        const r = await apiGetMeta<MessageProtection | null>(protectionPath(ref), protectionQuery(ref), signal);
        // The server's empty answer: nothing to say about this message (outside protection).
        return r.data ? (r as ProtectionAnswer) : { unavailable: true };
      } catch (e) {
        if (isMissing(e)) return { unavailable: true };
        throw e;
      }
    },
    enabled,
    retry: false,
    staleTime: 60_000,
    // The verdict is pushed by the server; until it is here, it is asked again (bounded by the 5 s / 60 s targets, NFR-MPR-02).
    refetchInterval: (q) => {
      const d = q.state.data;
      const checking = !!d && !('unavailable' in d) && !!d.data && (d.data.verdict === 'CHECKING' || d.data.attachments?.some((a) => a.status === 'checking'));
      return online && checking ? 4_000 : false;
    },
  });
}

/** One message's protection, asked straight away (saving its attachments from the list, a Quick Step). Null: no service. */
export async function fetchProtection(ref: MessageRef): Promise<MessageProtection | null> {
  try {
    return await apiGet<MessageProtection>(protectionPath(ref), protectionQuery(ref));
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

/** Scan one attachment now (Scan now on a chip, P-UI-11). */
export function scanAttachment(ref: MessageRef, part: string): Promise<AttachmentScanResult> {
  return apiPost<AttachmentScanResult>('/api/mail/attachments/scan', { mailbox: ref.mailbox ? Number(ref.mailbox) : null, message: ref.uid, folder: ref.folder, part });
}

/** Report phishing: held for the reporter, and its links and fingerprint go on the organisation's lists. */
export function reportPhish(ref: MessageRef): Promise<unknown> {
  return apiPost(`/api/mail/messages/${ref.uid}/report-phish`, { folder: ref.folder, ...(ref.mailbox ? { mailbox: ref.mailbox } : {}) });
}

export function useQuarantine(state: 'held' | 'requested' | 'released' | 'all', q: string, enabled = true) {
  return useQuery({
    queryKey: protectionKeys.quarantine(state, q),
    queryFn: async ({ signal }) => {
      try {
        return await apiGet<QuarantinePage>('/api/mail/quarantine', { state, q: q.trim() || undefined }, signal);
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

/** How many are held for the person, for the rail: null when the server has no quarantine. */
export function useQuarantineCount(enabled: boolean) {
  const q = useQuarantine('held', '', enabled);
  return q.data ? q.data.counts.held : null;
}

export function releaseQuarantined(id: number, trustSender = false): Promise<unknown> {
  return apiPost(`/api/mail/quarantine/${id}/release`, trustSender ? { trust_sender: true } : {});
}

export function requestRelease(id: number, note: string): Promise<unknown> {
  return apiPost(`/api/mail/quarantine/${id}/request`, note.trim() ? { note: note.trim() } : {});
}

export function useMyLists(enabled = true) {
  return useQuery({
    queryKey: protectionKeys.lists,
    queryFn: async () => {
      try {
        return await apiGet<MyLists>('/api/mail/protection/lists/me');
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

/** Trust or block a sender (an address or a domain) on the person's own list. */
export function addMyListEntry(kind: 'allow' | 'block', value: string, extra: { reason?: string; expires_at?: string } = {}): Promise<ListEntry> {
  return apiPost<ListEntry>('/api/mail/protection/lists/me', { kind, value: value.trim().toLowerCase(), ...extra });
}

export function removeMyListEntry(id: number): Promise<unknown> {
  return apiDelete(`/api/mail/protection/lists/me/${id}`);
}

export function useProtectionSettings(enabled = true) {
  return useQuery({
    queryKey: protectionKeys.settings,
    queryFn: async () => {
      try {
        return await apiGet<ProtectionSettings>('/api/mail/protection/settings');
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useSaveProtectionSettings() {
  const qc = useQueryClient();
  return async (patch: Partial<Pick<ProtectionSettings, 'digest' | 'junk_level' | 'link_check'>>) => {
    const prev = qc.getQueryData<ProtectionSettings | null>(protectionKeys.settings);
    if (prev) qc.setQueryData(protectionKeys.settings, { ...prev, ...patch });
    try {
      const saved = await apiPut<ProtectionSettings>('/api/mail/protection/settings', patch);
      if (saved && typeof saved === 'object' && 'accounts' in saved) qc.setQueryData(protectionKeys.settings, saved);
    } catch (e) {
      qc.setQueryData(protectionKeys.settings, prev);
      throw e;
    }
  };
}
