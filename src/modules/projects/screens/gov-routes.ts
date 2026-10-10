import type { ProjectsView } from '../routes';

/**
 * The tab's title on a governance view (W12–W15); null for any other view. One project's screen is named by its code
 * ("PRJ-0018 · Budget"), as the delivery screens are.
 */
export function governanceTitle(view: ProjectsView, code?: string | null): string | null {
  const scope = (view.kind === 'budget' || view.kind === 'risks' || view.kind === 'changes') && view.projectId ? (code ?? 'Projects') : 'Projects';
  switch (view.kind) {
    case 'budget':
      return view.projectId ? `${scope} · Budget` : 'Projects · Budget & cost';
    case 'risks':
      return `${scope} · Risks`;
    case 'changes':
      return `${scope} · Changes`;
    case 'reports':
      return 'Projects · Reports';
    default:
      return null;
  }
}
