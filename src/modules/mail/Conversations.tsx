import { useState } from 'react';
import { apiDelete, apiPost } from '../../core/api';
import { text } from '../../core/i18n';
import { Button, Modal } from '../../components/ui';
import { messageAction } from './api';
import { deviceId } from './clientRules';
import type { MailFilter } from './MailRules';
import type { Target } from './MessageMenus';
import { plainText } from './model';
import type { MessageDetail, MessageRow } from './types';

/**
 * Ignore conversation (ENH-MAIL-03 DMO-INB-10): the messages of the thread
 * here go to Deleted Items, and so does every later one. A WorkSuite mailbox
 * keeps that as a rule on its mail server (so the phone agrees); any other
 * mailbox cannot, and this computer applies it instead — the person is told
 * which. Undone from Deleted Items with Stop ignoring.
 */

/** The thread's root Message-ID as rules keep it, or null when the row has no stable one. */
export function conversationKeyOf(row: Pick<MessageRow, 'conversation_key'>): string | null {
  const k = (row.conversation_key ?? '').trim().replace(/^<|>$/g, '').toLowerCase();
  return k.length > 0 && k.length <= 250 && /^[^\s"\\<>]+@[^\s"\\<>]+$/.test(k) ? k : null;
}

/** The ignored conversations, from the rules WorkSuite keeps. */
export function ignoredKeys(filters: MailFilter[] | undefined): Set<string> {
  return new Set((filters ?? []).filter((f) => f.field === 'thread').map((f) => f.value.toLowerCase()));
}

export async function ignoreConversation(key: string, subject: string, mailbox: string | null, here: Target[]): Promise<{ where: 'server' | 'computer'; moved: number }> {
  const r = await apiPost<{ where: 'server' | 'computer' }>('/api/mail/rules/ignore', { key, subject, device_id: deviceId(), ...(mailbox ? { mailbox } : {}) }, mailbox ? { mailbox } : undefined);
  let moved = 0;
  for (const t of here) {
    try {
      await messageAction({ uid: String(t.row.id), folder: t.folder, mailbox: t.mailbox }, 'trash', t.row.subject);
      moved++;
    } catch {
      // The rule stands; a message that would not move stays where it is.
    }
  }
  return { where: r?.where ?? 'server', moved };
}

export async function stopIgnoring(key: string, t: Target): Promise<void> {
  await apiDelete(t.mailbox ? `/api/mail/rules/ignore?mailbox=${encodeURIComponent(t.mailbox)}` : '/api/mail/rules/ignore', { key });
  await messageAction({ uid: String(t.row.id), folder: t.folder, mailbox: t.mailbox }, 'inbox', t.row.subject);
}

export function IgnoreDialog({ subject, count, onConfirm, onClose }: { subject: string; count: number; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={text('Ignore conversation')}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={() => {
              setBusy(true);
              void onConfirm().finally(() => setBusy(false));
            }}
          >
            Ignore conversation
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] text-ink-2">
        {text('“{subject}”: the {n} message(s) here and every later message in this conversation go to Deleted Items. You can stop ignoring it from Deleted Items.', { subject: subject || text('(no subject)'), n: count })}
      </p>
    </Modal>
  );
}

/** A message's own words, for comparing: quote marks, spacing and case set aside. */
export function comparable(html: string): string {
  return plainText(html)
    .split('\n')
    .map((l) => l.replace(/^(\s*>)+/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Clean up conversation (DMO-INB-11): the messages whose whole text a later
 * message in the thread already quotes — never the newest, never one with an
 * attachment, a star or a flag (`keep`), and never a short one, where
 * "contained" proves nothing.
 */
export function redundantInThread(msgs: MessageDetail[], keep: (m: MessageDetail) => boolean): MessageDetail[] {
  const ordered = [...msgs].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  const texts = ordered.map((m) => comparable(m.body_html ?? ''));
  return ordered.filter((m, i) => {
    if (i === ordered.length - 1 || keep(m) || (m.attachments?.length ?? 0) > 0 || m.is_starred) return false;
    const mine = texts[i]!;
    if (mine.length < 20) return false;
    return texts.slice(i + 1).some((later) => later.includes(mine));
  });
}

export function CleanupDialog({ subject, count, onConfirm, onClose }: { subject: string; count: number; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={text('Clean up conversation')}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={() => {
              setBusy(true);
              void onConfirm().finally(() => setBusy(false));
            }}
          >
            {text('Move {n} to Deleted Items', { n: count })}
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] text-ink-2">
        {text('“{subject}”: {n} message(s) are quoted in full in a later reply. Messages with attachments, stars or flags are kept.', { subject: subject || text('(no subject)'), n: count })}
      </p>
    </Modal>
  );
}
