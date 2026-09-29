import { lazy, type ComponentType } from 'react';
import type { CanKey, Company, Job360, Options } from './api';
import { hasB1 } from './api-b1';
import { hasWorkOrders } from './api-b2';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THE JOB CARD'S TABS AND THE RAIL'S STAGE-B SCREENS ARE DECLARED
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The job card (Job 360°, SRS §13 / §28.3, FR-JOB-07) draws the tabs listed
 * here, in this order, and nothing else. Stage A built Overview, Check-in,
 * Media, Notes and Activity; B1 Inspection, Diagnosis and Estimate; B2 Work
 * orders (with the labour). A stage brings its area as its own file under
 * `job/` (and its calls in `api-<stage>.ts`) and changes ONE entry below —
 * the `soon` line of its tab — to name the component, e.g. B3:
 *
 *   { id: 'parts', label: 'Parts', stage: 'B3', when: (j) => j.parts != null, component: lazy(() => import('./job/Parts')) },
 *
 * A tab without a `component` is listed dimmed, with its `soon` sentence as
 * the reason, because FR-JOB-07 lists it for P1 and the person should see
 * where it will be. `can` hides it from whoever may not (a key of the
 * company's `can` in `GET options`; stage B may add keys there); `when` hides
 * it from jobs it does not apply to (a pipeline without a road test).
 *
 * A tab gets the job exactly as the server sent it — Job 360°, with the
 * stage's own key added to `JobCard::view` — and calls `onChanged` after a
 * write so the card, the board and the lists are read again. It may hand back
 * the job the write answered with, which saves the reread. It must disable
 * its writes while `online` is false: every garage write needs WorkSuite.
 */
export interface JobTabProps {
  job: Job360;
  /** The job's company, and what the reader may do there (`company.can`). */
  company: Company | undefined;
  options: Options;
  /** Whether WorkSuite can be reached; writes are online only. */
  online: boolean;
  onChanged: (job?: Job360 | null) => void;
  /** Open another job's card (a linked job), in this tab. */
  onJob: (id: number) => void;
}

export interface JobTab {
  id: string;
  label: string;
  /** Which part of P1 builds it (A, or the stage-B agent that owns it). */
  stage: 'A' | 'B1' | 'B2' | 'B3';
  /** Shown only to those who may do this in the job's company. Absent: everybody who sees the job. */
  can?: CanKey;
  /** Whether it applies to this job at all. */
  when?: (job: Job360) => boolean;
  /** The tab. Absent: listed dimmed, with `soon` as its reason. */
  component?: ComponentType<JobTabProps>;
  soon?: string;
}

export const JOB_TABS: JobTab[] = [
  { id: 'overview', label: 'Overview', stage: 'A', component: lazy(() => import('./job/Overview')) },
  { id: 'checkin', label: 'Check-in', stage: 'A', component: lazy(() => import('./job/Checkin')) },
  /* ---- B1: inspections, diagnosis, estimates, approval, additional work ---- */
  // `inspections` is on the card only for those who may see inspections; a server without stage B1 has no such key.
  { id: 'inspection', label: 'Inspection', stage: 'B1', when: (j) => Array.isArray(j.inspections), component: lazy(() => import('./job/Inspection')) },
  { id: 'diagnosis', label: 'Diagnosis', stage: 'B1', when: hasB1, component: lazy(() => import('./job/Diagnosis')) },
  { id: 'estimate', label: 'Estimate', stage: 'B1', can: 'estimates', when: hasB1, component: lazy(() => import('./job/Estimate')) },
  /* ---- B2: work orders, technicians, labour, bays ---- */
  // `work_orders` is null for those who may not see work orders, and absent on a server without stage B2.
  { id: 'work-orders', label: 'Work orders', stage: 'B2', when: hasWorkOrders, component: lazy(() => import('./job/WorkOrders')) },
  /* ---- B3: parts, QC, road test, invoice, handover ---- */
  { id: 'parts', label: 'Parts', stage: 'B3', soon: 'Parts requests, reservations and issues arrive with the next Garage update.' },
  { id: 'qc', label: 'QC', stage: 'B3', soon: 'Quality control, rework and the road test arrive with the next Garage update.' },
  { id: 'invoice', label: 'Invoice & handover', stage: 'B3', soon: 'The invoice and the handover arrive with the next Garage update.' },
  /* ---- stage A ---- */
  { id: 'media', label: 'Media', stage: 'A', component: lazy(() => import('./job/Media')) },
  { id: 'notes', label: 'Notes', stage: 'A', component: lazy(() => import('./job/Notes')) },
  { id: 'activity', label: 'Activity', stage: 'A', component: lazy(() => import('./job/Activity')) },
];

/** The tabs this reader sees on this job, in order. */
export function tabsFor(job: Job360, company: Company | undefined, tabs: JobTab[] = JOB_TABS): JobTab[] {
  return tabs.filter((t) => (!t.can || !!company?.can[t.can]) && (!t.when || t.when(job)));
}

/** The tab a route asks for, when this reader sees it and it is built; else the first. */
export function tabFor(asked: string | null, visible: JobTab[]): JobTab | undefined {
  return visible.find((t) => t.id === asked && t.component) ?? visible.find((t) => t.component);
}

/**
 * Screens a stage adds to the Garage rail (SRS §8: Inspections, Estimates,
 * Workshop, Parts, Quality Control, Reports). Empty in stage A. A stage adds
 * its file and one line:
 *
 *   { id: 'parts', label: 'Parts', icon: 'package', group: 'work', can: 'parts_issue', component: lazy(() => import('./views/Parts')) },
 *
 * The shell routes `/garage?view=<id>` to it and lists it in the rail under
 * `group`, for those who hold `can` in some company in view.
 */
export interface GarageViewProps {
  /** The company picker: one company's id, or '' for every company in view. */
  org: string;
  options: Options;
  online: boolean;
  /** Open a job card in this tab, on one of its tabs. */
  onJob: (id: number, tab?: string) => void;
}

export interface GarageView {
  id: string;
  label: string;
  /** An icon name of `components/Icon`. */
  icon: string;
  group: 'work' | 'workshop' | 'reports';
  can?: CanKey;
  component: ComponentType<GarageViewProps>;
}

export const EXTRA_VIEWS: GarageView[] = [
  /* ---- B1: estimates held for a discount decision ---- */
  { id: 'discounts', label: 'Discounts to approve', icon: 'receipt', group: 'work', can: 'estimates', component: lazy(() => import('./views/Discounts')) },
  /* ---- B2: the technician's work, the bays, the calendar ---- */
  { id: 'my-work', label: 'My work', icon: 'timer', group: 'workshop', can: 'work', component: lazy(() => import('./views/MyWork')) },
  { id: 'bays', label: 'Service bays', icon: 'wrench', group: 'workshop', can: 'view', component: lazy(() => import('./views/Bays')) },
  { id: 'calendar', label: 'Workshop calendar', icon: 'calendar', group: 'workshop', can: 'view', component: lazy(() => import('./views/Calendar')) },
];
