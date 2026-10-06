import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { Caps, MessageAnswer, Ticket } from '@shared/support';
import { isMac } from '../../core/bridge';
import { useDraft } from '../../core/drafts';
import { text } from '../../core/i18n';
import { timeLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Button, Kbd, cx } from '../../components/ui';
import { K, addMessage, errorText, newClientId } from './api';

/**
 * The composer (FR-COM-01): a reply to the requester or an internal note, as two explicit buttons, a note unless
 * the agent chooses otherwise (§19.2 — what costs nothing when it goes wrong is the default). ⌘↵ (Ctrl+Enter) sends.
 *
 * What is typed is kept on this computer per ticket (`useDraft`, encrypted, within a second), so a reply started in
 * the inbox's reading pane carries on in the ticket's tab, and survives a restart (FR-CRT-10). A message is sent with
 * a `client_id` kept until it is in, so pressing Send again after a failure is the same message, never two.
 */
export type ComposerMode = 'reply' | 'note';

export interface SupportDraft {
  body: string;
  mode: ComposerMode;
}

export const EMPTY_DRAFT: SupportDraft = { body: '', mode: 'note' };

/** Whether the person may write each kind here: a note needs notes and reply (§5.2), a reply needs reply. */
export function composerModes(can: Caps): { reply: boolean; note: boolean } {
  return { reply: can.reply === true, note: can.reply === true && can.notes === true };
}

export function Composer({
  ticket,
  can,
  compact = false,
  focusRequest,
  onSent,
  onTyping,
  className,
}: {
  ticket: Pick<Ticket, 'id' | 'reference' | 'requester' | 'version'>;
  can: Caps;
  compact?: boolean;
  /** The R and N keys: focus the composer in that mode. A new `n` asks again. */
  focusRequest?: { mode: ComposerMode; n: number } | null;
  onSent?: (answer: MessageAnswer) => void;
  /** Typing started or stopped, and in which mode: the collision bar's "typing a note…" (FR-COM-11). */
  onTyping?: (mode: ComposerMode | null) => void;
  className?: string;
}) {
  const qc = useQueryClient();
  const draft = useDraft<SupportDraft>('support', `ticket:${ticket.id}`, EMPTY_DRAFT);
  const modes = composerModes(can);
  const mode: ComposerMode = draft.value.mode === 'reply' && modes.reply ? 'reply' : modes.note ? 'note' : 'reply';
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const clientId = useRef<string | null>(null);
  const typingSaid = useRef<ComposerMode | null>(null);
  const typed = draft.value.body.trim() !== '';

  // R / N from the list: focus here, in that mode.
  useEffect(() => {
    if (!focusRequest) return;
    draft.setValue({ ...draft.value, mode: focusRequest.mode });
    box.current?.focus();
    // Only a new request moves the focus: the draft changing must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.n]);

  // Typing started, stopped, or changed kind: told once each time, not on every key.
  useEffect(() => {
    const now = typed ? mode : null;
    if (typingSaid.current === now) return;
    typingSaid.current = now;
    onTyping?.(now);
  }, [typed, mode, onTyping]);

  if (!modes.reply && !modes.note) {
    return <p className={cx('border-t border-line bg-surface px-4 py-3 text-[12.5px] text-ink-3', className)}>{text('You can read this ticket but not reply to it.')}</p>;
  }

  const setBody = (body: string) => {
    clientId.current = null;
    draft.setValue({ ...draft.value, body });
  };
  const setMode = (m: ComposerMode) => draft.setValue({ ...draft.value, mode: m });

  const send = async () => {
    const body = draft.value.body.trim();
    if (!body || sending) return;
    setSending(true);
    clientId.current ??= newClientId();
    try {
      const r = await addMessage(ticket.id, { body, internal: mode === 'note', client_id: clientId.current });
      clientId.current = null;
      await draft.clear();
      draft.setValue({ body: '', mode });
      if (r.status_refused) toast('warning', text('Sent, but the status did not change: {why}', { why: r.status_refused.message }));
      else toast('success', mode === 'note' ? text('Note added to {ref}.', { ref: ticket.reference }) : text('Reply sent on {ref}.', { ref: ticket.reference }));
      void qc.invalidateQueries({ queryKey: K.ticket(ticket.id) });
      void qc.invalidateQueries({ queryKey: K.lists });
      onSent?.(r);
    } catch (e) {
      toast('error', errorText(e, text('The message was not sent. It is still here; try again.')));
    } finally {
      setSending(false);
    }
  };

  const to = ticket.requester.name || ticket.requester.email || text('the requester');
  const sendKeys = isMac ? '⌘↵' : 'Ctrl+Enter';
  return (
    <div data-support-composer className={cx('flex shrink-0 flex-col border-t border-line bg-surface', compact ? 'gap-1.5 px-3 py-2' : 'gap-2 px-4 py-3', className)}>
      <div className="flex items-center gap-2">
        <div role="radiogroup" aria-label={text('Write a')} className="inline-flex rounded-[8px] bg-subtle p-0.5">
          {modes.reply ? (
            <button type="button" role="radio" aria-checked={mode === 'reply'} onClick={() => setMode('reply')} className={cx('h-6 rounded-[6px] px-2.5 text-[12px] font-semibold', mode === 'reply' ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}>
              {text('Reply to requester')}
            </button>
          ) : null}
          {modes.note ? (
            <button type="button" role="radio" aria-checked={mode === 'note'} onClick={() => setMode('note')} className={cx('h-6 rounded-[6px] px-2.5 text-[12px] font-semibold', mode === 'note' ? 'bg-warning-bg text-warning-ink shadow-sm' : 'text-ink-3 hover:text-ink')}>
              {text('Internal note')}
            </button>
          ) : null}
        </div>
        <span className="min-w-0 truncate text-[11.5px] text-ink-3">
          {mode === 'reply' ? (ticket.requester.email ? text('To {who} <{email}>', { who: to, email: ticket.requester.email }) : text('To {who}', { who: to })) : text('Only staff see notes')}
        </span>
        {draft.savedAt && typed ? <span className="ml-auto shrink-0 text-[11px] text-ink-3">{text('Draft saved {time}', { time: timeLabel(draft.savedAt) })}</span> : null}
      </div>
      <textarea
        ref={box}
        value={draft.value.body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
        rows={compact ? 2 : 4}
        aria-label={mode === 'reply' ? text('Reply to {who}', { who: to }) : text('Internal note')}
        placeholder={mode === 'reply' ? text('Reply to {who}…', { who: to }) : text('Write a note only staff will see…')}
        className={cx(
          'w-full resize-y rounded-[8px] border px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary',
          mode === 'note' ? 'border-[#F6D7B0] bg-[#FFFBF3] dark:border-[#5A3B14] dark:bg-[#21180B]' : 'border-line bg-surface',
        )}
      />
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-ink-3">{compact ? text('R reply · N note · {keys} send', { keys: sendKeys }) : null}</span>
        <Button variant={mode === 'note' ? 'secondary' : 'primary'} size="sm" icon="send" className="ml-auto" loading={sending} disabled={!typed} onClick={() => void send()} aria-keyshortcuts={isMac ? 'Meta+Enter' : 'Control+Enter'}>
          {mode === 'note' ? text('Add note') : text('Send')}
          <Kbd tone={mode === 'note' ? 'key' : 'accent'} aria-hidden>
            {sendKeys}
          </Kbd>
        </Button>
      </div>
    </div>
  );
}
