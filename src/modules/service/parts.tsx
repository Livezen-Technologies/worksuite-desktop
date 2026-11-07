import { STATUS_TONE, isServiceStatus, statusLabel } from '@shared/service';
import { Chip } from '../../components/ui';

export function StatusChip({ status }: { status: string }) {
  return <Chip tone={isServiceStatus(status) ? STATUS_TONE[status] : 'muted'}>{statusLabel(status)}</Chip>;
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function deviceName(d: { brand?: string | null; model?: string | null; type?: string } | null | undefined): string {
  if (!d) return '—';
  return [d.brand, d.model].filter(Boolean).join(' ') || d.type || '—';
}

export const input = 'w-full rounded-[7px] border border-line bg-surface px-2 py-1 text-[13px]';
