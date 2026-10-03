import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, Card, Modal, Spinner, Switch, cx } from '../../components/ui';
import { call } from '../../core/bridge';
import { toast } from '../../core/toasts';
import type { DeskPrintPatch } from '@shared/event-desk';
import { at, eGet, errorText, K, type Device, type Gate } from './api';
import { DK, deskForget, deskRegister, deskRotateKey, deskSync, setPrintSettings, useDeskStatus, usePrintSettings } from './desk';
import { Facts, Header, Refusal, useEvent } from './parts';
import { SyncButton } from '../../components/SyncButton';

/**
 * This computer at the event (EV-CHK-031..033, EV-OFF-007, EV-BDG-013):
 * registered as a check-in device at a gate, its state as the server sees
 * it, its offline copy and what waits, a new key, and the badge printer. The
 * event's gates and devices themselves are set up on the web.
 */
export default function Setup() {
  const { event, may, online } = useEvent();
  const qc = useQueryClient();
  const status = useDeskStatus(event.id);
  const reg = status.data?.registration ?? null;
  const gates = useQuery({ queryKey: K.gates(event.id), queryFn: ({ signal }) => eGet<{ items: Gate[]; kept_to: number[] | null }>(`/events/${event.id}/gates`, undefined, signal), enabled: online });
  const devices = useQuery({
    queryKey: K.devices(event.id),
    queryFn: ({ signal }) => eGet<{ items: Device[] }>(`/events/${event.id}/devices`, undefined, signal),
    enabled: online && may('events.checkin.use'),
    retry: false,
  });
  const [gate, setGate] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forget, setForget] = useState<string | null>(null);

  useEffect(() => {
    void call('security:deviceInfo').then(
      (d) => setName((n) => n || d.name),
      () => undefined,
    );
  }, []);

  const refresh = () => void qc.invalidateQueries({ queryKey: DK.all });
  const register = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await deskRegister(event.id, gate, name.trim());
      toast('success', r.reregistered ? 'Registered again: the offline copy is being taken with the new key.' : r.message);
      refresh();
      void qc.invalidateQueries({ queryKey: K.devices(event.id) });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast('success', done);
      refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const doForget = async (discard: boolean) => {
    setBusy(true);
    try {
      await deskForget(event.id, discard);
      setForget(null);
      toast('success', 'This computer is no longer a check-in device at the event.');
      refresh();
    } catch (e) {
      setForget(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const gateList = (gates.data?.items ?? []).filter((g) => g.active && g.direction !== 'OUT');
  const st = status.data;
  const mine = devices.data?.items.find((d) => d.id === reg?.device_id) ?? null;

  return (
    <div className="flex flex-col gap-4 pb-6">
      <Header title="This computer" sub="The desk as a check-in device at this event, and its badge printer" />
      <div className="flex max-w-[900px] flex-col gap-4 px-6">
        {st?.wiped ? <Refusal text={st.wiped} /> : null}
        {error ? <Refusal text={error} /> : null}
        {status.isLoading ? <Spinner /> : null}

        {!reg ? (
          <Card title="Register this computer at a gate">
            <div className="flex flex-col gap-3 text-[13px]">
              <p className="m-0 text-ink-2">
                The desk checks people in as one of the event’s devices. WorkSuite gives it a key for its offline copy of the gate’s tickets; the key stays in this computer’s credential store and is never shown.
              </p>
              {!online ? <Refusal text="Registering needs WorkSuite. Try again when the line is back." /> : null}
              {gates.error ? <Refusal text={errorText(gates.error)} /> : null}
              <label className="flex flex-col gap-1 font-semibold text-ink-2">
                Gate
                <Select
                  aria-label="Gate"
                  value={gate === null ? '' : String(gate)}
                  onChange={(e) => setGate(e.target.value ? Number(e.target.value) : null)}
                  options={[{ value: '', label: gates.data?.kept_to ? 'Choose one of your gates' : 'No particular gate' }, ...gateList.map((g) => ({ value: String(g.id), label: `${g.name}${g.venue ? ` · ${g.venue.name}` : ''} (${g.direction_label})` }))]}
                  className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 font-semibold text-ink-2">
                Name the gate staff will recognise
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="h-9 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] font-normal text-ink outline-none focus:border-primary" />
              </label>
              <div>
                <Button variant="primary" icon="laptop" loading={busy} disabled={!online || !name.trim() || (gates.data?.kept_to != null && gate === null)} onClick={() => void register()}>
                  Register this computer
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <Card
            title="Check-in device"
            action={
              <div className="flex gap-2">
                <SyncButton size="sm" disabled={!online} running={busy} onSync={() => act(() => deskSync(event.id), 'Sent what waited and caught up.')} />
                <Button size="sm" icon="key" disabled={!online || busy} onClick={() => void act(() => deskRotateKey(event.id), 'A new key: the offline copy is taken again.')}>
                  New key
                </Button>
                <Button size="sm" variant="ghost" icon="x" disabled={busy} onClick={() => setForget('')}>
                  Stop
                </Button>
              </div>
            }
          >
            <Facts
              rows={[
                ['Device', `${reg.device_name} (#${reg.device_id})`],
                ['Gate', reg.gate_name ?? 'No particular gate'],
                ['Registered here', at(reg.registered_at)],
                ['As WorkSuite sees it', st?.device ? `${st.device.status_label}${st.device.online ? ', online' : ''}${st.device.trusted === false ? ' — not trusted by WorkSuite Desktop' : ''}` : online ? 'Asking…' : 'Not asked yet'],
                ['WorkSuite', st?.reachable ? `Answering${st.last_contact ? ` (last ${at(st.last_contact)})` : ''}` : 'Out of reach'],
                [
                  'Offline copy',
                  st?.copy
                    ? `${st.copy.rows} tickets of ${st.copy.gate ?? 'the event'} — taken ${at(st.copy.refreshed_at)}, updated ${at(st.copy.pulled_at)}${st.copy.cache_expires ? `, kept until ${at(st.copy.cache_expires)}` : ''}`
                    : st?.offline_blocked
                      ? `None: ${st.offline_blocked}`
                      : 'Not taken yet',
                ],
                ['Waiting for WorkSuite', st ? `${st.waiting} scan${st.waiting === 1 ? '' : 's'}${st.rejected ? `, ${st.rejected} refused` : ''}${st.others ? `, ${st.others} by someone else` : ''}` : '—'],
                ['Last upload', st?.last_sync ? `${at(st.last_sync.at)}: ${st.last_sync.accepted} recorded, ${st.last_sync.duplicates} possible duplicates, ${st.last_sync.conflicts} to reconcile, ${st.last_sync.rejected} refused` : '—'],
              ]}
            />
            {st?.problem ? (
              <div className="mt-3">
                <Refusal text={st.problem.message} />
              </div>
            ) : null}
            {st?.copy?.warning ? <p className="mt-3 mb-0 text-[12px] text-ink-3">{st.copy.warning}</p> : null}
          </Card>
        )}

        <PrinterCard />

        {devices.data ? (
          <Card title="The event’s devices">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] text-ink-3">
                  <th className="py-1 font-semibold">Device</th>
                  <th className="py-1 font-semibold">Gate</th>
                  <th className="py-1 font-semibold">State</th>
                  <th className="py-1 font-semibold">Last sync</th>
                  <th className="py-1 text-right font-semibold">Queue</th>
                </tr>
              </thead>
              <tbody>
                {devices.data.items.map((d) => (
                  <tr key={d.id} className={cx('border-t border-line', d.id === mine?.id && 'font-semibold')}>
                    <td className="py-1.5">
                      {d.name}
                      <span className="text-ink-3"> · {d.device_ref.label ?? d.device_ref.type}</span>
                    </td>
                    <td className="py-1.5">{d.gate?.name ?? '—'}</td>
                    <td className="py-1.5">
                      <span className={cx(d.online ? 'text-success' : 'text-ink-2')}>{d.status_label}{d.online ? ' · online' : ''}</span>
                      {!d.device_ref.trusted ? <span className="text-warning"> · not trusted</span> : null}
                    </td>
                    <td className="py-1.5">{at(d.last_sync)}</td>
                    <td className="py-1.5 text-right tabular-nums">{d.queue_size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 mb-0 text-[11.5px] text-ink-3">Suspending, revoking and moving devices are done on the web by a device manager.</p>
          </Card>
        ) : null}
      </div>

      {forget !== null ? (
        <Modal
          title="Stop being a check-in device here?"
          onClose={() => setForget(null)}
          width={480}
          footer={
            <>
              <Button onClick={() => setForget(null)}>Keep it</Button>
              {forget ? (
                <Button variant="danger" loading={busy} onClick={() => void doForget(true)}>
                  Remove them too
                </Button>
              ) : (
                <Button variant="danger" loading={busy} onClick={() => void doForget(false)}>
                  Stop
                </Button>
              )}
            </>
          }
        >
          <p className="mt-0 text-[13px] text-ink-2">This computer forgets its key and its offline copy of the event. It stays registered on the server until a device manager revokes it.</p>
          {forget ? <Refusal text={forget} /> : null}
        </Modal>
      ) : null}
    </div>
  );
}

/** The desk's badge printer (EV-BDG-013 "Desktop shall print directly to local/network printers"). */
function PrinterCard() {
  const qc = useQueryClient();
  const settings = usePrintSettings();
  const printers = useQuery({ queryKey: ['events', 'printers'], queryFn: () => call('print:printers'), networkMode: 'always' });
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const s = settings.data;
  const save = async (patch: DeskPrintPatch) => {
    setError(null);
    try {
      await setPrintSettings(patch);
      void qc.invalidateQueries({ queryKey: DK.print });
    } catch (e) {
      setError(errorText(e));
    }
  };
  if (!s) return null;
  return (
    <Card title="Badge printer">
      <div className="flex flex-col gap-3 text-[13px]">
        <label className="flex flex-col gap-1 font-semibold text-ink-2">
          Printer
          <Select
            aria-label="Badge printer"
            value={s.badge_printer ?? ''}
            onChange={(e) => void save({ badge_printer: e.target.value || null })}
            options={[{ value: '', label: 'Ask each time (the system’s print dialog)' }, ...(printers.data ?? []).map((p) => ({ value: p.name, label: `${p.displayName}${p.isDefault ? ' (default)' : ''}` }))]}
            className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink"
          />
        </label>
        <div className="flex items-center justify-between gap-3">
          <span>
            <b className="block">Print without asking</b>
            <span className="text-ink-2">Straight to the badge printer, no dialog — for a busy desk.</span>
          </span>
          <Switch label="Print without asking" checked={s.silent} disabled={!s.badge_printer} onChange={(v) => void save({ silent: v })} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>
            <b className="block">Page size</b>
            <span className="text-ink-2">{s.page === 'template' ? 'The badge template’s own size (A6, a card, a label…).' : 'The label the printer is loaded with (thermal badge printers).'}</span>
          </span>
          <Select
            aria-label="Page size"
            value={s.page}
            onValueChange={(v) => void save({ page: v })}
            options={[
              { value: 'template' as const, label: 'The template’s size' },
              { value: 'printer' as const, label: 'The printer’s label' },
            ]}
            className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[12.5px] text-ink"
          />
        </div>
        <div className="flex flex-col gap-1">
          <b>Badges sent to this desk</b>
          <span className="text-ink-2">Phones at the doors and other desks can send a badge to this printer by name. While the check-in desk is open it prints them.</span>
          <div className="flex items-center gap-2">
            <input
              value={name ?? s.printer_name ?? ''}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name !== null) void save({ printer_name: name.trim() || null });
                setName(null);
              }}
              placeholder="e.g. Main entrance badges"
              maxLength={120}
              className="h-9 min-w-0 flex-1 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary"
              aria-label="This printer’s name for others"
            />
            <Switch label="Take badges sent to this desk" checked={s.take_phone_jobs} disabled={!s.printer_name} onChange={(v) => void save({ take_phone_jobs: v })} />
          </div>
        </div>
        {error ? <Refusal text={error} /> : null}
        <p className="m-0 flex items-center gap-1.5 text-[11.5px] text-ink-3">
          <Icon name="info" size={13} /> Badges print from WorkSuite’s own badge page, on this computer, each reported printed or failed.
        </p>
      </div>
    </Card>
  );
}
