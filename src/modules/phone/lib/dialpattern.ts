/**
 * Asterisk dial patterns, read the way the switch reads them, for the route tester (VOIP-TRK-05, design A06):
 * "which route, trunk and cost would this number use?" — answered here when the server has no tester of its own,
 * from the same rows the server renders into `extensions_worksuite.conf`.
 *
 *   _07XXXXXXXX   X any digit · Z 1–9 · N 2–9 · [1-689] one of · `.` one or more of anything · `!` zero or more
 *   119           no underscore: that exact number
 *
 * FreePBX writes the same patterns without the underscore (`07XXXXXXXX`, `0[1-689]XXXXXXXX`, `00.`), so a value
 * holding any pattern letter is read as a pattern too.
 */

type Token = { kind: 'set'; chars: Set<string> } | { kind: 'any1' } | { kind: 'any0' };

const PATTERN_CHARS = /[XZN[.!]/;

function expandClass(body: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < body.length; i += 1) {
    const a = body[i]!;
    const b = body[i + 2];
    if (body[i + 1] === '-' && b !== undefined) {
      const lo = a.charCodeAt(0);
      const hi = b.charCodeAt(0);
      for (let c = Math.min(lo, hi); c <= Math.max(lo, hi); c += 1) out.add(String.fromCharCode(c));
      i += 2;
    } else out.add(a);
  }
  return out;
}

const DIGITS = (from: number) => new Set(Array.from({ length: 10 - from }, (_, i) => String(i + from)));

/** The pattern as tokens, or null when it is not a valid pattern (an unclosed `[`). */
export function tokenize(pattern: string): Token[] | null {
  const p = pattern.trim().replace(/^_/, '');
  const out: Token[] = [];
  for (let i = 0; i < p.length; i += 1) {
    const ch = p[i]!;
    const up = ch.toUpperCase();
    if (up === 'X') out.push({ kind: 'set', chars: DIGITS(0) });
    else if (up === 'Z') out.push({ kind: 'set', chars: DIGITS(1) });
    else if (up === 'N') out.push({ kind: 'set', chars: DIGITS(2) });
    else if (ch === '.') out.push({ kind: 'any1' });
    else if (ch === '!') out.push({ kind: 'any0' });
    else if (ch === '[') {
      const end = p.indexOf(']', i);
      if (end < 0) return null;
      out.push({ kind: 'set', chars: expandClass(p.slice(i + 1, end)) });
      i = end;
    } else out.push({ kind: 'set', chars: new Set([ch]) });
  }
  return out;
}

export function isPattern(pattern: string): boolean {
  const p = pattern.trim();
  return p.startsWith('_') || PATTERN_CHARS.test(p);
}

/** Does `number` match `pattern`, as Asterisk would? */
export function matches(pattern: string, number: string): boolean {
  const n = number.trim();
  if (!n) return false;
  if (!isPattern(pattern)) return pattern.trim() === n;
  const toks = tokenize(pattern);
  if (!toks) return false;
  const walk = (ti: number, ni: number): boolean => {
    if (ti === toks.length) return ni === n.length;
    const t = toks[ti]!;
    if (t.kind === 'set') return ni < n.length && t.chars.has(n[ni]!) && walk(ti + 1, ni + 1);
    // `.` needs at least one more character, `!` none; both may take the rest.
    const min = t.kind === 'any1' ? 1 : 0;
    for (let k = n.length; k >= ni + min; k -= 1) if (walk(ti + 1, k)) return true;
    return false;
  };
  return walk(0, 0);
}

/**
 * How specific a pattern is, for ordering ties the way Asterisk sorts patterns: literal digits beat classes, classes
 * beat wildcards. Higher is more specific.
 */
export function specificity(pattern: string): number {
  if (!isPattern(pattern)) return 10_000 + pattern.length;
  const toks = tokenize(pattern) ?? [];
  return toks.reduce((s, t) => s + (t.kind === 'set' ? (t.chars.size === 1 ? 100 : 100 - t.chars.size) : 0), 0);
}

