import { useEffect, useState } from 'react';
import { ApiError, apiGetMeta } from '../../core/api';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { navigate } from '../../core/tabs';
import { toast } from '../../core/toasts';
import { guideKeyFor, guideRoute, isBrowserApp, webGuidePath } from './keys';

/**
 * User guides over the server's GET /api/help/guides and /api/help/guides/{key} (docs/help/API.md on the server).
 * The server lists only the guides this person may read and the company has on; its HTML is sanitised there and
 * again here (core/rich). Both answers are kept for offline reading (READ_CACHE, the `help` module's manifest).
 */
export interface GuideSummary {
  key: string;
  title: string;
  summary: string;
  workflows: Array<{ slug: string; title: string }>;
  url: string;
  external_url: string | null;
  /** With a search (`q`): the workflows that matched. */
  matches?: Array<{ slug: string; title: string }>;
}

export interface GuideIndex {
  guides: GuideSummary[];
  /** Admin Center › User guides › Show the "User guide" link (guides_show_link); on when the server does not say. */
  show_link?: boolean;
  /** Admin Center › User guides › guides_enabled; on when the server does not say. */
  enabled?: boolean;
}

export interface GuideWorkflow {
  slug: string;
  title: string;
  who: string | null;
  where: string | null;
  route: string | null;
  steps_html: string;
}

export interface GuideDetail {
  key: string;
  title: string;
  summary: string;
  audience: string[] | string | null;
  updated: string | null;
  overview_html: string;
  workflows: GuideWorkflow[];
  settings_html: string | null;
  faq: Array<{ q: string; a_html: string }>;
  external_url: string | null;
  url: string;
}

export interface Loaded<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  offline: boolean;
  cachedAt: string | null;
}

/** Only an http(s) address is opened outside the app. */
export function safeExternal(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The list; with `q` (3 characters or more) the server searches overviews and steps too, best first. */
export function fetchGuideIndex(signal?: AbortSignal, q?: string) {
  return apiGetMeta<GuideIndex>('/api/help/guides', q ? { q } : undefined, signal);
}

export function fetchGuide(key: string, signal?: AbortSignal) {
  return apiGetMeta<GuideDetail>(`/api/help/guides/${encodeURIComponent(key)}`, undefined, signal);
}

// The list is asked for once per organisation and shared by every "User guide" button.
let indexFor: string | null | undefined;
let indexPromise: Promise<Loaded<GuideIndex>> | null = null;
let indexValue: Loaded<GuideIndex> | null = null;

function loadIndex(org: string | null): Promise<Loaded<GuideIndex>> {
  if (indexPromise && indexFor === org) return indexPromise;
  indexFor = org;
  indexValue = null;
  indexPromise = fetchGuideIndex().then(
    (r) => (indexValue = { data: r.data && Array.isArray(r.data.guides) ? r.data : { guides: [] }, error: null, loading: false, offline: r.offline, cachedAt: r.cachedAt }),
    (error: unknown) => {
      indexValue = { data: null, error, loading: false, offline: error instanceof ApiError && error.offline, cachedAt: null };
      // Asked again next time rather than remembered as failed.
      indexPromise = null;
      return indexValue;
    },
  );
  return indexPromise;
}

/** Forget the list (a test, or after the Admin Center settings change). */
export function resetGuideIndex(): void {
  indexFor = undefined;
  indexPromise = null;
  indexValue = null;
}

export function useGuideIndex(): Loaded<GuideIndex> {
  const org = useStore(app, (s) => s.organizationId);
  const [v, setV] = useState<Loaded<GuideIndex>>(() => (indexValue && indexFor === org ? indexValue : { data: null, error: null, loading: true, offline: false, cachedAt: null }));
  useEffect(() => {
    let live = true;
    void loadIndex(org).then((r) => live && setV(r));
    return () => {
      live = false;
    };
  }, [org]);
  return v;
}

/** Whether "User guide" links show at all: the company has guides on and shows the link. */
export function linksShown(index: GuideIndex | null): boolean {
  return !!index && index.enabled !== false && index.show_link !== false;
}

export type GuideLink = { kind: 'hidden' } | { kind: 'index' } | { kind: 'guide'; key: string; external: string | null; browser: boolean };

/**
 * What a module's "User guide" opens: nothing while the list is unknown, when links are off, or when the module's
 * guide is turned off or not the person's; the list of guides for a shell screen; else its guide — the company's own
 * page when it set one (external_url), the web's for an app that opens in the browser.
 */
export function guideLinkFor(appId: string, index: GuideIndex | null): GuideLink {
  if (!linksShown(index)) return { kind: 'hidden' };
  const key = guideKeyFor(appId);
  if (!key) return { kind: 'index' };
  const g = index!.guides.find((x) => x.key === key);
  if (!g) return { kind: 'hidden' };
  return { kind: 'guide', key, external: safeExternal(g.external_url), browser: isBrowserApp(appId) };
}

export function openExternal(url: string): void {
  void call('app:openExternal', { url }).catch((e: unknown) => toast('error', errorMessage(e)));
}

/** Follows a guide link: the company's page in the system browser, the web guide in the browser, or the viewer. */
export function followGuideLink(link: GuideLink, go: (route: string) => void, workflow?: string | null): void {
  if (link.kind === 'hidden') return;
  if (link.kind === 'index') return go(guideRoute());
  if (link.external) return openExternal(link.external);
  if (link.browser) {
    void call('app:openInBrowser', { path: webGuidePath(link.key) }).catch((e: unknown) => toast('error', errorMessage(e)));
    return;
  }
  go(guideRoute(link.key, workflow));
}

/**
 * Help › User Guide (the app menu, the command palette): the guide of the app in front, or the list of guides. When
 * the guide is unknown or turned off it opens the list, which says why.
 */
export function openUserGuide(appId: string | null, go: (route: string) => void = navigate): void {
  if (!appId) return go(guideRoute());
  void loadIndex(app.get().organizationId).then((r) => {
    const link = guideLinkFor(appId, r.data);
    followGuideLink(link.kind === 'hidden' ? { kind: 'index' } : link, go);
  });
}
