import { apiGet, apiPut } from '../../../../core/api';
import { text } from '../../../../core/i18n';
import { WEBSITE } from '../api';

/**
 * Widget settings › Behaviour and Embed code (S-03; WS-WCHAT X-UI-16, UX-SET-04, UX-SET-05; WGT-06, WGT-07, WGT-10,
 * WGT-18, GATE-01): who gets a new chat, when to ask for contact details, when a chat counts as missed, when a quiet
 * chat goes inactive, the browsing alerts, the allowed domains — and the snippet, its install guides and the install
 * check "Seen on techubiz.com 2 minutes ago".
 *
 * The server's own read and save (`widgets/{id}/behaviour`), not the web's whole widget form: that one rewrites every
 * column from what it is sent, so a page knowing only these settings would reset the rest. Saving sends only what was
 * changed; the checks here mirror the server's (`WidgetBehaviour`) so a mistake shows beside its field before Save.
 */

/** Who gets a new chat (WGT-10), as `Roster::RULES` names them. */
export type AssignmentRule = 'round_robin' | 'least_busy' | 'manual';
/** When agents are told somebody is browsing (WGT-07). */
export type VisitorAlerts = 'off' | 'engaged' | 'all';

export interface BehaviourSettings {
  assignment_rule: AssignmentRule;
  /** "Always the same person": who that is. */
  default_agent_id: number | null;
  /** 0 is off, else 1–1440. */
  ask_details_after_minutes: number;
  /** 0 is off, else 1–1440. */
  missed_after_minutes: number;
  /** 0 is off, else 2–1440. */
  inactive_after_minutes: number;
  visitor_alerts: VisitorAlerts;
  /** 2–50. */
  visitor_alert_pages: number;
  /** Bare hosts; a leading dot allows the sub-domains too. None: the widget loads nowhere (WGT-18). */
  allowed_domains: string[];
}

/** Where and when the widget last loaded on a visitor's page; `host` only when the widget still accepts it. */
export interface Seen {
  host: string | null;
  at: string;
  seconds_ago: number;
}

export interface BehaviourPayload {
  settings: BehaviourSettings;
  embed_code: string;
  seen: Seen | null;
  /** Who "Always the same person" can name: whoever answers website chats. */
  people: Array<{ id: number; name: string }>;
  can_manage: boolean;
}

export const MAX_MINUTES = 1440;
export const PAGES = [2, 50] as const;

/** The design's words for each rule, and what each does. */
export const RULES: Array<{ value: AssignmentRule; label: string; hint: string }> = [
  { value: 'round_robin', label: 'Next available (round robin)', hint: 'Round robin among available staff on this widget, priority staff first.' },
  { value: 'least_busy', label: 'Whoever has the fewest chats', hint: 'The available person on this widget with the fewest open chats.' },
  { value: 'manual', label: 'Always the same person', hint: 'Every new chat goes to one person, even when they are away.' },
];

export const behaviourOf = (id: number, signal?: AbortSignal) => apiGet<BehaviourPayload>(`${WEBSITE}/widgets/${id}/behaviour`, undefined, signal);
export const saveBehaviour = (id: number, fields: Partial<BehaviourSettings>) => apiPut<BehaviourPayload>(`${WEBSITE}/widgets/${id}/behaviour`, fields);

/** What changed between the saved settings and the draft: all a save sends. */
export function changedBehaviour(saved: BehaviourSettings, draft: BehaviourSettings): Partial<BehaviourSettings> {
  const out: Partial<BehaviourSettings> = {};
  for (const k of Object.keys(draft) as Array<keyof BehaviourSettings>) {
    const a = draft[k];
    const b = saved[k];
    if (Array.isArray(a) && Array.isArray(b) ? a.join('\n') !== b.join('\n') : a !== b) (out as Record<string, unknown>)[k] = a;
  }
  return out;
}

const HOST = /^\.?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

/**
 * A domain as the server stores it, or null when it is not one: a pasted address reduced to its host, lower case, `*.`
 * read as the leading dot that allows sub-domains (WGT-18).
 */
