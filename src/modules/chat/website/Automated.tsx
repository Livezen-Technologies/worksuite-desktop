import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { toast } from '../../../core/toasts';
import { useTabTitle } from '../../../core/tab-context';
import { Checkbox } from '../../../components/Checkbox';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Button, Empty, ErrorNote, Modal, Spinner, Switch, TextField, cx } from '../../../components/ui';
import { Note } from '../../../components/CardKit';
import {
  EVENTS,
  FREQUENCIES,
  SECONDS,
  changedRule,
  createRule,
  delayWords,
  deleteRule,
  draftOf,
  newRule,
  postsAsOptions,
  ruleCounts,
  ruleProblems,
  ruleSummary,
  rulesOf,
  saveRule,
  type Rule,
  type RuleDraft,
  type RulesPayload,
} from './automatedRules';
import { widgetsList, type WidgetRow } from './widget/design';
import { siteOf } from './widget/Widgets';

/**
 * Website chats › Automated messages (S-07; WS-WCHAT X-UI-19, UX-SET-08; TRG-01…03), as the design lays it out under
 * SETUP: the rules down the left — name, condition, "Sent 212 · 31 replied" or "Paused", and an on/off switch saved as
 * it is flipped — and the chosen rule's editor: WHEN, the widget, "Send it" and "Never to a visitor already chatting.",
 * MESSAGE with who it posts as and the words, Delete and Save; under it, that automated messages never count as the team
 * answering. `rule` in the address is the rule open, `new` a new one.
 */

const KEY = ['website', 'triggers'];

