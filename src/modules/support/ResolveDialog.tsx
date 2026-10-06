import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Ticket } from '@shared/support';
import { text } from '../../core/i18n';
import { toast } from '../../core/toasts';
import { Button, Modal } from '../../components/ui';
import { K, conflictTicket, errorText, transition } from './api';

/**
 * Resolve, from the E key or the Resolve button (FR-WSP-06, FR-STS-03): one step, with room for what fixed it — the
 * summary the requester's "resolved" message and the reports read later. Enter in the summary resolves; Escape
 * leaves the ticket as it was. Sent with the version the screen showed, so a ticket somebody else changed meanwhile
 * is not resolved over their change.
 */
export function ResolveDialog({ ticket, onClose, onDone }: { ticket: Pick<Ticket, 'id' | 'reference' | 'subject' | 'version'>; onClose: () => void; onDone?: () => void }) {
  const qc = useQueryClient();
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const resolve = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await transition(ticket.id, { status: 'resolved', version: ticket.version || undefined, resolution_summary: summary.trim() || undefined });
      toast('success', text('{ref} resolved.', { ref: ticket.reference }));
      onDone?.();
      onClose();
    } catch (e) {
      // Somebody changed it first: the screen shows it as it now stands, and nothing is resolved over it.
      if (conflictTicket(e)) toast('warning', text('{ref} was changed by somebody else. Look at it again before resolving.', { ref: ticket.reference }));
      else toast('error', errorText(e));
      onClose();
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: K.ticket(ticket.id) });
      void qc.invalidateQueries({ queryKey: K.lists });
      void qc.invalidateQueries({ queryKey: ['support', 'views'] });
    }
  };
  return (
    <Modal
      title={text('Resolve {ref}', { ref: ticket.reference })}
      labelledBy="support-resolve-title"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>{text('Cancel')}</Button>
          <Button variant="primary" icon="check" loading={busy} onClick={() => void resolve()}>
            {text('Resolve')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-ink-2">{ticket.subject}</p>
      <label className="flex flex-col gap-1">
        <span className="text-[12.5px] font-semibold text-ink-2">{text('What fixed it (optional)')}</span>
        <textarea
          autoFocus
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void resolve();
            }
          }}
          className="w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-primary"
        />
      </label>
    </Modal>
  );
}
