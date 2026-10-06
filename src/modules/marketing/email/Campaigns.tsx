import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type ReactNode } from 'react';
import { useTab } from '../../../core/tab-context';
import { Icon } from '../../../components/Icon';
import { Menu, type MenuItem } from '../../../components/Menu';
import { Button, Empty, IconButton, Modal } from '../../../components/ui';
import { cancelCampaign, deleteCampaign, duplicateCampaign, fetchCampaigns, MK, pauseCampaign, resumeCampaign, unscheduleCampaign, useSettings, type Campaign, type CampaignFilters, type CampaignStatus, type Page } from '../api';
import { useMarketingOrg } from '../org';
import { Loaded, PageBody, PageHeader, Pager, Status, Table, Tabs, TD, TH, useAction } from '../parts';
import { campaignRoute, campaignActions, campaignStatus, type Tone } from '../lib/consent';
import { count, parseStamp, pct, share } from '../lib/format';
import { useDebounced } from './TestSend';

/**
 * DK06 · Email campaigns (W06; PDF p54) — MKT-EML-01/04, the campaign states of SRS §6.1: draft → scheduled →
 * sending ⇄ paused → sent, or cancelled. Tabs by state with the server's counts, a search, and per row what its state
 * allows. The lifecycle commands (duplicate, pause, resume, unschedule, cancel, delete) live here and are reused by
 * Review & send (DK08), the report (DK09) and the editor.
 */

type Filter = CampaignStatus | '';

const TABS: Array<{ id: Filter; label: string }> = [
  { id: '', label: 'All' },
  { id: 'draft', label: 'Drafts' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'sending', label: 'Sending' },
  { id: 'paused', label: 'Paused' },
  { id: 'sent', label: 'Sent' },
  { id: 'cancelled', label: 'Cancelled' },
];

