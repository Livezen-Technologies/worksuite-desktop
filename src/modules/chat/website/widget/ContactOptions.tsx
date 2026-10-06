import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { CountryCode } from 'libphonenumber-js';
import { ApiError, apiGet } from '../../../../core/api';
import { call, errorMessage } from '../../../../core/bridge';
import { text } from '../../../../core/i18n';
import { DEFAULT_REGION, formatPhone, toE164 } from '../../../../core/phone';
import { toast } from '../../../../core/toasts';
import { Icon } from '../../../../components/Icon';
import { Select } from '../../../../components/Select';
import { Button, Empty, ErrorNote, Spinner, TextField, cx } from '../../../../components/ui';
import { Note, Pill } from '../../../account/parts';
import { WA, type WaAccount } from '../../channels/whatsapp';
import { Area, Group } from './parts';
import {
  LABEL_MAX,
  MAX_NUMBERS,
  MESSAGE_MAX,
  SHOWS,
  accountsOf,
  connectionNote,
  connectionOf,
  defaultMessage,
  countryChoices,
  moveRow,
  newKey,
  numberOf,
  pickerChoices,
  refreshWidget,
  regionOf,
  rowName,
  rowProblems,
  rowsOf,
  sameNumbers,
  saveWhatsapp,
  savedText,
  serverIssues,
  showLabel,
  typedProblem,
  unlistedNames,
  waLink,
  whatsappOf,
  type RowIssues,
  type WaPickAccount,
  type WaRow,
  type WaShow,
  type WaSource,
  type WidgetWaNumber,
  type WidgetWaPayload,
} from './whatsappNumbers';

/**
 * Widget settings › Contact options (worksuite-desktop#260): the WhatsApp numbers the widget offers — a row each with
 * its label, number, where it comes from, Connected / Not connected for a WorkSuite number and when it shows; dragged
 * into order or moved with its arrows, tested (its `wa.me` link opens), edited and removed — and "+ Add WhatsApp
 * number", a WorkSuite number or one typed in with its country.
 *
 * Like Behaviour, it saves from the editor's header, so its state lives in `useWhatsapp()`, which the editor holds; the
 * Appearance tab's away screen reads the same list. Saving says when the change is live on the site, with "Refresh
 * widget now" where the server can end the widget's cache; the server's refusals show under the field they are about.
 */

export type WhatsappState = ReturnType<typeof useWhatsapp>;

/** The route is missing: a server from before #260 (404), or one that has it read-only (405). */
const notThere = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 405);

