import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../core/api';
import { sanitizeHtml } from '../../core/rich';
import { openWebLink, useTab, useTabTitle } from '../../core/tab-context';
import { Icon } from '../../components/Icon';
import { Button, Empty, ErrorNote, OfflineNote, Spinner, cx } from '../../components/ui';
import { parseRoute, type ModuleProps } from '../registry';
import { fetchGuide, fetchGuideIndex, openExternal, safeExternal, useGuideIndex, type GuideDetail, type GuideIndex, type GuideSummary, type Loaded } from './api';
import { guideRoute } from './keys';

/**
 * User guides (the server's /api/help/guides): the guides this person may read, searched across titles, summaries
 * and workflows; a guide's overview and its workflows; and a workflow's steps. `/help?guide=crm&workflow=add-a-lead`
 * opens a workflow directly. The server's HTML is cleaned again here (core/rich, the `rich` profile) before it is
 * shown, and links in it open outside the app. Offline, the last copy read on this computer is shown.
 */
export default function HelpPage({ route }: ModuleProps) {
  const { query } = parseRoute(route);
  const key = query.get('guide');
  const workflow = query.get('workflow');
  const index = useGuideIndex();
  return key ? <GuideView guideKey={key} workflow={workflow} index={index.data} /> : <GuideList index={index} />;
}

function matches(g: GuideSummary, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [g.title, g.summary, ...g.workflows.map((w) => w.title)].some((t) => (t ?? '').toLowerCase().includes(s));
}

