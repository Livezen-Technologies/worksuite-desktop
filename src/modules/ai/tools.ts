import { useQuery } from '@tanstack/react-query';
import type { AiEngine, AiModuleAccessPrefs, AiModuleToggle } from '@shared/types';
import { ApiError, apiGet, apiPost, apiPut } from '../../core/api';
import type { LocalMessage } from '../../core/local-ai';
import type { AskSource, AskTool, PendingAction } from './assistant';

/**
 * WorkSuite's module functions for the assistants (worksuite-desktop#51).
 *
 * The model on this computer decides which function to call; the WorkSuite server runs it, as the signed-in person,
 * with their company, role and record permissions, and records it in the activity history. Reading answers with
 * the data; a change comes back as a pending action — the same reviewable card WorkSuite AI's proposals use — and
 * happens only when the person confirms it there. The model never sees anything the person could not open, and
 * turning a module on here never grants access the person does not already have.
 *
 * Server contract (docs/BACKEND.md, "AI module functions"):
 * - `GET  /api/ai/module-access` → the organization's ceiling per module and assistant, and whether this person may
 *   change it; `PUT /api/ai/module-access {modules}` changes it (administrators only).
 * - `GET  /api/ai/tools?engine=local` → the functions this person may use with Local AI right now.
 * - `POST /api/ai/tools/{name}/run {arguments, engine}` → a read's result, or a change's pending action, or what is
 *   missing or refused and why.
 */

/** A module as the organization's setting sees it. */
export interface OrgModule {
  key: string;
  label: string;
  /** Which kinds of function the module has at all. */
  supports: { read: boolean; write: boolean };
  /** What the organization allows each assistant. */
  worksuite: AiModuleToggle;
  local: AiModuleToggle;
  /** Why the person cannot use the module at all (no access to the app), when they cannot. */
  denied?: string | null;
}

export interface OrgAccess {
  modules: OrgModule[];
  /** An administrator: the organization's column is theirs to change. */
  can_manage: boolean;
  /**
   * Whether Local AI may prepare changes at all (G-01, Q-03): false in this release unless the installation's
   * `ai_local_writes` setting is on. Absent from an older server, which decides per function instead.
   */
  local_writes?: boolean;
}

/** Why Local AI's "Create or update" column is off everywhere while the server keeps Local AI to reads (Q-03). */
export const LOCAL_READS_ONLY = 'Local AI only reads your WorkSuite data in this release. Changes are prepared by WorkSuite AI.';

/** One module function, as the model is told about it. */
export interface AiTool {
  name: string;
  module: string;
  kind: 'read' | 'write';
  label: string;
  description: string;
  /** JSON Schema of the arguments: `{type: 'object', properties, required}`. */
  parameters: { type?: 'object'; properties?: Record<string, { type?: string; description?: string; enum?: unknown[] }>; required?: string[] };
}

export interface ToolRun {
  ok: boolean;
  /** A read's data, short enough for the model (the server trims it). */
  data?: unknown;
  /** A change, waiting for the person's confirmation. */
  pending_action?: PendingAction | null;
  /** Required details the change still needs. */
  missing?: Array<{ name: string; label: string }>;
  /** The records the answer is about. */
  links?: Array<{ label: string; url: string }>;
  error?: string | null;
  code?: string | null;
}

const KEY = ['ai', 'module-access'] as const;