export function useWhatsapp(id: number, site: string, pickerOn: boolean) {
  const qc = useQueryClient();
  const key = useMemo(() => ['website', 'widget-whatsapp', id], [id]);
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => whatsappOf(id, signal), retry: false });
  // The WhatsApp module's numbers and where each stands (#35, #155) — unless the server sends the company's own with
  // the widget's, for an admin they are not shared with. Asked again every half minute while the tab is open.
  const own = q.data?.accounts;
  const wa = useQuery({
    queryKey: ['whatsapp', 'accounts', 'widget-picker'],
    queryFn: ({ signal }) => apiGet<{ accounts: WaAccount[] }>(`${WA}/accounts`, undefined, signal),
    enabled: pickerOn && Boolean(q.data) && !own,
    retry: false,
    staleTime: 30_000,
    refetchInterval: pickerOn ? 30_000 : false,
  });
  const accounts: WaPickAccount[] | null = own ?? wa.data?.accounts ?? null;
  const [draft, setDraft] = useState<WaRow[] | null>(null);
  const [server, setServer] = useState<{ rows: Record<string, RowIssues>; general: string | null }>({ rows: {}, general: null });
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  // A save the server had no route for: it was updated back, or never had the list.
  const [gone, setGone] = useState(false);

  const savedRows = useMemo(() => (q.data ? rowsOf(q.data.numbers) : null), [q.data]);
  const rows = draft ?? savedRows;
  const dirty = Boolean(draft && savedRows && !sameNumbers(draft, savedRows));
  const local = useMemo(() => (rows ? rowProblems(rows) : {}), [rows]);
  const issues: Record<string, RowIssues> = { ...server.rows };
  for (const [k, v] of Object.entries(local)) issues[k] = { ...issues[k], ...v };
  const blocked = Object.keys(local).length > 0;
  const missing = gone || notThere(q.error);
  const can = Boolean(q.data?.can_manage);

  const edit = (f: (rows: WaRow[]) => WaRow[]) => {
    setDraft((d) => {
      const base = d ?? savedRows;
      return base ? f(base) : d;
    });
    setServer({ rows: {}, general: null });
    setSaved(null);
  };

  const save = async () => {
    if (!rows || !dirty || blocked) return;
    setBusy(true);
    try {
      const fresh = await saveWhatsapp(id, rows);
      // An answer without the list keeps what was sent, so the screen never shows the numbers gone.
      const next: WidgetWaPayload = Array.isArray(fresh?.numbers) ? fresh : { ...(q.data as WidgetWaPayload), numbers: rows.map(({ key: _k, ...n }) => n) };
      qc.setQueryData<WidgetWaPayload>(key, next);
      setDraft(null);
      setServer({ rows: {}, general: null });
      const line = savedText(site, next.cache_seconds ?? q.data?.cache_seconds);
      setSaved(line);
      toast('success', line);
      // The away screen and its preview read the list too.
      void qc.invalidateQueries({ queryKey: ['website', 'widget-design', id] });
    } catch (e) {
      if (notThere(e)) setGone(true);
      else {
        const s = serverIssues(e, rows);
        if (Object.keys(s.rows).length || s.general) setServer(s);
        else toast('error', errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshWidget(id);
      toast('success', text('Widget refreshed: {site} shows the change on its next page load', { site }));
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  };

  return {
    q,
    wa,
    rows,
    accounts,
    issues,
    general: server.general,
    dirty,
    blocked,
    busy,
    missing,
    can,
    saved,
    refreshing,
    add: (n: WidgetWaNumber) => edit((rs) => [...rs, { ...n, key: newKey() }]),
    update: (k: string, n: WidgetWaNumber) => edit((rs) => rs.map((r) => (r.key === k ? { ...n, key: k } : r))),
    remove: (k: string) => edit((rs) => rs.filter((r) => r.key !== k)),
    move: (k: string, to: number | string) => edit((rs) => moveRow(rs, k, to)),
    undo: () => {
      setDraft(null);
      setServer({ rows: {}, general: null });
    },
    save,
    refresh,
  };
}

/** Contact options (#260): the WhatsApp card, or the server's need of an update. */
export function ContactTab({ w, site }: { w: WhatsappState; site: string }) {
  const [editing, setEditing] = useState<{ key: string | null; source: WaSource } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);

  if (w.q.isLoading) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  if (w.missing) {
    return (
      <div className="flex flex-1">
        <Empty
          icon="message-circle"
          title="Not on this server yet"
          hint="Update WorkSuite's Communication module to set the widget's WhatsApp numbers here. Until then, visitors see the one number on Appearance › Away screen."
        />
      </div>
    );
  }
  if (w.q.error || !w.q.data || !w.rows) return <div className="flex-1 p-6"><ErrorNote error={w.q.error} onRetry={() => void w.q.refetch()} /></div>;

  const rows = w.rows;
  const p = w.q.data;
  const choices = w.accounts ? pickerChoices(w.accounts) : null;
  const full = rows.length >= MAX_NUMBERS;
  const test = (r: Pick<WidgetWaNumber, 'phone' | 'message'>) => {
    const url = waLink(r.phone, r.message);
    if (url) void call('app:openExternal', { url }).catch((e) => toast('error', errorMessage(e)));
  };
  const close = () => {
    setEditing(null);
    setChoosing(false);
  };
  const editor = (key: string | null, source: WaSource) => {
    const row = key ? rows.find((r) => r.key === key) ?? null : null;
    return (
      <NumberEditor
        key={key ?? `new-${source}`}
        row={row}
        source={row?.source ?? source}
        site={site}
        choices={choices}
        unlisted={w.accounts ? unlistedNames(w.accounts) : []}
        loadingChoices={w.wa.isLoading}
        taken={rows.filter((r) => r.key !== key).map((r) => toE164(r.phone)).filter((x): x is string => Boolean(x))}
        onTest={test}
        onCancel={close}
        onDone={(n) => {
          if (key) w.update(key, n);
          else w.add(n);
          close();
        }}
      />
    );
  };

  return (
    <form
      aria-label="Contact options"
      onSubmit={(e) => {
        e.preventDefault();
        void w.save();
      }}
      className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto pb-4 scroll-thin"
    >
      <div className="flex max-w-[860px] flex-col gap-3">
        {!w.can ? <Note>You can look at these settings. Changing them needs the “Create and configure chat widgets” permission.</Note> : null}
        {w.saved ? (
          <Note tone="green" className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span role="status" className="flex-1">{w.saved}</span>
            {p.can_refresh ? (
              <Button type="button" size="sm" icon="refresh" loading={w.refreshing} disabled={w.refreshing} onClick={() => void w.refresh()}>Refresh widget now</Button>
            ) : null}
          </Note>
        ) : null}
        <Group title="WhatsApp">
          <div className="flex flex-col gap-3 py-2">
            <p className="text-[12.5px] text-ink-3">
              {text('Visitors see these as “Message us on WhatsApp”, each with its label, in this order. A WorkSuite number brings the reply into WorkSuite, linked to the visitor’s chat.')}
            </p>
            {rows.length ? (
              <ol aria-label="WhatsApp numbers" className="flex flex-col divide-y divide-line rounded-[10px] border border-line">
                {rows.map((r, i) =>
                  editing?.key === r.key ? (
                    <li key={r.key} className="p-3">{editor(r.key, r.source)}</li>
                  ) : (
                    <NumberRow
                      key={r.key}
                      r={r}
                      first={i === 0}
                      last={i === rows.length - 1}
                      can={w.can}
                      accounts={w.accounts}
                      issues={w.issues[r.key]}
                      dragging={dragging === r.key}
                      onDragStart={() => setDragging(r.key)}
                      onDragEnd={() => setDragging(null)}
                      onDrop={() => {
                        if (dragging && dragging !== r.key) w.move(dragging, r.key);
                        setDragging(null);
                      }}
                      dragActive={dragging !== null}
                      onMove={(d) => w.move(r.key, i + d)}
                      onTest={() => test(r)}
                      onEdit={() => {
                        setChoosing(false);
                        setEditing({ key: r.key, source: r.source });
                      }}
                      onRemove={() => w.remove(r.key)}
                    />
                  ),
                )}
              </ol>
            ) : (
              <p className="rounded-[10px] border border-dashed border-line p-3 text-[12.5px] text-ink-3">{text('No WhatsApp number yet: the widget shows none.')}</p>
            )}
            {w.general ? <span role="alert" className="text-[12px] text-danger">{w.general}</span> : null}
            {editing && editing.key === null ? editor(null, editing.source) : null}
            {w.can && !editing ? (
              choosing ? (
                <div role="group" aria-label="Add a WhatsApp number" className="flex flex-col gap-2 rounded-[10px] border border-line p-3">
                  <AddChoice icon="message-circle" title="Choose from WorkSuite WhatsApp" hint="A number connected in WhatsApp. Replies come into WorkSuite, linked to the visitor." onClick={() => setEditing({ key: null, source: 'worksuite' })} />
                  <AddChoice icon="phone" title="Enter a number" hint="Any WhatsApp number, such as a staff phone. Replies stay on that phone." onClick={() => setEditing({ key: null, source: 'manual' })} />
                  <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setChoosing(false)}>Cancel</Button>
                </div>
              ) : (
                <span className="flex items-center gap-3">
                  <Button type="button" size="sm" icon="plus" disabled={full} onClick={() => setChoosing(true)}>Add WhatsApp number</Button>
                  {full ? <span className="text-[12px] text-ink-3">{text('Up to {n} numbers', { n: MAX_NUMBERS })}</span> : null}
                </span>
              )
            ) : null}
          </div>
        </Group>
      </div>
    </form>
  );
}

