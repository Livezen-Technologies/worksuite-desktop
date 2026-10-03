import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { apiGet } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { Select } from '../../components/Select';
import { Button, Modal } from '../../components/ui';
import { escapeHtml } from './sanitize';

/**
 * Mail merge (ENH-MAIL-03 DMO-CMP-18): one message written once, sent as a
 * separate message to each person on a contact group or a pasted list, with
 * {{name}}, {{first_name}}, {{email}} — and any column of the pasted list —
 * filled in for each. A preview per recipient before anything goes; sent one
 * at a time with a pause between (the throttle) through the normal send, so
 * each goes from the writer's own mailbox and replies come back to it. At
 * most 200 people a merge. It runs while WorkSuite is open; Cancel stops the
 * rest.
 */

export type MergeRow = Record<string, string> & { email: string };

export const MERGE_MAX = 200;
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** A pasted list: a header line naming the columns (one must be email), then one person per line. */
export function parseMergeList(raw: string): { rows: MergeRow[]; error: string | null } {
  const lines = raw.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { rows: [], error: text('Paste a header line (for example: email, name, company) and one line per person.') };
  const split = (l: string) => l.split(/[,;\t]/).map((x) => x.trim().replace(/^"|"$/g, ''));
  const head = split(lines[0]!).map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
  const at = head.indexOf('email');
  if (at < 0) return { rows: [], error: text('The header line needs an “email” column.') };
  const seen = new Set<string>();
  const rows: MergeRow[] = [];
  for (const l of lines.slice(1)) {
    const cells = split(l);
    const email = (cells[at] ?? '').toLowerCase();
    if (!EMAIL.test(email) || seen.has(email)) continue;
    seen.add(email);
    const row = { email } as MergeRow;
    head.forEach((h, i) => {
      if (h && h !== 'email') row[h] = cells[i] ?? '';
    });
    rows.push(withNames(row));
  }
  return { rows: rows.slice(0, MERGE_MAX), error: rows.length ? null : text('No valid addresses in that list.') };
}

function withNames(r: MergeRow): MergeRow {
  const name = (r.name ?? '').trim();
  return { ...r, name, first_name: (r.first_name ?? '').trim() || name.split(/\s+/)[0] || '' };
}

/** {{token}} filled for one person (blank where they have no value); HTML gets escaped values. A token no one has is left as written. */
export function fillMerge(template: string, row: MergeRow, html: boolean): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, key: string) => {
    const v = row[key.toLowerCase()];
    if (v === undefined) return whole;
    return html ? escapeHtml(v) : v;
  });
}

/** Tokens used in the message that a recipient has no value for. */
export function missingTokens(parts: string[], rows: MergeRow[]): string[] {
  const used = new Set<string>();
  for (const p of parts) for (const m of p.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) used.add(m[1]!.toLowerCase());
  return [...used].filter((k) => rows.some((r) => !(r[k] ?? '').trim()));
}

export interface MergeMessage {
  subject: string;
  html: string;
  text: string;
}

