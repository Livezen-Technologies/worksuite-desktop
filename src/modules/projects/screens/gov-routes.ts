import type { ProjectsView } from '../routes';

/** The tab's title on a governance view (W12–W15); null for any other view. */
export function governanceTitle(view: ProjectsView): string | null {
  switch (view.kind) {
    case 'budget':
      return view.projectId ? 'Projects · Budget' : 'Projects · Budget & cost';
    case 'risks':
      return 'Projects · Risks';
    case 'changes':
      return 'Projects · Changes';
    case 'reports':
      return 'Projects · Reports';
    default:
      return null;
  }
}
