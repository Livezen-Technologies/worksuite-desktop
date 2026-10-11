import { QueryClientContext, type QueryClient } from '@tanstack/react-query';
import { Suspense, useContext, type ReactNode } from 'react';
import { diagnosticsRoute } from '../core/screen-errors';
import type { DesktopModule } from '../modules/registry';

/**
 * What a module's boundary needs to recover (worksuite-desktop#338): Diagnostics opened on the error's reference,
 * Retry that drops the module's answers — its queries are keyed by its ID — so it starts again from the server and
 * this computer's copy, and the module's own way out, where it has one.
 */
export function moduleRecovery(mod: DesktopModule, qc: QueryClient | undefined, open: (route: string) => void): { onDiagnostics: (ref: string | null) => void; onRetry: () => void; recover?: (retry: () => void) => ReactNode } {
  const Recover = mod.recover;
  return {
    onDiagnostics: (ref) => open(diagnosticsRoute(ref)),
    onRetry: () => void qc?.resetQueries({ queryKey: [mod.id] }),
    ...(Recover
      ? {
          recover: (retry: () => void) => (
            <Suspense fallback={null}>
              <Recover onDone={retry} />
            </Suspense>
          ),
        }
      : {}),
  };
}

/** The query client, read without demanding a provider: a window drawn without one (tests, a bare shell) still gets its boundary. */
export function useOptionalQueryClient(): QueryClient | undefined {
  return useContext(QueryClientContext);
}