export function MailMerge({ message, onSendOne, onClose, pauseMs = 2000 }: { message: MergeMessage; onSendOne: (row: MergeRow, filled: MergeMessage) => Promise<void>; onClose: () => void; pauseMs?: number }) {
  const [source, setSource] = useState<'group' | 'paste'>('group');
  const [groupId, setGroupId] = useState('');
  const [pasted, setPasted] = useState('');
  const [rows, setRows] = useState<MergeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(0);
  const [sent, setSent] = useState<{ done: number; failed: string[] } | null>(null);
  const [running, setRunning] = useState(false);
  const stop = useRef(false);
  const groups = useQuery({ queryKey: ['contacts', 'groups'], queryFn: () => apiGet<Array<{ id: number; name: string; count: number }>>('/api/contact-groups'), staleTime: 5 * 60_000 });

  const load = async () => {
    setError(null);
    if (source === 'paste') {
      const r = parseMergeList(pasted);
      setRows(r.rows.length ? r.rows : null);
      setError(r.error);
      return;
    }
    if (!groupId) return;
    try {
      const r = await apiGet<{ members?: Array<{ name: string | null; email: string }> }>('/api/contacts/expand', { kind: 'group', id: groupId });
      const list = (r?.members ?? []).filter((m) => EMAIL.test(m.email)).slice(0, MERGE_MAX).map((m) => withNames({ email: m.email.toLowerCase(), name: m.name ?? '' } as MergeRow));
      setRows(list.length ? list : null);
      setError(list.length ? null : text('That group has nobody with an address.'));
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const fill = (r: MergeRow): MergeMessage => ({ subject: fillMerge(message.subject, r, false), html: fillMerge(message.html, r, true), text: fillMerge(message.text, r, false) });
  const send = async () => {
    if (!rows) return;
    stop.current = false;
    setRunning(true);
    const failed: string[] = [];
    let done = 0;
    for (let i = 0; i < rows.length && !stop.current; i++) {
      try {
        await onSendOne(rows[i]!, fill(rows[i]!));
        done++;
      } catch (e) {
        failed.push(`${rows[i]!.email}: ${errorMessage(e)}`);
      }
      setSent({ done, failed: [...failed] });
      if (i < rows.length - 1 && !stop.current) await new Promise((res) => setTimeout(res, pauseMs));
    }
    setRunning(false);
  };
  const missing = rows ? missingTokens([message.subject, message.html], rows) : [];
  const shown = rows?.[Math.min(preview, rows.length - 1)];

  return (
    <Modal
      title={text('Mail merge')}
      onClose={() => {
        stop.current = true;
        onClose();
      }}
      width={620}
      footer={
        <>
          {running ? (
            <Button onClick={() => (stop.current = true)}>{text('Stop')}</Button>
          ) : (
            <Button onClick={onClose}>{sent ? text('Close') : text('Cancel')}</Button>
          )}
          {!sent ? (
            <Button variant="primary" disabled={!rows?.length || running} loading={running} onClick={() => void send()}>
              {text('Send {n} separate messages', { n: rows?.length ?? 0 })}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13.5px] text-ink">
        <p className="text-[12.5px] text-ink-3">{text('Each person gets their own message from you, with {{name}}, {{first_name}} and {{email}} — and any column of a pasted list — filled in. Replies come back to you.')}</p>
        {!sent ? (
          <>
            <div role="radiogroup" aria-label={text('Recipients')} className="flex gap-2">
              {(['group', 'paste'] as const).map((s) => (
                <Button key={s} size="sm" role="radio" aria-checked={source === s} variant={source === s ? 'primary' : 'secondary'} onClick={() => (setSource(s), setRows(null))}>
                  {s === 'group' ? text('A contact group') : text('Paste a list')}
                </Button>
              ))}
            </div>
            {source === 'group' ? (
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Select label={text('Contact group')} value={groupId} options={[{ value: '', label: text('Choose') }, ...(groups.data ?? []).map((g) => ({ value: String(g.id), label: `${g.name} (${g.count})` }))]} onValueChange={(v) => (setGroupId(String(v)), setRows(null))} />
                </div>
                <Button onClick={() => void load()} disabled={!groupId}>
                  {text('Load')}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <textarea aria-label={text('People')} value={pasted} onChange={(e) => setPasted(e.target.value)} rows={5} placeholder={'email, name, company\npat@client.lk, Pat Silva, Silva Builders'} className="rounded-[8px] border border-line bg-surface px-3 py-2 font-mono text-[12.5px] text-ink outline-none focus:border-primary" />
                <Button className="self-start" onClick={() => void load()} disabled={!pasted.trim()}>
                  {text('Load')}
                </Button>
              </div>
            )}
          </>
        ) : null}
        {error ? <p role="alert" className="text-[12.5px] text-danger">{error}</p> : null}
        {rows && shown && !sent ? (
          <div className="flex flex-col gap-2 rounded-[10px] border border-line p-3">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[12.5px] font-semibold">{text('Preview for {email} ({i} of {n})', { email: shown.email, i: Math.min(preview, rows.length - 1) + 1, n: rows.length })}</span>
              <Button size="sm" disabled={preview <= 0} onClick={() => setPreview(Math.max(0, preview - 1))}>
                {text('Previous')}
              </Button>
              <Button size="sm" disabled={preview >= rows.length - 1} onClick={() => setPreview(Math.min(rows.length - 1, preview + 1))}>
                {text('Next')}
              </Button>
            </div>
            <p className="text-[13px] font-bold">{fill(shown).subject || text('(no subject)')}</p>
            <pre className="max-h-[180px] overflow-auto text-[12.5px] whitespace-pre-wrap text-ink-2">{fill(shown).text}</pre>
            {missing.length ? <p className="text-[12px] text-warning">{text('Some people have no value for: {tokens}. Those places are left blank.', { tokens: missing.map((k) => `{{${k}}}`).join(', ') })}</p> : null}
          </div>
        ) : null}
        {sent ? (
          <div role="status" className="flex flex-col gap-1">
            <p>{text('{done} of {n} sent.', { done: sent.done, n: rows?.length ?? 0 })}</p>
            {sent.failed.map((f) => (
              <p key={f} className="text-[12.5px] text-danger">
                {f}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
