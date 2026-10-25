import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../core/bridge';
import { useScannerSeen, useWedge } from '../../core/scanner';
import { cx } from '../../components/ui';
import { refusal } from '../finance/api';
import { checkin, checkout, fetchPeople, issueAsset, resolveCode, returnAsset, type Asset, type Can, type Person } from './api';
import { labelPrefs, printLabels } from './labels';
import { Badge, Btn, Card, Field, Kbd, Note, PageHead, input, useReadOnly } from './parts';

/**
 * The scan station (D02, T-11): Issue, Return, Loan out / in and Look up, driven by a keyboard-wedge barcode or QR
 * scanner (or a code typed and Enter). Scan the asset, then — to issue or lend — the person's ID card (their employee
 * number) or pick them; Enter does it. Every act is the server's: a refusal (another company's asset, one still held)
 * is logged as the server said it. Offline nothing is done.
 */
export type Mode = 'issue' | 'return' | 'loan' | 'lookup';
export interface LogLine {
  at: string;
  kind: 'issued' | 'returned' | 'looked' | 'refused' | 'checked_out';
  text: string;
}

const MODES: Array<[Mode, string]> = [['issue', 'Issue'], ['return', 'Return'], ['loan', 'Loan out / in'], ['lookup', 'Look up']];
const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000);
  return `${d.toISOString().slice(0, 10)}T18:00`;
};
const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** What Enter does for this asset in this mode — null when there is nothing to do yet (and why). */
export function nextAct(mode: Mode, a: Asset | null, person: Person | null): { act: 'issue' | 'return' | 'checkout' | 'checkin' | 'none'; why?: string } {
  if (!a) return { act: 'none', why: 'Scan an asset.' };
  if (mode === 'lookup') return { act: 'none' };
  if (mode === 'return') return a.status === 'assigned' || a.status === 'checked_out' ? { act: 'return' } : { act: 'none', why: `${a.asset_code} is not out — it is ${a.status}.` };
  if (mode === 'loan' && (a.status === 'checked_out' || a.status === 'assigned')) return { act: 'checkin' };
  if (a.status !== 'available') return { act: 'none', why: `${a.asset_code} is ${a.status}, not available.` };
  if (!person) return { act: 'none', why: "Now scan the person's ID card, or pick them." };
  return { act: mode === 'loan' ? 'checkout' : 'issue' };
}

