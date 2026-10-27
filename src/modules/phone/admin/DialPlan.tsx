import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../../core/api';
import { toast } from '../../../core/toasts';
import { Button, Chip, cx, Empty, IconButton, Modal, Spinner } from '../../../components/ui';
import { phoneApi, PK, useConfig, useServers, useShortCodes, type ShortCode, type ShortCodeCheck } from '../api';
import { changeCount, diffLines } from '../lib/diff';
import { localCheck, RESERVED_NOTE, TARGET_KINDS, TARGET_LABEL, type TargetKind } from '../lib/shortcodes';
import { ConfirmButton, Field, INPUT, Mono, PageBody, PageHeader, Panel, Refused, TD, TR, Table } from '../parts';
import { TargetSelect } from './Destination';
import { Checkbox } from '../../../components/Checkbox';

/**
 * A09 · Short codes & apply (VOIP-DP-01…06, WF-09, WF-10). One number namespace per switch: a code is checked against
 * extensions, queues, ring groups, menus, other codes and Asterisk's reserved feature codes; codes whose target has
 * gone are flagged. The generated configuration is shown for review — against what was last applied when the server
 * says — and applied to the switch (Asterisk: files written and reloaded; FreePBX: pushed through its API).
 */
export default function DialPlan() {
  const qc = useQueryClient();
  const codes = useShortCodes();
  const servers = useServers();
  const [server, setServer] = useState<number | null>(null);
  const config = useConfig(server);
  const [editing, setEditing] = useState<ShortCode | 'new' | null>(null);
  const [checkCode, setCheckCode] = useState('');
  const [asked, setAsked] = useState<{ code: string; r: ShortCodeCheck } | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [review, setReview] = useState(false);
  const files = useMemo(() => config.data?.files ?? {}, [config.data]);
  const names = Object.keys(files);
  const shownFile = file && files[file] !== undefined ? file : (names[1] ?? names[0] ?? null);
  const applied = config.data?.applied ?? null;
  const pending = useMemo(() => {
    if (typeof config.data?.pending === 'number') return config.data.pending;
    if (!applied) return null;
    return names.reduce((n, k) => n + changeCount(diffLines(applied[k] ?? '', files[k] ?? '')), 0);
  }, [config.data, applied, names, files]);
  const pendingCodes = (codes.data ?? []).filter((c) => c.pending).length;
  const target = servers.data?.servers.find((s) => s.id === server) ?? servers.data?.servers.find((s) => s.is_default) ?? null;
  const typed = checkCode.trim();
  const localResult = typed ? localCheck(typed) : null;
  // What this computer can tell at once (shape, reserved codes); the server is asked about the rest.
  const check: ShortCodeCheck | null = !typed || !localResult ? null : !localResult.ok ? { free: false, what: localResult.reason } : asked?.code === typed ? asked.r : null;
  useEffect(() => {
    if (!typed || !localCheck(typed).ok) return;
    const t = setTimeout(() => void phoneApi.checkShortCode(typed, server).then((r) => setAsked({ code: typed, r }), () => undefined), 300);
    return () => clearTimeout(t);
  }, [typed, server]);

  const apply = async () => {
    setApplying(true);
    try {
      if (target) {
        const r = await phoneApi.applyServer(target.id);
        if (!r.ok) throw new Error(r.message);
        toast('success', r.message);
      } else {
        const r = await phoneApi.applyConfig();
        toast('success', r.message);
      }
      setReview(false);
      void qc.invalidateQueries({ queryKey: ['phone', 'config'] });
      void qc.invalidateQueries({ queryKey: PK.shortCodes });
      void qc.invalidateQueries({ queryKey: ['phone', 'forwards'] });
    } catch (e) {
      toast('error', e instanceof ApiError && e.forbidden ? `${e.message} On this server only a super-admin may apply the configuration (G-09).` : (e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Dial plan"
        actions={
          <>
            {pending !== null || pendingCodes ? <Chip tone="warning">{(pending ?? pendingCodes) || 'No'} change{(pending ?? pendingCodes) === 1 ? '' : 's'} not on the switch yet</Chip> : null}
            {servers.data && servers.data.servers.length > 1 ? (
              <select aria-label="Server" value={server ?? ''} onChange={(e) => setServer(e.target.value ? Number(e.target.value) : null)} className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12.5px]">
                <option value="">Every server</option>
                {servers.data.servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : null}
            <Button variant="primary" icon="check" onClick={() => setReview(true)}>
              Review & apply
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Panel
            title="Short codes"
            action={
              <span className="flex items-center gap-2">
                <span className="relative">
                  <input value={checkCode} onChange={(e) => setCheckCode(e.target.value)} placeholder="Check" aria-label="Check a code" className={cx(INPUT, 'h-8 w-[120px] pr-12 font-mono')} />
                  {check ? <span className={cx('absolute top-1/2 right-2 -translate-y-1/2 text-[11px] font-bold', check.free ? 'text-success' : 'text-danger')}>{check.free ? 'free' : 'taken'}</span> : null}
                </span>
                <Button icon="plus" onClick={() => setEditing('new')}>
                  Add code
                </Button>
              </span>
            }
          >
            {check && !check.free && check.what ? <p className="mb-2 text-[12px] text-danger">{check.what}</p> : null}
            {codes.isLoading ? (
              <Spinner />
            ) : codes.error ? (
              <Refused error={codes.error} onRetry={() => void codes.refetch()} />
            ) : (codes.data ?? []).length === 0 ? (
              <Empty icon="hash" title="No short codes" />
            ) : (
              <Table head={['Code', 'Label', 'Points at', 'Target', 'Status', '']}>
                {(codes.data ?? []).map((c) => (
                  <tr key={c.id} className={TR}>
                    <td className={TD}>
                      <Mono className="font-bold">{c.code}</Mono>
                    </td>
                    <td className={cx(TD, 'font-semibold')}>{c.label ?? '—'}</td>
                    <td className={TD}>{TARGET_LABEL[c.target_kind as TargetKind] ?? c.target_kind}</td>
                    <td className={TD}>{c.target_value ?? (c.target_id ? `#${c.target_id}` : '—')}</td>
                    <td className={TD}>{!c.enabled ? <Chip>Off</Chip> : !c.resolves ? <span className="text-[12px] font-semibold text-danger" title={c.problem ?? ''}>Broken — target gone</span> : c.pending ? <Chip tone="warning">Pending apply</Chip> : <Chip tone="success">Live</Chip>}</td>
                    <td className={TD}>
                      <IconButton icon="pen" label={`Edit ${c.code}`} onClick={() => setEditing(c)} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
            <p className="mt-3 text-[11.5px] text-ink-3">Reserved by Asterisk and never allocated: {RESERVED_NOTE}.</p>
          </Panel>
          <section className="flex min-h-[420px] flex-col overflow-hidden rounded-[12px] bg-stage text-white">
            <div className="flex flex-wrap gap-1 border-b border-white/10 p-2">
              {names.map((n) => (
                <button key={n} type="button" onClick={() => setFile(n)} className={cx('rounded-[6px] px-2.5 py-1 font-mono text-[11.5px]', shownFile === n ? 'bg-white text-stage-on-light' : 'text-white/70 hover:bg-white/10')}>
                  {n}
                </button>
              ))}
            </div>
            {config.isLoading ? (
              <Spinner className="text-white/70" />
            ) : config.error ? (
              <div className="p-4 text-[12.5px] text-white/80">{config.error instanceof ApiError && config.error.forbidden ? 'The configuration review needs the right to administer telephony. On this server only a super-admin may see it (G-09).' : (config.error as Error).message}</div>
            ) : shownFile ? (
              <Code before={applied?.[shownFile] ?? null} after={files[shownFile] ?? ''} />
            ) : (
              <p className="p-4 text-[12.5px] text-white/70">Nothing generated.</p>
            )}
            <div className="flex items-center gap-3 border-t border-white/10 px-3 py-2 text-[11.5px] text-white/60">
              <span className="min-w-0 flex-1">{target ? (target.owns_configuration ? `${target.name} · writes 3 files, then reloads res_pjsip and pbx_config.` : `${target.name} · FreePBX: pushed through its API, never written as files.`) : 'Writes the files, then reloads res_pjsip and pbx_config.'}{applied ? '' : ' What was last applied is not reported by this server, so the whole file is shown.'}</span>
              <Button size="sm" variant="primary" loading={applying} onClick={() => setReview(true)}>
                Apply{target ? ` to ${target.name}` : ''}
              </Button>
            </div>
          </section>
        </div>
      </PageBody>
      {editing ? <CodeEditor code={editing === 'new' ? null : editing} serverId={server} onClose={() => setEditing(null)} onSaved={(m) => (setEditing(null), m && toast('success', m), void qc.invalidateQueries({ queryKey: PK.shortCodes }), void qc.invalidateQueries({ queryKey: ['phone', 'config'] }))} /> : null}
      {review ? (
        <Modal
          title={`Apply the configuration${target ? ` to ${target.name}` : ''}?`}
          onClose={() => setReview(false)}
          footer={
            <>
              <Button onClick={() => setReview(false)}>Cancel</Button>
              <Button variant="primary" loading={applying} onClick={() => void apply()}>
                Apply now
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-2 text-[13px] text-ink-2">
            <p>{pending !== null ? `${pending} change${pending === 1 ? '' : 's'} will go live.` : 'Everything generated will be written to the switch.'} Calls in progress are not dropped; phones re-read their settings.</p>
            {(codes.data ?? []).some((c) => !c.resolves) ? <p className="text-danger">Some short codes point at something deleted. They are skipped (written as comments), so dialling them does nothing.</p> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/** The file, with what changed since the last apply when that is known. */
function Code({ before, after }: { before: string | null; after: string }) {
  const lines = useMemo(() => (before === null ? after.split('\n').map((text) => ({ kind: 'same' as const, text })) : diffLines(before, after)), [before, after]);
  return (
    <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11.5px] leading-[1.55] scroll-thin" aria-label="Generated configuration">
      {lines.map((l, i) => (
        <div key={i} className={cx('px-1 whitespace-pre', l.kind === 'add' && 'bg-stage-gray text-stage-success', l.kind === 'del' && 'bg-stage-gray text-stage-danger line-through', l.kind === 'same' && (l.text.trim().startsWith(';') ? 'text-white/45' : 'text-white/85'))}>
          {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '- ' : '  '}
          {l.text || ' '}
        </div>
      ))}
    </pre>
  );
}

function CodeEditor({ code, serverId, onClose, onSaved }: { code: ShortCode | null; serverId: number | null; onClose: () => void; onSaved: (message: string | null) => void }) {
  const [c, setC] = useState(code?.code ?? '');
  const [generate, setGenerate] = useState(false);
  const [prefix, setPrefix] = useState('7');
  const [label, setLabel] = useState(code?.label ?? '');
  const [kind, setKind] = useState<TargetKind>((code?.target_kind as TargetKind) ?? 'extension');
  const [value, setValue] = useState(code?.target_value ?? '');
  const [enabled, setEnabled] = useState(code?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const local = generate ? { ok: true as const } : localCheck(c);
  const save = async () => {
    setSaving(true);
    try {
      if (code) {
        const r = await phoneApi.updateShortCode(code.id, { code: c !== code.code ? c : undefined, label: label || null, target_kind: kind, target_value: value || null, enabled });
        onSaved(r.message);
      } else {
        const r = await phoneApi.createShortCode({ ...(generate ? { prefix, width: 3 } : { code: c }), label: label || undefined, target_kind: kind, target_value: value || null, server_id: serverId });
        onSaved(`${r.code}: ${r.message}`);
      }
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title={code ? `Short code ${code.code}` : 'Add a short code'}
      onClose={onClose}
      footer={
        <>
          {code ? <ConfirmButton label="Delete" confirm="Delete code" onConfirm={() => void phoneApi.deleteShortCode(code.id).then(() => onSaved('Removed. Apply the configuration to take it off the switch.'), (e: Error) => toast('error', e.message))} /> : null}
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!local.ok} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code" hint={!local.ok ? local.reason : undefined}>
          <input value={generate ? '' : c} disabled={generate} onChange={(e) => setC(e.target.value)} placeholder={generate ? 'Allocated on save' : '200'} aria-label="Code" className={cx(INPUT, 'font-mono')} />
        </Field>
        {!code ? (
          <Field label="Or allocate the next free code starting with">
            <span className="flex items-center gap-2">
              <Checkbox checked={generate} onChange={(e) => setGenerate(e.target.checked)} aria-label="Allocate" />
              <input value={prefix} onChange={(e) => setPrefix(e.target.value.replace(/[^0-9*#]/g, ''))} disabled={!generate} aria-label="Prefix" className={cx(INPUT, 'w-20 font-mono')} />
            </span>
          </Field>
        ) : (
          <label className="flex items-end gap-1.5 pb-2 text-[12.5px]">
            <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
          </label>
        )}
        <Field label="Label" className="col-span-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Reception" aria-label="Label" className={INPUT} />
        </Field>
        <Field label="Points at">
          <select aria-label="Points at" value={kind} onChange={(e) => (setKind(e.target.value as TargetKind), setValue(''))} className={INPUT}>
            {TARGET_KINDS.map((k) => (
              <option key={k} value={k}>
                {TARGET_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Target">
          <TargetSelect kind={kind} value={value} onChange={setValue} label="Target" />
        </Field>
      </div>
    </Modal>
  );
}
