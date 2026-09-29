import type * as g from '../../../src/modules/garage/api';

/** Garage as the server answers it (the stage-A contract, `web-api.md`), for the Garage tests. */
export const can = (over: Partial<Record<g.CanKey, boolean>> = {}) => ({ dashboard: true, view: true, create: true, edit: true, cancel: true, vehicles: true, manage_vehicles: true, checkin: true, settings: false, ...over });
export const company = (id: number, over: Partial<g.Company> = {}): g.Company => ({ id, name: `Company ${id}`, currency: 'LKR', today: '2026-09-29', distance_unit: 'km', setup_complete: true, branches: [], can: can(), ...over });

export const OPTIONS: g.Options = {
  companies: [company(1)],
  scope: 'all',
  my_branches: [],
  statuses: { draft: 'Draft', checked_in: 'Checked in', estimate_preparation: 'Estimate preparation', awaiting_customer_approval: 'Awaiting customer approval', approved: 'Approved', completed: 'Completed', cancelled: 'Cancelled' },
  columns: {
    check_in: { label: 'Check-in', statuses: ['draft', 'checked_in'] },
    diagnosis: { label: 'Diagnosis', statuses: ['inspection', 'diagnosis'] },
    estimate: { label: 'Estimate', statuses: ['estimate_preparation'] },
    approval: { label: 'Approval', statuses: ['awaiting_customer_approval', 'additional_approval_required'] },
    waiting_parts: { label: 'Waiting parts', statuses: ['approved', 'waiting_parts'] },
  },
  priorities: { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' },
  job_types: { service: 'Service', repair: 'Repair' },
  sources: { walk_in: 'Walk-in' },
  waiting_reasons: { parts: 'Parts', approval: 'Approval' },
  cancel_reasons: { customer_declined: 'Customer declined', other: 'Other' },
  vehicle_types: { car: 'Car', van: 'Van' },
  fuels: { petrol: 'Petrol' },
  transmissions: { manual: 'Manual' },
  odometer_sources: { checkin: 'Check-in', manual: 'Manual' },
  checkin: {
    areas: { front_bumper: 'Front bumper', doors: 'Doors' },
    conditions: { good: 'Good', scratch: 'Scratch' },
    damage_marks: { scratch: 'Scratch', dent: 'Dent' },
    views: { top: 'Top', front: 'Front' },
    photo_slots: { front: 'Front', rear: 'Rear' },
    complaints: { warning_light: 'Warning light', oil_leak: 'Oil leak' },
    fuel_marks: { E: 0, '1/4': 25, '1/2': 50, '3/4': 75, F: 100 },
    requirable: {},
  },
  media_contexts: { checkin: 'Check-in', other: 'Other' },
  bay_types: { general: 'General' },
  bay_statuses: { available: 'Available' },
  rate_types: { hourly: 'Hourly' },
  default_skills: { general: 'General' },
};

export function job(over: Partial<g.Job> = {}): g.Job {
  return {
    id: 12,
    org_id: 1,
    branch_id: 1,
    number: 'JOB-2026-000012',
    status: 'awaiting_customer_approval',
    status_label: 'Awaiting customer approval',
    column: 'approval',
    waiting_reason: 'approval',
    priority: 'normal',
    job_type: 'service',
    source: 'walk_in',
    vehicle: { id: 7, vehicle_number: 'WP CAB-1234', make: 'Toyota', model: 'Prius', make_model: 'Toyota Prius', year: 2016, colour: null, vehicle_type: 'car', odometer: 84250, fleet: false },
    customer: { id: 1, name: 'Dilani Fernando', phone: '+94771234567', email: null },
    service_advisor: { id: 3, name: 'Sanduni Perera' },
    technicians: [],
    bay: null,
    requested_work: 'Brakes grinding',
    target_completion_at: '2026-09-29T12:30:00Z',
    overdue: false,
    checkin_at: '2026-09-29T04:00:00Z',
    completed_at: null,
    created_at: '2026-09-29T03:50:00Z',
    updated_at: '2026-09-29T05:00:00Z',
    version: 3,
    ...over,
  };
}

export const checkin = (over: Partial<g.Checkin> = {}): g.Checkin => ({
  status: 'draft',
  odometer: null,
  fuel_level: null,
  complaints: [],
  requested_services: [],
  conditions: [],
  damage: [],
  accessories: [],
  valuables: null,
  estimated_handover_at: null,
  signer: null,
  photos: [],
  completed_at: null,
  missing: [],
  ...over,
});

export function job360(over: Partial<g.Job360> = {}): g.Job360 {
  return {
    ...job(),
    pipeline: { code: 'standard', name: 'Standard', version: 1, inspection_required: true, express: false, road_test_required: false },
    workshop: null,
    service_type: null,
    notes: null,
    odometer_in: 84250,
    fuel_level: 50,
    started_at: null,
    currency: 'LKR',
    totals: null,
    invoice_id: null,
    cancel: null,
    checkin: checkin(),
    diagnostics: [],
    media: [],
    job_notes: [],
    status_history: [],
    timeline: [],
    transitions: [],
    can: { edit: true, checkin: false, cancel: true, assign: false, publish_media: false, override_odometer: false },
    ...over,
  } as g.Job360;
}

export const ok = (data: unknown, message = 'Done.') => new Response(JSON.stringify({ status: 'success', message, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
export const fail = (status: number, message: string, errors: unknown = null) => new Response(JSON.stringify({ status: 'error', message, errors }), { status, headers: { 'Content-Type': 'application/json' } });

