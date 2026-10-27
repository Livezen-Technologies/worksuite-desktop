import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { dateLabel, timeLabel } from '../../../../core/time';
import { toast } from '../../../../core/toasts';
import { Select } from '../../../../components/Select';
import { Button, ErrorNote, Modal, Spinner, cx } from '../../../../components/ui';
import { VerdictChip } from '../QuarantinePage';
import { STATE_CHIP, VERDICTS, verdictLabel } from '../verdicts';
import { adminDelete, adminKeys, adminRelease, decideRequest, saveRowsCsv, useAdminQuarantine, useAdminQuarantineItem, viewQuarantinedContent } from './api';
import { ProtTop, useAdminPerms } from './parts';
import { SearchRemoveDialog } from './SearchRemove';
import type { AdminQuarantineItem, QuarantineState } from '../types';

/**
 * Admin Center › Protection › Quarantine (D23, P-UI-03, MPR-ADM-03): the organisation's held mail — search and filters
 * (verdict, recipient, sender, dates, path, state), the table, and beside it the selected item: the request and its
 * note, why it was held, the sender checks, headers, View content (asks for a reason and is audited), and Release,
 * Approve / Deny and Delete. Malware has no Release and no Approve, here or anywhere (AC-MPR-14).
 */

const STATES: Array<[QuarantineState | '', string]> = [
  ['', 'Any state'],
  ['held', 'Held'],
  ['requested', 'Release requested'],
  ['released', 'Released'],
  ['deleted', 'Deleted'],
  ['expired', 'Expired'],
];

export function stateChip(s: QuarantineState): { label: string; className: string } {
  if (s === 'requested') return { label: text('Release requested'), className: STATE_CHIP.warn };
  if (s === 'released') return { label: text('Released'), className: STATE_CHIP.ok };
  if (s === 'deleted') return { label: text('Deleted'), className: STATE_CHIP.muted };
  if (s === 'expired') return { label: text('Expired'), className: STATE_CHIP.muted };
  return { label: text('Held'), className: STATE_CHIP.muted };
}

const pathWords = (p: string | null) => (p === 'gateway' ? text('Gateway') : p === 'post' ? text('Account sync') : p === 'outbound' ? text('Outgoing') : '—');

