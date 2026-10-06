import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { apiPost } from '../../../core/api';
import { toast } from '../../../core/toasts';
import { Button, cx, Empty, Modal, Spinner } from '../../../components/ui';
import { isNotOffered, NOT_OFFERED, phoneApi, useExtensions, useIntelligenceStatus, useRecordings, useScreenPop, type Recording } from '../api';
import { placeCall } from '../dial';
import { clock, isoDay, prettyNumber, stamp } from '../lib/format';
import { CallerBadge, ConfirmButton, Mono, PageBody, PageHeader, Panel, Pills, Refused } from '../parts';
import { runPhone } from '../softphone/client';
import { Player } from './Player';

/**
 * W06 · Voicemail (VOIP-REC-06). New and heard messages and any shared mailbox, the player, transcription said
 * plainly when it is not switched on, and what to do next: call back, a task, forward to a colleague, mark heard,
 * delete. Playing a message marks it heard on the server.
 */
type Filter = 'new' | 'heard' | `box:${string}`;

export default function Voicemail() {
  const qc = useQueryClient();
  const q = useRecordings({ kind: 'voicemail', per_page: 100 });
  const [filter, setFilter] = useState<Filter>('new');
  const [open, setOpen] = useState<number | null>(null);
  const [greeting, setGreeting] = useState(false);
  const all = useMemo(() => q.data?.recordings ?? [], [q.data]);
  const boxes = useMemo(() => [...new Set(all.map((r) => r.mailbox).filter((m): m is string => !!m))], [all]);
  const list = all.filter((r) => (filter === 'new' ? !r.listened && !r.mailbox : filter === 'heard' ? r.listened && !r.mailbox : r.mailbox === filter.slice(4)));
  const current = all.find((r) => r.id === open) ?? list[0] ?? null;
  const unheard = all.filter((r) => !r.listened && !r.mailbox).length;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['phone', 'recordings'] });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Voicemail"
        sub="Dial *97 from any phone · new messages are emailed to you"
        actions={
          <Button icon="settings" onClick={() => setGreeting(true)}>
            Greeting & PIN
          </Button>
        }
      />
      <PageBody className="flex min-h-0">
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <Refused error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <div className="grid min-h-0 w-full flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
            <Panel
              title={
                <Pills
                  label="Voicemail folders"
                  value={filter}
                  onChange={(v) => {
                    setFilter(v);
                    setOpen(null);
                  }}
                  options={[{ id: 'new' as Filter, label: `New${unheard ? ` · ${unheard}` : ''}` }, { id: 'heard' as Filter, label: 'Heard' }, ...boxes.map((b) => ({ id: `box:${b}` as Filter, label: `Shared mailbox · ${b}` }))]}
                />
              }
              bodyClassName="px-0 pb-2"
            >
              {list.length === 0 ? (
                <Empty icon="voicemail" title={filter === 'new' ? 'No new voicemail' : 'Nothing here'} />
              ) : (
                <ul>
                  {list.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => setOpen(r.id)} aria-current={current?.id === r.id ? 'true' : undefined} className={cx('flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-subtle', current?.id === r.id && 'bg-selection')}>
                        <span className={cx('h-2 w-2 shrink-0 rounded-full', r.listened ? 'bg-transparent' : 'bg-primary')} />
                        <span className="min-w-0 flex-1">
                          <span className={cx('block truncate text-[13px]', r.listened ? 'font-medium' : 'font-bold')}>{prettyNumber(r.from) || 'Unknown caller'}</span>
                          <span className="block truncate text-[11.5px] text-ink-3">
                            {stamp(r.created_at)}
                            {r.category ? ` · ${r.category}` : r.extension ? ` · Ext ${r.extension}` : ''}
                          </span>
                        </span>
                        <Mono className="text-[12px] text-ink-2">{clock(r.duration)}</Mono>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            {current ? <Message key={current.id} r={current} onChanged={refresh} /> : <Panel><Empty icon="voicemail" title="Choose a message" /></Panel>}
          </div>
        )}
      </PageBody>
      {greeting ? <GreetingHelp onClose={() => setGreeting(false)} /> : null}
    </div>
  );
}