export default function Scan({ org, active }: { org: number; can: Can; active: boolean; onAsset?: (id: number) => void }) {
  const ro = useReadOnly();
  const qc = useQueryClient();
  const seen = useScannerSeen();
  const [mode, setMode] = useState<Mode>('issue');
  const [code, setCode] = useState('');
  const [asset, setAsset] = useState<Asset | null>(null);
  const [person, setPerson] = useState<Person | null>(null);
  const [cond, setCond] = useState('good');
  const [due, setDue] = useState(tomorrow);
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  const people = useQuery({ queryKey: ['assets', 'people', asset?.org_id ?? org], queryFn: ({ signal }) => fetchPeople(asset?.org_id ?? (org || null), signal), staleTime: 300_000 });
  const add = (l: Omit<LogLine, 'at'>) => setLog((x) => [{ ...l, at: clock() }, ...x].slice(0, 100));
  const next = nextAct(mode, asset, person);

  useEffect(() => {
    if (active) box.current?.focus();
  }, [active, mode]);

  const take = async (raw: string) => {
    const c = raw.trim();
    if (!c) return;
    setCode('');
    try {
      const r = await resolveCode(c, people.data ?? []);
      if (r.kind === 'asset') {
        setAsset(r.asset);
        setPerson(null);
        if (mode === 'lookup') add({ kind: 'looked', text: `${r.asset.asset_code} ${r.asset.name}` });
      } else if (r.kind === 'person') setPerson(r.person);
      else add({ kind: 'refused', text: `${c} — no asset or person has this code` });
    } catch (e) {
      add({ kind: 'refused', text: `${c} — ${errorMessage(e)}` });
    }
  };
  useWedge((c) => void take(c), active);

  const go = async () => {
    if (!asset || busy || ro || next.act === 'none') return;
    setBusy(true);
    const label = `${asset.asset_code} ${asset.name}`;
    try {
      if (next.act === 'issue') {
        await issueAsset(asset.id, { holder_type: 'employee', holder_id: person!.id, condition_out: cond });
        add({ kind: 'issued', text: `${label} → ${person!.name}` });
      } else if (next.act === 'return') {
        await returnAsset(asset.id, cond);
        add({ kind: 'returned', text: label });
      } else if (next.act === 'checkout') {
        // A server without loans (before 1.1) is lent through an ordinary issue with a due-back date.
        const r = await checkout(asset.id, { holder_id: person!.id, due_back: due.replace('T', ' '), condition_out: cond });
        if (r === null) await issueAsset(asset.id, { holder_type: 'employee', holder_id: person!.id, condition_out: cond, expected_return_at: due.slice(0, 10) });
        add({ kind: 'checked_out', text: `${label} → ${person!.name} until ${due.replace('T', ' ')}` });
      } else {
        const r = await checkin(asset.id, cond);
        if (r === null) await returnAsset(asset.id, cond);
        add({ kind: 'returned', text: label });
      }
      setAsset(null);
      setPerson(null);
      void qc.invalidateQueries({ queryKey: ['assets'] });
    } catch (e) {
      add({ kind: 'refused', text: `${label} — ${refusal(e)}` });
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  };

  const printer = labelPrefs().printer;
  return (
    <div className="flex flex-wrap items-start gap-4">
      <section aria-label="Scan station" className="flex min-w-0 flex-[2_1_520px] flex-col gap-3.5">
        <PageHead title="Scan station" sub={seen ? 'Barcode scanner ready' : 'A USB or Bluetooth scanner works wherever the focus is — scan anything to check it.'} />
        <div role="group" aria-label="Mode" className="flex flex-wrap gap-2">
          {MODES.map(([m, l]) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => (setMode(m), setPerson(null))} className={cx('h-11 flex-1 rounded-[10px] border text-[14px] font-semibold', mode === m ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink-2 hover:bg-subtle')}>
              {l}
            </button>
          ))}
        </div>
        <div className="rounded-[12px] border-2 border-dashed border-[#9FB0F0] bg-[#F5F7FF] p-6 text-center dark:bg-primary/5">
          <div className="text-[17px] font-semibold text-ink">{mode === 'issue' || mode === 'loan' ? "Scan an asset, then the person's ID card" : 'Scan an asset'}</div>
          <div className="mt-1 text-[12px] text-ink-3">USB scanner or a code typed here and Enter</div>
          <input
            ref={box}
            aria-label="Code"
            className={cx(input, 'mx-auto mt-3 max-w-[360px] text-center font-mono')}
            value={code}
            disabled={ro}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (code.trim()) void take(code);
              else void go();
            }}
          />
        </div>
        {ro ? <Note tone="warn">Offline: the scan station needs WorkSuite to issue or take back.</Note> : null}
        {asset ? (
          <Card>
            <div className="flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-[220px] flex-1">
                <div className="font-mono text-[11px] text-ink-3">{asset.asset_code}</div>
                <div className="text-[16px] font-semibold">{asset.name}</div>
                <div className="mt-1 flex flex-wrap gap-1.5"><Badge status={asset.status} />{asset.location ? <Badge status="reserved">{asset.location}</Badge> : null}{asset.company ? <Badge status="reserved">{asset.company}</Badge> : null}</div>
              </div>
              {mode === 'issue' || (mode === 'loan' && asset.status === 'available') ? (
                <div className="min-w-[220px] flex-1">
                  <Field label={mode === 'loan' ? 'Lending to' : 'Issuing to'}>
                    <select className={input} value={person?.id ?? ''} onChange={(e) => setPerson((people.data ?? []).find((p) => p.id === Number(e.target.value)) ?? null)}>
                      <option value="">Scan their ID card or pick…</option>
                      {(people.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>{`${p.name} · ${p.employee_no}`}</option>
                      ))}
                    </select>
                  </Field>
                  {mode === 'loan' ? (
                    <Field label="Due back" className="mt-2">
                      <input className={input} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
                    </Field>
                  ) : null}
                </div>
              ) : null}
              {mode !== 'lookup' ? (
                <Field label="Condition" className="w-[150px]">
                  <select className={input} value={cond} onChange={(e) => setCond(e.target.value)}>
                    <option value="new">New</option>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="damaged">Damaged</option>
                  </select>
                </Field>
              ) : null}
              <div className="flex flex-col items-end gap-1.5">
                {next.act !== 'none' ? (
                  <Btn primary disabled={busy || ro} onClick={() => void go()}>
                    {{ issue: 'Issue', return: 'Record return', checkout: 'Lend', checkin: 'Take back' }[next.act]} · <Kbd>↵</Kbd>
                  </Btn>
                ) : null}
                {next.why ? <span className="text-[11.5px] text-ink-3">{next.why}</span> : null}
                <button type="button" className="text-[11.5px] font-semibold text-primary" onClick={() => void printLabels([{ code: asset.asset_code, name: asset.name, company: asset.company }])}>Print label</button>
              </div>
            </div>
          </Card>
        ) : null}
      </section>
      <aside aria-label="This session" className="flex min-w-0 flex-[1_1_300px] flex-col overflow-hidden rounded-[10px] border border-line bg-surface">
        <div className="flex items-center px-3.5 py-2.5">
          <h2 className="m-0 flex-1 text-[13.5px] font-bold">This session</h2>
          <span className="text-[11px] text-ink-3">{`${log.length} scans`}</span>
        </div>
        {log.map((l, i) => (
          <div key={i} className={cx('flex items-center gap-2 border-t border-line/70 px-3.5 py-2 text-[12px]', l.kind === 'refused' && 'bg-[#FEF2F2] dark:bg-danger/10')}>
            <Badge status={l.kind === 'checked_out' ? 'issued' : l.kind}>{{ issued: 'Issued', returned: 'Returned', looked: 'Looked up', refused: 'Refused', checked_out: 'Lent' }[l.kind]}</Badge>
            <span className="min-w-0 flex-1">{l.text}</span>
            <span className="text-[11px] text-ink-3">{l.at}</span>
          </div>
        ))}
        <div className="border-t border-line px-3.5 py-3">
          <h3 className="m-0 mb-1 text-[12.5px] font-bold">Label printer</h3>
          <div className="text-[12px] text-ink-2">{printer ?? 'The default printer — choose one under Labels'}</div>
        </div>
      </aside>
    </div>
  );
}
