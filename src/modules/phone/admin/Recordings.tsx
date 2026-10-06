import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTab } from '../../../core/tab-context';
import { useNow } from '../../../core/use-now';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, cx, Empty, Modal, Spinner } from '../../../components/ui';
import { phoneApi, useIntelligenceStatus, useRecordings, type IngestResult, type Recording } from '../api';
import { usePhoneAccess } from '../access';
import { bytes, clock, parseStamp, prettyNumber, stamp } from '../lib/format';
import { Mono, PageBody, PageHeader, Panel, Pills, Refused, TD, TR, Table } from '../parts';
import { Player } from '../screens/Player';

/**
 * A11 · Recordings & intelligence (VOIP-REC-01…05, VOIP-AI-01/02, VOIP-DEP-02). Recordings live in Drive ›
 * Telephony, encrypted, and are deleted when their retention date passes; every play is logged. Calls, voicemail and
 * recordings not linked to a call (G-04); import from the switch, retention (a dry run first, always), and the call
 * intelligence panel that says plainly why it is unavailable.
 */
type Tab = 'call' | 'voicemail' | 'unlinked';

export default function Recordings() {
  const qc = useQueryClient();
  const access = usePhoneAccess();
  const { go } = useTab();
  const [tab, setTab] = useState<Tab>('call');
  const [page, setPage] = useState(1);
  const [playing, setPlaying] = useState<Recording | null>(null);
  const [lastImport, setLastImport] = useState<{ at: Date; r: IngestResult } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [retention, setRetention] = useState<{ due: number; message: string } | null>(null);
  const q = useRecordings(tab === 'unlinked' ? { kind: 'call', per_page: 100, page } : { kind: tab, per_page: 50, page });
  const ai = useIntelligenceStatus();
  const now = useNow(60_000).getTime();
  const rows = (q.data?.recordings ?? []).filter((r) => tab !== 'unlinked' || r.call_id === null);
  const unlinked = tab === 'call' ? (q.data?.recordings ?? []).filter((r) => r.call_id === null).length : 0;
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / (tab === 'unlinked' ? 100 : 50)));
  const refresh = () => void qc.invalidateQueries({ queryKey: ['phone', 'recordings'] });

  const ingest = async () => {
    setBusy('ingest');
    try {
      const r = await phoneApi.ingest();
      setLastImport({ at: new Date(), r });
      toast(r.failed ? 'info' : 'success', `${r.imported} imported · ${r.skipped} skipped · ${r.failed} could not be read`);
      refresh();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const dryRun = async () => {
    setBusy('retention');
    try {
      const r = await phoneApi.retention(false);
      setRetention({ due: r.due, message: r.message });
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const reallyDelete = async () => {
    setBusy('delete');
    try {
      const r = await phoneApi.retention(true);
      toast('success', r.message);
      setRetention(null);
      refresh();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Recordings"
        actions={
          access.manage ? (
            <>
              <Button icon="download" loading={busy === 'ingest'} onClick={() => void ingest()} title="Moves finished recordings from the switch into Drive › Telephony">
                Import from PBX
              </Button>
              <Button icon="trash" loading={busy === 'retention'} onClick={() => void dryRun()}>
                Run retention (dry run)
              </Button>
            </>
          ) : null
        }
      />
      <PageBody>
        <div className="flex flex-col gap-4">
          <p className="rounded-[10px] border border-line bg-surface px-3.5 py-2 text-[12.5px] text-ink-2">{q.data?.retention_note ?? 'Recordings are stored in Drive › Telephony, encrypted, and deleted when their retention date passes. Every play is logged.'}</p>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <Panel
              title={
                <Pills
                  label="Recordings"
                  value={tab}
                  onChange={(v) => {
                    setTab(v);
                    setPage(1);
                  }}
                  options={[
                    { id: 'call', label: 'Calls' },
                    { id: 'voicemail', label: 'Voicemail' },
                    { id: 'unlinked', label: `Unlinked${unlinked ? ` · ${unlinked}` : ''}` },
                  ]}
                />
              }
              bodyClassName="flex flex-col gap-3"
            >
              {playing ? (
                <div className="rounded-[10px] border border-primary/25 bg-selection p-3">
                  <div className="mb-2 flex items-center justify-between text-[12.5px]">
                    <b>
                      {prettyNumber(playing.from) || 'Recording'} · {stamp(playing.created_at)}
                    </b>
                    <button type="button" aria-label="Close player" onClick={() => setPlaying(null)}>
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                  <Player key={playing.id} recordingId={playing.id} duration={playing.duration} onPlayed={refresh} />
                </div>
              ) : null}
              {q.isLoading ? (
                <Spinner />
              ) : q.error ? (
                <Refused error={q.error} onRetry={() => void q.refetch()} />
              ) : rows.length === 0 ? (
                <Empty icon="mic" title={tab === 'unlinked' ? 'Every recording is linked to its call' : 'No recordings'} hint={tab === 'call' ? 'Calls are recorded by each extension’s policy; recordings arrive once imported from the switch.' : undefined} />
              ) : (
                <Table head={['', 'Call', 'Agent', 'Length', 'Size', 'Recorded', 'Delete after']}>
                  {rows.map((r) => {
                    const soon = r.retain_until ? (parseStamp(`${r.retain_until} 00:00:00`)?.getTime() ?? Infinity) - now < 30 * 86_400_000 : false;
                    return (
                      <tr key={r.id} className={TR}>
                        <td className={TD}>
                          <button type="button" aria-label="Play" onClick={() => setPlaying(r)} className="flex h-7 w-7 items-center justify-center rounded-full bg-selection text-primary hover:bg-primary hover:text-white">
                            <Icon name="play" size={12} />
                          </button>
                        </td>
                        <td className={TD}>
                          {r.call_id ? (
                            <button type="button" className="text-left" onClick={() => go(`/phone/calls/${r.call_id}`)}>
                              <span className="block font-semibold text-ink">{prettyNumber(r.direction === 'outbound' ? r.to : r.from) || 'Unknown'}</span>
                              <span className="block text-[11px] text-ink-3">{[r.direction, r.category].filter(Boolean).join(' · ')}</span>
                            </button>
                          ) : (
                            <span>
                              <span className="block font-semibold text-ink-3">Not linked to a call</span>
                              <span className="block text-[11px] text-ink-3">{r.kind === 'voicemail' ? `from ${prettyNumber(r.from) || 'unknown'}` : 'no matching call (uniqueid)'}</span>
                            </span>
                          )}
                        </td>
                        <td className={TD}>{r.agent ? `${r.agent}${r.extension ? ` (${r.extension})` : ''}` : '—'}</td>
                        <td className={TD}>
                          <Mono>{clock(r.duration)}</Mono>
                        </td>
                        <td className={TD}>{bytes(r.bytes)}</td>
                        <td className={cx(TD, 'whitespace-nowrap')}>{stamp(r.created_at)}</td>
                        <td className={cx(TD, 'whitespace-nowrap', soon && 'font-semibold text-danger')}>{r.retain_until ?? 'Kept'}</td>
                      </tr>
                    );
                  })}
                </Table>
              )}
              {pages > 1 ? (
                <div className="flex justify-end gap-2">
                  <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    Previous
                  </Button>
                  <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                    Next
                  </Button>
                </div>
              ) : null}
            </Panel>
            <div className="flex flex-col gap-4">
              <Panel title="Call intelligence" bodyClassName="flex flex-col gap-2 text-[12.5px]">
                {ai.isLoading ? (
                  <Spinner />
                ) : ai.data?.available ? (
                  <p className="rounded-[8px] bg-success-bg px-2.5 py-1.5 font-semibold text-success">Available · {ai.data.provider}</p>
                ) : (
                  <>
                    <p className="rounded-[8px] bg-danger-bg px-2.5 py-1.5 font-semibold text-danger">Unavailable on this installation</p>
                    <p className="text-ink-2">{ai.data?.reason ?? 'Transcripts, summaries, sentiment and quality scoring need one of:'}</p>
                    <ul className="flex flex-col gap-1 text-ink-2">
                      {(ai.data?.missing?.length ? ai.data.missing : ['An on-server speech engine (whisper or vosk)', 'An AI provider approved for call audio in CoreAIService']).map((m) => (
                        <li key={m} className="flex gap-1.5">
                          <Icon name="x" size={13} className="mt-0.5 shrink-0 text-ink-3" />
                          {m}
                        </li>
                      ))}
                    </ul>
                    <p className="text-[11.5px] text-ink-3">Requests are queued as “unavailable” rather than answered with an invented summary.</p>
                    {access.manage ? (
                      <Button size="sm" onClick={() => go('/phone/settings?tab=recording')}>
                        Configure in Settings
                      </Button>
                    ) : null}
                  </>
                )}
              </Panel>
              <Panel title={lastImport ? `Last import · ${lastImport.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Import from the switch'} bodyClassName="flex flex-col gap-1.5 text-[12.5px]">
                {lastImport ? (
                  <>
                    <p>
                      {lastImport.r.imported} imported · {lastImport.r.skipped} skipped (already filed) · {lastImport.r.failed} could not be read
                    </p>
                    {lastImport.r.detail.length ? (
                      <pre className="max-h-[160px] overflow-auto rounded-[8px] bg-subtle p-2 font-mono text-[11px] whitespace-pre-wrap text-ink-2 scroll-thin">{lastImport.r.detail.slice(0, 40).join('\n')}</pre>
                    ) : null}
                  </>
                ) : (
                  <p className="text-ink-3">The switch writes recordings to its own disk. Import moves finished ones into Drive and links each to its call. With FreePBX on a separate server, recordings are fetched over ARI once the server supports it (G-17).</p>
                )}
              </Panel>
            </div>
          </div>
        </div>
      </PageBody>
      {retention ? (
        <Modal
          title="Retention"
          onClose={() => setRetention(null)}
          footer={
            <>
              <Button onClick={() => setRetention(null)}>Close</Button>
              {retention.due > 0 ? (
                <Button variant="danger" loading={busy === 'delete'} onClick={() => void reallyDelete()}>
                  Delete {retention.due} recording{retention.due === 1 ? '' : 's'}
                </Button>
              ) : null}
            </>
          }
        >
          <p className="text-[13px] text-ink-2">{retention.message}</p>
          {retention.due > 0 ? <p className="mt-2 text-[12.5px] text-danger">Deleting recordings cannot be undone.</p> : null}
        </Modal>
      ) : null}
    </div>
  );
}