/** Several patterns in one field (`119 · 110 · 1990`), as the A06 table writes them. */
export function splitPatterns(field: string): string[] {
  return field
    .split(/[\s,·|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface RouteLike {
  id: number;
  name: string;
  pattern: string;
  trunk_id: number | null;
  failover_trunk_id: number | null;
  strip_digits: number;
  prepend: string | null;
  priority: number;
  kind: string;
  enabled: boolean;
}

export interface TrunkLike {
  id: number;
  name: string;
  status: string;
  enabled: boolean;
  max_channels: number;
  cost_per_min: number | null;
  caller_id?: string | null;
  kind?: string;
}

export interface RouteTestStep {
  text: string;
  tone: 'ok' | 'warn' | 'fail';
}

export interface RouteTestResult {
  route: RouteLike | null;
  trunk: TrunkLike | null;
  failover: TrunkLike | null;
  sent: string | null;
  cost_per_min: number | null;
  steps: RouteTestStep[];
}

/** The number a route sends to the trunk: strip, then prepend — the order PbxConfig renders. */
export function rewrite(number: string, route: Pick<RouteLike, 'strip_digits' | 'prepend'>): string {
  const stripped = number.slice(Math.max(0, route.strip_digits | 0));
  return `${route.prepend ?? ''}${stripped}`;
}

const usable = (t: TrunkLike | null | undefined): boolean => !!t && t.enabled && t.status !== 'unreachable' && t.status !== 'disabled';

/**
 * Walk the outbound routes for a dialled number: first match by priority wins (the A06 header says so). Emergency
 * routes are never blocked — when its trunk is down the tester says the switch will still try every trunk.
 */
export function testRoute(number: string, routes: RouteLike[], trunks: TrunkLike[]): RouteTestResult {
  const n = number.replace(/[^0-9*#+]/g, '');
  const byId = new Map(trunks.map((t) => [t.id, t]));
  const steps: RouteTestStep[] = [];
  const ordered = routes.filter((r) => r.enabled).sort((a, b) => a.priority - b.priority || a.id - b.id);
  const route = ordered.find((r) => splitPatterns(r.pattern).some((p) => matches(p, n))) ?? null;
  if (!n) return { route: null, trunk: null, failover: null, sent: null, cost_per_min: null, steps: [{ text: 'Type a number to test.', tone: 'warn' }] };
  if (!route) {
    steps.push({ text: `No outbound route matches ${n}. The switch would refuse this call.`, tone: 'fail' });
    return { route: null, trunk: null, failover: null, sent: null, cost_per_min: null, steps };
  }
  const position = ordered.indexOf(route) + 1;
  steps.push({ text: `Matches route ${position} “${route.name}” (${route.pattern}).`, tone: 'ok' });
  const sent = rewrite(n, route);
  if (sent !== n) steps.push({ text: `Sent as ${sent}${route.strip_digits ? ` (strip ${route.strip_digits})` : ''}${route.prepend ? ` (prepend ${route.prepend})` : ''}.`, tone: 'ok' });
  else steps.push({ text: `Sent as dialled: ${sent}.`, tone: 'ok' });
  const trunk = route.trunk_id !== null ? (byId.get(route.trunk_id) ?? null) : null;
  const failover = route.failover_trunk_id !== null ? (byId.get(route.failover_trunk_id) ?? null) : null;
  if (!trunk) {
    steps.push({ text: route.kind === 'other' && !route.trunk_id ? 'This route has no trunk: the call is refused.' : 'The route names a trunk that no longer exists.', tone: 'fail' });
  } else if (usable(trunk)) {
    steps.push({ text: `${trunk.name}${trunk.max_channels ? ` — up to ${trunk.max_channels} channel${trunk.max_channels === 1 ? '' : 's'}` : ''}.`, tone: 'ok' });
  } else {
    steps.push({ text: `${trunk.name} is ${trunk.enabled ? trunk.status : 'disabled'}.`, tone: 'warn' });
  }
  if (failover) steps.push({ text: `If ${trunk?.name ?? 'the first trunk'} is busy: ${failover.name}${usable(failover) ? '' : ` (${failover.status})`}.`, tone: usable(failover) ? 'ok' : 'warn' });
  else if (!usable(trunk)) steps.push({ text: 'No failover trunk is set, so this call would fail.', tone: 'fail' });
  if (route.kind === 'emergency') steps.push({ text: 'Emergency numbers always use the first available trunk and are never blocked by budgets or time rules.', tone: 'ok' });
  const priced = usable(trunk) ? trunk : usable(failover) ? failover : null;
  const cost = priced?.cost_per_min ?? null;
  steps.push({ text: cost === null ? 'No rate is set for this trunk, so the cost is not counted.' : `Estimated cost ${cost.toFixed(2)} / min.`, tone: cost === null ? 'warn' : 'ok' });
  return { route, trunk, failover, sent, cost_per_min: cost, steps };
}