function AddChoice({ icon, title, hint, onClick }: { icon: string; title: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-start gap-3 rounded-[8px] px-2 py-2 text-left hover:bg-subtle">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-success-bg text-success"><Icon name={icon} size={16} /></span>
      <span className="flex flex-col">
        <b className="text-[13px] text-ink">{title}</b>
        <span className="text-[12px] text-ink-3">{hint}</span>
      </span>
    </button>
  );
}

/** A number in the list: drag it by its grip, or move it with its arrows. */
function NumberRow({ r, first, last, can, accounts, issues, dragging, dragActive, onDragStart, onDragEnd, onDrop, onMove, onTest, onEdit, onRemove }: {
  r: WaRow;
  first: boolean;
  last: boolean;
  can: boolean;
  accounts: WaPickAccount[] | null;
  issues: RowIssues | undefined;
  dragging: boolean;
  dragActive: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onMove: (delta: number) => void;
  onTest: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const connected = connectionOf(r, accounts);
  const names = accountsOf(r, accounts).map((a) => a.name);
  const note = connectionNote(r, connected);
  const label = r.label.trim() || formatPhone(toE164(r.phone) ?? r.phone);
  const problems = [issues?.phone, issues?.label, issues?.message, issues?.show].filter(Boolean) as string[];
  return (
    <li
      aria-label={rowName(r)}
      draggable={can}
      onDragStart={(e) => {
        e.dataTransfer?.setData('text/plain', r.key);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        if (dragActive) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={cx('flex items-start gap-2.5 px-3 py-2.5', dragging && 'opacity-50')}
    >
      {can ? <span aria-hidden title={text('Drag to reorder')} className="mt-1 cursor-grab text-ink-3"><Icon name="grip" size={15} /></span> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <b className="truncate text-[13px] text-ink">{label}</b>
          <span className="text-[12.5px] text-ink-2">{formatPhone(toE164(r.phone) ?? r.phone)}</span>
          {connected === true ? <Pill tone="green" dot="#1F7A4D">Connected</Pill> : connected === false ? <Pill tone="red">Not connected</Pill> : null}
        </span>
        <span className="text-[12px] text-ink-3">
          {[r.source === 'worksuite' ? (names.length ? text('WorkSuite WhatsApp · {names}', { names: names.join(', ') }) : text('WorkSuite WhatsApp')) : text('Entered number'), showLabel(r.show)].join(' · ')}
        </span>
        {problems.map((m) => <span key={m} role="alert" className="text-[12px] text-danger">{m}</span>)}
        {note ? <span className="text-[12px] text-warning">{note}</span> : null}
      </div>
      <span className="flex shrink-0 items-center gap-0.5">
        {can ? (
          <>
            <Button type="button" size="sm" variant="ghost" icon="arrow-up" aria-label={text('Move {name} up', { name: label })} disabled={first} onClick={() => onMove(-1)} />
            <Button type="button" size="sm" variant="ghost" icon="arrow-down" aria-label={text('Move {name} down', { name: label })} disabled={last} onClick={() => onMove(1)} />
          </>
        ) : null}
        <Button type="button" size="sm" variant="ghost" icon="external" aria-label={text('Test {name}', { name: label })} title={text('Opens the wa.me link')} disabled={!toE164(r.phone)} onClick={onTest}>Test</Button>
        {can ? (
          <>
            <Button type="button" size="sm" variant="ghost" icon="pen" aria-label={text('Edit {name}', { name: label })} onClick={onEdit} />
            <Button type="button" size="sm" variant="ghost" icon="trash" aria-label={text('Remove {name}', { name: label })} onClick={onRemove} />
          </>
        ) : null}
      </span>
    </li>
  );
}

/**
 * Adding or editing one number: the WorkSuite number (each once, with its names and connection) or the country and
 * the number typed, then its label, message and when it shows. Its problems are shown under each field once the
 * person has tried to add it, or has left the number's field.
 */
function NumberEditor({ row, source, site, choices, unlisted, loadingChoices, taken, onTest, onCancel, onDone }: {
  row: WaRow | null;
  source: WaSource;
  site: string;
  choices: ReturnType<typeof pickerChoices> | null;
  unlisted: string[];
  loadingChoices: boolean;
  taken: string[];
  onTest: (n: Pick<WidgetWaNumber, 'phone' | 'message'>) => void;
  onCancel: () => void;
  onDone: (n: WidgetWaNumber) => void;
}) {
  const [picked, setPicked] = useState<string | null>(source === 'worksuite' && row ? toE164(row.phone) : null);
  const [region, setRegion] = useState<CountryCode>(row && source === 'manual' ? regionOf(toE164(row.phone)) : DEFAULT_REGION);
  const [typed, setTyped] = useState(row && source === 'manual' ? formatPhone(toE164(row.phone) ?? row.phone) : '');
  const [label, setLabel] = useState(row?.label ?? '');
  const [message, setMessage] = useState(row?.message ?? defaultMessage(site));
  const [show, setShow] = useState<WaShow>(row?.show ?? 'always');
  const [tried, setTried] = useState(false);
  const [left, setLeft] = useState(false);

  const choice = source === 'worksuite' ? choices?.find((c) => c.phone === picked) ?? null : null;
  // A WorkSuite number being edited that is not shared with this person stays as it is, and can still be relabelled.
  const kept = !choice && row?.source === 'worksuite' && row.account_id && picked && picked === toE164(row.phone) ? row : null;
  const options = [
    ...(choices ?? []).map((c) => ({ value: c.phone, label: `${formatPhone(c.phone)} · ${c.names.join(', ')}`, hint: c.connected ? text('Connected') : text('Not connected') })),
    ...(kept && picked ? [{ value: picked, label: `${formatPhone(picked)} · ${kept.label}` }] : []),
  ];
  const phone = source === 'worksuite' ? (choice?.phone ?? (kept ? picked : null)) : numberOf(typed, region);
  const phoneProblem =
    source === 'worksuite'
      ? (choice || kept ? null : text('Choose a WorkSuite WhatsApp number'))
      : typedProblem(typed, region);
  const problem = phoneProblem ?? (phone && taken.includes(phone) ? text('This number is already on the list') : null);
  const labelProblem = !label.trim() ? text('Give it a label, like Sales or Support') : null;
  const shows = SHOWS.filter((s) => source === 'worksuite' || s.value !== 'connected');
  const note = choice ? connectionNote({ source, show }, choice.connected) : null;
  // "0769 136 424" is kept as +94769136424: said under the field, so nobody wonders what was stored.
  const converted = source === 'manual' && phone && phone !== typed.replace(/[\s().-]/g, '') ? text('Saved as {n}', { n: formatPhone(phone) }) : null;

  const done = () => {
    setTried(true);
    if (problem || labelProblem || !phone) return;
    onDone({
      ...(row?.id ? { id: row.id } : {}),
      source,
      account_id: source === 'worksuite' ? (choice?.account_id ?? kept?.account_id ?? null) : null,
      phone,
      label: label.trim(),
      message: message.trim(),
      show,
      ...(source === 'worksuite' ? { connected: choice ? choice.connected : (kept?.connected ?? null) } : {}),
    });
  };

  return (
    <div role="group" aria-label={row ? text('Edit {name}', { name: row.label || row.phone }) : text('New WhatsApp number')} className="flex flex-col gap-3 rounded-[10px] border border-line bg-surface p-3">
      {source === 'worksuite' ? (
        <div className="flex flex-col gap-1">
          <span className="text-[12.5px] font-semibold text-ink-2">WorkSuite WhatsApp number</span>
          {loadingChoices && !choices ? <Spinner label={text('Reading the WhatsApp numbers…')} className="justify-start p-0" /> : null}
          {options.length ? (
            <Select<string>
              aria-label="WorkSuite WhatsApp number"
              placeholder={text('Choose a number')}
              value={picked}
              onValueChange={(v) => {
                setPicked(v);
                const c = choices?.find((x) => x.phone === v);
                if (c && !label.trim()) setLabel(c.names[0] ?? '');
              }}
              options={options}
            />
          ) : !loadingChoices ? (
            <span className="text-[12px] text-ink-3">
              {choices ? text('No WorkSuite WhatsApp number to choose. Connect one in Chat › WhatsApp, or enter a number.') : text("WorkSuite's WhatsApp numbers can't be read here. Enter the number instead.")}
            </span>
          ) : null}
          {unlisted.length ? <span className="text-[12px] text-ink-3">{text('Not listed until a number is linked: {names}', { names: unlisted.join(', ') })}</span> : null}
          {tried && problem ? <span role="alert" className="text-[12px] text-danger">{problem}</span> : null}
          {note ? <span className="text-[12px] text-warning">{note}</span> : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-ink-2">Country</span>
            <Select<CountryCode> aria-label="Country" className="w-[220px]" searchable value={region} onValueChange={setRegion} options={countryChoices()} />
          </div>
          <TextField
            label="WhatsApp number"
            className="min-w-[200px] flex-1"
            inputMode="tel"
            value={typed}
            maxLength={32}
            placeholder="077 123 4567"
            onChange={(e) => setTyped(e.target.value)}
            onBlur={() => setLeft(true)}
            error={(tried || (left && typed.trim())) && problem ? problem : null}
            hint={converted ?? undefined}
          />
        </div>
      )}
      <TextField label="Label" value={label} maxLength={LABEL_MAX} placeholder="Sales" onChange={(e) => setLabel(e.target.value)} error={tried ? labelProblem : null} />
      <Area label="Pre-filled message" value={message} max={MESSAGE_MAX} onChange={setMessage} hint={text('What the visitor’s WhatsApp opens with. {visitor_ref} becomes their reference, which links their message to this chat.')} />
      <div className="flex flex-col gap-1">
        <span className="text-[12.5px] font-semibold text-ink-2">When to show</span>
        <Select<WaShow> aria-label="When to show" className="w-[280px]" value={show} onValueChange={setShow} options={shows.map((s) => ({ value: s.value, label: text(s.label) }))} />
      </div>
      <span className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" size="sm" onClick={done}>{row ? 'Done' : 'Add number'}</Button>
        <Button type="button" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="button" size="sm" variant="ghost" icon="external" disabled={!phone} onClick={() => phone && onTest({ phone, message })}>Test</Button>
      </span>
    </div>
  );
}