export function AdminQuarantine() {
  const [q, setQ] = useState('');
  const [verdict, setVerdict] = useState('');
  const [state, setState] = useState<QuarantineState | ''>('');
  const [path, setPath] = useState('');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const perms = useAdminPerms();
  const filters: Record<string, string> = Object.fromEntries(Object.entries({ q: q.trim(), verdict, state, path, page: String(page) }).filter(([, v]) => v));
  const list = useAdminQuarantine(filters);
  const items = list.data?.items ?? [];
  const current = items.find((i) => i.id === picked) ?? items[0] ?? null;
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / Math.max(1, items.length || 25)));
  const exportCsv = () =>
    void saveRowsCsv(
      [['received', 'recipient', 'sender', 'subject', 'verdict', 'score', 'path', 'state', 'expires'], ...items.map((i) => [i.received_at, i.recipient, i.sender, i.subject, i.verdict, i.score, i.path, i.state, i.expires_at])],
      'WorkSuite quarantine',
    ).catch((e) => toast('error', errorMessage(e)));
  return (
    <div className="flex flex-col gap-3.5">
      <ProtTop
        tab="quarantine"
        held={list.data?.counts.held ?? null}
        actions={
          <>
            <Button disabled={!items.length} onClick={exportCsv}>{text('Export')}</Button>
            <Button variant="primary" disabled={!perms.purge} title={perms.purge ? undefined : text('Needs the Search and remove permission.')} onClick={() => setRemoving(true)}>
              {text('Search and remove…')}
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-3.5 2xl:flex-row 2xl:items-start">
        <section aria-label={text('Held mail')} className="flex min-w-0 flex-1 flex-col rounded-[12px] border border-line bg-surface">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <input type="search" aria-label={text('Search quarantine')} placeholder={text('Search sender, recipient, subject, Message-ID…')} value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="h-8 min-w-[220px] flex-1 rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] text-ink" />
            <Select aria-label={text('Verdict')} value={verdict} options={[{ value: '', label: text('All verdicts') }, ...VERDICTS.filter((v) => v !== 'CHECKING' && v !== 'CLEAN').map((v) => ({ value: v, label: verdictLabel(v) }))]} onValueChange={(v) => (setVerdict(String(v)), setPage(1))} className="h-8 w-[150px]" />
            <Select aria-label={text('State')} value={state} options={STATES.map(([v, l]) => ({ value: v, label: text(l) }))} onValueChange={(v) => (setState(v as QuarantineState | ''), setPage(1))} className="h-8 w-[170px]" />
            <Select aria-label={text('Path')} value={path} options={[{ value: '', label: text('Any path') }, { value: 'gateway', label: text('Gateway') }, { value: 'post', label: text('Account sync') }, { value: 'outbound', label: text('Outgoing') }]} onValueChange={(v) => (setPath(String(v)), setPage(1))} className="h-8 w-[140px]" />
          </div>
          {list.isLoading ? <Spinner /> : list.error ? <div className="p-3"><ErrorNote error={list.error} onRetry={() => void list.refetch()} /></div> : (
            <div role="table" aria-label={text('Held mail')} className="flex flex-col text-[12.5px]">
              <div role="row" className="grid grid-cols-[80px_120px_minmax(0,1fr)_110px_100px_130px] gap-2 px-3 py-2 text-[11.5px] font-semibold text-ink-3">
                {['Received', 'Recipient', 'Sender and subject', 'Verdict', 'Path', 'State'].map((h) => <span key={h} role="columnheader">{text(h)}</span>)}
              </div>
              {items.length === 0 ? <p className="px-3 py-4 text-ink-3">{text('Nothing matches.')}</p> : null}
              {items.map((i) => {
                const st = stateChip(i.state);
                const on = current?.id === i.id;
                return (
                  <div key={i.id} role="row" aria-selected={on} tabIndex={0} onClick={() => setPicked(i.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ' ? (e.preventDefault(), setPicked(i.id)) : undefined)} className={cx('grid cursor-pointer grid-cols-[80px_120px_minmax(0,1fr)_110px_100px_130px] items-center gap-2 border-t border-line px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-primary', on ? 'bg-selection' : 'hover:bg-subtle')}>
                    <span role="cell" className="text-ink-3">{timeLabel(i.received_at)}<br />{dateLabel(i.received_at)}</span>
                    <span role="cell" className="truncate text-ink">{i.recipient}</span>
                    <span role="cell" className="flex min-w-0 flex-col">
                      <b className="truncate text-ink">{i.sender_name || i.sender}</b>
                      <span className="truncate text-ink-2">{i.subject || text('(no subject)')}</span>
                    </span>
                    <span role="cell"><VerdictChip verdict={i.verdict} /></span>
                    <span role="cell" className="text-ink-2">{pathWords(i.path)}</span>
                    <span role="cell"><span className={cx('inline-flex h-[22px] items-center rounded-full px-[9px] text-[11.5px] font-bold whitespace-nowrap', st.className)}>{st.label}</span></span>
                  </div>
                );
              })}
              <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-[12px] text-ink-3">
                <span className="flex-1">{text('{held} held · {requested} requests', { held: list.data?.counts.held ?? 0, requested: list.data?.counts.requested ?? 0 })}</span>
                <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={text('Previous page')}>‹</Button>
                <span>{text('Page {n} of {m}', { n: page, m: pages })}</span>
                <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label={text('Next page')}>›</Button>
              </div>
            </div>
          )}
        </section>
        {current ? <AdminQuarantineSide key={current.id} item={current} /> : null}
      </div>
      {removing ? <SearchRemoveDialog onClose={() => setRemoving(false)} /> : null}
    </div>
  );
}

/** The selected item: request, reasons, checks, headers, content with a reason, and the decisions. */
export function AdminQuarantineSide({ item }: { item: AdminQuarantineItem }) {
  const qc = useQueryClient();
  const perms = useAdminPerms();
  const detail = useAdminQuarantineItem(item.id);
  const [busy, setBusy] = useState<string | null>(null);
  const [headers, setHeaders] = useState(false);
  const [content, setContent] = useState<'ask' | { html: string | null; text: string | null } | null>(null);
  const [deciding, setDeciding] = useState<'approve' | 'deny' | null>(null);
  const malware = item.verdict === 'MALWARE';
  const refresh = () => void qc.invalidateQueries({ queryKey: adminKeys.all });
  const act = async (what: 'release' | 'delete') => {
    setBusy(what);
    try {
      if (what === 'release') await adminRelease(item.id);
      else await adminDelete(item.id);
      toast('success', what === 'release' ? text('Released to {who}.', { who: item.recipient }) : text('Deleted.'));
      refresh();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const st = stateChip(item.state);
  const open = item.state === 'held' || item.state === 'requested';
  const requested = item.state === 'requested' || item.request?.state === 'pending';
  const noRelease = perms.release ? undefined : text('Needs the Release quarantined mail permission.');
  const reasons = detail.data?.reasons ?? item.reasons;
  const auth = reasons.filter((r) => /^(spf|dkim|dmarc|arc)/i.test(r.code));
  const why = reasons.filter((r) => !/^(spf|dkim|dmarc|arc)/i.test(r.code));
  return (
    <aside aria-label={text('Selected item')} className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4 text-[12.5px] 2xl:w-[400px] 2xl:shrink-0">
      <div className="flex flex-wrap items-center gap-2">
        <VerdictChip verdict={item.verdict} />
        <span className={cx('inline-flex h-[22px] items-center rounded-full px-[9px] text-[11.5px] font-bold', st.className)}>{st.label}</span>
        <span className="flex-1" />
        {item.score !== null ? <span className="text-ink-3">{text('score {n}', { n: item.score.toFixed(1) })}</span> : null}
      </div>
      <div className="flex flex-col gap-1">
        <b className="text-[15px] text-ink selectable">{item.subject || text('(no subject)')}</b>
        <span className="text-ink-2">
          {text('From')} <b className="text-ink">{item.sender_name || item.sender}</b> &lt;{item.sender}&gt;
          <br />
          {text('To {who}', { who: (item.recipients?.length ? item.recipients : [item.recipient]).join(', ') })} · {pathWords(item.path)} · {`${dateLabel(item.received_at)} ${timeLabel(item.received_at)}`}
          {item.policy ? <><br />{text('Policy {name} v{v}', { name: item.policy.name, v: item.policy.version })}</> : null}
        </span>
      </div>
      {item.request ? (
        <div className="flex flex-col gap-1 rounded-[10px] bg-warning-bg px-3 py-2.5 text-warning-strong">
          <b>{text('Release request')}</b>
          {item.request.note ? <span>“{item.request.note}”</span> : <span>{text('No note.')}</span>}
          {item.request.decided_at ? <span>{text('Decided {date}: {note}', { date: dateLabel(item.request.decided_at), note: item.request.decision_note ?? item.request.state })}</span> : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <b className="text-ink">{text('Why it was held')}</b>
        {why.length ? why.map((r) => (
          <p key={r.code} className="flex gap-2 leading-[1.4] text-ink">
            <span aria-hidden className="mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full bg-red" />
            {r.text}
          </p>
        )) : <p className="text-ink-3">{text('No details were recorded.')}</p>}
        {detail.data?.verdict_detail.av ? <p className="text-ink-2">{text('Antivirus: {threat} ({engine}, signatures {v})', { threat: detail.data.verdict_detail.av.threat, engine: detail.data.verdict_detail.av.engine, v: detail.data.verdict_detail.av.signature_version })}</p> : null}
      </div>
      {auth.length ? (
        <div className="flex flex-wrap gap-1.5">
          {auth.map((r) => <span key={r.code} title={r.text} className={cx('inline-flex h-[22px] items-center rounded-full px-[9px] text-[11.5px] font-bold', /fail|none/i.test(r.code + r.text) ? STATE_CHIP.muted : STATE_CHIP.ok)}>{r.text}</span>)}
        </div>
      ) : null}
      {item.attachments.length ? (
        <div className="flex flex-col gap-1">
          <b className="text-ink">{text('Attachments')}</b>
          {item.attachments.map((a) => (
            <span key={a.name} className="flex items-center gap-2">
              <span className="flex-1 truncate">{a.name}</span>
              {a.blocked ? <span className={cx('rounded-full px-2 text-[11px] font-bold', STATE_CHIP.bad)}>{text('Blocked')}</span> : <span className={cx('rounded-full px-2 text-[11px] font-bold', STATE_CHIP.ok)}>{text('Scanned')}</span>}
            </span>
          ))}
        </div>
      ) : null}
      {open ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
          {malware ? (
            <span data-no-release className="flex-1 text-[12px] font-semibold text-danger">{text('Malware can’t be released by anyone.')}</span>
          ) : requested ? (
            <>
              <Button disabled={!perms.release || !!busy} title={noRelease} onClick={() => setDeciding('deny')}>{text('Deny request')}</Button>
              <Button variant="primary" disabled={!perms.release || !!busy} title={noRelease} onClick={() => setDeciding('approve')}>{text('Approve and release')}</Button>
            </>
          ) : (
            <Button variant="primary" loading={busy === 'release'} disabled={!perms.release || !!busy} title={noRelease} onClick={() => void act('release')}>{text('Release')}</Button>
          )}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!perms.content} title={perms.content ? undefined : text('Needs the View quarantined content permission.')} onClick={() => setContent('ask')}>{text('View content…')}</Button>
        <Button size="sm" aria-pressed={headers} disabled={!item.headers_available} onClick={() => setHeaders(!headers)}>{text('Headers')}</Button>
        {open ? <Button size="sm" variant="ghost" className="text-danger" loading={busy === 'delete'} disabled={!perms.release || !!busy} onClick={() => void act('delete')}>{text('Delete')}</Button> : null}
      </div>
      <span className="text-[11.5px] text-ink-3">{text('Viewing content asks for a reason and is recorded in the audit log.')}</span>
      {headers ? (detail.isLoading ? <Spinner /> : <pre aria-label={text('Headers')} className="max-h-[240px] overflow-auto rounded-[8px] bg-subtle p-2 font-mono text-[11px] whitespace-pre-wrap text-ink selectable">{detail.data?.headers ?? ''}</pre>) : null}
      {content === 'ask' ? <ContentReason id={item.id} onShown={setContent} onClose={() => setContent(null)} /> : content ? (
        <Modal title={text('Quarantined content')} labelledBy="q-content" width={720} onClose={() => setContent(null)} footer={<Button onClick={() => setContent(null)}>{text('Close')}</Button>}>
          <pre className="max-h-[60vh] overflow-auto p-4 text-[12.5px] whitespace-pre-wrap text-ink selectable">{content.text ?? text('This message has no plain text. Its HTML is not shown here: pictures and links stay off.')}</pre>
        </Modal>
      ) : null}
      {deciding ? <DecideDialog id={item.id} decision={deciding} onDone={refresh} onClose={() => setDeciding(null)} /> : null}
    </aside>
  );
}

function ContentReason({ id, onShown, onClose }: { id: number; onShown: (c: { html: string | null; text: string | null }) => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      onShown(await viewQuarantinedContent(id, reason.trim()));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={text('View content')} labelledBy="q-reason" width={440} onClose={busy ? undefined : onClose} footer={<><Button onClick={onClose} disabled={busy}>{text('Cancel')}</Button><Button variant="primary" loading={busy} disabled={reason.trim().length < 3} onClick={() => void go()}>{text('View')}</Button></>}>
      <div className="flex flex-col gap-2 p-4 text-[13px] text-ink">
        <p>{text('Opening someone’s held mail is recorded in the audit log with your reason.')}</p>
        <label htmlFor="q-reason-input" className="text-[12.5px] font-semibold text-ink-2">{text('Reason')}</label>
        <input id="q-reason-input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className="h-8 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink" />
      </div>
    </Modal>
  );
}

function DecideDialog({ id, decision, onDone, onClose }: { id: number; decision: 'approve' | 'deny'; onDone: () => void; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await decideRequest(id, decision, note);
      toast('success', decision === 'approve' ? text('Approved and released. The person is told.') : text('Request denied. The person is told; the message stays held until it expires.'));
      onDone();
      onClose();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={decision === 'approve' ? text('Approve and release') : text('Deny request')} labelledBy="q-decide" width={440} onClose={busy ? undefined : onClose} footer={<><Button onClick={onClose} disabled={busy}>{text('Cancel')}</Button><Button variant={decision === 'approve' ? 'primary' : 'danger'} loading={busy} onClick={() => void go()}>{decision === 'approve' ? text('Approve and release') : text('Deny request')}</Button></>}>
      <div className="flex flex-col gap-2 p-4 text-[13px] text-ink">
        <label htmlFor="q-decide-note" className="text-[12.5px] font-semibold text-ink-2">{text('Note to the person (optional)')}</label>
        <textarea id="q-decide-note" rows={3} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[13px] text-ink" />
      </div>
    </Modal>
  );
}
