import type { Project } from '../api';
import { usePermission } from '../portfolio';
import type { ProjectsView } from '../routes';
import { ActivityList } from './Activity';
import { ClientsView } from './Clients';
import { ModuleSettings } from './ModuleSettings';
import { ProjectPage } from './ProjectPage';
import { AllProjects, TemplatesView } from './Register';

/**
 * The PORTFOLIO screens in the Projects tab (PRJ-DSK-01): All projects, Templates, Clients, a project's page
 * (overview, team, settings, activity, files), the Activity log and Module settings. ProjectsPage hands over the view,
 * and these screens move about with routes, exactly as the web's addresses do.
 */

export type PortfolioView = Extract<ProjectsView, { kind: 'all' | 'templates' | 'clients' | 'project' | 'activity' | 'settings' }>;

const KINDS = new Set(['all', 'templates', 'clients', 'project', 'activity', 'settings']);

export function isPortfolio(v: ProjectsView): v is PortfolioView {
  return KINDS.has(v.kind);
}

const TAB_WORD = { overview: 'Overview', team: 'Team', settings: 'Settings', activity: 'Activity', files: 'Files' } as const;

/** The tab's title for a portfolio view, or null for the others. */
export function portfolioTitle(v: ProjectsView, projects: Map<number, Project>): string | null {
  if (!isPortfolio(v)) return null;
  switch (v.kind) {
    case 'all':
      return 'Projects · All projects';
    case 'templates':
      return 'Projects · Templates';
    case 'clients':
      return 'Projects · Clients';
    case 'activity':
      return 'Projects · Activity';
    case 'settings':
      return 'Projects · Settings';
    case 'project': {
      const p = projects.get(v.projectId);
      return `${p ? p.code : 'Project'} · ${TAB_WORD[v.tab]}`;
    }
  }
}

export function PortfolioScreen({ view, query, offline, onGo, onNew, onOpenTask, onOffline }: {
  view: PortfolioView;
  query: URLSearchParams;
  offline: boolean;
  onGo: (route: string) => void;
  /** Opens New project over this view: blank, or from a template. */
  onNew: (templateId: number | null) => void;
  onOpenTask: (taskId: number) => void;
  onOffline: (o: boolean) => void;
}) {
  const may = usePermission();
  const mayCreate = may('project.manage');
  switch (view.kind) {
    case 'all':
      return <AllProjects query={query} offline={offline} mayCreate={mayCreate} onGo={onGo} onNew={() => onNew(null)} onOffline={onOffline} />;
    case 'templates':
      return <TemplatesView offline={offline} mayCreate={mayCreate} onGo={onGo} onUse={onNew} onOffline={onOffline} />;
    case 'clients':
      return <ClientsView id={view.id} offline={offline} onGo={onGo} onOffline={onOffline} />;
    case 'activity':
      return <ActivityList onGo={onGo} onOpenTask={onOpenTask} onOffline={onOffline} />;
    case 'settings':
      return <ModuleSettings offline={offline} onOffline={onOffline} />;
    case 'project':
      return <ProjectPage key={view.projectId} projectId={view.projectId} tab={view.tab} offline={offline} onGo={onGo} onOpenTask={onOpenTask} onOffline={onOffline} />;
  }
}
