/**
 * Service & Repair (Service & Repair blueprint): the job statuses, the default workflow between them, and the
 * desktop's views. The server is the authority on every transition (it validates workflow state, permissions and
 * concurrency, and an organisation may add statuses); this is the default map the desktop uses to offer the next
 * steps, and an unknown status from the server is shown as it comes, with no steps offered.
 */
export const SERVICE_STATUSES = [
  'new', 'received', 'diagnosing', 'awaiting_quote', 'awaiting_approval', 'approved', 'waiting_parts', 'in_progress',
  'external_service', 'qa_testing', 'rework_required', 'ready_for_pickup', 'delivered', 'closed', 'cancelled', 'unrepairable',
] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const STATUS_LABEL: Record<ServiceStatus, string> = {
  new: 'New', received: 'Received', diagnosing: 'Diagnosing', awaiting_quote: 'Awaiting Quote', awaiting_approval: 'Awaiting Approval',
  approved: 'Approved', waiting_parts: 'Waiting for Parts', in_progress: 'In Progress', external_service: 'External Service',
  qa_testing: 'QA Testing', rework_required: 'Rework Required', ready_for_pickup: 'Ready for Pickup', delivered: 'Delivered',
  closed: 'Closed', cancelled: 'Cancelled', unrepairable: 'Unrepairable',
};

export type StatusTone = 'muted' | 'indigo' | 'success' | 'warning' | 'danger' | 'teal';
export const STATUS_TONE: Record<ServiceStatus, StatusTone> = {
  new: 'muted', received: 'muted', diagnosing: 'indigo', awaiting_quote: 'warning', awaiting_approval: 'warning', approved: 'indigo',
  waiting_parts: 'warning', in_progress: 'indigo', external_service: 'teal', qa_testing: 'teal', rework_required: 'danger',
  ready_for_pickup: 'success', delivered: 'success', closed: 'muted', cancelled: 'muted', unrepairable: 'danger',
};

/** Ended jobs: nothing more is done to the device. */
export const TERMINAL: readonly ServiceStatus[] = ['closed', 'cancelled'];

/**
 * The default workflow. Cancelling is open to every job not yet delivered (the server asks for a reason);
 * Unrepairable from wherever the fault has been looked at.
 */
const NEXT: Record<ServiceStatus, ServiceStatus[]> = {
  new: ['received'],
  received: ['diagnosing'],
  diagnosing: ['awaiting_quote', 'unrepairable'],
  awaiting_quote: ['awaiting_approval'],
  awaiting_approval: ['approved', 'awaiting_quote'],
  approved: ['in_progress', 'waiting_parts', 'external_service'],
  waiting_parts: ['in_progress'],
  in_progress: ['qa_testing', 'waiting_parts', 'external_service', 'awaiting_quote', 'unrepairable'],
  external_service: ['qa_testing', 'in_progress', 'unrepairable'],
  qa_testing: ['ready_for_pickup', 'rework_required'],
  rework_required: ['in_progress'],
  ready_for_pickup: ['delivered'],
  delivered: ['closed'],
  closed: [],
  cancelled: [],
  unrepairable: ['ready_for_pickup', 'closed'],
};

export function isServiceStatus(s: unknown): s is ServiceStatus {
  return typeof s === 'string' && (SERVICE_STATUSES as readonly string[]).includes(s);
}

/**
 * Steps the server takes itself, from what happened: the customer's decision on a quotation approves the job, a
 * failed QA sends it for rework, and the handover record delivers it. They are never offered as buttons.
 */
export const SYSTEM_ONLY: readonly ServiceStatus[] = ['approved', 'rework_required', 'delivered'];

/** The steps the desktop offers by hand from `status` (the server may still refuse one). */
export function nextStatuses(status: string): ServiceStatus[] {
  if (!isServiceStatus(status)) return [];
  const out = NEXT[status].filter((s) => !SYSTEM_ONLY.includes(s));
  if (!TERMINAL.includes(status) && !['delivered', 'cancelled', 'closed'].includes(status)) out.push('cancelled');
  return out;
}

/** Steps that need the person to say why (the server records the reason). */
export function needsReason(to: ServiceStatus): boolean {
  return to === 'cancelled' || to === 'unrepairable' || to === 'rework_required';
}

export function statusLabel(s: string): string {
  return isServiceStatus(s) ? STATUS_LABEL[s] : s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** The board's columns, in workflow order (the ended ones left off). */
export const BOARD_COLUMNS: ServiceStatus[] = ['new', 'received', 'diagnosing', 'awaiting_quote', 'awaiting_approval', 'approved', 'waiting_parts', 'in_progress', 'external_service', 'qa_testing', 'rework_required', 'ready_for_pickup'];

export const SERVICE_VIEWS = ['home', 'jobs', 'board', 'checkin', 'devices'] as const;
export type ServiceView = (typeof SERVICE_VIEWS)[number];

export const DEVICE_TYPES = ['mobile', 'tablet', 'laptop', 'desktop', 'printer', 'other'] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

/** Each device type's intake checklist (blueprint §4); an organisation's own templates come from the server. */
export const INTAKE_CHECKLIST: Record<DeviceType, string[]> = {
  mobile: ['Physical damage inspected', 'Display and touch tested', 'Charging and battery tested', 'Camera, speaker and microphone tested', 'Wi-Fi, Bluetooth and cellular tested', 'Face ID / fingerprint tested', 'Water damage indicator checked', 'IMEI recorded', 'Accessories documented', 'Customer consent recorded', 'Device photos attached'],
  tablet: ['Physical damage inspected', 'Display and touch tested', 'Charging and battery tested', 'Camera, speaker and microphone tested', 'Wi-Fi and Bluetooth tested', 'Serial number recorded', 'Accessories documented', 'Customer consent recorded', 'Device photos attached'],
  laptop: ['Physical damage inspected', 'Powers on / BIOS reached', 'Display tested', 'Keyboard and touchpad tested', 'Battery and charging tested', 'Storage health checked', 'Ports tested', 'Fans and temperature checked', 'Serial number recorded', 'Accessories documented', 'Customer consent recorded', 'Device photos attached'],
  desktop: ['Physical damage inspected', 'Powers on / BIOS reached', 'Storage health checked', 'RAM tested', 'Graphics output tested', 'Ports tested', 'Fans and temperature checked', 'Network tested', 'Serial number recorded', 'Customer consent recorded', 'Device photos attached'],
  printer: ['Physical damage inspected', 'Test page printed', 'Rollers and paper feed checked', 'Toner / ink level recorded', 'Network connectivity tested', 'Firmware version recorded', 'Usage counter recorded', 'Serial number recorded', 'Customer consent recorded'],
  other: ['Physical damage inspected', 'Powers on', 'Serial number recorded', 'Accessories documented', 'Customer consent recorded', 'Device photos attached'],
};

/** IMEI: 15 digits passing the Luhn check. */
export function isImei(s: string): boolean {
  const d = s.replace(/[\s-]/g, '');
  if (!/^\d{15}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let n = Number(d[14 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

/** Money as the server sends it (minor units are not assumed): LKR by default. */
export function money(amount: number | null | undefined, currency = 'LKR'): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  return `${currency} ${amount.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
