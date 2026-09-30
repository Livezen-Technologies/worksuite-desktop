import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut } from '../../core/api';

/**
 * AI Studio (aistudio.livezentech.com, the OllamaHub the WorkSuite server is
 * connected to): the models the assistant answers with when it is not using a
 * model on this computer. The app never holds the hub's key or secret — every
 * call here goes to the WorkSuite server, which talks to the hub.
 *
 * `status` and `test-model` need `ai.view`; finding models on the hub and
 * choosing which this workspace offers need `ai.settings`, as on the web.
 */
export interface StudioStatus {
  configured: boolean;
  connected: boolean;
  reachable: boolean;
  credentials: boolean;
  /** The hub's own words about the connection. */
  detail: string;
  /** The models this workspace offers. */
  models: string[];
  last_sync_at: string | null;
}

export interface StudioDiscovery {
  available: string[];
  results: Record<string, { ok: boolean; detail: string }>;
  selected: string[];
}

export const STUDIO_KEY = ['ai', 'studio', 'status'] as const;

export const useStudioStatus = (enabled: boolean) =>
  useQuery({
    queryKey: STUDIO_KEY,
    queryFn: ({ signal }) => apiGet<StudioStatus>('/api/ai/studio/status', undefined, signal),
    enabled,
    staleTime: 60_000,
    retry: false,
  });

/** Ask the model for one word, through the server: says whether it answers, in the hub's words when it does not. */
export const testStudioModel = (model: string) => apiPost<{ model: string; ok: boolean; detail: string; reply: string | null }>('/api/ai/studio/test-model', { model });

/** Try the hub's model names for this key (a few dozen requests on the server). */
export const discoverStudioModels = (extra: string[] = []) => apiPost<StudioDiscovery>('/api/ai/studio/discover', { models: extra });

/** The models this workspace offers, as a whole list. */
export const setStudioModels = (models: string[]) => apiPut<unknown>('/api/ai/studio/models', { models });

/** What the connection amounts to, in a word and a tone. */
export function studioState(s: StudioStatus | undefined): { word: string; tone: 'success' | 'warning' | 'danger' | 'muted' } {
  if (!s) return { word: 'Checking…', tone: 'muted' };
  if (!s.configured) return { word: 'Not set up', tone: 'muted' };
  if (s.connected) return { word: 'Connected', tone: 'success' };
  if (!s.reachable) return { word: 'Unreachable', tone: 'danger' };
  if (!s.credentials) return { word: 'Key refused', tone: 'danger' };
  return { word: 'Not ready', tone: 'warning' };
}
