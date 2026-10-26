import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RESIDUAL_TARGET_MM, clampOffset, parseOffset, signedMm } from '@shared/cheque';
import { toast } from '../../core/toasts';
import { ErrorNote, Spinner } from '../../components/ui';
import { refusal } from '../finance/api';
import { errorMessage } from '../../core/bridge';
import { applyCalibration, fetchGeometry, fetchMarkers, fetchProfiles, fetchVersions, has, K, openPdf, printCalibration, recordCalibration, saveOffsets, type Access, type CalibrationRun } from './api';
import { Check, Note, PageHead, Panel, Tile, btn, btnPrimary, num, td, th, useStation } from './parts';

/**
 * D04 — Calibration test sheet + offsets (CHQ-CAL-01..04, WF-03). Pick a printer profile on this computer and one
 * of its template versions; print the A4 sheet (the server's: leaf boundary, field boxes, protected zones,
 * crosshairs, 10 mm rulers) or a test on a voided leaf with the offsets being tried; nudge X/Y by 0.1 mm and see
 * where the printer will land. Two ways to correct: measure where each marker landed and record the run — the
 * server fits the offsets and the residual and stores the run, pass or fail — then apply its proposal; or type the
 * offsets and save them. Either way they go to this computer's printer profile only, never the template. No cheque
 * prints from here.
 */
const PX = 4; // px per mm on screen

