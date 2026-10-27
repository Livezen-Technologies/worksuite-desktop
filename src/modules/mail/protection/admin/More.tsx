import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { addDays, dateLabel, todayInZone } from '../../../../core/time';
import { toast } from '../../../../core/toasts';
import { Icon } from '../../../../components/Icon';
import { Button, ErrorNote, NumberField, Spinner, Switch, cx } from '../../../../components/ui';
import { ADMIN, adminKeys, saveAttachmentRules, saveServerCsv, useAttachmentRules, useReports } from './api';
import { Card, NO_MANAGE, ProtTop, Segmented, num, useAdminPerms } from './parts';
import type { AttachmentRules, AttachmentsAnswer } from '../types';

/**
 * Admin Center › Protection › Attachments (P-UI-05) and Reports (P-UI-07), in the language of D21–D25: the default
 * policy's attachment rules — blocked types, double extensions, archive depth, encrypted archives, macros, scan size,
 * HTML smuggling — and the reports: trends, false-positive and missed-spam rates per policy, malware by threat, CSV.
 */

export function AttachmentsTab() {
  const q = useAttachmentRules();
  return (
    <div className="flex flex-col gap-3.5">
      <ProtTop tab="attachments" />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : q.data ? <AttachmentForm key={JSON.stringify(q.data)} saved={q.data} /> : null}
    </div>
  );
}