/** `6 Oct 09:00` (with the year when it is not this one). */
export function when(s: string | null | undefined, withTime = true): string {
  const d = parseStamp(s);
  if (!d) return '—';
  const date = d.toLocaleDateString('en-GB', d.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  return withTime ? `${date} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : date;
}

/** "Sending · 62%", "Paused · bounce guard": the state with what matters about it. */
export function campaignChip(c: Pick<Campaign, 'status' | 'progress' | 'paused_reason'>): { label: string; tone: Tone } {
  const s = campaignStatus(c.status);
  if (c.status === 'sending' && c.progress !== null) return { tone: s.tone, label: `${s.label} · ${Math.round(c.progress)}%` };
  if (c.status === 'paused' && c.paused_reason === 'bounce_guard') return { tone: s.tone, label: `${s.label} · bounce guard` };
  if (c.status === 'paused' && c.paused_reason === 'failed') return { tone: 'danger', label: `${s.label} · failed` };
  return s;
}

/** "Customers (list)", "Engaged vendors (segment)". */
export function audienceOf(c: Pick<Campaign, 'audience_label' | 'lists' | 'segments'>): string {
  if (c.audience_label) return c.audience_label;
  const parts = [...c.lists.map((l) => `${l.name} (list)`), ...c.segments.map((s) => `${s.name} (segment)`)];
  return parts.length ? parts.join(', ') : '—';
}

/** The Send column: "Now · paced 1,200/h", "6 Oct 09:00 · recipient local time", "Paused at 5.3% bounce". */
export function sendOf(c: Campaign, pace: number | null): string {
  switch (c.status) {
    case 'sending':
      return pace ? `Now · paced ${count(pace)}/h` : 'Now';
    case 'scheduled':
      return c.scheduled_at ? `${when(c.scheduled_at)}${c.local_time ? ' · recipient local time' : ''}` : '—';
    case 'paused':
      if (c.paused_reason === 'bounce_guard') return `Paused at ${pct(c.bounce_rate)} bounce`;
      return c.progress !== null ? `Paused at ${Math.round(c.progress)}% sent` : 'Paused';
    case 'sent': {
      const at = c.started_at ?? c.finished_at;
      if (c.ab?.enabled && c.ab.winner) return `${when(at, false)} · winner ${c.ab.winner} after ${c.ab.window_hours} h`;
      return when(at);
    }
    default:
      return '—';
  }
}

/* ------------------------------------------------------------------------ *
 * Lifecycle commands, shared with Review & send, the report and the editor
 * ------------------------------------------------------------------------ */

/** Are you sure — for an act that cannot be taken back. The sentence says what happens. */
export function Confirm({ title, children, action, danger, busy, onYes, onClose }: { title: string; children: ReactNode; action: string; danger?: boolean; busy?: boolean; onYes: () => void; onClose: () => void }) {
  const id = useId();
  return (
    <Modal
      title={title}
      labelledBy={id}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Go back
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onYes}>
            {action}
          </Button>
        </>
      }
    >
      <div className="text-[13px] leading-relaxed text-ink-2">{children}</div>
    </Modal>
  );
}

type Target = Pick<Campaign, 'id' | 'name' | 'status'>;

export function useCampaignCommands() {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const { go } = useTab();
  const [busy, run] = useAction();
  const [asking, setAsking] = useState<{ kind: 'cancel' | 'delete'; c: Target; then?: () => void } | null>(null);
  const refresh = (id: number) => {
    void qc.invalidateQueries({ queryKey: ['marketing', 'campaigns'] });
    void qc.invalidateQueries({ queryKey: MK.campaign(org, id) });
    void qc.invalidateQueries({ queryKey: MK.dashboard(org) });
  };
  const duplicate = (c: Target) =>
    run(
      `duplicate:${c.id}`,
      async () => {
        const copy = await duplicateCampaign(c.id);
        refresh(c.id);
        go(`/marketing/campaigns/${copy.id}/content`);
      },
      `Duplicated “${c.name}”: this is the copy, as a draft.`,
    );
  const pause = (c: Target) =>
    run(
      `pause:${c.id}`,
      async () => {
        await pauseCampaign(c.id);
        refresh(c.id);
      },
      'Paused. The batch in progress finishes; nobody new is sent to until it is resumed.',
    );
  const resume = (c: Target) =>
    run(
      `resume:${c.id}`,
      async () => {
        await resumeCampaign(c.id);
        refresh(c.id);
      },
      'Resumed. Nobody who already has it is sent to again.',
    );
  const unschedule = (c: Target) =>
    run(
      `unschedule:${c.id}`,
      async () => {
        await unscheduleCampaign(c.id);
        refresh(c.id);
      },
      'Unscheduled: it is a draft again.',
    );
  const confirm = async () => {
    if (!asking) return;
    const { kind, c, then } = asking;
    const ok =
      kind === 'cancel'
        ? await run(`cancel:${c.id}`, async () => {
            await cancelCampaign(c.id);
            refresh(c.id);
          }, `“${c.name}” is cancelled. Nobody else will receive it.`)
        : await run(`delete:${c.id}`, async () => {
            await deleteCampaign(c.id);
            qc.removeQueries({ queryKey: MK.campaign(org, c.id) });
            refresh(c.id);
          }, `Draft “${c.name}” deleted.`);
    setAsking(null);
    if (ok) then?.();
  };
  const dialog = asking ? (
    <Confirm
      title={asking.kind === 'cancel' ? 'Cancel this campaign?' : 'Delete this draft?'}
      action={asking.kind === 'cancel' ? 'Cancel campaign' : 'Delete draft'}
      danger
      busy={busy !== null}
      onYes={() => void confirm()}
      onClose={() => setAsking(null)}
    >
      {asking.kind === 'cancel' ? (
        <>
          <b className="text-ink">{asking.c.name}</b> stops for good: nobody else receives it, and it cannot be restarted. Those it already reached keep it. A cancelled campaign can still be duplicated.
        </>
      ) : (
        <>
          <b className="text-ink">{asking.c.name}</b> and its content are deleted. This cannot be undone.
        </>
      )}
    </Confirm>
  ) : null;
  return {
    busy,
    duplicate,
    pause,
    resume,
    unschedule,
    cancel: (c: Target, then?: () => void) => setAsking({ kind: 'cancel', c, then }),
    remove: (c: Target, then?: () => void) => setAsking({ kind: 'delete', c, then }),
    dialog,
  };
}

/* ------------------------------------------------------------------------ *
 * The list
 * ------------------------------------------------------------------------ */

export default function Campaigns() {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const { go } = useTab();
  const settings = useSettings();
  const commands = useCampaignCommands();
  const [status, setStatus] = useState<Filter>('');
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 300);
  const [page, setPage] = useState(1);
  const [menu, setMenu] = useState<Campaign | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const f: CampaignFilters = { status, q: term, page };
  const list = useQuery({
    queryKey: MK.campaigns(org, f),
    queryFn: ({ signal }) => fetchCampaigns(org, f, signal),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.rows.some((c) => c.status === 'sending') ? 30_000 : false),
  });
  // Counts sent with a filtered page may be missing: the unfiltered first page's, when it is cached, stand in.
  const counts = Object.keys(list.data?.counts ?? {}).length ? (list.data?.counts ?? {}) : (qc.getQueryData<Page<Campaign>>(MK.campaigns(org, { status: '', q: term, page: 1 }))?.counts ?? {});
  const countOf = (id: Filter): number | undefined => {
    const n = id === '' ? (counts.all ?? counts.total) : counts[id];
    return n ?? (id === status && list.data ? list.data.total : undefined);
  };
  const pace = settings.data?.sending.hourly_pace ?? null;
  const searching = term !== '' || status !== '';

  const items = (c: Campaign): MenuItem[] => {
    const a = campaignActions(c.status);
    const out: MenuItem[] = [];
    if (a.edit) out.push({ id: 'content', label: 'Edit content', icon: 'compose', onSelect: () => go(`/marketing/campaigns/${c.id}/content`) });
    if (a.schedule || a.unschedule) out.push({ id: 'review', label: 'Review & send', icon: 'send', onSelect: () => go(`/marketing/campaigns/${c.id}/review`) });
    if (a.report) out.push({ id: 'report', label: 'Report', icon: 'chart', onSelect: () => go(`/marketing/campaigns/${c.id}/report`) });
    out.push({ id: 'duplicate', label: 'Duplicate', description: 'A new draft with the same content and audience', icon: 'copy', onSelect: () => void commands.duplicate(c) });
    if (a.unschedule) out.push({ id: 'unschedule', label: 'Unschedule', description: 'Back to draft', icon: 'undo', onSelect: () => void commands.unschedule(c) });
    if (a.pause) out.push({ id: 'pause', label: 'Pause', icon: 'pause', onSelect: () => void commands.pause(c) });
    if (a.resume)
      out.push({
        id: 'resume',
        label: 'Resume',
        icon: 'play',
        description: c.paused_reason === 'bounce_guard' ? `The bounce guard paused it at ${pct(c.bounce_rate)}: check the bounces first` : undefined,
        onSelect: () => void commands.resume(c),
      });
    if (a.cancel) out.push({ id: 'cancel', label: 'Cancel campaign', icon: 'x-circle', danger: true, onSelect: () => commands.cancel(c) });
    if (c.status === 'draft') out.push({ id: 'delete', label: 'Delete draft', icon: 'trash', danger: true, onSelect: () => commands.remove(c) });
    return out;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing / Email"
        title="Email campaigns"
        sub="Draft → scheduled → sending ⇄ paused → sent, or cancelled"
        actions={
          <>
            <Button icon="panel-top" onClick={() => go('/marketing/templates')}>
              Templates
            </Button>
            <Button variant="primary" icon="plus" onClick={() => go('/marketing/campaigns/new')}>
              New campaign
            </Button>
          </>
        }
      />
      <PageBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Tabs
            label="Campaigns by state"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            tabs={TABS.map((t) => {
              const n = countOf(t.id);
              return { id: t.id, label: n === undefined ? t.label : `${t.label} (${count(n)})` };
            })}
            className="min-w-0 flex-1"
          />
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-ink-3">
              <Icon name="search" size={14} />
            </span>
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search campaigns"
              aria-label="Search campaigns"
              className="h-8 w-[220px] max-w-full rounded-[8px] border border-line bg-surface pr-2 pl-8 text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-primary"
            />
          </div>
        </div>
        <Loaded q={list} what="Email campaigns">
          {(p) =>
            p.rows.length === 0 ? (
              searching ? (
                <Empty icon="search" title="No campaigns match" hint="Try another state or search, or clear the search to see every campaign." />
              ) : (
                <Empty
                  icon="mail"
                  title="No email campaigns yet"
                  hint="A campaign is named, given a topic and an audience, designed from a starter or a saved template, checked, and then scheduled."
                  action={
                    <Button variant="primary" icon="plus" className="mt-2" onClick={() => go('/marketing/campaigns/new')}>
                      New campaign
                    </Button>
                  }
                />
              )
            ) : (
              <>
                <Table
                  label="Email campaigns"
                  head={
                    <tr>
                      <th className={TH}>Campaign</th>
                      <th className={TH}>Status</th>
                      <th className={TH}>Audience</th>
                      <th className={TH}>Send</th>
                      <th className={`${TH} text-right`}>Delivered</th>
                      <th className={`${TH} text-right`}>Human opens</th>
                      <th className={`${TH} text-right`}>Clicks</th>
                      <th className={TH}>Owner</th>
                      <th className={TH}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  }
                >
                  {p.rows.map((c) => {
                    const chip = campaignChip(c);
                    const live = c.status === 'sending' || c.status === 'paused';
                    const reached = live || c.status === 'sent';
                    return (
                      <tr key={c.id} className="cursor-pointer hover:bg-subtle/60" onClick={() => go(campaignRoute(c))}>
                        <td className={TD}>
                          <span className="flex min-w-0 items-center gap-2">
                            <button
                              type="button"
                              className="max-w-[260px] truncate text-left font-semibold text-ink hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                go(campaignRoute(c));
                              }}
                            >
                              {c.name}
                            </button>
                            {c.ab?.enabled ? <Status tone="indigo">A/B</Status> : null}
                          </span>
                        </td>
                        <td className={TD}>
                          <Status tone={chip.tone}>{chip.label}</Status>
                        </td>
                        <td className={`${TD} max-w-[220px] truncate text-ink-2`}>{audienceOf(c)}</td>
                        <td className={`${TD} whitespace-nowrap text-ink-2`}>{sendOf(c, pace)}</td>
                        <td className={`${TD} text-right font-mono whitespace-nowrap tabular-nums`}>{live ? `${count(c.delivered_count)} / ${count(c.recipients_count)}` : c.status === 'sent' ? count(c.delivered_count) : '—'}</td>
                        <td className={`${TD} text-right font-mono tabular-nums`}>{reached && c.delivered_count > 0 ? share(c.human_opens, c.delivered_count) : '—'}</td>
                        <td className={`${TD} text-right font-mono tabular-nums`}>{reached && c.delivered_count > 0 ? share(c.clicks, c.delivered_count) : '—'}</td>
                        <td className={`${TD} whitespace-nowrap text-ink-2`}>{c.owner?.name ?? '—'}</td>
                        <td className={`${TD} w-10 text-right`}>
                          <IconButton
                            icon="more"
                            label={`Actions for ${c.name}`}
                            aria-haspopup="menu"
                            aria-expanded={menu?.id === c.id}
                            disabled={commands.busy !== null}
                            onClick={(e) => {
                              e.stopPropagation();
                              anchor.current = e.currentTarget;
                              setMenu(c);
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </Table>
                <Pager page={p.page} pages={p.pages} total={p.total} perPage={p.perPage} onPage={setPage} />
              </>
            )
          }
        </Loaded>
      </PageBody>
      {menu ? <Menu sections={[{ id: 'actions', items: items(menu) }]} label={`Actions for ${menu.name}`} anchor={anchor} prefer="bottom" align="end" width={280} onClose={() => setMenu(null)} /> : null}
      {commands.dialog}
    </div>
  );
}