/** The organization's Module Access. Null when this server has none yet (404): every module then follows the person's own permissions. */
export function useOrgAccess(enabled = true) {
  return useQuery({
    queryKey: KEY,
    queryFn: async ({ signal }) => {
      try {
        return await apiGet<OrgAccess>('/api/ai/module-access', undefined, signal);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    enabled,
    staleTime: 60_000,
    retry: (n, e) => !(e instanceof ApiError && (e.forbidden || e.status === 404)) && n < 1,
  });
}

export function saveOrgAccess(modules: Array<Pick<OrgModule, 'key' | 'worksuite' | 'local'>>): Promise<OrgAccess> {
  return apiPut<OrgAccess>('/api/ai/module-access', { modules });
}

export const ORG_ACCESS_KEY = KEY;

/** What one module may do for one assistant, all things considered — and, when it may not, why. */
export interface Effective {
  read: boolean;
  write: boolean;
  /** Why reading is off, in a sentence the person can act on. */
  readWhy: string | null;
  writeWhy: string | null;
}

const ENGINE_NAME: Record<AiEngine, string> = { worksuite: 'WorkSuite AI', local: 'Local AI' };

/** The person's choice for a module; a module never set is on. */
export function personal(prefs: AiModuleAccessPrefs | undefined, engine: AiEngine, module: string): AiModuleToggle {
  return prefs?.[engine]?.[module] ?? { read: true, write: true };
}

/** The organization's ceiling, the module's own functions and the person's choice, together. */
export function effective(m: OrgModule, engine: AiEngine, prefs: AiModuleAccessPrefs | undefined, localWrites?: boolean): Effective {
  const mine = personal(prefs, engine, m.key);
  const org = m[engine];
  const why = (kind: 'read' | 'write'): string | null => {
    if (m.denied) return m.denied;
    if (engine === 'local' && kind === 'write' && localWrites === false && m.supports.write) return LOCAL_READS_ONLY;
    if (!m.supports[kind]) return kind === 'read' ? `${m.label} has no data the assistant can read yet.` : `${m.label} has no changes the assistant can make yet.`;
    if (!org[kind] || (kind === 'write' && !org.read)) return `Your organization has turned ${kind === 'read' || !org.read ? 'reading' : 'changes'} in ${m.label} off for ${ENGINE_NAME[engine]}.`;
    if (kind === 'write' && !(mine.read && org.read)) return `Changes need ${m.label}'s data to be on too.`;
    if (!mine[kind]) return `You turned ${kind === 'read' ? 'reading' : 'changes'} in ${m.label} off for ${ENGINE_NAME[engine]} in Settings › AI Assistant › Module Access.`;
    return null;
  };
  const readWhy = why('read');
  const writeWhy = why('write');
  return { read: !readWhy, write: !writeWhy, readWhy, writeWhy };
}

/**
 * What this person switched off for an assistant, sent with every WorkSuite AI question (`module_access`): the server
 * applies its own ceiling and the person's permissions, and leaves these out as well. Undefined when nothing is off.
 */
export function personalOff(prefs: AiModuleAccessPrefs | undefined, engine: AiEngine): { read: string[]; write: string[] } | undefined {
  const mine = Object.entries(prefs?.[engine] ?? {});
  const read = mine.filter(([, t]) => !t.read).map(([k]) => k);
  const write = mine.filter(([, t]) => !t.write || !t.read).map(([k]) => k);
  return read.length || write.length ? { read, write } : undefined;
}

/** Whether Local AI may run a function now: the module as the organization and the person have set it. */
export function toolAllowed(tool: AiTool, org: OrgAccess | null | undefined, prefs: AiModuleAccessPrefs | undefined): string | null {
  const m = org?.modules.find((x) => x.key === tool.module);
  if (m) {
    const e = effective(m, 'local', prefs, org?.local_writes);
    return tool.kind === 'read' ? e.readWhy : e.writeWhy;
  }
  if (tool.kind === 'write' && org?.local_writes === false) return LOCAL_READS_ONLY;
  const mine = personal(prefs, 'local', tool.module);
  const label = tool.module.charAt(0).toUpperCase() + tool.module.slice(1);
  if (!mine.read) return `You turned ${label} off for Local AI in Settings › AI Assistant › Module Access.`;
  if (tool.kind === 'write' && !mine.write) return `You turned changes in ${label} off for Local AI in Settings › AI Assistant › Module Access.`;
  return null;
}

/** The functions Local AI may use now: reads, and changes only when the server says `local_writes` (Q-03). */
export async function fetchLocalTools(signal?: AbortSignal): Promise<AiTool[]> {
  try {
    const r = await apiGet<{ tools: AiTool[]; local_writes?: boolean }>('/api/ai/tools', { engine: 'local' }, signal);
    // The model is never told of a change it cannot make.
    return (r.tools ?? []).filter((t) => t.kind === 'read' || r.local_writes === true);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.forbidden)) return [];
    throw e;
  }
}