function AttachmentForm({ saved }: { saved: AttachmentsAnswer }) {
  const qc = useQueryClient();
  const perms = useAdminPerms();
  const { types_catalogue: catalogue, ...rules } = saved;
  const [draft, setDraft] = useState<AttachmentRules>(rules);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const changed = JSON.stringify(draft) !== JSON.stringify(rules);
  const set = (patch: Partial<AttachmentRules>) => setDraft((d) => ({ ...d, ...patch }));
  const groups = [...new Set(catalogue.map((c) => c.group))];
  const toggleType = (ext: string) => set({ blocked_types: draft.blocked_types.includes(ext) ? draft.blocked_types.filter((x) => x !== ext) : [...draft.blocked_types, ext] });
  const save = async () => {
    setBusy(true);
    try {
      await saveAttachmentRules(draft);
      toast('success', text('Attachment rules saved. They apply on every path.'));
      void qc.invalidateQueries({ queryKey: adminKeys.attachments });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const ext = adding.trim().toLowerCase().replace(/^\./, '');
  const disabled = !perms.manage;
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-3">
      <Card title={text('Blocked file types')} extra={<span className="text-[12px] text-ink-3">{text('{n} blocked', { n: draft.blocked_types.length })}</span>}>
        {groups.map((g) => (
          <div key={g} className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-bold tracking-[.5px] text-ink-3 uppercase">{g}</span>
            <div className="flex flex-wrap gap-1.5">
              {catalogue.filter((c) => c.group === g).map((c) => {
                const on = draft.blocked_types.includes(c.ext);
                return (
                  <button key={c.ext} type="button" aria-pressed={on} onClick={() => toggleType(c.ext)} className={cx('inline-flex h-[26px] items-center gap-1 rounded-full border px-2.5 font-mono text-[12px] font-semibold', on ? 'border-danger-line bg-danger-bg text-danger dark:text-danger-ink' : 'border-line text-ink-2 hover:bg-subtle')}>
                    {on ? <Icon name="lock" size={11} /> : null}.{c.ext}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^[a-z0-9]{1,10}$/.test(ext) && !draft.blocked_types.includes(ext)) set({ blocked_types: [...draft.blocked_types, ext] });
            setAdding('');
          }}
        >
          <input aria-label={text('Add a file type')} placeholder={text('e.g. iso')} value={adding} onChange={(e) => setAdding(e.target.value)} className="h-8 w-[160px] rounded-[8px] border border-line bg-surface px-2.5 text-[12.5px] text-ink" />
          <Button type="submit" disabled={!/^[a-z0-9]{1,10}$/.test(ext)}>{text('Block type')}</Button>
        </form>
      </Card>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card title={text('Archives and documents')}>
          <Row label={text('Block double extensions')} hint={text('invoice.pdf.exe is blocked as a program')}>
            <Switch checked={draft.double_extensions} onChange={(v) => set({ double_extensions: v })} disabled={disabled} label={text('Block double extensions')} />
          </Row>
          <Row label={text('Look inside archives')} hint={text('Levels of archives inside archives')}>
            <NumberField size="sm" width={64} min={1} max={10} value={String(draft.archive_depth)} onValueChange={(v) => set({ archive_depth: Math.min(10, Math.max(1, Number(v) || 1)) })} aria-label={text('Look inside archives')} />
          </Row>
          <Row label={text('Password-protected archives')} hint={text('They cannot be scanned')}>
            <Segmented label={text('Password-protected archives')} value={draft.encrypted} options={[['deliver_locked', text('Deliver locked, with a warning')], ['quarantine', text('Quarantine')]]} onChange={(v) => !disabled && set({ encrypted: v })} />
          </Row>
          <Row label={text('Office files with macros')}>
            <Segmented label={text('Office files with macros')} value={draft.macros} options={[['tag', text('Deliver, open protected')], ['quarantine', text('Quarantine')]]} onChange={(v) => !disabled && set({ macros: v })} />
          </Row>
        </Card>
        <Card title={text('Scanning')}>
          <Row label={text('Largest file scanned (MB)')} hint={text('A bigger file is “Not scanned” and stays locked — never shown as scanned')}>
            <NumberField size="sm" width={72} min={1} max={500} value={String(draft.max_scan_mb)} onValueChange={(v) => set({ max_scan_mb: Math.max(1, Number(v) || 1) })} aria-label={text('Largest file scanned (MB)')} />
          </Row>
          <Row label={text('Detect HTML smuggling')} hint={text('Web pages that build a file in the browser')}>
            <Switch checked={draft.html_smuggling} onChange={(v) => set({ html_smuggling: v })} disabled={disabled} label={text('Detect HTML smuggling')} />
          </Row>
          <Row label={text('Strip blocked files and add a notice')} hint={text('Otherwise the whole message is held')}>
            <Switch checked={draft.strip_and_notice} onChange={(v) => set({ strip_and_notice: v })} disabled={disabled} label={text('Strip blocked files and add a notice')} />
          </Row>
        </Card>
      </div>
      <div className="flex justify-end gap-2">
        <Button disabled={!changed || busy} onClick={() => setDraft(rules)}>{text('Discard')}</Button>
        <Button variant="primary" loading={busy} disabled={!changed || disabled} title={disabled ? text(NO_MANAGE) : undefined} onClick={() => void save()}>{text('Save')}</Button>
      </div>
    </fieldset>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-t border-line pt-2 first-of-type:border-t-0">
      <span className="flex flex-1 flex-col">
        <span className="text-[12.5px] font-semibold text-ink">{label}</span>
        {hint ? <span className="text-[11.5px] text-ink-3">{hint}</span> : null}
      </span>
      {children}
    </div>
  );
}

const pctWords = (r: number) => `${(r * 100).toFixed(2)}%`;

export function ReportsTab() {
  const today = todayInZone();
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const from = addDays(today, -Number(days));
  const q = useReports(from, today, '');
  const exportCsv = () => void saveServerCsv(`${ADMIN}/reports`, { from, to: today, format: 'csv' }, `WorkSuite mail protection ${from} to ${today}`).catch((e) => toast('error', errorMessage(e)));
  return (
    <div className="flex flex-col gap-3.5">
      <ProtTop
        tab="reports"
        actions={
          <>
            <Segmented label={text('Period')} value={days} options={[['7', text('7 days')], ['30', text('30 days')], ['90', text('90 days')]]} onChange={setDays} />
            <Button icon="download" onClick={exportCsv}>{text('Export CSV')}</Button>
          </>
        }
      />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : q.data ? (
        <>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.4fr_1fr]">
            <Card title={text('False positives and missed spam, by policy')}>
              <p className="text-[12px] text-ink-3">{text('False positives: legitimate mail marked Not junk or released. Missed spam: mail people marked Junk. The target on Standard is 0.1% or less.')}</p>
              <div role="table" className="flex flex-col text-[12.5px]">
                <div role="row" className="grid grid-cols-[1fr_120px_120px] gap-2 py-1 text-[11.5px] font-semibold text-ink-3">
                  <span role="columnheader">{text('Policy')}</span>
                  <span role="columnheader" className="text-right">{text('False positives')}</span>
                  <span role="columnheader" className="text-right">{text('Missed spam')}</span>
                </div>
                {q.data.rates.map((r) => (
                  <div key={r.policy} role="row" className="grid grid-cols-[1fr_120px_120px] gap-2 border-t border-line py-1.5">
                    <b role="cell" className="text-ink">{r.policy}</b>
                    <span role="cell" className={cx('text-right tabular-nums', r.fp_rate > 0.001 ? 'font-bold text-danger' : 'text-ink')}>{pctWords(r.fp_rate)}</span>
                    <span role="cell" className="text-right text-ink tabular-nums">{pctWords(r.missed_rate)}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card title={text('Malware by threat')}>
              {q.data.by_threat.length === 0 ? <p className="text-[12.5px] text-ink-3">{text('No malware in this period.')}</p> : null}
              {q.data.by_threat.map((t) => (
                <div key={t.threat} className="flex items-center gap-2 text-[12.5px]">
                  <span className="flex-1 truncate font-mono text-ink">{t.threat}</span>
                  <b className="text-ink tabular-nums">{num(t.count)}</b>
                </div>
              ))}
            </Card>
          </div>
          <Card title={text('By day and policy')}>
            <div role="table" className="flex flex-col overflow-x-auto text-[12px]">
              <div role="row" className="grid min-w-[860px] grid-cols-[100px_1fr_repeat(8,80px)] gap-2 py-1 font-semibold text-ink-3">
                {['Day', 'Policy', 'Scanned', 'Delivered', 'Junk', 'Quarantined', 'Refused', 'Released', 'Not junk', 'Missed'].map((h) => <span key={h} role="columnheader" className={h === 'Day' || h === 'Policy' ? '' : 'text-right'}>{text(h)}</span>)}
              </div>
              {q.data.rows.map((r, i) => (
                <div key={`${r.date}-${r.policy}-${i}`} role="row" className="grid min-w-[860px] grid-cols-[100px_1fr_repeat(8,80px)] gap-2 border-t border-line py-1 text-ink">
                  <span role="cell">{dateLabel(r.date)}</span>
                  <span role="cell">{r.policy}</span>
                  {[r.scanned, r.delivered, r.junk, r.quarantined, r.rejected, r.released, r.fp_reports, r.missed_spam].map((n, j) => <span key={j} role="cell" className="text-right tabular-nums">{num(n)}</span>)}
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
