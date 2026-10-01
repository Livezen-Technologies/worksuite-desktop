/**
 * Help & Guide (worksuite-desktop#54): how to do things in WorkSuite, answered from guides that ship with this
 * version of the app — so the steps name the menus and buttons this version actually has, also offline.
 *
 * A question that asks how to do something is answered with the guide's numbered steps, links to the screen, and a
 * Show me walkthrough that only highlights controls (it never clicks or changes anything). Whether the person may do
 * it is said, not used as a reason to refuse: guidance is always given, with the permission it needs.
 */
export interface GuideStep {
  /** One step, with the exact labels in “quotes”. */
  text: string;
  /** The `data-guide` id of the control the walkthrough highlights for this step. */
  target?: string;
  /** Where the step happens, when it is another screen than the guide's. */
  route?: string;
}

export interface Guide {
  id: string;
  /** The app it belongs to (registry id): suggested when the person is in it. */
  module: string;
  title: string;
  /** Words people use for it, besides the title's. */
  keywords: string[];
  /** The screen it starts on. */
  route: string;
  /** Permission keys any one of which lets the person do it; none when everyone may. */
  permissions?: string[];
  /** What to ask an administrator for, in words. */
  permissionLabel?: string;
  steps: GuideStep[];
  /** Short notes after the steps. */
  tips?: string[];
}

/**
 * Questions that ask how to do something or where it is — instructions. Not every question: "What is 2+2?" or
 * "Why was the order late?" are for the assistant, not a guide.
 */
const HOW = /^\s*how\b|\bhow (do|can|should|would|to|does one)\b|\bwhere (is|are|do|can)\b|\b(steps?|instructions?|walk ?through|tutorial|guide) (to|for|on)\b|\bshow me how\b|\bis (it|there a way)( possible)? to\b|^\s*(can|could) i\b/i;
/** A request to do it now: an imperative with a concrete object, without asking how. */
const DO = /^\s*(please\s+)?(create|make|send|add|schedule|book|share|delete|remove|update|change|set|assign|approve|reject|pay|invoice|email|message|open|close|move|rename|cancel)\b/i;

/** Whether a message asks for instructions (true) rather than for something to be done (false). */
export function isHowTo(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (HOW.test(t)) return true;
  if (DO.test(t)) return false;
  return /\?\s*$/.test(t) && /\b(create|make|send|add|share|set up|change|find|use|turn on|turn off)\b/i.test(t);
}

const STOP = new Set(['a', 'an', 'the', 'to', 'do', 'i', 'my', 'me', 'how', 'can', 'in', 'on', 'of', 'for', 'and', 'or', 'is', 'it', 'what', 'where', 'with', 'worksuite', 'please', 'new', 'you', 'should', 'would', 'could', 'up']);
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/(ing|es|s)$/, ''))
    .filter((w) => w.length > 1 && !STOP.has(w));

/** Verbs that say little about which guide is meant: they count, but less than the thing named. */
const GENERIC = new Set(['set', 'create', 'add', 'make', 'send', 'get', 'change', 'use', 'start', 'open', 'find', 'turn', 'put', 'see', 'do']);

/** Guides for a question, best first; the app the person is in counts for a little. */
export function findGuides(guides: Guide[], question: string, module: string | null, limit = 3): Guide[] {
  const q = new Set(words(question));
  if (!q.size) return [];
  return guides
    .map((g) => {
      const title = words(g.title);
      const keys = g.keywords.flatMap(words);
      let score = 0;
      for (const w of q) {
        const weight = GENERIC.has(w) ? 1 : 3;
        if (title.includes(w)) score += weight;
        else if (keys.includes(w)) score += weight - (GENERIC.has(w) ? 0 : 1);
      }
      if (score > 0 && module && g.module === module) score += 1;
      return { g, score };
    })
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.g);
}

/** Guides to suggest in the app the person is in, then the rest. */
export function suggestions(guides: Guide[], module: string | null, limit = 4): Guide[] {
  const here = guides.filter((g) => g.module === module);
  return [...here, ...guides.filter((g) => g.module !== module)].slice(0, limit);
}

/** Whether the person may do it: any one of the guide's permissions (or `*`). */
export function mayDo(g: Guide, permissions: readonly string[] | undefined): boolean {
  if (!g.permissions?.length) return true;
  const have = permissions ?? [];
  return have.includes('*') || g.permissions.some((p) => have.includes(p));
}

/** The guide as plain text: what a model is given for follow-up questions, and what is translated. */
export function guideText(g: Guide): string {
  return [
    `Guide: ${g.title}`,
    ...g.steps.map((s, i) => `${i + 1}. ${s.text}`),
    ...(g.tips ?? []).map((t) => `Tip: ${t}`),
    g.permissionLabel ? `Permission needed: ${g.permissionLabel}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** The app a route belongs to: `/sales?order=4` → `sales`. */
export function moduleOf(route: string | null | undefined): string | null {
  const m = /^\/([a-z0-9-]+)/.exec(route ?? '');
  return m ? m[1]! : null;
}
