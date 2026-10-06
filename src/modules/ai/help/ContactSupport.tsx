import { useEffect, useState } from 'react';
import { SUPPORT_API, ticketRoute, type Ticket } from '@shared/support';
import { Checkbox } from '../../../components/Checkbox';
import { Icon } from '../../../components/Icon';
import { Button, Modal, cx } from '../../../components/ui';
import { ApiError, apiPost, request } from '../../../core/api';
import { canOpen } from '../../../core/access';
import { app } from '../../../core/app-state';
import { call } from '../../../core/bridge';
import { LANGUAGES, useLanguage } from '../../../core/i18n';
import { useStore } from '../../../core/store';
import { navigate } from '../../../core/tabs';
import { bytes, relative } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { StatusChip } from '../../support/parts';

/**
 * Help & Guide › Contact Support and Report an Issue (WS-SUPPORT-SRS-001 D-11; FR-DSK-09, FR-SEC-05, FR-DSK-06/07,
 * FR-CRT-03): a real ticket at the help desk the installation names (`POST /api/desktop/support`), its reference shown
 * once it is raised.
 *
 *  - What it is (a question, a problem, a feature request), a subject and the message.
 *  - Diagnostics, each a box the person can untick: the app's version, the operating system, the screen they are on,
 *    and the last day's log — redacted as it is written, the newest 8 KB. "Everything shown is what will be sent",
 *    and View exact payload shows the request word for word. Passwords, tokens and message bodies are never in it.
 *  - Capture this window: a picture of the window behind the dialog (the dialog steps aside while it is taken), sent
 *    with the request, removable before it goes.
 *  - Offline, the request waits in the outbox and goes when WorkSuite is back (FR-DSK-07) — without the picture,
 *    which the outbox cannot carry; the dialog says so. A server without the route still gets the text to copy.
 *  - My requests: the person's requests raised this way — kept on this computer when raised, and, for somebody who
 *    reads the desk, found there too (`GET tickets?view=all&source=desktop`) with their status; one they can open
 *    opens in its ticket tab.
 */

export type SupportKind = 'support' | 'issue';
export type RequestType = 'question' | 'problem' | 'feature';

const TYPE_LABEL: Record<RequestType, string> = { question: 'Question', problem: 'Problem', feature: 'Feature request' };

const languageName = (id: string) => (LANGUAGES.find((l) => l.id === id)?.label ?? id).replace(/^.*\((.*)\)$/, '$1');

/* ── my requests, kept on this computer ─────────────────────────────────── */

export interface MyRequest {
  id: number | null;
  reference: string | null;
  subject: string;
  at: string;
  /** Waiting in the outbox: no reference yet. */
  queued?: boolean;
}

const requestsKey = (user: string | number) => `ws.supportRequests.${user}`;
const MAX_REQUESTS = 20;

export function readMyRequests(user: string | number | null | undefined): MyRequest[] {
  if (user == null) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(requestsKey(user)) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((r): r is MyRequest => !!r && typeof r.subject === 'string' && typeof r.at === 'string') : [];
  } catch {
    return [];
  }
}

export function noteMyRequest(user: string | number | null | undefined, r: MyRequest): void {
  if (user == null) return;
  const list = [r, ...readMyRequests(user).filter((x) => x.id === null || x.id !== r.id)].slice(0, MAX_REQUESTS);
  try {
    localStorage.setItem(requestsKey(user), JSON.stringify(list));
  } catch {
    // Storage full or blocked: the request was sent all the same; it is just not listed here.
  }
}

/** The list as shown: the desk's copy of each (with its status) first-hand where it has one, newest first. */
export function mergeRequests(local: MyRequest[], desk: Ticket[]): Array<MyRequest & { status: Ticket['status'] | null }> {
  const out = new Map<string, MyRequest & { status: Ticket['status'] | null }>();
  for (const t of desk) out.set(`id:${t.id}`, { id: t.id, reference: t.reference, subject: t.subject, at: t.created_at ?? '', status: t.status });
  local.forEach((r, i) => {
    const key = r.id !== null ? `id:${r.id}` : `local:${i}`;
    if (!out.has(key)) out.set(key, { ...r, status: null });
  });
  return [...out.values()].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
}