export default function Calibration({ access, versionId, profileId, onPick }: { access: Access | undefined; versionId: number | null; profileId: number | null; onPick: (version: number, profile: number) => void }) {
  const qc = useQueryClient();
  const st = useStation();
  const device = st.data?.device_id ?? null;
  const profiles = useQuery({ queryKey: K.profiles(device), queryFn: ({ signal }) => fetchProfiles(device, signal), enabled: !!device });
  const versions = useQuery({ queryKey: K.versions, queryFn: ({ signal }) => fetchVersions(signal), staleTime: 300_000 });
  const profile = profiles.data?.find((p) => p.id === profileId) ?? null;
  const version = versions.data?.find((v) => v.id === versionId) ?? null;
  const geo = useQuery({ queryKey: K.geometry(version?.template_id ?? 0, versionId ?? 0), queryFn: ({ signal }) => fetchGeometry(version!.template_id, versionId!, signal), enabled: !!version && !!versionId });
  const markers = useQuery({ queryKey: K.markers(versionId ?? 0, profileId ?? 0), queryFn: ({ signal }) => fetchMarkers(versionId!, profileId!, signal), enabled: !!versionId && !!profileId, retry: false });
  // What is typed; null shows the profile's saved offset.
  const [xDraft, setXs] = useState<string | null>(null);
  const [yDraft, setYs] = useState<string | null>(null);
  const [measured, setMeasured] = useState<Record<string, { x: string; y: string }>>({});
  const [kind, setKind] = useState<'sheet' | 'test_print'>('sheet');
  const [lastRun, setLastRun] = useState<CalibrationRun | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const mayCalibrate = has(access, 'cheque.template.calibrate');
  const mayManage = has(access, 'cheque.printer.manage');

  if (!device) return <Note tone="warn">This computer is not registered with WorkSuite, so it has no printer profiles to calibrate.</Note>;
  if (profiles.isLoading || versions.isLoading) return <Spinner />;
  if (profiles.error) return <ErrorNote error={profiles.error} onRetry={() => void profiles.refetch()} />;

  const nameOf = (id: number) => {
    const v = versions.data?.find((x) => x.id === id);
    return v ? `${v.name}${v.version ? ` v${v.version}` : ''}${v.status ? ` · ${v.status.toLowerCase()}` : ''}` : `Version ${id}`;
  };

  if (!profile || !versionId || !version) {
    return (
      <div className="flex flex-col gap-3">
        <PageHead title="Calibration" sub="Choose a printer on this computer and the template to line up on it" />
        {(profiles.data ?? []).length === 0 ? <Note>No cheque printer profile is bound to this computer. Create one on the web under Cheque Manager › Settings › Printers.</Note> : null}
        {(profiles.data ?? []).map((p) => (
          <Panel key={p.id} title={p.printer_name}>
            <div className="flex flex-wrap gap-2">
              {p.version_ids.map((v) => (
                <button key={v} type="button" className={btn} disabled={!versions.data?.some((x) => x.id === v)} onClick={() => onPick(v, p.id)}>{nameOf(v)}</button>
              ))}
              {p.version_ids.length === 0 ? <span className="text-[12.5px] text-ink-2">No template versions are linked to this profile.</span> : null}
            </div>
          </Panel>
        ))}
      </div>
    );
  }

  const xs = xDraft ?? signedMm(profile.offset_x_mm);
  const ys = yDraft ?? signedMm(profile.offset_y_mm);
  const x = parseOffset(xs);
  const y = parseOffset(ys);
  const valid = x !== null && y !== null;
  const nudge = (dx: number, dy: number) => {
    if (dx) setXs(signedMm(clampOffset((x ?? 0) + dx)));
    if (dy) setYs(signedMm(clampOffset((y ?? 0) + dy)));
  };
  const g = geo.data;
  const marks = markers.data ?? [];
  const readings = marks.map((m) => ({ m, x: parseOffset(measured[m.name]?.x ?? '', 420), y: parseOffset(measured[m.name]?.y ?? '', 420) }));
  const complete = readings.length > 0 && readings.every((r) => r.x !== null && r.y !== null);

  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      toast('error', refusal(e));
    } finally {
      setBusy(null);
    }
  };
  const print = (sheet: 'a4' | 'leaf') =>
    run(sheet, async () => {
      const o = await printCalibration({ template_id: version.template_id, version_id: versionId, profile_id: profile.id, sheet, offsets: valid ? { x_mm: x, y_mm: y } : undefined });
      toast(o.ok ? 'success' : 'error', o.message);
    });
  const reload = async () => {
    await qc.invalidateQueries({ queryKey: ['cheque', 'printers'] });
    setXs(null);
    setYs(null);
  };
  const box = (b: { x_mm: number; y_mm: number; width_mm: number; height_mm: number }, dx: number, dy: number) => ({ left: (b.x_mm + dx) * PX, top: (b.y_mm + dy) * PX, width: b.width_mm * PX, height: b.height_mm * PX });

  return (
    <div className="flex flex-col gap-3">
      <PageHead title={`Calibrate ${nameOf(versionId)}`} sub={`${profile.printer_name} on this computer`}>
        <button type="button" className={btn} onClick={() => void openPdf('calibration-sheet', versionId, `Calibration sheet ${nameOf(versionId)}`).catch((e) => toast('error', errorMessage(e)))}>Sheet PDF</button>
        <button type="button" className={btn} disabled={!mayCalibrate || !!busy} onClick={() => void print('a4')}>Print A4 sheet</button>
        <button type="button" className={btnPrimary} disabled={!mayCalibrate || !!busy} onClick={() => void print('leaf')}>Print test on voided leaf</button>
      </PageHead>
      {geo.error ? <ErrorNote error={geo.error} onRetry={() => void geo.refetch()} /> : null}
      <div className="grid grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] items-start gap-2.5">
        <div className="flex flex-col gap-2.5">
          <Panel
            title="Where the printer will land after offset"
            action={
              <span className="flex gap-2.5 text-[11.5px] font-semibold">
                <span className="text-[#DC2626]">▢ saved</span>
                <span className="text-[#2563EB]">▢ trying</span>
              </span>
            }
          >
            {g ? (
              <div className="overflow-auto">
                <div className="relative border border-[#B6CFC4] bg-[#F3F9F5]" style={{ width: g.width_mm * PX, height: g.height_mm * PX }}>
                  {g.zones.map((z, i) => (
                    <div key={`z${i}`} className="absolute grid place-items-center border border-dashed border-ink-3 text-[10px] font-bold text-ink-3 uppercase" style={{ ...box(z, 0, 0), background: 'repeating-linear-gradient(45deg,transparent 0 6px,rgba(100,116,139,.18) 6px 8px)' }}>
                      {z.kind === 'micr' ? 'MICR / clearing zone' : z.kind}
                    </div>
                  ))}
                  {g.fields.map((f) => (
                    <div key={`s${f.key}`} className="absolute border border-dashed border-[#DC2626] bg-[rgba(220,38,38,.06)] px-1 text-[10px] text-[#B91C1C]" style={box(f, profile.offset_x_mm, profile.offset_y_mm)}>{f.key.replace(/_/g, ' ')}</div>
                  ))}
                  {valid
                    ? g.fields.map((f) => (
                        <div key={`n${f.key}`} className="absolute border border-[#2563EB] bg-[rgba(37,99,235,.06)] px-1 text-right text-[10px] text-[#1D4ED8]" style={box(f, x, y)}>{f.key.replace(/_/g, ' ')}</div>
                      ))
                    : null}
                </div>
              </div>
            ) : geo.isLoading ? (
              <Spinner />
            ) : (
              <div className="text-[12.5px] text-ink-2">WorkSuite did not send this version’s fields.</div>
            )}
          </Panel>
          <Panel
            title="Where the markers landed"
            action={
              <div role="radiogroup" aria-label="Measured on" className="inline-flex overflow-hidden rounded-[7px] border border-line text-[12px] font-semibold">
                {(['sheet', 'test_print'] as const).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={kind === k ? 'bg-primary px-2.5 py-1 text-white' : 'bg-surface px-2.5 py-1 text-ink-2'}>
                    {k === 'sheet' ? 'A4 sheet' : 'Test leaf'}
                  </button>
                ))}
              </div>
            }
          >
            {markers.isLoading ? <Spinner /> : marks.length === 0 ? <div className="text-[12.5px] text-ink-2">{markers.error ? 'WorkSuite did not send the sheet’s markers.' : 'This sheet has no markers to measure.'}</div> : null}
            {marks.length ? (
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={th}>Marker</th>
                    <th className={`${th} text-right`}>Expected X · Y (mm)</th>
                    <th className={th}>Measured X (mm)</th>
                    <th className={th}>Measured Y (mm)</th>
                  </tr>
                </thead>
                <tbody>
                  {readings.map(({ m, x: mx, y: my }) => (
                    <tr key={m.name}>
                      <td className={td}>{m.name}</td>
                      <td className={`${td} ${num} text-right`}>{`${m.x_mm.toFixed(1)} · ${m.y_mm.toFixed(1)}`}</td>
                      {(['x', 'y'] as const).map((axis) => (
                        <td key={axis} className={td}>
                          <input
                            aria-label={`${m.name} measured ${axis.toUpperCase()}`}
                            inputMode="decimal"
                            disabled={!mayCalibrate}
                            className={`h-7 w-24 rounded-[6px] border bg-surface px-2 text-[12.5px] ${num} ${(axis === 'x' ? mx : my) === null && measured[m.name]?.[axis] ? 'border-danger' : 'border-line'}`}
                            value={measured[m.name]?.[axis] ?? ''}
                            onChange={(e) => setMeasured((s) => ({ ...s, [m.name]: { x: s[m.name]?.x ?? '', y: s[m.name]?.y ?? '', [axis]: e.target.value } }))}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                className={btnPrimary}
                disabled={!mayCalibrate || !complete || !!busy}
                onClick={() =>
                  void run('record', async () => {
                    const r = await recordCalibration(versionId, { profile_id: profile.id, kind, markers: readings.map(({ m, x: mx, y: my }) => ({ name: m.name, expected_x_mm: m.x_mm, expected_y_mm: m.y_mm, measured_x_mm: mx!, measured_y_mm: my! })) });
                    setLastRun(r);
                    toast('success', `Calibration run recorded: ${r.result === 'pass' ? 'pass' : 'fail'}.`);
                  })
                }
              >
                Record this run
              </button>
            </div>
          </Panel>
        </div>
        <Panel title="Offsets for this printer">
          <div className="flex flex-col gap-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              {(
                [
                  ['X (mm)', xs, setXs, x],
                  ['Y (mm)', ys, setYs, y],
                ] as const
              ).map(([label, v, set, parsed]) => (
                <label key={label} className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
                  {label}
                  <input className={`h-8 rounded-[7px] border bg-surface px-2.5 text-[13px] font-normal text-ink ${num} ${parsed === null ? 'border-danger' : 'border-line'}`} value={v} disabled={!mayCalibrate} onChange={(e) => set(e.target.value)} />
                </label>
              ))}
            </div>
            <div className="flex gap-1.5">
              <button type="button" className={btn} disabled={!mayCalibrate} aria-label="Move left 0.1 mm" onClick={() => nudge(-0.1, 0)}>← 0.1</button>
              <button type="button" className={btn} disabled={!mayCalibrate} aria-label="Move right 0.1 mm" onClick={() => nudge(0.1, 0)}>→ 0.1</button>
              <button type="button" className={btn} disabled={!mayCalibrate} aria-label="Move up 0.1 mm" onClick={() => nudge(0, -0.1)}>↑ 0.1</button>
              <button type="button" className={btn} disabled={!mayCalibrate} aria-label="Move down 0.1 mm" onClick={() => nudge(0, 0.1)}>↓ 0.1</button>
            </div>
            {lastRun ? (
              <>
                <Tile icon="target" tone={lastRun.residual_mm <= RESIDUAL_TARGET_MM ? 'green' : 'red'} label="Residual" value={`${lastRun.residual_mm.toFixed(2)} mm`} sub={`target ≤ ${RESIDUAL_TARGET_MM} mm${lastRun.residual_after_fit_mm != null ? ` · ${lastRun.residual_after_fit_mm.toFixed(2)} mm after the correction` : ''}`} />
                <Check tone={lastRun.result === 'pass' ? 'ok' : 'warn'}>{`Measured shift X ${signedMm(lastRun.proposal.offset_x_mm)} · Y ${signedMm(lastRun.proposal.offset_y_mm)} mm; applying it makes the offsets X ${signedMm(profile.offset_x_mm - lastRun.proposal.offset_x_mm)} · Y ${signedMm(profile.offset_y_mm - lastRun.proposal.offset_y_mm)} mm`}</Check>
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={!mayCalibrate || !mayManage || !!busy}
                  onClick={() =>
                    void run('apply', async () => {
                      await applyCalibration(lastRun.id);
                      setLastRun(null);
                      await reload();
                      toast('success', 'The proposal is saved to this computer’s printer profile.');
                    })
                  }
                >
                  Apply the proposal
                </button>
              </>
            ) : null}
            <button
              type="button"
              className={btn}
              disabled={!mayManage || !valid || !!busy}
              onClick={() =>
                void run('save', async () => {
                  await saveOffsets(profile.id, x!, y!);
                  await reload();
                  toast('success', 'Offsets saved to this computer’s printer profile.');
                })
              }
            >
              Save these offsets
            </button>
            <Note>Saved to the printer profile on this device only. Other computers keep their own offsets.</Note>
            {!mayCalibrate ? <Note tone="warn">Calibrating needs cheque.template.calibrate; saving offsets needs cheque.printer.manage.</Note> : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}
