import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError, apiGet, apiPost } from '../../../core/api';
import { errorMessage, on } from '../../../core/bridge';
import { navigate } from '../../../core/tabs';
import { parseTs } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { useNow } from '../../calls/parts';
import { websiteAction, WEBSITE, type WebsiteConversation } from './api';

interface Pending {
  conversation_id: number;
  site: string | null;
  visitor: string;
  by: string | null;
  at: string;
}

/** Later: out of the way for this long, then back. */
const LATER_MS = 2 * 60_000;

/**
 * "Chat assigned to you" (WebChatLive): a website chat given to you stays
 * in the corner of the main window until you accept it, put it off, or
 * dismiss it — wherever you are in the app. Only for website staff: anyone
 * the server refuses is never asked again.
 */
export function AssignmentAlert() {
  const qc = useQueryClient();
  const [later, setLater] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const now = useNow();
  const q = useQuery({
    queryKey: ['website', 'assignments'],
    queryFn: ({ signal }) => apiGet<{ pending: Pending[] }>(`${WEBSITE}/assignments/pending`, undefined, signal),
    refetchInterval: (query) => (query.state.error instanceof ApiError && (query.state.error.forbidden || query.state.error.status === 404) ? false : 20_000),
    retry: false,
  });
  useEffect(
    () =>
      on<{ type: string }>('realtime:event', (e) => {
        if (e.type === 'chat.assigned' || e.type === 'chat.taken') void qc.invalidateQueries({ queryKey: ['website', 'assignments'] });
      }),
    [qc],
  );
  const item = (q.data?.pending ?? []).find((p) => !(later[p.conversation_id] && later[p.conversation_id]! > now)) ?? null;
  const detail = useQuery({
    queryKey: ['website', 'conversation', String(item?.conversation_id ?? 0), 'alert'],
    queryFn: ({ signal }) => apiGet<WebsiteConversation>(`${WEBSITE}/conversations/${item!.conversation_id}`, undefined, signal),
    enabled: !!item,
    staleTime: 60_000,
  });
  if (!item) return null;
  const v = detail.data?.visitor;
  const said = [...(detail.data?.messages ?? [])].reverse().find((m) => m.from === 'visitor' && m.body)?.body;
  const waited = Math.max(0, Math.round((now - parseTs(item.at).getTime()) / 1000));
  const page = v?.current_url ? (() => {
    try {
      return new URL(v.current_url).pathname;
    } catch {
      return v.current_url;
    }
  })() : null;
  const done = () => void qc.invalidateQueries({ queryKey: ['website'] });
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast('error', e instanceof ApiError && e.status === 409 ? 'Someone else has already taken this chat.' : errorMessage(e));
    } finally {
      setBusy(false);
      done();
    }
  };
  return (
    <div role="alertdialog" aria-label="Chat assigned to you" className="fixed right-6 bottom-12 z-40 flex w-[360px] flex-col gap-2.5 rounded-[12px] bg-[#0F1B3D] px-4 py-3.5 text-[13px] text-[#E6ECFA] shadow-[0_18px_44px_rgb(var(--ws-shadow-rgb)/.35)]">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-[#F0503A]" />
        <b className="flex-1 text-white">Chat assigned to you</b>
        <span className="text-[11.5px] text-[#AFC0E8]">Waiting {Math.floor(waited / 60)}:{String(waited % 60).padStart(2, '0')}</span>
      </div>
      <span>
        <b className="text-white">{item.visitor}</b>
        {said ? ` — “${said.slice(0, 140)}”` : item.by ? ` — from ${item.by}` : ''}
      </span>
      <span className="text-[12px] text-[#AFC0E8]">{[page ? `Page ${page}` : null, v?.os ?? v?.device, [v?.city, v?.country].filter(Boolean).join(', ') || null, item.site].filter(Boolean).join(' · ')}</span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await apiPost(`${WEBSITE}/conversations/${item.conversation_id}/accept`);
              navigate(`/chat?view=website&website=${item.conversation_id}`);
            })
          }
          className="h-[34px] flex-1 rounded-[8px] bg-[#3DD68C] font-bold text-[#0B2A1D]"
        >
          Accept
        </button>
        <button type="button" disabled={busy} onClick={() => setLater({ ...later, [item.conversation_id]: now + LATER_MS })} className="h-[34px] flex-1 rounded-[8px] border border-[#33477E] font-semibold">
          Later
        </button>
        <button type="button" disabled={busy} onClick={() => void run(() => websiteAction(item.conversation_id, 'acknowledge'))} className="h-[34px] flex-1 rounded-[8px] border border-[#33477E] font-semibold">
          Ignore
        </button>
      </div>
    </div>
  );
}