export function domainOf(raw: string): string | null {
  let d = raw.trim().toLowerCase();
  if (!d) return null;
  if (d.includes('://')) {
    try {
      d = new URL(d).hostname;
    } catch {
      return null;
    }
  } else {
    d = d.replace(/[/:?#].*$/, '');
  }
  if (d.startsWith('*.')) d = d.slice(1);
  d = d.replace(/\.+$/, '');
  return HOST.test(d) ? d : null;
}

export const notADomain = (raw: string) => text('“{d}” is not a domain. Enter one like techubiz.com, or .techubiz.com for its sub-domains too.', { d: raw.trim() });

/** What is wrong, field by field, before the server is asked. */
export function behaviourProblems(s: BehaviourSettings): Partial<Record<keyof BehaviourSettings, string>> {
  const out: Partial<Record<keyof BehaviourSettings, string>> = {};
  const whole = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  if (!whole(s.ask_details_after_minutes, 0, MAX_MINUTES)) out.ask_details_after_minutes = text('0 to {max} minutes; 0 is off', { max: MAX_MINUTES });
  if (!whole(s.missed_after_minutes, 0, MAX_MINUTES)) out.missed_after_minutes = text('0 to {max} minutes; 0 is off', { max: MAX_MINUTES });
  if (!(s.inactive_after_minutes === 0 || whole(s.inactive_after_minutes, 2, MAX_MINUTES))) out.inactive_after_minutes = text('2 to {max} minutes; 0 is off', { max: MAX_MINUTES });
  if (!whole(s.visitor_alert_pages, PAGES[0], PAGES[1])) out.visitor_alert_pages = text('{min} to {max} pages', { min: PAGES[0], max: PAGES[1] });
  if (s.assignment_rule === 'manual' && !s.default_agent_id) out.default_agent_id = 'Choose the person who gets every new chat.';
  return out;
}

/** "just now", "2 minutes ago", "3 hours ago", "yesterday", "9 days ago". */
export function agoText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? '1 minute ago' : text('{n} minutes ago', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? '1 hour ago' : text('{n} hours ago', { n: h });
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : text('{n} days ago', { n: d });
}

/** The install check's line: "Seen on techubiz.com 2 minutes ago", or that it has not loaded anywhere yet. */
export function seenText(seen: Seen | null | undefined, site: string): string {
  if (!seen) return text('Not seen on {site} yet. This turns green once the widget first loads there.', { site });
  return seen.host ? text('Seen on {host} {ago}', { host: seen.host, ago: agoText(seen.seconds_ago) }) : text('Seen {ago}', { ago: agoText(seen.seconds_ago) });
}

/** A day without a load is worth a look: the snippet may have come off the site. */
export const STALE_SECONDS = 86_400;

/**
 * The snippet as the design sets it out: the tag and its address on the first line, every other attribute on its own
 * line. Copy still copies the one-line original.
 */
export function snippetLines(code: string): string {
  const m = /^<script (src="[^"]*")((?:\s+[^\s>]+)*)><\/script>$/.exec(code.trim());
  if (!m) return code;
  const rest = m[2]!.trim().split(/\s+/).filter(Boolean);
  if (!rest.length) return code;
  return `<script ${m[1]}\n${rest.map((a, i) => `  ${a}${i === rest.length - 1 ? '></script>' : ''}`).join('\n')}`;
}

/** The design's three install guides, each with its steps. */
export const GUIDES: Array<{ id: string; title: string; steps: string[] }> = [
  {
    id: 'wordpress',
    title: 'WordPress — paste in a header/footer plugin',
    steps: ['Install a header and footer plugin, such as WPCode.', 'Paste the embed code into its footer box.', 'Save. The widget shows on every page.'],
  },
  {
    id: 'shopify',
    title: 'Shopify — theme.liquid before </body>',
    steps: ['In Shopify, open Online Store › Themes › Edit code.', 'Open layout/theme.liquid and paste the embed code just before </body>.', 'Save.'],
  },
  {
    id: 'gtm',
    title: 'Google Tag Manager — Custom HTML tag',
    steps: ['Add a new tag of type Custom HTML and paste the embed code.', 'Trigger it on All Pages.', 'Submit and publish the container.'],
  },
];
