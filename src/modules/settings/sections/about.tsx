import { useStore } from '../../../core/store';
import { app } from '../../../core/app-state';
import { Icon } from '../../../components/Icon';
import { useTab } from '../../../core/tab-context';
import { UpdatesRow } from '../UpdatesCard';
import { Button } from '../../../components/ui';
import { call } from '../../../core/bridge';
import { H, Row } from './parts';

/** Settings › About and Monitoring. */

const WEBSITE = 'https://worksuitecloud.com/';

export function Monitoring() {
  const policy = useStore(app, (s) => s.bootstrap?.monitoringPolicy);
  return (
    <>
      <H title="Monitoring" />
      {policy ? (
        <p className="text-[13.5px] text-ink-2">
          Policy “{policy.name}” (version {policy.version}) is assigned to you. The monitoring agent is part of a later version of WorkSuite Desktop; nothing is recorded by this version.
        </p>
      ) : (
        <div className="rounded-[12px] border border-line bg-surface p-5">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Icon name="shield-check" size={18} className="text-success" /> No monitoring policy is assigned to you
          </div>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">WorkSuite is not recording your work sessions, app usage, websites or screenshots.</p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
            If your organization ever assigns a policy, you will be shown exactly what is tracked and what is never tracked — keystrokes, passwords, clipboard, continuous webcam and microphone are never collected — and nothing starts until you acknowledge it. A timer and tray indicator are always visible while a session is active.
          </p>
        </div>
      )}
    </>
  );
}

export function About() {
  const { navigate } = useTab();
  const info = useStore(app, (s) => s.info);
  return (
    <>
      <H title="About WorkSuite Desktop" />
      <Row label="Version">
        <span className="font-mono text-[13px] text-ink-2">
          {info?.version} ({info?.platform} {info?.arch})
        </span>
      </Row>
      {/* Where updates stand, and the way to Settings › Updates. */}
      <UpdatesRow />
      <Row label="Components">
        <span className="font-mono text-[12px] text-ink-3">
          Electron {info?.electron} · Chromium {info?.chrome} · Node {info?.node}
        </span>
      </Row>
      <Row label="Diagnostics" hint="Health checks and a support report with secrets removed.">
        <Button icon="stethoscope" onClick={() => navigate('/diagnostics')}>
          Open Diagnostics
        </Button>
      </Row>
      {/* Who makes WorkSuite (#48): the year is this year's, and the website opens in the default browser. */}
      <div className="mt-6 space-y-1 text-[13px] leading-[1.5] break-words text-ink-2">
        <p>WorkSuite is owned and developed by Livezen Technologies LLC.</p>
        <p>© {new Date().getFullYear()} Livezen Technologies LLC. All rights reserved.</p>
        <p>
          Website:{' '}
          <a
            href={WEBSITE}
            onClick={(e) => {
              e.preventDefault();
              void call('app:openExternal', { url: WEBSITE }).catch(() => undefined);
            }}
            className="font-semibold text-primary hover:underline"
          >
            worksuitecloud.com
          </a>
        </p>
      </div>
      <p className="mt-4 text-[12px] text-ink-3">WorkSuite Desktop includes open-source software; licences are listed in the application's resources.</p>
    </>
  );
}