function Message({ r, onChanged }: { r: Recording; onChanged: () => void }) {
  const pop = useScreenPop(r.from);
  const ai = useIntelligenceStatus();
  const exts = useExtensions();
  const [forwarding, setForwarding] = useState(false);
  const [to, setTo] = useState('');
  const c = pop.data;
  const name = c?.contact?.name ?? c?.account?.name ?? c?.lead?.name ?? null;
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast('success', done);
      onChanged();
    } catch (e) {
      toast(isNotOffered(e) ? 'info' : 'error', isNotOffered(e) ? NOT_OFFERED : (e as Error).message);
    }
  };
  return (
    <Panel bodyClassName="flex flex-col gap-4 pt-4">
      <div className="flex items-center gap-3">
        <CallerBadge name={name ?? r.from} size={44} />
        <div className="min-w-0">
          <div className="truncate text-[17px] font-bold">{name ?? (prettyNumber(r.from) || 'Unknown caller')}</div>
          <div className="text-[12px] text-ink-3">
            <Mono>{prettyNumber(r.from)}</Mono> · {stamp(r.created_at)} · left after the call went unanswered{r.category ? ` in ${r.category}` : ''}
          </div>
        </div>
      </div>
      <Player recordingId={r.id} duration={r.duration} onPlayed={onChanged} />
      <div className="rounded-[10px] bg-subtle px-3 py-2 text-[12.5px] text-ink-2">
        {ai.data?.available ? 'Transcription can be asked for from the call detail.' : 'Transcription isn’t switched on for this installation, so only the audio is available.'}
      </div>
      <div className="flex flex-wrap gap-2">
        {r.from ? (
          <Button variant="success" icon="phone" onClick={() => void placeCall(r.from, { name, contactId: c?.contact?.id ?? null })}>
            Call back
          </Button>
        ) : null}
        <Button
          icon="list-todo"
          onClick={() =>
            void act(() => {
              const due = new Date();
              due.setDate(due.getDate() + 1);
              return apiPost('/api/tasks', { title: `Return voicemail from ${name ?? prettyNumber(r.from)}`, description: `<p>Voicemail of ${clock(r.duration)} left ${stamp(r.created_at)}.</p>`, due_date: isoDay(due), priority: 'medium', tags: ['voicemail'] });
            }, 'Task created.')
          }
        >
          Create task
        </Button>
        <Button icon="forward" onClick={() => setForwarding(!forwarding)}>
          Forward to colleague
        </Button>
        {!r.listened ? (
          <Button icon="check" onClick={() => void act(() => phoneApi.markHeard(r.id), 'Marked as heard.')}>
            Mark as heard
          </Button>
        ) : null}
        <ConfirmButton label="Delete" confirm="Delete message" icon="trash" onConfirm={() => void act(() => phoneApi.deleteRecording(r.id), 'Message deleted.')} />
      </div>
      {forwarding ? (
        <div className="flex items-center gap-2">
          <select aria-label="Forward to" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 min-w-0 flex-1 rounded-[8px] border border-line bg-surface px-2 text-[13px]">
            <option value="">Choose a colleague</option>
            {(exts.data ?? [])
              .filter((e) => e.enabled && e.voicemail)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.extension} · {e.user_name ?? e.name}
                </option>
              ))}
          </select>
          <Button variant="primary" disabled={!to} onClick={() => void act(() => phoneApi.forwardVoicemail(r.id, Number(to)), 'Voicemail forwarded.').then(() => setForwarding(false))}>
            Forward
          </Button>
        </div>
      ) : null}
      {c?.matched ? (
        <div className="mt-auto rounded-[10px] border border-primary/20 bg-selection px-3.5 py-2.5 text-[12.5px]">
          <b className="text-primary">Account context</b>
          <div className="text-ink-2">
            {[c.account?.name ?? c.contact?.company, c.deals.filter((d) => d.open).length ? `${c.deals.filter((d) => d.open).length} open deals` : null, c.quotes.length ? `${c.quotes.length} quotes` : null, c.invoices.some((i) => i.overdue) ? 'overdue invoices' : null].filter(Boolean).join(' · ')}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function GreetingHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Greeting & PIN" onClose={onClose} footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" icon="phone" onClick={() => void runPhone({ cmd: 'dial', number: '*97', name: 'Voicemail' }).then((r) => { if (!r.ok) toast('error', r.message); else onClose(); })}>Call *97 now</Button></>}>
      <div className="flex flex-col gap-2 text-[13px] text-ink-2">
        <p>Your greeting and PIN live on the phone system, which plays and checks them. To change them, call your voicemail:</p>
        <ol className="list-decimal pl-5">
          <li>Dial <Mono>*97</Mono> from this computer or any of your phones.</li>
          <li>Enter your PIN when asked.</li>
          <li>Press <Mono>0</Mono> for mailbox options: record your unavailable or busy greeting, your name, or change your PIN.</li>
        </ol>
        <p className="text-[12px] text-ink-3">Forgotten your PIN? An administrator can reset it on the phone system.</p>
      </div>
    </Modal>
  );
}
