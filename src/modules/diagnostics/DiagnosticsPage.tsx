import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { BundlePreview } from '@shared/ipc/contract';
import { app } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { useTab, useTabTitle } from '../../core/tab-context';
import { bytes } from '../../core/time';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, Modal, Spinner, cx } from '../../components/ui';
import type { ModuleProps } from '../registry';
import { WhatsappLinkLog } from './WhatsappLinkLog';
import { VoiceSendTimes } from './VoiceSendTimes';

/**
 * Help → Diagnostics (UI-21, FR-DIAG-01/02, WF-29): live health checks, the
 * background helpers, Safe Mode, and a support report the user reads before
 * it is saved — with tokens, passwords, email addresses, email bodies and
 * file contents already removed.
 */
export default function DiagnosticsPage(_props: ModuleProps) {
  useTabTitle('Diagnostics');
  const { navigate } = useTab();
  const info = useStore(app, (s) => s.info);
  const checks = useQuery({ queryKey: ['diagnostics'], queryFn: () => call('diagnostics:run'), refetchOnWindowFocus: false });
  const [preview, setPreview] = useState<BundlePreview | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const build = useMutation({
    mutationFn: () => call('diagnostics:previewBundle'),
    onSuccess: (p) => {
      setPreview(p);
      setOpen(p.files[0]?.name ?? null);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const save = useMutation({
    mutationFn: () => call('diagnostics:saveBundle'),
    onSuccess: (path) => {
      if (path) {
        toast('success', 'Diagnostic report saved.');
        setPreview(null);
      }
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const tone = { pass: 'text-success bg-success-bg', warn: 'text-warning bg-warning-bg', fail: 'text-danger bg-danger-bg', skip: 'text-ink-3 bg-subtle' } as const;
  const icon = { pass: 'check-circle', warn: 'warning', fail: 'alert', skip: 'minus' } as const;

  return (
    <div className="h-full overflow-y-auto px-10 py-8 scroll-thin">
      <div className="max-w-[860px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[24px] font-bold text-ink">Diagnostics</h1>
            <p className="mt-1 text-[13.5px] text-ink-3">
              WorkSuite Desktop {info?.version} · {info?.platform} {info?.arch} · {info?.osVersion}
              {info?.safeMode ? ' · Safe Mode' : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <Button icon="refresh" loading={checks.isFetching} onClick={() => void checks.refetch()}>
              Run again
            </Button>
            {/* Help → PDF Diagnostics (PDF Studio SRS §24.5): the engine, its worker, fonts, storage, printing. */}
            <Button icon="file-text" onClick={() => navigate('/pdf?view=diagnostics')}>
              PDF Diagnostics
            </Button>
            <Button variant="primary" icon="file-text" loading={build.isPending} onClick={() => build.mutate()}>
              Create diagnostic report
            </Button>
          </div>
        </div>

        <ul className="mt-6 flex flex-col gap-2">
          {checks.isLoading ? <Spinner label="Running checks…" /> : null}
          {(checks.data ?? []).map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-[10px] border border-line bg-surface px-4 py-3">
              <span className={cx('flex h-8 w-8 items-center justify-center rounded-full', tone[c.status])}>
                <Icon name={icon[c.status]} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-ink">{c.label}</div>
                <div className="text-[12.5px] text-ink-3 selectable">{c.detail}</div>
              </div>
              {c.ms !== undefined ? <span className="font-mono text-[12px] text-ink-3">{c.ms} ms</span> : null}
            </li>
          ))}
        </ul>

        <div className="mt-8 rounded-[12px] border border-line bg-surface p-5">
          <h2 className="text-[15px] font-bold text-ink">Troubleshooting</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => void call('diagnostics:restartSafeMode', { safe: !info?.safeMode })}>{info?.safeMode ? 'Restart normally' : 'Restart in Safe Mode'}</Button>
            <Button onClick={() => void call('app:relaunch')}>Restart WorkSuite</Button>
            <Button onClick={() => void call('notifications:test')}>Test notifications</Button>
          </div>
          <p className="mt-3 text-[12.5px] text-ink-3">Safe Mode starts without hardware acceleration, tab restore or background previews. WorkSuite offers it automatically after three crashes in ten minutes.</p>
        </div>

        {/* Each attempt to link a WhatsApp Web number, for whoever may link them (worksuite-desktop#323). */}
        <WhatsappLinkLog />

        {/* How fast voice messages go from this computer (worksuite-desktop#300). */}
        <VoiceSendTimes />
      </div>

      {preview ? (
        <Modal
          title="Diagnostic report"
          width={920}
          onClose={() => setPreview(null)}
          footer={
            <>
              <span className="mr-auto text-[12px] text-ink-3">
                {preview.files.length} files · {bytes(preview.files.reduce((n, f) => n + f.size, 0))} · nothing is sent anywhere — you choose where to save it.
              </span>
              <Button onClick={() => setPreview(null)}>Cancel</Button>
              <Button variant="primary" icon="download" loading={save.isPending} onClick={() => save.mutate()}>
                Save .zip…
              </Button>
            </>
          }
        >
          <div className="flex h-[520px]">
            <ul className="w-[220px] shrink-0 overflow-y-auto border-r border-line p-2 scroll-thin">
              {preview.files.map((f) => (
                <li key={f.name}>
                  <button type="button" onClick={() => setOpen(f.name)} className={cx('flex w-full justify-between rounded-[7px] px-2.5 py-1.5 text-left text-[12.5px]', open === f.name ? 'bg-selection font-semibold text-primary' : 'text-ink hover:bg-subtle')}>
                    <span className="truncate">{f.name}</span>
                    <span className="shrink-0 text-ink-3">{bytes(f.size)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <pre className="min-w-0 flex-1 overflow-auto p-4 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-2 selectable scroll-thin">{preview.files.find((f) => f.name === open)?.preview ?? ''}</pre>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
