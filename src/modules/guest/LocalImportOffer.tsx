import { useEffect, useState } from 'react';
import type { ImportReview } from '@shared/local-workspace';
import { app } from '../../core/app-state';
import { useStore } from '../../core/store';
import { call, errorMessage } from '../../core/bridge';
import { Button, Modal } from '../../components/ui';
export function LocalImportOffer() {
  const identity = useStore(app, (s) => `${s.auth?.user?.id}:${s.auth?.server?.origin}:${s.organizationId}`);
  const [count, setCount] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [review, setReview] = useState<ImportReview | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [copies, setCopies] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    void call('local:importOffer').then((offer) => { if (active) setCount(offer.count); }, () => undefined);
    return () => { active = false; };
  }, [identity]);
  const preview = async () => {
    setBusy(true); setMessage('');
    try {
      const next = await call('local:reviewImport'); setReview(next); setSelection(next.rows.filter((row) => !row.duplicate && !row.alreadyImported).map((row) => row.item.id)); setCopies(false);
    } catch (e) { setMessage(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const upload = async () => {
    if (!review) return;
    setBusy(true);
    try {
      const result = await call('local:import', { token: review.token, ids: selection, createCopies: copies });
      setMessage(`Imported ${result.imported}; skipped ${result.skipped}. Local originals remain on this device.${result.failures.map((failure) => ` ${failure.title}: ${failure.message}`).join('')}`);
      setSelection([]);
    } catch (e) { setMessage(errorMessage(e)); }
    finally { setBusy(false); }
  };
  if (!count || dismissed === identity) return null;
  return <>
    <aside className="fixed right-4 bottom-4 z-40 max-w-sm rounded border border-line bg-surface p-4 text-ink shadow-lg">
      <p>{count} guest items are saved on this device. Import into this account only after review. Nothing uploads automatically.</p>
      {message && !review ? <p role="alert">{message}</p> : null}
      <div className="mt-2 flex gap-2"><Button size="sm" loading={busy} onClick={() => void preview()}>Review local import</Button><Button size="sm" variant="ghost" onClick={() => setDismissed(identity)}>Not now</Button><Button size="sm" variant="ghost" onClick={() => void call('local:open')}>Open local data</Button></div>
    </aside>
    {review ? <Modal title="Review local data import" onClose={() => { if (!busy) setReview(null); }} width={700} footer={<><Button disabled={busy} onClick={() => setReview(null)}>Close</Button><Button variant="primary" loading={busy} disabled={!selection.length} onClick={() => void upload()}>Import selected items</Button></>}>
      <p className="font-semibold">Destination: {review.account} · {review.organization}</p>
      <p className="mt-2 text-ink-2">Select what to upload. Potential duplicates match an existing title or an account list was too large to fully check. They are skipped unless you explicitly allow copies. Previously imported identical content is always skipped. Originals stay on the device; nothing merges into an existing record.</p>
      <label className="my-3 flex gap-2"><input type="checkbox" checked={copies} onChange={(e) => setCopies(e.target.checked)} />Allow new copies of potential duplicates</label>
      {review.rows.map((row) => <label key={row.item.id} className="flex items-start gap-2 border-b border-line py-2"><input type="checkbox" disabled={busy || row.alreadyImported || (row.duplicate && !copies)} checked={selection.includes(row.item.id)} onChange={(e) => setSelection((ids) => e.target.checked ? [...ids, row.item.id] : ids.filter((id) => id !== row.item.id))} /><span><b>{row.item.title}</b> · {row.item.kind}{row.alreadyImported ? ' · Already imported' : row.duplicate ? ' · Potential duplicate' : ''}<p className="whitespace-pre-wrap text-ink-3">{row.item.body.slice(0, 180)}</p>{row.item.start || row.item.due ? <p>{new Date((row.item.start ?? row.item.due)!).toLocaleString()}</p> : null}</span></label>)}
      {message ? <p className="mt-3" role="status">{message}</p> : null}
    </Modal> : null}
  </>;
}