function GuideList({ index }: { index: Loaded<GuideIndex> }) {
  const { go } = useTab();
  useTabTitle('User guides');
  const [q, setQ] = useState('');
  // The server's search (steps and overviews too) when it answers; the titles here meanwhile, and offline.
  const [found, setFound] = useState<{ q: string; guides: GuideSummary[] } | null>(null);
  const term = q.trim();
  useEffect(() => {
    if (term.length < 3) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetchGuideIndex(ctl.signal, term).then(
        (r) => !r.offline && Array.isArray(r.data?.guides) && setFound({ q: term, guides: r.data.guides }),
        () => undefined,
      );
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [term]);
  const local = useMemo(() => (index.data?.guides ?? []).filter((g) => matches(g, q)).sort((a, b) => a.title.localeCompare(b.title)), [index.data, q]);
  const guides = found && found.q === term && term.length >= 3 ? found.guides : local;
  const open = (g: GuideSummary, slug?: string) => {
    const ext = safeExternal(g.external_url);
    if (ext) openExternal(ext);
    else go(guideRoute(g.key, slug));
  };
  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="mx-auto flex max-w-[860px] flex-col gap-4 px-6 py-6">
        <div className="flex items-center gap-2">
          <Icon name="book-open" size={20} />
          <h1 className="flex-1 text-[20px] font-semibold text-ink">User guides</h1>
          <OfflineNote cachedAt={index.offline ? index.cachedAt : null} />
        </div>
        <label className="flex h-9 items-center gap-2 rounded-[9px] border border-line bg-surface px-3">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the guides" aria-label="Search the guides" className="flex-1 bg-transparent text-[13.5px] text-ink outline-none" />
        </label>
        {index.loading ? <Spinner /> : null}
        {!index.loading && index.error ? (
          index.error instanceof ApiError && index.error.offline ? (
            <Empty icon="wifi-off" title="You're offline" hint="The user guides haven't been opened on this computer yet. They'll be here once WorkSuite is back." />
          ) : index.error instanceof ApiError && index.error.status === 404 ? (
            <Empty icon="book-open" title="No user guides on this server" hint="This WorkSuite server doesn't offer user guides yet." />
          ) : (
            <ErrorNote error={index.error} />
          )
        ) : null}
        {index.data && index.data.enabled === false ? <Empty icon="book-open" title="User guides are turned off" hint="Your administrator has turned user guides off for this company." /> : null}
        {index.data && index.data.enabled !== false && guides.length === 0 ? <Empty icon="search" title={q ? 'No guide matches that' : 'No user guides'} /> : null}
        {index.data && index.data.enabled !== false ? (
          <ul className="flex flex-col gap-2" aria-label="Guides">
            {guides.map((g) => {
              const s = q.trim().toLowerCase();
              const flows = s ? (g.matches ?? g.workflows.filter((w) => w.title.toLowerCase().includes(s))) : [];
              return (
                <li key={g.key} className="rounded-[10px] border border-line bg-surface">
                  <button type="button" className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-subtle" onClick={() => open(g)}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold text-ink">{g.title}</span>
                      <span className="block text-[12.5px] text-ink-2">{g.summary}</span>
                    </span>
                    {safeExternal(g.external_url) ? <Icon name="external" size={14} /> : <span className="text-[12px] text-ink-3">{g.workflows.length} workflows</span>}
                  </button>
                  {flows.length ? (
                    <ul className="border-t border-line px-4 py-2">
                      {flows.map((w) => (
                        <li key={w.slug}>
                          <button type="button" className="py-1 text-left text-[12.5px] text-primary hover:underline" onClick={() => open(g, w.slug)}>
                            {w.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/** HTML from the server, cleaned again; its links open in the system browser, never in the app's window. */
export function GuideHtml({ html, className }: { html: string | null | undefined; className?: string }) {
  const clean = useMemo(() => sanitizeHtml(html, { profile: 'rich' }), [html]);
  if (!clean) return null;
  return (
    <div
      className={cx('ws-guide-html text-[13.5px] leading-relaxed text-ink [&_a]:text-primary [&_a]:underline [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5', className)}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a');
        if (!a) return;
        e.preventDefault();
        const href = safeExternal(a.getAttribute('href'));
        if (href) openExternal(href);
      }}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

function GuideView({ guideKey, workflow, index }: { guideKey: string; workflow: string | null; index: GuideIndex | null }) {
  const { go } = useTab();
  const [loaded, setState] = useState<Loaded<GuideDetail> & { key: string | null }>({ key: null, data: null, error: null, loading: true, offline: false, cachedAt: null });
  // Another guide asked for: loading until its answer comes.
  const state: Loaded<GuideDetail> = loaded.key === guideKey ? loaded : { data: null, error: null, loading: true, offline: false, cachedAt: null };
  const [q, setQ] = useState('');
  useEffect(() => {
    const ctl = new AbortController();
    fetchGuide(guideKey, ctl.signal).then(
      (r) => setState({ key: guideKey, data: r.data, error: null, loading: false, offline: r.offline, cachedAt: r.cachedAt }),
      (error: unknown) => {
        if ((error as Error)?.name !== 'AbortError') setState({ key: guideKey, data: null, error, loading: false, offline: error instanceof ApiError && error.offline, cachedAt: null });
      },
    );
    return () => ctl.abort();
  }, [guideKey]);
  const g = state.data;
  useTabTitle(g ? `${g.title} — User guide` : 'User guide');
  const external = safeExternal(g?.external_url ?? index?.guides.find((x) => x.key === guideKey)?.external_url);
  const flow = workflow ? g?.workflows.find((w) => w.slug === workflow) : null;
  const flows = (g?.workflows ?? []).filter((w) => !q.trim() || `${w.title} ${w.who ?? ''} ${w.where ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="mx-auto flex max-w-[860px] flex-col gap-4 px-6 py-6">
        <div className="flex items-center gap-2">
          <Button size="sm" icon="chevron-left" onClick={() => go(flow ? guideRoute(guideKey) : guideRoute())}>
            {flow ? g?.title : 'All guides'}
          </Button>
          <span className="flex-1" />
          <OfflineNote cachedAt={state.offline ? state.cachedAt : null} />
          {external ? (
            <Button size="sm" icon="external" onClick={() => openExternal(external)}>
              Open the company's guide
            </Button>
          ) : null}
        </div>
        {state.loading ? <Spinner /> : null}
        {state.error ? (
          state.error instanceof ApiError && state.error.offline ? (
            <Empty icon="wifi-off" title="You're offline" hint="This guide hasn't been opened on this computer before. It will be here once WorkSuite is back." />
          ) : state.error instanceof ApiError && (state.error.status === 404 || state.error.status === 403) ? (
            <Empty icon="book-open" title="This guide isn't available" hint="It may be turned off for your company, or not part of the apps you use." />
          ) : (
            <ErrorNote error={state.error} />
          )
        ) : null}
        {g && flow ? (
          <article aria-label={flow.title} className="flex flex-col gap-3">
            <h1 className="text-[20px] font-semibold text-ink">{flow.title}</h1>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
              {flow.who ? <span>Who: {flow.who}</span> : null}
              {flow.where ? <span>Where: {flow.where}</span> : null}
            </div>
            <GuideHtml html={flow.steps_html} className="rounded-[10px] border border-line bg-surface px-5 py-3" />
            {flow.route && flow.route.startsWith('/') ? (
              <div>
                <Button size="sm" icon="arrow-right" onClick={() => openWebLink(flow.route)}>
                  Go to this screen
                </Button>
              </div>
            ) : null}
          </article>
        ) : null}
        {g && workflow && !flow ? <Empty icon="search" title="That workflow isn't in this guide" hint="It may have been renamed. Pick one from the list." /> : null}
        {g && !flow ? (
          <article aria-label={g.title} className="flex flex-col gap-3">
            <h1 className="text-[22px] font-semibold text-ink">{g.title}</h1>
            <p className="text-[13.5px] text-ink-2">{g.summary}</p>
            <GuideHtml html={g.overview_html} />
            <h2 className="mt-2 text-[15px] font-semibold text-ink">Workflows</h2>
            {g.workflows.length > 4 ? (
              <label className="flex h-8 items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5">
                <Icon name="search" size={14} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a workflow" aria-label="Find a workflow" className="flex-1 bg-transparent text-[13px] text-ink outline-none" />
              </label>
            ) : null}
            <ul className="flex flex-col gap-1.5" aria-label="Workflows">
              {flows.map((w) => (
                <li key={w.slug}>
                  <button type="button" className="flex w-full items-center gap-2 rounded-[8px] border border-line bg-surface px-3 py-2 text-left hover:bg-subtle" onClick={() => go(guideRoute(guideKey, w.slug))}>
                    <span className="flex-1 text-[13.5px] font-semibold text-ink">{w.title}</span>
                    {w.who ? <span className="text-[12px] text-ink-3">{w.who}</span> : null}
                    <Icon name="chevron-right" size={14} />
                  </button>
                </li>
              ))}
            </ul>
            {g.settings_html ? (
              <>
                <h2 className="mt-2 text-[15px] font-semibold text-ink">Settings</h2>
                <GuideHtml html={g.settings_html} />
              </>
            ) : null}
            {g.faq?.length ? (
              <>
                <h2 className="mt-2 text-[15px] font-semibold text-ink">FAQ</h2>
                {g.faq.map((f, i) => (
                  <details key={i} className="rounded-[8px] border border-line bg-surface px-3 py-2">
                    <summary className="cursor-pointer text-[13.5px] font-semibold text-ink">{f.q}</summary>
                    <GuideHtml html={f.a_html} />
                  </details>
                ))}
              </>
            ) : null}
            {g.updated ? <p className="text-[12px] text-ink-3">Updated {g.updated}</p> : null}
          </article>
        ) : null}
      </div>
    </div>
  );
}