export function useLocalTools(enabled: boolean) {
  return useQuery({
    queryKey: ['ai', 'tools', 'local'],
    queryFn: ({ signal }) => fetchLocalTools(signal),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function runTool(name: string, args: Record<string, unknown>): Promise<ToolRun> {
  return apiPost<ToolRun>(`/api/ai/tools/${encodeURIComponent(name)}/run`, { arguments: args, engine: 'local' });
}

// ── Local AI calling module functions ─────────────────────────────────────

const MAX_STEPS = 4;

/** How the model is told about the functions, and how to call one: a tagged JSON line it can write in plain text. */
export function toolsSystem(tools: AiTool[], off: string[], today: string): string {
  const list = tools
    .map((t) => {
      const props = Object.entries(t.parameters.properties ?? {}).map(([k, p]) => `${k}${t.parameters.required?.includes(k) ? '' : '?'}: ${p.type ?? 'string'}${p.enum ? ` (${p.enum.join('|')})` : ''}${p.description ? ` — ${p.description}` : ''}`);
      return `- ${t.name} [${t.kind === 'read' ? 'reads' : 'prepares a change'}] ${t.description}${props.length ? `\n  arguments: ${props.join('; ')}` : ''}`;
    })
    .join('\n');
  return [
    "You are WorkSuite's assistant, running on this computer. Answer clearly and briefly.",
    `Today is ${today}.`,
    "You can use the person's WorkSuite data and prepare changes only through these functions, which WorkSuite runs as them:",
    list || '(none)',
    'To call one, reply with exactly one line and nothing else:',
    '<call>{"name": "function_name", "arguments": {…}}</call>',
    "You then get its result and continue. Never invent figures or records: use a function, or say you cannot see it.",
    'A function that prepares a change does not apply it: the person reviews and confirms it. Say that it is ready to review — never that it is done.',
    'Before preparing a change, ask for any required detail you do not have instead of guessing it.',
    off.length ? `These are switched off and you must say so if asked about them: ${off.join('; ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** A function call in the model's answer, if it made one. */
export function parseCall(text: string): { name: string; arguments: Record<string, unknown> } | null {
  const m = /<call>\s*([\s\S]*?)\s*<\/call>/.exec(text) ?? /<call>\s*(\{[\s\S]*\})\s*$/.exec(text);
  if (!m) return null;
  try {
    const v = JSON.parse(m[1]!) as { name?: unknown; arguments?: unknown };
    if (typeof v.name !== 'string' || !/^[a-z][a-z0-9_.]{0,63}$/i.test(v.name)) return null;
    const args = v.arguments && typeof v.arguments === 'object' && !Array.isArray(v.arguments) ? (v.arguments as Record<string, unknown>) : {};
    return { name: v.name, arguments: args };
  } catch {
    return null;
  }
}

/** A function's result, as the model reads it next. */
export function resultMessage(name: string, r: ToolRun): string {
  if (r.pending_action) {
    const p = r.pending_action.preview;
    return `Result of ${name}: a change is ready for the person to review and confirm (not applied yet): ${p.title}${p.lines.length ? ` — ${p.lines.join('; ')}` : ''}. Tell them to review it below.`;
  }
  if (r.missing?.length) return `Result of ${name}: not prepared — these details are needed: ${r.missing.map((x) => x.label).join(', ')}. Ask the person for them.`;
  if (!r.ok) return `Result of ${name}: refused — ${r.error ?? 'WorkSuite did not run it.'} Explain this to the person.`;
  const data = typeof r.data === 'string' ? r.data : JSON.stringify(r.data ?? null);
  return `Result of ${name}:\n${data.slice(0, 6000)}`;
}

export interface AgentResult {
  text: string;
  cancelled: boolean;
  tools: AskTool[];
  actions: PendingAction[];
  sources: AskSource[];
  /** A function needed details the person has not given: the answer asks them for those. */
  asked: boolean;
}

/**
 * One answer from the model on this computer, calling module functions along the way: at most a few calls, each
 * checked against Module Access here and run by WorkSuite as the person. `ask` is the model (askLocal).
 */
export async function runLocalAgent(opts: {
  messages: LocalMessage[];
  tools: AiTool[];
  /** Whether a function may run now, and why not when it may not. */
  allow: (tool: AiTool) => string | null;
  ask: (messages: LocalMessage[], onText: (t: string) => void) => { done: Promise<{ text: string; cancelled: boolean }>; cancel(): void };
  onText: (t: string) => void;
  onCancelSet: (cancel: () => void) => void;
  run?: typeof runTool;
}): Promise<AgentResult> {
  const run = opts.run ?? runTool;
  const msgs = [...opts.messages];
  const tools: AskTool[] = [];
  const actions: PendingAction[] = [];
  const sources: AskSource[] = [];
  let asked = false;
  for (let step = 0; ; step++) {
    // A call is not shown while it is being written: only an answer streams.
    const job = opts.ask(msgs, (t) => (/<call>/.test(t) ? undefined : opts.onText(t)));
    opts.onCancelSet(() => job.cancel());
    const r = await job.done;
    const call = r.cancelled ? null : parseCall(r.text);
    if (!call || step >= MAX_STEPS) {
      const text = call ? 'I could not finish this in a few steps. Try asking for one thing at a time.' : r.text.replace(/<call>[\s\S]*?<\/call>/g, '').trim();
      return { text, cancelled: r.cancelled, tools, actions, sources, asked };
    }
    msgs.push({ role: 'assistant', content: r.text.trim() });
    const tool = opts.tools.find((t) => t.name === call.name);
    let out: ToolRun;
    if (!tool) out = { ok: false, error: `${call.name} is not a WorkSuite function you can use with Local AI.`, code: 'unsupported' };
    else {
      const why = opts.allow(tool);
      if (why) out = { ok: false, error: why, code: 'module_off' };
      else {
        try {
          out = await run(tool.name, call.arguments);
        } catch (e) {
          out = { ok: false, error: e instanceof ApiError && e.offline ? 'This needs a connection to WorkSuite. The model runs on this computer, but your WorkSuite data and changes come from the server.' : e instanceof Error ? e.message : 'WorkSuite did not run it.', code: 'failed' };
        }
      }
    }
    tools.push({ name: call.name, label: tool?.label ?? call.name, ok: out.ok || !!out.missing?.length, error: out.ok ? null : (out.error ?? null) });
    if (out.pending_action) actions.push(out.pending_action);
    if (out.missing?.length) asked = true;
    for (const l of out.links ?? []) if (!sources.some((s) => s.url === l.url)) sources.push({ n: sources.length + 1, kind: 'record', title: l.label, url: l.url });
    msgs.push({ role: 'user', content: resultMessage(call.name, out) });
  }
}