/** The desk's tickets raised from the desktop by me, for somebody who reads the desk; none otherwise. */
async function deskRequests(email: string | null, signal?: AbortSignal): Promise<Ticket[]> {
  if (!email) return [];
  try {
    const r = await request<{ items?: Ticket[] }>('GET', `${SUPPORT_API}/tickets`, { query: { view: 'all', source: 'desktop', q: email, limit: 20 }, signal });
    return (r.data.items ?? []).filter((t) => (t.requester.email ?? '').toLowerCase() === email.toLowerCase());
  } catch {
    return [];
  }
}

/** My requests (D-11): what I raised from Help & Guide, newest first, with the desk's status where I can read it. */
export function MyRequests({ className, refresh = 0 }: { className?: string; refresh?: number }) {
  const user = useStore(app, (s) => s.auth?.user?.id ?? null);
  const email = useStore(app, (s) => s.auth?.user?.email ?? null);
  // Without a query client of its own to lean on (Help & Guide lives outside the module screens): asked once a showing.
  const [desk, setDesk] = useState<Ticket[]>([]);
  const may = canOpen('support');
  useEffect(() => {
    if (!may) return;
    const ac = new AbortController();
    void deskRequests(email, ac.signal).then((t) => !ac.signal.aborted && setDesk(t));
    return () => ac.abort();
  }, [may, email, user, refresh]);
  const list = mergeRequests(readMyRequests(user), desk).slice(0, 8);
  if (!list.length) return null;
  const open = (r: MyRequest & { status: Ticket['status'] | null }) => {
    if (r.id && r.status && canOpen('support')) navigate(ticketRoute(r.id));
    else if (r.reference) void navigator.clipboard?.writeText(r.reference).then(() => toast('success', `Copied ${r.reference}.`));
  };
  return (
    <section aria-label="My requests" className={cx('space-y-1', className)}>
      <div className="text-[10.5px] font-bold tracking-[0.6px] text-ink-3 uppercase">My requests</div>
      <ul className="space-y-0.5">
        {list.map((r, i) => (
          <li key={r.id ?? `q${i}`}>
            <button type="button" onClick={() => open(r)} disabled={!r.reference} title={r.status && canOpen('support') ? 'Open the ticket' : r.reference ? 'Copy the reference' : undefined} className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1 text-left text-[12.5px] text-ink hover:bg-subtle disabled:hover:bg-transparent">
              <span className="w-[86px] shrink-0 font-mono text-[11.5px] text-ink-2">{r.reference ?? '—'}</span>
              <span className="min-w-0 flex-1 truncate">{r.subject}</span>
              {r.status ? <StatusChip status={r.status} /> : <span className="shrink-0 text-[11px] text-ink-3">{r.queued ? 'In the outbox' : relative(r.at)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── the request ────────────────────────────────────────────────────────── */

export interface RequestInput {
  type: RequestType;
  subject: string;
  body: string;
  include: { version: boolean; os: boolean; screen: boolean; logs: boolean };
  info: { version: string; platform: string; arch?: string; osVersion: string; channel?: string } | null;
  screen: string | null;
  language: string;
  logs: string | null;
}

/** The kind the server takes: a problem is an incident (`issue`), anything else a question (`support`). */
export function kindOf(type: RequestType): SupportKind {
  return type === 'problem' ? 'issue' : 'support';
}

/** The JSON body of `POST /api/desktop/support`, exactly as it goes: the log, when ticked, is part of the message. */
export function requestPayload(r: RequestInput): { kind: SupportKind; subject: string; body: string; details: Record<string, string | null> } {
  const body = [r.body.trim(), r.include.logs && r.logs ? `— Recent log (last 24 h, redacted) —\n${r.logs}` : null].filter(Boolean).join('\n\n');
  return {
    kind: kindOf(r.type),
    subject: r.type === 'feature' && !/^feature request/i.test(r.subject.trim()) ? `Feature request: ${r.subject.trim()}` : r.subject.trim(),
    body,
    details: {
      version: r.include.version && r.info ? r.info.version : null,
      platform: r.include.version && r.info ? [r.info.platform, r.info.arch].filter(Boolean).join(' ') : null,
      os: r.include.os && r.info ? r.info.osVersion : null,
      screen: r.include.screen ? r.screen : null,
      language: r.language,
    },
  };
}

/** The same request as a form, with the window's picture as `files[]`. */
export function requestForm(payload: ReturnType<typeof requestPayload>, capture: { name: string; blob: Blob } | null): FormData {
  const form = new FormData();
  form.append('kind', payload.kind);
  form.append('subject', payload.subject);
  form.append('body', payload.body);
  for (const [k, v] of Object.entries(payload.details)) if (v !== null) form.append(`details[${k}]`, v);
  if (capture) form.append('files[]', capture.blob, capture.name);
  return form;
}

function fromBase64(data: string, type: string): Blob {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type });
}

type Phase = { phase: 'edit' | 'sending' | 'capturing'; error?: string } | { phase: 'fallback'; why: string } | { phase: 'sent'; reference: string | null; id: number | null; queued: boolean; captureKept: boolean | null };

/**
 * Contact Support / Report an Issue: everything that would be sent, shown and editable first, and each piece of
 * context the person can leave out.
 */
export function SupportDialog({ kind, question, screen, onClose }: { kind: SupportKind; question?: string; screen: string | null; onClose: () => void }) {
  const info = useStore(app, (s) => s.info);
  const user = useStore(app, (s) => s.auth?.user ?? null);
  const language = useLanguage();
  const [type, setType] = useState<RequestType>(kind === 'issue' ? 'problem' : 'question');
  const [subject, setSubject] = useState(kind === 'issue' ? 'Something is not working' : question ? `Help with: ${question.slice(0, 80)}` : 'Help with WorkSuite');
  const [body, setBody] = useState(question ? `I asked the assistant: “${question}”\n\n` : '');
  const [include, setInclude] = useState({ version: true, os: true, screen: !!screen, logs: false });
  const [capture, setCapture] = useState<{ name: string; blob: Blob; size: number; url: string | null } | null>(null);
  const [state, setState] = useState<Phase>({ phase: 'edit' });
  const [logs, setLogs] = useState<{ text: string; lines: number; bytes: number } | null>(null);
  useEffect(() => {
    let alive = true;
    call('help:logs').then(
      (l) => alive && l && setLogs(l),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  const logText = logs?.text || null;
  useEffect(() => () => {
    if (capture?.url) URL.revokeObjectURL(capture.url);
  }, [capture]);

  const input: RequestInput = { type, subject, body, include, info: info ? { version: info.version, platform: info.platform, arch: info.arch, osVersion: info.osVersion, channel: info.channel } : null, screen, language: languageName(language), logs: logText };
  const payload = requestPayload(input);
  const details = [
    payload.details.version ? `WorkSuite Desktop ${payload.details.version} · ${payload.details.platform}` : null,
    payload.details.os ? `Operating system: ${payload.details.os}` : null,
    payload.details.screen ? `Screen: ${payload.details.screen}` : null,
    `Language: ${payload.details.language}`,
  ].filter(Boolean) as string[];
  const text = `${payload.subject}\n\n${payload.body}\n\n${details.join('\n')}`;
  const exact = JSON.stringify({ ...payload, ...(capture ? { 'files[]': `${capture.name} (${bytes(capture.size)})` } : {}) }, null, 2);

  const takeCapture = async () => {
    // The dialog steps aside for a moment, so the picture is of the window behind it.
    setState({ phase: 'capturing' });
    await new Promise((r) => setTimeout(r, 120));
    try {
      const c = await call('help:capture');
      const blob = fromBase64(c.data, 'image/png');
      if (capture?.url) URL.revokeObjectURL(capture.url);
      setCapture({ name: c.name, blob, size: blob.size, url: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null });
      setState({ phase: 'edit' });
    } catch (e) {
      setState({ phase: 'edit', error: e instanceof Error ? e.message : 'The window could not be captured.' });
    }
  };

  const done = (r: { id: number | null; reference: string | null; queued: boolean; captureKept: boolean | null }) => {
    noteMyRequest(user?.id, { id: r.id, reference: r.reference, subject: payload.subject, at: new Date().toISOString(), queued: r.queued });
    setState({ phase: 'sent', ...r });
  };

  const send = async () => {
    setState({ phase: 'sending' });
    try {
      const r = capture
        ? (await request<{ id?: number; reference?: string | null; files?: number }>('POST', '/api/desktop/support', { body: requestForm(payload, capture) })).data
        : await apiPost<{ id?: number; reference?: string | null }>('/api/desktop/support', payload);
      const kept = capture ? ((r as { files?: number })?.files ?? 0) > 0 : null;
      done({ id: typeof r?.id === 'number' ? r.id : null, reference: r?.reference ?? null, queued: false, captureKept: kept });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 405)) {
        setState({ phase: 'fallback', why: 'Your WorkSuite server does not take support requests from the desktop yet.' });
      } else if (e instanceof ApiError && e.offline) {
        // The outbox keeps it (encrypted) and sends it when WorkSuite is back: never "copy this instead".
        try {
          const q = await call('offline:submit', { module: 'ai', entity: 'help-request', entityId: null, label: `Help request · ${payload.subject}`.slice(0, 200), method: 'POST', path: '/api/desktop/support', body: payload, queueIfOffline: true });
          if (q.queued || q.delivered) done({ id: null, reference: null, queued: !!q.queued, captureKept: capture ? false : null });
          else setState({ phase: 'edit', error: q.error ?? 'It could not be kept to send later.' });
        } catch (err) {
          setState({ phase: 'edit', error: err instanceof Error ? err.message : 'It could not be kept to send later.' });
        }
      } else {
        setState({ phase: 'edit', error: e instanceof Error ? e.message : 'It could not be sent.' });
      }
    }
  };

  if (state.phase === 'capturing') return null;
  const title = type === 'problem' ? 'Report an Issue' : 'Contact Support';
  const sending = state.phase === 'sending';

  return (
    <Modal
      title={title}
      labelledBy="support-dialog-title"
      onClose={onClose}
      width={600}
      footer={
        state.phase === 'fallback' ? (
          <>
            <Button icon="copy" onClick={() => void navigator.clipboard.writeText(text).then(() => toast('success', 'Copied.'))}>
              Copy the details
            </Button>
            <Button onClick={() => (onClose(), navigate('/diagnostics'))}>Open Diagnostics</Button>
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </>
        ) : state.phase === 'sent' ? (
          <>
            {state.reference ? (
              <Button icon="copy" className="mr-auto" onClick={() => void navigator.clipboard.writeText(state.reference!).then(() => toast('success', `Copied ${state.reference}.`))}>
                Copy reference
              </Button>
            ) : null}
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            <span className="mr-auto min-w-0 truncate text-[11.5px] text-ink-3">{user?.email ? `From ${user.email}` : 'Nothing is sent until you choose Send.'}</span>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon="send" loading={sending} disabled={!subject.trim() || !body.trim()} onClick={() => void send()}>
              Send
            </Button>
          </>
        )
      }
    >
      {state.phase === 'fallback' ? (
        <div className="space-y-2 text-[13px] text-ink-2">
          <p role="alert">{state.why} Copy the details and send them to your administrator or WorkSuite support, or save a diagnostic report from Diagnostics.</p>
          <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap rounded-[8px] bg-subtle p-2.5 text-[12px] text-ink selectable">{text}</pre>
        </div>
      ) : state.phase === 'sent' ? (
        <div className="space-y-3 text-[13px] text-ink-2">
          <div role="status" className="rounded-[10px] bg-success-bg px-3 py-2.5 text-success">
            {state.queued ? (
              <b className="block">You are offline: your request is in the outbox and goes when WorkSuite is back.</b>
            ) : state.reference ? (
              <b className="block">
                Sent — your reference is <span className="font-mono">{state.reference}</span>
              </b>
            ) : (
              <b className="block">Sent. Support will get back to you.</b>
            )}
            {!state.queued && user?.email ? <span className="mt-0.5 block text-[12.5px]">Replies come to {user.email}.</span> : null}
          </div>
          {state.captureKept === false ? <p className="text-[12.5px] text-ink-3">{state.queued ? 'The window capture is not kept in the outbox: attach it when you reply.' : 'Your WorkSuite server did not keep the window capture: attach it when you reply to the confirmation.'}</p> : null}
          {state.id && canOpen('support') ? (
            <Button size="sm" icon="external" onClick={() => (onClose(), navigate(ticketRoute(state.id!)))}>
              Open the ticket
            </Button>
          ) : null}
          <MyRequests refresh={1} />
        </div>
      ) : (
        <div className="space-y-3 text-[13px]">
          {state.error ? (
            <p role="alert" className="rounded-[8px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">
              {state.error}
            </p>
          ) : null}
          <div role="radiogroup" aria-label="Type" className="flex flex-wrap gap-1.5">
            {(Object.keys(TYPE_LABEL) as RequestType[]).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)} className={cx('h-7 rounded-full border px-3 text-[12.5px] font-semibold', type === t ? 'border-primary bg-selection text-primary' : 'border-line text-ink-2 hover:bg-subtle')}>
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-ink-2">Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-9 rounded-[8px] border border-line bg-surface px-3 text-ink outline-none focus:border-primary" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-ink-2">{type === 'problem' ? 'What happened, and what you expected' : type === 'feature' ? 'What you would like WorkSuite to do' : 'How can we help?'}</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} autoFocus className="rounded-[8px] border border-line bg-surface p-2.5 text-ink outline-none focus:border-primary" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {capture ? (
              <span className="inline-flex items-center gap-2 rounded-[8px] border border-line py-1 pr-1 pl-1.5 text-[12px]">
                {capture.url ? <img src={capture.url} alt="" className="h-7 w-10 rounded-[4px] object-cover" /> : <Icon name="file-image" size={16} className="text-ink-3" />}
                <span className="font-semibold text-ink">{capture.name}</span>
                <span className="text-ink-3">{bytes(capture.size)}</span>
                <button type="button" aria-label={`Remove ${capture.name}`} onClick={() => setCapture(null)} className="rounded-[6px] p-1 text-ink-3 hover:bg-subtle hover:text-ink">
                  <Icon name="x" size={13} />
                </button>
              </span>
            ) : null}
            <Button size="sm" variant="ghost" icon="camera" onClick={() => void takeCapture()}>
              {capture ? 'Capture again' : 'Capture this window'}
            </Button>
          </div>
          <fieldset className="space-y-1">
            <legend className="text-[12.5px] font-semibold text-ink-2">Diagnostics to include</legend>
            <label className="flex items-center gap-2 text-ink-2">
              <Checkbox checked={include.version} onChange={(e) => setInclude({ ...include, version: e.target.checked })} />
              The app version ({info ? `WorkSuite Desktop ${info.version} · ${info.platform} ${info.arch ?? ''}`.trim() + ')' : 'unknown)'}
            </label>
            <label className="flex items-center gap-2 text-ink-2">
              <Checkbox checked={include.os} onChange={(e) => setInclude({ ...include, os: e.target.checked })} />
              The operating system ({info?.osVersion ?? 'unknown'})
            </label>
            {screen ? (
              <label className="flex items-center gap-2 text-ink-2">
                <Checkbox checked={include.screen} onChange={(e) => setInclude({ ...include, screen: e.target.checked })} />
                The screen you are on ({screen})
              </label>
            ) : null}
            {logText ? (
              <label className="flex items-center gap-2 text-ink-2">
                <Checkbox checked={include.logs} onChange={(e) => setInclude({ ...include, logs: e.target.checked })} />
                The app’s log of the last 24 h ({logs!.lines} lines · {bytes(logs!.bytes)} · tokens redacted)
              </label>
            ) : null}
          </fieldset>
          <p className="text-[11.5px] text-ink-3">Everything shown is what will be sent. Passwords, tokens and message bodies are never included.</p>
          <details className="text-[12px] text-ink-3">
            <summary className="cursor-pointer">Exactly what will be sent</summary>
            <pre className="mt-1 max-h-[160px] overflow-auto whitespace-pre-wrap rounded-[8px] bg-subtle p-2.5 text-ink selectable">{text}</pre>
          </details>
          <details className="text-[12px] text-ink-3">
            <summary className="cursor-pointer">View exact payload</summary>
            <pre className="mt-1 max-h-[200px] overflow-auto whitespace-pre-wrap rounded-[8px] bg-subtle p-2.5 font-mono text-[11px] text-ink selectable">{exact}</pre>
          </details>
        </div>
      )}
    </Modal>
  );
}
