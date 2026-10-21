import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { call, errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Button } from '../../components/ui';
import type { BoardVaultStatus } from '@shared/board';
import { fmtDate, K, type MeetingRow } from './api';
import { Muted, Panel, Status } from './parts';

const mb = (b: number) => `${Math.max(1, Math.round(b / 1_048_576))} MB`;

/** D-05 Board packs — offline: the encrypted vault on this computer (FR-OFF-01..03, FR-DEV-02). */
export default function Packs({ status, meetings, onOpen }: { status: BoardVaultStatus | null; meetings: MeetingRow[]; onOpen: (meetingId: number) => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<number | null>(null);
  const [opened] = useState(() => Date.now());
  const refresh = () => void qc.invalidateQueries({ queryKey: K.vault });
  const download = async (id: number) => {
    setBusy(id);
    try {
      await call('board:packDownload', { meetingId: id });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };
  const remove = useMutation({ mutationFn: (id: number) => call('board:packRemove', { meetingId: id }), onSuccess: refresh, onError: (e) => toast('error', errorMessage(e)) });
  const sync = useMutation({ mutationFn: () => call('board:sync'), onSuccess: refresh, onError: (e) => toast('error', errorMessage(e)) });
  const kept = status?.packs ?? [];
  const keptIds = new Set(kept.map((p) => p.meetingId));
  const upcoming = meetings.filter((m) => !keptIds.has(m.id) && Date.parse(m.starts_at) > opened - 86_400_000);
  const blocked = status?.trust === 'revoked' || status?.trust === 'blocked';
  const total = kept.reduce((n, p) => n + p.bytes, 0);

  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h1 className="text-[18px] font-bold">Board packs</h1>
          <p className="text-[12px] text-ink-3">On this computer · encrypted vault · {mb(total)}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" loading={sync.isPending} onClick={() => sync.mutate()}>Sync now</Button>
          <Button size="sm" disabled={blocked || !upcoming.some((m) => m.pack?.current_version) || busy !== null} onClick={async () => { for (const m of upcoming.filter((x) => x.pack?.current_version)) await download(m.id); }}>Download all upcoming</Button>
        </div>
      </div>
      {status?.wiped ? <div role="alert" className="mb-3 rounded-[8px] bg-danger/10 p-3 text-[13px] text-danger">Board packs on this computer were erased: {status.wiped.reason} Your own files were not touched.</div> : null}
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_300px] gap-3">
        <Panel title="Packs">
          <ul aria-label="Packs" className="divide-y divide-line">
            {kept.map((p) => (
              <li key={p.meetingId} className={`flex items-center gap-3 py-3 ${p.latestVersion ? 'bg-warning/5' : ''}`}>
                <span className="flex h-[38px] w-[38px] flex-col items-center justify-center rounded-[6px] bg-subtle text-[9px] font-bold text-primary">PACK<span>v{p.version}</span></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold">{p.title}{p.latestVersion ? ` · v${p.latestVersion} available` : ''}</div>
                  <div className="text-[11.5px] text-ink-3">{[p.pages ? `${p.pages} pages` : null, `my notes ${p.notes}`, mb(p.bytes)].filter(Boolean).join(' · ')}</div>
                </div>
                {p.latestVersion ? <><Status tone="warning">Update ready</Status><Button size="sm" variant="primary" disabled={busy !== null} onClick={() => void download(p.meetingId)}>Update</Button></>
                  : <><Status tone="success">Offline · until {fmtDate(p.expiresAt)}</Status><Button size="sm" onClick={() => onOpen(p.meetingId)}>Open</Button></>}
                <Button size="sm" variant="ghost" aria-label={`Remove ${p.title}`} onClick={() => remove.mutate(p.meetingId)}>Remove</Button>
              </li>
            ))}
            {upcoming.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-3">
                <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[6px] bg-subtle text-[9px] font-bold text-ink-3">PACK</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold">{m.title}</div>
                  <div className="text-[11.5px] text-ink-3">{fmtDate(m.starts_at)}{!m.pack?.current_version ? ' · pack not yet published' : ''}</div>
                </div>
                {busy === m.id ? <Status tone="indigo">Downloading</Status> : !m.pack?.current_version ? <Status>Not published</Status> : <Button size="sm" disabled={blocked || busy !== null} onClick={() => void download(m.id)}>Download</Button>}
              </li>
            ))}
            {!kept.length && !upcoming.length ? <li className="py-3"><Muted>No packs yet. Use “Download for offline” on a meeting's agenda.</Muted></li> : null}
          </ul>
        </Panel>
        <div className="flex flex-col gap-3">
          <Panel title="Offline protection">
            <ul className="space-y-1.5 text-[12.5px]">
              <li>✓ Encrypted with a key held in this computer's secure store{status && !status.keystore ? ' — no keyring here, so packs last until you quit' : ''}</li>
              <li>✓ Removed after expiry or when the meeting is archived</li>
              <li>✓ Erased if an administrator revokes or blocks this device</li>
              <li>✓ Notes and acknowledgements sync when you reconnect{status?.queued ? ` (${status.queued} waiting)` : ''}</li>
            </ul>
            <Muted>Votes and signatures need a connection.</Muted>
          </Panel>
          <Panel title="This device">
            <div className="text-[12.5px]">{blocked ? <Status tone="danger">{status?.trust === 'blocked' ? 'Blocked' : 'Revoked'}</Status> : status?.trust === 'trusted' ? <Status tone="success">Trusted</Status> : status?.trust === 'pending' ? <Status tone="warning">Waiting for an administrator's approval</Status> : <Status>Not registered yet</Status>}</div>
            <Muted>{status?.lastSyncAt ? `Synced ${fmtDate(status.lastSyncAt)} ${new Date(status.lastSyncAt).toLocaleTimeString()}` : 'Not synced yet'} · {status?.backend ?? ''}</Muted>
          </Panel>
        </div>
      </div>
    </div>
  );
}
