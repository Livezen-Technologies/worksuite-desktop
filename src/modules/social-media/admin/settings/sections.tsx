import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { apiPost } from '../../../../core/api';
import { errorMessage } from '../../../../core/bridge';
import { toast } from '../../../../core/toasts';
import { Button, Modal } from '../../../../components/ui';
import { dataOf, SK, socialApi, useBrands, useInvalidate, useModuleStatus, write, type SettingValue } from '../../api';
import { NotOffered, Notice, OptionalView, TD, TEXTAREA, TR, Table } from '../../parts';
import { longWhen } from '../../lib/time';

/**
 * A02 sections that are more than a list of fields: the §14 permission table (read-only; roles are edited in Admin
 * Center), the organisation's brands, the notification grid (SMM-NTF-001/002), and Advanced (SMM-ADM-005) with the
 * organisation kill switch (SMM-PUB-010, WF-16, AC-08).
 */

export const PERMISSION_ROWS: Array<[string, string, string]> = [
  ['social.view', 'Open the app; see posts and calendar for accounts the user can Use', 'All social roles'],
  ['social.post.create', 'Create and edit own drafts; send for approval', 'Contributor+'],
  ['social.post.edit_any', "Edit other users' posts in brands they manage", 'Manager, Admin'],
  ['social.post.publish', 'Schedule / publish on accounts with Publish level (policy permitting)', 'Publisher+'],
  ['social.post.approve', 'Act in approval steps; create review links', 'Approver, Manager'],
  ['social.post.delete', 'Delete posts; delete published posts at the network', 'Manager, Admin'],
  ['social.account.connect', 'Connect new accounts', 'Admin, Manager'],
  ['social.account.manage', 'Reconnect, disconnect, edit access lists', 'Admin; account managers'],
  ['social.inbox.view', 'See inbox threads for accessible accounts', 'Agent, Manager'],
  ['social.inbox.reply', 'Reply, close, hide, use saved replies', 'Agent'],
  ['social.inbox.assign', 'Assign threads to others', 'Agent lead, Manager'],
  ['social.inbox.convert', 'Create CRM leads / tickets from threads (also needs CRM / Support rights)', 'Agent'],
  ['social.analytics.view', 'Dashboards and reports', 'Analyst+'],
  ['social.analytics.export', 'Exports and scheduled reports', 'Analyst, Manager'],
  ['social.library.manage', 'Manage library items', 'Manager, Publisher'],
  ['social.campaign.manage', 'Create and edit campaigns', 'Manager'],
  ['social.listening.manage', 'Listening queries', 'Manager'],
  ['social.settings.manage', 'Module settings, brands, provider apps, kill switch', 'Social Admin'],
  ['social.audit.view', 'Publishing log and audit entries', 'Admin, Manager'],
];

export function PermissionsMatrix({ onEditRoles }: { onEditRoles: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-ink-3">Per-account levels (Use ⊂ Publish ⊂ Manage) narrow every permission further: publishing only works on accounts where the person holds Publish.</p>
      <Table head={['Permission', 'What it allows', 'Typical holders']} minWidth={640}>
        {PERMISSION_ROWS.map(([p, what, who]) => (
          <tr key={p} className={TR}>
            <td className={`${TD} font-mono text-[12px] text-ink`}>{p}</td>
            <td className={`${TD} text-ink-2`}>{what}</td>
            <td className={`${TD} text-ink-3`}>{who}</td>
          </tr>
        ))}
      </Table>
      <div>
        <Button icon="external" onClick={onEditRoles}>
          Edit roles in Admin Center
        </Button>
      </div>
    </div>
  );
}