export function AutomatedMessages({ selected, onSelect }: { selected: string | null; onSelect: (rule: string | null) => void }) {
  useTabTitle('Automated messages');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: ({ signal }) => rulesOf(signal), retry: false });
  const widgets = useQuery({ queryKey: ['website', 'widgets'], queryFn: ({ signal }) => widgetsList(signal), retry: false });
  const rules = q.data?.triggers ?? [];
  const can = Boolean(q.data?.can?.manage);
  const creating = selected === 'new';
  const open = creating ? null : (rules.find((r) => String(r.id) === selected) ?? rules[0] ?? null);

  const toggle = async (r: Rule, on: boolean) => {
    qc.setQueryData<RulesPayload>(KEY, (d) => (d ? { ...d, triggers: d.triggers.map((t) => (t.id === r.id ? { ...t, is_active: on } : t)) } : d));
    try {
      await saveRule(r.id, { is_active: on });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      void qc.invalidateQueries({ queryKey: KEY });
      // The widgets list's "{n} rules" chip counts the rules that are on.
      void qc.invalidateQueries({ queryKey: ['website', 'widgets'] });
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 text-[13px] text-ink">
      <section aria-label="Automated messages" className="flex w-[420px] shrink-0 flex-col border-x border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line/70 p-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-[18px] font-bold">Automated messages</h1>
            <p className="text-[12px] text-ink-3">Proactive messages sent by rules</p>
          </div>
          <Button size="sm" variant="primary" disabled={!can || !q.data} onClick={() => onSelect('new')}>New rule</Button>
        </div>
        {q.isLoading ? (
          <div className="flex flex-1 items-center justify-center"><Spinner /></div>
        ) : q.error ? (
          <div className="p-4"><ErrorNote error={q.error} onRetry={() => void q.refetch()} /></div>
        ) : rules.length === 0 ? (
          <div className="flex flex-1"><Empty icon="zap" title="No automated messages yet" hint="A rule sends a message on its own: on an address, after time on a page, to a returning visitor or one about to leave." /></div>
        ) : (
          <ul aria-label="Rules" className="flex-1 overflow-y-auto scroll-thin">
            {rules.map((r) => {
              const here = !creating && open?.id === r.id;
              return (
                <li key={r.id} className={cx('flex items-center gap-2.5 border-b border-line/70 px-4 py-3', here && 'bg-selection/60 shadow-[inset_3px_0_0_var(--color-primary)]')}>
                  <button type="button" aria-current={here ? 'true' : undefined} onClick={() => onSelect(String(r.id))} className="min-w-0 flex-1 text-left">
                    <b className="block truncate text-[13.5px]">{r.name}</b>
                    <span className="block truncate text-[12px] text-ink-2">{ruleSummary(r)}</span>
                    <span className="mt-0.5 block text-[11.5px] text-ink-3">{ruleCounts(r)}</span>
                  </button>
                  <Switch label={text('{name} on', { name: r.name })} checked={r.is_active} disabled={!can} onChange={(v) => void toggle(r, v)} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <main aria-label="Rule" className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto bg-ground px-[22px] py-4 scroll-thin">
        {q.data && widgets.data ? (
          creating || open ? (
            <RuleEditor
              key={creating ? 'new' : open!.id}
              rule={creating ? null : open}
              widgets={widgets.data.widgets}
              can={can}
              onSaved={(id) => {
                void qc.invalidateQueries({ queryKey: KEY });
                void qc.invalidateQueries({ queryKey: ['website', 'widgets'] });
                onSelect(String(id));
              }}
              onDeleted={() => {
                void qc.invalidateQueries({ queryKey: KEY });
                void qc.invalidateQueries({ queryKey: ['website', 'widgets'] });
                onSelect(null);
              }}
            />
          ) : (
            <div className="flex flex-1"><Empty icon="zap" title="Nothing chosen" hint="Choose a rule to change it, or make a new one." /></div>
          )
        ) : widgets.error ? (
          <ErrorNote error={widgets.error} onRetry={() => void widgets.refetch()} />
        ) : q.isLoading || widgets.isLoading ? (
          <div className="flex flex-1 items-center justify-center"><Spinner /></div>
        ) : null}
      </main>
    </div>
  );
}

/** A small capitals heading inside the editor's card: WHEN, MESSAGE. */
function Head({ children, className }: { children: string; className?: string }) {
  return <h2 className={cx('text-[10.5px] font-bold tracking-[1px] text-ink-3 uppercase', className)}>{children}</h2>;
}

/** A labelled row of the editor: "Widget", "Send it", "Posts as". */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3.5">
      <span className="w-20 font-semibold">{label}</span>
      {children}
    </div>
  );
}

function RuleEditor({ rule, widgets, can, onSaved, onDeleted }: { rule: Rule | null; widgets: WidgetRow[]; can: boolean; onSaved: (id: number) => void; onDeleted: () => void }) {
  const saved = rule ? draftOf(rule) : newRule(widgets[0]?.id ?? 0);
  const [d, setD] = useState<RuleDraft>(saved);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tried, setTried] = useState(false);
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const issues = ruleProblems(d);
  const changes = rule ? changedRule(saved, d) : d;
  const dirty = !rule || Object.keys(changes).length > 0;
  const blocked = Object.keys(issues).length > 0;
  const widget = widgets.find((w) => w.id === d.widget_id) ?? null;
  const delay = delayWords(d.event);
  const show = (k: keyof RuleDraft) => (tried || rule ? issues[k] : undefined);

  const save = async () => {
    setTried(true);
    if (blocked || !dirty) return;
    setBusy(true);
    try {
      if (rule) {
        await saveRule(rule.id, changes);
        onSaved(rule.id);
      } else {
        const r = await createRule(d);
        onSaved(r.id);
      }
      toast('success', 'Automated message saved');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      aria-label="Automated message"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex items-center gap-2.5">
        <input
          aria-label="Rule name"
          placeholder="Name this rule"
          maxLength={120}
          disabled={!can || busy}
          value={d.name}
          onChange={(e) => set('name', e.target.value)}
          className={cx('min-w-0 flex-1 rounded-[6px] bg-transparent px-1 -mx-1 text-[18px] font-bold text-ink outline-none placeholder:text-ink-3 focus:bg-surface', show('name') && 'ring-1 ring-danger')}
        />
        {rule ? <Button type="button" className="text-danger" disabled={!can || busy} onClick={() => setDeleting(true)}>Delete</Button> : null}
        <Button type="submit" variant="primary" loading={busy} disabled={!can || busy || !dirty}>Save</Button>
      </div>
      {!can ? <Note>You can look at these rules. Changing them needs the “Create and configure chat widgets” permission.</Note> : null}
      {show('name') ? <span role="alert" className="-mt-2 text-[12px] text-danger">{issues.name}</span> : null}

      <fieldset disabled={!can || busy} className="flex flex-col gap-3.5 rounded-[12px] border border-line bg-surface p-4">
        <Head>When</Head>
        <div className="flex flex-wrap items-center gap-2.5">
          <Select aria-label="Condition" className="w-[200px]" value={d.event} onValueChange={(v) => set('event', v)} options={EVENTS} />
          {d.event === 'page_match' ? (
            <TextField aria-label="Address contains" className="w-[180px]" maxLength={190} placeholder="/pricing" value={d.match_text ?? ''} onChange={(e) => set('match_text', e.target.value)} error={Boolean(show('match_text'))} />
          ) : null}
          {delay ? (
            <>
              <span>{delay}</span>
              <TextField
                aria-label="Seconds"
                type="number"
                inputMode="numeric"
                min={SECONDS[0]}
                max={SECONDS[1]}
                className="w-[70px]"
                value={Number.isFinite(d.seconds) ? String(d.seconds) : ''}
                onChange={(e) => set('seconds', e.target.value === '' ? Number.NaN : Number(e.target.value))}
                error={Boolean(show('seconds'))}
              />
              <span>seconds</span>
            </>
          ) : null}
        </div>
        {show('match_text') || show('seconds') ? <span role="alert" className="-mt-2 text-[12px] text-danger">{show('match_text') ?? show('seconds')}</span> : null}

        <Row label="Widget">
          <Select aria-label="Widget" className="w-[240px]" value={d.widget_id || null} placeholder="Choose a widget" onValueChange={(v) => set('widget_id', v)} options={widgets.map((w) => ({ value: w.id, label: siteOf(w) }))} />
        </Row>
        <Row label="Send it">
          <Select aria-label="Send it" className="w-[240px]" value={d.repeatable ? 'visit' : 'visitor'} onValueChange={(v) => set('repeatable', v === 'visit')} options={FREQUENCIES} />
          <label className="flex items-center gap-2 text-ink-3">
            <Checkbox checked={d.skip_if_chatting} onChange={(e) => set('skip_if_chatting', e.target.checked)} />
            Never to a visitor already chatting.
          </label>
        </Row>
        <div className="flex flex-wrap items-center gap-3.5">
          <span className="w-20" aria-hidden />
          <label className="flex items-center gap-2 text-ink-3">
            <Checkbox checked={d.only_in_hours} onChange={(e) => set('only_in_hours', e.target.checked)} />
            Only inside business hours.
          </label>
        </div>

        <Head className="mt-1">Message</Head>
        <Row label="Posts as">
          <Select aria-label="Posts as" className="w-[240px]" value={d.posts_as} onValueChange={(v) => set('posts_as', v)} options={postsAsOptions(widget?.name ?? rule?.widget_name ?? '', widget?.bot_name)} />
        </Row>
        <textarea
          aria-label="Message"
          rows={3}
          maxLength={2000}
          value={d.message}
          placeholder="Comparing plans? I can help you pick the right licence — just ask."
          onChange={(e) => set('message', e.target.value)}
          aria-invalid={show('message') ? true : undefined}
          className={cx('min-h-16 resize-y rounded-[8px] border bg-surface px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-primary', show('message') ? 'border-danger' : 'border-line')}
        />
        {show('message') ? <span role="alert" className="-mt-2 text-[12px] text-danger">{issues.message}</span> : null}
      </fieldset>

      <Note className="flex items-center gap-2.5 px-3.5 py-3">
        <Icon name="info" size={16} />
        Automated messages never count as the team answering, so they do not stop ringing or first-response timers.
      </Note>

      {deleting && rule ? <DeleteRule rule={rule} onClose={() => setDeleting(false)} onDeleted={onDeleted} /> : null}
    </form>
  );
}

function DeleteRule({ rule, onClose, onDeleted }: { rule: Rule; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const tid = useId();
  const remove = async () => {
    setBusy(true);
    try {
      await deleteRule(rule.id);
      toast('success', 'Automated message removed');
      onClose();
      onDeleted();
    } catch (e) {
      toast('error', errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={text('Delete “{name}”?', { name: rule.name })}
      labelledBy={tid}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} disabled={busy} onClick={() => void remove()}>Delete</Button>
        </>
      }
    >
      <p className="text-[13px] text-ink-2">It stops being sent. Messages it already sent stay in their conversations.</p>
    </Modal>
  );
}
