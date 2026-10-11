import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { call, errorMessage } from '../../../core/bridge';
import { timeLabel } from '../../../core/time';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Button, ErrorNote, Spinner, cx } from '../../../components/ui';
import { Checkbox } from '../../../components/Checkbox';
import { Select } from '../../../components/Select';
import { quickRoute } from '@shared/support';
import { SUPPORT_OUTCOMES, controlLine, fileState, type SupportOutcome } from '@shared/support-session';
import { support, type AiDraft, type SupportPanel as Panel } from './api';
import { SupportCodeDialog } from './SupportCodeDialog';

/**
 * A support session's own tab, beside the meeting (WS-MEET-ENH-01 RC10 and
 * RC17).
 *
 * Three things, in the order somebody in a session needs them: **Session** —
 * who is being helped, the ticket, the computer, what control was allowed and
 * by whom, the files and the security check; **Notes** — the agent's own, and
 * the only thing besides the chat that AI assist reads; **AI assist** —
 * drafts, marked as drafts, kept nowhere until the agent says so.
 *
 * Every fact is the server's. This screen computes nothing about the session:
 * whether AI assist exists at all, whether the reader is the agent, and
 * whether the notes may be read are all decided there and simply obeyed here.
 * The person being helped is served a panel with no notes and no AI in it, so
 * there is nothing to hide in the client.
 */

type Tab = 'session' | 'notes' | 'ai';