export function BrandsList() {
  const q = useBrands();
  return (
    <OptionalView q={q} what="Brands" compact>
      {(brands) =>
        brands.length ? (
          <Table head={['Brand', 'Time zone', 'Accounts', 'Approval policy']} minWidth={520}>
            {brands.map((b) => (
              <tr key={b.id} className={TR}>
                <td className={TD}>
                  <span className="flex items-center gap-2 font-semibold text-ink">
                    <span className="h-3 w-3 rounded-[3px]" style={{ background: b.color }} aria-hidden />
                    {b.name}
                  </span>
                </td>
                <td className={`${TD} text-ink-2`}>{b.timezone}</td>
                <td className={`${TD} tabular-nums text-ink-2`}>{b.accounts_count ?? '—'}</td>
                <td className={`${TD} text-ink-2`}>{b.approval_policy?.name ?? 'None'}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-[13px] text-ink-3">No brands yet. Add one on the Accounts page.</p>
        )
      }
    </OptionalView>
  );
}

export const NTF_EVENTS: Array<{ id: string; label: string; critical?: boolean }> = [
  { id: 'approval_needed', label: 'Post needs approval' },
  { id: 'approved', label: 'Post approved' },
  { id: 'changes_requested', label: 'Changes requested' },
  { id: 'published', label: 'Published' },
  { id: 'failed', label: 'Failed', critical: true },
  { id: 'held', label: 'Held', critical: true },
  { id: 'manual_reminder', label: 'Manual reminder due' },
  { id: 'account_expiring', label: 'Account expiring or expired', critical: true },
  { id: 'inbox_assigned', label: 'Inbox assignment' },
  { id: 'reply_at_risk', label: 'Reply target at risk' },
  { id: 'report_ready', label: 'Report ready' },
];

export const NTF_CHANNELS: Array<{ id: string; label: string }> = [
  { id: 'in_app', label: 'In-app' },
  { id: 'email', label: 'Email' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'push', label: 'Mobile push' },
  { id: 'chat', label: 'Chat' },
  { id: 'whatsapp', label: 'WhatsApp (critical only)' },
];

export const isNotificationKey = (k: string) => k.startsWith('ntf_');

export function NotificationsGrid({ values, onChange, disabled }: { values: Record<string, SettingValue>; onChange: (key: string, v: SettingValue) => void; disabled?: boolean }) {
  const on = (e: string) => {
    const v = values[`ntf_${e}`];
    return Array.isArray(v) ? v : [];
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-ink-3">What the module sends by default. Each person’s Core notification preferences still apply on top.</p>
      <Table head={['Event', ...NTF_CHANNELS.map((c) => c.label)]} minWidth={760}>
        {NTF_EVENTS.map((e) => (
          <tr key={e.id} className={TR}>
            <td className={`${TD} font-semibold text-ink`}>{e.label}</td>
            {NTF_CHANNELS.map((c) => {
              const usable = c.id !== 'whatsapp' || !!e.critical;
              const checked = on(e.id).includes(c.id);
              return (
                <td key={c.id} className={TD}>
                  {usable ? (
                    <input
                      type="checkbox"
                      aria-label={`${e.label} by ${c.label}`}
                      className="h-4 w-4 accent-[var(--ws-indigo)]"
                      disabled={disabled}
                      checked={checked}
                      onChange={(ev) => onChange(`ntf_${e.id}`, ev.target.checked ? [...on(e.id), c.id] : on(e.id).filter((x) => x !== c.id))}
                    />
                  ) : (
                    <span className="text-ink-3" aria-label="Not available">
                      —
                    </span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </Table>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Advanced
 * ------------------------------------------------------------------------ */

const V = '/api/social-media';
/** Proposed: not yet in api.ts. POST /export → { job_id } (the archive arrives in Drive and by notification). */
const exportAll = () => write(apiPost<{ job_id?: number | null }>(`${V}/export`, {}));
/** Proposed: POST /webhooks/resubscribe → { accounts: number }. */
const resubscribe = () => write(apiPost<{ accounts?: number | null }>(`${V}/webhooks/resubscribe`, {}));

export const isDiagnosticKey = (k: string) => k.startsWith('adapter_') || k.startsWith('diag_');

function KillSwitch({ canEdit }: { canEdit: boolean }) {
  const invalidate = useInvalidate();
  const status = useModuleStatus();
  const s = dataOf(status.data);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: (paused: boolean) => socialApi.pauseAll(paused, paused ? reason.trim() : undefined),
    onSuccess: (_r, paused) => {
      invalidate(SK.status, SK.postsAll, SK.queueAll);
      toast('success', paused ? 'All publishing is paused.' : 'Publishing resumed.');
      setAsking(false);
      setReason('');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  if (status.data && !status.data.offered) return <NotOffered what="The kill switch" compact />;
  return (
    <div className="rounded-[12px] border border-danger/30 p-4">
      <h3 className="text-[14px] font-bold text-danger">Pause all publishing</h3>
      <p className="mt-1 text-[12.5px] text-ink-2">Stops every pending publish job in the organisation within a minute. Nothing is lost: posts wait, and go out when publishing resumes.</p>
      {s?.paused_all ? (
        <Notice tone="danger" icon="pause" className="mt-3" action={canEdit ? <Button size="sm" loading={m.isPending} onClick={() => m.mutate(false)}>Resume publishing</Button> : null}>
          Publishing is paused{s.paused_by ? ` by ${s.paused_by.name}` : ''}
          {s.paused_at ? ` since ${longWhen(s.paused_at)}` : ''}.
        </Notice>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <span className="flex-1 text-[12.5px] text-ink-3">{s ? 'Publishing is running.' : ''}</span>
          {canEdit ? (
            <Button variant="danger" icon="pause" onClick={() => setAsking(true)}>
              Pause all publishing
            </Button>
          ) : null}
        </div>
      )}
      {asking ? (
        <Modal
          title="Pause all publishing?"
          onClose={() => setAsking(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setAsking(false)}>
                Cancel
              </Button>
              <Button variant="danger" disabled={!reason.trim()} loading={m.isPending} onClick={() => m.mutate(true)}>
                Pause everything
              </Button>
            </>
          }
        >
          <p className="mb-3 text-[13px] text-ink">Every account in every brand stops publishing. Owners of affected posts are told, with your reason.</p>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-ink-2">Reason (required)</span>
            <textarea className={TEXTAREA} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </label>
        </Modal>
      ) : null}
    </div>
  );
}

export function AdvancedTools({ values, canEdit }: { values: Record<string, SettingValue>; canEdit: boolean }) {
  const exp = useMutation({ mutationFn: exportAll, onSuccess: () => toast('success', 'Export started. You’ll be notified when the archive is in Drive.'), onError: (e) => toast('error', errorMessage(e)) });
  const sub = useMutation({
    mutationFn: resubscribe,
    onSuccess: (r) => toast('success', r?.accounts ? `Webhooks re-subscribed for ${r.accounts} accounts.` : 'Webhooks re-subscribed.'),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const diag = Object.entries(values).filter(([k]) => isDiagnosticKey(k));
  return (
    <div className="flex flex-col gap-4">
      <KillSwitch canEdit={canEdit} />
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button icon="download" loading={exp.isPending} onClick={() => exp.mutate()}>
            Export all data
          </Button>
          <Button icon="refresh" loading={sub.isPending} onClick={() => sub.mutate()}>
            Re-subscribe webhooks
          </Button>
        </div>
      ) : null}
      <div>
        <h3 className="mb-1 text-[13px] font-bold text-ink">Adapter diagnostics</h3>
        {diag.length ? (
          <dl className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12.5px]">
            {diag.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-3">{k.replace(/^(adapter|diag)_/, '').replace(/_/g, ' ')}</dt>
                <dd className="font-mono text-ink-2">{Array.isArray(v) ? v.join(', ') : String(v ?? '—')}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-[12.5px] text-ink-3">The server reports no adapter diagnostics.</p>
        )}
      </div>
    </div>
  );
}