export function SessionPanel({ uuid }: { uuid: string }) {
  const q = useQuery({ queryKey: ['support-panel', uuid], queryFn: ({ signal }) => support.panel(uuid, signal), refetchInterval: 10_000 });
  const [tab, setTab] = useState<Tab>('session');
  const p = q.data;

  if (q.isLoading) return <div className="flex h-40 items-center justify-center"><Spinner /></div>;
  if (!p) return <div className="p-3"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div>;

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'session', label: 'Session' },
    ...(p.is_agent ? [{ id: 'notes' as Tab, label: 'Notes' }] : []),
    ...(p.is_agent && p.ai?.enabled ? [{ id: 'ai' as Tab, label: 'AI assist' }] : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {tabs.length > 1 ? (
        <div role="tablist" aria-label="Support session" className="m-2.5 flex gap-1 rounded-[10px] bg-subtle p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cx('flex-1 rounded-[8px] px-2 py-1.5 text-[12.5px] font-semibold', tab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scroll-thin">
        {tab === 'session' ? <SessionTab p={p} uuid={uuid} /> : null}
        {tab === 'notes' ? <NotesTab p={p} uuid={uuid} /> : null}
        {tab === 'ai' ? <AiTab p={p} uuid={uuid} /> : null}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-3 border-b border-line py-2.5 text-[13px] last:border-0">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}

function SessionTab({ p, uuid }: { p: Panel; uuid: string }) {
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState<SupportOutcome>('resolved');
  const [ending, setEnding] = useState(false);
  const [coding, setCoding] = useState(false);
  const control = controlLine(p.control);
  const ticket = p.ticket;

  const end = async () => {
    setEnding(true);
    try {
      const r = await support.end(uuid, outcome);
      toast('success', `Support session ended after ${Math.max(1, Math.round(r.seconds / 60))} min.`);
      await qc.invalidateQueries({ queryKey: ['support-panel', uuid] });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setEnding(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2.5 py-2">
        <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-selection text-primary">
          <Icon name="life-buoy" size={20} />
        </span>
        <span className="flex min-w-0 flex-col">
          <b className="truncate text-[15px] text-ink">{p.supported?.name ?? 'Waiting for them to join'}</b>
          <span className="truncate text-[12px] text-ink-3">{p.is_agent ? 'Being helped' : `Helped by ${p.agent.name ?? 'support'}`}</span>
        </span>
      </div>

      {/* What control is doing, in words, before the details: it is the thing
        * somebody in a support session most wants to know. */}
      <div className={cx('mb-2 rounded-[10px] border px-3 py-2 text-[12.5px] leading-relaxed', control.state === 'live' ? 'border-warning/40 bg-warning-bg text-ink' : 'border-line bg-surface text-ink-2')}>
        <span className="flex items-start gap-2">
          <Icon name={control.state === 'none' ? 'shield-check' : control.state === 'paused' ? 'pause' : 'screen-share'} size={15} className={control.state === 'none' ? 'mt-0.5 text-success' : 'mt-0.5 text-warning'} />
          {control.text}
        </span>
      </div>

      <dl>
        {ticket ? (
          <Row label="Ticket">
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <button type="button" onClick={() => void call('windows:open', { kind: 'support-quick', route: quickRoute(ticket.id), title: ticket.reference })} className="font-semibold text-primary hover:underline">
                {ticket.reference}
              </button>
              <span className="text-ink-2">· {ticket.subject}</span>
              <span className="text-ink-3">· {ticket.priority}</span>
            </span>
          </Row>
        ) : null}
        <Row label="Agent">{p.agent.name ?? '—'}</Row>
        <Row label="Reason">{p.reason || '—'}</Row>
        <Row label="Computer">{p.device ?? 'Not sharing a computer yet'}</Row>
        <Row label="Started">
          {timeLabel(p.started_at) || '—'}
          {p.control?.approved_at ? ` · control allowed ${timeLabel(p.control.approved_at)}` : ''}
        </Row>
        <Row label="Recording">{p.recording}</Row>
        <Row label="Files">
          {p.files.length === 0 ? (
            'None'
          ) : (
            <ul className="space-y-0.5">
              {p.files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="truncate">
                  {f.name} · {fileState(f.status)}
                  {f.at ? ` · ${timeLabel(f.at)}` : ''}
                </li>
              ))}
            </ul>
          )}
        </Row>
        {p.ended_at ? (
          <Row label="Ended">
            {timeLabel(p.ended_at)}
            {p.outcome ? ` · ${SUPPORT_OUTCOMES.find((o) => o.id === p.outcome)?.label ?? p.outcome}` : ''}
          </Row>
        ) : null}
      </dl>

      {/* RC11: the way to get somebody into this session who has no link —
        * read out nine digits. Offered only while there is a session to join. */}
      {p.is_agent && !p.ended_at ? (
        <Button className="mt-3 w-full" variant="ghost" icon="keyboard" onClick={() => setCoding(true)}>
          {p.supported ? 'Invite somebody else with a code' : 'Invite with a code'}
        </Button>
      ) : null}
      {coding ? <SupportCodeDialog uuid={uuid} agent={p.agent.name} onClose={() => setCoding(false)} /> : null}

      {p.is_agent && !p.ended_at ? (
        <div className="mt-3 rounded-[10px] border border-line bg-surface p-3">
          <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-ink">
            How did it go?
            <Select value={outcome} onValueChange={(v) => setOutcome(v as SupportOutcome)} options={SUPPORT_OUTCOMES.map((o) => ({ value: o.id, label: o.label }))} aria-label="How did it go?" />
          </label>
          <p className="mt-1.5 text-[12px] text-ink-3">{SUPPORT_OUTCOMES.find((o) => o.id === outcome)?.hint}</p>
          <Button className="mt-2.5 w-full" variant="danger" loading={ending} onClick={() => void end()}>
            End session
          </Button>
          <p className="mt-1.5 text-[12px] text-ink-3">
            Control ends and the meeting closes for everyone.{p.ticket ? ` ${p.ticket.reference} is told how it went.` : ''}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function NotesTab({ p, uuid }: { p: Panel; uuid: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState(p.notes ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saved = useRef(p.notes ?? '');

  const save = async () => {
    if (text === saved.current) return;
    setState('saving');
    try {
      await support.notes(uuid, text);
      saved.current = text;
      setState('saved');
      await qc.invalidateQueries({ queryKey: ['support-panel', uuid] });
    } catch (e) {
      setState('idle');
      toast('error', errorMessage(e));
    }
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <label htmlFor="support-notes" className="text-[12px] text-ink-3">
        Your notes — only you and AI assist read them. Saved when you click away.
      </label>
      <textarea
        id="support-notes"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setState('idle');
        }}
        onBlur={() => void save()}
        rows={14}
        className="min-h-[14rem] flex-1 resize-none rounded-[10px] border border-line bg-surface p-3 text-[13px] text-ink outline-none focus:border-primary"
      />
      <p aria-live="polite" className="text-end text-[12px] text-ink-3">
        {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : ''}
      </p>
    </div>
  );
}

/** Everything drafted so far, as the one piece of text a Keep writes. */
export function draftText(summary: AiDraft | null, checklist: AiDraft | null, done: Set<number>, note: string | null): string {
  return [
    summary ? `Summary\n${summary.text}` : null,
    checklist ? `Checklist\n${checklist.items.map((it, i) => `${done.has(i) ? '[x]' : '[ ]'} ${it}`).join('\n')}` : null,
    note ? `Ticket note\n${note}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function AiTab({ p, uuid }: { p: Panel; uuid: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<AiDraft['kind'] | null>(null);
  const [summary, setSummary] = useState<AiDraft | null>(null);
  const [checklist, setChecklist] = useState<AiDraft | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const notes = useRef(p.notes ?? '');

  useEffect(() => {
    notes.current = p.notes ?? '';
  }, [p.notes]);

  const draft = async (kind: AiDraft['kind']) => {
    setBusy(kind);
    try {
      const d = await support.ai(uuid, kind);

      if (kind === 'summary') setSummary(d);
      if (kind === 'checklist') {
        setChecklist(d);
        setDone(new Set());
      }
      if (kind === 'ticket_note') setNote(d.text);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  /** Ticking a step writes it into the agent's notes. The agent does the step. */
  const tick = async (i: number) => {
    if (!checklist) return;
    const next = new Set(done);
    const on = !next.has(i);

    if (on) next.add(i);
    else next.delete(i);
    setDone(next);

    const line = `✓ ${checklist.items[i]}`;
    const lines = notes.current.split('\n').filter((l) => l !== line);
    const text = (on ? [...lines.filter((l) => l !== ''), line] : lines).join('\n');

    try {
      await support.notes(uuid, text);
      notes.current = text;
      await qc.invalidateQueries({ queryKey: ['support-panel', uuid] });
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const keep = async (target: 'chat' | 'ticket') => {
    const text = draftText(summary, checklist, done, note);

    if (!text) return;
    try {
      await support.keep(uuid, target, text);
      toast('success', target === 'chat' ? 'Copied to the session chat.' : 'Added to the ticket as an internal note.');
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  const anything = !!(summary || checklist || note);

  return (
    <div className="flex min-h-full flex-col gap-2.5">
      {/* The server's own words for what assist reads, not a paraphrase of
        * them: this is the promise the artboard is mostly about, and two
        * wordings of one promise is one too many. */}
      <p className="rounded-[10px] border border-line bg-subtle p-3 text-[12px] leading-relaxed text-ink-2">{p.ai?.reads}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" icon="sparkles" loading={busy === 'summary'} disabled={busy !== null} onClick={() => void draft('summary')}>
          Summarise so far
        </Button>
        {p.ai?.assist ? (
          <Button size="sm" icon="list" loading={busy === 'checklist'} disabled={busy !== null} onClick={() => void draft('checklist')}>
            Draft checklist
          </Button>
        ) : null}
        {p.ticket ? (
          <Button size="sm" variant="ghost" icon="file" loading={busy === 'ticket_note'} disabled={busy !== null} onClick={() => void draft('ticket_note')}>
            Draft ticket note
          </Button>
        ) : null}
      </div>

      {summary ? (
        <section className="rounded-[10px] border border-line bg-surface p-3">
          <h4 className="text-[11px] font-bold tracking-wider text-ink-3 uppercase">Summary · draft</h4>
          <p className="mt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap text-ink">{summary.text}</p>
        </section>
      ) : null}

      {checklist ? (
        <section className="rounded-[10px] border border-line bg-surface p-3">
          <h4 className="text-[11px] font-bold tracking-wider text-ink-3 uppercase">Troubleshooting checklist · draft</h4>
          <ul className="mt-2 space-y-2">
            {checklist.items.map((it, i) => (
              <li key={`${it}-${i}`}>
                <label className="flex items-start gap-2.5 text-[13px] text-ink">
                  <Checkbox className="mt-0.5" checked={done.has(i)} onChange={() => void tick(i)} />
                  <span>{it}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-ink-3">You do each step yourself. Ticking only updates your notes.</p>
        </section>
      ) : null}

      {note !== null ? (
        <section className="rounded-[10px] border border-line bg-surface p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[11px] font-bold tracking-wider text-ink-3 uppercase">Ticket note · draft</h4>
            <span className="text-[12px] text-ink-3">for your review</span>
          </div>
          <textarea
            aria-label="Ticket note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={6}
            className="mt-2 w-full resize-none rounded-[8px] border border-line bg-ground p-2 text-[13px] text-ink outline-none focus:border-primary"
          />
        </section>
      ) : null}

      {anything ? (
        <div className="mt-auto flex flex-wrap justify-end gap-2 pt-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSummary(null);
              setChecklist(null);
              setDone(new Set());
              setNote(null);
            }}
          >
            Discard
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void keep('chat')}>
            Copy to chat
          </Button>
          <Button size="sm" disabled={!p.ticket} title={p.ticket ? undefined : 'This session is not linked to a ticket'} onClick={() => void keep('ticket')}>
            Add to ticket notes
          </Button>
        </div>
      ) : null}
    </div>
  );
}
